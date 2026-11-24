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
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"time"
)

type AppConfigFile struct {
	Control struct {
		Enabled         bool    `json:"enabled"`
		ClientCount     int     `json:"client_count"`
		SleepInterval   float64 `json:"sleep_interval"`
		IgnoreTLSErrors bool    `json:"ignore_tls_errors,omitempty"`
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

type IfaceAppTelemetry struct {
	Requests int64  `json:"requests"`
	Errors   int64  `json:"errors"`
	LastCode string `json:"last_code"`
	SourceIP string `json:"source_ip,omitempty"`
}

type AppTelemetry struct {
	RttMs     float64                      `json:"rtt_ms"`
	TtfbMs    float64                      `json:"ttfb_ms"`
	DnsMs     float64                      `json:"dns_ms"`
	TcpMs     float64                      `json:"tcp_ms"`
	TlsMs     float64                      `json:"tls_ms"`
	LastCode  string                       `json:"last_code"`
	LastIface string                       `json:"last_iface,omitempty"`
	ByIface   map[string]IfaceAppTelemetry `json:"by_iface,omitempty"`
}

type WorkerStatsFile struct {
	Timestamp       int64                   `json:"timestamp"`
	ClientID        string                  `json:"client_id"`
	TotalRequests   int64                   `json:"total_requests"`
	RequestsByApp   map[string]int64        `json:"requests_by_app"`
	ErrorsByApp     map[string]int64        `json:"errors_by_app"`
	RequestsByIface map[string]int64        `json:"requests_by_iface,omitempty"`
	ErrorsByIface   map[string]int64        `json:"errors_by_iface,omitempty"`
	TelemetryByApp  map[string]AppTelemetry `json:"telemetry_by_app"`
}

type netInterfaceInfo struct {
	Name    string
	Flags   net.Flags
	HasIPv4 bool
	IPv4    string
}

var (
	rrInterfaceCounter atomic.Uint64
	listNetInterfaces  = defaultListNetInterfaces
)

func defaultListNetInterfaces() ([]netInterfaceInfo, error) {
	sysIfaces, err := net.Interfaces()
	if err != nil {
		return nil, err
	}
	out := make([]netInterfaceInfo, 0, len(sysIfaces))
	for _, sif := range sysIfaces {
		info := netInterfaceInfo{
			Name:  sif.Name,
			Flags: sif.Flags,
		}
		if addrs, err := sif.Addrs(); err == nil {
			for _, a := range addrs {
				var ip net.IP
				switch v := a.(type) {
				case *net.IPNet:
					ip = v.IP
				case *net.IPAddr:
					ip = v.IP
				}
				if ip != nil {
					if v4 := ip.To4(); v4 != nil && !v4.IsLoopback() {
						info.HasIPv4 = true
						if info.IPv4 == "" {
							info.IPv4 = v4.String()
						}
					}
				}
			}
		}
		out = append(out, info)
	}
	return out, nil
}

func getInterfaceIPv4(ifaceName string) string {
	if ifaceName == "" {
		return ""
	}
	ifaces, err := listNetInterfaces()
	if err != nil {
		return ""
	}
	for _, info := range ifaces {
		if info.Name == ifaceName && info.IPv4 != "" {
			return info.IPv4
		}
	}
	return ""
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

func parseInterfacePatterns(raw string) []string {
	var patterns []string
	for _, line := range strings.Split(raw, "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		for _, token := range strings.Split(line, ",") {
			token = strings.TrimSpace(token)
			if token != "" && !strings.HasPrefix(token, "#") {
				patterns = append(patterns, token)
			}
		}
	}
	return patterns
}

func resolvePatternsToInterfaces(patterns []string) (ifaces []string, isWildcard bool) {
	if len(patterns) == 0 {
		return []string{"eth0"}, false
	}

	var sysIfaces []netInterfaceInfo
	var sysLoaded bool
	seen := make(map[string]bool)

	for _, pat := range patterns {
		if strings.Contains(pat, "*") {
			isWildcard = true
			if !sysLoaded {
				sysIfaces, _ = listNetInterfaces()
				sysLoaded = true
			}
			var matchedNames []string
			prefix := strings.TrimSuffix(pat, "*")
			for _, sif := range sysIfaces {
				if sif.Flags&net.FlagUp == 0 || !sif.HasIPv4 {
					continue
				}
				matched, err := filepath.Match(pat, sif.Name)
				if (err == nil && matched) || (prefix != "" && strings.HasPrefix(sif.Name, prefix)) {
					matchedNames = append(matchedNames, sif.Name)
				}
			}
			sort.Strings(matchedNames)
			for _, name := range matchedNames {
				if !seen[name] {
					seen[name] = true
					ifaces = append(ifaces, name)
				}
			}
		} else {
			if !seen[pat] {
				seen[pat] = true
				ifaces = append(ifaces, pat)
			}
		}
	}

	if isWildcard {
		// Anti-leak rule: when wildcard mode is configured (e.g. uesimtun*), never fallback to eth0 if 0 tunnels are UP
		if ifaces == nil {
			ifaces = []string{}
		}
		return ifaces, true
	}

	if len(ifaces) == 0 {
		return []string{"eth0"}, false
	}
	return ifaces, false
}

// resolveTrafficInterfaces reads STIGIX_INTERFACES or config/interfaces.txt, supporting exact names and wildcards (e.g. uesimtun*).
func resolveTrafficInterfaces(configDir string) (ifaces []string, isWildcard bool) {
	if envVal := strings.TrimSpace(os.Getenv("STIGIX_INTERFACES")); envVal != "" {
		patterns := parseInterfacePatterns(envVal)
		if len(patterns) > 0 {
			return resolvePatternsToInterfaces(patterns)
		}
	}

	path := filepath.Join(configDir, "interfaces.txt")
	if data, err := os.ReadFile(path); err == nil {
		patterns := parseInterfacePatterns(string(data))
		if len(patterns) > 0 {
			return resolvePatternsToInterfaces(patterns)
		}
	}

	return []string{"eth0"}, false
}

// pickNextInterface selects the next active interface in atomic Round-Robin order.
func pickNextInterface(configDir string) (iface string, ok bool) {
	ifaces, _ := resolveTrafficInterfaces(configDir)
	if len(ifaces) == 0 {
		return "", false
	}
	idx := (rrInterfaceCounter.Add(1) - 1) % uint64(len(ifaces))
	return ifaces[idx], true
}

// pickNextInterfaceForPattern resolves either a specific wildcard/interface override or falls back to configDir interfaces.txt in Round-Robin.
func pickNextInterfaceForPattern(configDir string, ifaceOrPattern string) (iface string, isWildcard bool, ok bool) {
	trimmed := strings.TrimSpace(ifaceOrPattern)
	if trimmed == "" || trimmed == "auto" || trimmed == "default" {
		ifaces, wildcard := resolveTrafficInterfaces(configDir)
		if len(ifaces) == 0 {
			return "", wildcard, false
		}
		idx := (rrInterfaceCounter.Add(1) - 1) % uint64(len(ifaces))
		return ifaces[idx], wildcard, true
	}
	if strings.Contains(trimmed, "*") || strings.Contains(trimmed, ",") {
		patterns := parseInterfacePatterns(trimmed)
		ifaces, wildcard := resolvePatternsToInterfaces(patterns)
		if len(ifaces) == 0 {
			return "", wildcard, false
		}
		idx := (rrInterfaceCounter.Add(1) - 1) % uint64(len(ifaces))
		return ifaces[idx], wildcard, true
	}
	return trimmed, false, true
}

func loadInterfaces(configDir string) []string {
	ifaces, _ := resolveTrafficInterfaces(configDir)
	return ifaces
}

func newBoundResolver(iface string) *net.Resolver {
	boundIface := iface
	return &net.Resolver{
		PreferGo: true,
		Dial: func(ctx context.Context, network, address string) (net.Conn, error) {
			targetAddr := address
			if host, port, err := net.SplitHostPort(address); err == nil {
				if ip := net.ParseIP(host); ip != nil && ip.IsLoopback() {
					// On systemd-resolved hosts (/etc/resolv.conf -> 127.0.0.53) with network_mode: host,
					// a socket bound to a non-loopback device (e.g. uesimtun0 via SO_BINDTODEVICE) cannot
					// reach 127.0.0.53 on lo, and tunnel DNS queries must traverse the bound tunnel.
					dnsHost := strings.TrimSpace(os.Getenv("STIGIX_TUNNEL_DNS"))
					if dnsHost == "" {
						dnsHost = "8.8.8.8"
					}
					if strings.Contains(dnsHost, ":") {
						targetAddr = dnsHost
					} else {
						if port == "" {
							port = "53"
						}
						targetAddr = net.JoinHostPort(dnsHost, port)
					}
				}
			}
			d := net.Dialer{
				Timeout: 5 * time.Second,
				Control: func(network, address string, c syscall.RawConn) error {
					_ = c.Control(func(fd uintptr) {
						bindToDevice(int(fd), boundIface)
					})
					return nil
				},
			}
			return d.DialContext(ctx, network, targetAddr)
		},
	}
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
		start            = time.Now()
		dnsStart, dnsEnd time.Time
		tcpStart, tcpEnd time.Time
		tlsStart, tlsEnd time.Time
		firstByteTime    time.Time
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
		var dnsMs float64
		if !dnsStart.IsZero() && !dnsEnd.IsZero() {
			dnsMs = float64(dnsEnd.Sub(dnsStart).Microseconds()) / 1000.0
		}
		return 0, AppTelemetry{
			RttMs:    round1(float64(totalDur.Microseconds()) / 1000.0),
			DnsMs:    round1(dnsMs),
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

func buildTrafficTLSConfig(ignoreTLSErrors bool) *tls.Config {
	return &tls.Config{
		InsecureSkipVerify: ignoreTLSErrors,
		RootCAs:            getProbeRootCAs(),
	}
}

func runTrafficWorker(ctx context.Context, workerIdx int, configDir, logDir string, logMu *sync.Mutex) {
	activeHTTPWorkers.Add(1)
	defer activeHTTPWorkers.Add(-1)

	clientID := fmt.Sprintf("client-%02d", workerIdx)
	statsPath := filepath.Join(logDir, fmt.Sprintf("stats-%s.json", clientID))
	trafficLog := filepath.Join(logDir, "traffic.log")

	stats := WorkerStatsFile{
		Timestamp:       time.Now().Unix(),
		ClientID:        clientID,
		TotalRequests:   0,
		RequestsByApp:   make(map[string]int64),
		ErrorsByApp:     make(map[string]int64),
		RequestsByIface: make(map[string]int64),
		ErrorsByIface:   make(map[string]int64),
		TelemetryByApp:  make(map[string]AppTelemetry),
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
		if stats.RequestsByIface == nil {
			stats.RequestsByIface = make(map[string]int64)
		}
		if stats.ErrorsByIface == nil {
			stats.ErrorsByIface = make(map[string]int64)
		}
		if stats.TelemetryByApp == nil {
			stats.TelemetryByApp = make(map[string]AppTelemetry)
		}
		stats.ClientID = clientID
	}

	clientsByIface := make(map[string]*http.Client)
	getClientForInterface := func(iface string, isWildcard bool, totalIfaces int, ignoreTLSErrors bool) *http.Client {
		shouldBind := isWildcard || totalIfaces > 1 || (iface != "" && iface != "eth0" && iface != "auto" && iface != "default")
		useBoundDNS := strings.HasPrefix(iface, "uesimtun") || isWildcard || shouldBind
		cacheKey := fmt.Sprintf("%s|bind=%v|dns=%v|insecure=%v", iface, shouldBind, useBoundDNS, ignoreTLSErrors)
		currentRootCAs := getProbeRootCAs()
		if c, exists := clientsByIface[cacheKey]; exists {
			if tr, ok := c.Transport.(*http.Transport); ok && tr.TLSClientConfig != nil && tr.TLSClientConfig.RootCAs == currentRootCAs {
				return c
			}
		}

		dialer := &net.Dialer{
			Timeout:   8 * time.Second,
			KeepAlive: 15 * time.Second,
		}
		if shouldBind {
			boundIface := iface
			dialer.Control = func(network, address string, c syscall.RawConn) error {
				_ = c.Control(func(fd uintptr) {
					bindToDevice(int(fd), boundIface)
				})
				return nil
			}
		}
		if useBoundDNS {
			dialer.Resolver = newBoundResolver(iface)
		}

		transport := &http.Transport{
			Proxy:                 http.ProxyFromEnvironment,
			DialContext:           dialer.DialContext,
			TLSClientConfig:       buildTrafficTLSConfig(ignoreTLSErrors),
			MaxIdleConns:          32,
			IdleConnTimeout:       30 * time.Second,
			TLSHandshakeTimeout:   8 * time.Second,
			ExpectContinueTimeout: 1 * time.Second,
			DisableKeepAlives:     true, // Match curl per-request TCP/TLS measurement
		}
		c := &http.Client{
			Transport: transport,
			Timeout:   12 * time.Second,
		}
		clientsByIface[cacheKey] = c
		return c
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
			stats.RequestsByIface = make(map[string]int64)
			stats.ErrorsByIface = make(map[string]int64)
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

		ifaces, isWildcard := resolveTrafficInterfaces(configDir)
		if len(ifaces) == 0 {
			// Anti-leak wait when wildcard mode (e.g. uesimtun*) has 0 active tunnels UP
			time.Sleep(2 * time.Second)
			continue
		}
		iface, ok := pickNextInterface(configDir)
		if !ok || iface == "" {
			time.Sleep(2 * time.Second)
			continue
		}

		uas := loadUserAgents(configDir)
		ua := uas[rand.Intn(len(uas))]
		client := getClientForInterface(iface, isWildcard, len(ifaces), cfg.Control.IgnoreTLSErrors)

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
		stats.RequestsByIface[iface]++

		isErr := err != nil || code == 0
		srcIP := getInterfaceIPv4(iface)

		prev := stats.TelemetryByApp[domain]
		byIface := prev.ByIface
		if byIface == nil {
			byIface = make(map[string]IfaceAppTelemetry)
		}
		ifStat := byIface[iface]
		ifStat.Requests++
		if isErr {
			ifStat.Errors++
		}
		ifStat.LastCode = tData.LastCode
		if srcIP != "" {
			ifStat.SourceIP = srcIP
		}
		byIface[iface] = ifStat

		smoothed := AppTelemetry{
			RttMs:     ema(prev.RttMs, tData.RttMs),
			TtfbMs:    ema(prev.TtfbMs, tData.TtfbMs),
			DnsMs:     ema(prev.DnsMs, tData.DnsMs),
			TcpMs:     ema(prev.TcpMs, tData.TcpMs),
			TlsMs:     ema(prev.TlsMs, tData.TlsMs),
			LastCode:  tData.LastCode,
			LastIface: iface,
			ByIface:   byIface,
		}
		stats.TelemetryByApp[domain] = smoothed

		viaLabel := iface
		if srcIP != "" && (isWildcard || len(ifaces) > 1 || strings.HasPrefix(iface, "uesimtun")) {
			viaLabel = fmt.Sprintf("%s (%s)", iface, srcIP)
		}

		if isErr {
			stats.ErrorsByApp[domain]++
			stats.ErrorsByIface[iface]++
			errDetail := ""
			if err != nil {
				errDetail = fmt.Sprintf(", err=%v", err)
			}
			appendTrafficLog(logMu, trafficLog, "WARN",
				fmt.Sprintf("[%s] [%s] FAIL %s via %s (HTTP %s, TTFB %.1fms%s)", clientID, domain, targetURL, viaLabel, tData.LastCode, tData.TtfbMs, errDetail))
		} else {
			appendTrafficLog(logMu, trafficLog, "INFO",
				fmt.Sprintf("[%s] [%s] OK %s via %s (HTTP %d, RTT %.1fms, TTFB %.1fms, DNS %.1fms)",
					clientID, domain, targetURL, viaLabel, code, tData.RttMs, tData.TtfbMs, tData.DnsMs))
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
