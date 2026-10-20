package main

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"math"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"syscall"
	"time"
)

const (
	pcapDefaultCaptureDir  = "/tmp/stigix-captures"
	pcapMaxDurationSeconds = 300
	pcapMaxPacketsHard     = 10000
	pcapDefaultDuration    = 30
	pcapDefaultMaxPackets  = 1000
	pcapDefaultSnaplen     = 1500
	pcapMaxRetentionFiles  = 5
)

func getPcapCaptureDir() string {
	if v := strings.TrimSpace(os.Getenv("STIGIX_CAPTURES_DIR")); v != "" {
		return v
	}
	return pcapDefaultCaptureDir
}

func getPcapActiveMetaFile() string {
	return filepath.Join(getPcapCaptureDir(), "active_session.json")
}

type BPFTrapPreset struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	BPF         string `json:"bpf"`
	Description string `json:"description"`
}

var bpfPresets = []BPFTrapPreset{
	{ID: "all", Name: "All Traffic", BPF: "", Description: "Capture all packets on the selected interface (excluding SSH)"},
	{ID: "icmp", Name: "ICMP (Ping / Traceroute)", BPF: "icmp or icmp6", Description: "Capture ICMP Echo Request/Reply and control messages"},
	{ID: "dns", Name: "DNS Queries (Port 53)", BPF: "port 53", Description: "Capture UDP/TCP DNS resolutions"},
	{ID: "http_tls", Name: "HTTP / HTTPS (80, 443, 8080)", BPF: "tcp port 80 or tcp port 443 or tcp port 8080", Description: "Capture web traffic and TLS handshakes"},
	{ID: "voice_rtp", Name: "Stigix Voice & Echo (UDP 6100, 6200)", BPF: "udp port 6100 or udp port 6200 or (udp portrange 16384-32767)", Description: "Capture Stigix RTP voice streams and UDP Echo convergence probes"},
	{ID: "bgp_bfd", Name: "Routing & BFD (BGP 179, BFD 3784)", BPF: "tcp port 179 or udp port 3784 or udp port 3785 or udp port 4784", Description: "Capture BGP peering and BFD keepalives"},
	{ID: "ipsec_ike", Name: "IPsec / IKEv2 Tunnels (500, 4500, ESP)", BPF: "udp port 500 or udp port 4500 or proto 50", Description: "Capture SD-WAN tunnel negotiation and ESP encrypted packets"},
	{ID: "dhcp_arp", Name: "DHCP & ARP Discovery", BPF: "arp or port 67 or port 68", Description: "Capture L2/L3 address resolution and DHCP leases"},
	{ID: "iot_bacnet", Name: "IoT / OT Protocols (BACnet, Modbus, MQTT)", BPF: "udp port 47808 or tcp port 502 or tcp port 1883 or udp port 5353", Description: "Capture IoT dictionary and industrial control traffic"},
}

var unsafeBPFPattern = regexp.MustCompile(`[;&|$` + "`" + `><\n\r\\]`)

type rawPCAPPacket struct {
	TsSec   uint32
	TsUsec  uint32
	InclLen uint32
	OrigLen uint32
	Data    []byte
	Epoch   float64
}

func runPcapCaptureCLI(args []string) {
	if len(args) < 1 {
		printJSONResult(map[string]any{"error": "Missing pcap-capture command"})
		os.Exit(1)
	}

	cmd := args[0]
	subArgs := args[1:]

	switch cmd {
	case "interfaces":
		printJSONResult(discoverCaptureInterfaces())
	case "presets":
		printJSONResult(bpfPresets)
	case "start":
		fs := flag.NewFlagSet("pcap-capture start", flag.ContinueOnError)
		iface := fs.String("interface", "any", "Interface to capture on")
		bpf := fs.String("bpf", "", "BPF filter")
		duration := fs.Int("duration", pcapDefaultDuration, "Max duration (s)")
		maxPkts := fs.Int("max-packets", pcapDefaultMaxPackets, "Max packets")
		snaplen := fs.Int("snaplen", pcapDefaultSnaplen, "Snaplen bytes")
		_ = fs.Parse(subArgs)
		printJSONResult(startCaptureSession(*iface, *bpf, *duration, *maxPkts, *snaplen))
	case "stop":
		printJSONResult(stopCaptureSession())
	case "status":
		printJSONResult(getCaptureSessionStatus())
	case "dissect":
		fs := flag.NewFlagSet("pcap-capture dissect", flag.ContinueOnError)
		file := fs.String("file", "", "PCAP file path or filename")
		offset := fs.Int("offset", 0, "Packet offset")
		limit := fs.Int("limit", 200, "Max packets to dissect")
		_ = fs.Parse(subArgs)
		printJSONResult(dissectPCAPFile(*file, *offset, *limit))
	case "list":
		printJSONResult(listPCAPCaptures())
	case "delete":
		fs := flag.NewFlagSet("pcap-capture delete", flag.ContinueOnError)
		filename := fs.String("filename", "", "Filename to delete")
		_ = fs.Parse(subArgs)
		printJSONResult(deletePCAPCapture(*filename))
	default:
		printJSONResult(map[string]any{"error": fmt.Sprintf("Unknown pcap-capture command: %s", cmd)})
		os.Exit(1)
	}
}

func printJSONResult(v any) {
	enc := json.NewEncoder(os.Stdout)
	_ = enc.Encode(v)
}

func discoverCaptureInterfaces() []map[string]any {
	defaultIface := ""
	if out, err := exec.Command("ip", "-j", "route", "show", "default").Output(); err == nil {
		var routes []map[string]any
		if json.Unmarshal(out, &routes) == nil && len(routes) > 0 {
			if dev, ok := routes[0]["dev"].(string); ok {
				defaultIface = dev
			}
		}
	}

	ConfiguredIface := ""
	cfgPath := filepath.Join(getConfigDir(), "interfaces.json")
	if b, err := os.ReadFile(cfgPath); err == nil {
		var cfg map[string]any
		if json.Unmarshal(b, &cfg) == nil {
			if def, ok := cfg["default"].(map[string]any); ok {
				if name, ok := def["name"].(string); ok {
					ConfiguredIface = name
				}
			}
		}
	}

	var result []map[string]any

	if out, err := exec.Command("ip", "-j", "addr", "show").Output(); err == nil {
		var addrData []map[string]any
		if json.Unmarshal(out, &addrData) == nil {
			for _, iface := range addrData {
				ifname, _ := iface["ifname"].(string)
				if ifname == "" {
					continue
				}
				var ipv4List []string
				if addrInfo, ok := iface["addr_info"].([]any); ok {
					for _, a := range addrInfo {
						if am, ok := a.(map[string]any); ok {
							if fam, _ := am["family"].(string); fam == "inet" {
								if loc, _ := am["local"].(string); loc != "" {
									ipv4List = append(ipv4List, loc)
								}
							}
						}
					}
				}
				operstate, _ := iface["operstate"].(string)
				operstate = strings.ToUpper(operstate)
				isUp := operstate == "UP" || operstate == "UNKNOWN"
				mac, _ := iface["address"].(string)

				category := "other"
				label := ifname
				if ifname == "lo" {
					category = "loopback"
					label = "Loopback (lo)"
				} else if strings.HasPrefix(ifname, "docker") || strings.HasPrefix(ifname, "br-") || strings.HasPrefix(ifname, "veth") {
					category = "docker"
					label = fmt.Sprintf("%s (Docker)", ifname)
				} else if strings.HasPrefix(ifname, "eth") || strings.HasPrefix(ifname, "en") || strings.HasPrefix(ifname, "ens") || strings.HasPrefix(ifname, "enp") || strings.HasPrefix(ifname, "wlan") {
					category = "physical"
					var tags []string
					if ifname == defaultIface {
						tags = append(tags, "Default Route")
					}
					if ifname == ConfiguredIface {
						tags = append(tags, "Stigix Traffic Egress")
					}
					tagStr := ""
					if len(tags) > 0 {
						tagStr = fmt.Sprintf(" [%s]", strings.Join(tags, ", "))
					}
					ipStr := "no IP"
					if len(ipv4List) > 0 {
						ipStr = strings.Join(ipv4List, ", ")
					}
					label = fmt.Sprintf("%s (%s)%s", ifname, ipStr, tagStr)
				} else {
					ipStr := "no IP"
					if len(ipv4List) > 0 {
						ipStr = strings.Join(ipv4List, ", ")
					}
					label = fmt.Sprintf("%s (%s)", ifname, ipStr)
				}

				ipVal := any(nil)
				if len(ipv4List) > 0 {
					ipVal = ipv4List[0]
				}
				result = append(result, map[string]any{
					"name":       ifname,
					"label":      label,
					"ip":         ipVal,
					"mac":        mac,
					"is_default": ifname == defaultIface,
					"is_egress":  ifname == ConfiguredIface,
					"category":   category,
					"is_up":      isUp,
				})
			}
		}
	}

	if len(result) == 0 {
		// Fallback to Go net.Interfaces()
		if ifaces, err := net.Interfaces(); err == nil {
			for _, nif := range ifaces {
				var ipv4 string
				if addrs, err := nif.Addrs(); err == nil {
					for _, a := range addrs {
						if ipnet, ok := a.(*net.IPNet); ok && ipnet.IP.To4() != nil {
							ipv4 = ipnet.IP.String()
							break
						}
					}
				}
				cat := "physical"
				if nif.Name == "lo" || nif.Name == "lo0" {
					cat = "loopback"
				}
				ipVal := any(nil)
				if ipv4 != "" {
					ipVal = ipv4
				}
				result = append(result, map[string]any{
					"name":       nif.Name,
					"label":      fmt.Sprintf("%s (%s)", nif.Name, ipv4),
					"ip":         ipVal,
					"mac":        nif.HardwareAddr.String(),
					"is_default": nif.Name == defaultIface,
					"is_egress":  nif.Name == ConfiguredIface,
					"category":   cat,
					"is_up":      (nif.Flags & net.FlagUp) != 0,
				})
			}
		}
	}

	sort.Slice(result, func(i, j int) bool {
		score := func(m map[string]any) int {
			if b, _ := m["is_egress"].(bool); b {
				return 0
			}
			if b, _ := m["is_default"].(bool); b {
				return 1
			}
			cat, _ := m["category"].(string)
			switch cat {
			case "physical":
				return 2
			case "other":
				return 3
			case "loopback":
				return 4
			default:
				return 5
			}
		}
		si, sj := score(result[i]), score(result[j])
		if si != sj {
			return si < sj
		}
		ni, _ := result[i]["name"].(string)
		nj, _ := result[j]["name"].(string)
		return ni < nj
	})

	anyEntry := map[string]any{
		"name":       "any",
		"label":      "any (All Interfaces - Linux Cooked Capture)",
		"ip":         "*",
		"mac":        "",
		"is_default": false,
		"is_egress":  false,
		"category":   "special",
		"is_up":      true,
	}
	return append([]map[string]any{anyEntry}, result...)
}

func validateBPF(bpf string) (bool, string) {
	trimmed := strings.TrimSpace(bpf)
	if trimmed == "" {
		return true, ""
	}
	if len(trimmed) > 256 {
		return false, "BPF filter exceeds maximum length (256 characters)"
	}
	if unsafeBPFPattern.MatchString(trimmed) {
		return false, "BPF filter contains forbidden shell characters"
	}
	return true, trimmed
}

func enforceRetentionPolicy() {
	capDir := getPcapCaptureDir()
	_ = os.MkdirAll(capDir, 0755)
	entries, err := os.ReadDir(capDir)
	if err != nil {
		return
	}
	type pcapInfo struct {
		path  string
		mtime time.Time
	}
	var files []pcapInfo
	for _, e := range entries {
		if !e.IsDir() && strings.HasSuffix(e.Name(), ".pcap") {
			if info, err := e.Info(); err == nil {
				files = append(files, pcapInfo{
					path:  filepath.Join(capDir, e.Name()),
					mtime: info.ModTime(),
				})
			}
		}
	}
	sort.Slice(files, func(i, j int) bool {
		return files[i].mtime.After(files[j].mtime)
	})
	if len(files) >= pcapMaxRetentionFiles {
		for _, old := range files[pcapMaxRetentionFiles-1:] {
			_ = os.Remove(old.path)
		}
	}
}

func isProcessAlive(pid int) bool {
	if pid <= 0 {
		return false
	}
	proc, err := os.FindProcess(pid)
	if err != nil {
		return false
	}
	return proc.Signal(syscall.Signal(0)) == nil
}

func loadActiveMeta() map[string]any {
	b, err := os.ReadFile(getPcapActiveMetaFile())
	if err != nil {
		return nil
	}
	var m map[string]any
	if json.Unmarshal(b, &m) != nil {
		return nil
	}
	return m
}

func saveActiveMeta(meta map[string]any) {
	_ = os.MkdirAll(getPcapCaptureDir(), 0755)
	_ = writeAtomicJSONIndent(getPcapActiveMetaFile(), meta)
}

func startCaptureSession(iface string, bpf string, duration int, maxPackets int, snaplen int) map[string]any {
	capDir := getPcapCaptureDir()
	_ = os.MkdirAll(capDir, 0755)
	existing := getCaptureSessionStatus()
	if active, _ := existing["active"].(bool); active {
		return map[string]any{"error": "A packet capture session is already running", "session": existing}
	}

	ok, resBPF := validateBPF(bpf)
	if !ok {
		return map[string]any{"error": resBPF}
	}

	if duration < 1 {
		duration = 1
	} else if duration > pcapMaxDurationSeconds {
		duration = pcapMaxDurationSeconds
	}
	if maxPackets < 10 {
		maxPackets = 10
	} else if maxPackets > pcapMaxPacketsHard {
		maxPackets = pcapMaxPacketsHard
	}
	if snaplen < 64 {
		snaplen = 64
	} else if snaplen > 65535 {
		snaplen = 65535
	}

	enforceRetentionPolicy()

	now := time.Now()
	ts := now.Format("20060102-150405")
	safeIface := regexp.MustCompile(`[^a-zA-Z0-9_-]`).ReplaceAllString(iface, "")
	sessionID := fmt.Sprintf("cap-%s-%s", ts, safeIface)
	pcapFilename := fmt.Sprintf("%s.pcap", sessionID)
	pcapPath := filepath.Join(capDir, pcapFilename)

	finalBPF := "not tcp port 22"
	if resBPF != "" {
		finalBPF = fmt.Sprintf("(%s) and (not tcp port 22)", resBPF)
	}

	cmdArgs := []string{
		"-i", iface,
		"-nn",
		"-U",
		"-s", strconv.Itoa(snaplen),
		"-c", strconv.Itoa(maxPackets),
		"-G", strconv.Itoa(duration),
		"-W", "1",
		"-w", pcapPath,
		finalBPF,
	}

	errLogPath := filepath.Join(capDir, fmt.Sprintf("%s.stderr.log", sessionID))
	errFile, err := os.Create(errLogPath)
	if err != nil {
		return map[string]any{"error": fmt.Sprintf("Failed to create stderr log: %v", err)}
	}

	cmd := exec.Command("tcpdump", cmdArgs...)
	cmd.Stdout = io.Discard
	cmd.Stderr = errFile
	cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true}

	if err := cmd.Start(); err != nil {
		_ = errFile.Close()
		return map[string]any{"error": fmt.Sprintf("Failed to launch tcpdump: %v", err)}
	}
	pid := cmd.Process.Pid
	_ = cmd.Process.Release()
	_ = errFile.Close()

	time.Sleep(150 * time.Millisecond)
	if !isProcessAlive(pid) {
		errTxt := ""
		if b, err := os.ReadFile(errLogPath); err == nil {
			errTxt = strings.TrimSpace(string(b))
		}
		if _, err := os.Stat(pcapPath); os.IsNotExist(err) || strings.Contains(strings.ToLower(errTxt), "syntax error") || strings.Contains(strings.ToLower(errTxt), "error") {
			if errTxt == "" {
				errTxt = "tcpdump exited immediately"
			}
			return map[string]any{"error": fmt.Sprintf("tcpdump failed: %s", errTxt)}
		}
	}

	meta := map[string]any{
		"active":        true,
		"session_id":    sessionID,
		"pid":           pid,
		"interface":     iface,
		"bpf":           resBPF,
		"effective_bpf": finalBPF,
		"duration":      duration,
		"max_packets":   maxPackets,
		"snaplen":       snaplen,
		"start_time":    float64(now.UnixNano()) / 1e9,
		"pcap_filename": pcapFilename,
		"pcap_path":     pcapPath,
		"err_log_path":  errLogPath,
		"status":        "running",
	}
	saveActiveMeta(meta)
	return meta
}

func stopCaptureSession() map[string]any {
	meta := loadActiveMeta()
	if meta == nil {
		return map[string]any{"active": false, "status": "idle"}
	}
	pid := intFromAny(meta["pid"])
	if pid > 0 && isProcessAlive(pid) {
		if proc, err := os.FindProcess(pid); err == nil {
			_ = proc.Signal(syscall.SIGINT)
			time.Sleep(200 * time.Millisecond)
			if isProcessAlive(pid) {
				_ = proc.Signal(syscall.SIGTERM)
				time.Sleep(150 * time.Millisecond)
			}
			if isProcessAlive(pid) {
				_ = proc.Signal(syscall.SIGKILL)
			}
		}
	}

	nowFloat := float64(time.Now().UnixNano()) / 1e9
	startTime := floatFromAny(meta["start_time"], nowFloat)
	meta["active"] = false
	meta["status"] = "stopped"
	meta["stop_time"] = nowFloat
	meta["elapsed_seconds"] = round1(nowFloat - startTime)

	if pcapPath, _ := meta["pcap_path"].(string); pcapPath != "" {
		if st, err := os.Stat(pcapPath); err == nil {
			meta["file_size_bytes"] = st.Size()
		} else {
			meta["file_size_bytes"] = 0
		}
	}
	saveActiveMeta(meta)
	return meta
}

func getCaptureSessionStatus() map[string]any {
	meta := loadActiveMeta()
	if meta == nil {
		return map[string]any{"active": false, "status": "idle"}
	}
	pid := intFromAny(meta["pid"])
	startTime := floatFromAny(meta["start_time"], float64(time.Now().UnixNano())/1e9)
	maxDuration := floatFromAny(meta["duration"], float64(pcapDefaultDuration))
	nowFloat := float64(time.Now().UnixNano()) / 1e9
	elapsed := nowFloat - startTime

	alive := pid > 0 && isProcessAlive(pid)
	if alive && elapsed > (maxDuration+2.0) {
		if proc, err := os.FindProcess(pid); err == nil {
			_ = proc.Signal(syscall.SIGINT)
			time.Sleep(100 * time.Millisecond)
			if isProcessAlive(pid) {
				_ = proc.Signal(syscall.SIGKILL)
			}
		}
		alive = false
	}

	pcapPath, _ := meta["pcap_path"].(string)
	var fileSize int64
	if pcapPath != "" {
		if st, err := os.Stat(pcapPath); err == nil {
			fileSize = st.Size()
		}
	}

	wasActive, _ := meta["active"].(bool)
	if !alive && wasActive {
		meta["active"] = false
		meta["status"] = "completed"
		meta["stop_time"] = nowFloat
		meta["elapsed_seconds"] = round1(math.Min(elapsed, maxDuration))
		meta["file_size_bytes"] = fileSize
		saveActiveMeta(meta)
	} else if alive {
		meta["active"] = true
		meta["status"] = "running"
		meta["elapsed_seconds"] = round1(elapsed)
		meta["file_size_bytes"] = fileSize
	} else {
		meta["file_size_bytes"] = fileSize
	}

	if errLogPath, _ := meta["err_log_path"].(string); errLogPath != "" {
		if b, err := os.ReadFile(errLogPath); err == nil && len(b) > 0 {
			txt := strings.TrimSpace(string(b))
			if len(txt) > 500 {
				txt = txt[len(txt)-500:]
			}
			meta["tcpdump_output"] = txt
		}
	}
	return meta
}

func listPCAPCaptures() []map[string]any {
	capDir := getPcapCaptureDir()
	_ = os.MkdirAll(capDir, 0755)
	entries, err := os.ReadDir(capDir)
	if err != nil {
		return []map[string]any{}
	}

	type fEntry struct {
		name  string
		path  string
		size  int64
		mtime float64
	}
	var list []fEntry
	for _, e := range entries {
		if !e.IsDir() && strings.HasSuffix(e.Name(), ".pcap") {
			if info, err := e.Info(); err == nil {
				list = append(list, fEntry{
					name:  e.Name(),
					path:  filepath.Join(capDir, e.Name()),
					size:  info.Size(),
					mtime: float64(info.ModTime().UnixNano()) / 1e9,
				})
			}
		}
	}
	sort.Slice(list, func(i, j int) bool {
		return list[i].mtime > list[j].mtime
	})

	out := make([]map[string]any, 0, len(list))
	for _, item := range list {
		pktCount, durSec, _ := quickCountPCAP(item.path)
		out = append(out, map[string]any{
			"filename":         item.name,
			"size_bytes":       item.size,
			"total_packets":    pktCount,
			"duration_seconds": round2(durSec),
			"created_at":       item.mtime,
			"modified_at":      item.mtime,
		})
	}
	return out
}

func deletePCAPCapture(filename string) map[string]any {
	safe := filepath.Base(filename)
	if safe == "" || !strings.HasSuffix(safe, ".pcap") {
		return map[string]any{"error": "Invalid PCAP filename"}
	}
	target := filepath.Join(getPcapCaptureDir(), safe)
	if _, err := os.Stat(target); os.IsNotExist(err) {
		return map[string]any{"error": "Capture file not found"}
	}
	if err := os.Remove(target); err != nil {
		return map[string]any{"error": err.Error()}
	}
	return map[string]any{"success": true, "deleted": safe}
}

// parseRawPCAPRecords reads standard libpcap files (microsecond or nanosecond magic, little or big endian).
func parseRawPCAPRecords(path string) (uint32, []rawPCAPPacket, error) {
	f, err := os.Open(path)
	if err != nil {
		return 0, nil, err
	}
	defer f.Close()

	var ghdr [24]byte
	if _, err := io.ReadFull(f, ghdr[:]); err != nil {
		if err == io.EOF || err == io.ErrUnexpectedEOF {
			return 1, nil, nil
		}
		return 0, nil, err
	}

	magic := binary.LittleEndian.Uint32(ghdr[0:4])
	var bo binary.ByteOrder = binary.LittleEndian
	nano := false

	switch magic {
	case 0xa1b2c3d4:
		bo = binary.LittleEndian
		nano = false
	case 0xa1b23c4d:
		bo = binary.LittleEndian
		nano = true
	case 0xd4c3b2a1:
		bo = binary.BigEndian
		nano = false
	case 0x4d3cb2a1:
		bo = binary.BigEndian
		nano = true
	default:
		return 0, nil, fmt.Errorf("unsupported PCAP magic header: 0x%08x", magic)
	}

	linkType := bo.Uint32(ghdr[20:24])
	var pkts []rawPCAPPacket
	var rhdr [16]byte

	for {
		if _, err := io.ReadFull(f, rhdr[:]); err != nil {
			break
		}
		tsSec := bo.Uint32(rhdr[0:4])
		tsSub := bo.Uint32(rhdr[4:8])
		inclLen := bo.Uint32(rhdr[8:12])
		origLen := bo.Uint32(rhdr[12:16])

		if inclLen > 262144 {
			break
		}
		data := make([]byte, inclLen)
		if _, err := io.ReadFull(f, data); err != nil {
			break
		}
		var epoch float64
		if nano {
			epoch = float64(tsSec) + float64(tsSub)/1e9
		} else {
			epoch = float64(tsSec) + float64(tsSub)/1e6
		}
		pkts = append(pkts, rawPCAPPacket{
			TsSec:   tsSec,
			TsUsec:  tsSub,
			InclLen: inclLen,
			OrigLen: origLen,
			Data:    data,
			Epoch:   epoch,
		})
	}
	return linkType, pkts, nil
}

func quickCountPCAP(path string) (int, float64, error) {
	_, pkts, err := parseRawPCAPRecords(path)
	if err != nil || len(pkts) == 0 {
		return 0, 0, err
	}
	dur := 0.0
	if len(pkts) > 1 {
		dur = pkts[len(pkts)-1].Epoch - pkts[0].Epoch
		if dur < 0 {
			dur = 0
		}
	}
	return len(pkts), dur, nil
}

func dissectPCAPFile(pcapFile string, offset int, limit int) map[string]any {
	targetPath := pcapFile
	if targetPath == "" {
		meta := loadActiveMeta()
		if meta != nil {
			targetPath, _ = meta["pcap_path"].(string)
		}
	} else if !strings.Contains(targetPath, "/") {
		targetPath = filepath.Join(getPcapCaptureDir(), filepath.Base(targetPath))
	}

	if targetPath == "" {
		return map[string]any{"error": "PCAP file not found", "packets": []any{}, "total_packets": 0}
	}
	st, err := os.Stat(targetPath)
	if err != nil {
		return map[string]any{"error": "PCAP file not found", "packets": []any{}, "total_packets": 0}
	}
	if st.Size() < 24 {
		return map[string]any{
			"file":            filepath.Base(targetPath),
			"file_size_bytes": st.Size(),
			"total_packets":   0,
			"packets":         []any{},
		}
	}

	linkType, rawPkts, err := parseRawPCAPRecords(targetPath)
	if err != nil {
		return map[string]any{"error": fmt.Sprintf("Failed to parse PCAP: %v", err), "packets": []any{}, "total_packets": 0}
	}

	totalPackets := len(rawPkts)
	if totalPackets == 0 {
		return map[string]any{
			"file":            filepath.Base(targetPath),
			"file_size_bytes": st.Size(),
			"total_packets":   0,
			"packets":         []any{},
		}
	}

	firstTs := rawPkts[0].Epoch
	lastTs := rawPkts[totalPackets-1].Epoch
	durSec := math.Max(0, lastTs-firstTs)

	if offset < 0 {
		offset = 0
	}
	if limit <= 0 {
		limit = 200
	}
	endIdx := offset + limit
	if endIdx > totalPackets {
		endIdx = totalPackets
	}

	var dissected []map[string]any
	for idx := offset; idx < endIdx; idx++ {
		relTs := rawPkts[idx].Epoch - firstTs
		dissected = append(dissected, dissectOnePacket(linkType, rawPkts[idx], idx+1, relTs))
	}
	if dissected == nil {
		dissected = []map[string]any{}
	}

	return map[string]any{
		"file":             filepath.Base(targetPath),
		"file_size_bytes":  st.Size(),
		"total_packets":    totalPackets,
		"duration_seconds": round3(durSec),
		"offset":           offset,
		"limit":            limit,
		"count":            len(dissected),
		"packets":          dissected,
	}
}

func dissectOnePacket(linkType uint32, pkt rawPCAPPacket, seqNo int, relTs float64) map[string]any {
	raw := pkt.Data
	length := len(raw)
	src := "-"
	dst := "-"
	var sport any = nil
	var dport any = nil
	proto := "OTHER"
	info := fmt.Sprintf("Frame %d bytes", length)
	var tree []map[string]any

	l3Offset := 0
	var etherType uint16

	switch linkType {
	case 1: // DLT_EN10MB (Ethernet)
		if length >= 14 {
			dstMAC := net.HardwareAddr(raw[0:6]).String()
			srcMAC := net.HardwareAddr(raw[6:12]).String()
			etherType = binary.BigEndian.Uint16(raw[12:14])
			l3Offset = 14
			// Handle 802.1Q VLAN tag
			if etherType == 0x8100 && length >= 18 {
				etherType = binary.BigEndian.Uint16(raw[16:18])
				l3Offset = 18
			}
			src = srcMAC
			dst = dstMAC
			tree = append(tree, map[string]any{
				"layer":   "Ethernet II",
				"summary": fmt.Sprintf("Src: %s -> Dst: %s (0x%04x)", srcMAC, dstMAC, etherType),
				"fields": map[string]any{
					"Source MAC":      srcMAC,
					"Destination MAC": dstMAC,
					"EtherType":       fmt.Sprintf("0x%04x", etherType),
				},
			})
		}
	case 113: // DLT_LINUX_SLL (Linux cooked v1, used by `-i any`)
		if length >= 16 {
			pktType := binary.BigEndian.Uint16(raw[0:2])
			etherType = binary.BigEndian.Uint16(raw[14:16])
			l3Offset = 16
			tree = append(tree, map[string]any{
				"layer":   "Linux Cooked Capture (SLL)",
				"summary": fmt.Sprintf("PktType: %d, Proto: 0x%04x", pktType, etherType),
				"fields": map[string]any{
					"Packet Type": pktType,
					"Protocol":    fmt.Sprintf("0x%04x", etherType),
				},
			})
		}
	case 276: // DLT_LINUX_SLL2 (Linux cooked v2)
		if length >= 20 {
			etherType = binary.BigEndian.Uint16(raw[0:2])
			l3Offset = 20
			tree = append(tree, map[string]any{
				"layer":   "Linux Cooked Capture v2 (SLL2)",
				"summary": fmt.Sprintf("Proto: 0x%04x", etherType),
				"fields": map[string]any{
					"Protocol": fmt.Sprintf("0x%04x", etherType),
				},
			})
		}
	case 101, 12: // Raw IP
		if length >= 1 {
			v := raw[0] >> 4
			if v == 4 {
				etherType = 0x0800
			} else if v == 6 {
				etherType = 0x86dd
			}
		}
	}

	l3Data := raw[l3Offset:]

	switch etherType {
	case 0x0806: // ARP
		proto = "ARP"
		if len(l3Data) >= 28 {
			op := binary.BigEndian.Uint16(l3Data[6:8])
			sha := net.HardwareAddr(l3Data[8:14]).String()
			spa := net.IP(l3Data[14:18]).String()
			tha := net.HardwareAddr(l3Data[18:24]).String()
			tpa := net.IP(l3Data[24:28]).String()
			src = spa
			dst = tpa
			opStr := fmt.Sprintf("Opcode %d", op)
			switch op {
			case 1:
				opStr = "Request"
				info = fmt.Sprintf("Who has %s? Tell %s", tpa, spa)
			case 2:
				opStr = "Reply"
				info = fmt.Sprintf("%s is at %s", spa, sha)
			}
			tree = append(tree, map[string]any{
				"layer":   "Address Resolution Protocol (ARP)",
				"summary": fmt.Sprintf("%s (%s)", opStr, info),
				"fields": map[string]any{
					"Operation":  opStr,
					"Sender MAC": sha,
					"Sender IP":  spa,
					"Target MAC": tha,
					"Target IP":  tpa,
				},
			})
		}

	case 0x0800: // IPv4
		if len(l3Data) >= 20 {
			ihl := int(l3Data[0]&0x0f) * 4
			if ihl < 20 || len(l3Data) < ihl {
				ihl = 20
			}
			tos := l3Data[1]
			dscp := tos >> 2
			totalLen := binary.BigEndian.Uint16(l3Data[2:4])
			id := binary.BigEndian.Uint16(l3Data[4:6])
			ttl := l3Data[8]
			ipProto := l3Data[9]
			srcIP := net.IP(l3Data[12:16]).String()
			dstIP := net.IP(l3Data[16:20]).String()
			src = srcIP
			dst = dstIP

			tree = append(tree, map[string]any{
				"layer":   "Internet Protocol Version 4 (IPv4)",
				"summary": fmt.Sprintf("%s -> %s (TTL=%d, DSCP=%d, Len=%d)", srcIP, dstIP, ttl, dscp, totalLen),
				"fields": map[string]any{
					"Source IP":      srcIP,
					"Destination IP": dstIP,
					"TTL":            int(ttl),
					"DSCP":           int(dscp),
					"Total Length":   int(totalLen),
					"Identification": fmt.Sprintf("0x%04x", id),
					"Protocol":       int(ipProto),
				},
			})

			l4Data := l3Data[ihl:]
			proto, sport, dport, info, tree = dissectL4(ipProto, l4Data, tree)
		}

	case 0x86dd: // IPv6
		if len(l3Data) >= 40 {
			nextHdr := l3Data[6]
			hopLimit := l3Data[7]
			srcIP := net.IP(l3Data[8:24]).String()
			dstIP := net.IP(l3Data[24:40]).String()
			src = srcIP
			dst = dstIP
			proto = "IPv6"
			info = fmt.Sprintf("IPv6 NextHeader=%d", nextHdr)

			tree = append(tree, map[string]any{
				"layer":   "Internet Protocol Version 6 (IPv6)",
				"summary": fmt.Sprintf("%s -> %s (HopLimit=%d)", srcIP, dstIP, hopLimit),
				"fields": map[string]any{
					"Source IPv6":      srcIP,
					"Destination IPv6": dstIP,
					"Hop Limit":        int(hopLimit),
					"Next Header":      int(nextHdr),
				},
			})

			l4Data := l3Data[40:]
			p4, sp, dp, inf, tr := dissectL4(nextHdr, l4Data, tree)
			if p4 != "OTHER" {
				proto, sport, dport, info, tree = p4, sp, dp, inf, tr
			}
		}
	}

	return map[string]any{
		"no":          seqNo,
		"time":        round6(relTs),
		"epoch":       round6(pkt.Epoch),
		"source":      src,
		"sport":       sport,
		"destination": dst,
		"dport":       dport,
		"protocol":    proto,
		"length":      length,
		"info":        info,
		"tree":        tree,
		"hex_dump":    formatHexDump(raw, 512),
	}
}

func dissectL4(ipProto uint8, l4Data []byte, tree []map[string]any) (string, any, any, string, []map[string]any) {
	switch ipProto {
	case 1: // ICMP
		proto := "ICMP"
		info := "ICMP Packet"
		if len(l4Data) >= 4 {
			icmpType := l4Data[0]
			icmpCode := l4Data[1]
			var id, seq uint16
			if len(l4Data) >= 8 {
				id = binary.BigEndian.Uint16(l4Data[4:6])
				seq = binary.BigEndian.Uint16(l4Data[6:8])
			}
			typeNames := map[uint8]string{
				0:  "Echo (ping) reply",
				3:  "Destination unreachable",
				5:  "Redirect",
				8:  "Echo (ping) request",
				11: "Time-to-live exceeded",
			}
			tDesc, ok := typeNames[icmpType]
			if !ok {
				tDesc = fmt.Sprintf("Type %d", icmpType)
			}
			info = fmt.Sprintf("%s (code=%d, id=%d, seq=%d)", tDesc, icmpCode, id, seq)
			tree = append(tree, map[string]any{
				"layer":   "Internet Control Message Protocol (ICMP)",
				"summary": info,
				"fields": map[string]any{
					"Type":       fmt.Sprintf("%d (%s)", icmpType, tDesc),
					"Code":       int(icmpCode),
					"Identifier": int(id),
					"Sequence":   int(seq),
				},
			})
		}
		return proto, nil, nil, info, tree

	case 6: // TCP
		proto := "TCP"
		if len(l4Data) < 20 {
			return proto, nil, nil, "TCP [Truncated]", tree
		}
		sp := int(binary.BigEndian.Uint16(l4Data[0:2]))
		dp := int(binary.BigEndian.Uint16(l4Data[2:4]))
		seq := binary.BigEndian.Uint32(l4Data[4:8])
		ack := binary.BigEndian.Uint32(l4Data[8:12])
		dataOff := int(l4Data[12]>>4) * 4
		if dataOff < 20 || len(l4Data) < dataOff {
			dataOff = 20
		}
		flags := l4Data[13]
		win := binary.BigEndian.Uint16(l4Data[14:16])

		var flagNames []string
		if flags&0x02 != 0 {
			flagNames = append(flagNames, "SYN")
		}
		if flags&0x10 != 0 {
			flagNames = append(flagNames, "ACK")
		}
		if flags&0x01 != 0 {
			flagNames = append(flagNames, "FIN")
		}
		if flags&0x04 != 0 {
			flagNames = append(flagNames, "RST")
		}
		if flags&0x08 != 0 {
			flagNames = append(flagNames, "PSH")
		}
		flagStr := strings.Join(flagNames, ", ")
		payload := l4Data[dataOff:]
		payloadLen := len(payload)

		info := fmt.Sprintf("%d -> %d [%s] Seq=%d Ack=%d Win=%d Len=%d", sp, dp, flagStr, seq, ack, win, payloadLen)
		tree = append(tree, map[string]any{
			"layer":   "Transmission Control Protocol (TCP)",
			"summary": fmt.Sprintf("Src Port: %d -> Dst Port: %d [%s]", sp, dp, flagStr),
			"fields": map[string]any{
				"Source Port":      sp,
				"Destination Port": dp,
				"Flags":            flagStr,
				"Sequence Number":  seq,
				"Ack Number":       ack,
				"Window Size":      int(win),
				"Payload Length":   payloadLen,
			},
		})

		if payloadLen > 0 {
			headLen := payloadLen
			if headLen > 256 {
				headLen = 256
			}
			headStr := string(payload[:headLen])
			if strings.HasPrefix(headStr, "GET ") || strings.HasPrefix(headStr, "POST ") || strings.HasPrefix(headStr, "PUT ") || strings.HasPrefix(headStr, "DELETE ") || strings.HasPrefix(headStr, "HEAD ") || strings.HasPrefix(headStr, "HTTP/1.") {
				proto = "HTTP"
				firstLine := strings.Split(strings.ReplaceAll(headStr, "\r\n", "\n"), "\n")[0]
				if len(firstLine) > 100 {
					firstLine = firstLine[:100]
				}
				info = firstLine
				tree = append(tree, map[string]any{
					"layer":   "Hypertext Transfer Protocol (HTTP)",
					"summary": firstLine,
					"fields":  map[string]any{"Payload Preview": headStr},
				})
			} else if dp == 443 || sp == 443 {
				proto = "TLS"
				if payloadLen > 5 && payload[0] == 0x16 {
					info = fmt.Sprintf("TLS Handshake (%d -> %d, %d bytes)", sp, dp, payloadLen)
				} else if payloadLen > 5 && payload[0] == 0x17 {
					info = fmt.Sprintf("TLS Application Data (%d -> %d, %d bytes)", sp, dp, payloadLen)
				}
			} else if dp == 179 || sp == 179 {
				proto = "BGP"
				info = fmt.Sprintf("BGP Message (%d -> %d, %d bytes)", sp, dp, payloadLen)
			}
		}

		return proto, sp, dp, info, tree

	case 17: // UDP
		proto := "UDP"
		if len(l4Data) < 8 {
			return proto, nil, nil, "UDP [Truncated]", tree
		}
		sp := int(binary.BigEndian.Uint16(l4Data[0:2]))
		dp := int(binary.BigEndian.Uint16(l4Data[2:4]))
		uLen := int(binary.BigEndian.Uint16(l4Data[4:6]))
		payload := l4Data[8:]
		payloadLen := len(payload)

		info := fmt.Sprintf("%d -> %d Len=%d", sp, dp, payloadLen)
		tree = append(tree, map[string]any{
			"layer":   "User Datagram Protocol (UDP)",
			"summary": fmt.Sprintf("Src Port: %d -> Dst Port: %d (Len=%d)", sp, dp, payloadLen),
			"fields": map[string]any{
				"Source Port":      sp,
				"Destination Port": dp,
				"UDP Length":       uLen,
				"Payload Length":   payloadLen,
			},
		})

		if sp == 53 || dp == 53 {
			proto = "DNS"
			qname, qr := parseDNSPayloadSummary(payload)
			if qr == 0 {
				info = fmt.Sprintf("Standard query %s", qname)
			} else {
				info = fmt.Sprintf("Standard query response %s", qname)
			}
			tree = append(tree, map[string]any{
				"layer":   "Domain Name System (DNS)",
				"summary": info,
				"fields": map[string]any{
					"Type":       map[int]string{0: "Query", 1: "Response"}[qr],
					"Query Name": qname,
				},
			})
		} else if sp == 6100 || dp == 6100 || sp == 6200 || dp == 6200 {
			proto = "STIGIX-VOICE"
			headLen := payloadLen
			if headLen > 120 {
				headLen = 120
			}
			asciiPart := toPrintableASCII(payload[:headLen])
			if strings.Contains(asciiPart, "CONV:") {
				proto = "STIGIX-CONV"
				info = fmt.Sprintf("Convergence Probe (%d -> %d) %s", sp, dp, truncateStr(asciiPart, 70))
			} else if strings.Contains(asciiPart, "CID:") || strings.Contains(asciiPart, "CALL-") || strings.Contains(asciiPart, "TEST-") {
				info = fmt.Sprintf("RTP Voice / Echo (%d -> %d) %s", sp, dp, truncateStr(asciiPart, 70))
			} else {
				info = fmt.Sprintf("Stigix UDP Stream (%d -> %d, %dB)", sp, dp, payloadLen)
			}
			tree = append(tree, map[string]any{
				"layer":   "Stigix SD-WAN Telemetry / RTP",
				"summary": info,
				"fields":  map[string]any{"Tag Header": truncateStr(asciiPart, 120)},
			})
		} else if sp == 500 || dp == 500 || sp == 4500 || dp == 4500 {
			proto = "IKE/IPsec"
			info = fmt.Sprintf("IKEv2 / NAT-T (%d -> %d, %dB)", sp, dp, payloadLen)
		} else if sp == 3784 || dp == 3784 || sp == 3785 || dp == 3785 || sp == 4784 || dp == 4784 {
			proto = "BFD"
			info = fmt.Sprintf("BFD Control Packet (%d -> %d)", sp, dp)
		} else if sp == 67 || dp == 67 || sp == 68 || dp == 68 {
			proto = "DHCP"
			info = fmt.Sprintf("DHCP Message (%d -> %d)", sp, dp)
		} else if sp == 123 || dp == 123 {
			proto = "NTP"
			info = fmt.Sprintf("NTP Time Sync (%d -> %d)", sp, dp)
		} else if sp == 47808 || dp == 47808 {
			proto = "BACnet"
			info = fmt.Sprintf("BACnet/IP IoT Broadcast (%d -> %d)", sp, dp)
		}

		return proto, sp, dp, info, tree

	case 50:
		return "ESP", nil, nil, fmt.Sprintf("IPsec Encapsulating Security Payload (%d bytes)", len(l4Data)), tree
	default:
		return fmt.Sprintf("IP-Proto-%d", ipProto), nil, nil, fmt.Sprintf("IP Protocol %d (%d bytes)", ipProto, len(l4Data)), tree
	}
}

func parseDNSPayloadSummary(payload []byte) (string, int) {
	if len(payload) < 12 {
		return "(truncated)", 0
	}
	flags := binary.BigEndian.Uint16(payload[2:4])
	qr := int((flags >> 15) & 0x1)
	qdCount := binary.BigEndian.Uint16(payload[4:6])
	if qdCount == 0 {
		return "(no question)", qr
	}
	pos := 12
	var labels []string
	for pos < len(payload) && payload[pos] != 0 {
		l := int(payload[pos])
		if (l & 0xc0) == 0xc0 {
			break
		}
		pos++
		if pos+l > len(payload) {
			break
		}
		labels = append(labels, string(payload[pos:pos+l]))
		pos += l
	}
	if len(labels) == 0 {
		return ".", qr
	}
	return strings.Join(labels, "."), qr
}

func toPrintableASCII(b []byte) string {
	var buf bytes.Buffer
	for _, c := range b {
		if c >= 32 && c < 127 {
			buf.WriteByte(c)
		}
	}
	return buf.String()
}

func truncateStr(s string, maxLen int) string {
	if len(s) <= maxLen {
		return s
	}
	return s[:maxLen]
}

func formatHexDump(raw []byte, maxBytes int) []map[string]any {
	if len(raw) > maxBytes {
		raw = raw[:maxBytes]
	}
	var lines []map[string]any
	for i := 0; i < len(raw); i += 16 {
		chunk := raw[i:]
		if len(chunk) > 16 {
			chunk = chunk[:16]
		}
		hexParts := make([]string, len(chunk))
		var asciiBuf bytes.Buffer
		for j, b := range chunk {
			hexParts[j] = fmt.Sprintf("%02x", b)
			if b >= 32 && b < 127 {
				asciiBuf.WriteByte(b)
			} else {
				asciiBuf.WriteByte('.')
			}
		}
		lines = append(lines, map[string]any{
			"offset": fmt.Sprintf("%04x", i),
			"hex":    strings.Join(hexParts, " "),
			"ascii":  asciiBuf.String(),
		})
	}
	if lines == nil {
		lines = []map[string]any{}
	}
	return lines
}

func intFromAny(v any) int {
	switch val := v.(type) {
	case int:
		return val
	case int64:
		return int(val)
	case float64:
		return int(val)
	case string:
		i, _ := strconv.Atoi(val)
		return i
	default:
		return 0
	}
}

func floatFromAny(v any, def float64) float64 {
	switch val := v.(type) {
	case float64:
		return val
	case int:
		return float64(val)
	case int64:
		return float64(val)
	default:
		return def
	}
}

func round3(v float64) float64 {
	return math.Round(v*1000) / 1000
}

func round6(v float64) float64 {
	return math.Round(v*1e6) / 1e6
}
