package main

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"math/rand"
	"net"
	"net/http"
	"net/http/httptrace"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

type AppConfigFile struct {
	Control struct {
		Enabled       bool    `json:"enabled"`
		ClientCount   int     `json:"client_count"`
		SleepInterval float64 `json:"sleep_interval"`
	} `json:"control"`
	Applications []AppEntry `json:"applications"`
}

type AppEntry struct {
	Name     string `json:"name"`
	Domain   string `json:"domain"`
	Weight   int    `json:"weight"`
	Endpoint string `json:"endpoint"`
	Enabled  *bool  `json:"enabled,omitempty"`
}

type AppTelemetry struct {
	RttMs    float64 `json:"rtt_ms"`
	TtfbMs   float64 `json:"ttfb_ms"`
	DnsMs    float64 `json:"dns_ms"`
	TcpMs    float64 `json:"tcp_ms"`
	TlsMs    float64 `json:"tls_ms"`
	LastCode string  `json:"last_code"`
}

type WorkerStatsFile struct {
	Timestamp      int64                   `json:"timestamp"`
	ClientID       string                  `json:"client_id"`
	TotalRequests  int64                   `json:"total_requests"`
	RequestsByApp  map[string]int64        `json:"requests_by_app"`
	ErrorsByApp    map[string]int64        `json:"errors_by_app"`
	TelemetryByApp map[string]AppTelemetry `json:"telemetry_by_app"`
}

var defaultUserAgents = []string{
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 14_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15",
	"Mozilla/5.0 (X11; Linux x86_64; rv:123.0) Gecko/20100101 Firefox/123.0",
}

func loadUserAgents(configDir string) []string {
	path := filepath.Join(configDir, "user_agents.txt")
	data, err := os.ReadFile(path)
	if err != nil {
		return defaultUserAgents
	}
	var out []string
	for _, line := range strings.Split(string(data), "\n") {
		line = strings.TrimSpace(line)
		if line != "" && !strings.HasPrefix(line, "#") {
			out = append(out, line)
		}
	}
	if len(out) == 0 {
		return defaultUserAgents
	}
	return out
}

func loadInterfaces(configDir string) []string {
	path := filepath.Join(configDir, "interfaces.txt")
	data, err := os.ReadFile(path)
	if err == nil {
		var out []string
		for _, line := range strings.Split(string(data), "\n") {
			line = strings.TrimSpace(line)
			if line != "" && !strings.HasPrefix(line, "#") {
				out = append(out, line)
			}
		}
		if len(out) > 0 {
			return out
		}
	}
	return []string{"eth0"}
}

func loadApplicationsConfig(configDir string) AppConfigFile {
	var cfg AppConfigFile
	cfg.Control.Enabled = false
	cfg.Control.ClientCount = 1
	cfg.Control.SleepInterval = 1.0

	path := filepath.Join(configDir, "applications-config.json")
	data, err := os.ReadFile(path)
	if err != nil {
		return cfg
	}
	_ = json.Unmarshal(data, &cfg)
	if cfg.Control.ClientCount < 1 {
		cfg.Control.ClientCount = 1
	}
	if cfg.Control.ClientCount > 64 {
		cfg.Control.ClientCount = 64
	}
	if cfg.Control.SleepInterval <= 0 {
		cfg.Control.SleepInterval = 1.0
	}
	return cfg
}

func pickWeightedApp(apps []AppEntry) *AppEntry {
	var active []AppEntry
	totalWeight := 0
	for _, a := range apps {
		if a.Domain == "" {
			continue
		}
		if a.Enabled != nil && !*a.Enabled {
			continue
		}
		w := a.Weight
		if w <= 0 {
			w = 1
		}
		a.Weight = w
		active = append(active, a)
		totalWeight += w
	}
	if len(active) == 0 || totalWeight <= 0 {
		return nil
	}
	r := rand.Intn(totalWeight)
	acc := 0
	for i := range active {
		acc += active[i].Weight
		if r < acc {
			return &active[i]
		}
	}
	return &active[0]
}

func appendTrafficLog(logMu *sync.Mutex, logFile string, level, msg string) {
	logMu.Lock()
	defer logMu.Unlock()
	f, err := os.OpenFile(logFile, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0644)
	if err != nil {
		return
	}
	defer f.Close()
	ts := time.Now().Format("2006-01-02 15:04:05")
	_, _ = fmt.Fprintf(f, "[%s] [%s] %s\n", ts, level, msg)
}

func round1(v float64) float64 {
	return math.Round(v*10) / 10
}

func ema(prev, curr float64) float64 {
	if prev <= 0 {
		return round1(curr)
	}
	return round1(0.7*prev + 0.3*curr)
}

func doTracedRequest(ctx context.Context, client *http.Client, urlStr string, ua string) (int, AppTelemetry, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, urlStr, nil)
	if err != nil {
		return 0, AppTelemetry{LastCode: "000"}, err
	}
	req.Header.Set("User-Agent", ua)
	req.Header.Set("Accept", "*/*")

	var (
		start              = time.Now()
		dnsStart, dnsEnd   time.Time
		tcpStart, tcpEnd   time.Time
		tlsStart, tlsEnd   time.Time
		firstByteTime      time.Time
	)

	trace := &httptrace.ClientTrace{
		DNSStart: func(_ httptrace.DNSStartInfo) { dnsStart = time.Now() },
		DNSDone:  func(_ httptrace.DNSDoneInfo) { dnsEnd = time.Now() },
		ConnectStart: func(_, _ string) {
			if tcpStart.IsZero() {
				tcpStart = time.Now()
			}
		},
		ConnectDone: func(_, _ string, _ error) {
			if tcpEnd.IsZero() {
				tcpEnd = time.Now()
			}
		},
		TLSHandshakeStart: func() { tlsStart = time.Now() },
		TLSHandshakeDone:  func(_ tls.ConnectionState, _ error) { tlsEnd = time.Now() },
		GotFirstResponseByte: func() {
			if firstByteTime.IsZero() {
				firstByteTime = time.Now()
			}
		},
	}

	req = req.WithContext(httptrace.WithClientTrace(req.Context(), trace))
	resp, err := client.Do(req)
	totalDur := time.Since(start)
	if err != nil {
		return 0, AppTelemetry{
			RttMs:    round1(float64(totalDur.Microseconds()) / 1000.0),
			LastCode: "000",
		}, err
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 64*1024))
	totalDur = time.Since(start)

	var dnsMs, tcpMs, tlsMs, ttfbMs float64
	if !dnsStart.IsZero() && !dnsEnd.IsZero() {
		dnsMs = float64(dnsEnd.Sub(dnsStart).Microseconds()) / 1000.0
	}
	if !tcpStart.IsZero() && !tcpEnd.IsZero() {
		tcpMs = float64(tcpEnd.Sub(tcpStart).Microseconds()) / 1000.0
	}
	if !tlsStart.IsZero() && !tlsEnd.IsZero() {
		tlsMs = float64(tlsEnd.Sub(tlsStart).Microseconds()) / 1000.0
	}
	if !firstByteTime.IsZero() {
		ttfbMs = float64(firstByteTime.Sub(start).Microseconds()) / 1000.0
	} else {
		ttfbMs = float64(totalDur.Microseconds()) / 1000.0
	}
	rttMs := tcpMs
	if rttMs <= 0 {
		rttMs = ttfbMs
	}

	return resp.StatusCode, AppTelemetry{
		RttMs:    round1(rttMs),
		TtfbMs:   round1(ttfbMs),
		DnsMs:    round1(dnsMs),
		TcpMs:    round1(tcpMs),
		TlsMs:    round1(tlsMs),
		LastCode: fmt.Sprintf("%d", resp.StatusCode),
	}, nil
}

func runTrafficWorker(ctx context.Context, workerIdx int, configDir, logDir string, logMu *sync.Mutex) {
	activeHTTPWorkers.Add(1)
	defer activeHTTPWorkers.Add(-1)

	clientID := fmt.Sprintf("client-%02d", workerIdx)
	statsPath := filepath.Join(logDir, fmt.Sprintf("stats-%s.json", clientID))
	trafficLog := filepath.Join(logDir, "traffic.log")

	stats := WorkerStatsFile{
		Timestamp:      time.Now().Unix(),
		ClientID:       clientID,
		TotalRequests:  0,
		RequestsByApp:  make(map[string]int64),
		ErrorsByApp:    make(map[string]int64),
		TelemetryByApp: make(map[string]AppTelemetry),
	}

	// Pre-load existing stats file if present so hot-switching preserves counters
	if existingData, err := os.ReadFile(statsPath); err == nil {
		_ = json.Unmarshal(existingData, &stats)
		if stats.RequestsByApp == nil {
			stats.RequestsByApp = make(map[string]int64)
		}
		if stats.ErrorsByApp == nil {
			stats.ErrorsByApp = make(map[string]int64)
		}
		if stats.TelemetryByApp == nil {
			stats.TelemetryByApp = make(map[string]AppTelemetry)
		}
		stats.ClientID = clientID
	}

	transport := &http.Transport{
		Proxy: http.ProxyFromEnvironment,
		DialContext: (&net.Dialer{
			Timeout:   8 * time.Second,
			KeepAlive: 15 * time.Second,
		}).DialContext,
		TLSClientConfig:       &tls.Config{InsecureSkipVerify: true},
		MaxIdleConns:          32,
		IdleConnTimeout:       30 * time.Second,
		TLSHandshakeTimeout:   8 * time.Second,
		ExpectContinueTimeout: 1 * time.Second,
		DisableKeepAlives:     true, // Match curl per-request TCP/TLS measurement
	}
	client := &http.Client{
		Transport: transport,
		Timeout:   12 * time.Second,
	}

	for {
		select {
		case <-ctx.Done():
			return
		default:
		}

		// Check reset signal (.reset_stats)
		resetFile := filepath.Join(logDir, ".reset_stats")
		if _, err := os.Stat(resetFile); err == nil {
			stats.TotalRequests = 0
			stats.RequestsByApp = make(map[string]int64)
			stats.ErrorsByApp = make(map[string]int64)
			stats.TelemetryByApp = make(map[string]AppTelemetry)
			_ = os.Remove(resetFile)
			appendTrafficLog(logMu, trafficLog, "INFO", fmt.Sprintf("[%s/go] Resetting traffic statistics", clientID))
		}

		cfg := loadApplicationsConfig(configDir)
		if !cfg.Control.Enabled {
			time.Sleep(1 * time.Second)
			continue
		}

		app := pickWeightedApp(cfg.Applications)
		if app == nil {
			time.Sleep(2 * time.Second)
			continue
		}

		uas := loadUserAgents(configDir)
		ifaces := loadInterfaces(configDir)
		ua := uas[rand.Intn(len(uas))]
		iface := ifaces[rand.Intn(len(ifaces))]

		domain := strings.TrimPrefix(strings.TrimPrefix(app.Domain, "https://"), "http://")
		endpoint := app.Endpoint
		if endpoint == "" {
			endpoint = "/"
		} else if !strings.HasPrefix(endpoint, "/") {
			endpoint = "/" + endpoint
		}
		targetURL := fmt.Sprintf("https://%s%s", domain, endpoint)

		reqCtx, cancel := context.WithTimeout(ctx, 12*time.Second)
		code, tData, err := doTracedRequest(reqCtx, client, targetURL, ua)
		cancel()

		stats.TotalRequests++
		totalHTTPReqs.Add(1)
		stats.RequestsByApp[domain]++

		prev := stats.TelemetryByApp[domain]
		smoothed := AppTelemetry{
			RttMs:    ema(prev.RttMs, tData.RttMs),
			TtfbMs:   ema(prev.TtfbMs, tData.TtfbMs),
			DnsMs:    ema(prev.DnsMs, tData.DnsMs),
			TcpMs:    ema(prev.TcpMs, tData.TcpMs),
			TlsMs:    ema(prev.TlsMs, tData.TlsMs),
			LastCode: tData.LastCode,
		}
		stats.TelemetryByApp[domain] = smoothed

		if err != nil || code == 0 {
			stats.ErrorsByApp[domain]++
			appendTrafficLog(logMu, trafficLog, "WARN",
				fmt.Sprintf("[%s] [%s] FAIL %s via %s (HTTP %s, TTFB %.1fms)", clientID, domain, targetURL, iface, tData.LastCode, tData.TtfbMs))
		} else {
			appendTrafficLog(logMu, trafficLog, "INFO",
				fmt.Sprintf("[%s] [%s] OK %s via %s (HTTP %d, RTT %.1fms, TTFB %.1fms, DNS %.1fms)",
					clientID, domain, targetURL, iface, code, tData.RttMs, tData.TtfbMs, tData.DnsMs))
		}

		stats.Timestamp = time.Now().Unix()
		_ = writeAtomicJSONIndent(statsPath, stats)

		sleepDur := time.Duration(cfg.Control.SleepInterval * float64(time.Second))
		if sleepDur < 50*time.Millisecond {
			sleepDur = 50 * time.Millisecond
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(sleepDur):
		}
	}
}

func runTrafficEngine(ctx context.Context, configDir, logDir string) {
	var logMu sync.Mutex
	trafficLog := filepath.Join(logDir, "traffic.log")

	// Check auto_restart_traffic on startup
	sysSettingsPath := filepath.Join(configDir, "system-settings.json")
	if raw, err := os.ReadFile(sysSettingsPath); err == nil {
		var s struct {
			AutoRestartTraffic *bool `json:"auto_restart_traffic"`
		}
		if json.Unmarshal(raw, &s) == nil && s.AutoRestartTraffic != nil && !*s.AutoRestartTraffic {
			appCfgPath := filepath.Join(configDir, "applications-config.json")
			if appRaw, err := os.ReadFile(appCfgPath); err == nil {
				var doc map[string]any
				if json.Unmarshal(appRaw, &doc) == nil {
					if ctrl, ok := doc["control"].(map[string]any); ok {
						ctrl["enabled"] = false
						_ = writeAtomicJSONIndent(appCfgPath, doc)
					}
				}
			}
		}
	}

	appendTrafficLog(&logMu, trafficLog, "INFO", "[stigix-go] Native Go HTTP/S Traffic Engine initialized")

	workers := make(map[int]context.CancelFunc)
	defer func() {
		for _, c := range workers {
			c()
		}
	}()

	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()

	syncWorkers := func() {
		cfg := loadApplicationsConfig(configDir)
		desired := 0
		if cfg.Control.Enabled {
			desired = cfg.Control.ClientCount
		}
		// Start missing workers
		for i := 1; i <= desired; i++ {
			if _, exists := workers[i]; !exists {
				wCtx, wCancel := context.WithCancel(ctx)
				workers[i] = wCancel
				go runTrafficWorker(wCtx, i, configDir, logDir, &logMu)
			}
		}
		// Stop excess workers
		for i, c := range workers {
			if i > desired {
				c()
				delete(workers, i)
			}
		}
	}

	syncWorkers()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			syncWorkers()
		}
	}
}
