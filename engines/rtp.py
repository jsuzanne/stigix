#!/usr/bin/env python3
"""
RTP Voice Traffic Engine — raw UDP socket edition
Replaces Scapy with socket.SOCK_DGRAM + struct.pack for RTP headers.

Advantages over Scapy:
  - 10-100x faster per packet (no packet object construction, no raw socket open/close)
  - Zero D-state kernel threads
  - Handles 1000+ pps on a single core without sweat
  - DSCP EF still applied via setsockopt(IP_TOS, 184)

RTP header (RFC 3550) — 12 bytes:
   0                   1                   2                   3
   0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
  +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
  |V=2|P|X|  CC   |M|     PT      |       sequence number         |
  +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
  |                           timestamp                           |
  +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
  |           synchronization source (SSRC) identifier           |
  +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
  Byte 0: 0x80 = V=2, P=0, X=0, CC=0
  Byte 1: 0x00 | pt  (M=0)
"""

import argparse
import json
import logging
import os
import random
import socket
import struct
import sys
import threading
import time
import warnings

# Suppress any leftover Scapy warnings if Scapy happens to be imported elsewhere
warnings.filterwarnings("ignore")
logging.getLogger("scapy").setLevel(logging.ERROR)
logging.getLogger("scapy.runtime").setLevel(logging.ERROR)

# ── SO_BINDTODEVICE (Linux only, constant = 25) ──────────────────────────────
SO_BINDTODEVICE = getattr(socket, 'SO_BINDTODEVICE', 25)


# ── VoiceMetrics ─────────────────────────────────────────────────────────────

class VoiceMetrics:
    def __init__(self):
        self.sent_times = {}       # seq → sent_time (perf_counter)
        self.rtts = []
        self.received_seqs = set()
        self.last_transit_time = None
        self.jitter = 0.0
        self.lock = threading.Lock()

    def record_send(self, seq, timestamp):
        with self.lock:
            self.sent_times[seq] = timestamp

    def record_receive(self, seq, receive_time):
        with self.lock:
            if seq in self.received_seqs:
                return
            if seq in self.sent_times:
                self.received_seqs.add(seq)
                sent_time = self.sent_times[seq]
                rtt = (receive_time - sent_time) * 1000  # ms
                self.rtts.append(rtt)
                # RFC 3550 jitter estimation
                transit_time = receive_time - sent_time
                if self.last_transit_time is not None:
                    d = abs(transit_time - self.last_transit_time)
                    self.jitter = self.jitter + (d - self.jitter) / 16
                self.last_transit_time = transit_time


# ── Receiver thread ───────────────────────────────────────────────────────────

def receiver_thread(sock, metrics, stop_event):
    """Listen for echoed RTP packets and record RTT/jitter metrics."""
    sock.settimeout(0.5)
    while not stop_event.is_set():
        try:
            data, _addr = sock.recvfrom(2048)
            receive_time = time.perf_counter()
            # RTP sequence number is bytes 2-3 (big-endian)
            if len(data) >= 12:
                seq = (data[2] << 8) + data[3]
                metrics.record_receive(seq, receive_time)
        except socket.timeout:
            continue
        except Exception as e:
            if not stop_event.is_set():
                print(f"Receiver error: {e}", file=sys.stderr)


# ── Main ──────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="RTP voice traffic generator (raw UDP)")

    binding = parser.add_argument_group('Binding')
    binding.add_argument("--destination-ip", "-dip", "-D",
                         help="Destination IP", type=str, required=True)
    binding.add_argument("--destination-port", "-dport",
                         help="Destination port (default 6100)", type=int, default=6100)
    binding.add_argument("--source-ip", "-sip", "-S",
                         help="Source IP (optional — binds socket to this IP)",
                         type=str, default=None)
    binding.add_argument("--source-port", "-sport",
                         help="Source port (default 0 = auto from CALL-ID)",
                         type=int, default=0)
    binding.add_argument("--source-interface",
                         help="Source interface (SO_BINDTODEVICE, Linux only)",
                         type=str, default=None)

    opts = parser.add_argument_group('Options')
    opts.add_argument("--min-count", "-C",
                      help="Min packets to send (default 4500)", type=int, default=4500)
    opts.add_argument("--max-count",
                      help="Max packets to send (default 90000)", type=int, default=90000)
    opts.add_argument("--call-id",
                      help="Call ID embedded in payload for tracking", type=str, default="NONE")
    opts.add_argument("--stream-type",
                      help="Stream type: audio or video (default audio)",
                      type=str, default="audio", choices=["audio", "video"])

    args = vars(parser.parse_args())
    is_debug_mode = os.environ.get('DEBUG', 'false').lower() == 'true'

    # ── Packet count ──────────────────────────────────────────────────────────
    min_count = args['min_count']
    max_count = args['max_count']
    count = random.randrange(min_count, max_count)

    # ── Source port: deterministic from CALL-ID (30000-39999) ─────────────────
    source_port = args['source_port']
    if source_port == 0:
        if is_debug_mode:
            source_port = random.randrange(10000, 65535)
        else:
            call_id = args.get('call_id', 'NONE')
            target_port = 0
            if call_id.startswith("CALL-") and call_id[5:].isdigit():
                try:
                    raw_num = int(call_id[5:])
                    if raw_num > 9999:
                        print(f"Warning: CALL ID {call_id} exceeds 4 digits. Modulo applied.",
                              file=sys.stderr)
                    call_num = raw_num % 10000
                    target_port = 30000 + call_num
                except ValueError:
                    print(f"Warning: Could not parse numeric ID from {call_id}", file=sys.stderr)
            source_port = target_port if target_port > 0 else random.randrange(40000, 45000)

    # ── Stream type parameters ────────────────────────────────────────────────
    stream_type = args.get('stream_type', 'audio')
    if stream_type == 'video':
        payload_size  = 1300
        pt            = 96          # H.264 dynamic
        send_interval = 0.01        # 10 ms → 100 pps
        ts_increment  = 900         # 90 kHz clock
    else:
        payload_size  = 160
        pt            = 8           # PCMA (G.711 a-law)
        send_interval = 0.03        # 30 ms → ~33 pps (stable under load)
        ts_increment  = 160         # 8 kHz clock

    # ── Build payload ─────────────────────────────────────────────────────────
    payload_padding = os.urandom(payload_size)  # fast, no loop needed
    call_id_tag   = f"CID:{args.get('call_id', 'NONE')}:".encode()
    final_payload = (call_id_tag + payload_padding)[:payload_size]
    if is_debug_mode:
        print(f"[DEBUG MODE] stream={stream_type} | call_id={args.get('call_id')} | tos=0 | port=RANDOM | payload=tagged",
              file=sys.stderr)
    else:
        print(f"[NORMAL MODE] stream={stream_type} | call_id={args.get('call_id')} | tos=184 (EF) | port=30000+N | payload=tagged",
              file=sys.stderr)

    # ── Create UDP socket ─────────────────────────────────────────────────────
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)

    # DSCP Expedited Forwarding (EF, DSCP 46) = TOS 184 = 0b10111000
    if not is_debug_mode:
        try:
            sock.setsockopt(socket.IPPROTO_IP, socket.IP_TOS, 184)
        except Exception as e:
            print(f"Warning: Could not set IP_TOS: {e}", file=sys.stderr)

    # Bind to specific network interface (Linux SO_BINDTODEVICE)
    if args.get('source_interface'):
        try:
            sock.setsockopt(socket.SOL_SOCKET, SO_BINDTODEVICE,
                            args['source_interface'].encode())
        except Exception as e:
            print(f"Warning: Could not bind to interface {args['source_interface']}: {e}",
                  file=sys.stderr)

    # Bind to source IP / port so receiver echoes come back to us
    bind_ip = args['source_ip'] if args['source_ip'] else '0.0.0.0'
    try:
        sock.bind((bind_ip, source_port))
        source_port = sock.getsockname()[1]   # actual port if was 0
    except Exception as e:
        print(f"Warning: Could not bind to {bind_ip}:{source_port}: {e}", file=sys.stderr)

    # ── Start receiver thread (same socket) ──────────────────────────────────
    metrics    = VoiceMetrics()
    stop_event = threading.Event()
    t = threading.Thread(target=receiver_thread, args=(sock, metrics, stop_event))
    t.daemon = True
    t.start()

    # ── RTP state ─────────────────────────────────────────────────────────────
    ssrc          = random.getrandbits(32)
    rtp_timestamp = random.randrange(1000, 1_000_000)
    dst           = (args['destination_ip'], args['destination_port'])

    timestamp = time.strftime('%H:%M:%S')
    print(f"[{timestamp}] [{args['call_id']}] 🚀 Executing: python3 rtp.py"
          f" -D {args['destination_ip']} -dport {args['destination_port']}"
          f" --min-count {args['min_count']} --max-count {args['max_count']}"
          f" --source-interface {args['source_interface']} --call-id {args['call_id']}",
          file=sys.stderr)
    print(f"[{timestamp}] [{args['call_id']}] 📞 RTP Engine STARTED:"
          f" {args['destination_ip']}:{args['destination_port']}"
          f" | G.711-PCMA@30ms | {int(args['min_count'] * send_interval)}s",
          file=sys.stderr)

    # ── Send loop ─────────────────────────────────────────────────────────────
    start_time = time.time()

    for i in range(1, count + 1):
        # RFC 3550 RTP fixed header (12 bytes)
        rtp_header = struct.pack('!BBHII',
            0x80,               # V=2, P=0, X=0, CC=0
            pt,                 # M=0, PT
            i & 0xFFFF,         # sequence number (wraps at 16 bits)
            rtp_timestamp & 0xFFFFFFFF,
            ssrc
        )

        metrics.record_send(i, time.perf_counter())
        sock.sendto(rtp_header + final_payload, dst)

        rtp_timestamp = (rtp_timestamp + ts_increment) & 0xFFFFFFFF
        time.sleep(send_interval)

    # ── Wait for last echo ────────────────────────────────────────────────────
    time.sleep(1.0)
    stop_event.set()
    t.join(1.0)
    sock.close()

    # ── Final QoS metrics ─────────────────────────────────────────────────────
    received_count = len(metrics.received_seqs)
    loss     = ((count - received_count) / count) * 100 if count > 0 else 0
    loss     = max(0.0, min(100.0, loss))
    avg_rtt  = sum(metrics.rtts) / len(metrics.rtts) if metrics.rtts else 0
    max_rtt  = max(metrics.rtts) if metrics.rtts else 0
    jitter   = metrics.jitter * 1000  # ms

    summary = {
        "call_id":    args['call_id'],
        "sent":       count,
        "received":   received_count,
        "loss_pct":   round(loss, 2),
        "avg_rtt_ms": round(avg_rtt, 2),
        "max_rtt_ms": round(max_rtt, 2),
        "jitter_ms":  round(jitter, 2),
        "duration":   round(time.time() - start_time, 2),
    }

    print(f"RESULT: {json.dumps(summary)}")
    print(f"Call {args['call_id']} finished.")
