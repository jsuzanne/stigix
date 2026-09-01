import json
import os
import time
import subprocess
import random
import signal
import sys
from datetime import datetime

# Configuration paths (aligned with Docker volumes)
CONFIG_DIR = os.getenv('CONFIG_DIR', '/app/config')
LOG_DIR = os.getenv('LOG_DIR', '/var/log/sdwan-traffic-gen')
VERSION_FILE = '/app/VERSION'  # Optional
DEBUG_MODE = os.getenv('DEBUG', 'false').lower() == 'true'

SYSTEM_SETTINGS_FILE = os.path.join(CONFIG_DIR, 'system-settings.json')

# Watchdog: how long after theoretical call duration before force-killing rtp.py
WATCHDOG_GRACE_PERIOD_S = 15

def get_auto_restart_voice() -> bool:
    """Read system-settings.json to decide if voice should resume on startup.
    Returns False (safe default) if the file is absent or the flag is not set."""
    try:
        if os.path.exists(SYSTEM_SETTINGS_FILE):
            with open(SYSTEM_SETTINGS_FILE, 'r') as f:
                return bool(json.load(f).get('auto_restart_voice', False))
    except Exception:
        pass
    return False

def get_version():
    try:
        if os.path.exists(VERSION_FILE):
            with open(VERSION_FILE, 'r') as f:
                return f.read().strip()
    except: pass
    return "1.1.0-patch.47"

VOICE_CONFIG_FILE = os.path.join(CONFIG_DIR, 'voice-config.json')
STATS_FILE = os.path.join(LOG_DIR, 'voice-stats.jsonl')
active_calls = []
current_session_id = str(int(time.time()))
def get_next_call_id():
    config = load_voice_config()
    state = config.get('state', {})
    counter = state.get('counter', 0)
    
    # Implementation of cyclic counter (0-9999) for deterministic port mapping
    counter = (counter + 1) % 10000
    
    # Update state and save back to config
    state['counter'] = counter
    config['state'] = state
    
    try:
        with open(VOICE_CONFIG_FILE, 'w') as f:
            json.dump(config, f, indent=2)
    except Exception as e:
        if DEBUG_MODE: print(f"⚠️ Failed to save counter: {e}")
    
    return f"CALL-{counter:04d}"

def print_banner():
    version = get_version()
    print("="*60)
    print(f"🚀 SD-WAN VOICE ORCHESTRATOR {version}")
    print(f"📂 Config: {CONFIG_DIR}")
    print(f"📝 Logs: {STATS_FILE}")
    print("="*60)
    sys.stdout.flush()

def load_voice_config():
    if os.path.exists(VOICE_CONFIG_FILE):
        try:
            with open(VOICE_CONFIG_FILE, 'r') as f:
                return json.load(f)
        except: pass
    return {}

def load_control():
    # Primary interface discovery
    default_iface = 'eth0'
    try:
        iface_file = os.path.join(CONFIG_DIR, 'interfaces.txt')
        if os.path.exists(iface_file):
            with open(iface_file, 'r') as f:
                content = f.read().strip()
                if content and not content.startswith('#'):
                    default_iface = content.split('\n')[0].strip()
                    if DEBUG_MODE: 
                        timestamp = time.strftime('%H:%M:%S')
                        print(f"[{timestamp}] 📡 [VOICE] System Interface: {default_iface} (Source: interfaces.txt)")
        
        # Smart auto-detection fallback if interfaces.txt is empty or missing
        if default_iface == 'eth0':
            try:
                import subprocess
                cmd = "ip route | grep '^default' | awk '{print $5}' | head -n 1"
                output = subprocess.check_output(cmd, shell=True, text=True).strip()
                if output:
                    default_iface = output
                    if DEBUG_MODE: 
                        timestamp = time.strftime('%H:%M:%S')
                        print(f"[{timestamp}] 📡 Auto-detected default interface: {default_iface}")
            except: pass
    except: pass

    config = load_voice_config()
    data = config.get('control', {})
    
    # If explicitly set to eth0 but we found something else in interfaces.txt, prioritize interfaces.txt
    if data.get('interface') == 'eth0' and default_iface != 'eth0':
        data['interface'] = default_iface
    
    # Defaults
    if 'enabled' not in data: data['enabled'] = False
    if 'max_simultaneous_calls' not in data: data['max_simultaneous_calls'] = 3
    if 'sleep_between_calls' not in data: data['sleep_between_calls'] = 5
    if 'interface' not in data: data['interface'] = default_iface
    if 'source_port_mode' not in data: data['source_port_mode'] = 'call_id'
    
    return data

def load_servers():
    config = load_voice_config()
    return config.get('servers', [])

def calculate_mos(latency_ms, jitter_ms, loss_pct):
    """
    Simplified E-model (ITU-T G.107) for R-factor and MOS.
    R = 94.2 - Id - Ie
    Id: Delay impairment
    Ie: Equipment impairment (loss/jitter)
    """
    # 1. Effective latency calculation (including jitter buffer approximation)
    effective_latency = latency_ms + (jitter_ms * 2) + 10
    
    # 2. Delay Impairment (Id)
    if effective_latency <= 160:
        id_impairment = effective_latency / 40
    else:
        id_impairment = (effective_latency - 120) / 10
        
    # 3. Equipment Impairment (Ie) - Loss
    # For G.711 (PLC), loss impact is high
    ie_impairment = loss_pct * 2.5
    
    # 4. Final R-factor
    r_factor = 94.2 - id_impairment - ie_impairment
    
    # Clamp R-factor
    r_factor = max(0, min(94.2, r_factor))
    
    # 5. MOS Calculation
    if r_factor < 0: return 1.0
    mos = 1 + (0.035 * r_factor) + (0.000007 * r_factor * (r_factor - 60) * (100 - r_factor))
    
    return round(max(1.0, min(4.4, mos)), 2)

def log_call(event, call_info):
    try:
        # Calculate MOS if it's an end event with QoS data
        if event == "end" and "loss_pct" in call_info:
            mos = calculate_mos(
                call_info.get("avg_rtt_ms", 0),
                call_info.get("jitter_ms", 0),
                call_info.get("loss_pct", 0)
            )
            call_info["mos_score"] = mos

        log_entry = {
            "timestamp": datetime.now().isoformat(),
            "event": event,
            "session_id": current_session_id,
            **call_info
        }
        with open(STATS_FILE, 'a') as f:
            f.write(json.dumps(log_entry) + '\n')
            f.flush()
    except Exception as e:
        print(f"Error logging call: {e}")

def pick_server(servers):
    if not servers:
        return None
    total_weight = sum(s['weight'] for s in servers)
    r = random.uniform(0, total_weight)
    upto = 0
    for s in servers:
        if upto + s['weight'] >= r:
            return s
        upto += s['weight']
    return servers[0]

def check_reachability(ip):
    try:
        # Quick ping check (1 packet, 1 second timeout)
        subprocess.check_output(["ping", "-c", "1", "-W", "1", ip], stderr=subprocess.STDOUT)
        return True
    except subprocess.CalledProcessError:
        return False

def start_call(server, interface):
    call_id = get_next_call_id()
    host, port = server['target'].split(':')
    
    # Pre-flight check: is the target reachable?
    if not check_reachability(host):
        timestamp = time.strftime('%H:%M:%S')
        print(f"[{timestamp}] [{call_id}] ⚠️  Target {host} is unreachable. Skipping call.")
        sys.stdout.flush()
        log_call("skipped", {
            "call_id": call_id,
            "target": server['target'],
            "codec": server['codec'],
            "duration": server['duration'],
            "error": "Destination unreachable"
        })
        return None

    # Packet count: rtp.py sends one packet every 30ms (reverted from 20ms / G.711)
    num_packets = int(server['duration'] / 0.03)
    stream_type = server.get('stream_type', 'audio')
    control = load_control()
    source_port_mode = control.get('source_port_mode', 'call_id')
    site_name = os.environ.get('SITE_NAME') or os.environ.get('NODE_NAME', '')
    if not site_name:
        try:
            import socket
            h = socket.gethostname()
            if h and h != 'localhost':
                site_name = h
        except Exception:
            pass

    cmd = [
        "python3", "rtp.py",
        "-D", host,
        "-dport", port,
        "--min-count", str(num_packets),
        "--max-count", str(num_packets + 1),
        "--source-interface", interface,
        "--source-port-mode", source_port_mode,
        "--call-id", call_id,
        "--stream-type", stream_type
    ]
    if site_name:
        cmd.extend(["--site-name", site_name])
    
    timestamp = time.strftime('%H:%M:%S')
    print(f"[{timestamp}] [{call_id}] 🚀 Executing: {' '.join(cmd)}")
    sys.stdout.flush()
    
    try:
        env = os.environ.copy()
        env["PYTHONUNBUFFERED"] = "1"
        # Capture stdout for QoS data, let stderr pass through to console for debug logs
        proc = subprocess.Popen(cmd, env=env, stdout=subprocess.PIPE)
        # theoretical_duration_s: how long rtp.py should run at most.
        # rtp.py sends one packet every 30ms → (num_packets+1) × 30ms.
        # We add WATCHDOG_GRACE_PERIOD_S on top before force-killing.
        theoretical_duration_s = (num_packets + 1) * 0.030
        call_info = {
            "call_id": call_id,
            "pid": proc.pid,
            "target": server['target'],
            "codec": server['codec'],
            "duration": server['duration'],
            "start_time": time.time(),                  # wall-clock epoch for watchdog
            "theoretical_duration_s": theoretical_duration_s,
        }
        timestamp = time.strftime('%H:%M:%S')
        log_call("start", call_info)
        print(f"[{timestamp}] [{call_id}] 📞 CALL STARTED: {server['target']} | {server['codec']} | {server['duration']}s", flush=True)
        return {"proc": proc, "info": call_info}
    except Exception as e:
        print(f"Failed to start rtp.py: {e}")
        return None

def watchdog_kill_stale(calls: list, grace_period_s: int = WATCHDOG_GRACE_PERIOD_S) -> None:
    """Kill any rtp.py process that overran its theoretical duration + grace_period.
    Sends SIGTERM first, then SIGKILL after 3s if still alive.
    Removes stale entries from `calls` in-place."""
    global active_calls
    now = time.time()
    stale = []
    for call in list(calls):
        if call['proc'].poll() is not None:
            continue  # already exited — normal cleanup handles it
        elapsed = now - call['info'].get('start_time', now)
        deadline = call['info'].get('theoretical_duration_s', 0) + grace_period_s
        if elapsed > deadline:
            call_id = call['info']['call_id']
            pid     = call['proc'].pid
            ts      = time.strftime('%H:%M:%S')
            print(f"[{ts}] [WATCHDOG] {call_id} killed after {int(elapsed)}s "
                  f"(deadline={int(deadline)}s, PID={pid})", flush=True)
            try:
                call['proc'].send_signal(signal.SIGTERM)
                time.sleep(3)
                if call['proc'].poll() is None:
                    print(f"[{time.strftime('%H:%M:%S')}] [WATCHDOG] {call_id} "
                          f"SIGTERM ignored — sending SIGKILL (PID {pid})", flush=True)
                    call['proc'].kill()
            except Exception as e:
                print(f"[{time.strftime('%H:%M:%S')}] [WATCHDOG] kill {call_id} failed: {e}",
                      flush=True)
            log_call("end", {**call['info'],
                             "error": f"watchdog_timeout:{int(elapsed)}s"})
            stale.append(call)
    for call in stale:
        active_calls.remove(call)


def signal_handler(sig, frame):
    print("Shutting down voice orchestrator...")
    for call in active_calls:
        try:
            call['proc'].terminate()
        except:
            pass
    sys.exit(0)

signal.signal(signal.SIGINT, signal_handler)
signal.signal(signal.SIGTERM, signal_handler)

def main():
    print_banner()
    global active_calls
    
    # CLEAN SLATE : Reset everything on startup
    print("🧹 Cleaning slate for new session...")
    try:
        # 1. Reset Counter in unified config
        config = load_voice_config()
        if 'state' not in config: config['state'] = {}
        config['state']['counter'] = 0
        with open(VOICE_CONFIG_FILE, 'w') as f:
            json.dump(config, f, indent=2)
        # 2. Disable simulation by default — UNLESS auto_restart_voice is enabled
        try:
            if not get_auto_restart_voice():
                config = load_voice_config()
                if 'control' in config:
                    config['control']['enabled'] = False
                    with open(VOICE_CONFIG_FILE, 'w') as f:
                        json.dump(config, f, indent=2)
            else:
                enabled_now = load_voice_config().get('control', {}).get('enabled', False)
                print(f"🔄 Auto-restart VOICE enabled — resuming previous state (enabled={enabled_now})")
        except Exception as e:
            print(f"Warning during config reset: {e}")

        # 3. Clear logs to stay perfectly synchronized with the UI
        try:
            with open(STATS_FILE, 'w') as f:
                f.write("")
        except Exception as e:
            print(f"Warning during log clearing: {e}")
    except Exception as e:
        print(f"Warning during startup cleanup: {e}")
    sys.stdout.flush()

    # Log session start
    log_call("session_start", {"version": get_version()})
    
    last_wait_log_time = 0
    
    while True:
        control = load_control()
        servers = load_servers()
        
        # Clean up finished calls
        finished = []
        for call in active_calls:
            if call['proc'].poll() is not None:
                # Capture QoS metrics from stdout
                stdout, _ = call['proc'].communicate()
                qos_data = {}
                if stdout:
                    for line in stdout.decode().split('\n'):
                        if line.startswith("RESULT:"):
                            try:
                                qos_data = json.loads(line.replace("RESULT:", "").strip())
                            except: pass
                
                # Merge QoS data into info for logging
                final_info = {**call['info'], **qos_data}
                log_call("end", final_info)
                finished.append(call)
        
        for call in finished:
            timestamp = time.strftime('%H:%M:%S')
            print(f"[{timestamp}] [{call['info']['call_id']}] ✅ CALL ENDED: {call['info']['target']}")
            sys.stdout.flush()
            active_calls.remove(call)
            
        if control.get("enabled"):
            max_calls = control.get("max_simultaneous_calls", 3)

            # ── Watchdog pass: kill stale processes, free slots ────────────────
            watchdog_kill_stale(active_calls)

            # ── Hard limit: count only OS-alive processes ──────────────────────
            alive_count = sum(1 for c in active_calls if c['proc'].poll() is None)

            if alive_count < max_calls:
                server = pick_server(servers)
                if server:
                    new_call = start_call(server, control.get("interface", "eth0"))
                    if new_call:
                        active_calls.append(new_call)
            else:
                current_time = time.time()
                if current_time - last_wait_log_time > 60:  # Cooldown of 60 seconds
                    if DEBUG_MODE:
                        timestamp = time.strftime('%H:%M:%S')
                        print(f"[{timestamp}] ℹ️  Wait: Max simultaneous calls reached "
                              f"({alive_count}/{max_calls})")
                    sys.stdout.flush()
                    last_wait_log_time = current_time
        else:
            if len(active_calls) > 0:
                 print(f"⏳ Simulation disabled. Waiting for {len(active_calls)} calls to finish...")
        
        # Determine check interval
        sleep_time = max(1, control.get("sleep_between_calls", 5)) if control.get("enabled") else 5
        time.sleep(sleep_time)

if __name__ == "__main__":
    main()
