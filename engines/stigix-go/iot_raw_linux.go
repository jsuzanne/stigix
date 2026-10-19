//go:build linux

package main

import (
	"context"
	"fmt"
	"net"
	"sync"
	"syscall"
	"time"
)

func htons16(v uint16) uint16 {
	return (v << 8) | (v >> 8)
}

type iotRawEngine struct {
	ifaceName string
	ifIndex   int
	fd        int
	sendMu    sync.Mutex

	mu               sync.RWMutex
	dhcpWaiters      map[uint32]chan *parsedDHCPReply
	arpTable         map[string][6]byte // IP -> MAC
	deviceIPs        map[string][6]byte // Virtual IoT IP -> Virtual IoT MAC
	defaultRouterMAC [6]byte
	hasRouterMAC     bool
}

func newIoTRawEngine(ctx context.Context, ifaceName string) (*iotRawEngine, error) {
	ief, err := net.InterfaceByName(ifaceName)
	if err != nil {
		// Fallback to first non-loopback interface if specified interface does not exist
		ifaces, listErr := net.Interfaces()
		if listErr == nil {
			for _, candidate := range ifaces {
				if (candidate.Flags&net.FlagLoopback) == 0 && (candidate.Flags&net.FlagUp) != 0 {
					ief = &candidate
					ifaceName = candidate.Name
					break
				}
			}
		}
		if ief == nil {
			return nil, fmt.Errorf("interface %q not found: %w", ifaceName, err)
		}
	}

	proto := int(htons16(syscall.ETH_P_ALL))
	fd, err := syscall.Socket(syscall.AF_PACKET, syscall.SOCK_RAW, proto)
	if err != nil {
		return nil, fmt.Errorf("AF_PACKET socket failed (root/CAP_NET_RAW required): %w", err)
	}

	ll := &syscall.SockaddrLinklayer{
		Protocol: htons16(syscall.ETH_P_ALL),
		Ifindex:  ief.Index,
	}
	if err := syscall.Bind(fd, ll); err != nil {
		_ = syscall.Close(fd)
		return nil, fmt.Errorf("bind AF_PACKET to %s failed: %w", ifaceName, err)
	}

	// Set 250ms read timeout so reader goroutine checks context cancellation cleanly
	tv := syscall.Timeval{Sec: 0, Usec: 250_000}
	_ = syscall.SetsockoptTimeval(fd, syscall.SOL_SOCKET, syscall.SO_RCVTIMEO, &tv)
	_ = syscall.SetsockoptInt(fd, syscall.SOL_SOCKET, syscall.SO_RCVBUF, 4*1024*1024)

	eng := &iotRawEngine{
		ifaceName:   ifaceName,
		ifIndex:     ief.Index,
		fd:          fd,
		dhcpWaiters: make(map[uint32]chan *parsedDHCPReply),
		arpTable:    make(map[string][6]byte),
		deviceIPs:   make(map[string][6]byte),
	}

	go eng.readLoop(ctx)
	return eng, nil
}

func (e *iotRawEngine) Close() {
	if e.fd > 0 {
		_ = syscall.Close(e.fd)
		e.fd = -1
	}
}

func (e *iotRawEngine) readLoop(ctx context.Context) {
	buf := make([]byte, 2048)
	for {
		select {
		case <-ctx.Done():
			return
		default:
		}

		n, _, err := syscall.Recvfrom(e.fd, buf, 0)
		if err != nil || n < 14 {
			continue
		}
		frame := buf[:n]

		// 1. Check for DHCP Server reply (UDP 67 -> 68)
		if reply, ok := parseDHCPReply(frame); ok {
			e.mu.Lock()
			if reply.ServerIP != "" {
				e.arpTable[reply.ServerIP] = reply.SenderMAC
			}
			if reply.RouterIP != "" {
				e.arpTable[reply.RouterIP] = reply.SenderMAC
			}
			if !e.hasRouterMAC && reply.SenderMAC != zeroMAC && reply.SenderMAC != broadcastMAC {
				e.defaultRouterMAC = reply.SenderMAC
				e.hasRouterMAC = true
			}
			ch, waiting := e.dhcpWaiters[reply.XID]
			e.mu.Unlock()

			if waiting {
				select {
				case ch <- reply:
				default:
				}
			}
			continue
		}

		// 2. Check for ARP frame (learn gateway MAC & answer ARP who-has for our virtual IoT IPs)
		if op, senderMAC, senderIP, targetIP, ok := parseARPFrame(frame); ok {
			e.mu.Lock()
			if senderIP != "" && senderIP != "0.0.0.0" && senderMAC != zeroMAC && senderMAC != broadcastMAC {
				e.arpTable[senderIP] = senderMAC
				if !e.hasRouterMAC {
					e.defaultRouterMAC = senderMAC
					e.hasRouterMAC = true
				}
			}
			devMAC, isOurDevice := e.deviceIPs[targetIP]
			e.mu.Unlock()

			// Answer ARP "who-has <iot_device_ip>" on behalf of the virtual IoT device
			if op == 1 && isOurDevice && senderIP != targetIP {
				srcIP4, err1 := parseIPv4(targetIP)
				dstIP4, err2 := parseIPv4(senderIP)
				if err1 == nil && err2 == nil {
					arpReply := buildARPFrame(2, devMAC, srcIP4, senderMAC, dstIP4, false)
					_ = e.SendFrame(arpReply)
				}
			}
		}
	}
}

func (e *iotRawEngine) SendFrame(frame []byte) error {
	if len(frame) < 14 {
		return fmt.Errorf("frame too short (%d bytes)", len(frame))
	}
	var addr [8]byte
	copy(addr[0:6], frame[0:6])

	ll := &syscall.SockaddrLinklayer{
		Protocol: htons16(syscall.ETH_P_ALL),
		Ifindex:  e.ifIndex,
		Halen:    6,
		Addr:     addr,
	}

	e.sendMu.Lock()
	err := syscall.Sendto(e.fd, frame, 0, ll)
	e.sendMu.Unlock()
	return err
}

func (e *iotRawEngine) RegisterDeviceIP(ip string, mac [6]byte) {
	if ip == "" || ip == "0.0.0.0" {
		return
	}
	e.mu.Lock()
	e.deviceIPs[ip] = mac
	e.mu.Unlock()
}

func (e *iotRawEngine) UnregisterDeviceIP(ip string) {
	if ip == "" {
		return
	}
	e.mu.Lock()
	delete(e.deviceIPs, ip)
	e.mu.Unlock()
}

func (e *iotRawEngine) ResolveDstMAC(dstIP, gatewayIP string) [6]byte {
	if dstIP == "224.0.0.251" {
		return mdnsMulticastMAC
	}
	if dstIP == "255.255.255.255" {
		return broadcastMAC
	}
	e.mu.RLock()
	defer e.mu.RUnlock()
	if mac, ok := e.arpTable[dstIP]; ok {
		return mac
	}
	if gatewayIP != "" {
		if mac, ok := e.arpTable[gatewayIP]; ok {
			return mac
		}
	}
	if e.hasRouterMAC {
		return e.defaultRouterMAC
	}
	return broadcastMAC
}

func (e *iotRawEngine) WaitDHCP(ctx context.Context, xid uint32, wantTypes []uint8, timeout time.Duration) *parsedDHCPReply {
	ch := make(chan *parsedDHCPReply, 8)
	e.mu.Lock()
	e.dhcpWaiters[xid] = ch
	e.mu.Unlock()

	defer func() {
		e.mu.Lock()
		delete(e.dhcpWaiters, xid)
		e.mu.Unlock()
	}()

	timer := time.NewTimer(timeout)
	defer timer.Stop()

	for {
		select {
		case <-ctx.Done():
			return nil
		case <-timer.C:
			return nil
		case reply := <-ch:
			if reply == nil {
				continue
			}
			for _, t := range wantTypes {
				if reply.MsgType == t {
					return reply
				}
			}
		}
	}
}
