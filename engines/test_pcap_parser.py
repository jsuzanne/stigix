#!/usr/bin/env python3
"""
Unit test for Stigix PCAP Stateful Parser (engines/pcap_parser.py)
Validates M1 deliverables:
- TCP handshake and segment reassembly into client/server turns
- De-duplication of TCP retransmissions
- UDP turn capture
- Sensitive data scan & scrubbing
- .stx-replay gzip serialization and compression measurement
"""

import os
import sys
import tempfile
import gzip
import json
import logging

# Mute scapy runtime warnings
logging.getLogger("scapy.runtime").setLevel(logging.ERROR)

# Ensure repository root and engines/ are in path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "../engines")))

from scapy.all import wrpcap, Ether, IP, TCP, UDP, Raw
from engines.pcap_parser import inspect_pcap, compile_stx_profile, save_stx_profile


def test_pcap_parser_flow():
    with tempfile.TemporaryDirectory() as tmpdir:
        pcap_path = os.path.join(tmpdir, "synthetic_test.pcap")
        stx_path = os.path.join(tmpdir, "output.stx-replay")

        packets = []
        base_time = 1000.0

        # Flow 1: TCP Handshake + HTTP Request + HTTP Response
        # SYN
        packets.append(IP(src="192.168.1.10", dst="10.0.0.80")/TCP(sport=49152, dport=80, flags="S", seq=1000))
        # SYN-ACK
        packets.append(IP(src="10.0.0.80", dst="192.168.1.10")/TCP(sport=80, dport=49152, flags="SA", seq=5000, ack=1001))
        # ACK
        packets.append(IP(src="192.168.1.10", dst="10.0.0.80")/TCP(sport=49152, dport=80, flags="A", seq=1001, ack=5001))

        # Client HTTP Turn (contains Authorization header)
        http_req = b"GET /admin HTTP/1.1\r\nHost: 10.0.0.80\r\nAuthorization: Basic YWRtaW46c2VjcmV0MTIz\r\n\r\n"
        packets.append(IP(src="192.168.1.10", dst="10.0.0.80")/TCP(sport=49152, dport=80, flags="PA", seq=1001, ack=5001)/Raw(load=http_req))

        # Duplicate segment (retransmission test)
        packets.append(IP(src="192.168.1.10", dst="10.0.0.80")/TCP(sport=49152, dport=80, flags="PA", seq=1001, ack=5001)/Raw(load=http_req))

        # Server HTTP Response Turn
        http_resp = b"HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: 12\r\n\r\nHello Stigix"
        packets.append(IP(src="10.0.0.80", dst="192.168.1.10")/TCP(sport=80, dport=49152, flags="PA", seq=5001, ack=1001 + len(http_req))/Raw(load=http_resp))

        # Flow 2: UDP Syslog/telemetry
        packets.append(IP(src="192.168.1.10", dst="10.0.0.51")/UDP(sport=51411, dport=514)/Raw(load=b"<14>Stigix system startup alert"))

        # Write pcap
        wrpcap(pcap_path, packets)

        # 1. Test Inspection without scrubbing
        insp = inspect_pcap(pcap_path, scrub=False)
        assert insp["packet_count"] == len(packets), f"Expected {len(packets)} packets, got {insp['packet_count']}"
        assert insp["total_active_flows"] == 2, f"Expected 2 active flows, got {insp['total_active_flows']}"

        tcp_flow = next(f for f in insp["flows"] if f["transport"] == "tcp")
        assert tcp_flow["client_port"] == 49152
        assert tcp_flow["server_port"] == 80
        assert tcp_flow["turns_count"] == 2, f"Expected 2 turns (request + response), got {tcp_flow['turns_count']}"
        assert any("Basic Auth" in w for w in tcp_flow["warnings"]), "Expected Basic Auth warning in unscrubbed flow"

        # 2. Test Inspection with scrubbing
        insp_scrubbed = inspect_pcap(pcap_path, scrub=True)
        tcp_flow_scrubbed = next(f for f in insp_scrubbed["flows"] if f["transport"] == "tcp")
        # In scrubbed flow, "YWRtaW46c2VjcmV0MTIz" must be masked with '*'
        import base64
        turn1_payload = base64.b64decode(tcp_flow_scrubbed["_turns"][0]["payload_b64"])
        assert b"Basic ********************" in turn1_payload, f"Payload was not scrubbed properly: {turn1_payload}"
        assert b"YWRtaW46c2VjcmV0MTIz" not in turn1_payload, "Plaintext credentials still present in scrubbed payload"

        # 3. Test compilation to .stx-replay
        profile = compile_stx_profile(
            insp_scrubbed,
            profile_name="Synthetic Test Profile",
            category="custom",
            expected_app_id="web-browsing"
        )
        assert profile["name"] == "Synthetic Test Profile"
        assert len(profile["flows"]) == 2

        # 4. Test save and compression
        out_size, ratio = save_stx_profile(profile, stx_path)
        assert os.path.exists(stx_path)
        assert out_size > 0

        # 5. Read back .stx-replay and verify integrity
        with gzip.open(stx_path, "rt", encoding="utf-8") as gz:
            loaded_profile = json.load(gz)
        assert loaded_profile["id"] == profile["id"]
        assert len(loaded_profile["flows"]) == 2
        print(f"✅ All tests passed! Original: {insp['file_size_bytes']} bytes -> Compressed Profile: {out_size} bytes ({ratio:.1f}%)")


if __name__ == "__main__":
    test_pcap_parser_flow()
