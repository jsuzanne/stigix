#!/usr/bin/env python3
"""
Stigix PCAP Stateful Replay Runtime (M2)
Executes byte-accurate bidirectional TCP and UDP application turn replays
between Stigix nodes according to a .stx-replay profile.

Part of the Stigix PCAP Stateful Replay Engine (PRD_PCAP_REPLAY_ENGINE.md).
"""

import sys
import os
import gzip
import json
import base64
import time
import socket
import select
import argparse
import signal
from typing import Dict, List, Any, Optional, Tuple


class ReplayException(Exception):
    pass


class ConnectionClosedEarly(ReplayException):
    def __init__(self, received: int, expected: int):
        super().__init__(f"Connection closed by peer early: received {received}/{expected} bytes")
        self.received = received
        self.expected = expected


def read_exact(sock: socket.socket, n: int, timeout_sec: float) -> bytes:
    """Read exactly n bytes from a TCP socket or raise exception on timeout / EOF."""
    sock.settimeout(timeout_sec)
    buf = bytearray()
    while len(buf) < n:
        try:
            chunk = sock.recv(min(65536, n - len(buf)))
            if not chunk:
                raise ConnectionClosedEarly(len(buf), n)
            buf.extend(chunk)
        except socket.timeout:
            raise socket.timeout(f"Timeout waiting for turn payload (received {len(buf)}/{n} bytes)")
    return bytes(buf)


def load_profile(profile_path: str) -> Dict[str, Any]:
    """Load and decompress .stx-replay file."""
    if not os.path.isfile(profile_path):
        raise FileNotFoundError(f"Profile not found: {profile_path}")

    try:
        with gzip.open(profile_path, "rt", encoding="utf-8") as gz:
            return json.load(gz)
    except Exception:
        # Fallback to plain JSON if uncompressed
        with open(profile_path, "r", encoding="utf-8") as f:
            return json.load(f)


def emit_event(event_type: str, data: Dict[str, Any], json_output: bool = True):
    """Emit formatted telemetry event for logging and API streaming."""
    event = {
        "timestamp": time.time(),
        "event": event_type,
        **data
    }
    if json_output:
        print(json.dumps(event), flush=True)
    else:
        print(f"[{time.strftime('%H:%M:%S')}] [{event_type}] {json.dumps(data)}", flush=True)


class TCPServerSession:
    """Handles one incoming client connection and executes the profile turns."""
    def __init__(self, conn: socket.socket, addr: Tuple[str, int], flow: Dict[str, Any],
                 timing_mode: str, turn_timeout_sec: float, json_output: bool):
        self.conn = conn
        self.addr = addr
        self.flow = flow
        self.timing_mode = timing_mode
        self.turn_timeout_sec = turn_timeout_sec
        self.json_output = json_output

    def run(self):
        turns = self.flow.get("turns", [])
        total_turns = len(turns)
        session_start = time.time()
        rx_bytes = 0
        tx_bytes = 0

        server_sock_name = self.conn.getsockname()
        emit_event("session_started", {
            "client_ip": self.addr[0],
            "client_port": self.addr[1],
            "server_ip": server_sock_name[0],
            "server_port": server_sock_name[1],
            "flow_id": self.flow.get("flow_id"),
            "total_turns": total_turns
        }, self.json_output)

        try:
            for turn in turns:
                seq = turn["seq"]
                sender = turn["sender"]
                length = turn["length"]
                delay_ms = turn.get("delay_ms", 0)
                payload = base64.b64decode(turn["payload_b64"]) if "payload_b64" in turn else b""

                if sender == "server":
                    # Server's turn to speak
                    if self.timing_mode == "original" and delay_ms > 0:
                        time.sleep(delay_ms / 1000.0)

                    turn_start = time.time()
                    self.conn.sendall(payload)
                    tx_bytes += len(payload)
                    turn_dur_ms = round((time.time() - turn_start) * 1000, 2)

                    emit_event("turn_completed", {
                        "seq": seq,
                        "sender": "server",
                        "bytes": len(payload),
                        "duration_ms": turn_dur_ms
                    }, self.json_output)

                else:
                    # Client's turn: Server waits to receive length bytes
                    turn_start = time.time()
                    received = read_exact(self.conn, length, self.turn_timeout_sec)
                    rx_bytes += len(received)
                    turn_dur_ms = round((time.time() - turn_start) * 1000, 2)

                    emit_event("turn_completed", {
                        "seq": seq,
                        "sender": "client",
                        "bytes": len(received),
                        "duration_ms": turn_dur_ms
                    }, self.json_output)

            total_dur_ms = round((time.time() - session_start) * 1000, 2)
            emit_event("session_finished", {
                "status": "success",
                "completed_turns": total_turns,
                "total_turns": total_turns,
                "rx_bytes": rx_bytes,
                "tx_bytes": tx_bytes,
                "duration_ms": total_dur_ms
            }, self.json_output)

        except Exception as e:
            total_dur_ms = round((time.time() - session_start) * 1000, 2)
            emit_event("session_error", {
                "error": str(e),
                "error_type": type(e).__name__,
                "rx_bytes": rx_bytes,
                "tx_bytes": tx_bytes,
                "duration_ms": total_dur_ms
            }, self.json_output)
        finally:
            try:
                self.conn.close()
            except Exception:
                pass


def run_tcp_server(profile: Dict[str, Any], flow_id: Optional[int], bind_ip: str,
                   port_override: Optional[int], json_output: bool):
    """Run TCP server role for stateful replay."""
    flow = None
    for f in profile.get("flows", []):
        if flow_id is None or f["flow_id"] == flow_id:
            if f.get("transport", "tcp").lower() == "tcp":
                flow = f
                break

    if not flow:
        raise ValueError(f"No valid TCP flow found in profile for flow_id={flow_id}")

    server_port = port_override or flow.get("server_port") or 8080
    timing_mode = profile.get("replay_settings", {}).get("timing", "as_fast_as_possible")
    timeout_sec = float(profile.get("replay_settings", {}).get("turn_timeout_ms", 5000)) / 1000.0

    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    try:
        sock.bind((bind_ip, server_port))
    except OSError as e:
        # If default port is in conflict and no explicit override was set, try fallback port 10000 + port
        if port_override is None:
            fallback_port = 10000 + server_port if server_port < 50000 else server_port - 10000
            try:
                sock.bind((bind_ip, fallback_port))
                emit_event("port_fallback", {
                    "original_port": server_port,
                    "active_port": fallback_port,
                    "reason": f"Port {server_port} already in use ({e}). Switched automatically to {fallback_port}."
                }, json_output)
                server_port = fallback_port
            except OSError as e2:
                emit_event("server_error", {
                    "error": f"Failed to bind {bind_ip}:{server_port} and fallback {fallback_port} ({e2})",
                    "port": server_port,
                    "bind_ip": bind_ip
                }, json_output)
                sys.exit(1)
        else:
            emit_event("server_error", {
                "error": f"Failed to bind {bind_ip}:{server_port} ({e})",
                "port": server_port,
                "bind_ip": bind_ip
            }, json_output)
            sys.exit(1)

    sock.listen(10)

    emit_event("server_listening", {
        "transport": "tcp",
        "bind_ip": bind_ip,
        "port": server_port,
        "profile_id": profile.get("id"),
        "flow_id": flow.get("flow_id")
    }, json_output)

    try:
        while True:
            conn, addr = sock.accept()
            handler = TCPServerSession(conn, addr, flow, timing_mode, timeout_sec, json_output)
            handler.run()
    except KeyboardInterrupt:
        emit_event("server_stopped", {"reason": "interrupted"}, json_output)
    finally:
        sock.close()


def run_tcp_client(profile: Dict[str, Any], flow_id: Optional[int], target_ip: str,
                   port_override: Optional[int], loop: bool, loop_interval_ms: int,
                   json_output: bool) -> Dict[str, Any]:
    """Run TCP client role, execute turns, and compute security/resilience verdict."""
    flow = None
    for f in profile.get("flows", []):
        if flow_id is None or f["flow_id"] == flow_id:
            if f.get("transport", "tcp").lower() == "tcp":
                flow = f
                break

    if not flow:
        raise ValueError(f"No valid TCP flow found in profile for flow_id={flow_id}")

    server_port = port_override or flow.get("server_port") or 8080
    timing_mode = profile.get("replay_settings", {}).get("timing", "as_fast_as_possible")
    timeout_sec = float(profile.get("replay_settings", {}).get("turn_timeout_ms", 5000)) / 1000.0
    turns = flow.get("turns", [])
    total_turns = len(turns)

    # Malicious turn index if declared
    malicious_turn = flow.get("malicious_turn")

    def execute_single_run() -> Dict[str, Any]:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(timeout_sec)
        conn_start = time.time()
        rx_bytes = 0
        tx_bytes = 0
        completed_turns = 0
        verdict = "Inconclusive"
        error_msg = None

        try:
            sock.connect((target_ip, server_port))
            connect_rtt_ms = round((time.time() - conn_start) * 1000, 2)
            local_ip, local_port = sock.getsockname()

            emit_event("client_connected", {
                "local_ip": local_ip,
                "local_port": local_port,
                "target_ip": target_ip,
                "target_port": server_port,
                "pcap_original_src": f"{flow.get('client_ip')}:{flow.get('client_port')}",
                "pcap_original_dst": f"{flow.get('server_ip')}:{flow.get('server_port')}",
                "handshake_rtt_ms": connect_rtt_ms
            }, json_output)

            for turn in turns:
                seq = turn["seq"]
                sender = turn["sender"]
                length = turn["length"]
                delay_ms = turn.get("delay_ms", 0)
                payload = base64.b64decode(turn["payload_b64"]) if "payload_b64" in turn else b""

                if sender == "client":
                    # Client speaks
                    if timing_mode == "original" and delay_ms > 0:
                        time.sleep(delay_ms / 1000.0)

                    turn_start = time.time()
                    sock.sendall(payload)
                    tx_bytes += len(payload)
                    turn_dur_ms = round((time.time() - turn_start) * 1000, 2)
                    completed_turns += 1

                    emit_event("client_turn_completed", {
                        "seq": seq,
                        "sender": "client",
                        "bytes": len(payload),
                        "duration_ms": turn_dur_ms
                    }, json_output)

                else:
                    # Client waits for server turn
                    turn_start = time.time()
                    received = read_exact(sock, length, timeout_sec)
                    rx_bytes += len(received)
                    turn_dur_ms = round((time.time() - turn_start) * 1000, 2)
                    completed_turns += 1

                    # Check for captive portal / block page in server response
                    if b"<title>Access Denied" in received or b"block-page" in received:
                        verdict = "Enforced (Block Page)"

                    emit_event("client_turn_completed", {
                        "seq": seq,
                        "sender": "server",
                        "bytes": len(received),
                        "duration_ms": turn_dur_ms
                    }, json_output)

            total_dur_ms = round((time.time() - conn_start) * 1000, 2)

            if completed_turns == total_turns:
                verdict = "Bypass" if verdict == "Inconclusive" else verdict

            run_result = {
                "status": "completed",
                "verdict": verdict,
                "completed_turns": completed_turns,
                "total_turns": total_turns,
                "rx_bytes": rx_bytes,
                "tx_bytes": tx_bytes,
                "duration_ms": total_dur_ms
            }
            emit_event("client_session_finished", run_result, json_output)
            return run_result

        except ConnectionResetError:
            total_dur_ms = round((time.time() - conn_start) * 1000, 2)
            # If RST arrived at or after the malicious turn, it was blocked by firewall RST
            if malicious_turn is None or completed_turns >= malicious_turn:
                verdict = "Enforced (Reset)"
            else:
                verdict = "Inconclusive"

            res = {
                "status": "reset",
                "verdict": verdict,
                "completed_turns": completed_turns,
                "total_turns": total_turns,
                "error": "Connection reset by peer (TCP RST)",
                "duration_ms": total_dur_ms
            }
            emit_event("client_session_finished", res, json_output)
            return res

        except (socket.timeout, TimeoutError):
            total_dur_ms = round((time.time() - conn_start) * 1000, 2)
            # If timeout occurred on or right after the malicious turn, packet was dropped by security rule
            if malicious_turn is not None and completed_turns >= malicious_turn:
                verdict = "Enforced (Drop)"
            else:
                verdict = "Inconclusive"

            res = {
                "status": "timeout",
                "verdict": verdict,
                "completed_turns": completed_turns,
                "total_turns": total_turns,
                "error": "Turn timed out (silent drop / loss)",
                "duration_ms": total_dur_ms
            }
            emit_event("client_session_finished", res, json_output)
            return res

        except Exception as e:
            total_dur_ms = round((time.time() - conn_start) * 1000, 2)
            res = {
                "status": "error",
                "verdict": "Inconclusive",
                "completed_turns": completed_turns,
                "total_turns": total_turns,
                "error": str(e),
                "duration_ms": total_dur_ms
            }
            emit_event("client_session_finished", res, json_output)
            return res

        finally:
            try:
                sock.close()
            except Exception:
                pass

    # Handle loop if requested
    last_res = execute_single_run()
    if loop:
        try:
            while True:
                time.sleep(loop_interval_ms / 1000.0)
                last_res = execute_single_run()
        except KeyboardInterrupt:
            emit_event("client_stopped", {"reason": "interrupted"}, json_output)

    return last_res


def run_udp_server(profile: Dict[str, Any], flow_id: Optional[int], bind_ip: str,
                   port_override: Optional[int], json_output: bool):
    """Run UDP server role for datagram replay."""
    flow = None
    for f in profile.get("flows", []):
        if flow_id is None or f["flow_id"] == flow_id:
            if f.get("transport", "udp").lower() == "udp":
                flow = f
                break

    if not flow:
        raise ValueError(f"No valid UDP flow found in profile for flow_id={flow_id}")

    server_port = port_override or flow.get("server_port") or 8080
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.bind((bind_ip, server_port))

    emit_event("server_listening", {
        "transport": "udp",
        "bind_ip": bind_ip,
        "port": server_port,
        "profile_id": profile.get("id"),
        "flow_id": flow.get("flow_id")
    }, json_output)

    try:
        while True:
            data, client_addr = sock.recvfrom(65536)
            emit_event("udp_datagram_received", {
                "client_ip": client_addr[0],
                "client_port": client_addr[1],
                "bytes": len(data)
            }, json_output)
            # Find next server turn if any and echo/reply
            for turn in flow.get("turns", []):
                if turn["sender"] == "server":
                    payload = base64.b64decode(turn["payload_b64"]) if "payload_b64" in turn else b""
                    sock.sendto(payload, client_addr)
                    emit_event("udp_datagram_sent", {
                        "target_ip": client_addr[0],
                        "target_port": client_addr[1],
                        "bytes": len(payload)
                    }, json_output)
                    break
    except KeyboardInterrupt:
        emit_event("server_stopped", {"reason": "interrupted"}, json_output)
    finally:
        sock.close()


def run_udp_client(profile: Dict[str, Any], flow_id: Optional[int], target_ip: str,
                   port_override: Optional[int], json_output: bool) -> Dict[str, Any]:
    """Run UDP client role."""
    flow = None
    for f in profile.get("flows", []):
        if flow_id is None or f["flow_id"] == flow_id:
            if f.get("transport", "udp").lower() == "udp":
                flow = f
                break

    if not flow:
        raise ValueError(f"No valid UDP flow found in profile for flow_id={flow_id}")

    server_port = port_override or flow.get("server_port") or 8080
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.settimeout(3.0)

    turns = flow.get("turns", [])
    sent_turns = 0

    for turn in turns:
        if turn["sender"] == "client":
            payload = base64.b64decode(turn["payload_b64"]) if "payload_b64" in turn else b""
            sock.sendto(payload, (target_ip, server_port))
            sent_turns += 1
            emit_event("udp_datagram_sent", {
                "target_ip": target_ip,
                "target_port": server_port,
                "bytes": len(payload)
            }, json_output)

    sock.close()
    return {"status": "completed", "sent_turns": sent_turns}


def main():
    parser = argparse.ArgumentParser(
        description="Stigix PCAP Stateful Replay Runtime (M2)",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Start server role listening on port from profile
  python3 pcap_replay_runtime.py profile.stx-replay --role server

  # Start client role sending turns to remote Stigix node
  python3 pcap_replay_runtime.py profile.stx-replay --role client --target 192.168.1.100

  # Override port and loop every 1 second
  python3 pcap_replay_runtime.py profile.stx-replay --role client --target 10.0.0.1 --port 3200 --loop --interval 1000
"""
    )
    parser.add_argument("profile", help="Path to .stx-replay profile file")
    parser.add_argument("--role", required=True, choices=["server", "client"], help="Replay execution role")
    parser.add_argument("--target", help="Target Stigix node IP (required for client role)")
    parser.add_argument("--bind", default="0.0.0.0", help="Bind IP address for server role (default: 0.0.0.0)")
    parser.add_argument("--port", type=int, help="Override server port defined in profile")
    parser.add_argument("--flow-id", type=int, help="Select specific flow ID from profile to replay")
    parser.add_argument("--loop", action="store_true", help="Continuously repeat replay sessions")
    parser.add_argument("--interval", type=int, default=1000, help="Interval in ms between loop sessions (default: 1000)")
    parser.add_argument("--human", action="store_true", help="Print human-readable logs instead of JSON events")

    args = parser.parse_args()
    json_output = not args.human

    try:
        profile = load_profile(args.profile)
    except Exception as e:
        emit_event("error", {"error": f"Failed to load profile: {e}"}, json_output)
        sys.exit(1)

    transport = "tcp"
    for f in profile.get("flows", []):
        if args.flow_id is None or f.get("flow_id") == args.flow_id:
            transport = f.get("transport", "tcp").lower()
            break

    if args.role == "server":
        if transport == "udp":
            run_udp_server(profile, args.flow_id, args.bind, args.port, json_output)
        else:
            run_tcp_server(profile, args.flow_id, args.bind, args.port, json_output)

    elif args.role == "client":
        if not args.target:
            emit_event("error", {"error": "--target IP is required for client role"}, json_output)
            sys.exit(1)

        if transport == "udp":
            run_udp_client(profile, args.flow_id, args.target, args.port, json_output)
        else:
            run_tcp_client(profile, args.flow_id, args.target, args.port, args.loop, args.interval, json_output)


if __name__ == "__main__":
    main()
