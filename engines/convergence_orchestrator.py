#!/usr/bin/env python3
import time
import argparse
import random
import sys
import threading
import json
import socket
import warnings
import os
import signal

# ========================================
# CONFIGURATION TEST/DEBUG
# ========================================
DEBUG_MODE = False   # ← ACTIVÉ pour logs détaillés
LOG_FILE = "/tmp/convergence_debug.log"
# ========================================

warnings.filterwarnings("ignore")

# Variable globale pour shutdown gracieux
graceful_shutdown = threading.Event()

def signal_handler(sig, frame):
    """Gestion propre de tous les signaux d'arrêt"""
    sig_name = signal.Signals(sig).name
    print(f"\n[SIGNAL] Received {sig_name}, initiating graceful shutdown...", flush=True)
    graceful_shutdown.set()

# Enregistrer les signal handlers
signal.signal(signal.SIGINT, signal_handler)   # Ctrl+C
signal.signal(signal.SIGTERM, signal_handler)  # kill/stop normal
signal.signal(signal.SIGHUP, signal_handler)   # Terminal fermé


def debug_log(msg: str) -> None:
    """Log uniquement si DEBUG_MODE est actif"""
    if not DEBUG_MODE:
        return
    try:
        ts = time.strftime("%Y-%m-%d %H:%M:%S")
        with open(LOG_FILE, "a") as f:
            f.write(f"[{ts}] {msg}\n")
    except Exception:
        pass


class ConvergenceMetrics:
    def __init__(self, rate, test_id, start_time, target, port, label, source_port):
        self.test_id = test_id
        self.start_time = start_time
        self.rate = rate
        self.target = target
        self.port = port
        self.label = label
        self.source_port = source_port
        self.interval = 1.0 / rate

        self.sent_count = 0
        self.sent_seqs = set()
        self.sent_times = {}

        self.received_seqs = set()
        self.server_received = 0

        self.rtts = []
        self.last_transit_time = None
        self.jitter = 0.0
        self.last_rcvd_time = start_time
        self.last_send_time = start_time
        self.sending_active = True
        self.max_blackout = 0

        self.tx_attempts = 0
        self.tx_errors = 0

        self.measurement_start_time = None
        self.measurement_end_time = None

        self.lock = threading.Lock()

    def record_send(self, seq: int, timestamp: float) -> None:
        with self.lock:
            self.sent_count += 1
            self.sent_seqs.add(seq)
            self.sent_times[seq] = timestamp
            self.last_send_time = timestamp

    def mark_send_failed(self, seq: int) -> None:
        with self.lock:
            self.sent_seqs.discard(seq)
            self.sent_times.pop(seq, None)

    def record_send_attempt(self) -> None:
        with self.lock:
            self.tx_attempts += 1

    def record_send_error(self) -> None:
        with self.lock:
            self.tx_errors += 1

    def record_receive(self, seq: int, server_count: int, receive_time: float) -> None:
        with self.lock:
            if seq in self.received_seqs:
                return

            self.received_seqs.add(seq)
            self.last_rcvd_time = receive_time

            if not hasattr(self, 'server_received_offset'):
                self.server_received_offset = 0
                self.last_seen_server_count = 0
                self.sync_lost = False

            # Detect server reset (count went backwards significantly)
            if server_count < self.last_seen_server_count - 100:
                self.server_received_offset += self.last_seen_server_count
                self.sync_lost = True
                
            self.last_seen_server_count = server_count
            effective_server_count = self.server_received_offset + server_count

            if effective_server_count > self.server_received:
                self.server_received = effective_server_count

            sent_time = self.sent_times.get(seq)
            if sent_time is None:
                return

            rtt_ms = (receive_time - sent_time) * 1000.0
            self.rtts.append(rtt_ms)

            transit_time = receive_time - sent_time
            if self.last_transit_time is not None:
                d = abs(transit_time - self.last_transit_time)
                self.jitter = self.jitter + (d - self.jitter) / 16.0
            self.last_transit_time = transit_time

    def get_stats(self, is_running: bool = True) -> dict:
        with self.lock:
            now = time.time()

            sent_seqs_copy = set(self.sent_seqs)
            received_seqs_copy = set(self.received_seqs)
            sent_times_copy = dict(self.sent_times)
            server_received_copy = self.server_received
            last_rcvd_time_copy = self.last_rcvd_time
            max_blackout_copy = self.max_blackout
            rtts_copy = list(self.rtts)
            jitter_copy = self.jitter

            tx_attempts_copy = self.tx_attempts
            tx_errors_copy = self.tx_errors

            seq = max(sent_seqs_copy) if sent_seqs_copy else 0

            start_time_copy = self.start_time
            interval_copy = self.interval
            rate_copy = self.rate
            target_copy = self.target
            port_copy = self.port
            label_copy = self.label
            source_port_copy = self.source_port

            meas_start = self.measurement_start_time
            meas_end = self.measurement_end_time

        now = time.time()
        rcvd = len(received_seqs_copy)

        # Calculate outage base carefully. 
        # If sending is stopped, we cap the 'virtual time' at last_send_time + small buffer
        # to avoid counting the idle grace period as an outage.
        outage_base = now
        if not is_running:
            outage_base = last_rcvd_time_copy
        elif not self.sending_active:
            # We add a small buffer (e.g. 2 * interval) to allow for the very last packet to be late
            # without triggering an immediate blackout timer jump
            buffer = max(0.1, interval_copy * 2.0)
            outage_base = min(now, self.last_send_time + buffer)

        outage = (outage_base - last_rcvd_time_copy) * 1000.0

        history = []
        history_start = max(1, seq - 99)
        for s in range(history_start, seq + 1):
            if s in received_seqs_copy:
                history.append(1)
            else:
                threshold = max(0.1, interval_copy * 1.5)
                sent_at = sent_times_copy.get(s, now)
                if now - sent_at > threshold:
                    history.append(0)
                else:
                    history.append(1)

        if len(history) < 100:
            history = [1] * (100 - len(history)) + history

        threshold_ms = max(100.0, interval_copy * 1500.0)
        # Require at least 2 missing packets before considering a gap real.
        # A single seq delta can be caused by a packet still in-flight at the moment
        # of sampling (especially at low RTT / high jitter) without any real loss.
        min_gap = max(2, int(rate_copy * 0.1))  # 10% of rate pps, minimum 2
        has_seq_gap = (seq - rcvd) >= min_gap
        is_blackout = (outage > threshold_ms) and has_seq_gap

        # Persistence: Update the instance variable so we don't lose the peak value
        if is_blackout:
            current_max = max(max_blackout_copy, round(outage))
            if current_max > max_blackout_copy:
                self.max_blackout = current_max
                max_blackout = current_max
            else:
                max_blackout = max_blackout_copy
        else:
            max_blackout = max_blackout_copy

        if not is_running and rcvd >= seq:
            # All packets arrived → any recorded blackout was a transient jitter spike,
            # not a real outage. Reset to 0 so the result isn't misleading.
            max_blackout = 0
            self.max_blackout = 0
            history = [1] * 100

        total_loss_pct = 0.0
        if seq > 0:
            total_loss_pct = round((1.0 - (rcvd / float(seq))) * 100.0, 1)

        duration = round(now - start_time_copy, 1)

        if server_received_copy > 0 and seq > 0:
            # Safeguard: If server says it rcvd less than we rcvd back, the server counter is likely reset/invalid
            if server_received_copy < rcvd:
                tx_lost_packets = 0 
                rx_lost_packets = seq - rcvd
            else:
                tx_lost_packets = max(0, seq - server_received_copy)
                rx_lost_packets = max(0, server_received_copy - rcvd)
            
            tx_loss_pct = round((tx_lost_packets / float(seq)) * 100.0, 1) if seq > 0 else 0.0
            rx_loss_pct = round((rx_lost_packets / float(server_received_copy)) * 100.0, 1) if server_received_copy > 0 else 0.0
        else:
            tx_lost_packets = seq - rcvd
            rx_lost_packets = 0
            tx_loss_pct = total_loss_pct
            rx_loss_pct = 0.0

        tx_loss_ms = round((tx_lost_packets / rate_copy) * 1000) if rate_copy > 0 else 0
        rx_loss_ms = round((rx_lost_packets / rate_copy) * 1000) if rate_copy > 0 else 0

        avg_rtt = round(sum(rtts_copy) / len(rtts_copy), 2) if rtts_copy else 0.0
        current_rtt_ms = round(rtts_copy[-1], 2) if rtts_copy else 0.0
        jitter_ms = round(jitter_copy * 1000.0, 2)

        return {
            "test_id": self.test_id,
            "status": "running" if is_running else "stopped",
            "sent": seq,
            "received": rcvd,
            "server_received": server_received_copy,
            "loss_pct": max(0.0, total_loss_pct),
            "tx_loss_pct": max(0.0, tx_loss_pct),
            "rx_loss_pct": max(0.0, rx_loss_pct),
            "tx_lost_packets": tx_lost_packets,
            "rx_lost_packets": rx_lost_packets,
            "tx_loss_ms": tx_loss_ms,
            "rx_loss_ms": rx_loss_ms,
            "sync_lost": getattr(self, "sync_lost", False),
            "max_blackout_ms": max_blackout,
            "current_blackout_ms": round(outage) if is_blackout else 0,
            "avg_rtt_ms": avg_rtt,
            "current_rtt_ms": current_rtt_ms,
            "jitter_ms": jitter_ms,
            "rate_pps": rate_copy,
            "duration_s": duration,
            "history": history,
            "start_time": start_time_copy,
            "target": target_copy,
            "port": port_copy,
            "label": label_copy,
            "source_port": source_port_copy,
            "measurement_start_time": meas_start,
            "measurement_end_time": meas_end,
            "tx_attempts": tx_attempts_copy,
            "tx_errors": tx_errors_copy,
            "sent_seqs_size": len(sent_seqs_copy),
            "received_seqs_size": len(received_seqs_copy),
        }


def receiver_thread(sock, metrics: ConvergenceMetrics, stop_event):
    sock.settimeout(0.2)
    while not stop_event.is_set():
        try:
            data, addr = sock.recvfrom(2048)
            now = time.time()
            try:
                payload = data.decode("utf-8", errors="ignore")
                parts = payload.split(":")
                if len(parts) >= 4 and parts[0] == "CONV":
                    seq = int(parts[3])
                    server_count = 0
                    for part in parts:
                        if part.startswith("S") and part[1:].isdigit():
                            server_count = int(part[1:])
                            break
                    metrics.record_receive(seq, server_count, now)
            except Exception:
                pass
        except socket.timeout:
            continue
        except Exception:
            break


def stats_writer_thread(metrics: ConvergenceMetrics, stats_file: str, stop_event):
    while not stop_event.is_set():
        stats = metrics.get_stats(is_running=True)
        try:
            with open(stats_file, "w") as f:
                json.dump(stats, f)
        except Exception:
            pass
        time.sleep(0.2)


def debug_writer_thread(metrics: ConvergenceMetrics, log_id: str, stop_event):
    """Écrit les stats toutes les 2 secondes (uniquement si DEBUG_MODE)"""
    if not DEBUG_MODE:
        return
    
    while not stop_event.is_set():
        time.sleep(2.0)
        if stop_event.is_set():
            break
        stats = metrics.get_stats(is_running=True)
        debug_log(
            f"{log_id} SNAPSHOT sent={stats['sent']} rcvd={stats['received']} "
            f"tx_attempts={stats.get('tx_attempts', 0)} tx_errors={stats.get('tx_errors', 0)} "
            f"sent_seqs_size={stats.get('sent_seqs_size', 0)} received_seqs_size={stats.get('received_seqs_size', 0)} "
            f"loss_pct={stats.get('loss_pct', 0)}"
        )


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--target", "-D", required=True)
    parser.add_argument("--port", "-dport", type=int, default=6200)
    parser.add_argument("--rate", "-C", type=int, default=50)
    parser.add_argument("--id", default="CONV-000")
    parser.add_argument("--stats-file", default="/tmp/convergence_stats.json")
    parser.add_argument("--duration", type=int, default=0, help="Test duration in seconds (0=unlimited, after ramp)")
    args = parser.parse_args()

    start_time = time.time()

    test_num = 0
    # Clean ID extraction (remove any extra text like spaces/labels if present)
    id_part = args.id
    if " (" in id_part:
        id_part = id_part.split(" (")[0]
        
    if id_part.startswith("CONV-") and id_part[5:].isdigit():
        try:
            test_num = int(id_part[5:])
        except:
            test_num = 0
            
    # Cyclic mapping: CONV-0000..9999 -> Port 30000..39999
    source_port = 30000 + (test_num % 10000)

    if " (" in args.id:
        real_id = args.id.split(" (")[0]
        label = args.id.split(" (")[1].replace(")", "")
    else:
        real_id = args.id
        label = "Unknown"

    metrics = ConvergenceMetrics(args.rate, args.id, start_time, args.target, args.port, label, source_port)
    stop_event = threading.Event()

    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        sock.bind(("0.0.0.0", source_port))
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF, 4194304)
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_SNDBUF, 4194304)
    except OSError:
        print(f"Warning: Port {source_port} in use, falling back to random port", flush=True)
        debug_log(f"{real_id} WARN port_in_use src_port={source_port}")
        source_port = random.randrange(40000, 60000)
        sock.bind(("0.0.0.0", source_port))
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF, 4194304)
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_SNDBUF, 4194304)

    t_recv = threading.Thread(target=receiver_thread, args=(sock, metrics, stop_event), daemon=True)
    t_recv.start()

    t_stats = threading.Thread(target=stats_writer_thread, args=(metrics, args.stats_file, stop_event), daemon=True)
    t_stats.start()

    t_debug = threading.Thread(target=debug_writer_thread, args=(metrics, real_id, stop_event), daemon=True)
    t_debug.start()

    log_id = real_id
    timestamp = time.strftime("%H:%M:%S")
    
    duration_str = f"{args.duration}s" if args.duration > 0 else "unlimited"
    print(f"[{log_id}] [{timestamp}] 🚀 {label} - CONVERGENCE STARTED: {args.target}:{args.port} | Rate: {args.rate}pps | Duration: {duration_str}", flush=True)
    debug_log(f"{log_id} START label={label} target={args.target}:{args.port} rate={args.rate}pps duration={args.duration}s src_port={source_port}")
    
    if DEBUG_MODE:
        print(f"[{log_id}] [{timestamp}] ⚙️ {label} - DEBUG MODE ACTIVE | Source Port: {source_port}", flush=True)

    seq = 0

    target_rate = float(args.rate)
    ramp_duration_s = 5.0
    ramp_start = start_time
    next_send = time.time()

    metrics.measurement_start_time = ramp_start + ramp_duration_s
    
    test_duration_s = float(args.duration)
    test_end_time = None
    if test_duration_s > 0:
        test_end_time = ramp_start + ramp_duration_s + test_duration_s

    try:
        while not stop_event.is_set() and not graceful_shutdown.is_set():
            now = time.time()
            elapsed = now - ramp_start

            # Check graceful shutdown AVANT timeout
            if graceful_shutdown.is_set():
                print(f"[{log_id}] Graceful shutdown requested via signal", flush=True)
                debug_log(f"{log_id} GRACEFUL_SHUTDOWN_SIGNAL")
                break

            # Check timeout uniquement si duration > 0
            if test_end_time is not None and now >= test_end_time:
                debug_log(f"{log_id} TIMEOUT_REACHED test_duration={test_duration_s}s total_elapsed={elapsed:.1f}s")
                break

            # Rampe 0 -> target_rate en 5 secondes
            if elapsed < ramp_duration_s:
                factor = elapsed / ramp_duration_s
                current_rate = max(10.0, target_rate * factor)
            else:
                current_rate = target_rate

            interval = 1.0 / current_rate

            seq += 1
            payload = f"CONV:{log_id}:{label}:{seq}:{now}".encode("utf-8")

            metrics.record_send(seq, now)
            metrics.record_send_attempt()
            try:
                sock.sendto(payload, (args.target, args.port))
            except Exception as e:
                metrics.record_send_error()
                print(f"Send error: {e}", flush=True)
                debug_log(f"{log_id} SEND_ERROR seq={seq} err={e}")
                metrics.mark_send_failed(seq)
                break

            if DEBUG_MODE and seq % 10000 == 0:
                print(f"[{log_id}] DEBUG TX seq={seq}", flush=True)

            next_send += interval
            sleep_time = next_send - time.time()
            if sleep_time > 0:
                time.sleep(sleep_time)
            elif abs(sleep_time) > 0.5:
                next_send = time.time()
        
        # Mark sending as inactive as soon as the loop completes
        metrics.sending_active = False

    except KeyboardInterrupt:
        print(f"\n[{log_id}] KeyboardInterrupt received", flush=True)
        debug_log(f"{log_id} KEYBOARD_INTERRUPT")
        pass
    finally:
        # ===== GRACE PERIOD CRITIQUE =====
        running_stats = metrics.get_stats(is_running=True)
        avg_rtt_ms = running_stats.get("avg_rtt_ms", 0) or 20.0
        
        if args.rate >= 1000:
            grace_ms = max(3000.0, min(7000.0, avg_rtt_ms * 20.0))
        else:
            grace_ms = max(2000.0, min(5000.0, avg_rtt_ms * 15.0))
        
        print(f"[{log_id}] ⏳ Grace period: {grace_ms:.0f}ms (RTT={avg_rtt_ms:.1f}ms)...", flush=True)
        debug_log(f"{log_id} GRACE_START avg_rtt_ms={avg_rtt_ms} grace_ms={grace_ms} threads_active=True")
        
        time.sleep(grace_ms / 1000.0)
        
        print(f"[{log_id}] 🛑 Stopping receiver threads...", flush=True)
        debug_log(f"{log_id} STOPPING_THREADS")
        stop_event.set()
        time.sleep(0.3)

        print(f"[{log_id}] ⏳ Final RX check...", flush=True)
        last_rcvd = running_stats["received"]
        stable_count = 0
        wait_start = time.time()
        
        while time.time() - wait_start < 1.0:
            time.sleep(0.1)
            stats_now = metrics.get_stats(is_running=False)
            current_rcvd = stats_now["received"]
            
            if current_rcvd > last_rcvd:
                last_rcvd = current_rcvd
                stable_count = 0
                debug_log(f"{log_id} GRACE_RX_PROGRESS rcvd={current_rcvd}")
            else:
                stable_count += 1
            
            if stable_count >= 3:
                debug_log(f"{log_id} GRACE_RX_STABLE rcvd={current_rcvd} stable_ms=300")
                break
        
        stabilization_time = round((time.time() - wait_start) * 1000)
        total_grace_time = grace_ms + stabilization_time
        print(f"[{log_id}] ✓ Capture complete (grace: {total_grace_time:.0f}ms, rcvd={last_rcvd})", flush=True)
        debug_log(f"{log_id} GRACE_END total_grace_ms={total_grace_time} final_rcvd={last_rcvd}")

        metrics.measurement_end_time = time.time()

        final_stats = metrics.get_stats(is_running=False)
        try:
            with open(args.stats_file, "w") as f:
                json.dump(final_stats, f)
        except Exception as e:
            debug_log(f"{log_id} STATS_WRITE_ERROR err={e}")

        rcvd = final_stats["received"]
        tx_sent = final_stats["sent"]
        tx_lost = tx_sent - rcvd
        duration = final_stats["duration_s"]

        with metrics.lock:
            missed = sorted(list(metrics.sent_seqs - metrics.received_seqs))
        if not missed:
            missed_str = "None"
        elif len(missed) > 50:
            first_part = missed[:25]
            last_part = missed[-25:]
            missed_str = f"[{', '.join(map(str, first_part))} ... {', '.join(map(str, last_part))}] (Total: {len(missed)})"
        else:
            missed_str = f"[{', '.join(map(str, missed))}]"

        timestamp = time.strftime("%H:%M:%S")
        print(f"[{log_id}] ⏹️ [{timestamp}] {label} - CONVERGENCE STOPPED:", flush=True)
        print(f"[{log_id}] - Duration: {duration}s | PPS: {args.rate}", flush=True)
        print(f"[{log_id}] - Sent: {tx_sent} | Received: {rcvd} | Loss: {final_stats['loss_pct']}%", flush=True)
        print(f"[{log_id}] - TX Lost: {final_stats['tx_lost_packets']} packets (~{final_stats['tx_loss_ms']}ms)", flush=True)
        print(f"[{log_id}] - RX Lost: {final_stats['rx_lost_packets']} packets (~{final_stats['rx_loss_ms']}ms)", flush=True)
        print(f"[{log_id}] - Max Blackout: {final_stats['max_blackout_ms']}ms", flush=True)
        print(f"[{log_id}] - Missed Seqs: {missed_str}", flush=True)
        sys.stdout.flush()

        debug_log(
            f"{log_id} FINAL sent={tx_sent} rcvd={rcvd} tx_attempts={final_stats['tx_attempts']} "
            f"tx_errors={final_stats['tx_errors']} sent_seqs_size={final_stats['sent_seqs_size']} "
            f"received_seqs_size={final_stats['received_seqs_size']} max_blackout_ms={final_stats['max_blackout_ms']}"
        )

        sock.close()
        t_recv.join(0.5)
        t_stats.join(0.5)
        t_debug.join(0.5)


