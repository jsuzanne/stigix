//go:build linux

package main

import (
	"net"
	"syscall"
)

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

