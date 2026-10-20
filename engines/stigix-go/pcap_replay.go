package main

import (
	"compress/gzip"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"
)

func runPcapReplayCLI(args []string) {
	var (
		profilePath string
		role        string
		target      = "127.0.0.1"
		bindAddr    = "0.0.0.0"
		portOvr     int
		loopFlag    bool
		intervalMS  = 2000
		timeoutMS   = 3000
	)

	for i := 0; i < len(args); i++ {
		arg := args[i]
		switch arg {
		case "--role":
			if i+1 < len(args) {
				role = args[i+1]
				i++
			}
		case "--target":
			if i+1 < len(args) {
				target = args[i+1]
				i++
			}
		case "--bind":
			if i+1 < len(args) {
				bindAddr = args[i+1]
				i++
			}
		case "--port":
			if i+1 < len(args) {
				portOvr, _ = strconv.Atoi(args[i+1])
				i++
			}
		case "--loop":
			loopFlag = true
		case "--interval":
			if i+1 < len(args) {
				intervalMS, _ = strconv.Atoi(args[i+1])
				i++
			}
		case "--timeout":
			if i+1 < len(args) {
				timeoutMS, _ = strconv.Atoi(args[i+1])
				i++
			}
		default:
			if !strings.HasPrefix(arg, "-") && profilePath == "" {
				profilePath = arg
			}
		}
	}

	if profilePath == "" || (role != "server" && role != "client") {
		emitReplayLog(map[string]any{
			"event": "error",
			"error": "Usage: stigix-go pcap-replay <profile.stx-replay> --role <server|client> [--target <ip>] [--port <p>] [--loop]",
		})
		os.Exit(1)
	}

	profile, err := loadReplayProfile(profilePath)
	if err != nil {
		emitReplayLog(map[string]any{
			"event": "error",
			"error": fmt.Sprintf("Failed to load profile: %v", err),
		})
		os.Exit(1)
	}

	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()

	proto, _ := profile.Flow["proto"].(string)
	proto = strings.ToUpper(proto)
	if proto == "" {
		proto = "TCP"
	}

	defaultPort := intFromAny(profile.Flow["default_port"])
	if defaultPort <= 0 {
		defaultPort = 8080
	}
	port := defaultPort
	if portOvr > 0 {
		port = portOvr
	}

	name, _ := profile.Metadata["name"].(string)
	if name == "" {
		name = "unnamed"
	}

	if role == "server" {
		if proto == "UDP" {
			runUDPReplayServer(ctx, profile, name, bindAddr, port, timeoutMS)
		} else {
			runTCPReplayServer(ctx, profile, name, bindAddr, port, timeoutMS)
		}
		return
	}

	// Client role
	iteration := 0
	for {
		select {
		case <-ctx.Done():
			return
		default:
		}
		iteration++
		var res map[string]any
		if proto == "UDP" {
			res = runUDPReplayClientOnce(profile, name, target, port, timeoutMS)
		} else {
			res = runTCPReplayClientOnce(profile, name, target, port, timeoutMS)
		}
		res["event"] = "session_result"
		res["iteration"] = iteration
		emitReplayLog(res)

		if !loopFlag {
			break
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(time.Duration(intervalMS) * time.Millisecond):
		}
	}
}

func emitReplayLog(entry map[string]any) {
	if _, ok := entry["timestamp"]; !ok {
		entry["timestamp"] = time.Now().UTC().Format(time.RFC3339)
	}
	b, err := json.Marshal(entry)
	if err == nil {
		fmt.Println(string(b))
	}
}

func loadReplayProfile(path string) (ReplayProfile, error) {
	var prof ReplayProfile
	f, err := os.Open(path)
	if err != nil {
		return prof, err
	}
	defer f.Close()

	var magic [2]byte
	if _, err := io.ReadFull(f, magic[:]); err != nil {
		return prof, err
	}
	_, _ = f.Seek(0, io.SeekStart)

	var reader io.Reader = f
	if magic[0] == 0x1f && magic[1] == 0x8b {
		gr, err := gzip.NewReader(f)
		if err != nil {
			return prof, err
		}
		defer gr.Close()
		reader = gr
	}

	dec := json.NewDecoder(reader)
	if err := dec.Decode(&prof); err != nil {
		return prof, err
	}
	if prof.Metadata == nil {
		prof.Metadata = map[string]any{}
	}
	if prof.Name != "" {
		prof.Metadata["name"] = prof.Name
	}
	if prof.Flow == nil {
		prof.Flow = map[string]any{}
	}
	if len(prof.Flows) > 0 {
		f0 := prof.Flows[0]
		if sp := intFromAny(f0["server_port"]); sp > 0 {
			prof.Flow["default_port"] = sp
		}
		if tr, ok := f0["transport"].(string); ok && tr != "" && prof.Flow["proto"] == nil {
			prof.Flow["proto"] = tr
		}
		if len(prof.Turns) == 0 {
			if rawTurns, ok := f0["turns"]; ok {
				b, _ := json.Marshal(rawTurns)
				_ = json.Unmarshal(b, &prof.Turns)
			}
		}
	}
	return prof, nil
}

func runTCPReplayServer(ctx context.Context, profile ReplayProfile, name string, bindAddr string, port int, timeoutMS int) {
	actualPort := port
	ln, err := net.Listen("tcp4", fmt.Sprintf("%s:%d", bindAddr, actualPort))
	if err != nil && actualPort < 1024 {
		fallback := 10000 + actualPort
		ln, err = net.Listen("tcp4", fmt.Sprintf("%s:%d", bindAddr, fallback))
		if err == nil {
			emitReplayLog(map[string]any{
				"event":          "port_fallback",
				"requested_port": port,
				"fallback_port":  fallback,
				"reason":         err.Error(),
			})
			actualPort = fallback
		}
	}
	if err != nil {
		emitReplayLog(map[string]any{
			"event": "error",
			"error": fmt.Sprintf("Failed to bind TCP server on %s:%d: %v", bindAddr, actualPort, err),
		})
		return
	}
	defer ln.Close()

	go func() {
		<-ctx.Done()
		_ = ln.Close()
	}()

	emitReplayLog(map[string]any{
		"event":       "server_listening",
		"role":        "server",
		"proto":       "TCP",
		"bind":        bindAddr,
		"port":        actualPort,
		"profile":     name,
		"turns_total": len(profile.Turns),
	})

	for {
		conn, err := ln.Accept()
		if err != nil {
			select {
			case <-ctx.Done():
				return
			default:
				continue
			}
		}
		go handleTCPServerSession(conn, profile, name, timeoutMS)
	}
}

func handleTCPServerSession(conn net.Conn, profile ReplayProfile, name string, timeoutMS int) {
	defer conn.Close()
	clientAddr := conn.RemoteAddr().String()
	turnsCompleted := 0
	bytesSent := 0
	bytesReceived := 0
	status := "completed"
	var errDetail any = nil

	for _, turn := range profile.Turns {
		rawBytes, _ := base64.StdEncoding.DecodeString(turn.DataB64)
		expectedLen := turn.Length
		if expectedLen <= 0 {
			expectedLen = len(rawBytes)
		}
		delayMS := turn.DelayMS

		if turn.Dir == "c2s" {
			_ = conn.SetReadDeadline(time.Now().Add(time.Duration(timeoutMS) * time.Millisecond))
			buf := make([]byte, 65535)
			n, err := conn.Read(buf)
			if err != nil {
				if ne, ok := err.(net.Error); ok && ne.Timeout() {
					status = "timeout_waiting_client"
					errDetail = fmt.Sprintf("Turn %d timeout waiting for client data", turn.Turn)
				} else if errors.Is(err, syscall.ECONNRESET) {
					status = "reset_by_peer"
					errDetail = fmt.Sprintf("Turn %d TCP RST received", turn.Turn)
				} else {
					status = "client_closed_early"
					errDetail = fmt.Sprintf("Turn %d client closed early before sending %d bytes", turn.Turn, expectedLen)
				}
				break
			}
			bytesReceived += n
			// Drain additional chunks briefly if client sent a large payload
			for n < expectedLen {
				_ = conn.SetReadDeadline(time.Now().Add(150 * time.Millisecond))
				more, err := conn.Read(buf)
				if more > 0 {
					n += more
					bytesReceived += more
				}
				if err != nil {
					break
				}
			}
			turnsCompleted++
		} else if turn.Dir == "s2c" {
			if delayMS > 0 {
				d := delayMS
				if d > 1000 {
					d = 1000
				}
				time.Sleep(time.Duration(d) * time.Millisecond)
			}
			_ = conn.SetWriteDeadline(time.Now().Add(time.Duration(timeoutMS) * time.Millisecond))
			written, err := conn.Write(rawBytes)
			if err != nil {
				status = "error"
				errDetail = err.Error()
				break
			}
			bytesSent += written
			turnsCompleted++
		}
	}

	emitReplayLog(map[string]any{
		"event":           "session_completed",
		"role":            "server",
		"proto":           "TCP",
		"client":          clientAddr,
		"profile":         name,
		"status":          status,
		"turns_completed": turnsCompleted,
		"turns_total":     len(profile.Turns),
		"bytes_sent":      bytesSent,
		"bytes_received":  bytesReceived,
		"error":           errDetail,
	})
}

func runUDPReplayServer(ctx context.Context, profile ReplayProfile, name string, bindAddr string, port int, timeoutMS int) {
	actualPort := port
	addr := &net.UDPAddr{IP: net.ParseIP(bindAddr), Port: actualPort}
	conn, err := net.ListenUDP("udp4", addr)
	if err != nil && actualPort < 1024 {
		fallback := 10000 + actualPort
		addr.Port = fallback
		conn, err = net.ListenUDP("udp4", addr)
		if err == nil {
			actualPort = fallback
		}
	}
	if err != nil {
		emitReplayLog(map[string]any{
			"event": "error",
			"error": fmt.Sprintf("Failed to bind UDP server on %s:%d: %v", bindAddr, actualPort, err),
		})
		return
	}
	defer conn.Close()

	emitReplayLog(map[string]any{
		"event":       "server_listening",
		"role":        "server",
		"proto":       "UDP",
		"bind":        bindAddr,
		"port":        actualPort,
		"profile":     name,
		"turns_total": len(profile.Turns),
	})

	buf := make([]byte, 65535)
	for {
		select {
		case <-ctx.Done():
			return
		default:
		}

		var clientAddr *net.UDPAddr
		turnsCompleted := 0
		bytesSent := 0
		bytesReceived := 0

		for _, turn := range profile.Turns {
			rawBytes, _ := base64.StdEncoding.DecodeString(turn.DataB64)
			if turn.Dir == "c2s" {
				if clientAddr == nil {
					_ = conn.SetReadDeadline(time.Now().Add(1 * time.Second))
				} else {
					_ = conn.SetReadDeadline(time.Now().Add(time.Duration(timeoutMS) * time.Millisecond))
				}
				n, raddr, err := conn.ReadFromUDP(buf)
				if err != nil {
					break
				}
				clientAddr = raddr
				bytesReceived += n
				turnsCompleted++
			} else if turn.Dir == "s2c" && clientAddr != nil {
				if turn.DelayMS > 0 {
					d := turn.DelayMS
					if d > 1000 {
						d = 1000
					}
					time.Sleep(time.Duration(d) * time.Millisecond)
				}
				n, err := conn.WriteToUDP(rawBytes, clientAddr)
				if err != nil {
					break
				}
				bytesSent += n
				turnsCompleted++
			}
		}

		if clientAddr != nil {
			emitReplayLog(map[string]any{
				"event":           "session_completed",
				"role":            "server",
				"proto":           "UDP",
				"client":          clientAddr.String(),
				"profile":         name,
				"turns_completed": turnsCompleted,
				"turns_total":     len(profile.Turns),
				"bytes_sent":      bytesSent,
				"bytes_received":  bytesReceived,
			})
		}
	}
}

func runTCPReplayClientOnce(profile ReplayProfile, name string, target string, port int, timeoutMS int) map[string]any {
	start := time.Now()
	turnsCompleted := 0
	bytesSent := 0
	bytesReceived := 0
	verdict := "Bypass"
	reason := "All application turns completed"
	totalTurns := len(profile.Turns)

	conn, err := net.DialTimeout("tcp4", fmt.Sprintf("%s:%d", target, port), time.Duration(timeoutMS)*time.Millisecond)
	if err != nil {
		if ne, ok := err.(net.Error); ok && ne.Timeout() {
			verdict = "Enforced (Drop)"
			reason = fmt.Sprintf("TCP SYN timeout after %dms", timeoutMS)
		} else if errors.Is(err, syscall.ECONNREFUSED) || errors.Is(err, syscall.ECONNRESET) {
			verdict = "Enforced (Reset)"
			reason = "Connection reset or refused during TCP handshake"
		} else {
			verdict = "Error"
			reason = err.Error()
		}
		return buildClientResult("TCP", target, port, name, verdict, reason, turnsCompleted, totalTurns, bytesSent, bytesReceived, start)
	}
	defer conn.Close()

	buf := make([]byte, 65535)
	for _, turn := range profile.Turns {
		rawBytes, _ := base64.StdEncoding.DecodeString(turn.DataB64)
		expectedLen := turn.Length
		if expectedLen <= 0 {
			expectedLen = len(rawBytes)
		}

		if turn.Dir == "c2s" {
			if turn.DelayMS > 0 {
				d := turn.DelayMS
				if d > 1000 {
					d = 1000
				}
				time.Sleep(time.Duration(d) * time.Millisecond)
			}
			_ = conn.SetWriteDeadline(time.Now().Add(time.Duration(timeoutMS) * time.Millisecond))
			written, err := conn.Write(rawBytes)
			if err != nil {
				if errors.Is(err, syscall.ECONNRESET) || errors.Is(err, syscall.EPIPE) {
					verdict = "Enforced (Reset)"
					reason = fmt.Sprintf("TCP RST while sending turn %d", turn.Turn)
				} else {
					verdict = "Error"
					reason = fmt.Sprintf("Turn %d send error: %v", turn.Turn, err)
				}
				break
			}
			bytesSent += written
			turnsCompleted++
		} else if turn.Dir == "s2c" {
			_ = conn.SetReadDeadline(time.Now().Add(time.Duration(timeoutMS) * time.Millisecond))
			n, err := conn.Read(buf)
			if err != nil {
				if ne, ok := err.(net.Error); ok && ne.Timeout() {
					verdict = "Enforced (Drop)"
					reason = fmt.Sprintf("Timeout waiting for server response on turn %d", turn.Turn)
				} else if errors.Is(err, syscall.ECONNRESET) {
					verdict = "Enforced (Reset)"
					reason = fmt.Sprintf("TCP RST received on turn %d (IPS/App-ID signature match)", turn.Turn)
				} else {
					verdict = "Enforced (Reset)"
					reason = fmt.Sprintf("Connection closed prematurely by peer/firewall on turn %d", turn.Turn)
				}
				break
			}
			bytesReceived += n
			firstChunk := string(buf[:minInt(n, 512)])

			for n < expectedLen {
				_ = conn.SetReadDeadline(time.Now().Add(150 * time.Millisecond))
				more, err := conn.Read(buf)
				if more > 0 {
					n += more
					bytesReceived += more
				}
				if err != nil {
					break
				}
			}

			lowerChunk := strings.ToLower(firstChunk)
			if (strings.Contains(lowerChunk, "403 forbidden") || strings.Contains(lowerChunk, "503 service unavailable") || strings.Contains(lowerChunk, "application blocked") || strings.Contains(lowerChunk, "access denied")) &&
				!strings.Contains(strings.ToLower(string(rawBytes)), "403 forbidden") {
				verdict = "Enforced (Block Page)"
				reason = fmt.Sprintf("HTTP Block Page injected on turn %d", turn.Turn)
				break
			}
			turnsCompleted++
		}
	}

	// Post-probe check for unidirectional c2s-only profiles
	allC2S := true
	for _, t := range profile.Turns {
		if t.Dir != "c2s" {
			allC2S = false
			break
		}
	}
	if verdict == "Bypass" && allC2S {
		_ = conn.SetReadDeadline(time.Now().Add(350 * time.Millisecond))
		n, err := conn.Read(buf)
		if err != nil {
			if errors.Is(err, syscall.ECONNRESET) {
				verdict = "Enforced (Reset)"
				reason = "TCP RST received after payload transmission (IPS signature triggered)"
			}
		} else if n > 0 {
			bytesReceived += n
			lower := strings.ToLower(string(buf[:minInt(n, 512)]))
			if strings.Contains(lower, "403 forbidden") || strings.Contains(lower, "blocked") {
				verdict = "Enforced (Block Page)"
				reason = "Block page received after payload transmission"
			}
		}
	}

	return buildClientResult("TCP", target, port, name, verdict, reason, turnsCompleted, totalTurns, bytesSent, bytesReceived, start)
}

func runUDPReplayClientOnce(profile ReplayProfile, name string, target string, port int, timeoutMS int) map[string]any {
	start := time.Now()
	turnsCompleted := 0
	bytesSent := 0
	bytesReceived := 0
	verdict := "Bypass"
	reason := "All UDP turns completed"
	totalTurns := len(profile.Turns)

	conn, err := net.DialTimeout("udp4", fmt.Sprintf("%s:%d", target, port), time.Duration(timeoutMS)*time.Millisecond)
	if err != nil {
		return buildClientResult("UDP", target, port, name, "Error", err.Error(), 0, totalTurns, 0, 0, start)
	}
	defer conn.Close()

	buf := make([]byte, 65535)
	hasS2C := false
	for _, turn := range profile.Turns {
		rawBytes, _ := base64.StdEncoding.DecodeString(turn.DataB64)
		if turn.Dir == "c2s" {
			if turn.DelayMS > 0 {
				d := turn.DelayMS
				if d > 1000 {
					d = 1000
				}
				time.Sleep(time.Duration(d) * time.Millisecond)
			}
			written, err := conn.Write(rawBytes)
			if err != nil {
				verdict = "Error"
				reason = err.Error()
				break
			}
			bytesSent += written
			turnsCompleted++
		} else if turn.Dir == "s2c" {
			hasS2C = true
			_ = conn.SetReadDeadline(time.Now().Add(time.Duration(timeoutMS) * time.Millisecond))
			n, err := conn.Read(buf)
			if err != nil {
				if ne, ok := err.(net.Error); ok && ne.Timeout() {
					verdict = "Enforced (Drop)"
					reason = fmt.Sprintf("UDP timeout waiting for server turn %d", turn.Turn)
				} else {
					verdict = "Enforced (Reset)"
					reason = fmt.Sprintf("UDP ICMP unreachable / reset on turn %d", turn.Turn)
				}
				break
			}
			bytesReceived += n
			turnsCompleted++
		}
	}

	if !hasS2C && verdict == "Bypass" {
		verdict = "Completed (Unidirectional)"
		reason = "Unidirectional UDP stream transmitted (no server response turns in PCAP)"
	}

	return buildClientResult("UDP", target, port, name, verdict, reason, turnsCompleted, totalTurns, bytesSent, bytesReceived, start)
}

func buildClientResult(proto string, target string, port int, name string, verdict string, reason string, turnsCompleted int, totalTurns int, bytesSent int, bytesReceived int, start time.Time) map[string]any {
	durMS := round2(float64(time.Since(start).Microseconds()) / 1000.0)
	return map[string]any{
		"role":            "client",
		"proto":           proto,
		"target":          fmt.Sprintf("%s:%d", target, port),
		"profile":         name,
		"verdict":         verdict,
		"reason":          reason,
		"turns_completed": turnsCompleted,
		"total_turns":     totalTurns,
		"bytes_sent":      bytesSent,
		"bytes_received":  bytesReceived,
		"duration_ms":     durMS,
	}
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}
