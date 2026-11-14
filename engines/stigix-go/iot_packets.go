package main

import (
	"bytes"
	"encoding/binary"
	"fmt"
	"math/rand"
	"net"
	"strings"
)

var (
	broadcastMAC = [6]byte{0xff, 0xff, 0xff, 0xff, 0xff, 0xff}
	zeroMAC      = [6]byte{0x00, 0x00, 0x00, 0x00, 0x00, 0x00}
	lldpMulticastMAC = [6]byte{0x01, 0x80, 0xc2, 0x00, 0x00, 0x0e}
	mdnsMulticastMAC = [6]byte{0x01, 0x00, 0x5e, 0x00, 0x00, 0xfb}
	dhcpMagicCookie  = [4]byte{99, 130, 83, 99}
)

const (
	etherTypeIPv4 = 0x0800
	etherTypeARP  = 0x0806
	etherTypeLLDP = 0x88cc

	tcpFlagFIN = 0x01
	tcpFlagSYN = 0x02
	tcpFlagRST = 0x04
	tcpFlagPSH = 0x08
	tcpFlagACK = 0x10
	tcpFlagFA  = 0x11 // FIN | ACK
	tcpFlagSA  = 0x12 // SYN | ACK
	tcpFlagPA  = 0x18 // PSH | ACK
)

func parseMAC(s string) ([6]byte, error) {
	var out [6]byte
	hw, err := net.ParseMAC(strings.TrimSpace(s))
	if err != nil || len(hw) < 6 {
		return out, fmt.Errorf("invalid MAC %q: %w", s, err)
	}
	copy(out[:], hw[:6])
	return out, nil
}

func parseIPv4(s string) ([4]byte, error) {
	var out [4]byte
	ip := net.ParseIP(strings.TrimSpace(s))
	if ip == nil {
		return out, fmt.Errorf("invalid IPv4 %q", s)
	}
	ip4 := ip.To4()
	if ip4 == nil {
		return out, fmt.Errorf("not an IPv4 %q", s)
	}
	copy(out[:], ip4[:4])
	return out, nil
}

func ipv4Checksum(hdr []byte) uint16 {
	var sum uint32
	for i := 0; i+1 < len(hdr); i += 2 {
		sum += uint32(binary.BigEndian.Uint16(hdr[i : i+2]))
	}
	if len(hdr)%2 == 1 {
		sum += uint32(hdr[len(hdr)-1]) << 8
	}
	for (sum >> 16) > 0 {
		sum = (sum & 0xffff) + (sum >> 16)
	}
	return ^uint16(sum)
}

func l4Checksum(srcIP, dstIP [4]byte, proto uint8, l4 []byte) uint16 {
	var sum uint32
	// Pseudo-header
	sum += uint32(binary.BigEndian.Uint16(srcIP[0:2]))
	sum += uint32(binary.BigEndian.Uint16(srcIP[2:4]))
	sum += uint32(binary.BigEndian.Uint16(dstIP[0:2]))
	sum += uint32(binary.BigEndian.Uint16(dstIP[2:4]))
	sum += uint32(proto)
	sum += uint32(len(l4))

	for i := 0; i+1 < len(l4); i += 2 {
		sum += uint32(binary.BigEndian.Uint16(l4[i : i+2]))
	}
	if len(l4)%2 == 1 {
		sum += uint32(l4[len(l4)-1]) << 8
	}
	for (sum >> 16) > 0 {
		sum = (sum & 0xffff) + (sum >> 16)
	}
	cs := ^uint16(sum)
	if proto == 17 && cs == 0 {
		return 0xffff
	}
	return cs
}

func buildEthernetFrame(dstMAC, srcMAC [6]byte, etherType uint16, payload []byte) []byte {
	frame := make([]byte, 14+len(payload))
	copy(frame[0:6], dstMAC[:])
	copy(frame[6:12], srcMAC[:])
	binary.BigEndian.PutUint16(frame[12:14], etherType)
	copy(frame[14:], payload)
	return frame
}

// buildARPFrame builds a 42-byte Ethernet + ARP packet.
// op=1: who-has request; op=2: is-at reply / gratuitous ARP.
func buildARPFrame(op uint16, srcMAC [6]byte, srcIP [4]byte, dstMAC [6]byte, dstIP [4]byte, gratuitous bool) []byte {
	arp := make([]byte, 28)
	binary.BigEndian.PutUint16(arp[0:2], 1)          // Hardware type: Ethernet (1)
	binary.BigEndian.PutUint16(arp[2:4], etherTypeIPv4) // Protocol type: IPv4 (0x0800)
	arp[4] = 6                                       // Hardware size: 6
	arp[5] = 4                                       // Protocol size: 4
	binary.BigEndian.PutUint16(arp[6:8], op)         // Opcode
	copy(arp[8:14], srcMAC[:])
	copy(arp[14:18], srcIP[:])
	if gratuitous {
		copy(arp[18:24], broadcastMAC[:])
		copy(arp[24:28], srcIP[:])
		return buildEthernetFrame(broadcastMAC, srcMAC, etherTypeARP, arp)
	}
	if op == 1 {
		copy(arp[18:24], zeroMAC[:])
		copy(arp[24:28], dstIP[:])
		return buildEthernetFrame(broadcastMAC, srcMAC, etherTypeARP, arp)
	}
	copy(arp[18:24], dstMAC[:])
	copy(arp[24:28], dstIP[:])
	return buildEthernetFrame(dstMAC, srcMAC, etherTypeARP, arp)
}

func encodeLLDPTLV(tlvType uint8, val []byte) []byte {
	length := len(val)
	if length > 511 {
		length = 511
		val = val[:511]
	}
	hdr := (uint16(tlvType) << 9) | uint16(length&0x01ff)
	out := make([]byte, 2+length)
	binary.BigEndian.PutUint16(out[0:2], hdr)
	copy(out[2:], val)
	return out
}

// buildLLDPFrame builds an Ethernet + LLDPDU advertisement matching Scapy's contrib.lldp layout.
func buildLLDPFrame(srcMAC [6]byte, macStr, sysName, sysDesc string) []byte {
	var buf bytes.Buffer
	// TLV 1: Chassis ID (subtype 4 = MAC address string, matching Scapy LLDPDUChassisID(subtype=4, id=self.mac.encode()))
	chassisVal := append([]byte{4}, []byte(macStr)...)
	buf.Write(encodeLLDPTLV(1, chassisVal))

	// TLV 2: Port ID (subtype 3 = MAC address string)
	portVal := append([]byte{3}, []byte(macStr)...)
	buf.Write(encodeLLDPTLV(2, portVal))

	// TLV 3: TTL (120 seconds)
	ttlVal := []byte{0x00, 120}
	buf.Write(encodeLLDPTLV(3, ttlVal))

	// TLV 5: System Name
	buf.Write(encodeLLDPTLV(5, []byte(sysName)))

	// TLV 6: System Description
	buf.Write(encodeLLDPTLV(6, []byte(sysDesc)))

	// TLV 0: End of LLDPDU
	buf.Write([]byte{0x00, 0x00})

	return buildEthernetFrame(lldpMulticastMAC, srcMAC, etherTypeLLDP, buf.Bytes())
}

func buildIPv4Header(srcIP, dstIP [4]byte, proto uint8, payloadLen int) []byte {
	hdr := make([]byte, 20)
	hdr[0] = 0x45 // Version 4, IHL 5
	hdr[1] = 0x00 // TOS
	binary.BigEndian.PutUint16(hdr[2:4], uint16(20+payloadLen))
	binary.BigEndian.PutUint16(hdr[4:6], uint16(rand.Intn(65535)))
	binary.BigEndian.PutUint16(hdr[6:8], 0x0000)
	hdr[8] = 64 // TTL
	hdr[9] = proto
	copy(hdr[12:16], srcIP[:])
	copy(hdr[16:20], dstIP[:])
	cs := ipv4Checksum(hdr)
	binary.BigEndian.PutUint16(hdr[10:12], cs)
	return hdr
}

func buildIPv4UDPFrame(dstMAC, srcMAC [6]byte, srcIP, dstIP [4]byte, srcPort, dstPort uint16, payload []byte) []byte {
	udpLen := 8 + len(payload)
	udp := make([]byte, udpLen)
	binary.BigEndian.PutUint16(udp[0:2], srcPort)
	binary.BigEndian.PutUint16(udp[2:4], dstPort)
	binary.BigEndian.PutUint16(udp[4:6], uint16(udpLen))
	copy(udp[8:], payload)
	cs := l4Checksum(srcIP, dstIP, 17, udp)
	binary.BigEndian.PutUint16(udp[6:8], cs)

	ipHdr := buildIPv4Header(srcIP, dstIP, 17, len(udp))
	ipPkt := append(ipHdr, udp...)
	return buildEthernetFrame(dstMAC, srcMAC, etherTypeIPv4, ipPkt)
}

func buildIPv4TCPFrame(dstMAC, srcMAC [6]byte, srcIP, dstIP [4]byte, srcPort, dstPort uint16, flags uint8, payload []byte) []byte {
	return buildIPv4TCPFrameWithSeq(dstMAC, srcMAC, srcIP, dstIP, srcPort, dstPort, rand.Uint32(), 0, flags, payload)
}

func buildIPv4TCPFrameWithSeq(dstMAC, srcMAC [6]byte, srcIP, dstIP [4]byte, srcPort, dstPort uint16, seq, ack uint32, flags uint8, payload []byte) []byte {
	tcpLen := 20 + len(payload)
	tcp := make([]byte, tcpLen)
	binary.BigEndian.PutUint16(tcp[0:2], srcPort)
	binary.BigEndian.PutUint16(tcp[2:4], dstPort)
	binary.BigEndian.PutUint32(tcp[4:8], seq)
	binary.BigEndian.PutUint32(tcp[8:12], ack)
	tcp[12] = 5 << 4 // Data offset: 20 bytes
	tcp[13] = flags
	binary.BigEndian.PutUint16(tcp[14:16], 16384) // Window
	copy(tcp[20:], payload)
	cs := l4Checksum(srcIP, dstIP, 6, tcp)
	binary.BigEndian.PutUint16(tcp[16:18], cs)

	ipHdr := buildIPv4Header(srcIP, dstIP, 6, len(tcp))
	ipPkt := append(ipHdr, tcp...)
	return buildEthernetFrame(dstMAC, srcMAC, etherTypeIPv4, ipPkt)
}

// buildDHCPFrame builds an L2 Ethernet + IPv4 + UDP(68->67) + BOOTP + DHCP packet.
// msgType: 1 = DISCOVER, 3 = REQUEST
func buildDHCPFrame(
	msgType uint8,
	xid uint32,
	srcMAC [6]byte,
	hostname string,
	vendorClassID string,
	clientIDType uint8,
	paramReqList []uint8,
	requestedIP string,
	serverID string,
) []byte {
	var bootp [240]byte
	bootp[0] = 1                                      // BOOTREQUEST
	bootp[1] = 1                                      // htype = Ethernet (1)
	bootp[2] = 6                                      // hlen = 6
	bootp[3] = 0                                      // hops = 0
	binary.BigEndian.PutUint32(bootp[4:8], xid)       // XID
	binary.BigEndian.PutUint16(bootp[10:12], 0x8000)  // Flags = Broadcast (0x8000)
	copy(bootp[28:34], srcMAC[:])                     // chaddr (first 6 bytes of 16-byte field)
	copy(bootp[236:240], dhcpMagicCookie[:])          // Magic cookie

	var opts bytes.Buffer
	// Option 53: DHCP Message Type
	opts.Write([]byte{53, 1, msgType})
	// Option 57: Maximum DHCP Message Size (1500)
	opts.Write([]byte{57, 2, 0x05, 0xdc})

	// Option 12: Hostname
	if hostname != "" {
		hb := []byte(hostname)
		if len(hb) > 255 {
			hb = hb[:255]
		}
		opts.WriteByte(12)
		opts.WriteByte(uint8(len(hb)))
		opts.Write(hb)
	}

	// Option 61: Client-identifier (type + 6-byte MAC)
	opts.Write([]byte{61, 7, clientIDType})
	opts.Write(srcMAC[:])

	// Option 60: Vendor Class Identifier
	if vendorClassID != "" {
		vb := []byte(vendorClassID)
		if len(vb) > 255 {
			vb = vb[:255]
		}
		opts.WriteByte(60)
		opts.WriteByte(uint8(len(vb)))
		opts.Write(vb)
	}

	// Option 55: Parameter Request List (exact order preserved for Prisma IoT fingerprinting)
	if len(paramReqList) > 0 {
		opts.WriteByte(55)
		opts.WriteByte(uint8(len(paramReqList)))
		opts.Write(paramReqList)
	}

	// Option 50: Requested IP Address (for REQUEST / INIT-REBOOT)
	if requestedIP != "" {
		if reqIP4, err := parseIPv4(requestedIP); err == nil {
			opts.Write([]byte{50, 4})
			opts.Write(reqIP4[:])
		}
	}

	// Option 54: Server Identifier (for normal REQUEST after OFFER)
	if serverID != "" {
		if srvIP4, err := parseIPv4(serverID); err == nil {
			opts.Write([]byte{54, 4})
			opts.Write(srvIP4[:])
		}
	}

	// Option 255: End
	opts.WriteByte(255)

	dhcpPayload := append(bootp[:], opts.Bytes()...)
	srcIP := [4]byte{0, 0, 0, 0}
	dstIP := [4]byte{255, 255, 255, 255}
	return buildIPv4UDPFrame(broadcastMAC, srcMAC, srcIP, dstIP, 68, 67, dhcpPayload)
}

type parsedDHCPReply struct {
	XID       uint32
	MsgType   uint8 // 2 = OFFER, 5 = ACK, 6 = NAK
	YourIP    string
	ServerIP  string
	RouterIP  string
	SenderMAC [6]byte
	Chaddr    [6]byte
}

func parseDHCPReply(frame []byte) (*parsedDHCPReply, bool) {
	if len(frame) < 14+20+8+240 {
		return nil, false
	}
	etherType := binary.BigEndian.Uint16(frame[12:14])
	ipOffset := 14
	if etherType == 0x8100 { // 802.1Q VLAN tag support if present
		if len(frame) < 18+20+8+240 {
			return nil, false
		}
		etherType = binary.BigEndian.Uint16(frame[16:18])
		ipOffset = 18
	}
	if etherType != etherTypeIPv4 {
		return nil, false
	}

	ipHdr := frame[ipOffset:]
	ihl := int(ipHdr[0]&0x0f) * 4
	if ihl < 20 || len(ipHdr) < ihl+8+240 {
		return nil, false
	}
	if ipHdr[9] != 17 { // UDP
		return nil, false
	}
	srcIP := net.IP(ipHdr[12:16]).String()

	udpHdr := ipHdr[ihl:]
	srcPort := binary.BigEndian.Uint16(udpHdr[0:2])
	dstPort := binary.BigEndian.Uint16(udpHdr[2:4])
	if srcPort != 67 || dstPort != 68 {
		return nil, false
	}

	bootp := udpHdr[8:]
	if len(bootp) < 240 {
		return nil, false
	}
	if bootp[0] != 2 { // BOOTREPLY
		return nil, false
	}
	if !bytes.Equal(bootp[236:240], dhcpMagicCookie[:]) {
		return nil, false
	}

	res := &parsedDHCPReply{
		XID:    binary.BigEndian.Uint32(bootp[4:8]),
		YourIP: net.IP(bootp[16:20]).String(),
	}
	copy(res.SenderMAC[:], frame[6:12])
	copy(res.Chaddr[:], bootp[28:34])

	siaddr := net.IP(bootp[20:24]).String()
	if siaddr != "0.0.0.0" && siaddr != "" {
		res.ServerIP = siaddr
	} else {
		res.ServerIP = srcIP
	}

	opts := bootp[240:]
	i := 0
	for i < len(opts) {
		code := opts[i]
		if code == 255 {
			break
		}
		if code == 0 {
			i++
			continue
		}
		if i+1 >= len(opts) {
			break
		}
		l := int(opts[i+1])
		if i+2+l > len(opts) {
			break
		}
		val := opts[i+2 : i+2+l]
		switch code {
		case 53: // Message Type
			if l >= 1 {
				res.MsgType = val[0]
			}
		case 3: // Router / Gateway
			if l >= 4 {
				res.RouterIP = net.IP(val[0:4]).String()
			}
		case 54: // DHCP Server Identifier
			if l >= 4 {
				res.ServerIP = net.IP(val[0:4]).String()
			}
		}
		i += 2 + l
	}

	if res.MsgType == 0 {
		return nil, false
	}
	return res, true
}

func parseARPFrame(frame []byte) (op uint16, senderMAC [6]byte, senderIP, targetIP string, ok bool) {
	if len(frame) < 14+28 {
		return 0, zeroMAC, "", "", false
	}
	etherType := binary.BigEndian.Uint16(frame[12:14])
	arpOffset := 14
	if etherType == 0x8100 {
		if len(frame) < 18+28 {
			return 0, zeroMAC, "", "", false
		}
		etherType = binary.BigEndian.Uint16(frame[16:18])
		arpOffset = 18
	}
	if etherType != etherTypeARP {
		return 0, zeroMAC, "", "", false
	}
	arp := frame[arpOffset:]
	if binary.BigEndian.Uint16(arp[0:2]) != 1 || binary.BigEndian.Uint16(arp[2:4]) != etherTypeIPv4 {
		return 0, zeroMAC, "", "", false
	}
	op = binary.BigEndian.Uint16(arp[6:8])
	copy(senderMAC[:], arp[8:14])
	senderIP = net.IP(arp[14:18]).String()
	targetIP = net.IP(arp[24:28]).String()
	return op, senderMAC, senderIP, targetIP, true
}

func buildDNSQueryPayload(domain string) []byte {
	var buf bytes.Buffer
	var hdr [12]byte
	binary.BigEndian.PutUint16(hdr[0:2], uint16(rand.Intn(65535))) // ID
	binary.BigEndian.PutUint16(hdr[2:4], 0x0100)                   // Flags: RD=1
	binary.BigEndian.PutUint16(hdr[4:6], 1)                        // QDCOUNT=1
	buf.Write(hdr[:])

	clean := strings.TrimSuffix(strings.TrimSpace(domain), ".")
	for _, label := range strings.Split(clean, ".") {
		if len(label) == 0 {
			continue
		}
		if len(label) > 63 {
			label = label[:63]
		}
		buf.WriteByte(uint8(len(label)))
		buf.WriteString(label)
	}
	buf.WriteByte(0x00) // Root label
	// QTYPE = A (1), QCLASS = IN (1)
	buf.Write([]byte{0x00, 0x01, 0x00, 0x01})
	return buf.Bytes()
}

func buildNTPPayload() []byte {
	pkt := make([]byte, 48)
	pkt[0] = 0x1b // LI=0, VN=3, Mode=3 (Client)
	return pkt
}

// buildHTTPGetPayload constructs a realistic HTTP/1.1 GET request with Host and vendor User-Agent
// for Palo Alto NGFW / Prisma SD-WAN App-ID (web-browsing), URL Filtering, and IoT Security fingerprinting.
func buildHTTPGetPayload(host, path, userAgent string) []byte {
	if path == "" {
		path = "/"
	}
	if host == "" {
		host = "iot.local"
	}
	if userAgent == "" {
		userAgent = "Mozilla/5.0 (Embedded; Linux armv7l) IoTDevice/1.0"
	}
	req := fmt.Sprintf(
		"GET %s HTTP/1.1\r\nHost: %s\r\nUser-Agent: %s\r\nAccept: */*\r\nConnection: close\r\n\r\n",
		path, host, userAgent,
	)
	return []byte(req)
}

// buildTLSClientHelloPayload constructs a valid TLS 1.2 ClientHello record containing the
// cleartext Server Name Indication (SNI) extension so Palo Alto App-ID / URL Filtering
// identifies the HTTPS domain and application without requiring full TLS crypto.
func buildTLSClientHelloPayload(serverName string) []byte {
	sni := strings.TrimSpace(serverName)
	if sni == "" {
		sni = "iot.cloud.local"
	}
	sniBytes := []byte(sni)

	// Extension: server_name (0x0000)
	// ServerNameList length (2) + NameType host_name (1 = 0x00) + HostName length (2) + HostName
	sniEntryLen := 1 + 2 + len(sniBytes)
	sniListLen := sniEntryLen
	var extBuf bytes.Buffer
	binary.Write(&extBuf, binary.BigEndian, uint16(0x0000))             // Extension Type: server_name
	binary.Write(&extBuf, binary.BigEndian, uint16(2+sniListLen))       // Extension Length
	binary.Write(&extBuf, binary.BigEndian, uint16(sniListLen))         // Server Name List Length
	extBuf.WriteByte(0x00)                                              // Name Type: host_name (0)
	binary.Write(&extBuf, binary.BigEndian, uint16(len(sniBytes)))      // Host Name Length
	extBuf.Write(sniBytes)

	// Extension: supported_groups (0x000a) -> secp256r1 (0x0017), x25519 (0x001d)
	extBuf.Write([]byte{0x00, 0x0a, 0x00, 0x06, 0x00, 0x04, 0x00, 0x1d, 0x00, 0x17})
	// Extension: ec_point_formats (0x000b) -> uncompressed (0x00)
	extBuf.Write([]byte{0x00, 0x0b, 0x00, 0x02, 0x01, 0x00})
	// Extension: signature_algorithms (0x000d)
	extBuf.Write([]byte{0x00, 0x0d, 0x00, 0x08, 0x00, 0x06, 0x04, 0x03, 0x04, 0x01, 0x02, 0x01})

	extensions := extBuf.Bytes()

	// ClientHello body
	var chBody bytes.Buffer
	chBody.Write([]byte{0x03, 0x03}) // Client Version: TLS 1.2 (0x0303)
	randomBytes := make([]byte, 32)
	for i := range randomBytes {
		randomBytes[i] = byte(rand.Intn(256))
	}
	chBody.Write(randomBytes)
	chBody.WriteByte(0x00) // Session ID Length: 0

	// Cipher Suites (4 suites = 8 bytes)
	cipherSuites := []byte{
		0xc0, 0x2f, // TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256
		0xc0, 0x30, // TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384
		0x00, 0x9c, // TLS_RSA_WITH_AES_128_GCM_SHA256
		0x00, 0x2f, // TLS_RSA_WITH_AES_128_CBC_SHA
	}
	binary.Write(&chBody, binary.BigEndian, uint16(len(cipherSuites)))
	chBody.Write(cipherSuites)

	// Compression Methods: 1 byte (null = 0x00)
	chBody.Write([]byte{0x01, 0x00})

	// Extensions length + bytes
	binary.Write(&chBody, binary.BigEndian, uint16(len(extensions)))
	chBody.Write(extensions)

	bodyBytes := chBody.Bytes()

	// Handshake Header: Type 1 (ClientHello) + 3-byte length
	var handshake bytes.Buffer
	handshake.WriteByte(0x01)
	handshake.WriteByte(byte((len(bodyBytes) >> 16) & 0xff))
	handshake.WriteByte(byte((len(bodyBytes) >> 8) & 0xff))
	handshake.WriteByte(byte(len(bodyBytes) & 0xff))
	handshake.Write(bodyBytes)

	hsBytes := handshake.Bytes()

	// TLS Record Header: ContentType 22 (0x16 Handshake), Version TLS 1.0 (0x0301), 2-byte length
	var record bytes.Buffer
	record.WriteByte(0x16)
	record.Write([]byte{0x03, 0x01})
	binary.Write(&record, binary.BigEndian, uint16(len(hsBytes)))
	record.Write(hsBytes)
	return record.Bytes()
}

// buildMQTTConnectPayload constructs a valid MQTT v3.1.1 CONNECT packet for Palo Alto App-ID (mqtt).
func buildMQTTConnectPayload(clientID string) []byte {
	cid := strings.TrimSpace(clientID)
	if cid == "" {
		cid = "iot-sensor"
	}
	if len(cid) > 64 {
		cid = cid[:64]
	}
	var varHdrAndPayload bytes.Buffer
	// Protocol Name: "MQTT"
	varHdrAndPayload.Write([]byte{0x00, 0x04, 'M', 'Q', 'T', 'T'})
	// Protocol Level: 4 (MQTT 3.1.1)
	varHdrAndPayload.WriteByte(0x04)
	// Connect Flags: 0x02 (Clean Session)
	varHdrAndPayload.WriteByte(0x02)
	// Keep Alive: 60 seconds
	varHdrAndPayload.Write([]byte{0x00, 0x3c})
	// Payload: Client Identifier (2-byte length + string)
	binary.Write(&varHdrAndPayload, binary.BigEndian, uint16(len(cid)))
	varHdrAndPayload.WriteString(cid)

	body := varHdrAndPayload.Bytes()
	out := make([]byte, 2+len(body))
	out[0] = 0x10 // MQTT Control Packet Type: CONNECT (1 << 4)
	out[1] = uint8(len(body))
	copy(out[2:], body)
	return out
}

// buildRTSPOptionsPayload constructs a valid RTSP/1.0 OPTIONS request for Palo Alto App-ID (rtsp).
func buildRTSPOptionsPayload(host, userAgent string) []byte {
	if host == "" {
		host = "192.168.1.1"
	}
	if userAgent == "" {
		userAgent = "LibVLC/3.0.18 (LIVE555 Streaming Media)"
	}
	req := fmt.Sprintf(
		"OPTIONS rtsp://%s:554/Streaming/Channels/101 RTSP/1.0\r\nCSeq: 1\r\nUser-Agent: %s\r\n\r\n",
		host, userAgent,
	)
	return []byte(req)
}

type parsedTCPSynAck struct {
	SenderMAC [6]byte
	SrcIP     string
	DstIP     string
	SrcIP4    [4]byte
	DstIP4    [4]byte
	SrcPort   uint16
	DstPort   uint16
	Seq       uint32
	Ack       uint32
}

// parseTCPSynAck inspects an incoming Ethernet frame for an IPv4 TCP SYN-ACK packet.
func parseTCPSynAck(frame []byte) (*parsedTCPSynAck, bool) {
	if len(frame) < 14+20+20 {
		return nil, false
	}
	etherType := binary.BigEndian.Uint16(frame[12:14])
	ipOffset := 14
	if etherType == 0x8100 {
		if len(frame) < 18+20+20 {
			return nil, false
		}
		etherType = binary.BigEndian.Uint16(frame[16:18])
		ipOffset = 18
	}
	if etherType != etherTypeIPv4 {
		return nil, false
	}
	ipHdr := frame[ipOffset:]
	ihl := int(ipHdr[0]&0x0f) * 4
	if ihl < 20 || len(ipHdr) < ihl+20 {
		return nil, false
	}
	if ipHdr[9] != 6 { // TCP
		return nil, false
	}
	tcpHdr := ipHdr[ihl:]
	flags := tcpHdr[13]
	if (flags & (tcpFlagSYN | tcpFlagACK)) != (tcpFlagSYN | tcpFlagACK) {
		return nil, false
	}
	if (flags & tcpFlagRST) != 0 {
		return nil, false
	}
	var res parsedTCPSynAck
	copy(res.SenderMAC[:], frame[6:12])
	copy(res.SrcIP4[:], ipHdr[12:16])
	copy(res.DstIP4[:], ipHdr[16:20])
	res.SrcIP = net.IP(ipHdr[12:16]).String()
	res.DstIP = net.IP(ipHdr[16:20]).String()
	res.SrcPort = binary.BigEndian.Uint16(tcpHdr[0:2])
	res.DstPort = binary.BigEndian.Uint16(tcpHdr[2:4])
	res.Seq = binary.BigEndian.Uint32(tcpHdr[4:8])
	res.Ack = binary.BigEndian.Uint32(tcpHdr[8:12])
	return &res, true
}

// parseAndBuildICMPEchoReply checks if frame is an IPv4 ICMP Echo Request (ping) targeting one of our
// virtual IoT device IPs, and if so returns a ready-to-send Ethernet ICMP Echo Reply frame.
func parseAndBuildICMPEchoReply(frame []byte, lookupDeviceMAC func(targetIP string) ([6]byte, bool)) ([]byte, bool) {
	if len(frame) < 14+20+8 {
		return nil, false
	}
	etherType := binary.BigEndian.Uint16(frame[12:14])
	ipOffset := 14
	if etherType == 0x8100 {
		if len(frame) < 18+20+8 {
			return nil, false
		}
		etherType = binary.BigEndian.Uint16(frame[16:18])
		ipOffset = 18
	}
	if etherType != etherTypeIPv4 {
		return nil, false
	}
	ipHdr := frame[ipOffset:]
	ihl := int(ipHdr[0]&0x0f) * 4
	totalLen := int(binary.BigEndian.Uint16(ipHdr[2:4]))
	if ihl < 20 || totalLen < ihl+8 || len(ipHdr) < totalLen {
		return nil, false
	}
	if ipHdr[9] != 1 { // ICMP
		return nil, false
	}
	icmpIn := ipHdr[ihl:totalLen]
	if icmpIn[0] != 8 || icmpIn[1] != 0 { // Type 8 = Echo Request, Code 0
		return nil, false
	}
	targetIP := net.IP(ipHdr[16:20]).String()
	devMAC, ok := lookupDeviceMAC(targetIP)
	if !ok {
		return nil, false
	}

	var senderMAC [6]byte
	copy(senderMAC[:], frame[6:12])
	var srcIP4, dstIP4 [4]byte
	copy(srcIP4[:], ipHdr[16:20]) // Virtual IoT device IP becomes source
	copy(dstIP4[:], ipHdr[12:16]) // Pinger IP becomes destination

	icmpReply := make([]byte, len(icmpIn))
	copy(icmpReply, icmpIn)
	icmpReply[0] = 0 // Type 0 = Echo Reply
	icmpReply[1] = 0
	icmpReply[2] = 0
	icmpReply[3] = 0
	cs := ipv4Checksum(icmpReply)
	binary.BigEndian.PutUint16(icmpReply[2:4], cs)

	replyIPHdr := buildIPv4Header(srcIP4, dstIP4, 1, len(icmpReply))
	replyPkt := append(replyIPHdr, icmpReply...)
	return buildEthernetFrame(senderMAC, devMAC, etherTypeIPv4, replyPkt), true
}
