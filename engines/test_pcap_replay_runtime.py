#!/usr/bin/env python3
"""
Integration test for Stigix PCAP Stateful Replay Runtime (engines/pcap_replay_runtime.py)
Validates M2 deliverables:
- TCP server listening and byte-accurate turn exchange
- TCP client connecting, sending client turns, receiving server turns
- Telemetry events and final verdict calculation (Bypass)
"""

import os
import sys
import tempfile
import gzip
import json
import base64
import time
import threading

# Ensure repository root and engines/ are in path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "../engines")))

from engines.pcap_replay_runtime import run_tcp_server, run_tcp_client


def test_stateful_replay_turn_exchange():
    test_port = 19555
    req_payload = b"GET /health HTTP/1.1\r\nHost: test.stigix.local\r\n\r\n"
    resp_payload = b"HTTP/1.1 200 OK\r\nContent-Length: 15\r\n\r\nStigix Replay OK"

    profile = {
        "id": "rp-unit-test-http",
        "name": "Unit Test HTTP Profile",
        "flows": [
            {
                "flow_id": 1,
                "transport": "tcp",
                "server_port": test_port,
                "turns": [
                    {
                        "seq": 1,
                        "sender": "client",
                        "trigger": "after_peer_turn",
                        "length": len(req_payload),
                        "delay_ms": 0,
                        "payload_b64": base64.b64encode(req_payload).decode("ascii")
                    },
                    {
                        "seq": 2,
                        "sender": "server",
                        "trigger": "after_peer_turn",
                        "length": len(resp_payload),
                        "delay_ms": 10,
                        "payload_b64": base64.b64encode(resp_payload).decode("ascii")
                    }
                ]
            }
        ],
        "replay_settings": {
            "timing": "as_fast_as_possible",
            "turn_timeout_ms": 2000
        }
    }

    # Start server thread
    server_error = []
    def server_worker():
        try:
            # Run server for 1 session
            import socket
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            sock.bind(("127.0.0.1", test_port))
            sock.listen(1)
            conn, addr = sock.accept()
            from engines.pcap_replay_runtime import TCPServerSession
            session = TCPServerSession(conn, addr, profile["flows"][0], "as_fast_as_possible", 2.0, False)
            session.run()
            sock.close()
        except Exception as e:
            server_error.append(e)

    server_thread = threading.Thread(target=server_worker, daemon=True)
    server_thread.start()
    time.sleep(0.1)  # Allow server to bind

    # Run client
    client_res = run_tcp_client(
        profile=profile,
        flow_id=1,
        target_ip="127.0.0.1",
        port_override=test_port,
        loop=False,
        loop_interval_ms=1000,
        json_output=False
    )

    server_thread.join(timeout=3.0)

    assert not server_error, f"Server encountered errors: {server_error}"
    assert client_res["status"] == "completed", f"Expected completed status, got {client_res}"
    assert client_res["verdict"] == "Bypass", f"Expected Bypass verdict, got {client_res['verdict']}"
    assert client_res["completed_turns"] == 2, f"Expected 2 completed turns, got {client_res['completed_turns']}"
    assert client_res["rx_bytes"] == len(resp_payload), f"Expected {len(resp_payload)} rx bytes"
    assert client_res["tx_bytes"] == len(req_payload), f"Expected {len(req_payload)} tx bytes"

    print("✅ Stateful Replay M2 Runtime Test Passed!")


if __name__ == "__main__":
    test_stateful_replay_turn_exchange()
