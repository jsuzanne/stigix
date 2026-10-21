//go:build !linux

package main

import (
	"net"
	"syscall"
)

func applySocketOptions(conn *net.UDPConn, _ string, tos int, rcvBuf int, sndBuf int) {
	rawConn, err := conn.SyscallConn()
	if err != nil {
		return
	}
	_ = rawConn.Control(func(fd uintptr) {
		if tos > 0 {
			_ = syscall.SetsockoptInt(int(fd), syscall.IPPROTO_IP, syscall.IP_TOS, tos)
		}
		if rcvBuf > 0 {
			_ = syscall.SetsockoptInt(int(fd), syscall.SOL_SOCKET, syscall.SO_RCVBUF, rcvBuf)
		}
		if sndBuf > 0 {
			_ = syscall.SetsockoptInt(int(fd), syscall.SOL_SOCKET, syscall.SO_SNDBUF, sndBuf)
		}
	})
}

func bindToDevice(_ int, _ string) {}

func setMulticastReuseAddrPort(fd int) {
	_ = syscall.SetsockoptInt(fd, syscall.SOL_SOCKET, syscall.SO_REUSEADDR, 1)
	_ = syscall.SetsockoptInt(fd, syscall.SOL_SOCKET, syscall.SO_REUSEPORT, 1)
}

func joinMulticastSSM(fd int, groupIP, ifaceIP, _ [4]byte) error {
	// Fallback to ASM membership on non-Linux platforms if SSM is requested
	mreq := &syscall.IPMreq{
		Multiaddr: groupIP,
		Interface: ifaceIP,
	}
	return syscall.SetsockoptIPMreq(fd, syscall.IPPROTO_IP, syscall.IP_ADD_MEMBERSHIP, mreq)
}

func leaveMulticastSSM(fd int, groupIP, ifaceIP, _ [4]byte) error {
	mreq := &syscall.IPMreq{
		Multiaddr: groupIP,
		Interface: ifaceIP,
	}
	return syscall.SetsockoptIPMreq(fd, syscall.IPPROTO_IP, syscall.IP_DROP_MEMBERSHIP, mreq)
}


