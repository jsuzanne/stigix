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

	tcpFlagSYN = 0x02
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
	tcpLen := 20 + len(payload)
	tcp := make([]byte, tcpLen)
	binary.BigEndian.PutUint16(tcp[0:2], srcPort)
	binary.BigEndian.PutUint16(tcp[2:4], dstPort)
	binary.BigEndian.PutUint32(tcp[4:8], rand.Uint32()) // Seq
	binary.BigEndian.PutUint32(tcp[8:12], 0)            // Ack
	tcp[12] = 5 << 4                                    // Data offset: 20 bytes
	tcp[13] = flags
	binary.BigEndian.PutUint16(tcp[14:16], 8192) // Window
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
