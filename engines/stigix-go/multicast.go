package main

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"math"
	"math/rand"
	"net"
	"net/http"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"time"
)

const (
	stgxMulticastMagic      uint32 = 0x53544758 // "STGX"
	stgxMulticastHeaderSize int    = 24
	multicastWindowSize     uint64 = 4096 // 128 x uint32 words
	multicastWindowWords    int    = 128
	maxHistoryPoints        int    = 60
)

// MulticastRateConfig mirrors TypeScript MulticastRateConfig
type MulticastRateConfig struct {
	Mode            string `json:"mode"` // "cbr" | "burst"
	Kbps            int    `json:"kbps"`
	BurstKbps       int    `json:"burstKbps,omitempty"`
	BurstMs         int    `json:"burstMs,omitempty"`
	IdleMs          int    `json:"idleMs,omitempty"`
	BurstPackets    int    `json:"burstPackets,omitempty"`
	BurstIntervalMs int    `json:"burstIntervalMs,omitempty"`
	DurationSec     int    `json:"durationSec,omitempty"`
	PayloadFormat   string `json:"payloadFormat,omitempty"` // "raw-stgx" | "rtp-mpegts" | "rtp-g711"
}

// MulticastThresholdsConfig mirrors TypeScript MulticastThresholdsConfig
type MulticastThresholdsConfig struct {
	MaxLossPct       *float64 `json:"maxLossPct,omitempty"`
	DegradedLossPct  *float64 `json:"degradedLossPct,omitempty"`
	MaxJitterMs      *float64 `json:"maxJitterMs,omitempty"`
	MaxGapMs         *float64 `json:"maxGapMs,omitempty"`
	MaxDuplicates    *uint64  `json:"maxDuplicates,omitempty"`
	MaxJoinLatencyMs *float64 `json:"maxJoinLatencyMs,omitempty"`
}

// MulticastReceiverTarget mirrors TypeScript MulticastReceiverTarget
type MulticastReceiverTarget struct {
	Node        string `json:"node"`
	Expect      string `json:"expect"`
	InterfaceIP string `json:"interfaceIp,omitempty"`
	Enabled     *bool  `json:"enabled,omitempty"`
}

// MulticastApplicationConfig mirrors TypeScript NormalizedMulticastConfig / MulticastApplicationConfig
type MulticastApplicationConfig struct {
	ID                string                    `json:"id"`
	Name              string                    `json:"name"`
	Description       string                    `json:"description,omitempty"`
	Enabled           bool                      `json:"enabled"`
	PresetID          string                    `json:"presetId,omitempty"`
	Mode              string                    `json:"mode"` // "asm" | "ssm" | "ASM" | "SSM"
	Group             string                    `json:"group"`
	Port              int                       `json:"port"`
	SSMSource         *string                   `json:"ssmSource,omitempty"`
	TTL               int                       `json:"ttl"`
	DSCP              string                    `json:"dscp"`
	Rate              MulticastRateConfig       `json:"rate"`
	PayloadBytes      int                       `json:"payloadBytes"`
	PayloadFormat     string                    `json:"payloadFormat,omitempty"`
	DurationSec       int                       `json:"durationSec,omitempty"`
	SenderNode        string                    `json:"senderNode"`
	SenderInterfaceIP string                    `json:"senderInterfaceIp,omitempty"`
	Receivers         []MulticastReceiverTarget `json:"receivers,omitempty"`
	Thresholds        MulticastThresholdsConfig `json:"thresholds"`
}

// MulticastSenderStats mirrors TypeScript MulticastSenderStats
type MulticastSenderStats struct {
	AppID         string  `json:"appId"`
	Node          string  `json:"node"`
	Active        bool    `json:"active"`
	Group         string  `json:"group"`
	Port          int     `json:"port"`
	InterfaceName string  `json:"interfaceName"`
	InterfaceIP   string  `json:"interfaceIp"`
	RunID         uint16  `json:"runId"`
	StreamID      uint16  `json:"streamId"`
	CurrentSeq    uint64  `json:"currentSeq"`
	PacketsSent   uint64  `json:"packetsSent"`
	BytesSent     uint64  `json:"bytesSent"`
	TxBitrateKbps float64 `json:"txBitrateKbps"`
	TxPps         float64 `json:"txPps"`
	TargetKbps    int     `json:"targetKbps"`
	PayloadBytes  int     `json:"payloadBytes"`
	TTL           int     `json:"ttl"`
	DSCP          string  `json:"dscp"`
	StartedAt     int64   `json:"startedAt,omitempty"`
	UptimeSec     int     `json:"uptimeSec"`
	LastError     string  `json:"lastError,omitempty"`
}

// MulticastThroughputSample mirrors TypeScript MulticastThroughputSample
type MulticastThroughputSample struct {
	Ts       int64   `json:"ts"`
	Kbps     float64 `json:"kbps"`
	Pps      float64 `json:"pps"`
	LossPct  float64 `json:"lossPct"`
	MaxGapMs float64 `json:"maxGapMs"`
}

// MulticastReceiverStats mirrors TypeScript MulticastReceiverStats
type MulticastReceiverStats struct {
	AppID            string                      `json:"appId"`
	Node             string                      `json:"node"`
	Joined           bool                        `json:"joined"`
	Expect           string                      `json:"expect"`
	Group            string                      `json:"group"`
	Port             int                         `json:"port"`
	Mode             string                      `json:"mode"`
	SSMSource        *string                     `json:"ssmSource"`
	InterfaceName    string                      `json:"interfaceName"`
	InterfaceIP      string                      `json:"interfaceIp"`
	IGMPVersion      string                      `json:"igmpVersion"`
	RunID            uint16                      `json:"runId"`
	FirstSeq         *uint64                     `json:"firstSeq"`
	HighestSeq       *uint64                     `json:"highestSeq"`
	PacketsReceived  uint64                      `json:"packetsReceived"`
	PacketsExpected  uint64                      `json:"packetsExpected"`
	PacketsLost      uint64                      `json:"packetsLost"`
	LossPct          float64                     `json:"lossPct"`
	DuplicatePackets uint64                      `json:"duplicatePackets"`
	ReorderedPackets uint64                      `json:"reorderedPackets"`
	ForeignPackets   uint64                      `json:"foreignPackets"`
	BytesReceived    uint64                      `json:"bytesReceived"`
	RxBitrateKbps    float64                     `json:"rxBitrateKbps"`
	RxPps            float64                     `json:"rxPps"`
	JitterMs         float64                     `json:"jitterMs"`
	MaxGapMs         float64                     `json:"maxGapMs"`
	CurrentSilenceMs int64                       `json:"currentSilenceMs"`
	JoinLatencyMs    *float64                    `json:"joinLatencyMs"`
	JoinedAt         int64                       `json:"joinedAt,omitempty"`
	LastPacketAt     int64                       `json:"lastPacketAt,omitempty"`
	Verdict          string                      `json:"verdict"`
	VerdictReason    string                      `json:"verdictReason"`
	LastError        string                      `json:"lastError,omitempty"`
	History          []MulticastThroughputSample `json:"history"`
}

// computeMulticastStreamID computes the deterministic 16-bit DJB2-xor stream ID from appId.
func computeMulticastStreamID(appID string) uint16 {
	var h uint32 = 5381
	for i := 0; i < len(appID); i++ {
		h = ((h << 5) + h) ^ uint32(appID[i])
	}
	id := uint16(h & 0xFFFF)
	if id == 0 {
		return 1
	}
	return id
}

func normalizeMCMode(mode string) string {
	if strings.EqualFold(strings.TrimSpace(mode), "ssm") {
		return "ssm"
	}
	return "asm"
}

func normalizeMCExpect(expect string) string {
	if strings.EqualFold(strings.TrimSpace(expect), "none") {
		return "none"
	}
	return "traffic"
}

var multicastDSCPMap = map[string]int{
	"BE":   0,
	"CS0":  0,
	"CS1":  8,
	"AF11": 10,
	"AF12": 12,
	"AF13": 14,
	"CS2":  16,
	"AF21": 18,
	"AF22": 20,
	"AF23": 22,
	"CS3":  24,
	"AF31": 26,
	"AF32": 28,
	"AF33": 30,
	"CS4":  32,
	"AF41": 34,
	"AF42": 36,
	"AF43": 38,
	"CS5":  40,
	"EF":   46,
	"CS6":  48,
	"CS7":  56,
}

func dscpNameToTos(dscp string) int {
	upper := strings.ToUpper(strings.TrimSpace(dscp))
	dscpVal, ok := multicastDSCPMap[upper]
	if !ok {
		return 0
	}
	return (dscpVal & 0x3F) << 2
}

type resolvedMCInterface struct {
	Name             string
	IP               string
	IPBytes          [4]byte
	MulticastCapable bool
}

func parseIPv4Bytes(ipStr string) ([4]byte, bool) {
	var out [4]byte
	ip := net.ParseIP(strings.TrimSpace(ipStr))
	if ip == nil {
		return out, false
	}
	ip4 := ip.To4()
	if ip4 == nil {
		return out, false
	}
	copy(out[:], ip4)
	return out, true
}

func resolveMulticastInterface(preferredIP string) resolvedMCInterface {
	pref := strings.TrimSpace(preferredIP)
	if pref == "127.0.0.1" {
		return resolvedMCInterface{
			Name:             "lo",
			IP:               "127.0.0.1",
			IPBytes:          [4]byte{127, 0, 0, 1},
			MulticastCapable: true,
		}
	}

	ifaces, err := net.Interfaces()
	if err == nil {
		// 1. Exact IP or interface name match
		if pref != "" && pref != "auto" && pref != "0.0.0.0" {
			for _, iface := range ifaces {
				if iface.Flags&net.FlagUp == 0 {
					continue
				}
				addrs, _ := iface.Addrs()
				for _, addr := range addrs {
					var ip net.IP
					switch v := addr.(type) {
					case *net.IPNet:
						ip = v.IP
					case *net.IPAddr:
						ip = v.IP
					}
					if ip == nil {
						continue
					}
					ip4 := ip.To4()
					if ip4 == nil {
						continue
					}
					ipStr := ip4.String()
					if ipStr == pref || iface.Name == pref {
						var b [4]byte
						copy(b[:], ip4)
						return resolvedMCInterface{
							Name:             iface.Name,
							IP:               ipStr,
							IPBytes:          b,
							MulticastCapable: true,
						}
					}
				}
			}
			if b, ok := parseIPv4Bytes(pref); ok {
				return resolvedMCInterface{
					Name:             "custom",
					IP:               pref,
					IPBytes:          b,
					MulticastCapable: true,
				}
			}
		}

		// 2. Auto-detect primary non-loopback, non-container IPv4 interface
		excludedPrefixes := []string{"docker", "br-", "veth", "virbr", "cni", "flannel", "cali", "tunl", "lo"}
		for _, iface := range ifaces {
			if iface.Flags&net.FlagUp == 0 || iface.Flags&net.FlagLoopback != 0 {
				continue
			}
			lower := strings.ToLower(iface.Name)
			skip := false
			for _, p := range excludedPrefixes {
				if strings.HasPrefix(lower, p) {
					skip = true
					break
				}
			}
			if skip {
				continue
			}
			addrs, _ := iface.Addrs()
			for _, addr := range addrs {
				var ip net.IP
				switch v := addr.(type) {
				case *net.IPNet:
					ip = v.IP
				case *net.IPAddr:
					ip = v.IP
				}
				if ip == nil {
					continue
				}
				ip4 := ip.To4()
				if ip4 == nil || ip4.IsLoopback() {
					continue
				}
				var b [4]byte
				copy(b[:], ip4)
				return resolvedMCInterface{
					Name:             iface.Name,
					IP:               ip4.String(),
					IPBytes:          b,
					MulticastCapable: true,
				}
			}
		}
	}

	return resolvedMCInterface{
		Name:             "lo",
		IP:               "127.0.0.1",
		IPBytes:          [4]byte{127, 0, 0, 1},
		MulticastCapable: false,
	}
}

func detectLinuxIGMPVersion(ifaceName string) string {
	data, err := os.ReadFile("/proc/sys/net/ipv4/conf/all/force_igmp_version")
	if err == nil {
		v := strings.TrimSpace(string(data))
		if v == "2" {
			return "v2"
		}
		if v == "3" {
			return "v3"
		}
	}
	if ifaceName != "" && ifaceName != "auto" && ifaceName != "custom" {
		p := fmt.Sprintf("/proc/sys/net/ipv4/conf/%s/force_igmp_version", ifaceName)
		if data, err := os.ReadFile(p); err == nil {
			v := strings.TrimSpace(string(data))
			if v == "2" {
				return "v2"
			}
			if v == "3" {
				return "v3"
			}
		}
	}
	return "v3"
}

// packSTGXHeader packs the 24-byte STGX header (!IQQHH) at offset.
func packSTGXHeader(buf []byte, seq uint64, tsNs uint64, streamID uint16, runID uint16, offset int) {
	if len(buf) < offset+stgxMulticastHeaderSize {
		return
	}
	binary.BigEndian.PutUint32(buf[offset:offset+4], stgxMulticastMagic)
	binary.BigEndian.PutUint64(buf[offset+4:offset+12], seq)
	binary.BigEndian.PutUint64(buf[offset+12:offset+20], tsNs)
	binary.BigEndian.PutUint16(buf[offset+20:offset+22], streamID)
	binary.BigEndian.PutUint16(buf[offset+22:offset+24], runID)
}

func packRTPHeader(buf []byte, payloadType byte, seq uint64, ts uint32, ssrc uint32) {
	if len(buf) < 12 {
		return
	}
	buf[0] = 0x80 // RTP v2
	buf[1] = payloadType & 0x7F
	binary.BigEndian.PutUint16(buf[2:4], uint16(seq&0xFFFF))
	binary.BigEndian.PutUint32(buf[4:8], ts)
	binary.BigEndian.PutUint32(buf[8:12], ssrc)
}

func packMPEGTSHeader(buf []byte, offset int, continuityCounter byte) {
	if len(buf) < offset+4 {
		return
	}
	buf[offset] = 0x47   // Sync byte
	buf[offset+1] = 0x01 // PID 0x0100
	buf[offset+2] = 0x00
	buf[offset+3] = 0x10 | (continuityCounter & 0x0F)
}

type parsedSTGXHeader struct {
	Magic       uint32
	SequenceID  uint64
	TimestampNs uint64
	StreamID    uint16
	RunID       uint16
}

var candidateHeaderOffsets = [3]int{0, 16, 12}

func unpackSTGXHeader(buf []byte) (parsedSTGXHeader, bool) {
	for _, off := range candidateHeaderOffsets {
		if len(buf) < off+stgxMulticastHeaderSize {
			continue
		}
		magic := binary.BigEndian.Uint32(buf[off : off+4])
		if magic == stgxMulticastMagic {
			return parsedSTGXHeader{
				Magic:       magic,
				SequenceID:  binary.BigEndian.Uint64(buf[off+4 : off+12]),
				TimestampNs: binary.BigEndian.Uint64(buf[off+12 : off+20]),
				StreamID:    binary.BigEndian.Uint16(buf[off+20 : off+22]),
				RunID:       binary.BigEndian.Uint16(buf[off+22 : off+24]),
			}, true
		}
	}
	return parsedSTGXHeader{}, false
}

// ─── Go Native Multicast Sender Runtime ─────────────────────────────────────

type goMulticastSender struct {
	mu            sync.RWMutex
	appConfig     MulticastApplicationConfig
	nodeID        string
	interfaceName string
	interfaceIP   string
	ifaceBytes    [4]byte
	streamID      uint16
	runID         uint16

	active        bool
	startedAtMs   int64
	currentSeq    uint64
	packetsSent   uint64
	bytesSent     uint64
	txBitrateKbps float64
	txPps         float64
	lastError     string

	cancel context.CancelFunc
	doneCh chan struct{}
}

func newGoMulticastSender(cfg MulticastApplicationConfig, nodeID string) *goMulticastSender {
	return &goMulticastSender{
		appConfig:     cfg,
		nodeID:        nodeID,
		interfaceName: "auto",
		interfaceIP:   cfg.SenderInterfaceIP,
		streamID:      computeMulticastStreamID(cfg.ID),
		runID:         uint16(1 + rand.Intn(65534)),
	}
}

func (s *goMulticastSender) start(preferredInterfaceIP string, allowLoopback bool) (MulticastSenderStats, error) {
	s.stop()

	s.mu.Lock()
	rawPref := preferredInterfaceIP
	if rawPref == "" {
		rawPref = s.appConfig.SenderInterfaceIP
	}
	resolved := resolveMulticastInterface(rawPref)
	s.interfaceName = resolved.Name
	s.interfaceIP = resolved.IP
	s.ifaceBytes = resolved.IPBytes

	groupBytes, ok := parseIPv4Bytes(s.appConfig.Group)
	if !ok {
		s.mu.Unlock()
		return s.getStats(), fmt.Errorf("invalid multicast group IP: %s", s.appConfig.Group)
	}

	fd, err := syscall.Socket(syscall.AF_INET, syscall.SOCK_DGRAM, syscall.IPPROTO_UDP)
	if err != nil {
		s.lastError = err.Error()
		s.mu.Unlock()
		return s.getStats(), err
	}

	setMulticastReuseAddrPort(fd)
	_ = syscall.SetsockoptInt(fd, syscall.SOL_SOCKET, syscall.SO_SNDBUF, 4*1024*1024)

	// Bind ephemeral source port on local interface IP so source IP in IPv4 header is deterministic
	bindAddr := &syscall.SockaddrInet4{Port: 0, Addr: resolved.IPBytes}
	if err := syscall.Bind(fd, bindAddr); err != nil {
		// Fallback to INADDR_ANY if specific IP bind fails
		_ = syscall.Bind(fd, &syscall.SockaddrInet4{Port: 0})
	}

	ttl := s.appConfig.TTL
	if ttl < 1 {
		ttl = 1
	} else if ttl > 255 {
		ttl = 255
	}
	_ = syscall.SetsockoptInt(fd, syscall.IPPROTO_IP, syscall.IP_MULTICAST_TTL, ttl)

	loopVal := 0
	if allowLoopback || resolved.IP == "127.0.0.1" {
		loopVal = 1
	}
	_ = syscall.SetsockoptInt(fd, syscall.IPPROTO_IP, syscall.IP_MULTICAST_LOOP, loopVal)
	_ = syscall.SetsockoptInet4Addr(fd, syscall.IPPROTO_IP, syscall.IP_MULTICAST_IF, resolved.IPBytes)

	tos := dscpNameToTos(s.appConfig.DSCP)
	if tos > 0 {
		_ = syscall.SetsockoptInt(fd, syscall.IPPROTO_IP, syscall.IP_TOS, tos)
	}

	s.runID = uint16(((int(s.runID) + 1) % 65534) + 1)
	s.currentSeq = 0
	s.packetsSent = 0
	s.bytesSent = 0
	s.txBitrateKbps = 0
	s.txPps = 0
	s.lastError = ""
	s.active = true
	s.startedAtMs = time.Now().UnixMilli()

	ctx, cancel := context.WithCancel(context.Background())
	doneCh := make(chan struct{})
	s.cancel = cancel
	s.doneCh = doneCh

	cfg := s.appConfig
	runID := s.runID
	streamID := s.streamID
	ifaceIPStr := s.interfaceIP
	s.mu.Unlock()

	activeMulticastStreams.Add(1)

	go s.runTransmitLoop(ctx, doneCh, fd, groupBytes, cfg, streamID, runID, ifaceIPStr)

	return s.getStats(), nil
}

func (s *goMulticastSender) runTransmitLoop(
	ctx context.Context,
	doneCh chan struct{},
	fd int,
	groupBytes [4]byte,
	cfg MulticastApplicationConfig,
	streamID uint16,
	runID uint16,
	ifaceIPStr string,
) {
	defer func() {
		_ = syscall.Close(fd)
		activeMulticastStreams.Add(-1)
		close(doneCh)
	}()

	payloadFmt := cfg.PayloadFormat
	if payloadFmt == "" {
		payloadFmt = cfg.Rate.PayloadFormat
	}
	if payloadFmt == "" {
		payloadFmt = "raw-stgx"
	}
	minBytes := stgxMulticastHeaderSize
	if payloadFmt == "rtp-mpegts" {
		minBytes = 40
	} else if payloadFmt == "rtp-g711" {
		minBytes = 36
	}
	payloadBytes := cfg.PayloadBytes
	if payloadBytes < minBytes {
		payloadBytes = minBytes
	} else if payloadBytes > 1400 {
		payloadBytes = 1400
	}

	payloadBuf := make([]byte, payloadBytes)
	for i := minBytes; i < payloadBytes; i++ {
		payloadBuf[i] = byte(0x41 + (i % 26))
	}

	targetKbps := cfg.Rate.Kbps
	if targetKbps < 1 {
		targetKbps = 1
	}
	burstKbps := cfg.Rate.BurstKbps
	if burstKbps < targetKbps {
		if cfg.Rate.BurstPackets > 0 && cfg.Rate.BurstIntervalMs > 0 {
			burstKbps = int((float64(cfg.Rate.BurstPackets*payloadBytes*8) / (float64(cfg.Rate.BurstIntervalMs) / 1000.0)) / 1000.0)
		} else {
			burstKbps = targetKbps * 2
		}
	}
	burstMs := cfg.Rate.BurstMs
	if burstMs < 20 {
		burstMs = 250
	}
	idleMs := cfg.Rate.IdleMs
	if idleMs < 20 {
		idleMs = 750
	}
	isBurstMode := strings.EqualFold(cfg.Rate.Mode, "burst")

	dstAddr := &syscall.SockaddrInet4{
		Port: cfg.Port,
		Addr: groupBytes,
	}

	startMono := time.Now()
	lastRefill := startMono
	lastWindowTime := startMono
	var windowBytes uint64
	var windowPackets uint64
	var tokenBytes float64

	// Pre-seed 1 packet token so packet #1 transmits immediately on start
	tokenBytes = float64(payloadBytes)

	// 2ms high-precision ticker in Go goroutine (zero GC pressure, pre-allocated buffer)
	ticker := time.NewTicker(2 * time.Millisecond)
	defer ticker.Stop()

	var durationDeadline time.Time
	durSec := cfg.DurationSec
	if durSec <= 0 {
		durSec = cfg.Rate.DurationSec
	}
	if durSec > 0 {
		durationDeadline = startMono.Add(time.Duration(durSec) * time.Second)
	}

	for {
		select {
		case <-ctx.Done():
			return
		case now := <-ticker.C:
			if !durationDeadline.IsZero() && !now.Before(durationDeadline) {
				s.mu.Lock()
				s.active = false
				s.txBitrateKbps = 0
				s.txPps = 0
				s.mu.Unlock()
				return
			}

			dtSec := now.Sub(lastRefill).Seconds()
			lastRefill = now

			effectiveKbps := targetKbps
			if isBurstMode {
				cycleMs := burstMs + idleMs
				elapsedMs := int(now.Sub(startMono).Milliseconds()) % cycleMs
				if elapsedMs < burstMs {
					effectiveKbps = burstKbps
				} else {
					effectiveKbps = 0
				}
			}

			bytesPerSec := (float64(effectiveKbps) * 1000.0) / 8.0
			tokenBytes += bytesPerSec * dtSec
			maxAccum := math.Max(float64(payloadBytes*4), bytesPerSec*0.05)
			if tokenBytes > maxAccum {
				tokenBytes = maxAccum
			}

			packetsThisTick := 0
			for tokenBytes >= float64(payloadBytes) && packetsThisTick < 64 {
				tokenBytes -= float64(payloadBytes)
				packetsThisTick++

				s.mu.Lock()
				s.currentSeq++
				seq := s.currentSeq
				s.mu.Unlock()

				tsNs := uint64(time.Now().UnixNano())
				ssrc := (uint32(streamID) << 16) | uint32(runID)

				if payloadFmt == "rtp-mpegts" {
					rtpTs := uint32((tsNs * 90) / 1_000_000)
					packRTPHeader(payloadBuf, 33, seq, rtpTs, ssrc)
					packMPEGTSHeader(payloadBuf, 12, byte(seq&0x0F))
					packSTGXHeader(payloadBuf, seq, tsNs, streamID, runID, 16)
					for tsOff := 12 + 188; tsOff+4 <= payloadBytes; tsOff += 188 {
						packMPEGTSHeader(payloadBuf, tsOff, byte((seq+uint64(tsOff/188))&0x0F))
					}
				} else if payloadFmt == "rtp-g711" {
					rtpTs := uint32((tsNs * 8) / 1_000_000)
					packRTPHeader(payloadBuf, 0, seq, rtpTs, ssrc)
					packSTGXHeader(payloadBuf, seq, tsNs, streamID, runID, 12)
				} else {
					packSTGXHeader(payloadBuf, seq, tsNs, streamID, runID, 0)
				}

				err := syscall.Sendto(fd, payloadBuf, 0, dstAddr)
				if err != nil {
					if ifaceIPStr == "127.0.0.1" {
						// Fallback to in-memory loopback delivery if sandboxed/loopback multicast routing is blocked
						deliverGoInMemoryLoopback(cfg.Group, cfg.Port, payloadBuf, ifaceIPStr)
						err = nil
					}
				}

				s.mu.Lock()
				if err != nil {
					s.lastError = err.Error()
				} else {
					s.packetsSent++
					s.bytesSent += uint64(payloadBytes)
					windowPackets++
					windowBytes += uint64(payloadBytes)
				}
				s.mu.Unlock()
			}

			winSec := now.Sub(lastWindowTime).Seconds()
			if winSec >= 1.0 {
				kbps := math.Round(((float64(windowBytes)*8.0)/(winSec*1000.0))*10.0) / 10.0
				pps := math.Round((float64(windowPackets)/winSec)*10.0) / 10.0
				s.mu.Lock()
				s.txBitrateKbps = kbps
				s.txPps = pps
				s.mu.Unlock()
				windowBytes = 0
				windowPackets = 0
				lastWindowTime = now
			}
		}
	}
}

func (s *goMulticastSender) stop() MulticastSenderStats {
	s.mu.Lock()
	cancel := s.cancel
	doneCh := s.doneCh
	s.cancel = nil
	s.doneCh = nil
	s.active = false
	s.txBitrateKbps = 0
	s.txPps = 0
	s.mu.Unlock()

	if cancel != nil {
		cancel()
	}
	if doneCh != nil {
		select {
		case <-doneCh:
		case <-time.After(500 * time.Millisecond):
		}
	}
	return s.getStats()
}

func (s *goMulticastSender) getStats() MulticastSenderStats {
	s.mu.RLock()
	defer s.mu.RUnlock()

	uptimeSec := 0
	if s.active && s.startedAtMs > 0 {
		uptimeSec = int((time.Now().UnixMilli() - s.startedAtMs) / 1000)
		if uptimeSec < 0 {
			uptimeSec = 0
		}
	}

	targetKbps := s.appConfig.Rate.Kbps
	if targetKbps == 0 {
		targetKbps = 1000
	}
	payloadBytes := s.appConfig.PayloadBytes
	if payloadBytes == 0 {
		payloadBytes = 1200
	}
	ttl := s.appConfig.TTL
	if ttl == 0 {
		ttl = 8
	}
	dscp := s.appConfig.DSCP
	if dscp == "" {
		dscp = "EF"
	}

	return MulticastSenderStats{
		AppID:         s.appConfig.ID,
		Node:          s.nodeID,
		Active:        s.active,
		Group:         s.appConfig.Group,
		Port:          s.appConfig.Port,
		InterfaceName: s.interfaceName,
		InterfaceIP:   s.interfaceIP,
		RunID:         s.runID,
		StreamID:      s.streamID,
		CurrentSeq:    s.currentSeq,
		PacketsSent:   s.packetsSent,
		BytesSent:     s.bytesSent,
		TxBitrateKbps: s.txBitrateKbps,
		TxPps:         s.txPps,
		TargetKbps:    targetKbps,
		PayloadBytes:  payloadBytes,
		TTL:           ttl,
		DSCP:          dscp,
		StartedAt:     s.startedAtMs,
		UptimeSec:     uptimeSec,
		LastError:     s.lastError,
	}
}

// ─── Go Native Multicast Receiver Runtime ───────────────────────────────────

type goMulticastReceiver struct {
	mu            sync.RWMutex
	appConfig     MulticastApplicationConfig
	nodeID        string
	expect        string
	interfaceName string
	interfaceIP   string
	igmpVersion   string
	expectedSate  uint16

	joined       bool
	joinedAtMs   int64
	joinedMono   time.Time
	lastPacketMs int64
	lastRxMono   time.Time
	lastSenderNs uint64

	currentRunID     uint16
	firstSeq         *uint64
	highestSeq       *uint64
	packetsReceived  uint64
	uniquePackets    uint64
	packetsExpected  uint64
	packetsLost      uint64
	duplicatePackets uint64
	reorderedPackets uint64
	foreignPackets   uint64
	bytesReceived    uint64

	jitterMs      float64
	maxGapMs      float64
	joinLatencyMs *float64
	rxBitrateKbps float64
	rxPps         float64
	lastError     string

	windowBytes   uint64
	windowPackets uint64
	seqBitset     [multicastWindowWords]uint32
	history       []MulticastThroughputSample

	cancel context.CancelFunc
	doneCh chan struct{}
	fd     int
}

func newGoMulticastReceiver(cfg MulticastApplicationConfig, nodeID string, expect string) *goMulticastReceiver {
	return &goMulticastReceiver{
		appConfig:     cfg,
		nodeID:        nodeID,
		expect:        normalizeMCExpect(expect),
		interfaceName: "auto",
		interfaceIP:   "auto",
		igmpVersion:   "v3",
		expectedSate:  computeMulticastStreamID(cfg.ID),
		history:       make([]MulticastThroughputSample, 0, maxHistoryPoints),
		fd:            -1,
	}
}

func (r *goMulticastReceiver) resetRunCountersLocked(newRunID uint16) {
	r.currentRunID = newRunID
	r.firstSeq = nil
	r.highestSeq = nil
	r.packetsReceived = 0
	r.uniquePackets = 0
	r.packetsExpected = 0
	r.packetsLost = 0
	r.duplicatePackets = 0
	r.reorderedPackets = 0
	r.bytesReceived = 0
	r.jitterMs = 0
	r.maxGapMs = 0
	r.rxBitrateKbps = 0
	r.rxPps = 0
	r.windowBytes = 0
	r.windowPackets = 0
	r.lastRxMono = time.Time{}
	r.lastSenderNs = 0
	r.seqBitset = [multicastWindowWords]uint32{}
}

func (r *goMulticastReceiver) clearBitRangeLocked(fromSeq, toSeq uint64) {
	if toSeq < fromSeq {
		return
	}
	count := toSeq - fromSeq + 1
	if count >= multicastWindowSize {
		r.seqBitset = [multicastWindowWords]uint32{}
		return
	}
	for s := fromSeq; s <= toSeq; s++ {
		idx := s % multicastWindowSize
		word := int(idx >> 5)
		bit := idx & 31
		r.seqBitset[word] &^= (1 << bit)
	}
}

func (r *goMulticastReceiver) testAndSetSeqBitLocked(seq uint64) bool {
	idx := seq % multicastWindowSize
	word := int(idx >> 5)
	bit := idx & 31
	mask := uint32(1 << bit)
	alreadySet := (r.seqBitset[word] & mask) != 0
	r.seqBitset[word] |= mask
	return alreadySet
}

func (r *goMulticastReceiver) reconcileLossCountersLocked() {
	if r.firstSeq == nil || r.highestSeq == nil {
		r.packetsExpected = 0
		r.packetsLost = 0
		return
	}
	var expected uint64
	if *r.highestSeq >= *r.firstSeq {
		expected = (*r.highestSeq - *r.firstSeq) + 1
	} else {
		expected = 1
	}
	r.packetsExpected = expected
	if expected > r.uniquePackets {
		r.packetsLost = expected - r.uniquePackets
	} else {
		r.packetsLost = 0
	}
}

func (r *goMulticastReceiver) handlePacket(buf []byte, senderIP string) {
	nowMono := time.Now()
	nowWallMs := nowMono.UnixMilli()

	r.mu.Lock()
	defer r.mu.Unlock()

	if !r.joined {
		return
	}

	// Enforce application-level SSM source filter if kernel fell back to ASM
	mode := normalizeMCMode(r.appConfig.Mode)
	if mode == "ssm" && r.appConfig.SSMSource != nil && *r.appConfig.SSMSource != "" {
		if senderIP != "" && senderIP != *r.appConfig.SSMSource && senderIP != "127.0.0.1" {
			r.foreignPackets++
			return
		}
	}

	parsed, ok := unpackSTGXHeader(buf)
	if !ok {
		r.foreignPackets++
		return
	}
	if parsed.StreamID != r.expectedSate {
		r.foreignPackets++
		return
	}

	// Detect new sender runId -> auto-reset sequence baseline without dropping socket
	if r.currentRunID != 0 && parsed.RunID != r.currentRunID {
		r.resetRunCountersLocked(parsed.RunID)
	} else if r.currentRunID == 0 {
		r.currentRunID = parsed.RunID
	}

	// Record Join Latency on first valid packet
	if r.joinLatencyMs == nil && !r.joinedMono.IsZero() {
		lat := math.Max(0, math.Round(float64(nowMono.Sub(r.joinedMono).Microseconds())/100.0)/10.0)
		r.joinLatencyMs = &lat
	}

	// Inter-packet arrival gap & RFC 3550 jitter
	if !r.lastRxMono.IsZero() {
		rxDeltaMs := float64(nowMono.Sub(r.lastRxMono).Microseconds()) / 1000.0
		if rxDeltaMs > r.maxGapMs {
			r.maxGapMs = math.Round(rxDeltaMs*10.0) / 10.0
		}
		if r.lastSenderNs > 0 && parsed.TimestampNs > r.lastSenderNs {
			txDeltaMs := float64(parsed.TimestampNs-r.lastSenderNs) / 1_000_000.0
			transitDiffMs := math.Abs(rxDeltaMs - txDeltaMs)
			if transitDiffMs < 10000.0 {
				r.jitterMs = r.jitterMs + (transitDiffMs-r.jitterMs)/16.0
			}
		}
	}

	r.lastRxMono = nowMono
	r.lastSenderNs = parsed.TimestampNs
	r.lastPacketMs = nowWallMs

	pktLen := uint64(len(buf))
	r.packetsReceived++
	r.bytesReceived += pktLen
	r.windowPackets++
	r.windowBytes += pktLen

	seq := parsed.SequenceID

	// Late-Join baseline: first packet seen sets firstSeq = seq
	if r.firstSeq == nil || r.highestSeq == nil {
		seqCopy1 := seq
		seqCopy2 := seq
		r.firstSeq = &seqCopy1
		r.highestSeq = &seqCopy2
		r.uniquePackets = 1
		r.testAndSetSeqBitLocked(seq)
		r.reconcileLossCountersLocked()
		return
	}

	high := *r.highestSeq
	if seq > high {
		r.clearBitRangeLocked(high+1, seq)
		r.testAndSetSeqBitLocked(seq)
		seqCopy := seq
		r.highestSeq = &seqCopy
		r.uniquePackets++
	} else if seq == high {
		r.duplicatePackets++
	} else {
		distance := high - seq
		if distance < multicastWindowSize {
			alreadySeen := r.testAndSetSeqBitLocked(seq)
			if alreadySeen {
				r.duplicatePackets++
			} else {
				r.reorderedPackets++
				r.uniquePackets++
			}
		} else {
			r.reorderedPackets++
		}
	}

	r.reconcileLossCountersLocked()
}

func (r *goMulticastReceiver) join(preferredInterfaceIP string, expectOverride string) (MulticastReceiverStats, error) {
	r.leave()

	r.mu.Lock()
	if expectOverride != "" {
		r.expect = normalizeMCExpect(expectOverride)
	}
	resolved := resolveMulticastInterface(preferredInterfaceIP)
	r.interfaceName = resolved.Name
	r.interfaceIP = resolved.IP
	r.igmpVersion = detectLinuxIGMPVersion(resolved.Name)
	r.resetRunCountersLocked(0)
	r.foreignPackets = 0
	r.joinLatencyMs = nil
	r.lastError = ""
	r.history = r.history[:0]

	groupBytes, ok := parseIPv4Bytes(r.appConfig.Group)
	if !ok {
		r.mu.Unlock()
		return r.getStats(false), fmt.Errorf("invalid multicast group IP: %s", r.appConfig.Group)
	}

	fd, err := syscall.Socket(syscall.AF_INET, syscall.SOCK_DGRAM, syscall.IPPROTO_UDP)
	if err != nil {
		r.lastError = err.Error()
		r.mu.Unlock()
		return r.getStats(false), err
	}

	setMulticastReuseAddrPort(fd)
	_ = syscall.SetsockoptInt(fd, syscall.SOL_SOCKET, syscall.SO_RCVBUF, 4*1024*1024)

	bindAddr := &syscall.SockaddrInet4{
		Port: r.appConfig.Port,
		Addr: [4]byte{0, 0, 0, 0},
	}
	if err := syscall.Bind(fd, bindAddr); err != nil {
		_ = syscall.Close(fd)
		r.lastError = err.Error()
		r.mu.Unlock()
		return r.getStats(false), err
	}

	mode := normalizeMCMode(r.appConfig.Mode)
	var joinErr error
	if mode == "ssm" && r.appConfig.SSMSource != nil && *r.appConfig.SSMSource != "" {
		if srcBytes, ok := parseIPv4Bytes(*r.appConfig.SSMSource); ok {
			joinErr = joinMulticastSSM(fd, groupBytes, resolved.IPBytes, srcBytes)
		}
	}
	if mode != "ssm" || joinErr != nil {
		mreq := &syscall.IPMreq{
			Multiaddr: groupBytes,
			Interface: resolved.IPBytes,
		}
		if err := syscall.SetsockoptIPMreq(fd, syscall.IPPROTO_IP, syscall.IP_ADD_MEMBERSHIP, mreq); err != nil {
			// Fallback to INADDR_ANY interface if specific interface IP fails in container/loopback
			mreqAny := &syscall.IPMreq{
				Multiaddr: groupBytes,
				Interface: [4]byte{0, 0, 0, 0},
			}
			if err2 := syscall.SetsockoptIPMreq(fd, syscall.IPPROTO_IP, syscall.IP_ADD_MEMBERSHIP, mreqAny); err2 != nil {
				r.lastError = fmt.Sprintf("IGMP join warning: %v", err)
			}
		}
	}

	// Set 250ms read timeout so reader goroutine checks context cancellation responsively
	tv := syscall.NsecToTimeval(250 * int64(time.Millisecond))
	_ = syscall.SetsockoptTimeval(fd, syscall.SOL_SOCKET, syscall.SO_RCVTIMEO, &tv)

	r.fd = fd
	r.joined = true
	r.joinedAtMs = time.Now().UnixMilli()
	r.joinedMono = time.Now()
	r.lastPacketMs = 0

	ctx, cancel := context.WithCancel(context.Background())
	doneCh := make(chan struct{})
	r.cancel = cancel
	r.doneCh = doneCh
	r.mu.Unlock()

	go r.runReceiveLoop(ctx, doneCh, fd)

	return r.getStats(false), nil
}

func (r *goMulticastReceiver) runReceiveLoop(ctx context.Context, doneCh chan struct{}, fd int) {
	defer close(doneCh)

	// Start 1-second rolling history ticker in parallel
	go func() {
		ticker := time.NewTicker(1 * time.Second)
		defer ticker.Stop()
		lastTick := time.Now()
		for {
			select {
			case <-ctx.Done():
				return
			case now := <-ticker.C:
				dtSec := now.Sub(lastTick).Seconds()
				lastTick = now
				if dtSec <= 0 {
					continue
				}
				r.mu.Lock()
				if !r.joined {
					r.mu.Unlock()
					return
				}
				r.rxBitrateKbps = math.Round(((float64(r.windowBytes)*8.0)/(dtSec*1000.0))*10.0) / 10.0
				r.rxPps = math.Round((float64(r.windowPackets)/dtSec)*10.0) / 10.0
				r.windowBytes = 0
				r.windowPackets = 0

				var lossPct float64
				if r.packetsExpected > 0 {
					lossPct = math.Round((float64(r.packetsLost)/float64(r.packetsExpected))*10000.0) / 100.0
				}
				sample := MulticastThroughputSample{
					Ts:       now.UnixMilli(),
					Kbps:     r.rxBitrateKbps,
					Pps:      r.rxPps,
					LossPct:  lossPct,
					MaxGapMs: math.Round(r.maxGapMs*10.0) / 10.0,
				}
				r.history = append(r.history, sample)
				if len(r.history) > maxHistoryPoints {
					r.history = r.history[len(r.history)-maxHistoryPoints:]
				}
				r.mu.Unlock()
			}
		}
	}()

	buf := make([]byte, 2048)
	for {
		select {
		case <-ctx.Done():
			return
		default:
		}
		n, from, err := syscall.Recvfrom(fd, buf, 0)
		if err != nil {
			if err == syscall.EAGAIN || err == syscall.EWOULDBLOCK || err == syscall.EINTR {
				continue
			}
			select {
			case <-ctx.Done():
				return
			default:
				r.mu.Lock()
				r.lastError = err.Error()
				r.mu.Unlock()
				time.Sleep(20 * time.Millisecond)
				continue
			}
		}
		if n <= 0 {
			continue
		}
		var senderIP string
		if sa4, ok := from.(*syscall.SockaddrInet4); ok {
			senderIP = net.IPv4(sa4.Addr[0], sa4.Addr[1], sa4.Addr[2], sa4.Addr[3]).String()
		}
		r.handlePacket(buf[:n], senderIP)
	}
}

func (r *goMulticastReceiver) leave() MulticastReceiverStats {
	r.mu.Lock()
	cancel := r.cancel
	doneCh := r.doneCh
	fd := r.fd
	r.cancel = nil
	r.doneCh = nil
	r.fd = -1
	wasJoined := r.joined
	r.joined = false
	r.rxBitrateKbps = 0
	r.rxPps = 0
	groupStr := r.appConfig.Group
	ifaceStr := r.interfaceIP
	mode := normalizeMCMode(r.appConfig.Mode)
	ssmSrc := r.appConfig.SSMSource
	r.mu.Unlock()

	if cancel != nil {
		cancel()
	}
	if fd >= 0 {
		if wasJoined {
			groupBytes, okG := parseIPv4Bytes(groupStr)
			ifaceBytes, okI := parseIPv4Bytes(ifaceStr)
			if okG && okI {
				if mode == "ssm" && ssmSrc != nil && *ssmSrc != "" {
					if srcBytes, okS := parseIPv4Bytes(*ssmSrc); okS {
						_ = leaveMulticastSSM(fd, groupBytes, ifaceBytes, srcBytes)
					}
				} else {
					mreq := &syscall.IPMreq{Multiaddr: groupBytes, Interface: ifaceBytes}
					_ = syscall.SetsockoptIPMreq(fd, syscall.IPPROTO_IP, syscall.IP_DROP_MEMBERSHIP, mreq)
				}
			}
		}
		_ = syscall.Close(fd)
	}
	if doneCh != nil {
		select {
		case <-doneCh:
		case <-time.After(500 * time.Millisecond):
		}
	}
	return r.getStats(false)
}

func (r *goMulticastReceiver) resetCounters() MulticastReceiverStats {
	r.mu.Lock()
	r.resetRunCountersLocked(r.currentRunID)
	r.mu.Unlock()
	return r.getStats(true)
}

func (r *goMulticastReceiver) evaluateVerdictLocked(
	senderActive bool,
	lossPct float64,
	jitterMs float64,
	currentSilenceMs int64,
) (string, string) {
	maxLossPct := 0.1
	if r.appConfig.Thresholds.MaxLossPct != nil {
		maxLossPct = *r.appConfig.Thresholds.MaxLossPct
	}
	maxJitterMs := 30.0
	if r.appConfig.Thresholds.MaxJitterMs != nil {
		maxJitterMs = *r.appConfig.Thresholds.MaxJitterMs
	}
	maxGapMs := 1000.0
	if r.appConfig.Thresholds.MaxGapMs != nil {
		maxGapMs = *r.appConfig.Thresholds.MaxGapMs
	}
	var maxDuplicates uint64
	if r.appConfig.Thresholds.MaxDuplicates != nil {
		maxDuplicates = *r.appConfig.Thresholds.MaxDuplicates
	}
	maxJoinLatencyMs := 3000.0
	if r.appConfig.Thresholds.MaxJoinLatencyMs != nil {
		maxJoinLatencyMs = *r.appConfig.Thresholds.MaxJoinLatencyMs
	}

	if r.expect == "none" {
		if r.packetsReceived > 0 {
			return "FAILED", fmt.Sprintf("Policy leak detected: received %d unexpected multicast packet(s) while expect=none", r.packetsReceived)
		}
		if r.joined {
			return "HEALTHY", "No multicast traffic received (matches negative expectation)"
		}
		return "NO_TRAFFIC", "Idle (expect=none)"
	}

	if !r.joined && r.packetsReceived == 0 {
		return "NO_TRAFFIC", "Receiver not joined to multicast group"
	}

	if r.packetsReceived == 0 {
		silenceSinceJoin := time.Now().UnixMilli() - r.joinedAtMs
		if senderActive && silenceSinceJoin > 2500 {
			return "FAILED", fmt.Sprintf("IGMP joined on %s (%s) but 0 packets received after %.1fs", r.interfaceName, r.interfaceIP, float64(silenceSinceJoin)/1000.0)
		}
		return "NO_TRAFFIC", "Joined IGMP group, awaiting multicast stream..."
	}

	if senderActive && currentSilenceMs > int64(math.Max(3000.0, maxGapMs*2.0)) {
		return "FAILED", fmt.Sprintf("Stream stalled: no packets received for %.1fs", float64(currentSilenceMs)/1000.0)
	}

	if lossPct > math.Max(5.0, maxLossPct*10.0) {
		return "FAILED", fmt.Sprintf("Severe packet loss: %.2f%% (threshold: %.2f%%)", lossPct, maxLossPct)
	}

	var reasons []string
	if lossPct > maxLossPct {
		reasons = append(reasons, fmt.Sprintf("loss %.2f%% > %.2f%%", lossPct, maxLossPct))
	}
	if jitterMs > maxJitterMs {
		reasons = append(reasons, fmt.Sprintf("jitter %.2fms > %.2fms", jitterMs, maxJitterMs))
	}
	if r.maxGapMs > maxGapMs {
		reasons = append(reasons, fmt.Sprintf("max gap %.0fms > %.0fms", r.maxGapMs, maxGapMs))
	}
	if r.duplicatePackets > maxDuplicates {
		reasons = append(reasons, fmt.Sprintf("duplicates %d > %d", r.duplicatePackets, maxDuplicates))
	}
	if r.joinLatencyMs != nil && *r.joinLatencyMs > maxJoinLatencyMs {
		reasons = append(reasons, fmt.Sprintf("join latency %.0fms > %.0fms", *r.joinLatencyMs, maxJoinLatencyMs))
	}

	if len(reasons) > 0 {
		return "DEGRADED", "SLA threshold exceeded: " + strings.Join(reasons, ", ")
	}
	return "HEALTHY", "Stream healthy — zero SLA violations"
}

func (r *goMulticastReceiver) getStats(senderActive bool) MulticastReceiverStats {
	r.mu.RLock()
	defer r.mu.RUnlock()

	nowMs := time.Now().UnixMilli()
	var currentSilenceMs int64
	if r.joined {
		if r.lastPacketMs > 0 {
			currentSilenceMs = nowMs - r.lastPacketMs
		} else if r.joinedAtMs > 0 {
			currentSilenceMs = nowMs - r.joinedAtMs
		}
		if currentSilenceMs < 0 {
			currentSilenceMs = 0
		}
	}

	var lossPct float64
	if r.packetsExpected > 0 {
		lossPct = math.Round((float64(r.packetsLost)/float64(r.packetsExpected))*10000.0) / 100.0
	}
	jitterRounded := math.Round(r.jitterMs*100.0) / 100.0
	maxGapRounded := math.Round(r.maxGapMs*10.0) / 10.0

	verdict, verdictReason := r.evaluateVerdictLocked(senderActive, lossPct, jitterRounded, currentSilenceMs)

	var firstSeqCopy *uint64
	if r.firstSeq != nil {
		v := *r.firstSeq
		firstSeqCopy = &v
	}
	var highestSeqCopy *uint64
	if r.highestSeq != nil {
		v := *r.highestSeq
		highestSeqCopy = &v
	}
	var joinLatCopy *float64
	if r.joinLatencyMs != nil {
		v := *r.joinLatencyMs
		joinLatCopy = &v
	}

	histCopy := make([]MulticastThroughputSample, len(r.history))
	copy(histCopy, r.history)

	return MulticastReceiverStats{
		AppID:            r.appConfig.ID,
		Node:             r.nodeID,
		Joined:           r.joined,
		Expect:           r.expect,
		Group:            r.appConfig.Group,
		Port:             r.appConfig.Port,
		Mode:             normalizeMCMode(r.appConfig.Mode),
		SSMSource:        r.appConfig.SSMSource,
		InterfaceName:    r.interfaceName,
		InterfaceIP:      r.interfaceIP,
		IGMPVersion:      r.igmpVersion,
		RunID:            r.currentRunID,
		FirstSeq:         firstSeqCopy,
		HighestSeq:       highestSeqCopy,
		PacketsReceived:  r.packetsReceived,
		PacketsExpected:  r.packetsExpected,
		PacketsLost:      r.packetsLost,
		LossPct:          lossPct,
		DuplicatePackets: r.duplicatePackets,
		ReorderedPackets: r.reorderedPackets,
		ForeignPackets:   r.foreignPackets,
		BytesReceived:    r.bytesReceived,
		RxBitrateKbps:    r.rxBitrateKbps,
		RxPps:            r.rxPps,
		JitterMs:         jitterRounded,
		MaxGapMs:         maxGapRounded,
		CurrentSilenceMs: currentSilenceMs,
		JoinLatencyMs:    joinLatCopy,
		JoinedAt:         r.joinedAtMs,
		LastPacketAt:     r.lastPacketMs,
		Verdict:          verdict,
		VerdictReason:    verdictReason,
		LastError:        r.lastError,
		History:          histCopy,
	}
}

// ─── Global Multicast Registry & RPC Handlers on 127.0.0.1:19090 ────────────

var (
	mcRegistryMu sync.RWMutex
	mcSenders    = make(map[string]*goMulticastSender)
	mcReceivers  = make(map[string]*goMulticastReceiver)
)

func deliverGoInMemoryLoopback(group string, port int, payload []byte, senderIP string) {
	mcRegistryMu.RLock()
	var targets []*goMulticastReceiver
	for _, rcv := range mcReceivers {
		rcv.mu.RLock()
		match := rcv.joined && rcv.appConfig.Group == group && rcv.appConfig.Port == port
		rcv.mu.RUnlock()
		if match {
			targets = append(targets, rcv)
		}
	}
	mcRegistryMu.RUnlock()

	if len(targets) == 0 {
		return
	}
	pktCopy := make([]byte, len(payload))
	copy(pktCopy, payload)
	for _, rcv := range targets {
		rcv.handlePacket(pktCopy, senderIP)
	}
}

type mcSenderStartReq struct {
	AppID         string                     `json:"appId"`
	NodeID        string                     `json:"nodeId"`
	InterfaceIP   string                     `json:"interfaceIp"`
	AllowLoopback bool                       `json:"allowLoopback"`
	Config        MulticastApplicationConfig `json:"config"`
}

type mcReceiverJoinReq struct {
	AppID       string                     `json:"appId"`
	NodeID      string                     `json:"nodeId"`
	Expect      string                     `json:"expect"`
	InterfaceIP string                     `json:"interfaceIp"`
	Config      MulticastApplicationConfig `json:"config"`
}

type mcAppIDReq struct {
	AppID        string `json:"appId"`
	SenderActive *bool  `json:"senderActive,omitempty"`
}

func registerMulticastRPC(mux *http.ServeMux) {
	// POST /multicast/sender/start
	mux.HandleFunc("/multicast/sender/start", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		var req mcSenderStartReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		appID := req.AppID
		if appID == "" {
			appID = req.Config.ID
		}
		if req.Config.ID == "" {
			req.Config.ID = appID
		}

		// Stop all existing active senders first (single active sender per node)
		mcRegistryMu.Lock()
		for id, existing := range mcSenders {
			if id != appID {
				existing.stop()
				delete(mcSenders, id)
			}
		}
		sender, exists := mcSenders[appID]
		if !exists {
			sender = newGoMulticastSender(req.Config, req.NodeID)
			mcSenders[appID] = sender
		} else {
			sender.mu.Lock()
			sender.appConfig = req.Config
			sender.nodeID = req.NodeID
			sender.streamID = computeMulticastStreamID(appID)
			sender.mu.Unlock()
		}
		mcRegistryMu.Unlock()

		stats, err := sender.start(req.InterfaceIP, req.AllowLoopback)
		w.Header().Set("Content-Type", "application/json")
		if err != nil {
			w.WriteHeader(http.StatusBadRequest)
			_ = json.NewEncoder(w).Encode(map[string]any{"success": false, "error": err.Error(), "sender": stats})
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"success": true, "sender": stats})
	})

	// POST /multicast/sender/stop
	mux.HandleFunc("/multicast/sender/stop", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		var req mcAppIDReq
		_ = json.NewDecoder(r.Body).Decode(&req)

		mcRegistryMu.RLock()
		sender := mcSenders[req.AppID]
		mcRegistryMu.RUnlock()

		w.Header().Set("Content-Type", "application/json")
		if sender == nil {
			_ = json.NewEncoder(w).Encode(map[string]any{"success": true, "sender": nil})
			return
		}
		stats := sender.stop()
		_ = json.NewEncoder(w).Encode(map[string]any{"success": true, "sender": stats})
	})

	// POST /multicast/receiver/join
	mux.HandleFunc("/multicast/receiver/join", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		var req mcReceiverJoinReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		appID := req.AppID
		if appID == "" {
			appID = req.Config.ID
		}
		if req.Config.ID == "" {
			req.Config.ID = appID
		}

		// Leave any other active receiver on the same port
		mcRegistryMu.Lock()
		for id, existing := range mcReceivers {
			if id != appID {
				existing.leave()
				delete(mcReceivers, id)
			}
		}
		rcv, exists := mcReceivers[appID]
		if !exists {
			rcv = newGoMulticastReceiver(req.Config, req.NodeID, req.Expect)
			mcReceivers[appID] = rcv
		} else {
			rcv.mu.Lock()
			rcv.appConfig = req.Config
			rcv.nodeID = req.NodeID
			rcv.expectedSate = computeMulticastStreamID(appID)
			rcv.mu.Unlock()
		}
		mcRegistryMu.Unlock()

		stats, err := rcv.join(req.InterfaceIP, req.Expect)
		w.Header().Set("Content-Type", "application/json")
		if err != nil {
			w.WriteHeader(http.StatusBadRequest)
			_ = json.NewEncoder(w).Encode(map[string]any{"success": false, "error": err.Error(), "receiver": stats})
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"success": true, "receiver": stats})
	})

	// POST /multicast/receiver/leave
	mux.HandleFunc("/multicast/receiver/leave", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		var req mcAppIDReq
		_ = json.NewDecoder(r.Body).Decode(&req)

		mcRegistryMu.RLock()
		rcv := mcReceivers[req.AppID]
		mcRegistryMu.RUnlock()

		w.Header().Set("Content-Type", "application/json")
		if rcv == nil {
			_ = json.NewEncoder(w).Encode(map[string]any{"success": true, "receiver": nil})
			return
		}
		stats := rcv.leave()
		_ = json.NewEncoder(w).Encode(map[string]any{"success": true, "receiver": stats})
	})

	// POST /multicast/receiver/reset
	mux.HandleFunc("/multicast/receiver/reset", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		var req mcAppIDReq
		_ = json.NewDecoder(r.Body).Decode(&req)

		mcRegistryMu.RLock()
		rcv := mcReceivers[req.AppID]
		mcRegistryMu.RUnlock()

		w.Header().Set("Content-Type", "application/json")
		if rcv == nil {
			_ = json.NewEncoder(w).Encode(map[string]any{"success": true, "receiver": nil})
			return
		}
		stats := rcv.resetCounters()
		_ = json.NewEncoder(w).Encode(map[string]any{"success": true, "receiver": stats})
	})

	// GET /multicast/stats?appId=...&senderActive=...
	mux.HandleFunc("/multicast/stats", func(w http.ResponseWriter, r *http.Request) {
		appID := r.URL.Query().Get("appId")
		senderActiveParam := r.URL.Query().Get("senderActive")

		mcRegistryMu.RLock()
		sender := mcSenders[appID]
		rcv := mcReceivers[appID]
		mcRegistryMu.RUnlock()

		var senderStats *MulticastSenderStats
		senderActive := true
		if sender != nil {
			st := sender.getStats()
			senderStats = &st
			senderActive = st.Active
		}
		if senderActiveParam == "false" {
			senderActive = false
		} else if senderActiveParam == "true" {
			senderActive = true
		}

		var receiverStats *MulticastReceiverStats
		if rcv != nil {
			st := rcv.getStats(senderActive)
			receiverStats = &st
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"success":  true,
			"engine":   "stigix-go",
			"sender":   senderStats,
			"receiver": receiverStats,
		})
	})

	// POST /multicast/stop-all
	mux.HandleFunc("/multicast/stop-all", func(w http.ResponseWriter, r *http.Request) {
		mcRegistryMu.Lock()
		for _, s := range mcSenders {
			s.stop()
		}
		for _, rcv := range mcReceivers {
			rcv.leave()
		}
		mcSenders = make(map[string]*goMulticastSender)
		mcReceivers = make(map[string]*goMulticastReceiver)
		mcRegistryMu.Unlock()

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"success": true})
	})
}

// Keep unused atomic import satisfied if needed
var _ = atomic.Int32{}
