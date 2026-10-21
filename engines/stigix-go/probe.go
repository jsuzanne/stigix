package main

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/binary"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"math/rand"
	"mime/multipart"
	"net"
	"net/http"
	"net/http/httptrace"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"time"
)

const eicarPayload = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*"

type ProbeMetrics struct {
	DNSMS     float64 `json:"dns_ms"`
	TCPMS     float64 `json:"tcp_ms"`
	TLSMS     float64 `json:"tls_ms"`
	TTFBMS    float64 `json:"ttfb_ms"`
	TotalMS   float64 `json:"total_ms"`
	SizeBytes int64   `json:"size_bytes"`
	SpeedBps  float64 `json:"speed_bps"`
	SSLVerify int     `json:"ssl_verify"`
}

type ProbeOutput struct {
	Reachable          bool         `json:"reachable"`
	HTTPCode           int          `json:"http_code,omitempty"`
	HTTPStatus         int          `json:"http_status,omitempty"`
	RemoteIP           string       `json:"remote_ip,omitempty"`
	RemotePort         int          `json:"remote_port,omitempty"`
	LocalPort          int          `json:"local_port,omitempty"`
	SourcePort         int          `json:"source_port,omitempty"`
	SizeBytes          int64        `json:"size_bytes,omitempty"`
	LatencyMS          float64      `json:"latency_ms,omitempty"`
	Retries            int          `json:"retries"`
	CurlExitCode       int          `json:"curl_exit_code"`
	Error              string       `json:"error,omitempty"`
	Metrics            ProbeMetrics `json:"metrics"`
	Body               string       `json:"body,omitempty"`
	BodySnippet        string       `json:"body_snippet,omitempty"`
	ContentMatchResult string       `json:"content_match_result,omitempty"`
	ContentMatchOK     *bool        `json:"content_match_ok,omitempty"`
	DNSIPs             []string     `json:"dns_ips,omitempty"`
	DNSRecords         []string     `json:"dns_records,omitempty"`
	ResolvedIP         string       `json:"resolved_ip,omitempty"`
	DNSRCode           int          `json:"dns_rcode,omitempty"`
}

type headerFlags []string

func (h *headerFlags) String() string { return strings.Join(*h, ", ") }
func (h *headerFlags) Set(val string) error {
	*h = append(*h, val)
	return nil
}

func executeProbeArgs(args []string) ProbeOutput {
	fs := flag.NewFlagSet("probe", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	probeType := fs.String("type", "http", "Probe type: http, https, ping, tcp, dns")
	target := fs.String("target", "", "Target URL, IP, IP:Port, or DNS server")
	domain := fs.String("domain", "google.com", "Domain to query for DNS probe")
	iface := fs.String("interface", "", "Source network interface to bind")
	localPort := fs.Int("local-port", 0, "Deterministic local source port")
	timeoutMS := fs.Int("timeout-ms", 5000, "Total probe timeout in ms")
	connectTimeoutMS := fs.Int("connect-timeout-ms", 3000, "Connect timeout in ms")
	retries := fs.Int("retries", 0, "Number of retries on transient failure")
	retryDelayMS := fs.Int("retry-delay-ms", 1000, "Delay between retries in ms")
	method := fs.String("method", "GET", "HTTP method")
	data := fs.String("data", "", "HTTP request body")
	formFile := fs.String("form-file", "", "Multipart file upload spec: field=@path;type=mime;filename=name")
	followRedirects := fs.Bool("follow-redirects", true, "Follow HTTP 3xx redirects")
	insecureTLS := fs.Bool("insecure", false, "Skip TLS verification (-k)")
	includeBody := fs.Bool("include-body", false, "Include response body snippet in JSON output")
	maxBodyBytes := fs.Int("max-body-bytes", 16384, "Max bytes of body to store when include-body is set")
	bodyMaxBytes := fs.Int("body-max-bytes", 0, "Alias for max-body-bytes")
	cmValue := fs.String("content-match-value", "", "Optional content match substring")
	cmMode := fs.String("content-match-mode", "contains", "Content match mode: contains or not_contains")
	cmCase := fs.Bool("content-match-case", false, "Case-sensitive content match")

	var headers headerFlags
	fs.Var(&headers, "header", "Custom HTTP header 'Key: Value'")
	if len(args) > 0 && args[0] == "probe" {
		args = args[1:]
	}
	_ = fs.Parse(args)

	effMaxBody := *maxBodyBytes
	if *bodyMaxBytes > 0 {
		effMaxBody = *bodyMaxBytes
	}

	pType := strings.ToLower(strings.TrimSpace(*probeType))
	var out ProbeOutput

	switch pType {
	case "http", "https":
		out = executeHTTPProbe(*target, *iface, *localPort, *timeoutMS, *connectTimeoutMS, *retries, *retryDelayMS, *method, headers, *data, *formFile, *followRedirects, *insecureTLS, *includeBody, effMaxBody, *cmValue, *cmMode, *cmCase)
	case "ping", "icmp":
		out = executePingProbe(*target, *iface, *timeoutMS, *retries, *retryDelayMS)
	case "tcp":
		out = executeTCPProbe(*target, *iface, *localPort, *timeoutMS, *retries, *retryDelayMS)
	case "dns":
		out = executeDNSProbe(*target, *domain, *iface, *localPort, *timeoutMS, *retries, *retryDelayMS)
	default:
		out = ProbeOutput{Reachable: false, CurlExitCode: 1, Error: "Unsupported probe type: " + pType}
	}

	out.HTTPStatus = out.HTTPCode
	out.SourcePort = out.LocalPort
	out.SizeBytes = out.Metrics.SizeBytes
	out.LatencyMS = out.Metrics.TotalMS
	out.BodySnippet = out.Body
	if len(out.DNSIPs) > 0 {
		if len(out.DNSRecords) == 0 {
			out.DNSRecords = out.DNSIPs
		}
		if out.ResolvedIP == "" {
			out.ResolvedIP = out.DNSIPs[0]
		}
	}

	return out
}

func runProbeCmd(args []string) {
	out := executeProbeArgs(args)
	enc := json.NewEncoder(os.Stdout)
	_ = enc.Encode(out)
}

func runProbeRPCServer(ctx context.Context, addr string) {
	mux := http.NewServeMux()
	mux.HandleFunc("/probe", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
			return
		}
		var req struct {
			Args []string `json:"args"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		out := executeProbeArgs(req.Args)
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(out)
	})
	mux.HandleFunc("/health", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"ok":true}`))
	})
	registerMulticastRPC(mux)

	srv := &http.Server{
		Addr:              addr,
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
	}

	go func() {
		<-ctx.Done()
		shutCtx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		_ = srv.Shutdown(shutCtx)
	}()

	fmt.Printf("[STIGIX-GO] Resident Probe RPC listening on http://%s/probe\n", addr)
	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		fmt.Fprintf(os.Stderr, "[STIGIX-GO] Probe RPC server error on %s: %v\n", addr, err)
	}
}

func classifyGoNetError(err error, phase string) (int, string) {
	if err == nil {
		return 0, ""
	}
	errStr := err.Error()
	lower := strings.ToLower(errStr)

	if errors.Is(err, context.DeadlineExceeded) || strings.Contains(lower, "timeout") || strings.Contains(lower, "deadline exceeded") {
		if phase == "dns" {
			return 6, "CURLE_COULDNT_RESOLVE_HOST: DNS lookup timed out: " + errStr
		}
		return 28, "CURLE_OPERATION_TIMEDOUT: " + errStr
	}

	var dnsErr *net.DNSError
	if errors.As(err, &dnsErr) || phase == "dns" || strings.Contains(lower, "no such host") || strings.Contains(lower, "server misbehaving") {
		return 6, "CURLE_COULDNT_RESOLVE_HOST: " + errStr
	}

	if strings.Contains(lower, "x509:") || strings.Contains(lower, "certificate") {
		return 51, "CURLE_PEER_FAILED_VERIFICATION: " + errStr
	}

	if strings.Contains(lower, "tls:") || strings.Contains(lower, "handshake failure") || strings.Contains(lower, "protocol version") || (phase == "tls" && strings.Contains(lower, "eof")) {
		return 35, "CURLE_SSL_CONNECT_ERROR: " + errStr
	}

	if errors.Is(err, syscall.ECONNREFUSED) || strings.Contains(lower, "connection refused") || strings.Contains(lower, "network is unreachable") || strings.Contains(lower, "no route to host") {
		return 7, "CURLE_COULDNT_CONNECT: " + errStr
	}

	if errors.Is(err, syscall.ECONNRESET) || strings.Contains(lower, "connection reset by peer") {
		if phase == "connect" {
			return 7, "CURLE_COULDNT_CONNECT (TCP RST on connect): " + errStr
		}
		if phase == "tls" {
			return 35, "CURLE_SSL_CONNECT_ERROR (TCP RST during TLS handshake): " + errStr
		}
		return 56, "CURLE_RECV_ERROR (TCP RST during transfer): " + errStr
	}

	if errors.Is(err, io.EOF) || errors.Is(err, io.ErrUnexpectedEOF) || strings.Contains(lower, "eof") {
		return 52, "CURLE_GOT_NOTHING (Empty reply from server): " + errStr
	}

	return 1, errStr
}

func executeHTTPProbe(
	targetURL string,
	iface string,
	localPort int,
	timeoutMS int,
	connectTimeoutMS int,
	maxRetries int,
	retryDelayMS int,
	method string,
	headers []string,
	bodyData string,
	formFile string,
	followRedirects bool,
	insecureTLS bool,
	includeBody bool,
	maxBodyBytes int,
	cmValue string,
	cmMode string,
	cmCase bool,
) ProbeOutput {
	if timeoutMS <= 0 {
		timeoutMS = 5000
	}
	if connectTimeoutMS <= 0 || connectTimeoutMS > timeoutMS {
		connectTimeoutMS = timeoutMS
	}

	var lastOut ProbeOutput
	attempts := maxRetries + 1
	if attempts < 1 {
		attempts = 1
	}

	for attempt := 0; attempt < attempts; attempt++ {
		if attempt > 0 && retryDelayMS > 0 {
			time.Sleep(time.Duration(retryDelayMS) * time.Millisecond)
		}

		// If retrying with a deterministic localPort that might be in TIME_WAIT, increment by attempt
		effLocalPort := localPort
		if effLocalPort > 0 && attempt > 0 {
			effLocalPort += attempt
		}

		out := singleHTTPAttempt(targetURL, iface, effLocalPort, timeoutMS, connectTimeoutMS, method, headers, bodyData, formFile, followRedirects, insecureTLS, includeBody, maxBodyBytes, cmValue, cmMode, cmCase)
		out.Retries = attempt
		lastOut = out

		if out.Reachable && out.HTTPCode > 0 {
			return out
		}
	}

	return lastOut
}

func singleHTTPAttempt(
	targetURL string,
	iface string,
	localPort int,
	timeoutMS int,
	connectTimeoutMS int,
	method string,
	headers []string,
	bodyData string,
	formFile string,
	followRedirects bool,
	insecureTLS bool,
	includeBody bool,
	maxBodyBytes int,
	cmValue string,
	cmMode string,
	cmCase bool,
) ProbeOutput {
	var (
		startTime        = time.Now()
		dnsStart, dnsEnd time.Time
		tcpStart, tcpEnd time.Time
		tlsStart, tlsEnd time.Time
		wroteReq         time.Time
		firstByte        time.Time
		remoteIP         string
		remotePort       int
		actualLocalPort  = localPort
		sslVerifyResult  = 0
		currentPhase     = "init"
	)

	dialer := &net.Dialer{
		Timeout:   time.Duration(connectTimeoutMS) * time.Millisecond,
		KeepAlive: -1,
		Control: func(network, address string, c syscall.RawConn) error {
			var sockErr error
			_ = c.Control(func(fd uintptr) {
				_ = syscall.SetsockoptInt(int(fd), syscall.SOL_SOCKET, syscall.SO_REUSEADDR, 1)
				if iface != "" && iface != "eth0" {
					bindToDevice(int(fd), iface)
				}
			})
			return sockErr
		},
	}
	if localPort > 0 {
		dialer.LocalAddr = &net.TCPAddr{Port: localPort}
	}

	transport := &http.Transport{
		DisableKeepAlives: true,
		DialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
			currentPhase = "connect"
			conn, err := dialer.DialContext(ctx, network, addr)
			if err != nil && localPort > 0 {
				// Fallback to ephemeral port if specific localPort is busy (EADDRINUSE / EACCES)
				dialerFallback := *dialer
				dialerFallback.LocalAddr = nil
				conn, err = dialerFallback.DialContext(ctx, network, addr)
			}
			if err == nil && conn != nil {
				if ta, ok := conn.RemoteAddr().(*net.TCPAddr); ok {
					remoteIP = ta.IP.String()
					remotePort = ta.Port
				}
				if la, ok := conn.LocalAddr().(*net.TCPAddr); ok {
					actualLocalPort = la.Port
				}
			}
			return conn, err
		},
		TLSClientConfig: &tls.Config{
			InsecureSkipVerify: insecureTLS,
		},
		TLSHandshakeTimeout: time.Duration(connectTimeoutMS) * time.Millisecond,
	}

	client := &http.Client{
		Transport: transport,
		Timeout:   time.Duration(timeoutMS) * time.Millisecond,
	}
	if !followRedirects {
		client.CheckRedirect = func(req *http.Request, via []*http.Request) error {
			return http.ErrUseLastResponse
		}
	}

	var reqBody io.Reader
	var contentTypeHeader string

	if formFile != "" {
		// Format: file=@/path/to/file;type=application/octet-stream;filename=security_test.com
		var buf bytes.Buffer
		mw := multipart.NewWriter(&buf)
		fieldName := "file"
		filePath := ""
		fileName := "upload.bin"
		for _, part := range strings.Split(formFile, ";") {
			part = strings.TrimSpace(part)
			if strings.Contains(part, "=@") {
				kv := strings.SplitN(part, "=@", 2)
				fieldName = kv[0]
				filePath = kv[1]
				fileName = filepath.Base(filePath)
			} else if strings.HasPrefix(part, "filename=") {
				fileName = strings.TrimPrefix(part, "filename=")
			}
		}
		fw, err := mw.CreateFormFile(fieldName, fileName)
		if err == nil {
			if filePath != "" {
				if fBytes, err := os.ReadFile(filePath); err == nil {
					_, _ = fw.Write(fBytes)
				} else {
					_, _ = fw.Write([]byte(eicarPayload))
				}
			} else {
				_, _ = fw.Write([]byte(eicarPayload))
			}
		}
		_ = mw.Close()
		reqBody = &buf
		contentTypeHeader = mw.FormDataContentType()
		if method == "GET" {
			method = "POST"
		}
	} else if bodyData != "" {
		reqBody = strings.NewReader(bodyData)
	}

	ctx, cancel := context.WithTimeout(context.Background(), time.Duration(timeoutMS)*time.Millisecond)
	defer cancel()

	var dnsMS, tcpMS, tlsMS, ttfbMS float64
	trace := &httptrace.ClientTrace{
		DNSStart: func(_ httptrace.DNSStartInfo) {
			currentPhase = "dns"
			dnsStart = time.Now()
		},
		DNSDone: func(info httptrace.DNSDoneInfo) {
			dnsEnd = time.Now()
			if !dnsStart.IsZero() {
				dnsMS = float64(dnsEnd.Sub(dnsStart).Microseconds()) / 1000.0
			}
		},
		ConnectStart: func(_, _ string) {
			currentPhase = "connect"
			tcpStart = time.Now()
		},
		ConnectDone: func(_, _ string, err error) {
			tcpEnd = time.Now()
			if !tcpStart.IsZero() {
				tcpMS = float64(tcpEnd.Sub(tcpStart).Microseconds()) / 1000.0
			}
		},
		TLSHandshakeStart: func() {
			currentPhase = "tls"
			tlsStart = time.Now()
		},
		TLSHandshakeDone: func(state tls.ConnectionState, err error) {
			tlsEnd = time.Now()
			if !tlsStart.IsZero() {
				tlsMS = float64(tlsEnd.Sub(tlsStart).Microseconds()) / 1000.0
			}
			if err != nil {
				sslVerifyResult = 1
			}
		},
		WroteRequest: func(_ httptrace.WroteRequestInfo) {
			currentPhase = "transfer"
			wroteReq = time.Now()
		},
		GotFirstResponseByte: func() {
			firstByte = time.Now()
			ref := wroteReq
			if ref.IsZero() {
				if !tlsEnd.IsZero() {
					ref = tlsEnd
				} else if !tcpEnd.IsZero() {
					ref = tcpEnd
				} else {
					ref = startTime
				}
			}
			if firstByte.After(ref) {
				ttfbMS = float64(firstByte.Sub(ref).Microseconds()) / 1000.0
			}
		},
	}

	req, err := http.NewRequestWithContext(httptrace.WithClientTrace(ctx, trace), method, targetURL, reqBody)
	if err != nil {
		return ProbeOutput{
			Reachable:    false,
			LocalPort:    actualLocalPort,
			CurlExitCode: 3,
			Error:        err.Error(),
		}
	}

	req.Header.Set("User-Agent", "curl/8.5.0 (Stigix-Go-Engine/2.2)")
	req.Header.Set("Cache-Control", "no-cache, no-store")
	req.Header.Set("Pragma", "no-cache")
	if contentTypeHeader != "" {
		req.Header.Set("Content-Type", contentTypeHeader)
	}
	for _, h := range headers {
		if kv := strings.SplitN(h, ":", 2); len(kv) == 2 {
			req.Header.Set(strings.TrimSpace(kv[0]), strings.TrimSpace(kv[1]))
		}
	}

	resp, err := client.Do(req)
	if err != nil {
		exitCode, desc := classifyGoNetError(err, currentPhase)
		if exitCode == 51 {
			sslVerifyResult = 1
		}
		totalMS := float64(time.Since(startTime).Microseconds()) / 1000.0
		return ProbeOutput{
			Reachable:    false,
			RemoteIP:     remoteIP,
			RemotePort:   remotePort,
			LocalPort:    actualLocalPort,
			CurlExitCode: exitCode,
			Error:        desc,
			Metrics: ProbeMetrics{
				TotalMS:   totalMS,
				SSLVerify: sslVerifyResult,
			},
		}
	}
	defer resp.Body.Close()

	// Read body: keep up to maxCap in memory if includeBody or content_match is requested, discard the rest while counting bytes
	needSample := includeBody || cmValue != ""
	sampleLimit := maxBodyBytes
	if sampleLimit <= 0 {
		sampleLimit = 16384
	}
	var sampleBuf bytes.Buffer
	var totalBytes int64

	buf := make([]byte, 32*1024)
	var readErr error
	for {
		n, rErr := resp.Body.Read(buf)
		if n > 0 {
			totalBytes += int64(n)
			if needSample && sampleBuf.Len() < sampleLimit {
				rem := sampleLimit - sampleBuf.Len()
				if n < rem {
					rem = n
				}
				sampleBuf.Write(buf[:rem])
			}
		}
		if rErr != nil {
			if rErr != io.EOF {
				readErr = rErr
			}
			break
		}
	}

	endTime := time.Now()
	totalMS := float64(endTime.Sub(startTime).Microseconds()) / 1000.0

	var speedBps float64
	if totalMS > 0 {
		speedBps = float64(totalBytes) / (totalMS / 1000.0)
	}

	if readErr != nil {
		exitCode, desc := classifyGoNetError(readErr, "transfer")
		return ProbeOutput{
			Reachable:    false,
			HTTPCode:     resp.StatusCode,
			RemoteIP:     remoteIP,
			RemotePort:   remotePort,
			LocalPort:    actualLocalPort,
			CurlExitCode: exitCode,
			Error:        desc,
			Metrics: ProbeMetrics{
				DNSMS:     dnsMS,
				TCPMS:     tcpMS,
				TLSMS:     tlsMS,
				TTFBMS:    ttfbMS,
				TotalMS:   totalMS,
				SizeBytes: totalBytes,
				SpeedBps:  speedBps,
				SSLVerify: sslVerifyResult,
			},
		}
	}

	out := ProbeOutput{
		Reachable:    resp.StatusCode > 0,
		HTTPCode:     resp.StatusCode,
		RemoteIP:     remoteIP,
		RemotePort:   remotePort,
		LocalPort:    actualLocalPort,
		CurlExitCode: 0,
		Metrics: ProbeMetrics{
			DNSMS:     dnsMS,
			TCPMS:     tcpMS,
			TLSMS:     tlsMS,
			TTFBMS:    ttfbMS,
			TotalMS:   totalMS,
			SizeBytes: totalBytes,
			SpeedBps:  speedBps,
			SSLVerify: sslVerifyResult,
		},
	}

	bodyStr := sampleBuf.String()
	if includeBody {
		out.Body = bodyStr
	}

	if cmValue != "" {
		cmOk := true
		cmRes := "matched"
		if strings.TrimSpace(bodyStr) == "" {
			cmOk = false
			cmRes = "body empty"
		} else {
			haystack := bodyStr
			needle := cmValue
			if !cmCase {
				haystack = strings.ToLower(haystack)
				needle = strings.ToLower(needle)
			}
			found := strings.Contains(haystack, needle)
			if cmMode == "not_contains" {
				cmOk = !found
				if found {
					cmRes = "text unexpectedly found"
				}
			} else {
				cmOk = found
				if !found {
					cmRes = "text not found"
				}
			}
		}
		out.ContentMatchOK = &cmOk
		out.ContentMatchResult = cmRes
		if !cmOk {
			out.Reachable = false
		}
	}

	return out
}

func executePingProbe(target string, iface string, timeoutMS int, maxRetries int, retryDelayMS int) ProbeOutput {
	if timeoutMS <= 0 {
		timeoutMS = 2000
	}
	attempts := maxRetries + 1
	if attempts < 1 {
		attempts = 1
	}

	for attempt := 0; attempt < attempts; attempt++ {
		if attempt > 0 && retryDelayMS > 0 {
			time.Sleep(time.Duration(retryDelayMS) * time.Millisecond)
		}
		rttMS, remoteIP, err := singleICMPPing(target, iface, timeoutMS)
		if err == nil {
			return ProbeOutput{
				Reachable:    true,
				RemoteIP:     remoteIP,
				Retries:      attempt,
				CurlExitCode: 0,
				Metrics: ProbeMetrics{
					TotalMS: rttMS,
				},
			}
		}
	}

	return ProbeOutput{
		Reachable:    false,
		Retries:      maxRetries,
		CurlExitCode: 28,
		Error:        "ICMP Ping failed after retries",
	}
}

func singleICMPPing(target string, iface string, timeoutMS int) (float64, string, error) {
	ips, err := net.LookupIP(target)
	if err != nil || len(ips) == 0 {
		return 0, "", fmt.Errorf("failed to resolve %s: %w", target, err)
	}
	var dstIP net.IP
	for _, ip := range ips {
		if v4 := ip.To4(); v4 != nil {
			dstIP = v4
			break
		}
	}
	if dstIP == nil {
		return 0, "", fmt.Errorf("no IPv4 address for %s", target)
	}

	dialer := &net.Dialer{
		Timeout: time.Duration(timeoutMS) * time.Millisecond,
		Control: func(network, address string, c syscall.RawConn) error {
			if iface != "" && iface != "eth0" {
				_ = c.Control(func(fd uintptr) {
					bindToDevice(int(fd), iface)
				})
			}
			return nil
		},
	}
	conn, err := dialer.Dial("ip4:icmp", dstIP.String())
	if err != nil {
		return 0, dstIP.String(), err
	}
	defer conn.Close()

	_ = conn.SetDeadline(time.Now().Add(time.Duration(timeoutMS) * time.Millisecond))

	icmpID := uint16(os.Getpid() & 0xffff)
	icmpSeq := uint16(rand.Intn(65535))
	pkt := make([]byte, 16)
	pkt[0] = 8 // Echo Request
	pkt[1] = 0
	binary.BigEndian.PutUint16(pkt[4:6], icmpID)
	binary.BigEndian.PutUint16(pkt[6:8], icmpSeq)
	copy(pkt[8:], []byte("STIGIXGO"))
	csum := ipv4Checksum(pkt)
	binary.BigEndian.PutUint16(pkt[2:4], csum)

	start := time.Now()
	if _, err := conn.Write(pkt); err != nil {
		return 0, dstIP.String(), err
	}

	reply := make([]byte, 256)
	for {
		n, err := conn.Read(reply)
		if err != nil {
			return 0, dstIP.String(), err
		}
		offset := 0
		if n >= 20 && (reply[0]>>4) == 4 {
			offset = int(reply[0]&0x0f) * 4
		}
		if n >= offset+8 && reply[offset] == 0 { // Echo Reply
			rID := binary.BigEndian.Uint16(reply[offset+4 : offset+6])
			rSeq := binary.BigEndian.Uint16(reply[offset+6 : offset+8])
			if rID == icmpID && rSeq == icmpSeq {
				rtt := float64(time.Since(start).Microseconds()) / 1000.0
				return rtt, dstIP.String(), nil
			}
		}
	}
}

func executeTCPProbe(target string, iface string, localPort int, timeoutMS int, maxRetries int, retryDelayMS int) ProbeOutput {
	if timeoutMS <= 0 {
		timeoutMS = 3000
	}
	if !strings.Contains(target, ":") {
		target = target + ":80"
	}

	attempts := maxRetries + 1
	if attempts < 1 {
		attempts = 1
	}

	var lastErr error
	for attempt := 0; attempt < attempts; attempt++ {
		if attempt > 0 && retryDelayMS > 0 {
			time.Sleep(time.Duration(retryDelayMS) * time.Millisecond)
		}

		dialer := &net.Dialer{
			Timeout: time.Duration(timeoutMS) * time.Millisecond,
			Control: func(network, address string, c syscall.RawConn) error {
				_ = c.Control(func(fd uintptr) {
					_ = syscall.SetsockoptInt(int(fd), syscall.SOL_SOCKET, syscall.SO_REUSEADDR, 1)
					if iface != "" && iface != "eth0" {
						bindToDevice(int(fd), iface)
					}
				})
				return nil
			},
		}
		if localPort > 0 {
			dialer.LocalAddr = &net.TCPAddr{Port: localPort + attempt}
		}

		start := time.Now()
		conn, err := dialer.Dial("tcp", target)
		if err == nil {
			rtt := float64(time.Since(start).Microseconds()) / 1000.0
			var rIP string
			var rPort, lPort int
			if ta, ok := conn.RemoteAddr().(*net.TCPAddr); ok {
				rIP = ta.IP.String()
				rPort = ta.Port
			}
			if la, ok := conn.LocalAddr().(*net.TCPAddr); ok {
				lPort = la.Port
			}
			_ = conn.Close()
			return ProbeOutput{
				Reachable:    true,
				RemoteIP:     rIP,
				RemotePort:   rPort,
				LocalPort:    lPort,
				Retries:      attempt,
				CurlExitCode: 0,
				Metrics: ProbeMetrics{
					TCPMS:   rtt,
					TotalMS: rtt,
				},
			}
		}
		lastErr = err
	}

	code, desc := classifyGoNetError(lastErr, "connect")
	return ProbeOutput{
		Reachable:    false,
		Retries:      maxRetries,
		CurlExitCode: code,
		Error:        desc,
	}
}

func getSystemDNSServers() []string {
	var servers []string
	data, err := os.ReadFile("/etc/resolv.conf")
	if err == nil {
		for _, line := range strings.Split(string(data), "\n") {
			line = strings.TrimSpace(line)
			if strings.HasPrefix(line, "#") || line == "" {
				continue
			}
			fields := strings.Fields(line)
			if len(fields) >= 2 && fields[0] == "nameserver" {
				ip := net.ParseIP(fields[1])
				if ip != nil && ip.To4() != nil {
					servers = append(servers, ip.String()+":53")
				}
			}
		}
	}
	if len(servers) == 0 {
		servers = []string{"8.8.8.8:53", "1.1.1.1:53"}
	}
	return servers
}

func parseDNSName(packet []byte, offset int) (string, int) {
	var labels []string
	pos := offset
	nextOffset := -1
	jumps := 0
	n := len(packet)

	for pos < n && jumps < 10 {
		b := packet[pos]
		if b == 0 {
			if nextOffset == -1 {
				nextOffset = pos + 1
			}
			break
		}
		if (b & 0xc0) == 0xc0 {
			if pos+1 >= n {
				return "", n
			}
			if nextOffset == -1 {
				nextOffset = pos + 2
			}
			pos = ((int(b) & 0x3f) << 8) | int(packet[pos+1])
			jumps++
			continue
		}
		labelLen := int(b)
		pos++
		if pos+labelLen > n {
			return "", n
		}
		labels = append(labels, string(packet[pos:pos+labelLen]))
		pos += labelLen
	}
	if nextOffset == -1 {
		nextOffset = pos
	}
	return strings.Join(labels, "."), nextOffset
}

func executeDNSProbe(dnsServer string, domain string, iface string, localPort int, timeoutMS int, maxRetries int, retryDelayMS int) ProbeOutput {
	if timeoutMS <= 0 {
		timeoutMS = 2000
	}
	var dnsServers []string
	rawHost := strings.Split(strings.TrimSpace(dnsServer), ":")[0]
	if rawHost != "" && net.ParseIP(rawHost) == nil {
		// --target was passed a domain name (e.g. malware.testcategory.com) rather than a DNS server IP
		domain = strings.TrimSpace(dnsServer)
		dnsServers = getSystemDNSServers()
	} else if dnsServer == "" {
		dnsServers = getSystemDNSServers()
	} else if !strings.Contains(dnsServer, ":") {
		dnsServers = []string{dnsServer + ":53"}
	} else {
		dnsServers = []string{dnsServer}
	}
	if domain == "" {
		domain = "google.com"
	}

	attempts := maxRetries + 1
	if attempts < 1 {
		attempts = 1
	}

	var lastErr error
	var lastRCode int
	for attempt := 0; attempt < attempts; attempt++ {
		if attempt > 0 && retryDelayMS > 0 {
			time.Sleep(time.Duration(retryDelayMS) * time.Millisecond)
		}

		for srvIdx, srv := range dnsServers {
			effPort := localPort
			if effPort > 0 && (attempt > 0 || srvIdx > 0) {
				effPort = 0 // Use ephemeral source port on retry/fallback so stale conntrack state never blocks retry
			}

			ips, records, rcode, actualLPort, rttMS, err := singleDNSQuery(srv, domain, iface, effPort, timeoutMS)
			lastRCode = rcode
			if err == nil && rcode == 0 && (len(ips) > 0 || len(records) > 0) {
				resolvedIP := ""
				if len(ips) > 0 {
					resolvedIP = ips[0]
				}
				return ProbeOutput{
					Reachable:    len(ips) > 0,
					LocalPort:    actualLPort,
					Retries:      attempt + srvIdx,
					CurlExitCode: 0,
					DNSIPs:       ips,
					DNSRecords:   records,
					ResolvedIP:   resolvedIP,
					DNSRCode:     rcode,
					Metrics: ProbeMetrics{
						DNSMS:   rttMS,
						TotalMS: rttMS,
					},
				}
			}
			if err == nil && rcode == 3 {
				// NXDOMAIN is a definitive DNS response — do not retry
				return ProbeOutput{
					Reachable:    false,
					LocalPort:    actualLPort,
					Retries:      attempt,
					CurlExitCode: 6,
					DNSRCode:     rcode,
					Error:        "NXDOMAIN",
					Metrics: ProbeMetrics{
						DNSMS:   rttMS,
						TotalMS: rttMS,
					},
				}
			}
			lastErr = err
		}
	}

	errMsg := "DNS query returned empty or SERVFAIL"
	if lastErr != nil {
		if strings.Contains(strings.ToLower(lastErr.Error()), "timeout") {
			errMsg = "DNS query timed out (no servers could be reached)"
		} else {
			errMsg = lastErr.Error()
		}
	}
	return ProbeOutput{
		Reachable:    false,
		LocalPort:    localPort,
		Retries:      maxRetries,
		CurlExitCode: 6,
		DNSRCode:     lastRCode,
		Error:        errMsg,
	}
}

func singleDNSQuery(dnsServer string, domain string, iface string, localPort int, timeoutMS int) ([]string, []string, int, int, float64, error) {
	dialer := &net.Dialer{
		Timeout: time.Duration(timeoutMS) * time.Millisecond,
		Control: func(network, address string, c syscall.RawConn) error {
			_ = c.Control(func(fd uintptr) {
				_ = syscall.SetsockoptInt(int(fd), syscall.SOL_SOCKET, syscall.SO_REUSEADDR, 1)
				if iface != "" && iface != "eth0" {
					bindToDevice(int(fd), iface)
				}
			})
			return nil
		},
	}
	if localPort > 0 {
		dialer.LocalAddr = &net.UDPAddr{Port: localPort}
	}

	start := time.Now()
	conn, err := dialer.Dial("udp4", dnsServer)
	if err != nil && localPort > 0 {
		dialer.LocalAddr = nil
		conn, err = dialer.Dial("udp4", dnsServer)
	}
	if err != nil {
		return nil, nil, -1, localPort, 0, err
	}
	defer conn.Close()

	actualPort := localPort
	if la, ok := conn.LocalAddr().(*net.UDPAddr); ok {
		actualPort = la.Port
	}

	_ = conn.SetDeadline(time.Now().Add(time.Duration(timeoutMS) * time.Millisecond))

	txID := uint16(rand.Intn(65535))
	var qBuf bytes.Buffer
	_ = binary.Write(&qBuf, binary.BigEndian, txID)
	_ = binary.Write(&qBuf, binary.BigEndian, uint16(0x0100)) // Standard query, RD=1
	_ = binary.Write(&qBuf, binary.BigEndian, uint16(1))      // QDCOUNT=1
	_ = binary.Write(&qBuf, binary.BigEndian, uint16(0))      // ANCOUNT=0
	_ = binary.Write(&qBuf, binary.BigEndian, uint16(0))      // NSCOUNT=0
	_ = binary.Write(&qBuf, binary.BigEndian, uint16(0))      // ARCOUNT=0

	for _, label := range strings.Split(strings.TrimSuffix(domain, "."), ".") {
		if len(label) == 0 {
			continue
		}
		qBuf.WriteByte(byte(len(label)))
		qBuf.WriteString(label)
	}
	qBuf.WriteByte(0)
	_ = binary.Write(&qBuf, binary.BigEndian, uint16(1)) // Type A
	_ = binary.Write(&qBuf, binary.BigEndian, uint16(1)) // Class IN

	if _, err := conn.Write(qBuf.Bytes()); err != nil {
		return nil, nil, -1, actualPort, 0, err
	}

	resp := make([]byte, 512)
	n, err := conn.Read(resp)
	rttMS := float64(time.Since(start).Microseconds()) / 1000.0
	if err != nil {
		return nil, nil, -1, actualPort, rttMS, err
	}
	if n < 12 {
		return nil, nil, -1, actualPort, rttMS, fmt.Errorf("short DNS response (%d bytes)", n)
	}
	resp = resp[:n]

	rcode := int(resp[3] & 0x0f)
	ancount := int(binary.BigEndian.Uint16(resp[6:8]))

	// Skip header (12 bytes) and question section
	_, pos := parseDNSName(resp, 12)
	pos += 4 // skip QTYPE + QCLASS

	var ips []string
	var records []string
	for i := 0; i < ancount && pos+10 <= n; i++ {
		_, pos = parseDNSName(resp, pos)
		if pos+10 > n {
			break
		}
		rType := binary.BigEndian.Uint16(resp[pos : pos+2])
		rdLen := int(binary.BigEndian.Uint16(resp[pos+8 : pos+10]))
		pos += 10
		if pos+rdLen > n {
			break
		}
		if rType == 1 && rdLen == 4 {
			ip := net.IPv4(resp[pos], resp[pos+1], resp[pos+2], resp[pos+3]).String()
			ips = append(ips, ip)
			records = append(records, ip)
		} else if rType == 5 {
			cname, _ := parseDNSName(resp, pos)
			if cname != "" {
				records = append(records, cname+".")
			}
		}
		pos += rdLen
	}

	return ips, records, rcode, actualPort, rttMS, nil
}

func runSRTCLI(args []string) {
	fs := flag.NewFlagSet("srt", flag.ExitOnError)
	responder := fs.Bool("responder", false, "Run SRT HTTP Responder server")
	port := fs.Int("port", 8081, "SRT Responder port")
	target := fs.String("target", "", "Target IP/Host for SRT Orchestrator")
	interval := fs.Float64("interval", 2.0, "Interval in seconds between SRT probes")
	statsFile := fs.String("stats-file", "/tmp/srt_stats.json", "Stats output JSON file")
	_ = fs.Parse(args)

	if *responder {
		runSRTResponderServer(context.Background(), *port)
		return
	}
	if *target == "" {
		fmt.Fprintf(os.Stderr, "Usage: stigix-go srt --target <ip> [--interval 2.0] [--stats-file /tmp/srt_stats.json]\n")
		os.Exit(1)
	}

	tHost := *target
	if !strings.Contains(tHost, ":") {
		tHost = fmt.Sprintf("%s:8081", tHost)
	}
	urlStr := fmt.Sprintf("http://%s/api/slow-app/delay/500", tHost)
	fmt.Printf("🚀 [STIGIX-GO SRT] Orchestrator Started -> Target: %s | Interval: %.1fs\n", *target, *interval)

	var history []map[string]any
	for {
		out := executeHTTPProbe(urlStr, "", 0, 5000, 3000, 0, 0, "GET", nil, "", "", true, true, false, 0, "", "", false)
		var latest map[string]any
		if out.Reachable {
			rttMS := round2(out.Metrics.TCPMS)
			ttfbMS := round2(out.Metrics.TTFBMS)
			srtMS := round2(ttfbMS - rttMS)
			if srtMS < 0 {
				srtMS = 0
			}
			totalMS := round2(out.Metrics.TotalMS)
			latest = map[string]any{
				"timestamp": float64(time.Now().UnixNano()) / 1e9,
				"rtt_ms":    rttMS,
				"srt_ms":    srtMS,
				"total_ms":  totalMS,
				"http_code": out.HTTPCode,
			}
			fmt.Printf("🐌 [SRT] Probe Result: Target=%s | RTT=%.2fms | SRT=%.2fms | Total=%.2fms | Code=%d\n",
				*target, rttMS, srtMS, totalMS, out.HTTPCode)
			history = append(history, latest)
			if len(history) > 100 {
				history = history[len(history)-100:]
			}
		} else {
			latest = map[string]any{
				"error": out.Error,
			}
		}
		_ = writeAtomicJSON(*statsFile, map[string]any{
			"target":  *target,
			"latest":  latest,
			"history": history,
		})
		time.Sleep(time.Duration(*interval * float64(time.Second)))
	}
}

