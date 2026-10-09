#!/usr/bin/env python3
"""
Stigix Live Packet Capture & Dissection Engine
Manages tcpdump capture sessions and provides Wireshark-grade packet dissection.
Part of Stigix Network Observability & Packet Capture Module (PRD_PACKET_CAPTURE_AND_WEB_ANALYZER.md).
"""

import os
import sys
import json
import time
import signal
import socket
import struct
import base64
import argparse
import subprocess
import glob
from typing import Dict, List, Any, Optional

# Suppress scapy warnings
import warnings
warnings.filterwarnings('ignore')
os.environ['PYTHONWARNINGS'] = 'ignore'

try:
    from scapy.utils import PcapReader
    from scapy.layers.l2 import Ether, ARP
    try:
        from scapy.layers.l2 import CookedLinux, CookedLinuxV2
    except ImportError:
        CookedLinux = None
        CookedLinuxV2 = None
    from scapy.layers.inet import IP, TCP, UDP, ICMP
    from scapy.layers.inet6 import IPv6
    from scapy.packet import Raw
except ImportError:
    print(json.dumps({"error": "scapy is required. Install via pip3 install scapy"}))
    sys.exit(1)

CAPTURES_DIR = os.environ.get('STIGIX_CAPTURES_DIR', '/app/config/captures')
SESSION_FILE = os.path.join(CAPTURES_DIR, '.session.json')

PRESETS = {
    "all": {
        "id": "all",
        "name": "All Traffic",
        "bpf": "",
        "description": "Capture all ingress and egress packets across the interface"
    },
    "custom_tcp": {
        "id": "custom_tcp",
        "name": "Custom TCP Apps",
        "bpf": "tcp portrange 8083-8099",
        "description": "Filter traffic on active Custom TCP & HTTP application ports"
    },
    "synthetic_probes": {
        "id": "synthetic_probes",
        "name": "Synthetic DEM Probes",
        "bpf": "icmp or (tcp and (port 80 or port 443 or port 8082 or port 8080))",
        "description": "Filter ICMP pings and HTTP/S probes for DEM validation"
    },
    "voice_rtp": {
        "id": "voice_rtp",
        "name": "Voice RTP & Echo",
        "bpf": "udp and (port 6100 or port 6101 or port 6200 or port 5060)",
        "description": "Filter VoIP RTP audio packets and SIP signaling"
    },
    "security_eicar": {
        "id": "security_eicar",
        "name": "Security & EICAR",
        "bpf": "tcp and (port 8082 or port 8080 or port 8098)",
        "description": "Filter malware tests and EICAR prevention streams"
    },
    "dns": {
        "id": "dns",
        "name": "DNS Inquiries",
        "bpf": "port 53",
        "description": "Filter UDP and TCP Domain Name System lookups"
    },
    "speedtest": {
        "id": "speedtest",
        "name": "Speedtest (XFR/iPerf)",
        "bpf": "port 9000 or port 5201",
        "description": "Filter high-throughput bandwidth test traffic"
    }
}


def ensure_dirs():
    os.makedirs(CAPTURES_DIR, exist_ok=True)


def list_interfaces() -> List[Dict[str, Any]]:
    """Enumerate network interfaces available for capture."""
    interfaces = []
    
    # Always include 'any' pseudo-interface in Linux
    interfaces.append({
        "name": "any",
        "label": "All Interfaces (any)",
        "ip": "0.0.0.0",
        "mac": "-",
        "is_default": True,
        "is_up": True
    })

    try:
        # Query interfaces via /sys/class/net
        net_dir = "/sys/class/net"
        if os.path.exists(net_dir):
            for iface in sorted(os.listdir(net_dir)):
                if iface == "any":
                    continue
                operstate_file = os.path.join(net_dir, iface, "operstate")
                is_up = False
                if os.path.exists(operstate_file):
                    with open(operstate_file, 'r') as f:
                        is_up = f.read().strip() in ("up", "unknown")
                
                # Get IP via ip command
                ip_addr = "-"
                try:
                    out = subprocess.check_output(["ip", "-4", "addr", "show", iface], stderr=subprocess.DEVNULL).decode('utf-8')
                    for line in out.splitlines():
                        line = line.strip()
                        if line.startswith("inet "):
                            ip_addr = line.split()[1].split("/")[0]
                            break
                except Exception:
                    pass

                # Get MAC
                mac_addr = "-"
                mac_file = os.path.join(net_dir, iface, "address")
                if os.path.exists(mac_file):
                    try:
                        with open(mac_file, 'r') as f:
                            mac_addr = f.read().strip()
                    except Exception:
                        pass

                interfaces.append({
                    "name": iface,
                    "label": f"{iface} ({ip_addr})" if ip_addr != "-" else iface,
                    "ip": ip_addr,
                    "mac": mac_addr,
                    "is_default": False,
                    "is_up": is_up
                })
    except Exception as e:
        pass

    return interfaces


def get_active_session() -> Optional[Dict[str, Any]]:
    """Read session file and verify if capture process is running."""
    ensure_dirs()
    if not os.path.exists(SESSION_FILE):
        return None
    try:
        with open(SESSION_FILE, 'r') as f:
            data = json.load(f)
        pid = data.get('pid')
        if pid:
            try:
                os.kill(pid, 0)
                # Process is alive
                data['active'] = True
                
                elapsed = time.time() - data.get('start_time', time.time())
                data['elapsed_seconds'] = round(elapsed, 1)
                
                pcap_path = data.get('pcap_path')
                if pcap_path and os.path.exists(pcap_path):
                    data['file_size_bytes'] = os.path.getsize(pcap_path)
                else:
                    data['file_size_bytes'] = 0

                # Check if duration exceeded
                duration = data.get('duration', 30)
                if duration and elapsed >= duration:
                    stop_capture()
                    data['active'] = False
                    data['status'] = 'completed_duration'

                return data
            except OSError:
                data['active'] = False
                data['status'] = 'stopped'
                return data
    except Exception:
        return None
    return None


def start_capture(interface: str = "any", bpf: str = "", duration: int = 30, max_packets: int = 2000, snaplen: int = 1500) -> Dict[str, Any]:
    """Start a new tcpdump packet capture session."""
    ensure_dirs()
    existing = get_active_session()
    if existing and existing.get('active'):
        return {"error": "A capture session is already active", "session": existing}

    duration = max(5, min(duration, 300))
    max_packets = max(10, min(max_packets, 10000))
    snaplen = max(64, min(snaplen, 65535))

    timestamp_str = time.strftime("%Y%m%d_%H%M%S")
    session_id = f"cap_{timestamp_str}"
    pcap_filename = f"{session_id}.pcap"
    pcap_path = os.path.join(CAPTURES_DIR, pcap_filename)

    cmd = ["tcpdump", "-i", interface, "-U", "-s", str(snaplen), "-c", str(max_packets), "-w", pcap_path]
    if bpf and bpf.strip():
        cmd.extend(bpf.strip().split())

    try:
        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            preexec_fn=os.setsid
        )
    except Exception as e:
        return {"error": f"Failed to start tcpdump: {str(e)}"}

    session_data = {
        "active": True,
        "session_id": session_id,
        "pid": proc.pid,
        "interface": interface,
        "bpf": bpf.strip(),
        "duration": duration,
        "max_packets": max_packets,
        "snaplen": snaplen,
        "start_time": time.time(),
        "pcap_filename": pcap_filename,
        "pcap_path": pcap_path,
        "status": "capturing"
    }

    with open(SESSION_FILE, 'w') as f:
        json.dump(session_data, f, indent=2)

    return session_data


def stop_capture() -> Dict[str, Any]:
    """Gracefully stop the running capture process."""
    ensure_dirs()
    if not os.path.exists(SESSION_FILE):
        return {"error": "No active capture session found"}

    try:
        with open(SESSION_FILE, 'r') as f:
            data = json.load(f)
        pid = data.get('pid')
        if pid:
            try:
                os.kill(pid, signal.SIGINT)
                time.sleep(0.5)
                try:
                    os.kill(pid, 0)
                    os.kill(pid, signal.SIGTERM)
                except OSError:
                    pass
            except OSError:
                pass

        data['active'] = False
        data['status'] = 'stopped'
        data['stop_time'] = time.time()
        data['elapsed_seconds'] = round(time.time() - data.get('start_time', time.time()), 1)

        pcap_path = data.get('pcap_path')
        if pcap_path and os.path.exists(pcap_path):
            data['file_size_bytes'] = os.path.getsize(pcap_path)

        with open(SESSION_FILE, 'w') as f:
            json.dump(data, f, indent=2)

        return data
    except Exception as e:
        return {"error": f"Error stopping capture: {str(e)}"}


def format_hex_dump(raw_bytes: bytes) -> List[Dict[str, str]]:
    """Format raw packet bytes into 16-byte hex dump rows with ASCII representation."""
    lines = []
    length = len(raw_bytes)
    for i in range(0, length, 16):
        chunk = raw_bytes[i:i+16]
        hex_str = " ".join(f"{b:02x}" for b in chunk)
        if len(chunk) > 8:
            hex_str = f"{hex_str[:23]}  {hex_str[24:]}"
        ascii_str = "".join(chr(b) if 32 <= b < 127 else "." for b in chunk)
        lines.append({
            "offset": f"{i:04x}",
            "hex": hex_str,
            "ascii": ascii_str
        })
    return lines


def dissect_packet(pkt: Any, pkt_idx: int, t0: float) -> Dict[str, Any]:
    """Extract Wireshark-compatible layers, headers, flags and summary info."""
    raw_bytes = bytes(pkt)
    pkt_len = len(raw_bytes)
    pkt_time = float(getattr(pkt, 'time', 0))
    rel_time = round(pkt_time - t0, 6) if t0 > 0 else 0.0

    src_addr = "-"
    dst_addr = "-"
    sport = None
    dport = None
    protocol = "OTHER"
    info = ""
    tree = {}

    # Frame Layer
    tree["Frame"] = {
        "Frame Number": pkt_idx,
        "Frame Length": f"{pkt_len} bytes ({pkt_len * 8} bits)",
        "Capture Length": f"{pkt_len} bytes",
        "Time Delta": f"{rel_time:.6f} seconds"
    }

    # Ethernet Layer
    if pkt.haslayer(Ether):
        eth = pkt[Ether]
        src_addr = eth.src
        dst_addr = eth.dst
        tree["Ethernet II"] = {
            "Source MAC": eth.src,
            "Destination MAC": eth.dst,
            "Type": f"0x{eth.type:04x}"
        }
    elif CookedLinux and pkt.haslayer(CookedLinux):
        sll = pkt[CookedLinux]
        tree["Linux Cooked Capture (SLL)"] = {
            "Packet Type": sll.pkttype,
            "Link-Layer Address Type": sll.lladdrtype,
            "Link-Layer Address Length": sll.lladdrlen,
            "Protocol": f"0x{sll.proto:04x}"
        }
    elif CookedLinuxV2 and pkt.haslayer(CookedLinuxV2):
        sll2 = pkt[CookedLinuxV2]
        tree["Linux Cooked Capture v2 (SLL2)"] = {
            "Packet Type": getattr(sll2, 'pkttype', '-'),
            "Protocol": f"0x{getattr(sll2, 'proto', 0):04x}",
            "Interface Index": getattr(sll2, 'ifindex', '-')
        }

    # ARP Layer
    if pkt.haslayer(ARP):
        arp = pkt[ARP]
        protocol = "ARP"
        src_addr = arp.psrc
        dst_addr = arp.pdst
        op_str = "Who has " + arp.pdst + "? Tell " + arp.psrc if arp.op == 1 else arp.psrc + " is at " + arp.hwsrc
        info = f"ARP: {op_str}"
        tree["Address Resolution Protocol"] = {
            "Hardware Type": arp.hwtype,
            "Protocol Type": f"0x{arp.ptype:04x}",
            "Hardware Size": arp.hwlen,
            "Protocol Size": arp.plen,
            "Opcode": "Request (1)" if arp.op == 1 else f"Reply ({arp.op})",
            "Sender MAC": arp.hwsrc,
            "Sender IP": arp.psrc,
            "Target MAC": arp.hwdst,
            "Target IP": arp.pdst
        }

    # IPv4 Layer
    if pkt.haslayer(IP):
        ip = pkt[IP]
        src_addr = ip.src
        dst_addr = ip.dst
        protocol = "IPv4"
        dscp_val = ip.tos >> 2
        ecn_val = ip.tos & 0x03
        flags_str = []
        if ip.flags & 2: flags_str.append("Don't Fragment (DF)")
        if ip.flags & 1: flags_str.append("More Fragments (MF)")

        tree["Internet Protocol Version 4"] = {
            "Version": 4,
            "Header Length": f"{ip.ihl * 4} bytes ({ip.ihl})",
            "Differentiated Services Field": f"0x{ip.tos:02x} (DSCP: {dscp_val}, ECN: {ecn_val})",
            "Total Length": ip.len,
            "Identification": f"0x{ip.id:04x} ({ip.id})",
            "Flags": ", ".join(flags_str) if flags_str else "None",
            "Time to Live (TTL)": ip.ttl,
            "Protocol": f"{ip.proto}",
            "Header Checksum": f"0x{ip.chksum:04x}",
            "Source Address": ip.src,
            "Destination Address": ip.dst
        }

    # IPv6 Layer
    elif pkt.haslayer(IPv6):
        ip6 = pkt[IPv6]
        src_addr = ip6.src
        dst_addr = ip6.dst
        protocol = "IPv6"
        tree["Internet Protocol Version 6"] = {
            "Version": 6,
            "Traffic Class": f"0x{ip6.tc:02x}",
            "Flow Label": f"0x{ip6.fl:05x}",
            "Payload Length": ip6.plen,
            "Next Header": ip6.nh,
            "Hop Limit": ip6.hlim,
            "Source Address": ip6.src,
            "Destination Address": ip6.dst
        }

    # ICMP Layer
    if pkt.haslayer(ICMP):
        icmp = pkt[ICMP]
        protocol = "ICMP"
        type_str = "Echo (ping) request" if icmp.type == 8 else ("Echo (ping) reply" if icmp.type == 0 else f"Type {icmp.type}")
        info = f"{type_str} id=0x{getattr(icmp, 'id', 0):04x} seq={getattr(icmp, 'seq', 0)}"
        tree["Internet Control Message Protocol"] = {
            "Type": f"{icmp.type} ({type_str})",
            "Code": icmp.code,
            "Checksum": f"0x{icmp.chksum:04x}"
        }

    # TCP Layer
    if pkt.haslayer(TCP):
        tcp = pkt[TCP]
        protocol = "TCP"
        sport = tcp.sport
        dport = tcp.dport
        
        # Flags breakdown
        flag_names = []
        if tcp.flags.S: flag_names.append("SYN")
        if tcp.flags.A: flag_names.append("ACK")
        if tcp.flags.F: flag_names.append("FIN")
        if tcp.flags.R: flag_names.append("RST")
        if tcp.flags.P: flag_names.append("PSH")
        if tcp.flags.U: flag_names.append("URG")
        flags_display = f"[{', '.join(flag_names)}]" if flag_names else "[None]"

        payload_len = len(tcp.payload) if tcp.payload else 0
        info = f"{sport} → {dport} {flags_display} Seq={tcp.seq} Ack={tcp.ack} Win={tcp.window} Len={payload_len}"

        tree["Transmission Control Protocol"] = {
            "Source Port": sport,
            "Destination Port": dport,
            "Sequence Number": tcp.seq,
            "Acknowledgment Number": tcp.ack,
            "Header Length": f"{tcp.dataofs * 4} bytes",
            "Flags": f"0x{int(tcp.flags):03x} ({', '.join(flag_names)})",
            "Window Size": tcp.window,
            "Checksum": f"0x{tcp.chksum:04x}",
            "Urgent Pointer": tcp.urgptr
        }

        # HTTP / TLS application hints
        if payload_len > 0:
            payload_bytes = bytes(tcp.payload)
            if payload_bytes.startswith((b'GET ', b'POST ', b'PUT ', b'DELETE ', b'HEAD ', b'HTTP/1.')):
                protocol = "HTTP"
                first_line = payload_bytes.split(b'\r\n')[0].decode('latin-1', errors='replace')
                info = f"{sport} → {dport} {first_line}"
            elif payload_bytes.startswith(b'\x16\x03'):
                protocol = "TLS"
                tls_type = "Handshake"
                if len(payload_bytes) > 5 and payload_bytes[5] == 1:
                    tls_type = "Client Hello"
                elif len(payload_bytes) > 5 and payload_bytes[5] == 2:
                    tls_type = "Server Hello"
                info = f"{sport} → {dport} TLSv1.x {tls_type}"

    # UDP Layer
    elif pkt.haslayer(UDP):
        udp = pkt[UDP]
        protocol = "UDP"
        sport = udp.sport
        dport = udp.dport
        payload_len = len(udp.payload) if udp.payload else 0
        info = f"{sport} → {dport} Len={udp.len}"

        tree["User Datagram Protocol"] = {
            "Source Port": sport,
            "Destination Port": dport,
            "Length": udp.len,
            "Checksum": f"0x{udp.chksum:04x}"
        }

        # DNS detection (Port 53)
        if sport == 53 or dport == 53:
            protocol = "DNS"
            info = f"DNS: {sport} → {dport} Standard query"
        # RTP audio detection (heuristic port range 6100-6200 or 10000-20000)
        elif sport in (6100, 6101, 6200) or dport in (6100, 6101, 6200):
            protocol = "RTP"
            info = f"RTP Audio: {sport} → {dport} Len={udp.len}"

    # Raw Payload layer
    if pkt.haslayer(Raw):
        raw_payload = bytes(pkt[Raw])
        sample_ascii = "".join(chr(b) if 32 <= b < 127 else "." for b in raw_payload[:64])
        tree["Payload Data"] = {
            "Length": f"{len(raw_payload)} bytes",
            "Preview": sample_ascii
        }

    return {
        "no": pkt_idx,
        "time": rel_time,
        "epoch": pkt_time,
        "source": src_addr,
        "sport": sport,
        "destination": dst_addr,
        "dport": dport,
        "protocol": protocol,
        "length": pkt_len,
        "info": info or f"{protocol} frame",
        "tree": tree,
        "hex_dump": format_hex_dump(raw_bytes)
    }


def dissect_pcap_file(file_path: str, offset: int = 0, limit: int = 500) -> Dict[str, Any]:
    """Read packets from a pcap file using streaming PcapReader and dissect them."""
    if not os.path.exists(file_path):
        return {"error": f"PCAP file not found: {file_path}", "packets": []}

    packets = []
    total_count = 0
    t0 = 0.0

    try:
        with PcapReader(file_path) as pcap:
            for pkt in pcap:
                total_count += 1
                if total_count == 1:
                    t0 = float(getattr(pkt, 'time', 0))

                if total_count <= offset:
                    continue

                if len(packets) < limit:
                    dissected = dissect_packet(pkt, total_count, t0)
                    packets.append(dissected)
                
                if total_count >= offset + limit + 5000:
                    break

        return {
            "file": os.path.basename(file_path),
            "file_size_bytes": os.path.getsize(file_path),
            "total_packets": total_count,
            "offset": offset,
            "limit": limit,
            "count": len(packets),
            "packets": packets
        }
    except Exception as e:
        return {"error": f"Failed to dissect PCAP: {str(e)}", "packets": []}


def list_saved_captures() -> List[Dict[str, Any]]:
    """List all saved PCAP files in the captures directory."""
    ensure_dirs()
    pcap_files = glob.glob(os.path.join(CAPTURES_DIR, "*.pcap"))
    results = []
    for f in sorted(pcap_files, key=os.path.getmtime, reverse=True):
        basename = os.path.basename(f)
        results.append({
            "filename": basename,
            "size_bytes": os.path.getsize(f),
            "created_at": time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(os.path.getctime(f))),
            "modified_at": time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(os.path.getmtime(f)))
        })
    return results


def delete_capture(filename: str) -> Dict[str, Any]:
    """Safely delete a capture file."""
    ensure_dirs()
    safe_name = os.path.basename(filename)
    if not safe_name.endswith('.pcap'):
        return {"error": "Invalid pcap filename"}
    target = os.path.join(CAPTURES_DIR, safe_name)
    if os.path.exists(target):
        os.remove(target)
        return {"success": True, "deleted": safe_name}
    return {"error": "File not found"}


def main():
    parser = argparse.ArgumentParser(description="Stigix Live Packet Capture Engine")
    subparsers = parser.add_subparsers(dest="command")

    # list-interfaces
    subparsers.add_parser("interfaces")

    # presets
    subparsers.add_parser("presets")

    # start
    p_start = subparsers.add_parser("start")
    p_start.add_argument("--interface", "-i", default="any")
    p_start.add_argument("--bpf", "-f", default="")
    p_start.add_argument("--duration", "-d", type=int, default=30)
    p_start.add_argument("--max-packets", "-c", type=int, default=2000)
    p_start.add_argument("--snaplen", "-s", type=int, default=1500)

    # status
    subparsers.add_parser("status")

    # stop
    subparsers.add_parser("stop")

    # dissect
    p_dissect = subparsers.add_parser("dissect")
    p_dissect.add_argument("--file", "-f", required=True)
    p_dissect.add_argument("--offset", type=int, default=0)
    p_dissect.add_argument("--limit", type=int, default=500)

    # list
    subparsers.add_parser("list")

    # delete
    p_del = subparsers.add_parser("delete")
    p_del.add_argument("--filename", required=True)

    args = parser.parse_args()

    if args.command == "interfaces":
        print(json.dumps(list_interfaces()))
    elif args.command == "presets":
        print(json.dumps(list(PRESETS.values())))
    elif args.command == "start":
        res = start_capture(
            interface=args.interface,
            bpf=args.bpf,
            duration=args.duration,
            max_packets=args.max_packets,
            snaplen=args.snaplen
        )
        print(json.dumps(res))
    elif args.command == "status":
        res = get_active_session() or {"active": False, "status": "idle"}
        print(json.dumps(res))
    elif args.command == "stop":
        print(json.dumps(stop_capture()))
    elif args.command == "dissect":
        print(json.dumps(dissect_pcap_file(args.file, offset=args.offset, limit=args.limit)))
    elif args.command == "list":
        print(json.dumps(list_saved_captures()))
    elif args.command == "delete":
        print(json.dumps(delete_capture(args.filename)))
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
