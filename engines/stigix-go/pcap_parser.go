package main

import (
	"archive/zip"
	"compress/gzip"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
)

var (
	noisePorts = map[int]bool{
		53:   true,
		123:  true,
		137:  true,
		138:  true,
		161:  true,
		1900: true,
		5353: true,
		5355: true,
	}
	reAuthHeader   = regexp.MustCompile(`(?im)^(Authorization:\s*[^\r\n]+)`)
	reCookieHeader = regexp.MustCompile(`(?im)^(Cookie:\s*[^\r\n]+)`)
	reSetCookie    = regexp.MustCompile(`(?im)^(Set-Cookie:\s*[^\r\n]+)`)
)

type parsedL4Segment struct {
	timestamp float64
	srcIP     string
	dstIP     string
	srcPort   int
	dstPort   int
	proto     string // "TCP" or "UDP"
	tcpSeq    uint32
	tcpFlags  uint8
	payload   []byte
}

type flowCandidate struct {
	FlowID         string               `json:"flow_id"`
	Proto          string               `json:"proto"`
	ClientIP       string               `json:"client_ip"`
	ClientPort     int                  `json:"client_port"`
	ServerIP       string               `json:"server_ip"`
	ServerPort     int                  `json:"server_port"`
	PacketCount    int                  `json:"packet_count"`
	PayloadBytes   int                  `json:"payload_bytes"`
	HasSYN         bool                 `json:"has_syn"`
	IsNoise        bool                 `json:"is_noise"`
	Score          int                  `json:"score"`
	PayloadPreview string               `json:"payload_preview"`
	Warnings       []string             `json:"warnings"`
	segments       []parsedL4Segment
}

type ReplayTurn struct {
	Turn           int    `json:"turn"`
	Dir            string `json:"dir"`
	Action         string `json:"action"`
	DataB64        string `json:"data_b64,omitempty"`
	Length         int    `json:"length,omitempty"`
	DelayMS        int    `json:"delay_ms,omitempty"`
	ExpectBytes    int    `json:"expect_bytes,omitempty"`
	TimeoutMS      int    `json:"timeout_ms,omitempty"`
	MatchPrefixB64 string `json:"match_prefix_b64,omitempty"`
}

type ReplayProfile struct {
	SchemaVersion  string           `json:"schema_version"`
	ID             string           `json:"id,omitempty"`
	Name           string           `json:"name,omitempty"`
	Category       string           `json:"category,omitempty"`
	Description    string           `json:"description,omitempty"`
	ReplaySettings map[string]any   `json:"replay_settings,omitempty"`
	Metadata       map[string]any   `json:"metadata"`
	Flow           map[string]any   `json:"flow"`
	Turns          []ReplayTurn     `json:"turns"`
	Flows          []map[string]any `json:"flows,omitempty"`
}

func runPcapParseCLI(args []string) {
	var (
		inputFile string
		outPath   string
		name      string
		category  = "Custom"
		appID     string
		threatID  string
		portOvr   int
		scrub     bool
		inspect   bool
		jsonOut   bool
		password  string
		flowID    string
	)

	// Flexible flag parser allowing positional input file anywhere in args
	for i := 0; i < len(args); i++ {
		arg := args[i]
		switch arg {
		case "--inspect":
			inspect = true
		case "--json":
			jsonOut = true
		case "--scrub":
			scrub = true
		case "--out", "-o":
			if i+1 < len(args) {
				outPath = args[i+1]
				i++
			}
		case "--name":
			if i+1 < len(args) {
				name = args[i+1]
				i++
			}
		case "--category":
			if i+1 < len(args) {
				category = args[i+1]
				i++
			}
		case "--app-id":
			if i+1 < len(args) {
				appID = args[i+1]
				i++
			}
		case "--threat-id":
			if i+1 < len(args) {
				threatID = args[i+1]
				i++
			}
		case "--port":
			if i+1 < len(args) {
				portOvr, _ = strconv.Atoi(args[i+1])
				i++
			}
		case "--password":
			if i+1 < len(args) {
				password = args[i+1]
				i++
			}
		case "--flow-id":
			if i+1 < len(args) {
				flowID = args[i+1]
				i++
			}
		default:
			if !strings.HasPrefix(arg, "-") && inputFile == "" {
				inputFile = arg
			}
		}
	}

	emitErr := func(msg string) {
		if jsonOut {
			printJSONResult(map[string]any{"status": "error", "error": msg})
		} else {
			fmt.Fprintf(os.Stderr, "[ERROR] %s\n", msg)
		}
		os.Exit(1)
	}

	if inputFile == "" {
		emitErr("Missing input PCAP/ZIP file path")
	}
	if _, err := os.Stat(inputFile); err != nil {
		emitErr(fmt.Sprintf("File not found: %s", inputFile))
	}

	actualPcap, cleanupDir, err := unpackIfZip(inputFile, password)
	if cleanupDir != "" {
		defer os.RemoveAll(cleanupDir)
	}
	if err != nil {
		emitErr(err.Error())
	}

	segments, err := extractL4SegmentsFromFile(actualPcap)
	if err != nil {
		emitErr(fmt.Sprintf("Failed to parse PCAP: %v", err))
	}
	if len(segments) == 0 {
		emitErr("No valid TCP or UDP packets found in capture")
	}

	flows := buildFlowCandidates(segments)
	if len(flows) == 0 {
		emitErr("No valid TCP or UDP flows with payload found in capture")
	}

	if inspect && outPath == "" {
		res := map[string]any{
			"status":        "success",
			"source_pcap":   filepath.Base(inputFile),
			"flows":         stripFlowSegments(flows),
			"selected_flow": stripOneFlow(flows[0]),
		}
		if jsonOut {
			printJSONResult(res)
		} else {
			b, _ := json.MarshalIndent(res, "", "  ")
			fmt.Println(string(b))
		}
		return
	}

	selected := flows[0]
	if flowID != "" {
		found := false
		for _, f := range flows {
			if f.FlowID == flowID {
				selected = f
				found = true
				break
			}
		}
		if !found {
			emitErr(fmt.Sprintf("Requested flow_id '%s' not found in PCAP", flowID))
		}
	}

	turns, totalBytes := compileFlowTurns(selected, scrub)
	if len(turns) == 0 {
		emitErr("Selected flow produced 0 actionable payload turns")
	}

	defaultPort := selected.ServerPort
	if portOvr > 0 {
		defaultPort = portOvr
	}
	profileName := name
	if profileName == "" {
		profileName = strings.TrimSuffix(filepath.Base(inputFile), filepath.Ext(inputFile))
	}
	profileID := fmt.Sprintf("prof-%d", time.Now().Unix())

	profile := ReplayProfile{
		SchemaVersion: "1.0",
		ID:            profileID,
		Name:          profileName,
		Category:      category,
		Metadata: map[string]any{
			"name":            profileName,
			"source_pcap":     filepath.Base(inputFile),
			"created_at":      time.Now().UTC().Format(time.RFC3339),
			"category":        category,
			"expected_app_id": emptyToNil(appID),
			"threat_id":       emptyToNil(threatID),
			"scrubbed":        scrub,
			"warnings":        selected.Warnings,
		},
		Flow: map[string]any{
			"proto":             selected.Proto,
			"original_src_ip":   selected.ClientIP,
			"original_src_port": selected.ClientPort,
			"original_dst_ip":   selected.ServerIP,
			"original_dst_port": selected.ServerPort,
			"default_port":      defaultPort,
			"total_turns":       len(turns),
			"total_bytes":       totalBytes,
		},
		Turns: turns,
		Flows: []map[string]any{
			{
				"flow_id":     selected.FlowID,
				"transport":   selected.Proto,
				"client_ip":   selected.ClientIP,
				"client_port": selected.ClientPort,
				"server_ip":   selected.ServerIP,
				"server_port": defaultPort,
				"turns":       turns,
			},
		},
	}

	if outPath != "" {
		_ = os.MkdirAll(filepath.Dir(outPath), 0755)
		if err := writeGzipProfile(outPath, profile); err != nil {
			emitErr(fmt.Sprintf("Failed to write profile: %v", err))
		}
	}

	previewTurns := turns
	if len(previewTurns) > 10 {
		previewTurns = previewTurns[:10]
	}

	summary := map[string]any{
		"status":        "success",
		"profile_id":    profileID,
		"profile_path":  emptyToNil(outPath),
		"selected_flow": stripOneFlow(selected),
		"turns_count":   len(turns),
		"total_bytes":   totalBytes,
		"warnings":      selected.Warnings,
		"metadata":      profile.Metadata,
		"turns_preview": previewTurns,
	}
	if jsonOut {
		printJSONResult(summary)
	} else {
		b, _ := json.MarshalIndent(summary, "", "  ")
		fmt.Println(string(b))
	}
}

func emptyToNil(s string) any {
	if s == "" {
		return nil
	}
	return s
}

func writeGzipProfile(path string, profile ReplayProfile) error {
	f, err := os.Create(path)
	if err != nil {
		return err
	}
	defer f.Close()

	gw := gzip.NewWriter(f)
	defer gw.Close()

	enc := json.NewEncoder(gw)
	enc.SetIndent("", "  ")
	return enc.Encode(profile)
}

func unpackIfZip(filePath string, password string) (string, string, error) {
	f, err := os.Open(filePath)
	if err != nil {
		return "", "", err
	}
	var magic [4]byte
	_, _ = io.ReadFull(f, magic[:])
	_ = f.Close()

	isZip := (magic[0] == 'P' && magic[1] == 'K' && magic[2] == 3 && magic[3] == 4) || strings.HasSuffix(strings.ToLower(filePath), ".zip")
	if !isZip {
		return filePath, "", nil
	}

	tmpDir, err := os.MkdirTemp("", "stigix_pcap_zip_*")
	if err != nil {
		return "", "", err
	}

	// If password is provided (e.g. "infected" for malware PCAPs), try system `unzip -P` or `7z` first because standard Go archive/zip does not decrypt encrypted ZIP entries natively.
	if password != "" {
		_ = exec.Command("unzip", "-o", "-P", password, filePath, "-d", tmpDir).Run()
	} else {
		// Try standard Go archive/zip
		if zr, err := zip.OpenReader(filePath); err == nil {
			for _, zf := range zr.File {
				if zf.FileInfo().IsDir() {
					continue
				}
				rc, err := zf.Open()
				if err != nil {
					continue
				}
				dstPath := filepath.Join(tmpDir, filepath.Base(zf.Name))
				if outF, err := os.Create(dstPath); err == nil {
					_, _ = io.Copy(outF, rc)
					_ = outF.Close()
				}
				_ = rc.Close()
			}
			_ = zr.Close()
		}
	}

	found := findPCAPInDir(tmpDir)
	if found == "" && password == "" {
		// Fallback to password "infected" via unzip
		_ = exec.Command("unzip", "-o", "-P", "infected", filePath, "-d", tmpDir).Run()
		found = findPCAPInDir(tmpDir)
	}
	if found == "" {
		return "", tmpDir, fmt.Errorf("no valid .pcap/.pcapng file found inside ZIP archive (or ZIP is password-protected)")
	}
	return found, tmpDir, nil
}

func findPCAPInDir(dir string) string {
	var best string
	_ = filepath.Walk(dir, func(path string, info os.FileInfo, err error) error {
		if err != nil || info.IsDir() {
			return nil
		}
		lower := strings.ToLower(info.Name())
		if strings.HasSuffix(lower, ".pcap") || strings.HasSuffix(lower, ".pcapng") || strings.HasSuffix(lower, ".cap") {
			best = path
			return io.EOF
		}
		return nil
	})
	if best != "" {
		return best
	}
	// Pick first non-hidden file
	_ = filepath.Walk(dir, func(path string, info os.FileInfo, err error) error {
		if err != nil || info.IsDir() || strings.HasPrefix(info.Name(), ".") {
			return nil
		}
		best = path
		return io.EOF
	})
	return best
}

func extractL4SegmentsFromFile(path string) ([]parsedL4Segment, error) {
	linkType, rawPkts, err := parseRawPCAPRecordsOrPCAPNG(path)
	if err != nil {
		return nil, err
	}

	var segments []parsedL4Segment
	for _, pkt := range rawPkts {
		seg, ok := parseL4Segment(linkType, pkt)
		if ok {
			segments = append(segments, seg)
		}
	}
	return segments, nil
}

func parseRawPCAPRecordsOrPCAPNG(path string) (uint32, []rawPCAPPacket, error) {
	f, err := os.Open(path)
	if err != nil {
		return 0, nil, err
	}
	var magicBuf [4]byte
	if _, err := io.ReadFull(f, magicBuf[:]); err != nil {
		_ = f.Close()
		return 0, nil, err
	}
	_ = f.Close()

	magic := binary.LittleEndian.Uint32(magicBuf[:])
	if magic == 0x0a0d0d0a {
		return parsePCAPNGFile(path)
	}
	return parseRawPCAPRecords(path)
}

func parsePCAPNGFile(path string) (uint32, []rawPCAPPacket, error) {
	f, err := os.Open(path)
	if err != nil {
		return 0, nil, err
	}
	defer f.Close()

	var linkType uint32 = 1
	var pkts []rawPCAPPacket
	var bhdr [8]byte

	for {
		if _, err := io.ReadFull(f, bhdr[:]); err != nil {
			break
		}
		bType := binary.LittleEndian.Uint32(bhdr[0:4])
		bTotalLen := binary.LittleEndian.Uint32(bhdr[4:8])
		if bTotalLen < 12 || bTotalLen > 1048576 {
			break
		}
		bodyLen := int(bTotalLen) - 8
		body := make([]byte, bodyLen)
		if _, err := io.ReadFull(f, body); err != nil {
			break
		}

		switch bType {
		case 0x00000001: // Interface Description Block
			if len(body) >= 8 {
				linkType = uint32(binary.LittleEndian.Uint16(body[0:2]))
			}
		case 0x00000006: // Enhanced Packet Block (EPB)
			if len(body) >= 24 {
				tsHigh := uint64(binary.LittleEndian.Uint32(body[4:8]))
				tsLow := uint64(binary.LittleEndian.Uint32(body[8:12]))
				capLen := binary.LittleEndian.Uint32(body[12:16])
				origLen := binary.LittleEndian.Uint32(body[16:20])
				if int(20+capLen) <= len(body) {
					tsMicro := (tsHigh << 32) | tsLow
					epoch := float64(tsMicro) / 1e6
					data := make([]byte, capLen)
					copy(data, body[20:20+capLen])
					pkts = append(pkts, rawPCAPPacket{
						InclLen: capLen,
						OrigLen: origLen,
						Data:    data,
						Epoch:   epoch,
					})
				}
			}
		}
	}
	return linkType, pkts, nil
}

func parseL4Segment(linkType uint32, pkt rawPCAPPacket) (parsedL4Segment, bool) {
	raw := pkt.Data
	l3Offset := 0
	var etherType uint16

	switch linkType {
	case 1:
		if len(raw) < 14 {
			return parsedL4Segment{}, false
		}
		etherType = binary.BigEndian.Uint16(raw[12:14])
		l3Offset = 14
		if etherType == 0x8100 && len(raw) >= 18 {
			etherType = binary.BigEndian.Uint16(raw[16:18])
			l3Offset = 18
		}
	case 113:
		if len(raw) < 16 {
			return parsedL4Segment{}, false
		}
		etherType = binary.BigEndian.Uint16(raw[14:16])
		l3Offset = 16
	case 276:
		if len(raw) < 20 {
			return parsedL4Segment{}, false
		}
		etherType = binary.BigEndian.Uint16(raw[0:2])
		l3Offset = 20
	case 101, 12:
		if len(raw) >= 1 && (raw[0]>>4) == 4 {
			etherType = 0x0800
		}
	default:
		if len(raw) >= 14 {
			etherType = binary.BigEndian.Uint16(raw[12:14])
			l3Offset = 14
		}
	}

	if etherType != 0x0800 {
		return parsedL4Segment{}, false
	}
	l3 := raw[l3Offset:]
	if len(l3) < 20 {
		return parsedL4Segment{}, false
	}
	ihl := int(l3[0]&0x0f) * 4
	if ihl < 20 || len(l3) < ihl {
		return parsedL4Segment{}, false
	}
	totalLen := int(binary.BigEndian.Uint16(l3[2:4]))
	if totalLen > len(l3) || totalLen < ihl {
		totalLen = len(l3)
	}
	ipProto := l3[9]
	srcIP := net.IP(l3[12:16]).String()
	dstIP := net.IP(l3[16:20]).String()
	l4 := l3[ihl:totalLen]

	switch ipProto {
	case 6: // TCP
		if len(l4) < 20 {
			return parsedL4Segment{}, false
		}
		sp := int(binary.BigEndian.Uint16(l4[0:2]))
		dp := int(binary.BigEndian.Uint16(l4[2:4]))
		seq := binary.BigEndian.Uint32(l4[4:8])
		dataOff := int(l4[12]>>4) * 4
		if dataOff < 20 || len(l4) < dataOff {
			return parsedL4Segment{}, false
		}
		flags := l4[13]
		payload := make([]byte, len(l4)-dataOff)
		copy(payload, l4[dataOff:])
		return parsedL4Segment{
			timestamp: pkt.Epoch,
			srcIP:     srcIP,
			dstIP:     dstIP,
			srcPort:   sp,
			dstPort:   dp,
			proto:     "TCP",
			tcpSeq:    seq,
			tcpFlags:  flags,
			payload:   payload,
		}, true

	case 17: // UDP
		if len(l4) < 8 {
			return parsedL4Segment{}, false
		}
		sp := int(binary.BigEndian.Uint16(l4[0:2]))
		dp := int(binary.BigEndian.Uint16(l4[2:4]))
		payload := make([]byte, len(l4)-8)
		copy(payload, l4[8:])
		return parsedL4Segment{
			timestamp: pkt.Epoch,
			srcIP:     srcIP,
			dstIP:     dstIP,
			srcPort:   sp,
			dstPort:   dp,
			proto:     "UDP",
			payload:   payload,
		}, true
	}

	return parsedL4Segment{}, false
}

func canonicalFlowKey(seg parsedL4Segment) string {
	epA := fmt.Sprintf("%s:%d", seg.srcIP, seg.srcPort)
	epB := fmt.Sprintf("%s:%d", seg.dstIP, seg.dstPort)
	if epA <= epB {
		return fmt.Sprintf("%s|%s<->%s", seg.proto, epA, epB)
	}
	return fmt.Sprintf("%s|%s<->%s", seg.proto, epB, epA)
}

func isNoiseTraffic(ipA string, portA int, ipB string, portB int) bool {
	if noisePorts[portA] || noisePorts[portB] {
		return true
	}
	for _, ipStr := range []string{ipA, ipB} {
		if ipStr == "255.255.255.255" || strings.HasPrefix(ipStr, "224.") || strings.HasPrefix(ipStr, "239.") {
			return true
		}
	}
	return false
}

func buildFlowCandidates(segments []parsedL4Segment) []flowCandidate {
	grouped := make(map[string][]parsedL4Segment)
	var keys []string
	for _, seg := range segments {
		k := canonicalFlowKey(seg)
		if _, exists := grouped[k]; !exists {
			keys = append(keys, k)
		}
		grouped[k] = append(grouped[k], seg)
	}

	var candidates []flowCandidate
	for _, k := range keys {
		segs := grouped[k]
		if len(segs) == 0 {
			continue
		}
		proto := segs[0].proto
		var clientIP, serverIP string
		var clientPort, serverPort int
		hasSYN := false

		if proto == "TCP" {
			for _, s := range segs {
				if (s.tcpFlags&0x02 != 0) && (s.tcpFlags&0x10 == 0) {
					clientIP, clientPort = s.srcIP, s.srcPort
					serverIP, serverPort = s.dstIP, s.dstPort
					hasSYN = true
					break
				}
			}
		}

		if clientIP == "" {
			first := segs[0]
			if first.srcPort > first.dstPort {
				clientIP, clientPort = first.srcIP, first.srcPort
				serverIP, serverPort = first.dstIP, first.dstPort
			} else if first.dstPort > first.srcPort {
				clientIP, clientPort = first.dstIP, first.dstPort
				serverIP, serverPort = first.srcIP, first.srcPort
			} else {
				clientIP, clientPort = first.srcIP, first.srcPort
				serverIP, serverPort = first.dstIP, first.dstPort
			}
		}

		var totalPayload int
		var firstPreview []byte
		for _, s := range segs {
			totalPayload += len(s.payload)
			if len(firstPreview) < 64 && len(s.payload) > 0 {
				need := 64 - len(firstPreview)
				if need > len(s.payload) {
					need = len(s.payload)
				}
				firstPreview = append(firstPreview, s.payload[:need]...)
			}
		}

		if totalPayload == 0 {
			continue
		}

		noise := isNoiseTraffic(clientIP, clientPort, serverIP, serverPort)
		var warnings []string
		if proto == "TCP" && !hasSYN {
			warnings = append(warnings, "Mid-stream capture detected (missing TCP SYN). Flow direction inferred from port heuristics.")
		}
		if serverPort == 443 || serverPort == 8443 {
			warnings = append(warnings, "Encrypted TLS port detected. Replay will reproduce raw TLS handshake bytes (useful for SNI/cert inspection), not decrypted HTTP.")
		}
		if warnings == nil {
			warnings = []string{}
		}

		score := totalPayload
		if proto == "TCP" {
			score += 10000
		}
		if hasSYN {
			score += 5000
		}
		if noise {
			score -= 100000
		}

		candidates = append(candidates, flowCandidate{
			FlowID:         fmt.Sprintf("%s_%s:%d_%s:%d", proto, clientIP, clientPort, serverIP, serverPort),
			Proto:          proto,
			ClientIP:       clientIP,
			ClientPort:     clientPort,
			ServerIP:       serverIP,
			ServerPort:     serverPort,
			PacketCount:    len(segs),
			PayloadBytes:   totalPayload,
			HasSYN:         hasSYN,
			IsNoise:        noise,
			Score:          score,
			PayloadPreview: toPrintableASCII(firstPreview),
			Warnings:       warnings,
			segments:       segs,
		})
	}

	sort.Slice(candidates, func(i, j int) bool {
		return candidates[i].Score > candidates[j].Score
	})
	return candidates
}

func scrubSensitiveBytes(data []byte) []byte {
	res := reAuthHeader.ReplaceAll(data, []byte("Authorization: Bearer STIGIX-SCRUBBED-TOKEN"))
	res = reCookieHeader.ReplaceAll(res, []byte("Cookie: STIGIX_SESSION=REDACTED"))
	res = reSetCookie.ReplaceAll(res, []byte("Set-Cookie: STIGIX_SESSION=REDACTED"))
	return res
}

func compileFlowTurns(flow flowCandidate, scrub bool) ([]ReplayTurn, int) {
	seenSeq := map[string]map[uint32]int{
		"c2s": {},
		"s2c": {},
	}

	type rawTurn struct {
		dir     string
		payload []byte
		firstTs float64
		lastTs  float64
	}
	var merged []rawTurn

	for _, seg := range flow.segments {
		if len(seg.payload) == 0 {
			continue
		}
		dir := "s2c"
		if seg.srcIP == flow.ClientIP && seg.srcPort == flow.ClientPort {
			dir = "c2s"
		}

		if flow.Proto == "TCP" {
			if prevLen, exists := seenSeq[dir][seg.tcpSeq]; exists && len(seg.payload) <= prevLen {
				continue
			}
			seenSeq[dir][seg.tcpSeq] = len(seg.payload)
		}

		payload := seg.payload
		if scrub {
			payload = scrubSensitiveBytes(payload)
		}

		if len(merged) > 0 && merged[len(merged)-1].dir == dir {
			last := &merged[len(merged)-1]
			last.payload = append(last.payload, payload...)
			last.lastTs = seg.timestamp
		} else {
			buf := make([]byte, len(payload))
			copy(buf, payload)
			merged = append(merged, rawTurn{
				dir:     dir,
				payload: buf,
				firstTs: seg.timestamp,
				lastTs:  seg.timestamp,
			})
		}
	}

	var turns []ReplayTurn
	totalBytes := 0
	var prevTs float64

	for idx, rt := range merged {
		delayMS := 0
		if idx > 0 && rt.firstTs > prevTs {
			d := int((rt.firstTs - prevTs) * 1000)
			if d > 2000 {
				d = 2000
			}
			if d > 0 {
				delayMS = d
			}
		}
		prevTs = rt.lastTs

		turns = append(turns, ReplayTurn{
			Turn:    idx + 1,
			Dir:     rt.dir,
			Action:  "send",
			DataB64: base64.StdEncoding.EncodeToString(rt.payload),
			Length:  len(rt.payload),
			DelayMS: delayMS,
		})
		totalBytes += len(rt.payload)
	}
	return turns, totalBytes
}

func stripOneFlow(f flowCandidate) map[string]any {
	return map[string]any{
		"flow_id":         f.FlowID,
		"proto":           f.Proto,
		"client_ip":       f.ClientIP,
		"client_port":     f.ClientPort,
		"server_ip":       f.ServerIP,
		"server_port":     f.ServerPort,
		"packet_count":    f.PacketCount,
		"payload_bytes":   f.PayloadBytes,
		"has_syn":         f.HasSYN,
		"is_noise":        f.IsNoise,
		"score":           f.Score,
		"payload_preview": f.PayloadPreview,
		"warnings":        f.Warnings,
	}
}

func stripFlowSegments(flows []flowCandidate) []map[string]any {
	out := make([]map[string]any, 0, len(flows))
	for _, f := range flows {
		out = append(out, stripOneFlow(f))
	}
	return out
}
