#!/usr/bin/env python3
"""
Stigix End-to-End Packet Trace & PCAP Correlation Feasibility Validator
======================================================================
Validates:
1. Triggering bounded packet captures (max N packets, BPF filter).
2. Consolidating and correlating dual-end captures (Branch vs Data Center).
3. Computing one-way latency (delta-t), TTL hop decrement, and packet loss detection.
4. Exporting a structured JSON trace report and a merged PCAP timeline.

Can be run in:
- --demo: Generates synthetic Branch and DC traffic to validate correlation algorithms immediately.
- --live: Captures live traffic on specified interfaces with packet caps.
"""

import os
import sys
import time
import json
import argparse
from typing import Dict, Any, List, Optional

try:
    from scapy.all import (
        IP, TCP, UDP, ICMP, Ether, Raw,
        wrpcap, rdpcap, sniff, AsyncSniffer
    )
except ImportError:
    print("Scapy is required: pip install scapy", file=sys.stderr)
    sys.exit(1)


def generate_synthetic_dual_trace(
    pcap_branch_path: str,
    pcap_dc_path: str,
    packet_count: int = 100,
    drop_count: int = 3,
    latency_ms: float = 14.5,
    jitter_ms: float = 2.0
):
    """Generate synthetic Branch and DC PCAP files with controlled latency and drops."""
    import random
    base_time = time.time()
    branch_pkts = []
    dc_pkts = []

    src_ip = "192.168.101.50"
    dst_ip = "10.0.10.100"
    src_port = 49152
    dst_port = 8080

    # Choose which packets will be dropped in transit
    drop_indices = set(random.sample(range(10, packet_count - 5), drop_count))

    for i in range(packet_count):
        # Branch packet
        t_br = base_time + (i * 0.02) # 20ms between packets
        ip_id = 10000 + i
        seq_num = 1000 + (i * 64)

        payload_bytes = f"STIGIX-TRACE-PKT-{i:04d}".encode('utf-8')
        pkt_br = (
            Ether(src="00:11:22:33:44:55", dst="00:11:22:33:44:01") /
            IP(src=src_ip, dst=dst_ip, id=ip_id, ttl=64) /
            TCP(sport=src_port, dport=dst_port, seq=seq_num, flags="PA") /
            Raw(load=payload_bytes)
        )
        pkt_br.time = t_br
        branch_pkts.append(pkt_br)

        # DC packet (if not dropped)
        if i not in drop_indices:
            current_delay = (latency_ms + random.uniform(-jitter_ms, jitter_ms)) / 1000.0
            t_dc = t_br + current_delay
            pkt_dc = (
                Ether(src="00:aa:bb:cc:dd:01", dst="00:aa:bb:cc:dd:ee") /
                IP(src=src_ip, dst=dst_ip, id=ip_id, ttl=62) / # Decremented TTL after SD-WAN hops
                TCP(sport=src_port, dport=dst_port, seq=seq_num, flags="PA") /
                Raw(load=payload_bytes)
            )
            pkt_dc.time = t_dc
            dc_pkts.append(pkt_dc)

    wrpcap(pcap_branch_path, branch_pkts)
    wrpcap(pcap_dc_path, dc_pkts)
    print(f"✓ Synthetic Branch trace generated: {pcap_branch_path} ({len(branch_pkts)} packets)")
    print(f"✓ Synthetic DC trace generated:     {pcap_dc_path} ({len(dc_pkts)} packets, {drop_count} dropped)")


def correlate_pcaps(
    branch_pcap_path: str,
    dc_pcap_path: str,
    output_merged_pcap: Optional[str] = None
) -> Dict[str, Any]:
    """Correlate Branch and DC packet captures into a unified performance analysis."""
    pkts_br = rdpcap(branch_pcap_path)
    pkts_dc = rdpcap(dc_pcap_path)

    # Index DC packets by signature: (src, dst, proto, ip_id) or (TCP seq)
    dc_index: Dict[tuple, Any] = {}
    for p in pkts_dc:
        if IP in p:
            if TCP in p:
                sig = (p[IP].src, p[IP].dst, 'TCP', p[TCP].seq)
            elif UDP in p:
                sig = (p[IP].src, p[IP].dst, 'UDP', p[IP].id)
            else:
                sig = (p[IP].src, p[IP].dst, p[IP].proto, p[IP].id)
            dc_index[sig] = p

    matches = []
    dropped_packets = []
    latencies_ms = []
    ttl_drops = []

    merged_timeline = []

    for p_br in pkts_br:
        merged_timeline.append(p_br)
        if IP in p_br:
            if TCP in p_br:
                sig = (p_br[IP].src, p_br[IP].dst, 'TCP', p_br[TCP].seq)
            elif UDP in p_br:
                sig = (p_br[IP].src, p_br[IP].dst, 'UDP', p_br[IP].id)
            else:
                sig = (p_br[IP].src, p_br[IP].dst, p_br[IP].proto, p_br[IP].id)

            if sig in dc_index:
                p_dc = dc_index[sig]
                dt = float(p_dc.time - p_br.time) * 1000.0 # ms
                ttl_drop = int(p_br[IP].ttl - p_dc[IP].ttl)
                latencies_ms.append(dt)
                ttl_drops.append(ttl_drop)
                matches.append({
                    "signature": str(sig),
                    "branch_timestamp": float(p_br.time),
                    "dc_timestamp": float(p_dc.time),
                    "latency_ms": round(dt, 3),
                    "ttl_branch": int(p_br[IP].ttl),
                    "ttl_dc": int(p_dc[IP].ttl),
                    "ttl_drop": ttl_drop
                })
            else:
                dropped_packets.append({
                    "signature": str(sig),
                    "branch_timestamp": float(p_br.time),
                    "ip_id": int(p_br[IP].id),
                    "tcp_seq": int(p_br[TCP].seq) if TCP in p_br else None
                })

    for p_dc in pkts_dc:
        merged_timeline.append(p_dc)

    # Sort merged timeline by packet time
    merged_timeline.sort(key=lambda p: float(p.time))

    if output_merged_pcap:
        wrpcap(output_merged_pcap, merged_timeline)
        print(f"✓ Unified merged PCAP exported:    {output_merged_pcap}")

    avg_lat = sum(latencies_ms) / len(latencies_ms) if latencies_ms else 0.0
    min_lat = min(latencies_ms) if latencies_ms else 0.0
    max_lat = max(latencies_ms) if latencies_ms else 0.0
    avg_ttl_drop = sum(ttl_drops) / len(ttl_drops) if ttl_drops else 0

    return {
        "status": "COMPLETED",
        "summary": {
            "branch_packets_captured": len(pkts_br),
            "dc_packets_captured": len(pkts_dc),
            "correlated_packets": len(matches),
            "lost_packets": len(dropped_packets),
            "packet_loss_ratio_pct": round((len(dropped_packets) / len(pkts_br) * 100.0) if pkts_br else 0.0, 2),
            "average_oneway_latency_ms": round(avg_lat, 2),
            "min_latency_ms": round(min_lat, 2),
            "max_latency_ms": round(max_lat, 2),
            "average_ttl_decrement": round(avg_ttl_drop, 1)
        },
        "sample_correlated_packets": matches[:5],
        "dropped_packets": dropped_packets
    }


def live_capture(interface: str, bpf_filter: str, count: int, timeout: int, output_pcap: str):
    """Run a live packet capture with strict limits."""
    print(f"Starting live capture on {interface} (Filter: '{bpf_filter}', Max: {count} pkts, Timeout: {timeout}s)...")
    pkts = sniff(iface=interface, filter=bpf_filter, count=count, timeout=timeout)
    wrpcap(output_pcap, pkts)
    print(f"✓ Live capture written to {output_pcap} ({len(pkts)} packets captured)")
    return pkts


def main():
    parser = argparse.ArgumentParser(description="Stigix End-to-End PCAP Trace Validator")
    parser.add_argument("--demo", action="store_true", help="Run in simulation/demo mode")
    parser.add_argument("--live", action="store_true", help="Run live capture")
    parser.add_argument("--iface", default="eth0", help="Interface for live capture")
    parser.add_argument("--filter", default="tcp or udp or icmp", help="BPF filter")
    parser.add_argument("--count", type=int, default=100, help="Max packet count (default: 100)")
    parser.add_argument("--timeout", type=int, default=10, help="Capture timeout seconds (default: 10)")
    parser.add_argument("--output-dir", default=None, help="Directory to store PCAP artifacts (default: <repo>/traces)")
    parser.add_argument("--json", action="store_true", help="Output results as JSON")
    args = parser.parse_args()

    # Determine project root (one level up from Scripts)
    script_dir = os.path.dirname(os.path.abspath(__file__))
    project_root = os.path.dirname(script_dir) if os.path.basename(script_dir) == 'Scripts' else script_dir
    target_dir = args.output_dir or os.path.join(project_root, "traces")

    os.makedirs(target_dir, exist_ok=True)
    pcap_br = os.path.join(target_dir, "branch_trace.pcap")
    pcap_dc = os.path.join(target_dir, "dc_trace.pcap")
    pcap_merged = os.path.join(target_dir, "merged_trace.pcap")
    report_file = os.path.join(target_dir, "trace_report.json")

    if args.demo or not args.live:
        generate_synthetic_dual_trace(
            pcap_branch_path=pcap_br,
            pcap_dc_path=pcap_dc,
            packet_count=args.count,
            drop_count=3,
            latency_ms=14.5,
            jitter_ms=1.5
        )
        report = correlate_pcaps(pcap_br, pcap_dc, output_merged_pcap=pcap_merged)
    else:
        live_capture(
            interface=args.iface,
            bpf_filter=args.filter,
            count=args.count,
            timeout=args.timeout,
            output_pcap=pcap_br
        )
        report = {"status": "LIVE_CAPTURE_COMPLETED", "output_file": pcap_br}

    # Always persist the structured report in the traces directory
    with open(report_file, "w") as f:
        json.dump(report, f, indent=2)
    print(f"✓ Trace report saved:              {report_file}")

    if args.json:
        print(json.dumps(report, indent=2))
    else:
        print("\n" + "=" * 60)
        print("📊 STIGIX END-TO-END TRACE CORRELATION REPORT")
        print("=" * 60)
        summary = report.get("summary", {})
        for k, v in summary.items():
            print(f"  {k:30s}: {v}")
        print("=" * 60)
        print(f"Artifacts folder: {target_dir}")


if __name__ == '__main__':
    main()
