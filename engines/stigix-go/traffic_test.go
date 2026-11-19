package main

import (
	"net"
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func TestResolveTrafficInterfaces_DefaultFallbackEth0(t *testing.T) {
	t.Setenv("STIGIX_INTERFACES", "")
	tmpDir := t.TempDir()

	// 1. Missing interfaces.txt -> fallback ["eth0"], isWildcard=false
	ifaces, isWildcard := resolveTrafficInterfaces(tmpDir)
	if isWildcard {
		t.Fatalf("expected isWildcard=false when interfaces.txt is missing, got true")
	}
	if !reflect.DeepEqual(ifaces, []string{"eth0"}) {
		t.Fatalf("expected [eth0], got %v", ifaces)
	}

	// 2. Empty / comment-only interfaces.txt -> fallback ["eth0"], isWildcard=false
	if err := os.WriteFile(filepath.Join(tmpDir, "interfaces.txt"), []byte("# comment only\n   \n"), 0644); err != nil {
		t.Fatal(err)
	}
	ifaces, isWildcard = resolveTrafficInterfaces(tmpDir)
	if isWildcard {
		t.Fatalf("expected isWildcard=false when interfaces.txt has only comments, got true")
	}
	if !reflect.DeepEqual(ifaces, []string{"eth0"}) {
		t.Fatalf("expected [eth0], got %v", ifaces)
	}
}

func TestResolveTrafficInterfaces_ExactMultiInterfacesAndRoundRobin(t *testing.T) {
	t.Setenv("STIGIX_INTERFACES", "")
	tmpDir := t.TempDir()

	content := "# Multi-tunnel list\nuesimtun0\nuesimtun1\nuesimtun2\n"
	if err := os.WriteFile(filepath.Join(tmpDir, "interfaces.txt"), []byte(content), 0644); err != nil {
		t.Fatal(err)
	}

	ifaces, isWildcard := resolveTrafficInterfaces(tmpDir)
	if isWildcard {
		t.Fatalf("expected isWildcard=false for exact list, got true")
	}
	want := []string{"uesimtun0", "uesimtun1", "uesimtun2"}
	if !reflect.DeepEqual(ifaces, want) {
		t.Fatalf("expected %v, got %v", want, ifaces)
	}

	rrInterfaceCounter.Store(0)
	var picked []string
	for i := 0; i < 6; i++ {
		ifName, ok := pickNextInterface(tmpDir)
		if !ok {
			t.Fatalf("pickNextInterface returned ok=false at iteration %d", i)
		}
		picked = append(picked, ifName)
	}
	wantRR := []string{"uesimtun0", "uesimtun1", "uesimtun2", "uesimtun0", "uesimtun1", "uesimtun2"}
	if !reflect.DeepEqual(picked, wantRR) {
		t.Fatalf("expected Round-Robin sequence %v, got %v", wantRR, picked)
	}
}

func TestResolveTrafficInterfaces_WildcardZeroTunnelsAntiLeak(t *testing.T) {
	t.Setenv("STIGIX_INTERFACES", "")
	tmpDir := t.TempDir()

	if err := os.WriteFile(filepath.Join(tmpDir, "interfaces.txt"), []byte("uesimtun*\n"), 0644); err != nil {
		t.Fatal(err)
	}

	origList := listNetInterfaces
	defer func() { listNetInterfaces = origList }()

	// Simulate VM where eth0 is UP with IPv4, but all uesimtun* tunnels are down or absent
	listNetInterfaces = func() ([]netInterfaceInfo, error) {
		return []netInterfaceInfo{
			{Name: "eth0", Flags: net.FlagUp, HasIPv4: true, IPv4: "192.168.1.10"},
			{Name: "uesimtun0", Flags: 0, HasIPv4: true, IPv4: "10.45.0.2"}, // DOWN
		}, nil
	}

	ifaces, isWildcard := resolveTrafficInterfaces(tmpDir)
	if !isWildcard {
		t.Fatalf("expected isWildcard=true for uesimtun*, got false")
	}
	if len(ifaces) != 0 {
		t.Fatalf("expected 0 interfaces (no fallback to eth0!), got %v", ifaces)
	}

	picked, ok := pickNextInterface(tmpDir)
	if ok || picked != "" {
		t.Fatalf("expected pickNextInterface to return ('', false) when 0 uesimtun* tunnels are UP, got (%q, %v)", picked, ok)
	}
}

func TestResolveTrafficInterfaces_WildcardMultipleActiveTunnels(t *testing.T) {
	t.Setenv("STIGIX_INTERFACES", "")
	tmpDir := t.TempDir()

	if err := os.WriteFile(filepath.Join(tmpDir, "interfaces.txt"), []byte("uesimtun*\n"), 0644); err != nil {
		t.Fatal(err)
	}

	origList := listNetInterfaces
	defer func() { listNetInterfaces = origList }()

	// Out-of-order active tunnels + 1 down tunnel + 1 tunnel without IPv4 + eth0
	listNetInterfaces = func() ([]netInterfaceInfo, error) {
		return []netInterfaceInfo{
			{Name: "eth0", Flags: net.FlagUp, HasIPv4: true, IPv4: "192.168.1.10"},
			{Name: "uesimtun2", Flags: net.FlagUp, HasIPv4: true, IPv4: "10.45.0.4"},
			{Name: "uesimtun0", Flags: net.FlagUp, HasIPv4: true, IPv4: "10.45.0.2"},
			{Name: "uesimtun3", Flags: 0, HasIPv4: true, IPv4: "10.45.0.5"},          // DOWN -> must be ignored
			{Name: "uesimtun4", Flags: net.FlagUp, HasIPv4: false, IPv4: ""},         // No IPv4 -> must be ignored
			{Name: "uesimtun1", Flags: net.FlagUp, HasIPv4: true, IPv4: "10.45.0.3"},
		}, nil
	}

	ifaces, isWildcard := resolveTrafficInterfaces(tmpDir)
	if !isWildcard {
		t.Fatalf("expected isWildcard=true, got false")
	}
	want := []string{"uesimtun0", "uesimtun1", "uesimtun2"}
	if !reflect.DeepEqual(ifaces, want) {
		t.Fatalf("expected sorted active tunnels %v, got %v", want, ifaces)
	}

	if ip := getInterfaceIPv4("uesimtun1"); ip != "10.45.0.3" {
		t.Fatalf("expected IP 10.45.0.3 for uesimtun1, got %q", ip)
	}

	rrInterfaceCounter.Store(0)
	var picked []string
	for i := 0; i < 4; i++ {
		ifName, ok := pickNextInterface(tmpDir)
		if !ok {
			t.Fatalf("expected ok=true at step %d", i)
		}
		picked = append(picked, ifName)
	}
	wantRR := []string{"uesimtun0", "uesimtun1", "uesimtun2", "uesimtun0"}
	if !reflect.DeepEqual(picked, wantRR) {
		t.Fatalf("expected %v, got %v", wantRR, picked)
	}
}

func TestAssignTunnelForIoTDevice_StickyAndBalanced(t *testing.T) {
	t.Setenv("STIGIX_INTERFACES", "uesimtun*")
	origList := listNetInterfaces
	defer func() { listNetInterfaces = origList }()

	listNetInterfaces = func() ([]netInterfaceInfo, error) {
		return []netInterfaceInfo{
			{Name: "uesimtun0", Flags: net.FlagUp, HasIPv4: true, IPv4: "10.45.0.4"},
			{Name: "uesimtun1", Flags: net.FlagUp, HasIPv4: true, IPv4: "10.45.0.5"},
			{Name: "uesimtun2", Flags: net.FlagUp, HasIPv4: true, IPv4: "10.45.0.6"},
		}, nil
	}

	iotTunnelAssignMu.Lock()
	iotDeviceTunnelMap = make(map[string]string)
	iotTunnelAssignMu.Unlock()
	iotTunnelAssignCounter.Store(0)

	t1, ip1, ok1 := assignTunnelForIoTDevice("cam-01", "")
	t2, ip2, ok2 := assignTunnelForIoTDevice("plc-02", "")
	t3, ip3, ok3 := assignTunnelForIoTDevice("mri-03", "")
	if !ok1 || !ok2 || !ok3 {
		t.Fatalf("expected all 3 IoT devices to receive a tunnel")
	}
	if t1 == t2 || t2 == t3 || t1 == t3 {
		t.Fatalf("expected 3 distinct tunnels for 3 devices, got %s, %s, %s", t1, t2, t3)
	}
	if ip1 == "" || ip2 == "" || ip3 == "" {
		t.Fatalf("expected non-empty tunnel IPs")
	}

	// Sticky check: re-requesting cam-01 must return the exact same tunnel
	t1Again, ip1Again, okAgain := assignTunnelForIoTDevice("cam-01", "")
	if !okAgain || t1Again != t1 || ip1Again != ip1 {
		t.Fatalf("expected sticky tunnel %s (%s), got %s (%s)", t1, ip1, t1Again, ip1Again)
	}
}
