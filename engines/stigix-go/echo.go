package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/exec"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

const eicarString = `X5O!P%@AP[4\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*`

func runTargetHTTPServer(ctx context.Context) {
	port := 8082
	if v := os.Getenv("TARGET_HTTP_PORT"); v != "" {
		if p, err := strconv.Atoi(v); err == nil && p > 0 {
			port = p
		}
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/eicar.com.txt", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain")
		w.Header().Set("Content-Disposition", "attachment; filename=eicar.com.txt")
		eicarFile := os.Getenv("EICAR_FILE_PATH")
		if eicarFile == "" {
			eicarFile = "/opt/sdwan-target/eicar.com.txt"
		}
		if b, err := os.ReadFile(eicarFile); err == nil {
			_, _ = w.Write(b)
			return
		}
		_, _ = w.Write([]byte(eicarString))
	})

	statusHandler := func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"status":         "ready",
			"service":        "eicar_security_target",
			"engine":         "stigix-go",
			"port":           port,
			"eicar_endpoint": "/eicar.com.txt",
		})
	}
	mux.HandleFunc("/api/status", statusHandler)
	mux.HandleFunc("/health", statusHandler)
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = fmt.Fprintf(w, `<!DOCTYPE html><html><head><title>Stigix EICAR Security Target (Port %d · Go Engine)</title></head><body style="font-family:sans-serif;background:#0f172a;color:#e2e8f0;padding:40px"><div style="background:#1e293b;border:1px solid #334155;border-radius:12px;padding:24px;max-width:600px;margin:0 auto"><h1>🛡️ Stigix EICAR Security Target (Go Native)</h1><p>Port %d · <a style="color:#38bdf8" href="/eicar.com.txt">/eicar.com.txt</a> · <a style="color:#38bdf8" href="/api/status">/api/status</a></p></div></body></html>`, port, port)
	})

	srv := &http.Server{
		Addr:              fmt.Sprintf("0.0.0.0:%d", port),
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
	}
	go func() {
		<-ctx.Done()
		shutCtx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		_ = srv.Shutdown(shutCtx)
	}()
	fmt.Printf("[STIGIX-GO TARGET] Serving EICAR HTTP Target on 0.0.0.0:%d\n", port)
	_ = srv.ListenAndServe()
}

func ensureIperf3Server(ctx context.Context) {
	if _, err := exec.LookPath("iperf3"); err != nil {
		return
	}
	cmd := exec.CommandContext(ctx, "iperf3", "-s")
	if f, err := os.OpenFile("/tmp/iperf3.log", os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0644); err == nil {
		cmd.Stdout = f
		cmd.Stderr = f
	}
	_ = cmd.Start()
	go func() {
		_ = cmd.Wait()
	}()
}

type EchoSession struct {
	ID          string  `json:"id"`
	Key         string  `json:"key"`
	Type        string  `json:"type"`
	SrcIP       string  `json:"src_ip"`
	SourceIP    string  `json:"source_ip"`
	SrcPort     int     `json:"src_port"`
	SourcePort  int     `json:"source_port"`
	DestPort    int     `json:"dest_port"`
	TargetPort  int     `json:"target_port"`
	CallID      string  `json:"call_id"`
	Label       string  `json:"label"`
	SrcSite     string  `json:"src_site"`
	SourceSite  string  `json:"source_site"`
	StartTime   int64   `json:"start_time"`
	LastSeen    int64   `json:"last_seen"`
	PacketCount int64   `json:"packet_count"`
	TotalBytes  int64   `json:"total_bytes"`
	Status      string  `json:"status"`
	Duration    int64   `json:"duration"`
	DurationS   int64   `json:"duration_s"`
	Pps         float64 `json:"pps"`
	BitrateKbps float64 `json:"bitrate_kbps"`

	lastSeenFloat  float64
	startTimeFloat float64
}

var (
	reSite = regexp.MustCompile(`SITE:([^:\x00\r\n]+)`)
	reCID  = regexp.MustCompile(`CID:([^:\x00\r\n]+)`)
	reConv = regexp.MustCompile(`CONV:(TEST-[A-Za-z0-9_-]+|[A-Za-z0-9_-]+):([^:\x00\r\n]*):`)
	reTest = regexp.MustCompile(`(TEST-[A-Za-z0-9_-]+)`)
	reCall = regexp.MustCompile(`(CALL-[A-Za-z0-9_-]+)`)
)

func runSRTResponderServer(ctx context.Context, port int) {
	if port <= 0 {
		port = 8081
		if v := os.Getenv("SRT_HTTP_PORT"); v != "" {
			if p, err := strconv.Atoi(v); err == nil && p > 0 {
				port = p
			}
		}
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		delayMs := 0
		if strings.Contains(r.URL.Path, "/api/slow-app/delay/") {
			parts := strings.Split(strings.TrimSuffix(r.URL.Path, "/"), "/")
			if len(parts) > 0 {
				if d, err := strconv.Atoi(parts[len(parts)-1]); err == nil {
					delayMs = d
				}
			}
		}
		if delayMs < 0 {
			delayMs = 0
		} else if delayMs > 10000 {
			delayMs = 10000
		}
		if delayMs > 0 {
			select {
			case <-ctx.Done():
				return
			case <-time.After(time.Duration(delayMs) * time.Millisecond):
			}
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"message":    "Hello from SD-WAN Light Responder",
			"delayed_ms": delayMs,
			"timestamp":  float64(time.Now().UnixNano()) / 1e9,
		})
	})

	srv := &http.Server{
		Addr:              fmt.Sprintf("0.0.0.0:%d", port),
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
	}
	go func() {
		<-ctx.Done()
		shutCtx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		_ = srv.Shutdown(shutCtx)
	}()
	fmt.Printf("[STIGIX-GO SRT] Serving SRT Light Responder on 0.0.0.0:%d\n", port)
	_ = srv.ListenAndServe()
}

func runEchoServer(ctx context.Context, portsArg string) {
	go runTargetHTTPServer(ctx)
	go runSRTResponderServer(ctx, 0)
	go ensureIperf3Server(ctx)

	var ports []int
	for _, pStr := range strings.Split(portsArg, ",") {
		if p, err := strconv.Atoi(strings.TrimSpace(pStr)); err == nil && p > 0 {
			ports = append(ports, p)
		}
	}
	if len(ports) == 0 {
		ports = []int{6100, 6200}
	}

	var mu sync.Mutex
	sessions := make(map[string]*EchoSession)

	for _, port := range ports {
		addr := &net.UDPAddr{IP: net.IPv4zero, Port: port}
		conn, err := net.ListenUDP("udp4", addr)
		if err != nil {
			fmt.Fprintf(os.Stderr, "[STIGIX-GO ECHO] Failed to bind UDP port %d: %v\n", port, err)
			continue
		}
		applySocketOptions(conn, "", 0, 4*1024*1024, 4*1024*1024)
		fmt.Printf("[STIGIX-GO ECHO] Listening on UDP 0.0.0.0:%d\n", port)

		go func(c *net.UDPConn, localPort int) {
			defer c.Close()
			buf := make([]byte, 4096)
			for {
				select {
				case <-ctx.Done():
					return
				default:
				}
				_ = c.SetReadDeadline(time.Now().Add(500 * time.Millisecond))
				n, raddr, err := c.ReadFromUDP(buf)
				if err != nil {
					continue
				}

				now := time.Now()
				nowUnix := now.Unix()
				nowFloat := float64(now.UnixNano()) / 1e9

				// Inspect first 160 bytes for tags
				headLen := n
				if headLen > 160 {
					headLen = 160
				}
				headStr := string(buf[:headLen])

				sourceSite := ""
				if m := reSite.FindStringSubmatch(headStr); len(m) > 1 {
					sourceSite = strings.TrimSpace(m[1])
				}

				callID := "UNKNOWN"
				label := "RTP Voice"
				sessionType := "Voice"

				if m := reCID.FindStringSubmatch(headStr); len(m) > 1 {
					callID = strings.TrimSpace(m[1])
					if strings.HasPrefix(callID, "TEST-") {
						label = "Quick Call"
					}
				} else if m := reConv.FindStringSubmatch(headStr); len(m) > 2 {
					callID = strings.TrimSpace(m[1])
					convLabel := strings.TrimSpace(m[2])
					if convLabel != "" {
						label = convLabel
					} else {
						label = "Convergence"
					}
					sessionType = "Convergence"
				} else if m := reTest.FindStringSubmatch(headStr); len(m) > 1 {
					callID = strings.TrimSpace(m[1])
					label = "Test Flow"
					sessionType = "Convergence"
				} else if m := reCall.FindStringSubmatch(headStr); len(m) > 1 {
					callID = strings.TrimSpace(m[1])
				} else if raddr.Port >= 30000 && raddr.Port <= 39999 {
					callID = fmt.Sprintf("CALL-%04d", raddr.Port-30000)
				} else if raddr.Port > 0 {
					callID = fmt.Sprintf("RAW-P%d", raddr.Port)
				}

				displayID := callID
				if displayID != "UNKNOWN" && !strings.HasPrefix(displayID, "CALL-") && !strings.HasPrefix(displayID, "CONV-") && !strings.HasPrefix(displayID, "TEST-") && !strings.HasPrefix(displayID, "RAW-") {
					if sessionType == "Convergence" {
						displayID = "CONV-" + displayID
					} else {
						displayID = "CALL-" + displayID
					}
				}

				sessionKey := fmt.Sprintf("%s:%d:%s", raddr.IP.String(), raddr.Port, callID)
				if sessionType == "Convergence" && callID != "UNKNOWN" {
					sessionKey = fmt.Sprintf("CONV:%s", callID)
				}

				mu.Lock()
				sess, exists := sessions[sessionKey]
				if !exists {
					sess = &EchoSession{
						ID:             displayID,
						Key:            sessionKey,
						Type:           sessionType,
						SrcIP:          raddr.IP.String(),
						SourceIP:       raddr.IP.String(),
						SrcPort:        raddr.Port,
						SourcePort:     raddr.Port,
						DestPort:       localPort,
						TargetPort:     localPort,
						CallID:         displayID,
						Label:          label,
						SrcSite:        sourceSite,
						SourceSite:     sourceSite,
						StartTime:      nowUnix,
						LastSeen:       nowUnix,
						Status:         "active",
						startTimeFloat: nowFloat,
						lastSeenFloat:  nowFloat,
					}
					sessions[sessionKey] = sess
				} else {
					sess.SrcIP = raddr.IP.String()
					sess.SourceIP = raddr.IP.String()
					sess.SrcPort = raddr.Port
					sess.SourcePort = raddr.Port
					if (sess.CallID == "UNKNOWN" || strings.HasPrefix(sess.CallID, "RAW-")) && callID != "UNKNOWN" && !strings.HasPrefix(callID, "RAW-") {
						sess.ID = displayID
						sess.CallID = displayID
						sess.Label = label
						sess.Type = sessionType
					}
					if sess.SourceSite == "" && sourceSite != "" {
						sess.SrcSite = sourceSite
						sess.SourceSite = sourceSite
					}
				}
				sess.LastSeen = nowUnix
				sess.lastSeenFloat = nowFloat
				sess.PacketCount++
				sess.TotalBytes += int64(n)
				pktCount := sess.PacketCount
				isConv := sess.Type == "Convergence"
				mu.Unlock()

				// Echo back immediately (with :S<count> suffix for Convergence)
				if isConv {
					suffix := fmt.Sprintf(":S%d", pktCount)
					out := make([]byte, n+len(suffix))
					copy(out, buf[:n])
					copy(out[n:], suffix)
					_, _ = c.WriteToUDP(out, raddr)
				} else {
					_, _ = c.WriteToUDP(buf[:n], raddr)
				}
			}
		}(conn, port)
	}

	ticker := time.NewTicker(1 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			now := time.Now()
			nowFloat := float64(now.UnixNano()) / 1e9

			mu.Lock()
			var list []EchoSession
			var activeCount int32
			for k, s := range sessions {
				idle := nowFloat - s.lastSeenFloat
				if idle > 60.0 {
					delete(sessions, k)
					continue
				}
				if idle > 5.0 {
					s.Status = "completed"
				} else {
					s.Status = "active"
					activeCount++
				}
				dur := s.lastSeenFloat - s.startTimeFloat
				if dur < 1.0 {
					dur = 1.0
				}
				s.Duration = int64(dur)
				s.DurationS = int64(dur)
				s.Pps = float64(int(float64(s.PacketCount)/dur*10)) / 10.0
				s.BitrateKbps = float64(int(float64(s.TotalBytes)*8.0/(dur*1000.0)*10)) / 10.0
				list = append(list, *s)
			}
			mu.Unlock()

			activeEchoFlows.Store(activeCount)

			sort.Slice(list, func(i, j int) bool {
				return list[i].LastSeen > list[j].LastSeen
			})
			if len(list) > 100 {
				list = list[:100]
			}
			if list == nil {
				list = []EchoSession{}
			}
			_ = writeAtomicJSON("/tmp/ingress-voice-sessions.json", list)
		}
	}
}
