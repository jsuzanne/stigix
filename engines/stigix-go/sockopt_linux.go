//go:build linux

package main

import (
	"net"
	"syscall"
	"unsafe"
)

const (
	linuxSoReusePort           = 15
	linuxIPAddSourceMembership = 39
	linuxIPDropSourceMembership = 40
)

// linuxIPMreqSource matches struct ip_mreq_source in <linux/in.h>:
// imr_multiaddr, imr_interface, imr_sourceaddr
type linuxIPMreqSource struct {
	Multiaddr  [4]byte
	Interface  [4]byte
	Sourceaddr [4]byte
}

func applySocketOptions(conn *net.UDPConn, iface string, tos int, rcvBuf int, sndBuf int) {
	rawConn, err := conn.SyscallConn()
	if err != nil {
		return
	}
	_ = rawConn.Control(func(fd uintptr) {
		if tos > 0 {
			_ = syscall.SetsockoptInt(int(fd), syscall.IPPROTO_IP, syscall.IP_TOS, tos)
		}
		if iface != "" && iface != "auto" && iface != "default" {
			_ = syscall.SetsockoptString(int(fd), syscall.SOL_SOCKET, syscall.SO_BINDTODEVICE, iface)
		}
		if rcvBuf > 0 {
			_ = syscall.SetsockoptInt(int(fd), syscall.SOL_SOCKET, syscall.SO_RCVBUF, rcvBuf)
		}
		if sndBuf > 0 {
			_ = syscall.SetsockoptInt(int(fd), syscall.SOL_SOCKET, syscall.SO_SNDBUF, sndBuf)
		}
	})
}

func bindToDevice(fd int, iface string) {
	if iface != "" && iface != "auto" && iface != "default" {
		_ = syscall.SetsockoptString(fd, syscall.SOL_SOCKET, syscall.SO_BINDTODEVICE, iface)
	}
}

func setMulticastReuseAddrPort(fd int) {
	_ = syscall.SetsockoptInt(fd, syscall.SOL_SOCKET, syscall.SO_REUSEADDR, 1)
	_ = syscall.SetsockoptInt(fd, syscall.SOL_SOCKET, linuxSoReusePort, 1)
}

func joinMulticastSSM(fd int, groupIP, ifaceIP, sourceIP [4]byte) error {
	mreq := linuxIPMreqSource{
		Multiaddr:  groupIP,
		Interface:  ifaceIP,
		Sourceaddr: sourceIP,
	}
	_, _, errno := syscall.Syscall6(
		syscall.SYS_SETSOCKOPT,
		uintptr(fd),
		uintptr(syscall.IPPROTO_IP),
		uintptr(linuxIPAddSourceMembership),
		uintptr(unsafe.Pointer(&mreq)),
		unsafe.Sizeof(mreq),
		0,
	)
	if errno != 0 {
		return errno
	}
	return nil
}

func leaveMulticastSSM(fd int, groupIP, ifaceIP, sourceIP [4]byte) error {
	mreq := linuxIPMreqSource{
		Multiaddr:  groupIP,
		Interface:  ifaceIP,
		Sourceaddr: sourceIP,
	}
	_, _, errno := syscall.Syscall6(
		syscall.SYS_SETSOCKOPT,
		uintptr(fd),
		uintptr(syscall.IPPROTO_IP),
		uintptr(linuxIPDropSourceMembership),
		uintptr(unsafe.Pointer(&mreq)),
		unsafe.Sizeof(mreq),
		0,
	)
	if errno != 0 {
		return errno
	}
	return nil
}


