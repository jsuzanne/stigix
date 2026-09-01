#!/usr/bin/env python3
import argparse
import os
import time
import threading
from socket import *

DEBUG_MODE = os.getenv('DEBUG', 'false').lower() == 'true'

# UDP Echo Server - Optimized for Docker & Multi-port
# BUFSIZE: must be >= max(RTP_header + payload) = 12 + 1300 (video) = 1312 → use 2048
BUFSIZE = 2048

def get_version():
    try:
        if os.path.exists('/app/VERSION'):
            with open('/app/VERSION', 'r') as f:
                return f.read().strip()
    except: pass
    return "1.1.0-patch.100"

def handle_port(ip, port, active_sessions, lock):
    s = socket(AF_INET, SOCK_DGRAM)
    s.settimeout(1.0)
    try:
        s.bind((ip, port))
        timestamp = time.strftime('%H:%M:%S')
        print(f"[{timestamp}] [SYSTEM] 📡 Listening on PORT {port}...")
        while True:
            try:
                data, addr = s.recvfrom(BUFSIZE)
                now = time.time()
                
                # Extract IDs
                detected_id = "Unknown"
                detected_label = "Unknown"
                session_type = "Voice"
                try:
                    payload_str = data.decode('utf-8', errors='ignore')
                    if "CID:" in payload_str:
                        detected_id = payload_str.split("CID:")[1].split(":")[0]
                        detected_label = ""
                    elif "CONV:" in payload_str:
                        # Format: CONV:TEST-ID:LABEL:SEQ:TS
                        parts = payload_str.split(':')
                        if len(parts) >= 3:
                            detected_id = parts[1]
                            detected_label = parts[2]
                            session_type = "Convergence"
                    elif "TEST-" in payload_str:
                        detected_id = payload_str.split(":")[0]
                        detected_label = ""
                        session_type = "Convergence"
                except: pass

                with lock:
                    # Use Test ID as key for Convergence to handle IP/Port change during failover
                    # Use (addr, port) for standard Voice calls
                    session_key = detected_id if session_type == "Convergence" and detected_id != "Unknown" else addr
                    
                    if session_key not in active_sessions:
                        log_id = detected_id
                        prefix = "CONV" if session_type == "Convergence" else "CALL"
                        if not (log_id.startswith("CONV-") or log_id.startswith("CALL-")):
                            log_id = f"{prefix}-{log_id}"
                        
                        timestamp = time.strftime('%H:%M:%S')
                        label_str = f" {detected_label} -" if detected_label else ""
                        print(f"[{timestamp}] [{log_id}] 📥{label_str} RECEIVED ON PORT {port}: {addr[0]}:{addr[1]}", flush=True)
                    
                    session = active_sessions.get(session_key, {"packet_count": 0, "start_time": now, "port": port})
                    session["last_seen"] = now
                    session["id"] = detected_id
                    session["label"] = detected_label
                    session["type"] = session_type
                    session["packet_count"] += 1
                    session["last_addr"] = addr # Track last seen address for maintenance logging
                    active_sessions[session_key] = session

                # Echo back
                if session_type == "Convergence":
                    try:
                        # Append :S<count> for RX/TX loss calculation
                        echo_payload = data + f":S{session['packet_count']}".encode('utf-8')
                        s.sendto(echo_payload, addr)
                    except:
                        s.sendto(data, addr)
                else:
                    s.sendto(data, addr)
                    
            except timeout:
                pass
    except Exception as e:
        print(f"Error on port {port}: {e}")
    finally:
        s.close()

INGRESS_FILE = "/tmp/ingress-voice-sessions.json"
completed_ingress_history = []

def export_ingress_sessions(active_sessions, lock):
    global completed_ingress_history
    try:
        now = time.time()
        sessions_map = {}
        
        for item in completed_ingress_history:
            key = f"{item['id']}-{item['src_ip']}-{item['start_time']}"
            sessions_map[key] = item

        with lock:
            for key, session in active_sessions.items():
                last_seen_diff = now - session.get('last_seen', now)
                status = "active" if last_seen_diff <= 5.0 else "completed"
                addr_info = session.get('last_addr', ('Unknown', 0))
                id_val = session.get('id', 'Unknown')
                
                item = {
                    "id": id_val,
                    "type": session.get('type', 'Voice'),
                    "label": session.get('label', ''),
                    "src_ip": addr_info[0],
                    "src_port": addr_info[1],
                    "dest_port": session.get('port', 6100),
                    "packet_count": session.get('packet_count', 0),
                    "start_time": session.get('start_time', now),
                    "last_seen": session.get('last_seen', now),
                    "duration": int(now - session.get('start_time', now)),
                    "status": status
                }
                m_key = f"{id_val}-{addr_info[0]}-{session.get('start_time', now)}"
                sessions_map[m_key] = item

        sessions_list = list(sessions_map.values())
        sessions_list.sort(key=lambda x: x['start_time'], reverse=True)
        sessions_list = sessions_list[:100]
        
        temp_file = INGRESS_FILE + ".tmp"
        with open(temp_file, 'w') as f:
            json.dump(sessions_list, f, indent=2)
        os.replace(temp_file, INGRESS_FILE)
    except Exception as e:
        if DEBUG_MODE: print(f"Error exporting ingress sessions: {e}")

def maintenance(active_sessions, lock):
    while True:
        time.sleep(1)
        export_ingress_sessions(active_sessions, lock)
        now = time.time()
        to_remove = []
        with lock:
            for key, session in active_sessions.items():
                if now - session['last_seen'] > 60.0:
                    id_val = session.get('id', 'Unknown')
                    prefix = "CONV" if session.get("type") == "Convergence" else "CALL"
                    if not (id_val.startswith("CONV-") or id_val.startswith("CALL-")):
                        id_val = f"{prefix}-{id_val}"
                    
                    timestamp = time.strftime('%H:%M:%S')
                    duration = int(now - session['start_time'] - 60.0)
                    label_str = f" {session.get('label', '')} -" if session.get('label') else ""
                    addr_info = f"{session['last_addr'][0]}:{session['last_addr'][1]}" if "last_addr" in session else "Unknown"
                    print(f"[{timestamp}] [{id_val}] ✅{label_str} COMPLETED ON PORT {session['port']}: {addr_info} | Duration: {duration}s | Packets: {session['packet_count']}", flush=True)
                    to_remove.append(key)
            
            for key in to_remove:
                session = active_sessions[key]
                addr_info = session.get('last_addr', ('Unknown', 0))
                completed_ingress_history.append({
                    "id": session.get('id', 'Unknown'),
                    "type": session.get('type', 'Voice'),
                    "label": session.get('label', ''),
                    "src_ip": addr_info[0],
                    "src_port": addr_info[1],
                    "dest_port": session.get('port', 6100),
                    "packet_count": session.get('packet_count', 0),
                    "start_time": session.get('start_time', now),
                    "last_seen": session.get('last_seen', now),
                    "duration": int(now - session['start_time']),
                    "status": "completed"
                })
                if len(completed_ingress_history) > 100:
                    completed_ingress_history.pop(0)
                del active_sessions[key]

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--ip", help="IP to listen on", default="0.0.0.0")
    parser.add_argument("--ports", help="Comma-separated ports (Default: 6100,6200)", default="6100,6200")
    args = parser.parse_args()

    version = get_version()
    port_list = [int(p.strip()) for p in args.ports.split(',')]
    active_sessions = {}
    lock = threading.Lock()

    print("="*60)
    print(f"🚀 SD-WAN VOICE ECHO SERVER {version}")
    print(f"📡 Multi-port mode: {port_list}")
    print("="*60)

    m_thread = threading.Thread(target=maintenance, args=(active_sessions, lock))
    m_thread.daemon = True
    m_thread.start()

    for p in port_list:
        t = threading.Thread(target=handle_port, args=(args.ip, p, active_sessions, lock))
        t.daemon = True
        t.start()

    maintenance(active_sessions, lock)
