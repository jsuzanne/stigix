#!/usr/bin/env python3
"""
Stigix PCAP Stateful Parser & Profile Generator (M1)
Extracts bidirectional L7 application turns from TCP and UDP packet captures
and compiles them into compressed stateful replay profiles (.stx-replay).

Part of the Stigix PCAP Stateful Replay Engine (PRD_PCAP_REPLAY_ENGINE.md).
"""

import sys
import os
import io
import zipfile
import tempfile
import gzip
import json
import base64
import hashlib
import argparse
import re
import logging
logging.getLogger("scapy").setLevel(logging.ERROR)
logging.getLogger("scapy.runtime").setLevel(logging.ERROR)

from typing import Dict, List, Tuple, Any, Optional

try:
    from scapy.utils import PcapReader
    from scapy.layers.l2 import ARP
    from scapy.layers.inet import IP, TCP, UDP
    from scapy.layers.inet6 import IPv6
    from scapy.packet import Raw
except ImportError:

    # If run in standard python without scapy, point to engines/.venv or system pip
    print("Error: scapy is required. Install with: pip3 install scapy", file=sys.stderr)
    sys.exit(1)


def _scrub_two_groups(match) -> bytes:
    prefix = match.group(1)
    secret = match.group(2)
    return prefix + (b'*' * len(secret))


def _scrub_email(match) -> bytes:
    email = match.group(1)
    parts = email.split(b'@', 1)
    if len(parts) == 2:
        user, domain = parts
        scrubbed_user = user[:1] + (b'*' * max(1, len(user) - 2)) + user[-1:] if len(user) > 2 else b'*' * len(user)
        return scrubbed_user + b'@' + domain
    return b'*' * len(email)


# Regular expressions for sensitive data detection & robust scrubbing
SENSITIVE_DEFINITIONS = [
    (re.compile(rb'(Authorization:\s*Basic\s+)([A-Za-z0-9+/=]+)', re.IGNORECASE), b'Basic Auth Credentials', _scrub_two_groups),
    (re.compile(rb'(Authorization:\s*Bearer\s+)([A-Za-z0-9_\-\.]+)', re.IGNORECASE), b'Bearer Token', _scrub_two_groups),
    (re.compile(rb'((?:password|passwd|pwd|secret|api_key|apikey)\s*[:=]\s*["\']?)([^"\'\s&;]+)', re.IGNORECASE), b'Password / Secret in payload', _scrub_two_groups),
    (re.compile(rb'([a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+)', re.IGNORECASE), b'Email address', _scrub_email),
]


def scan_and_scrub_payload(payload: bytes, scrub: bool = False) -> Tuple[bytes, List[str]]:
    """Scan for sensitive patterns; scrub them with '*' if scrub=True without group index errors."""
    if not payload:
        return payload, []
    processed = payload
    warnings = []
    for pattern, desc, scrub_fn in SENSITIVE_DEFINITIONS:
        matches = list(pattern.finditer(processed))
        if matches:
            warnings.append(f"{desc.decode()}: {len(matches)} occurrence(s)")
            if scrub:
                try:
                    processed = pattern.sub(scrub_fn, processed)
                except Exception:
                    pass
    return processed, warnings


def classify_flow(client_ip: Optional[str], client_port: Optional[int],
                  server_ip: Optional[str], server_port: Optional[int]) -> Tuple[bool, Optional[str]]:
    """Determine if a flow is broadcast/multicast/link-local background noise not suitable for unicast L7 replay."""
    def _is_noise_ip(ip: Optional[str]) -> Tuple[bool, Optional[str]]:
        if not ip:
            return False, None
        ip_clean = ip.strip()
        if ip_clean == "255.255.255.255" or ip_clean.endswith(".255"):
            return True, "IPv4 Subnet Broadcast"
        if ip_clean.startswith("ff02::1:2") or ip_clean.startswith("FF02::1:2"):
            return True, "DHCPv6 Multicast"
        if ip_clean.startswith("ff02::1:3") or ip_clean.startswith("FF02::1:3") or ip_clean == "224.0.0.252":
            return True, "LLMNR Discovery"
        if ip_clean.startswith("ff02::fb") or ip_clean.startswith("FF02::FB") or ip_clean == "224.0.0.251":
            return True, "mDNS Multicast"
        if ip_clean.startswith("ff") or ip_clean.startswith("FF"):
            return True, "IPv6 Multicast"
        if ip_clean.startswith("fe80:"):
            return True, "IPv6 Link-Local"
        try:
            parts = ip_clean.split(".")
            if len(parts) == 4:
                first = int(parts[0])
                if 224 <= first <= 239:
                    return True, "IPv4 Multicast"
        except Exception:
            pass
        return False, None

    # Check known broadcast / discovery service ports
    ports = {p for p in (client_port, server_port) if p is not None}
    if {137, 138} & ports:
        return True, "NetBIOS Name Service"
    if {546, 547} & ports:
        return True, "DHCPv6 Solicit/Reply"
    if 5355 in ports:
        return True, "LLMNR Name Resolution"
    if 5353 in ports:
        return True, "mDNS Discovery"
    if 1900 in ports:
        return True, "SSDP Discovery"

    s_is, s_type = _is_noise_ip(server_ip)
    if s_is:
        return True, s_type

    c_is, c_type = _is_noise_ip(client_ip)
    if c_is and ("Multicast" in (c_type or "") or "Broadcast" in (c_type or "")):
        return True, c_type

    return False, None


class TCPFlowReassembler:
    """Reassembles ordered TCP segments for a single TCP connection into directional turns."""
    def __init__(self, flow_key: Tuple[str, int, str, int, str]):
        self.flow_key = flow_key  # (src_ip, src_port, dst_ip, dst_port, 'tcp')
        self.client_ip: Optional[str] = None
        self.client_port: Optional[int] = None
        self.server_ip: Optional[str] = None
        self.server_port: Optional[int] = None
        self.syn_seen = False
        self.syn_ack_seen = False

        # Packets tracking: direction -> list of (seq, payload, timestamp)
        self.client_segments: List[Tuple[int, bytes, float]] = []
        self.server_segments: List[Tuple[int, bytes, float]] = []

        # Chronological raw turns before final merging
        self.raw_events: List[Dict[str, Any]] = []

    def register_syn(self, src_ip: str, src_port: int, dst_ip: str, dst_port: int):
        if not self.syn_seen:
            self.client_ip = src_ip
            self.client_port = src_port
            self.server_ip = dst_ip
            self.server_port = dst_port
            self.syn_seen = True

    def register_syn_ack(self, src_ip: str, src_port: int, dst_ip: str, dst_port: int):
        if not self.server_ip:
            self.server_ip = src_ip
            self.server_port = src_port
            self.client_ip = dst_ip
            self.client_port = dst_port
        self.syn_ack_seen = True

    def add_segment(self, src_ip: str, src_port: int, dst_ip: str, dst_port: int,
                    seq: int, payload: bytes, timestamp: float):
        if not payload:
            return

        # Infer roles if capture missed initial SYN handshake
        if not self.client_ip:
            self.client_ip = src_ip
            self.client_port = src_port
            self.server_ip = dst_ip
            self.server_port = dst_port

        sender = "client" if (src_ip == self.client_ip and src_port == self.client_port) else "server"
        self.raw_events.append({
            "sender": sender,
            "seq": seq,
            "payload": payload,
            "timestamp": timestamp
        })

    def compile_turns(self, scrub: bool = False) -> Tuple[List[Dict[str, Any]], List[str], Dict[str, Any]]:
        """Sort segments, drop duplicates, merge consecutive same-direction segments into turns."""
        all_warnings: List[str] = []
        if not self.raw_events:
            return [], all_warnings, {}

        # Merge consecutive events of the same sender
        merged_turns: List[Dict[str, Any]] = []
        current_sender = None
        current_payload = bytearray()
        first_event_ts = self.raw_events[0]["timestamp"]
        prev_turn_end_ts = first_event_ts

        # Detect if server speaks first on connect (e.g. SMTP/FTP banner)
        first_sender = self.raw_events[0]["sender"]
        server_speaks_first = (first_sender == "server")

        seen_seqs = set()

        for idx, ev in enumerate(self.raw_events):
            sender = ev["sender"]
            seq = ev["seq"]
            payload = ev["payload"]
            ts = ev["timestamp"]

            # Simple de-duplication: skip retransmissions with exact same seq and payload length
            seq_key = (sender, seq, len(payload))
            if seq_key in seen_seqs:
                continue
            seen_seqs.add(seq_key)

            if current_sender is None:
                current_sender = sender
                current_payload = bytearray(payload)
                prev_turn_end_ts = ts
            elif current_sender == sender:
                current_payload.extend(payload)
                prev_turn_end_ts = ts
            else:
                # Flush previous turn
                final_payload, w = scan_and_scrub_payload(bytes(current_payload), scrub=scrub)
                all_warnings.extend(w)

                delay_ms = max(0, int((ts - prev_turn_end_ts) * 1000))
                trigger = "on_connect" if (len(merged_turns) == 0 and server_speaks_first) else "after_peer_turn"

                merged_turns.append({
                    "seq": len(merged_turns) + 1,
                    "sender": current_sender,
                    "trigger": trigger,
                    "length": len(final_payload),
                    "delay_ms": delay_ms,
                    "payload_b64": base64.b64encode(final_payload).decode("ascii"),
                    "preview": repr(final_payload[:40])[2:-1]
                })

                current_sender = sender
                current_payload = bytearray(payload)
                prev_turn_end_ts = ts

        # Flush final turn
        if current_sender and current_payload:
            final_payload, w = scan_and_scrub_payload(bytes(current_payload), scrub=scrub)
            all_warnings.extend(w)

            trigger = "on_connect" if (len(merged_turns) == 0 and server_speaks_first) else "after_peer_turn"
            merged_turns.append({
                "seq": len(merged_turns) + 1,
                "sender": current_sender,
                "trigger": trigger,
                "length": len(final_payload),
                "delay_ms": 0,
                "payload_b64": base64.b64encode(final_payload).decode("ascii"),
                "preview": repr(final_payload[:40])[2:-1]
            })

        stats = {
            "total_turns": len(merged_turns),
            "client_turns": sum(1 for t in merged_turns if t["sender"] == "client"),
            "server_turns": sum(1 for t in merged_turns if t["sender"] == "server"),
            "total_payload_bytes": sum(t["length"] for t in merged_turns),
            "server_speaks_first": server_speaks_first,
            "syn_handshake_present": self.syn_seen and self.syn_ack_seen
        }

        return merged_turns, list(set(all_warnings)), stats


class UDPFlowReassembler:
    """Gathers datagram turns for a UDP flow preserving boundaries."""
    def __init__(self, flow_key: Tuple[str, int, str, int, str]):
        self.flow_key = flow_key
        self.client_ip: Optional[str] = None
        self.client_port: Optional[int] = None
        self.server_ip: Optional[str] = None
        self.server_port: Optional[int] = None
        self.raw_datagrams: List[Dict[str, Any]] = []

    def add_datagram(self, src_ip: str, src_port: int, dst_ip: str, dst_port: int,
                     payload: bytes, timestamp: float):
        if not payload:
            return

        if not self.client_ip:
            self.client_ip = src_ip
            self.client_port = src_port
            self.server_ip = dst_ip
            self.server_port = dst_port

        sender = "client" if (src_ip == self.client_ip and src_port == self.client_port) else "server"
        self.raw_datagrams.append({
            "sender": sender,
            "payload": payload,
            "timestamp": timestamp
        })

    def compile_turns(self, scrub: bool = False) -> Tuple[List[Dict[str, Any]], List[str], Dict[str, Any]]:
        all_warnings: List[str] = []
        turns: List[Dict[str, Any]] = []
        if not self.raw_datagrams:
            return [], all_warnings, {}

        prev_ts = self.raw_datagrams[0]["timestamp"]

        for idx, dg in enumerate(self.raw_datagrams):
            final_payload, w = scan_and_scrub_payload(dg["payload"], scrub=scrub)
            all_warnings.extend(w)

            delay_ms = max(0, int((dg["timestamp"] - prev_ts) * 1000))
            prev_ts = dg["timestamp"]

            turns.append({
                "seq": idx + 1,
                "sender": dg["sender"],
                "trigger": "after_peer_turn" if idx > 0 else "on_connect",
                "length": len(final_payload),
                "delay_ms": delay_ms,
                "payload_b64": base64.b64encode(final_payload).decode("ascii"),
                "preview": repr(final_payload[:40])[2:-1]
            })

        stats = {
            "total_turns": len(turns),
            "client_turns": sum(1 for t in turns if t["sender"] == "client"),
            "server_turns": sum(1 for t in turns if t["sender"] == "server"),
            "total_payload_bytes": sum(t["length"] for t in turns),
            "server_speaks_first": (turns[0]["sender"] == "server") if turns else False
        }

        return turns, list(set(all_warnings)), stats


def normalize_flow_key(src_ip: str, src_port: int, dst_ip: str, dst_port: int, proto: str) -> Tuple[str, int, str, int, str]:
    """Ensure a consistent canonical flow key for bidirectional lookup."""
    ep1 = (src_ip, src_port)
    ep2 = (dst_ip, dst_port)
    if ep1 <= ep2:
        return (ep1[0], ep1[1], ep2[0], ep2[1], proto)
    else:
        return (ep2[0], ep2[1], ep1[0], ep1[1], proto)


def unpack_pcap_from_zip(file_path: str, target_inner_pcap: Optional[str] = None) -> Tuple[str, bool, Optional[str], List[str]]:
    """
    Checks if file_path is a zip archive (by extension or magic PK\\x03\\x04).
    If so, searches for .pcap, .pcapng, or .cap files (including nested .zip archives),
    extracts the target or first PCAP to a temporary file, and returns:
    (actual_pcap_path, is_temporary, original_inner_filename, all_discovered_pcaps)
    """
    if not os.path.isfile(file_path):
        return file_path, False, None, []

    is_zip = file_path.lower().endswith('.zip')
    if not is_zip:
        try:
            with open(file_path, 'rb') as f:
                magic = f.read(4)
                if magic == b'PK\x03\x04':
                    is_zip = True
        except Exception:
            pass

    if not is_zip:
        return file_path, False, None, []

    COMMON_PWDS = [None, b"infected", b"virus", b"password", b"malware", b"clean", b"infected!"]

    try:
        with zipfile.ZipFile(file_path, 'r') as outer:
            # 1. Direct PCAP files in outer zip
            direct_pcaps = [n for n in outer.namelist() if n.lower().endswith(('.pcap', '.pcapng', '.cap'))]
            if direct_pcaps:
                chosen = target_inner_pcap if target_inner_pcap in direct_pcaps else direct_pcaps[0]
                pcap_data = None
                for pwd in COMMON_PWDS:
                    try:
                        pcap_data = outer.read(chosen, pwd=pwd)
                        break
                    except RuntimeError:
                        continue
                if pcap_data is not None:
                    fd, temp_pcap_path = tempfile.mkstemp(suffix=os.path.splitext(chosen)[1] or '.pcap', prefix='stx_unzip_')
                    with os.fdopen(fd, 'wb') as tf:
                        tf.write(pcap_data)
                    return temp_pcap_path, True, os.path.basename(chosen), direct_pcaps

            # 2. Check nested zip files
            inner_zips = [n for n in outer.namelist() if n.lower().endswith(('.zip', '.zip'))]
            all_nested_pcaps = []
            for iz in inner_zips:
                try:
                    outer_data = outer.read(iz)
                    with zipfile.ZipFile(io.BytesIO(outer_data), 'r') as inner:
                        nested_pcaps = [n for n in inner.namelist() if n.lower().endswith(('.pcap', '.pcapng', '.cap'))]
                        all_nested_pcaps.extend(nested_pcaps)
                        if nested_pcaps:
                            chosen = target_inner_pcap if target_inner_pcap in nested_pcaps else nested_pcaps[0]
                            pcap_data = None
                            for pwd in COMMON_PWDS:
                                try:
                                    pcap_data = inner.read(chosen, pwd=pwd)
                                    break
                                except RuntimeError:
                                    continue
                            if pcap_data is not None:
                                fd, temp_pcap_path = tempfile.mkstemp(suffix=os.path.splitext(chosen)[1] or '.pcap', prefix='stx_unzip_')
                                with os.fdopen(fd, 'wb') as tf:
                                    tf.write(pcap_data)
                                return temp_pcap_path, True, os.path.basename(chosen), all_nested_pcaps
                except Exception:
                    continue

            if not direct_pcaps and not all_nested_pcaps:
                raise ValueError("ZIP archive does not contain any .pcap or .pcapng files")
    except Exception as e:
        raise ValueError(f"Failed to extract PCAP from ZIP archive: {str(e)}")

    raise ValueError("ZIP archive contains PCAP files, but extraction failed or password was unknown")


def inspect_pcap(pcap_path: str, scrub: bool = False, inner_pcap: Optional[str] = None) -> Dict[str, Any]:
    """Stream-read PCAP (or unpack PCAP from .zip) and extract all flows and metadata without loading whole file into RAM."""
    if not os.path.isfile(pcap_path):
        raise FileNotFoundError(f"Capture file not found: {pcap_path}")

    actual_pcap_path, is_temp, inner_name, discovered_pcaps = unpack_pcap_from_zip(pcap_path, inner_pcap)
    archive_file_size = os.path.getsize(pcap_path) if is_temp else None

    try:
        file_size = os.path.getsize(actual_pcap_path)
        with open(actual_pcap_path, "rb") as f:
            file_sha256 = hashlib.sha256(f.read(65536 * 10)).hexdigest()  # sample hash for fast ID

        tcp_flows: Dict[Tuple, TCPFlowReassembler] = {}
        udp_flows: Dict[Tuple, UDPFlowReassembler] = {}

        packet_count = 0
        ipv4_packets_count = 0
        ipv6_packets_count = 0
        arp_packets_count = 0
        non_ip_packets_count = 0
        start_time = None
        end_time = None

        with PcapReader(actual_pcap_path) as reader:
            while True:
                try:
                    pkt = reader.read_packet()
                    if pkt is None:
                        break
                except (EOFError, StopIteration):
                    break
                except Exception:
                    continue

                packet_count += 1
                pkt_time = float(pkt.time) if hasattr(pkt, 'time') else 0.0
                if start_time is None:
                    start_time = pkt_time
                end_time = pkt_time

                # Non-IP / ARP detection
                if pkt.haslayer(ARP):
                    arp_packets_count += 1
                    continue

                # IP / IPv6 detection
                ip_layer = pkt.getlayer(IP)
                if ip_layer:
                    ipv4_packets_count += 1
                else:
                    ip_layer = pkt.getlayer(IPv6)
                    if ip_layer:
                        ipv6_packets_count += 1
                    else:
                        non_ip_packets_count += 1
                        continue

                src_ip = ip_layer.src
                dst_ip = ip_layer.dst

                # TCP handling
                tcp_layer = pkt.getlayer(TCP)
                if tcp_layer:
                    src_port = tcp_layer.sport
                    dst_port = tcp_layer.dport
                    flow_key = normalize_flow_key(src_ip, src_port, dst_ip, dst_port, 'tcp')

                    if flow_key not in tcp_flows:
                        tcp_flows[flow_key] = TCPFlowReassembler(flow_key)

                    reassembler = tcp_flows[flow_key]

                    # Check SYN flags
                    flags = tcp_layer.flags
                    if flags & 0x02:  # SYN
                        if flags & 0x10:  # SYN-ACK
                            reassembler.register_syn_ack(src_ip, src_port, dst_ip, dst_port)
                        else:
                            reassembler.register_syn(src_ip, src_port, dst_ip, dst_port)

                    raw_layer = pkt.getlayer(Raw)
                    payload = raw_layer.load if raw_layer else b""
                    reassembler.add_segment(src_ip, src_port, dst_ip, dst_port, tcp_layer.seq, payload, pkt_time)
                    continue

                # UDP handling
                udp_layer = pkt.getlayer(UDP)
                if udp_layer:
                    src_port = udp_layer.sport
                    dst_port = udp_layer.dport
                    flow_key = normalize_flow_key(src_ip, src_port, dst_ip, dst_port, 'udp')

                    if flow_key not in udp_flows:
                        udp_flows[flow_key] = UDPFlowReassembler(flow_key)

                    raw_layer = pkt.getlayer(Raw)
                    payload = raw_layer.load if raw_layer else b""
                    udp_flows[flow_key].add_datagram(src_ip, src_port, dst_ip, dst_port, payload, pkt_time)

        duration_sec = round((end_time - start_time), 3) if (start_time and end_time) else 0.0

        # Build flow summaries
        flow_summaries = []
        flow_idx = 1

        # Process TCP flows
        for key, reasm in tcp_flows.items():
            turns, warnings, stats = reasm.compile_turns(scrub=scrub)
            if not turns:
                continue
            is_noise, noise_type = classify_flow(reasm.client_ip, reasm.client_port, reasm.server_ip, reasm.server_port)
            flow_summaries.append({
                "flow_id": flow_idx,
                "transport": "tcp",
                "client_ip": reasm.client_ip,
                "client_port": reasm.client_port,
                "server_ip": reasm.server_ip,
                "server_port": reasm.server_port,
                "turns_count": len(turns),
                "payload_bytes": stats.get("total_payload_bytes", 0),
                "warnings": warnings,
                "stats": stats,
                "is_noise": is_noise,
                "noise_type": noise_type,
                "_turns": turns
            })
            flow_idx += 1

        # Process UDP flows
        for key, reasm in udp_flows.items():
            turns, warnings, stats = reasm.compile_turns(scrub=scrub)
            if not turns:
                continue
            is_noise, noise_type = classify_flow(reasm.client_ip, reasm.client_port, reasm.server_ip, reasm.server_port)
            flow_summaries.append({
                "flow_id": flow_idx,
                "transport": "udp",
                "client_ip": reasm.client_ip,
                "client_port": reasm.client_port,
                "server_ip": reasm.server_ip,
                "server_port": reasm.server_port,
                "turns_count": len(turns),
                "payload_bytes": stats.get("total_payload_bytes", 0),
                "warnings": warnings,
                "stats": stats,
                "is_noise": is_noise,
                "noise_type": noise_type,
                "_turns": turns
            })
            flow_idx += 1

        # Sort flows: unicast flows first (payload_bytes desc), then background noise flows
        flow_summaries.sort(key=lambda x: (not x.get("is_noise", False), x["payload_bytes"]), reverse=True)

        # Re-index flow_id sequentially
        for idx, f in enumerate(flow_summaries, 1):
            f["flow_id"] = idx

        unicast_count = sum(1 for f in flow_summaries if not f.get("is_noise"))
        noise_count = sum(1 for f in flow_summaries if f.get("is_noise"))

        return {
            "file_path": pcap_path,
            "file_name": inner_name if inner_name else os.path.basename(pcap_path),
            "archive_source": os.path.basename(pcap_path) if is_temp else None,
            "archive_pcaps_found": discovered_pcaps if is_temp else [],
            "file_size_bytes": file_size,
            "archive_file_size": archive_file_size,
            "sample_sha256": file_sha256,
            "packet_count": packet_count,
            "duration_seconds": duration_sec,
            "ipv4_packets": ipv4_packets_count,
            "ipv6_packets": ipv6_packets_count,
            "arp_packets": arp_packets_count,
            "non_ip_packets": non_ip_packets_count,
            "total_active_flows": len(flow_summaries),
            "unicast_flows_count": unicast_count,
            "noise_flows_count": noise_count,
            "flows": flow_summaries
        }
    finally:
        if is_temp and os.path.exists(actual_pcap_path):
            try:
                os.unlink(actual_pcap_path)
            except Exception:
                pass


def compile_stx_profile(inspection: Dict[str, Any], selected_flow_ids: Optional[List[int]] = None,
                        profile_name: Optional[str] = None, category: str = "custom",
                        expected_app_id: Optional[str] = None,
                        expected_threat_id: Optional[str] = None,
                        target_port: Optional[int] = None) -> Dict[str, Any]:
    """Convert inspected flows into a compressed .stx-replay profile structure."""
    RESERVED_PORTS = {80, 443, 8080, 8081, 8082, 8083, 8084, 8085, 8086, 8087, 8088, 8089, 8090, 8443}

    flows_to_include = []
    unicast_flows_count = inspection.get("unicast_flows_count", 0)

    for f in inspection["flows"]:
        # If user explicitly specified flow IDs, respect selection
        if selected_flow_ids is not None:
            if f["flow_id"] not in selected_flow_ids:
                continue
        else:
            # If no selection specified, default to all non-noise unicast flows (if available)
            if f.get("is_noise") and unicast_flows_count > 0:
                continue
            orig_port = f["server_port"]
            if target_port:
                eff_port = int(target_port)
            elif orig_port in RESERVED_PORTS:
                eff_port = 10000 + orig_port if orig_port < 50000 else orig_port - 10000
            else:
                eff_port = orig_port

            flows_to_include.append({
                "flow_id": f["flow_id"],
                "transport": f["transport"],
                "server_port": eff_port,
                "original_server_port": orig_port,
                "client_ip": f["client_ip"],
                "server_ip": f["server_ip"],
                "turns": f["_turns"]
            })

    if not flows_to_include:
        raise ValueError("No flows selected or available for replay profile")

    basename = os.path.splitext(inspection["file_name"])[0]
    p_name = profile_name or f"Replay - {basename}"
    p_id = f"rp-{re.sub(r'[^a-zA-Z0-9_-]', '-', basename).lower()}-{inspection['sample_sha256'][:8]}"

    profile = {
        "id": p_id,
        "name": p_name,
        "category": category,
        "source": {
            "file": inspection["file_name"],
            "sha256": inspection["sample_sha256"],
            "original_size": inspection["file_size_bytes"],
            "packet_count": inspection["packet_count"],
            "duration_seconds": inspection["duration_seconds"]
        },
        "fidelity": "full",
        "expected": {
            "app_id": expected_app_id,
            "threat_id": expected_threat_id
        },
        "flows": flows_to_include,
        "replay_settings": {
            "loop": False,
            "concurrency": 1,
            "interval_ms": 500,
            "timing": "as_fast_as_possible",
            "turn_timeout_ms": 5000
        }
    }
    return profile


def save_stx_profile(profile: Dict[str, Any], output_path: str) -> Tuple[int, float]:
    """Serialize profile to JSON and write gzip-compressed .stx-replay file."""
    data = json.dumps(profile, indent=2).encode('utf-8')
    with gzip.open(output_path, 'wb', compresslevel=9) as gz:
        gz.write(data)
    out_size = os.path.getsize(output_path)
    orig_size = profile["source"]["original_size"]
    ratio = (out_size / orig_size) * 100.0 if orig_size > 0 else 0.0
    return out_size, ratio


def main():
    parser = argparse.ArgumentParser(
        description="Stigix PCAP Stateful Parser & Replay Profile Generator (M1)",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Inspect a PCAP and display detected flows and turns
  python3 pcap_parser.py capture.pcap --inspect

  # Output inspection summary in JSON (used by Stigix Dashboard API)
  python3 pcap_parser.py capture.pcap --inspect --json

  # Compile all flows into a compressed .stx-replay profile with sensitive data scrubbed
  python3 pcap_parser.py capture.pcap --out profile.stx-replay --scrub

  # Compile only flow #1 into a named profile
  python3 pcap_parser.py capture.pcap --flow-id 1 --out sap_gui.stx-replay --name "SAP GUI Login"
"""
    )
    parser.add_argument("pcap", help="Path to input .pcap or .pcapng file")
    parser.add_argument("--inspect", action="store_true", help="Inspect and display flow overview table")
    parser.add_argument("--flow-id", type=int, action="append", help="Select specific flow ID(s) to include")
    parser.add_argument("--out", "-o", help="Output path for compressed .stx-replay file")
    parser.add_argument("--name", help="Human-readable profile name")
    parser.add_argument("--category", default="custom", choices=["custom", "enterprise", "threat", "iot"], help="Profile category")
    parser.add_argument("--app-id", help="Expected Palo Alto App-ID (e.g. sap, modbus, dicom)")
    parser.add_argument("--threat-id", help="Expected Palo Alto Threat ID (e.g. 55123)")
    parser.add_argument("--port", type=int, help="Target replay port (defaults to conflict-free port if original conflicts)")
    parser.add_argument("--scrub", action="store_true", help="Scrub credentials, tokens, and sensitive patterns")
    parser.add_argument("--json", action="store_true", help="Output JSON format instead of human-readable text")

    args = parser.parse_args()

    try:
        inspection = inspect_pcap(args.pcap, scrub=args.scrub)
    except Exception as e:
        if args.json:
            print(json.dumps({"error": str(e)}))
        else:
            print(f"Error reading capture: {e}", file=sys.stderr)
        sys.exit(1)

    # If --inspect or no output file specified, display inspection
    if args.inspect or not args.out:
        if args.json:
            # Strip deep _turns payloads from JSON preview for lightness
            preview = dict(inspection)
            clean_flows = []
            for f in preview["flows"]:
                cf = dict(f)
                cf.pop("_turns", None)
                clean_flows.append(cf)
            preview["flows"] = clean_flows
            print(json.dumps(preview, indent=2))
        else:
            print(f"\n📦 Capture: {inspection['file_name']} ({inspection['file_size_bytes']:,} bytes, {inspection['packet_count']} packets, {inspection['duration_seconds']}s)")
            print(f"📊 Protocol Breakdown: IPv4={inspection.get('ipv4_packets', 0)}, IPv6={inspection.get('ipv6_packets', 0)}, ARP={inspection.get('arp_packets', 0)}, Non-IP={inspection.get('non_ip_packets', 0)}")
            print(f"🎯 Total Active Flows: {inspection['total_active_flows']} ({inspection.get('unicast_flows_count', 0)} Unicast L7, {inspection.get('noise_flows_count', 0)} Background Noise)\n")
            print(f"{'ID':<4} {'Proto':<6} {'Client Endpoint':<24} {'Server Endpoint':<24} {'Turns':<7} {'Payload':<10} {'Classification / Warnings'}")
            print("-" * 105)
            for f in inspection["flows"]:
                client_ep = f"{f['client_ip']}:{f['client_port']}" if f['client_ip'] else "N/A"
                server_ep = f"{f['server_ip']}:{f['server_port']}" if f['server_ip'] else "N/A"
                notes = []
                if f.get("is_noise"):
                    notes.append(f"[NOISE: {f.get('noise_type')}]")
                if f.get("warnings"):
                    notes.extend(f["warnings"])
                warn = ", ".join(notes) if notes else "clean unicast"
                print(f"{f['flow_id']:<4} {f['transport'].upper():<6} {client_ep:<24} {server_ep:<24} {f['turns_count']:<7} {f['payload_bytes']:<10} {warn}")
            print("\nUse --out <filename.stx-replay> to compile a replay profile.")

    # If --out specified, generate the .stx-replay file
    if args.out:
        try:
            profile = compile_stx_profile(
                inspection,
                selected_flow_ids=args.flow_id,
                profile_name=args.name,
                category=args.category,
                expected_app_id=args.app_id,
                expected_threat_id=args.threat_id,
                target_port=args.port
            )
            out_size, ratio = save_stx_profile(profile, args.out)
            if args.json:
                print(json.dumps({
                    "success": True,
                    "profile_id": profile["id"],
                    "output_file": args.out,
                    "profile_size_bytes": out_size,
                    "compression_ratio_pct": round(ratio, 2),
                    "flows_count": len(profile["flows"])
                }))
            else:
                print(f"\n✅ Profile compiled successfully: {args.out}")
                print(f"   Profile ID: {profile['id']}")
                print(f"   Original Size: {inspection['file_size_bytes']:,} bytes")
                print(f"   Profile Size:  {out_size:,} bytes ({ratio:.1f}% of original)")
                print(f"   Flows included: {len(profile['flows'])}")
        except Exception as e:
            if args.json:
                print(json.dumps({"error": str(e)}))
            else:
                print(f"Error compiling profile: {e}", file=sys.stderr)
            sys.exit(1)


if __name__ == "__main__":
    main()
