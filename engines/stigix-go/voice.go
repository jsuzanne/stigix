package main

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"math"
	"math/rand"
	"net"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

type VoiceConfig struct {
	Control struct {
		Enabled              bool    `json:"enabled"`
		MaxSimultaneousCalls int     `json:"max_simultaneous_calls"`
		SleepBetweenCalls    float64 `json:"sleep_between_calls"`
		Interface            string  `json:"interface"`
		SourcePortMode       string  `json:"source_port_mode"`
	} `json:"control"`
	Servers []VoiceServerEntry `json:"servers"`
	State   struct {
		Counter int `json:"counter"`
	} `json:"state"`
}

type VoiceServerEntry struct {
	Target     string `json:"target"`
	Weight     int    `json:"weight"`
	Codec      string `json:"codec"`
	Duration   int    `json:"duration"`
	StreamType string `json:"stream_type"`
}

func resolveSiteName(configDir string) string {
	// 1. site-name.json
	if raw, err := os.ReadFile(filepath.Join(configDir, "site-name.json")); err == nil {
		var d map[string]any
		if json.Unmarshal(raw, &d) == nil {
			if v, ok := d["siteName"].(string); ok && strings.TrimSpace(v) != "" {
				return strings.TrimSpace(v)
			}
		}
	}
	// 2. STIGIX_SITE_NAME / SITE_NAME
	for _, envKey := range []string{"STIGIX_SITE_NAME", "SITE_NAME"} {
		if v := strings.TrimSpace(os.Getenv(envKey)); v != "" {
			return v
		}
	}
	// 3. site-detection.json
	if raw, err := os.ReadFile(filepath.Join(configDir, "site-detection.json")); err == nil {
		var d map[string]any
		if json.Unmarshal(raw, &d) == nil {
			for _, k := range []string{"detectedSiteName", "site_name", "siteName"} {
				if v, ok := d[k].(string); ok && strings.TrimSpace(v) != "" {
					return strings.TrimSpace(v)
				}
			}
		}
	}
	// 4. system-settings.json
	if raw, err := os.ReadFile(filepath.Join(configDir, "system-settings.json")); err == nil {
		var d map[string]any
		if json.Unmarshal(raw, &d) == nil {
			for _, k := range []string{"site_name", "siteName"} {
				if v, ok := d[k].(string); ok && strings.TrimSpace(v) != "" {
					return strings.TrimSpace(v)
				}
			}
		}
	}
	// 5. NODE_NAME
	if v := strings.TrimSpace(os.Getenv("NODE_NAME")); v != "" {
		return v
	}
	// 6. Hostname
	if h, err := os.Hostname(); err == nil && h != "" {
		return h
	}
	return "UNKNOWN"
}

func appendVoiceEvent(mu *sync.Mutex, statsFile string, evt map[string]any) {
	mu.Lock()
	defer mu.Unlock()
	f, err := os.OpenFile(statsFile, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0644)
	if err != nil {
		return
	}
	defer f.Close()
	b, err := json.Marshal(evt)
	if err != nil {
		return
	}
	_, _ = f.Write(append(b, '\n'))
}

func calculateMOS(avgRttMs, jitterMs, lossPct float64) float64 {
	effectiveLatency := avgRttMs + jitterMs*2.0 + 10.0
	var r float64
	if effectiveLatency < 160.0 {
		r = 93.2 - (effectiveLatency / 40.0)
	} else {
		r = 93.2 - ((effectiveLatency - 120.0) / 10.0)
	}
	r = r - (lossPct * 2.5)
	if r < 0 {
		return 1.0
	}
	if r > 100 {
		r = 100.0
	}
	mos := 1.0 + (0.035 * r) + (r * (r - 60.0) * (100.0 - r) * 0.000007)
	return math.Round(math.Max(1.0, math.Min(4.5, mos))*100) / 100
}

var callNumRegex = regexp.MustCompile(`(\d+)$`)

func executeRTPCall(
	ctx context.Context,
	target string,
	durationSec int,
	codec string,
	streamType string,
	callID string,
	iface string,
	sourcePortMode string,
	siteName string,
	statsFile string,
	statsMu *sync.Mutex,
) {
	activeVoiceCalls.Add(1)
	defer activeVoiceCalls.Add(-1)

	host, portStr, err := net.SplitHostPort(target)
	if err != nil {
		host = target
		portStr = "6100"
	}
	port, err := strconv.Atoi(portStr)
	if err != nil || port <= 0 {
		port = 6100
	}

	var payloadSize int
	var interval time.Duration
	var pt uint8
	var tsInc uint32

	if streamType == "video" {
		payloadSize = 1300
		interval = 10 * time.Millisecond
		pt = 96
		tsInc = 900
	} else {
		payloadSize = 160
		interval = 30 * time.Millisecond
		pt = 8
		tsInc = 160
	}

	sourcePort := 0
	if sourcePortMode == "call_id" && callID != "" {
		if m := callNumRegex.FindStringSubmatch(callID); len(m) > 1 {
			if n, err := strconv.Atoi(m[1]); err == nil {
				sourcePort = 30000 + (n % 10000)
			}
		}
	}

	raddr, err := net.ResolveUDPAddr("udp4", fmt.Sprintf("%s:%d", host, port))
	if err != nil {
		appendVoiceEvent(statsMu, statsFile, map[string]any{
			"timestamp": time.Now().Unix(),
			"call_id":   callID,
			"event":     "skipped",
			"reason":    "resolve_error",
			"target":    fmt.Sprintf("%s:%d", host, port),
		})
		return
	}

	laddr := &net.UDPAddr{IP: net.IPv4zero, Port: sourcePort}
	conn, err := net.DialUDP("udp4", laddr, raddr)
	if err != nil && sourcePort > 0 {
		// Fallback to ephemeral port if port is busy
		laddr.Port = 0
		conn, err = net.DialUDP("udp4", laddr, raddr)
	}
	if err != nil {
		appendVoiceEvent(statsMu, statsFile, map[string]any{
			"timestamp": time.Now().Unix(),
			"call_id":   callID,
			"event":     "skipped",
			"reason":    "port_busy",
			"port":      sourcePort,
			"target":    fmt.Sprintf("%s:%d", host, port),
		})
		return
	}
	defer conn.Close()

	tos := 184 // DSCP EF (46 << 2)
	if os.Getenv("DEBUG") == "true" {
		tos = 0
	}
	applySocketOptions(conn, iface, tos, 262144, 262144)

	appendVoiceEvent(statsMu, statsFile, map[string]any{
		"timestamp":   time.Now().Unix(),
		"call_id":     callID,
		"event":       "start",
		"target":      fmt.Sprintf("%s:%d", host, port),
		"codec":       codec,
		"stream_type": streamType,
		"duration":    durationSec,
	})

	ssrc := rand.Uint32()
	payload := make([]byte, payloadSize)
	_, _ = rand.Read(payload)
	if callID != "" {
		tag := []byte(fmt.Sprintf("CID:%s:SITE:%s:", callID, siteName))
		if len(tag) < len(payload) {
			copy(payload, tag)
		}
	}

	type rtpStats struct {
		mu           sync.Mutex
		sentTimes    map[uint16]time.Time
		received     int
		rtts         []float64
		jitter       float64
		lastTransit  float64
		hasLastTrans bool
	}
	st := &rtpStats{
		sentTimes: make(map[uint16]time.Time, 2048),
	}

	recvCtx, cancelRecv := context.WithCancel(ctx)
	var recvWg sync.WaitGroup
	recvWg.Add(1)
	go func() {
		defer recvWg.Done()
		buf := make([]byte, 2048)
		for {
			select {
			case <-recvCtx.Done():
				return
			default:
			}
			_ = conn.SetReadDeadline(time.Now().Add(100 * time.Millisecond))
			n, err := conn.Read(buf)
			if err != nil {
				continue
			}
			if n < 12 {
				continue
			}
			recvTime := time.Now()
			seq := binary.BigEndian.Uint16(buf[2:4])
			st.mu.Lock()
			if sendTime, ok := st.sentTimes[seq]; ok {
				rttMs := float64(recvTime.Sub(sendTime).Microseconds()) / 1000.0
				st.rtts = append(st.rtts, rttMs)
				st.received++
				transit := rttMs / 2.0
				if st.hasLastTrans {
					d := math.Abs(transit - st.lastTransit)
					st.jitter += (d - st.jitter) / 16.0
				}
				st.lastTransit = transit
				st.hasLastTrans = true
			}
			st.mu.Unlock()
		}
	}()

	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	deadline := time.Now().Add(time.Duration(durationSec) * time.Second)
	var seq uint16
	var rtpTS uint32
	sentCount := 0
	pkt := make([]byte, 12+len(payload))
	copy(pkt[12:], payload)

	for time.Now().Before(deadline) {
		select {
		case <-ctx.Done():
			goto finish
		case <-ticker.C:
			pkt[0] = 0x80
			pkt[1] = pt
			binary.BigEndian.PutUint16(pkt[2:4], seq)
			binary.BigEndian.PutUint32(pkt[4:8], rtpTS)
			binary.BigEndian.PutUint32(pkt[8:12], ssrc)

			st.mu.Lock()
			st.sentTimes[seq] = time.Now()
			st.mu.Unlock()

			if _, err := conn.Write(pkt); err == nil {
				sentCount++
				totalRTPPackets.Add(1)
			}
			seq++
			rtpTS += tsInc
		}
	}

	// Grace period to collect trailing echoes
	select {
	case <-ctx.Done():
	case <-time.After(400 * time.Millisecond):
	}

finish:
	cancelRecv()
	recvWg.Wait()

	st.mu.Lock()
	received := st.received
	var avgRtt, maxRtt float64
	if len(st.rtts) > 0 {
		sum := 0.0
		for _, v := range st.rtts {
			sum += v
			if v > maxRtt {
				maxRtt = v
			}
		}
		avgRtt = sum / float64(len(st.rtts))
	}
	jitter := st.jitter
	st.mu.Unlock()

	lossPct := 100.0
	if sentCount > 0 {
		lossPct = float64(sentCount-received) / float64(sentCount) * 100.0
		if lossPct < 0 {
			lossPct = 0
		}
	}
	mos := calculateMOS(avgRtt, jitter, lossPct)

	appendVoiceEvent(statsMu, statsFile, map[string]any{
		"timestamp":   time.Now().Unix(),
		"call_id":     callID,
		"event":       "end",
		"target":      fmt.Sprintf("%s:%d", host, port),
		"codec":       codec,
		"stream_type": streamType,
		"duration":    durationSec,
		"sent":        sentCount,
		"received":    received,
		"loss_pct":    math.Round(lossPct*100) / 100,
		"avg_rtt_ms":  math.Round(avgRtt*100) / 100,
		"max_rtt_ms":  math.Round(maxRtt*100) / 100,
		"jitter_ms":   math.Round(jitter*100) / 100,
		"mos_score":   mos,
	})
}

func runVoiceEngine(ctx context.Context, configDir, logDir string) {
	var statsMu sync.Mutex
	var cfgMu sync.Mutex
	statsFile := filepath.Join(logDir, "voice-stats.jsonl")
	cfgFile := filepath.Join(configDir, "voice-config.json")

	// Check auto_restart_voice on startup
	sysSettingsPath := filepath.Join(configDir, "system-settings.json")
	if raw, err := os.ReadFile(sysSettingsPath); err == nil {
		var s struct {
			AutoRestartVoice *bool `json:"auto_restart_voice"`
		}
		if json.Unmarshal(raw, &s) == nil && s.AutoRestartVoice != nil && !*s.AutoRestartVoice {
			if vRaw, err := os.ReadFile(cfgFile); err == nil {
				var doc map[string]any
				if json.Unmarshal(vRaw, &doc) == nil {
					if ctrl, ok := doc["control"].(map[string]any); ok {
						ctrl["enabled"] = false
						_ = writeAtomicJSONIndent(cfgFile, doc)
					}
				}
			}
		}
	}

	loadCfg := func() VoiceConfig {
		cfgMu.Lock()
		defer cfgMu.Unlock()
		var c VoiceConfig
		c.Control.MaxSimultaneousCalls = 1
		c.Control.SleepBetweenCalls = 2.0
		c.Control.Interface = "auto"
		c.Control.SourcePortMode = "call_id"
		if raw, err := os.ReadFile(cfgFile); err == nil {
			_ = json.Unmarshal(raw, &c)
		}
		if c.Control.MaxSimultaneousCalls < 1 {
			c.Control.MaxSimultaneousCalls = 1
		}
		if c.Control.SleepBetweenCalls < 0.2 {
			c.Control.SleepBetweenCalls = 0.2
		}
		return c
	}

	nextCallID := func() string {
		cfgMu.Lock()
		defer cfgMu.Unlock()
		var doc map[string]any
		if raw, err := os.ReadFile(cfgFile); err == nil {
			_ = json.Unmarshal(raw, &doc)
		}
		if doc == nil {
			doc = make(map[string]any)
		}
		stateMap, ok := doc["state"].(map[string]any)
		if !ok {
			stateMap = make(map[string]any)
			doc["state"] = stateMap
		}
		counter := 0
		if v, ok := stateMap["counter"].(float64); ok {
			counter = int(v)
		}
		next := (counter + 1) % 10000
		stateMap["counter"] = next
		_ = writeAtomicJSONIndent(cfgFile, doc)
		return fmt.Sprintf("CALL-%04d", next)
	}

	wasEnabled := false
	for {
		select {
		case <-ctx.Done():
			return
		default:
		}

		cfg := loadCfg()
		if !cfg.Control.Enabled || len(cfg.Servers) == 0 {
			wasEnabled = false
			time.Sleep(1 * time.Second)
			continue
		}

		if !wasEnabled {
			appendVoiceEvent(&statsMu, statsFile, map[string]any{
				"timestamp": time.Now().Unix(),
				"event":     "session_start",
				"engine":    "stigix-go",
			})
			wasEnabled = true
		}

		if int(activeVoiceCalls.Load()) < cfg.Control.MaxSimultaneousCalls {
			// Weighted server choice
			totalW := 0
			for _, s := range cfg.Servers {
				w := s.Weight
				if w <= 0 {
					w = 1
				}
				totalW += w
			}
			var chosen VoiceServerEntry
			if totalW > 0 {
				r := rand.Intn(totalW)
				acc := 0
				for _, s := range cfg.Servers {
					w := s.Weight
					if w <= 0 {
						w = 1
					}
					acc += w
					if r < acc {
						chosen = s
						break
					}
				}
			} else {
				chosen = cfg.Servers[0]
			}

			if chosen.Target != "" {
				callID := nextCallID()
				dur := chosen.Duration
				if dur <= 0 {
					dur = 20
				}
				codec := chosen.Codec
				if codec == "" {
					codec = "G.711"
				}
				stType := chosen.StreamType
				if stType == "" {
					stType = "audio"
				}
				siteName := resolveSiteName(configDir)
				go executeRTPCall(
					ctx,
					chosen.Target,
					dur,
					codec,
					stType,
					callID,
					cfg.Control.Interface,
					cfg.Control.SourcePortMode,
					siteName,
					statsFile,
					&statsMu,
				)
			}
		}

		sleepDur := time.Duration(cfg.Control.SleepBetweenCalls * float64(time.Second))
		select {
		case <-ctx.Done():
			return
		case <-time.After(sleepDur):
		}
	}
}
