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
