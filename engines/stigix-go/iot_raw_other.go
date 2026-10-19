//go:build !linux

package main

import (
	"context"
	"time"
)

type iotRawEngine struct {
	ifaceName string
}

func newIoTRawEngine(_ context.Context, ifaceName string) (*iotRawEngine, error) {
	return &iotRawEngine{ifaceName: ifaceName}, nil
}

func (e *iotRawEngine) Close() {}

func (e *iotRawEngine) SendFrame(_ []byte) error {
	return nil
}

func (e *iotRawEngine) RegisterDeviceIP(_ string, _ [6]byte) {}

func (e *iotRawEngine) UnregisterDeviceIP(_ string) {}

func (e *iotRawEngine) ResolveDstMAC(dstIP, _ string) [6]byte {
	if dstIP == "224.0.0.251" {
		return mdnsMulticastMAC
	}
	return broadcastMAC
}

func (e *iotRawEngine) WaitDHCP(_ context.Context, _ uint32, _ []uint8, _ time.Duration) *parsedDHCPReply {
	return nil
}
