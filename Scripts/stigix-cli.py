#!/usr/bin/env python3
"""
stigix-cli — Interactive local CLI for Stigix
Installed alongside Stigix, talks directly to the local backend on localhost:8080

Usage:
  stigix-cli                              # Interactive REPL
  stigix-cli --url http://10.0.0.5:8080   # Connect to remote
  stigix-cli --exec "security suite"      # Run single command headless
  stigix-cli --script cmds.txt            # Run a list of commands
"""

try:
    import os
    import sys
    import json
    import time
    import threading
    import getpass
    import argparse
    from datetime import datetime
    from pathlib import Path

    try:
        import requests
    except ImportError:
        print("Missing dependency: pip install requests prompt_toolkit")
        sys.exit(1)

    try:
        from prompt_toolkit import PromptSession
        from prompt_toolkit.completion import Completer, Completion, NestedCompleter
        from prompt_toolkit.auto_suggest import AutoSuggestFromHistory
        from prompt_toolkit.styles import Style
        from prompt_toolkit.formatted_text import HTML
        from prompt_toolkit.key_binding import KeyBindings
        from prompt_toolkit.document import Document
        from prompt_toolkit.history import FileHistory
        HAS_PROMPT_TOOLKIT = True
    except ImportError:
        HAS_PROMPT_TOOLKIT = False
        print("[warn] prompt_toolkit not found — pip install prompt_toolkit for best experience")
except KeyboardInterrupt:
    print("\nInterrupted.")
    try:
        import sys
        sys.exit(0)
    except Exception:
        import os
        os._exit(0)

# ─── Config ───────────────────────────────────────────────────────────────────

CONFIG_FILE  = Path.home() / ".stigix-cli.json"
HISTORY_FILE = Path.home() / ".stigix-cli.history"
DEFAULT_URL  = os.environ.get("STIGIX_URL", "http://localhost:8080")

JWT_TOKEN    = None
STIGIX_URL   = DEFAULT_URL
PROFILES     = {}          # {name: {"url": ..., "token": ...}}
INSTANCE_TOKENS = {}       # {url: token}
HTTP_SESSION = requests.Session()
AUTOCOMPLETE_ENABLED = True
SESSION_HISTORY = []

VERSION      = "1.4.0-patch.57"
try:
    version_file = Path("/app/VERSION")
    if version_file.exists():
        VERSION = version_file.read_text().strip()
    else:
        # Check relative to script (root of the repo)
        rel_version = Path(__file__).parent.parent / "VERSION"
        if rel_version.exists():
            VERSION = rel_version.read_text().strip()
except Exception:
    pass

TIMEOUT      = 10

# ─── Session persistence ──────────────────────────────────────────────────────

def load_session():
    """Load saved token, URL and profiles from ~/.stigix-cli.json"""
    global JWT_TOKEN, STIGIX_URL, PROFILES, INSTANCE_TOKENS, AUTOCOMPLETE_ENABLED
    if CONFIG_FILE.exists():
        try:
            data = json.loads(CONFIG_FILE.read_text())
            PROFILES = data.get("profiles", {})
            INSTANCE_TOKENS = data.get("instance_tokens", {})
            AUTOCOMPLETE_ENABLED = data.get("autocomplete", True)
            
            saved_url = data.get("url")
            if saved_url and STIGIX_URL == DEFAULT_URL:
                STIGIX_URL = saved_url
                
            # Restore token specific to current STIGIX_URL, or fall back to legacy 'token'
            if STIGIX_URL in INSTANCE_TOKENS:
                JWT_TOKEN = INSTANCE_TOKENS[STIGIX_URL]
            elif STIGIX_URL == saved_url or not saved_url:
                JWT_TOKEN = data.get("token")
            else:
                # Check if any profile matches the current STIGIX_URL and has a token
                for name, prof in PROFILES.items():
                    if prof.get("url") == STIGIX_URL and prof.get("token"):
                        JWT_TOKEN = prof.get("token")
                        break
                else:
                    JWT_TOKEN = None
        except Exception:
            pass

def save_session():
    """Persist token, URL and profiles to ~/.stigix-cli.json (chmod 600)"""
    global JWT_TOKEN, STIGIX_URL, PROFILES, INSTANCE_TOKENS, AUTOCOMPLETE_ENABLED
    try:
        if STIGIX_URL:
            if JWT_TOKEN:
                INSTANCE_TOKENS[STIGIX_URL] = JWT_TOKEN
            else:
                INSTANCE_TOKENS.pop(STIGIX_URL, None)
                
        # Sync profile tokens
        for name, prof in PROFILES.items():
            prof_url = prof.get("url")
            if prof_url == STIGIX_URL:
                prof["token"] = JWT_TOKEN
            elif prof_url in INSTANCE_TOKENS:
                prof["token"] = INSTANCE_TOKENS[prof_url]

        CONFIG_FILE.write_text(json.dumps(
            {
                "token": JWT_TOKEN, 
                "url": STIGIX_URL, 
                "profiles": PROFILES,
                "instance_tokens": INSTANCE_TOKENS,
                "autocomplete": AUTOCOMPLETE_ENABLED
            }, indent=2
        ))
        CONFIG_FILE.chmod(0o600)
    except Exception:
        pass

def read_json_file(filepath):
    """
    Reads a JSON file. Supports '-' to read from stdin.
    If running in a Docker container and a relative path is not found in the current directory,
    tries falling back to the mounted config/ directory.
    """
    if filepath == "-":
        try:
            return json.loads(sys.stdin.read())
        except Exception as e:
            err(f"Failed to read/parse from stdin: {e}")
            return None

    path = Path(filepath)
    
    # Check if the file exists in current working directory
    if path.exists():
        target_path = path
    else:
        # Fallback 1: check inside config/
        fallback_rel = Path("config") / path.name
        # Fallback 2: check inside /app/config/
        fallback_app = Path("/app/config") / path.name
        
        if fallback_rel.exists():
            target_path = fallback_rel
        elif fallback_app.exists():
            target_path = fallback_app
        else:
            target_path = path

    if not target_path.exists():
        err(f"File not found: '{filepath}'")
        # Check if we are likely in a Docker container
        is_docker = Path("/.dockerenv").exists() or Path("/app/config").exists()
        if is_docker:
            info("Note: Since stigix-cli is running inside a Docker container, it cannot access files on your host directly.")
            info("To import a host file, you can:")
            info(f"  1. Place the file in the './config' folder on the host, and import it as 'config/{path.name}'")
            info("  2. Pipe the file from your host terminal using stdin:")
            info(f"     docker exec -i stigix stigix-cli --exec \"... import -\" < {path.name}")
        return None

    try:
        with open(target_path, "r") as f:
            return json.load(f)
    except Exception as e:
        err(f"Failed to read/parse file: {e}")
        return None

def write_json_file(filepath, data):
    """
    Writes data to a JSON file.
    If the path is relative and we are running in a Docker container,
    automatically resolves it to the mounted config/ directory (which maps to the host's config/ folder),
    so that the exported file is visible outside the container.
    """
    path = Path(filepath)
    if not path.is_absolute():
        # Check if config directory exists and is writable
        config_dirs = [Path("config"), Path("/app/config")]
        for cdir in config_dirs:
            if cdir.exists() and os.access(cdir, os.W_OK):
                path = cdir / path.name
                break

    try:
        # Ensure parent directory exists
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "w") as f:
            json.dump(data, f, indent=2)
        ok(f"Exported configuration to {path}")
        # If it was resolved to config/ let the user know where it is on the host
        if not Path(filepath).is_absolute() and path.parent.name == "config":
            info(f"  (This corresponds to './config/{path.name}' on your host filesystem)")
        return True
    except Exception as e:
        err(f"Failed to write file: {e}")
        return False

# ─── Colors / output helpers ──────────────────────────────────────────────────

def c(code, text): return f"\033[{code}m{text}\033[0m" if sys.stdout.isatty() else text
def ok(msg):    print(c("32",  "✓ ") + msg)
def err(msg):   print(c("31",  "✗ ") + msg)
def warn(msg):  print(c("33",  "⚠ ") + msg)
def info(msg):  print(c("36",  "→ ") + msg)
def hdr(msg):   print(c("1;34", msg))
def dim(msg):   print(c("2",    msg))
def sep():      print(c("2", "  " + "─" * 50))

def _spin_while(label, fn):
    """Run fn() in a background thread and show a spinner + elapsed time until it returns."""
    result = [None]
    exc    = [None]

    def worker():
        try:
            result[0] = fn()
        except Exception as e:
            exc[0] = e

    t = threading.Thread(target=worker, daemon=True)
    t.start()
    frames = ["⠋","⠙","⠹","⠸","⠼","⠴","⠦","⠧","⠇","⠏"]
    start = time.time()
    i = 0
    while t.is_alive():
        elapsed = int(time.time() - start)
        if sys.stdout.isatty():
            print(f"\r  {c('36', frames[i % len(frames)])} {label}  [{elapsed}s]", end="", flush=True)
        time.sleep(0.1)
        i += 1
    t.join()
    if sys.stdout.isatty():
        print(f"\r  {c('32','✓')} {label}  [{int(time.time()-start)}s]")
    if exc[0]:
        raise exc[0]
    return result[0]

def table(headers, rows):
    if not rows:
        dim("  (empty)")
        return
    import re
    def clean_ansi(s):
        return re.sub(r'\033\[[0-9;]*m', '', str(s))
    
    widths = []
    for i, h in enumerate(headers):
        w = len(clean_ansi(h))
        for r in rows:
            if i < len(r):
                w = max(w, len(clean_ansi(r[i])))
        widths.append(w)
        
    def format_row(row):
        cols = []
        for i in range(len(widths)):
            val = row[i] if i < len(row) else ""
            w = widths[i]
            s_str = str(val)
            cols.append(s_str + (" " * max(0, w - len(clean_ansi(s_str)))))
        return "  " + "  ".join(cols)

    print(c("1", format_row(headers)))
    print("  " + "  ".join("─" * w for w in widths))
    for row in rows:
        print(format_row(row))

def status_badge(s):
    s = str(s).lower()
    if s in ("blocked", "stopped", "false", "disabled", "down", "error"):
        return c("31", f"[{s.upper()}]")
    if s in ("allowed", "running", "true", "enabled", "up", "ok", "healthy"):
        return c("32", f"[{s.upper()}]")
    return c("33", f"[{s.upper()}]")

def do_clear():
    os.system("clear" if os.name != "nt" else "cls")

# ─── HTTP helpers ──────────────────────────────────────────────────────────────

def _headers():
    h = {"Content-Type": "application/json"}
    if JWT_TOKEN:
        h["Authorization"] = f"Bearer {JWT_TOKEN}"
    return h

def api_get(path, timeout=TIMEOUT, suppress_err=False):
    try:
        r = HTTP_SESSION.get(f"{STIGIX_URL}{path}", headers=_headers(), timeout=timeout)
        r.raise_for_status()
        return r.json()
    except requests.exceptions.ConnectionError:
        if not suppress_err:
            err(f"Cannot reach Stigix at {STIGIX_URL} — is the container running?")
        return None
    except requests.exceptions.HTTPError as e:
        if not suppress_err:
            if e.response.status_code == 401:
                err("Unauthorized — run: auth login")
            else:
                err(f"HTTP {e.response.status_code}: {e.response.text[:200]}")
        return None
    except Exception as e:
        if not suppress_err:
            err(str(e))
        return None

def api_post(path, body=None, method="POST", timeout=TIMEOUT):
    try:
        if method == "POST":
            fn = HTTP_SESSION.post
        elif method == "PUT":
            fn = HTTP_SESSION.put
        else:
            fn = HTTP_SESSION.delete
        r  = fn(f"{STIGIX_URL}{path}", json=body or {}, headers=_headers(), timeout=timeout)
        r.raise_for_status()
        return r.json()
    except requests.exceptions.ConnectionError:
        err(f"Cannot reach Stigix at {STIGIX_URL}")
        return None
    except requests.exceptions.HTTPError as e:
        if e.response.status_code == 401:
            err("Unauthorized — run: auth login")
        else:
            err(f"HTTP {e.response.status_code}: {e.response.text[:200]}")
        return None
    except Exception as e:
        err(str(e))
        return None

def api_put(path, body=None, timeout=TIMEOUT):
    return api_post(path, body, method="PUT", timeout=timeout)

def api_delete(path, body=None, timeout=TIMEOUT):
    return api_post(path, body, method="DELETE", timeout=timeout)

def require_auth():
    if not JWT_TOKEN:
        err("Not authenticated — run: auth login")
        return False
    return True

# ─── Live status cache (bottom toolbar) ───────────────────────────────────────

class _StatusCache:
    """Background-refreshed cache for the bottom toolbar. Fetches every 10s."""

    def __init__(self):
        self.traffic  = "?"
        self.version  = "?"
        self.reachable = False
        self._ts      = 0
        self._lock    = threading.Lock()
        self._busy    = False

    def invalidate(self):
        """Force next refresh immediately (call after state-changing commands)."""
        self._ts = 0

    def refresh(self):
        with self._lock:
            if self._busy or (time.time() - self._ts < 10):
                return
            self._busy = True
        threading.Thread(target=self._fetch, daemon=True).start()

    def _fetch(self):
        try:
            r = HTTP_SESSION.get(f"{STIGIX_URL}/api/traffic/status", headers=_headers(), timeout=3)
            if r.ok:
                d = r.json()
                self.traffic   = "▶ RUNNING" if (d.get("enabled") or d.get("running")) else "■ STOPPED"
                self.reachable = True
            else:
                self.traffic   = "?"
                self.reachable = False
        except Exception:
            self.traffic   = "?"
            self.reachable = False
        try:
            r = HTTP_SESSION.get(f"{STIGIX_URL}/api/version", headers=_headers(), timeout=3)
            if r.ok:
                self.version = r.json().get("version", "?")
        except Exception:
            self.version = "?"
        self._ts = time.time()
        with self._lock:
            self._busy = False

STATUS = _StatusCache()


def _toolbar():
    """Bottom toolbar rendered by prompt_toolkit on every keystroke."""
    try:
        STATUS.refresh()

        host = STIGIX_URL.replace("https://", "").replace("http://", "")

        # connection indicator
        if not STATUS.reachable:
            conn = '<style bg="#B71C1C" fg="white"> ✗ OFFLINE </style>'
        elif JWT_TOKEN:
            conn = '<style bg="#1B5E20" fg="white"> ● connected </style>'
        else:
            conn = '<style bg="#E65100" fg="white"> ● no auth </style>'

        # traffic badge
        if STATUS.traffic == "▶ RUNNING":
            traf = f'<b fg="#69F0AE">▶ RUNNING</b>'
        elif STATUS.traffic == "■ STOPPED":
            traf = f'<b fg="#FF5252">■ STOPPED</b>'
        else:
            traf = f'<b fg="#90A4AE">? UNKNOWN</b>'

        ver  = f'v{STATUS.version}' if STATUS.version != "?" else ""
        div  = ' <b fg="#546E7A"> │ </b> '

        return HTML(
            f' {conn}'
            f'{div}<b fg="#80CBC4">{host}</b>'
            f'{div}Traffic: {traf}'
            + (f'{div}<b fg="#78909C">{ver}</b>' if ver else "")
            + f'{div}<b fg="#546E7A">F1</b>:help  <b fg="#546E7A">F5</b>:status  <b fg="#546E7A">Ctrl+L</b>:clear'
        )
    except Exception as e:
        return HTML(f'<style bg="#B71C1C" fg="white"> Toolbar Error: {e} </style>')


# ─── Key bindings ─────────────────────────────────────────────────────────────

def _make_bindings():
    kb = KeyBindings()

    @kb.add("f1")
    def _(event):
        event.current_buffer.set_document(Document("help"))
        event.current_buffer.validate_and_handle()

    @kb.add("f5")
    def _(event):
        event.current_buffer.set_document(Document("status"))
        event.current_buffer.validate_and_handle()

    @kb.add("c-l")
    def _(event):
        event.app.renderer.clear()

    return kb

# ─── Commands ──────────────────────────────────────────────────────────────────

def cmd_auth(args):
    global JWT_TOKEN
    sub = args[0] if args else "help"

    if sub == "login":
        user = input("Username [admin]: ").strip() or "admin"
        pwd  = getpass.getpass("Password: ")
        r = api_post("/api/auth/login", {"username": user, "password": pwd})
        if r and r.get("token"):
            JWT_TOKEN = r["token"]
            save_session()
            STATUS.invalidate()
            ok(f"Logged in as {user}  (session saved → {CONFIG_FILE})")
        else:
            err("Login failed")

    elif sub == "status":
        if JWT_TOKEN:
            ok(f"Authenticated  (token: {JWT_TOKEN[:16]}...)")
        else:
            warn("Not authenticated")

    elif sub == "logout":
        JWT_TOKEN = None
        save_session()
        STATUS.invalidate()
        ok("Logged out  (session cleared)")

    else:
        _help_section("AUTHENTICATION", [
            ("auth login",  "Authenticate session with Stigix"),
            ("auth status", "Show current authentication status"),
            ("auth logout", "Clear session token and disconnect"),
        ])


def format_uptime(secs):
    if secs is None or secs == '?':
        return '?'
    try:
        s = int(secs)
        h = s // 3600
        m = (s % 3600) // 60
        r = s % 60
        parts = []
        if h > 0:
            parts.append(f"{h}h")
        if m > 0 or h > 0:
            parts.append(f"{m}m")
        parts.append(f"{r}s")
        return " ".join(parts)
    except:
        return str(secs)


def cmd_status(args):
    if not require_auth(): return
    if any(x in args for x in ("--help", "-h", "help")):
        _help_section("STATUS", [
            ("status", "Show Stigix instance overview"),
        ])
        return

    import re
    def clean_ansi(s):
        return re.sub(r'\033\[[0-9;]*m', '', str(s))

    rows = []

    # 1. Backend Health
    health = api_get("/api/system/health")
    if health:
        s = health.get("status", "?")
        upt = health.get("uptime", "?")
        upt_str = format_uptime(upt)
        rows.append(("Backend", f"{status_badge(s)}  uptime: {upt_str}"))

    # 2. Version
    v = api_get("/api/version")
    if v:
        rows.append(("Version", f"{v.get('version', v)}"))

    # 3. Traffic Generator Status
    t = api_get("/api/traffic/status")
    if t:
        state = "running" if (t.get("enabled") or t.get("running")) else "stopped"
        rows.append(("Traffic Gen", status_badge(state)))
        STATUS.traffic = "▶ RUNNING" if state == "running" else "■ STOPPED"

    # 4. Prisma Site
    site = api_get("/api/siteinfo")
    if site:
        site_name = site.get("detected_site_name") or site.get("siteName")
        if site_name:
            rows.append(("Prisma Site", site_name))

    # Section separator
    rows.append(None)

    # 5. Interfaces & Default IP
    ifaces_data = api_get("/api/system/interfaces")
    local_ip = None
    default_iface = None
    if ifaces_data:
        default_iface = ifaces_data.get("default_interface")
        iface_list = ifaces_data.get("interfaces", [])
        for iface in iface_list:
            if iface.get("is_default") or iface.get("name") == default_iface:
                local_ip = iface.get("ip")
                break
        if not local_ip and iface_list:
            local_ip = iface_list[0].get("ip")

    if local_ip:
        rows.append(("Local IP", f"{local_ip}" + (f" ({default_iface})" if default_iface else "")))

    # 6. Gateway
    gw_data = api_get("/api/system/gateway-ip")
    gw_ip = gw_data.get("ip") if gw_data else None
    if gw_ip and gw_ip != "Unknown OS":
        rows.append(("Gateway", gw_ip))

    # 7. Traffic Interface
    traffic_ifaces_data = api_get("/api/config/interfaces")
    traffic_ifaces = None
    if traffic_ifaces_data and isinstance(traffic_ifaces_data, list):
        traffic_ifaces = ", ".join(traffic_ifaces_data)
    if traffic_ifaces:
        rows.append(("Traffic If", traffic_ifaces))

    # 8. Public IP
    ip = api_get("/api/connectivity/public-ip", suppress_err=True)
    if ip:
        rows.append(("Public IP", f"{ip.get('ip', ip)}"))

    # 9. Target Controller / Global Provisioning
    reg = api_get("/api/registry/status", suppress_err=True)
    if reg:
        is_leader = reg.get("is_leader", False)
        site_name = reg.get("site_name")
        leader_info = reg.get("active_leader") or {}
        leader_ip = leader_info.get("ip") or "Self"
        if is_leader:
            peers_cnt = len(reg.get("peers", []))
            rows.append(("Controller", f"👑 Leader ({peers_cnt} peers connected)"))
        else:
            rows.append(("Controller", f"🔗 Peer (Leader: {leader_ip})"))

    prov = api_get("/api/provisioning/config", suppress_err=True)
    if prov:
        is_prov = prov.get("state", {}).get("enabled", False)
        rows.append(("Provisioning", "🟢 ON (Sync active)" if is_prov else "⚪ OFF (Standalone)"))

    # Print the beautiful card
    max_label_len = max(len(r[0]) for r in rows if r is not None)
    card_width = 64
    inner_width = card_width - 4  # 2 border chars + 2 padding spaces
    # Visible label width = 2 (indent) + max_label_len + 3 (" : ")
    label_visible_len = 2 + max_label_len + 3

    print(c("2;34", "┏" + "━" * (card_width - 2) + "┓"))
    title_str = " Stigix Status Overview "
    title_pad = (inner_width - len(title_str)) // 2
    title_line = " " * title_pad + title_str + " " * (inner_width - len(title_str) - title_pad)
    print(c("2;34", "┃") + c("1;34", title_line) + c("2;34", "┃"))
    print(c("2;34", "┣" + "━" * (card_width - 2) + "┫"))

    for r in rows:
        if r is None:
            print(c("2;34", "┣" + "─" * (card_width - 2) + "┫"))
        else:
            label, val = r
            label_formatted = c("1;36", f"  {label:<{max_label_len}} : ")
            val_clean = clean_ansi(val)
            pad_len = max(0, inner_width - label_visible_len - len(val_clean))
            print(c("2;34", "┃") + label_formatted + val + (" " * pad_len) + c("2;34", "┃"))

    print(c("2;34", "┗" + "━" * (card_width - 2) + "┛"))
    # Show where command history is stored
    dim(f"  history file: {HISTORY_FILE}")
    print()

    # Dynamic failover convergence info
    conv = api_get("/api/convergence/status")
    if conv and isinstance(conv, list):
        running = [t for t in conv if t.get("running")]
        if running:
            ok(f"Failover running: {', '.join(t.get('testId','?') for t in running)}")

def cmd_flows(args):
    if not require_auth(): return
    if not args or args[0] in ("--help", "-h", "help"):
        _help_section("FLOWS", [
            ("flows query [options]", "Query the Prisma SD-WAN Flow Browser"),
            ("  Options:", ""),
            ("    --site <name>", "Site name (e.g. BR8)"),
            ("    --protocol <tcp|udp|icmp|number>", "Filter by protocol"),
            ("    --src-ip <ip>", "Filter by source IP"),
            ("    --dst-ip <ip>", "Filter by destination IP"),
            ("    --src-port <port>", "Filter by TCP/UDP source port"),
            ("    --dst-port <port>", "Filter by TCP/UDP destination port"),
            ("    --minutes <N>", "Minutes to look back (default: 15)"),
            ("    --fast", "Skip path resolution to speed up query"),
        ])
        return

    sub = args[0]
    if sub != "query":
        err(f"Unknown flows subcommand: {sub}")
        return

    # Parse arguments
    site_name = None
    protocol = None
    src_ip = None
    dst_ip = None
    src_port = None
    dst_port = None
    minutes = 15
    fast = False

    if len(args) == 1:
        # Interactive mode
        # 1. Detect site name
        default_site = None
        site = api_get("/api/siteinfo")
        if site:
            default_site = site.get("detected_site_name") or site.get("siteName")
        
        site_prompt = f"Site name (e.g. BR8) [{default_site}]: " if default_site else "Site name (e.g. BR8): "
        site_name = input(site_prompt).strip()
        if not site_name and default_site:
            site_name = default_site

        # 2. Protocol
        proto_input = input("Protocol (tcp, udp, icmp) [tcp]: ").strip().lower() or "tcp"
        if proto_input == "tcp": protocol = 6
        elif proto_input == "udp": protocol = 17
        elif proto_input == "icmp": protocol = 1
        else:
            try: protocol = int(proto_input)
            except ValueError: protocol = 6 # default fallback

        # 3. Source IP
        default_ip = None
        ifaces_data = api_get("/api/system/interfaces")
        if ifaces_data:
            default_iface = ifaces_data.get("default_interface")
            iface_list = ifaces_data.get("interfaces", [])
            for iface in iface_list:
                if iface.get("is_default") or iface.get("name") == default_iface:
                    default_ip = iface.get("ip")
                    break
            if not default_ip and iface_list:
                default_ip = iface_list[0].get("ip")

        src_ip_prompt = f"Source IP [{default_ip}]: " if default_ip else "Source IP: "
        src_ip = input(src_ip_prompt).strip()
        if not src_ip and default_ip:
            src_ip = default_ip

        # 4. Source Port
        src_port_input = input("Source Port (optional): ").strip()
        if src_port_input:
            try: src_port = int(src_port_input)
            except ValueError: err("Invalid source port")

        # 5. Destination IP
        dst_ip = input("Destination IP (optional): ").strip() or None

        # 6. Destination Port
        dst_port_input = input("Destination Port (optional): ").strip()
        if dst_port_input:
            try: dst_port = int(dst_port_input)
            except ValueError: err("Invalid destination port")

        # 7. Minutes
        minutes_input = input("Minutes lookback [5]: ").strip()
        if minutes_input:
            try: minutes = int(minutes_input)
            except ValueError:
                err("Invalid minutes, defaulting to 5")
                minutes = 5
        else:
            minutes = 5

        # 8. Fast
        fast_input = input("Fast mode (skip VPN path resolution) [y/N]: ").strip().lower()
        fast = fast_input in ("y", "yes")

        # Print equivalent CLI syntax
        equivalent_args = []
        if site_name:
            equivalent_args.append(f"--site {site_name}")
        proto_name = "tcp" if protocol == 6 else "udp" if protocol == 17 else "icmp" if protocol == 1 else str(protocol)
        equivalent_args.append(f"--protocol {proto_name}")
        if src_ip:
            equivalent_args.append(f"--src-ip {src_ip}")
        if src_port:
            equivalent_args.append(f"--src-port {src_port}")
        if dst_ip:
            equivalent_args.append(f"--dst-ip {dst_ip}")
        if dst_port:
            equivalent_args.append(f"--dst-port {dst_port}")
        if minutes != 15:
            equivalent_args.append(f"--minutes {minutes}")
        if fast:
            equivalent_args.append("--fast")
        
        eq_str = "flows query " + " ".join(equivalent_args)
        info("--------------------------------------------------------------------------------")
        info(f"Equivalent CLI command (copy & paste to reuse):\n  {eq_str}")
        info("--------------------------------------------------------------------------------")
    else:
        i = 1
        while i < len(args):
            arg = args[i]
            if arg == "--site" and i + 1 < len(args):
                site_name = args[i+1]
                i += 2
            elif arg == "--protocol" and i + 1 < len(args):
                proto_str = args[i+1].lower()
                if proto_str == "tcp": protocol = 6
                elif proto_str == "udp": protocol = 17
                elif proto_str == "icmp": protocol = 1
                else:
                    try: protocol = int(proto_str)
                    except ValueError: pass
                i += 2
            elif arg == "--src-ip" and i + 1 < len(args):
                src_ip = args[i+1]
                i += 2
            elif arg == "--dst-ip" and i + 1 < len(args):
                dst_ip = args[i+1]
                i += 2
            elif arg == "--src-port" and i + 1 < len(args):
                try: src_port = int(args[i+1])
                except ValueError: err("Invalid source port")
                i += 2
            elif arg == "--dst-port" and i + 1 < len(args):
                try: dst_port = int(args[i+1])
                except ValueError: err("Invalid destination port")
                i += 2
            elif arg == "--minutes" and i + 1 < len(args):
                try: minutes = int(args[i+1])
                except ValueError: err("Invalid minutes")
                i += 2
            elif arg == "--fast":
                fast = True
                i += 1
            else:
                err(f"Unrecognized argument: {arg}")
                return

    # Prepare payload
    body = {
        "site_name": site_name,
        "protocol": protocol,
        "src_ip": src_ip,
        "dst_ip": dst_ip,
        "minutes": minutes,
        "fast": fast
    }
    
    # Map TCP/UDP specific ports
    if protocol == 6:
        if src_port: body["tcp_src_port"] = src_port
        if dst_port: body["tcp_dst_port"] = dst_port
    elif protocol == 17 or (not protocol and (src_port or dst_port)):
        # Default to UDP if not specified but ports are provided
        if src_port: body["udp_src_port"] = src_port
        if dst_port: body["udp_dst_port"] = dst_port
        if not protocol:
            body["protocol"] = 17

    # Run API query
    def do_query():
        return api_post("/api/prisma/flows", body, timeout=60)

    res = _spin_while("Querying Prisma Flow Browser...", do_query)

    if not res:
        return

    if not res.get("success", True) == True or "error" in res:
        err(res.get("error", "Flow query failed"))
        return

    flows = res.get("flows", [])
    if not flows:
        info("No matching flows found.")
        return

    ok(f"Found {len(flows)} flows:")
    
    headers = ["Start Time", "Source", "Destination", "Proto", "Bytes (C2S/S2C)", "Packets (C2S/S2C)", "Path", "App ID"]
    rows = []
    
    for f in flows:
        # Convert start time timestamp (ms) to string
        start_ms = f.get("flow_start_time_ms")
        start_time_str = "?"
        if start_ms:
            try:
                start_time_str = datetime.fromtimestamp(start_ms / 1000).strftime("%Y-%m-%d %H:%M:%S")
            except:
                pass
        
        src = f"{f.get('source_ip')}:{f.get('source_port')}"
        dst = f"{f.get('destination_ip')}:{f.get('destination_port')}"
        
        proto_num = f.get("protocol")
        proto_map = {6: "TCP", 17: "UDP", 1: "ICMP"}
        proto = proto_map.get(proto_num, str(proto_num))
        
        bytes_str = f"{f.get('bytes_c2s') or 0} / {f.get('bytes_s2c') or 0}"
        packets_str = f"{f.get('packets_c2s') or 0} / {f.get('packets_s2c') or 0}"
        path_name = f.get("egress_path") or f.get("path_type") or "?"
        app = f.get("app_id") or "?"
        
        rows.append([
            start_time_str,
            src,
            dst,
            proto,
            bytes_str,
            packets_str,
            path_name,
            app
        ])
        
    table(headers, rows)

PREV_STATS = {"total_requests": None, "timestamp": None}

def get_app_groups():
    app_to_group = {}
    truncated_to_group = {}
    
    r = api_get("/api/config/apps")
    if r and isinstance(r, list):
        for cat in r:
            cat_name = cat.get("name", "Uncategorized")
            apps = cat.get("apps", [])
            for app in apps:
                domain = app.get("domain", "")
                clean_name = domain.replace("https://", "").replace("http://", "")
                app_to_group[clean_name] = cat_name
                app_to_group[domain] = cat_name
                
                host_part = clean_name.split('.')[0]
                if host_part and host_part not in truncated_to_group:
                    truncated_to_group[host_part] = cat_name
                    
    return app_to_group, truncated_to_group

def render_traffic_dashboard(stats, status_str, app_to_group, truncated_to_group, show_all=False):
    total_req = stats.get("total_requests", 0)
    errors_by_app = stats.get("errors_by_app", {})
    requests_by_app = stats.get("requests_by_app", {})
    
    total_errors = sum(errors_by_app.values())
    success_rate = ((total_req - total_errors) / total_req * 100) if total_req > 0 else 100.0
    active_apps = len([k for k, v in requests_by_app.items() if v > 0])
    
    # Calculate Traffic Rate
    current_ts = stats.get("timestamp", 0)
    rpm_str = "Calculating..."
    if PREV_STATS["total_requests"] is not None and PREV_STATS["timestamp"] is not None:
        delta_req = total_req - PREV_STATS["total_requests"]
        delta_time = current_ts - PREV_STATS["timestamp"]
        if delta_time > 0 and delta_req >= 0:
            pps = delta_req / delta_time
            rpm = pps * 60
            rpm_str = f"{rpm:.1f} req/min ({pps:.1f} pps)"
        elif delta_req >= 0:
            rpm_str = "0.0 req/min (0.0 pps)"
            
    # Update previous stats for rate tracking
    PREV_STATS["total_requests"] = total_req
    PREV_STATS["timestamp"] = current_ts

    status_text = status_str.upper()
    status_color = "32" if status_str == "running" else "31"
    status_val = f"[{status_text}]"
    col1_row1 = " Status: " + c(status_color, status_val.ljust(9))
    
    success_color = "32" if success_rate >= 95 else ("33" if success_rate >= 80 else "31")
    success_val = f"{success_rate:>5.1f}%"
    col2_row1 = " Success Rate: " + c(success_color, success_val) + " "
    
    col3_row1 = " Rate: " + c("36", rpm_str.ljust(14)) + " "
    
    col1_row2 = f" Active Apps: {active_apps:>3} "
    col2_row2 = f" Total Requests: {total_req:>5} "
    
    errors_color = "31" if total_errors > 0 else "32"
    col3_row2 = " Errors: " + c(errors_color, f"{total_errors}".ljust(12)) + " "
    
    row1 = f"║{col1_row1}║{col2_row1}║{col3_row1}║"
    row2 = f"║{col1_row2}║{col2_row2}║{col3_row2}║"
    
    hdr("╔══════════════════╦══════════════════════╦══════════════════════╗")
    hdr("║" + "TRAFFIC DASHBOARD".center(64) + "║")
    hdr("╠══════════════════╬══════════════════════╬══════════════════════╣")
    hdr(row1)
    hdr(row2)
    hdr("╚══════════════════╩══════════════════════╩══════════════════════╝")
    print()
    
    # Print App Table
    hdr("━━ Active Applications ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
    
    app_rows = []
    for app, reqs in requests_by_app.items():
        if reqs == 0:
            continue
        clean_app = app.replace("https://", "").replace("http://", "")
        group = app_to_group.get(clean_app) or app_to_group.get(app) or truncated_to_group.get(clean_app.split('.')[0]) or "Uncategorized"
        errs = errors_by_app.get(app, 0)
        app_success = ((reqs - errs) / reqs * 100) if reqs > 0 else 100.0
        app_rows.append({
            "app": clean_app,
            "group": group,
            "requests": reqs,
            "errors": errs,
            "success_rate": app_success
        })
        
    # Sort by requests descending
    app_rows.sort(key=lambda x: x["requests"], reverse=True)
    
    table_rows = []
    for idx, row in enumerate(app_rows, 1):
        app_name = row["app"][:30]
        group_name = row["group"][:20]
        reqs_str = c("34" if row["requests"] > 0 else "0", f"{row['requests']:,}")
        errs_str = c("31", f"{row['errors']:,}") if row["errors"] > 0 else c("2", "0")
        
        sr = row["success_rate"]
        if sr >= 95:
            sr_color = "32"
        elif sr >= 80:
            sr_color = "33"
        else:
            sr_color = "31"
        sr_str = c(sr_color, f"{sr:.1f}%")
        
        table_rows.append([
            str(idx),
            app_name,
            group_name,
            reqs_str,
            errs_str,
            sr_str
        ])
        
    if not table_rows:
        dim("  No applications traffic recorded yet")
        return
        
    display_rows = table_rows if show_all else table_rows[:15]
    table(["#", "Application", "Group", "Requests", "Errors", "Success Rate"], display_rows)
    
    if not show_all and len(table_rows) > 15:
        print()
        dim(f"  (Showing top 15 of {len(table_rows)} active applications. Use 'traffic stats --all' to list all)")

def cmd_traffic(args):
    if not require_auth(): return
    sub = args[0] if args else "status"

    if sub == "start":
        r = api_post("/api/traffic/start")
        if r:
            ok("Traffic generation started")
            STATUS.invalidate()

    elif sub == "stop":
        r = api_post("/api/traffic/stop")
        if r:
            ok("Traffic generation stopped")
            STATUS.invalidate()

    elif sub == "status":
        r = api_get("/api/traffic/status")
        if r:
            state = "running" if (r.get("enabled") or r.get("running")) else "stopped"
            print(f"Traffic: {status_badge(state)}")
            rate = r.get("sleep_interval", 1.0)
            client_count = r.get("client_count", 1)
            if rate <= 0.5:
                speed_badge = "🚀 TURBO"
            elif rate <= 2.0:
                speed_badge = "⚡ FAST"
            elif rate <= 5.0:
                speed_badge = "📱 NORMAL"
            else:
                speed_badge = "🐢 SLOW"
            print(f"Traffic Speed: {c('36', speed_badge)} ({rate}s delay)")
            print(f"Traffic Density: {c('35', f'{client_count} CLIENTS')} (x{client_count} parallel)")

    elif sub == "speed":
        if len(args) < 2:
            r = api_get("/api/traffic/status")
            if r:
                rate = r.get("sleep_interval", 1.0)
                if rate <= 0.5:
                    speed_badge = "🚀 TURBO"
                elif rate <= 2.0:
                    speed_badge = "⚡ FAST"
                elif rate <= 5.0:
                    speed_badge = "📱 NORMAL"
                else:
                    speed_badge = "🐢 SLOW"
                info(f"Traffic Speed: {c('36', speed_badge)} ({rate}s delay)")
            return

        val_str = args[1].lower()
        presets = {
            "turbo": 0.1,
            "fast": 1.0,
            "normal": 3.0,
            "slow": 5.0
        }
        if val_str in presets:
            value = presets[val_str]
        else:
            try:
                value = float(val_str)
            except ValueError:
                err("Speed must be a number of seconds (0.01 - 60.0) or one of: turbo, fast, normal, slow")
                return

        if not (0.01 <= value <= 60.0):
            err("Speed must be between 0.01 and 60.0 seconds")
            return

        r = api_post("/api/traffic/rate", {"rate": value})
        if r:
            if value <= 0.5:
                speed_badge = "🚀 TURBO"
            elif value <= 2.0:
                speed_badge = "⚡ FAST"
            elif value <= 5.0:
                speed_badge = "📱 NORMAL"
            else:
                speed_badge = "🐢 SLOW"
            ok(f"Traffic speed updated to {value}s delay ({speed_badge})")
            STATUS.invalidate()

    elif sub == "density":
        if len(args) < 2:
            r = api_get("/api/traffic/status")
            if r:
                client_count = r.get("client_count", 1)
                info(f"Traffic Density: {c('35', f'{client_count} CLIENTS')} (x{client_count} parallel)")
            return

        val_str = args[1]
        try:
            value = int(val_str)
        except ValueError:
            err("Density must be an integer between 1 and 20")
            return

        if not (1 <= value <= 20):
            err("Density must be between 1 and 20")
            return

        r = api_post("/api/traffic/rate", {"client_count": value})
        if r:
            ok(f"Traffic density updated to {value} CLIENTS (x{value} parallel)")
            STATUS.invalidate()

    elif sub == "stats":
        show_all = "--all" in args
        r = api_get("/api/stats")
        t = api_get("/api/traffic/status")
        if r:
            status_str = "stopped"
            if t:
                status_str = "running" if (t.get("enabled") or t.get("running")) else "stopped"
            app_to_group, truncated_to_group = get_app_groups()
            render_traffic_dashboard(r, status_str, app_to_group, truncated_to_group, show_all=show_all)

    elif sub == "logs":
        r = api_get("/api/logs")
        if r:
            lines = r if isinstance(r, list) else (r.get("logs") or r.get("lines") or [])
            hdr(f"━━ Last {len(lines)} log lines ━━━━━━━━━━━━━━━━━━━━━")
            for l in lines[-30:]:
                dim(l)

    elif sub == "reset":
        r = api_delete("/api/stats")
        if r:
            ok("Statistics reset")
            PREV_STATS["total_requests"] = None
            PREV_STATS["timestamp"] = None

    elif sub == "export":
        filepath = args[1] if len(args) > 1 else "stigix-traffic-export.json"
        r = api_get("/api/config/applications/export?format=json")
        if r is None:
            return
        write_json_file(filepath, r)

    elif sub == "import":
        filepath = args[1] if len(args) > 1 else None
        if not filepath:
            err("Usage: traffic import <filepath>")
            return
        data = read_json_file(filepath)
        if data is None:
            return

        # Warning confirmation to avoid accidental override
        if sys.stdin.isatty():
            try:
                confirm = input(c("33", "⚠ Warning: Importing will completely OVERWRITE the current traffic configuration on the remote instance. Proceed? [y/N]: ")).strip().lower()
                if confirm != 'y':
                    print("Aborted.")
                    return
            except (KeyboardInterrupt, EOFError):
                print()
                return

        content = json.dumps(data)
        r = api_post("/api/config/applications/import", {"content": content})
        if r:
            ok("Traffic applications config imported successfully")

    else:
        _help_section("TRAFFIC CONTROL / STATS", [
            ("traffic start",          "Start traffic generation"),
            ("traffic stop",           "Stop traffic generation"),
            ("traffic status",         "Show current traffic state"),
            ("traffic speed [val]",    "Get or set delay in seconds or preset (turbo/fast/normal/slow)"),
            ("traffic density [val]",  "Get or set parallel clients count (1-20)"),
            ("traffic stats [--all]",  "Show traffic statistics & active apps dashboard"),
            ("traffic logs",           "Show last 30 backend log lines"),
            ("traffic reset",          "Reset traffic statistics"),
            ("traffic export [file]",  "Export traffic configuration to JSON"),
            ("traffic import <file>",  "Import traffic configuration from JSON"),
        ])


def cmd_security(args):
    if not require_auth(): return
    sub = args[0] if args else "help"

    if sub == "status":
        r = api_get("/api/security/results/stats")
        if r:
            hdr("━━ Security Test Statistics ━━━━━━━━━━━━━━━━━━━━━━━━")
            print()
            total = r.get("totalTests", 0)
            by_type = r.get("testsByType", {})
            by_status = r.get("testsByStatus", {})
            
            print(f"  Total Security Tests: {c('1;34', str(total))}")
            disk_kb = r.get("diskUsageBytes", 0) / 1024
            print(f"  Disk Usage:           {c('2', f'{disk_kb:.1f} KB')}")
            print()
            
            hdr("  Type Breakdown:")
            table(["Test Type", "Count"], [
                ["URL Filtering", str(by_type.get("url", 0))],
                ["DNS Security",  str(by_type.get("dns", 0))],
                ["Threat Prev.",  str(by_type.get("threat", 0))],
                ["C2 Attack Sim", str(by_type.get("c2", 0))],
                ["AI Security",   str(by_type.get("ai", 0))],
            ])
            print()
            
            hdr("  Verdict Breakdown:")
            table(["Verdict", "Count"], [
                [c("32", "[ALLOWED]"),      str(by_status.get("allowed", 0))],
                [c("31", "[BLOCKED]"),      str(by_status.get("blocked", 0))],
                [c("33", "[SINKHOLED]"),     str(by_status.get("sinkholed", 0))],
                [c("31", "[ENFORCED/C2]"),   str(by_status.get("enforced", 0))],
                [c("32", "[BYPASS/C2]"),     str(by_status.get("bypass", 0))],
                [c("36", "[COMPLETED]"),     str(by_status.get("completed", 0))],
                [c("33", "[INCONCLUSIVE]"),  str(by_status.get("inconclusive", 0))],
                [c("31", "[ERROR]"),         str(by_status.get("error", 0))],
            ])

    elif sub == "url":
        url = args[1] if len(args) > 1 else None
        category = "Manual"
        if not url:
            if sys.stdin.isatty():
                profile = api_get("/api/security/profile")
                if profile:
                    items = profile.get("url_filtering", {}).get("items", [])
                    print("\nURL Filtering Predefined Categories search:")
                    try:
                        q = input("Search categories (e.g. 'malware', press enter for popular): ").strip().lower()
                        filtered = [item for item in items if q in item.get('name','').lower() or q in item.get('id','').lower()] if q else items[:10]
                        if not filtered:
                            print(f"No categories matching '{q}'.")
                            url = input("Enter Custom URL: ").strip()
                            category = "Manual"
                        else:
                            matches = filtered[:25]
                            print(f"\nSelect Predefined URL Category to Test" + (f" (matching '{q}')" if q else " (popular)") + ":")
                            for idx, item in enumerate(matches, 1):
                                print(f"  {idx}: {item.get('name')}  ({item.get('url')})")
                            print(f"  {len(matches)+1}: Custom URL")
                            print()
                            choice = input("Select category [1]: ").strip()
                            c_idx = int(choice) if choice else 1
                            if 1 <= c_idx <= len(matches):
                                url = matches[c_idx - 1].get("url")
                                category = matches[c_idx - 1].get("name")
                            else:
                                url = input("Enter Custom URL: ").strip()
                                category = "Manual"
                    except (ValueError, KeyboardInterrupt, EOFError):
                        print("\nAborted.")
                        return
            if not url:
                err("Usage: security url <url_or_category>")
                return
        else:
            # Check if url matches a predefined category name/id (e.g. malware)
            profile = api_get("/api/security/profile")
            if profile:
                items = profile.get("url_filtering", {}).get("items", [])
                for item in items:
                    if item.get("id").lower() == url.lower() or item.get("name").lower() == url.lower():
                        url = item.get("url")
                        category = item.get("name")
                        break

        info(f"Testing URL: {url} (Category: {category})")
        r = api_post("/api/security/url-test", {"url": url, "category": category})
        if r:
            status = r.get("status", r.get("result", {}).get("status", "?"))
            print(f"Result: {status_badge(status)}  (HTTP {r.get('httpCode','?')})")

    elif sub == "url-batch":
        r = api_get("/api/security/config")
        if not r: return
        cats = r.get("url_filtering", {}).get("enabled_categories", [])
        if not cats:
            warn("No URL categories enabled in config")
            return
        profile = api_get("/api/security/profile")
        if not profile:
            err("Failed to fetch security profile")
            return
        items = profile.get("url_filtering", {}).get("items", [])
        enabled_items = [item for item in items if item.get("id") in cats]
        if not enabled_items:
            warn("No enabled URL categories found in profile")
            return
        tests = [{"url": item["url"], "category": item["name"]} for item in enabled_items]
        info(f"Running batch URL filter test ({len(tests)} categories, timeout 180s)...")
        result = _spin_while(
            f"Testing {len(tests)} URL categories",
            lambda: api_post("/api/security/url-test-batch", {"tests": tests}, timeout=180)
        )
        if result:
            rows = []
            for res in result.get("results", []):
                s = res.get("status") or res.get("result", {}).get("status", "?")
                rows.append([res.get("category","?"), res.get("url","?")[:50], status_badge(s)])
            table(["Category", "URL", "Result"], rows)

    elif sub == "dns":
        domain = args[1] if len(args) > 1 else None
        test_name = "Manual"
        if not domain:
            if sys.stdin.isatty():
                profile = api_get("/api/security/profile")
                if profile:
                    items = profile.get("dns_security", {}).get("items", [])
                    print("\nDNS Security Predefined Categories search:")
                    try:
                        q = input("Search categories (e.g. 'phishing', press enter for popular): ").strip().lower()
                        filtered = [item for item in items if q in item.get('name','').lower() or q in item.get('id','').lower()] if q else items[:10]
                        if not filtered:
                            print(f"No categories matching '{q}'.")
                            domain = input("Enter Custom Domain: ").strip()
                            test_name = "Manual"
                        else:
                            matches = filtered[:25]
                            print(f"\nSelect Predefined DNS Category to Test" + (f" (matching '{q}')" if q else " (popular)") + ":")
                            for idx, item in enumerate(matches, 1):
                                print(f"  {idx}: {item.get('name')}  ({item.get('domain')})")
                            print(f"  {len(matches)+1}: Custom Domain")
                            print()
                            choice = input("Select category [1]: ").strip()
                            c_idx = int(choice) if choice else 1
                            if 1 <= c_idx <= len(matches):
                                domain = matches[c_idx - 1].get("domain")
                                test_name = matches[c_idx - 1].get("name")
                            else:
                                domain = input("Enter Custom Domain: ").strip()
                                test_name = "Manual"
                    except (ValueError, KeyboardInterrupt, EOFError):
                        print("\nAborted.")
                        return
            if not domain:
                err("Usage: security dns <domain_or_category>")
                return
        else:
            # Check if domain matches a predefined category name/id (e.g. malware)
            profile = api_get("/api/security/profile")
            if profile:
                items = profile.get("dns_security", {}).get("items", [])
                for item in items:
                    if item.get("id").lower() == domain.lower() or item.get("name").lower() == domain.lower():
                        domain = item.get("domain")
                        test_name = item.get("name")
                        break

        info(f"Testing DNS: {domain} (Test Name: {test_name})")
        r = api_post("/api/security/dns-test", {"domain": domain, "testName": test_name})
        if r:
            status   = r.get("status", "?")
            resolved = r.get("resolved", False)
            print(f"Result: {status_badge(status)}  resolved={resolved}")

    elif sub == "dns-batch":
        r = api_get("/api/security/config")
        if not r: return
        tests_conf = r.get("dns_security", {}).get("enabled_tests", [])
        if not tests_conf:
            warn("No DNS tests enabled in config")
            return
        profile = api_get("/api/security/profile")
        if not profile:
            err("Failed to fetch security profile")
            return
        items = profile.get("dns_security", {}).get("items", [])
        enabled_items = [item for item in items if item.get("id") in tests_conf]
        if not enabled_items:
            warn("No enabled DNS tests found in profile")
            return
        tests = [{"domain": item["domain"], "testName": item["name"]} for item in enabled_items]
        info(f"Running batch DNS security test ({len(tests)} domains, timeout 180s)...")
        result = _spin_while(
            f"Testing {len(tests)} DNS categories",
            lambda: api_post("/api/security/dns-test-batch", {"tests": tests}, timeout=180)
        )
        if result:
            rows = []
            for res in result.get("results", []):
                s = res.get("status", "?")
                rows.append([res.get("testName","?"), res.get("domain","?"), status_badge(s)])
            table(["Test Name", "Domain", "Result"], rows)

    elif sub == "eicar":
        target   = args[1] if len(args) > 1 else None
        r_cfg    = api_get("/api/security/config")
        tp       = r_cfg.get("threat_prevention", r_cfg.get("threatprevention", r_cfg.get("threatPrevention", {}))) if r_cfg else {}
        endpoints = tp.get("eicar_endpoints", tp.get("eicarendpoints", tp.get("eicarEndpoints", [])))
        
        if not target:
            if sys.stdin.isatty():
                # Fetch security targets
                targets = api_get("/api/targets")
                sec_targets = []
                if targets:
                    sec_targets = [t for t in (targets if isinstance(targets, list) else targets.get("targets", []))
                                   if t.get("enabled", True) and t.get("capabilities", {}).get("security")]
                
                # Fetch cloud EICAR URL
                cloud_url = "https://secure.eicar.org/eicar.com.txt"
                r_cloud = api_get("/api/security/cloud-eicar-url")
                if r_cloud and r_cloud.get("url"):
                    cloud_url = r_cloud.get("url")
                    
                print("\nSelect EICAR Threat Prevention Target:")
                print(f"  1: Cloud EICAR URL  ({cloud_url})")
                for idx, t in enumerate(sec_targets, 2):
                    print(f"  {idx}: {t.get('name')}  (http://{t.get('host')}/eicar.com.txt)")
                print(f"  {len(sec_targets)+2}: Custom URL / IP")
                print()
                
                try:
                    choice = input("Select target [1]: ").strip()
                    c_idx = int(choice) if choice else 1
                    if c_idx == 1:
                        endpoints = [cloud_url]
                    elif 2 <= c_idx <= len(sec_targets) + 1:
                        t = sec_targets[c_idx - 2]
                        endpoints = [f"http://{t.get('host')}/eicar.com.txt"]
                    else:
                        custom = input("Enter Custom URL or IP: ").strip()
                        if custom:
                            if not custom.startswith("http"):
                                custom = f"http://{custom}/eicar.com.txt"
                            endpoints = [custom]
                except (ValueError, KeyboardInterrupt, EOFError):
                    print("\nAborted.")
                    return
            
            if not endpoints:
                err("No EICAR endpoints configured. Usage: security eicar [target]")
                return
        else:
            # CLI mode target given
            # Check if target matches an existing peer name
            targets = api_get("/api/targets")
            matched_host = None
            if targets:
                for t in (targets if isinstance(targets, list) else targets.get("targets", [])):
                    if t.get("name").lower() == target.lower() or t.get("id").lower() == target.lower():
                        matched_host = t.get("host")
                        break
            if matched_host:
                endpoints = [f"http://{matched_host}/eicar.com.txt"]
            else:
                if not target.startswith("http"):
                    target = f"http://{target}/eicar.com.txt"
                endpoints = [target]

        info(f"Running EICAR threat prevention test ({len(endpoints)} endpoint(s))...")
        r = api_post("/api/security/threat-test", {"endpoint": endpoints}, timeout=30)
        if r:
            rows = []
            for res in r.get("results", []):
                s  = res.get("status", "?")
                ep = res.get("endpoint", "?")
                rows.append([ep[:60], status_badge(s), res.get("message","")[:40]])
            table(["Endpoint", "Result", "Message"], rows)

    elif sub == "select-all":
        config = api_get("/api/security/config")
        if not config:
            err("Failed to fetch security config")
            return
            
        type_choice = args[1].lower() if len(args) > 1 else None
        state_choice = args[2].lower() if len(args) > 2 else None
        
        if not type_choice or type_choice not in ("url", "dns"):
            if sys.stdin.isatty():
                print("\nSelect Action:")
                print("  1: Enable all URL filtering categories")
                print("  2: Disable all URL filtering categories")
                print("  3: Enable all DNS security tests")
                print("  4: Disable all DNS security tests")
                print()
                try:
                    c_idx = input("Select action [1]: ").strip()
                    if c_idx in ("1", "2"):
                        type_choice = "url"
                        state_choice = "on" if c_idx == "1" else "off"
                    elif c_idx in ("3", "4"):
                        type_choice = "dns"
                        state_choice = "on" if c_idx == "3" else "off"
                    else:
                        type_choice = "url"
                        state_choice = "on"
                except (KeyboardInterrupt, EOFError):
                    print("\nAborted.")
                    return
            else:
                err("Usage: security select-all <url|dns> <on|off>")
                return
                
        if not state_choice or state_choice not in ("on", "off"):
            if sys.stdin.isatty():
                try:
                    c_state = input(f"Enable all for {type_choice.upper()}? [Y/n]: ").strip().lower()
                    state_choice = "off" if c_state == "n" else "on"
                except (KeyboardInterrupt, EOFError):
                    print("\nAborted.")
                    return
            else:
                err("Usage: security select-all <url|dns> <on|off>")
                return
                
        enabled = (state_choice == "on")
        
        profile = api_get("/api/security/profile")
        if not profile:
            err("Failed to fetch security profile (needed for full list of IDs)")
            return
            
        if type_choice == "url":
            if enabled:
                cats = [c["id"] for c in profile.get("url_filtering", {}).get("items", [])]
                config["url_filtering"]["enabled_categories"] = cats
                msg = f"Enabled all {len(cats)} URL filtering categories"
            else:
                config["url_filtering"]["enabled_categories"] = []
                msg = "Cleared/Disabled all URL filtering categories"
        else:
            if enabled:
                tests = [t["id"] for t in profile.get("dns_security", {}).get("items", [])]
                config["dns_security"]["enabled_tests"] = tests
                msg = f"Enabled all {len(tests)} DNS security tests"
            else:
                config["dns_security"]["enabled_tests"] = []
                msg = "Cleared/Disabled all DNS security tests"
                
        r = api_post("/api/security/config", config)
        if r:
            ok(msg)

    elif sub == "schedule":
        config = api_get("/api/security/config")
        if not config:
            err("Failed to fetch security config")
            return
            
        sched = config.get("scheduled_execution", {})
        
        type_choice = args[1].lower() if len(args) > 1 else None
        state_choice = args[2].lower() if len(args) > 2 else None
        interval_choice = args[3] if len(args) > 3 else None
        
        if not type_choice or type_choice not in ("url", "dns", "threat"):
            if sys.stdin.isatty():
                print("\nSelect Scheduler Category:")
                print("  1: URL Filtering")
                print("  2: DNS Security")
                print("  3: Threat Prevention (EICAR)")
                print()
                try:
                    c_idx = input("Select category [1]: ").strip()
                    type_choice = {"1": "url", "2": "dns", "3": "threat"}.get(c_idx or "1", "url")
                except (KeyboardInterrupt, EOFError):
                    print("\nAborted.")
                    return
            else:
                err("Scheduler category is required: security schedule <url|dns|threat> <on|off> [minutes]")
                return

        if not state_choice or state_choice not in ("on", "off"):
            if sys.stdin.isatty():
                try:
                    c_state = input("Enable scheduler? [y/N]: ").strip().lower()
                    state_choice = "on" if c_state == "y" else "off"
                except (KeyboardInterrupt, EOFError):
                    print("\nAborted.")
                    return
            else:
                err("State (on|off) is required: security schedule <url|dns|threat> <on|off> [minutes]")
                return

        enabled = (state_choice == "on")
        
        cur_sched = sched.get(type_choice, {})
        cur_int = cur_sched.get("interval_minutes", 15 if type_choice != "threat" else 30)
        
        minutes = cur_int
        if enabled:
            if interval_choice:
                try:
                    minutes = int(interval_choice)
                except ValueError:
                    err("Interval must be an integer (minutes).")
                    return
            elif sys.stdin.isatty():
                try:
                    options = [5, 10, 15, 30, 45, 60]
                    print(f"\nSelect Interval in minutes:")
                    for idx, m in enumerate(options, 1):
                        print(f"  {idx}: {m}m" + (" (default)" if m == cur_int else ""))
                    print()
                    choice = input(f"Select interval [{options.index(cur_int)+1 if cur_int in options else 3}]: ").strip()
                    if not choice:
                        minutes = cur_int
                    else:
                        minutes = options[int(choice)-1] if (1 <= int(choice) <= len(options)) else cur_int
                except (ValueError, KeyboardInterrupt, EOFError):
                    print("\nAborted.")
                    return

        sched[type_choice] = {"enabled": enabled, "interval_minutes": minutes}
        config["scheduled_execution"] = sched
        
        r = api_post("/api/security/config", config)
        if r:
            ok(f"Scheduler for {type_choice.upper()} updated: {'ON' if enabled else 'OFF'} ({minutes} min)")

    elif sub == "suite":
        hdr("━━ Security Suite ━━━━━━━━━━━━━━━━━━━━━━━━")
        print()
        info("1/3 — URL Filtering batch test")
        cmd_security(["url-batch"])
        print()
        info("2/3 — DNS Security batch test")
        cmd_security(["dns-batch"])
        print()
        info("3/3 — EICAR Threat Prevention (auto: Cloud EICAR URL)")
        # In suite mode always use cloud EICAR URL, no interactive prompt
        r_cloud = api_get("/api/security/cloud-eicar-url")
        eicar_url = (r_cloud.get("url") if r_cloud and r_cloud.get("url")
                     else "https://secure.eicar.org/eicar.com.txt")
        info(f"EICAR target: {eicar_url}")
        r = api_post("/api/security/threat-test", {"endpoint": [eicar_url]}, timeout=30)
        if r:
            rows = []
            for res in r.get("results", []):
                s  = res.get("status", "?")
                ep = res.get("endpoint", "?")
                rows.append([ep[:70], status_badge(s), res.get("message","")[:40]])
            table(["Endpoint", "Result", "Message"], rows)
        print()
        info("Done. Run 'security status' for aggregate stats.")

    elif sub == "results":
        limit = int(args[1]) if len(args) > 1 else 20
        r = api_get(f"/api/security/results?limit={limit}")
        if r:
            rows = []
            for res in r.get("results", []):
                ts    = datetime.fromtimestamp(res["timestamp"]/1000).strftime("%H:%M:%S") if "timestamp" in res else "?"
                s     = res.get("result", {}).get("status") or res.get("status","?")
                name  = res.get("name") or res.get("testName") or res.get("category","?")
                ttype = res.get("type") or res.get("testType","?")
                rows.append([ts, ttype[:4], name[:25], status_badge(s)])
            table(["Time", "Type", "Name", "Result"], rows)

    elif sub == "clear":
        r = api_delete("/api/security/results")
        if r: ok("Security results cleared")

    else:
        _help_section("SECURITY", [
            ("security status",            "Blocked/allowed aggregate stats"),
            ("security url [url/category]", "Test a single URL (predefined or custom)"),
            ("security url-batch",         "Test all enabled URL categories"),
            ("security dns [domain/cat]",  "Test a single DNS query (predefined or custom)"),
            ("security dns-batch",         "Test all enabled DNS domains"),
            ("security eicar [target]",    "EICAR threat prevention test (proposal or custom)"),
            ("security select-all <url|dns> <on|off>", "Enable/Disable all categories or tests"),
            ("security schedule <url|dns|threat> <on|off> [min]", "Configure test schedules"),
            ("security suite",             "Run all tests in sequence"),
            ("security results [n]",       "Last N results (default 20)"),
            ("security clear",             "Clear results history"),
        ])


def cmd_experience(args):
    if not require_auth(): return
    sub = args[0] if args else "list"

    if sub == "list":
        r = api_get("/api/connectivity/custom")
        if r:
            targets = r if isinstance(r, list) else r.get("targets", [])
            if not targets:
                dim("  No custom target probes configured")
                return
            rows = []
            for idx, t in enumerate(targets, 1):
                enabled = "✓" if t.get("enabled", True) else "✗"
                rows.append([
                    str(idx),
                    t.get("name","?")[:30],
                    t.get("target") or t.get("host") or t.get("url","?"),
                    t.get("type","?"),
                    enabled
                ])
            table(["Index", "Name", "Target", "Type", "On"], rows)

    elif sub == "add":
        parsed = parse_flags(args[1:], ["name", "target", "host", "url", "type", "port", "timeout", "freq", "frequency"])
        
        # 1. Probe Type
        ttype = parsed.get("type")
        if not ttype:
            if sys.stdin.isatty():
                print("\nSelect Probe Type:")
                print("  1: HTTP   (curl web check)")
                print("  2: HTTPS  (secure web check)")
                print("  3: PING   (ICMP echo)")
                print("  4: TCP    (netcat port check)")
                print("  5: UDP    (iperf3 jitter check)")
                print("  6: DNS    (dig lookup check)")
                print()
                try:
                    choice = input("Select type [1]: ").strip()
                    if not choice:
                        idx = 1
                    else:
                        idx = int(choice)
                except (ValueError, KeyboardInterrupt, EOFError):
                    print("\nAborted.")
                    return
                
                type_map = {1: "HTTP", 2: "HTTPS", 3: "PING", 4: "TCP", 5: "UDP", 6: "DNS"}
                ttype = type_map.get(idx, "HTTP")
            else:
                ttype = "HTTP"
        
        ttype = ttype.upper()
        if ttype == "ICMP":
            ttype = "PING"
        if ttype not in ["HTTP", "HTTPS", "PING", "TCP", "UDP", "DNS"]:
            err(f"Invalid probe type: {ttype}. Supported: HTTP, HTTPS, PING, TCP, UDP, DNS")
            return
            
        # 2. Target (Host/URL/IP)
        target = parsed.get("target") or parsed.get("host") or parsed.get("url")
        if not target:
            if sys.stdin.isatty():
                prompt_placeholder = {
                    "HTTP": "https://example.com",
                    "HTTPS": "https://example.com",
                    "PING": "8.8.8.8",
                    "DNS": "8.8.8.8",
                    "TCP": "1.2.3.4:5201",
                    "UDP": "1.2.3.4:5201"
                }.get(ttype, "1.2.3.4")
                try:
                    target = input(f"Enter Target Host/URL (e.g. {prompt_placeholder}): ").strip()
                except (KeyboardInterrupt, EOFError):
                    print()
                    return
            if not target:
                err("Target is required. Usage: probes add --target <host_or_url>")
                return
        
        # 3. Port (optional helper, mostly for TCP/UDP if not in target)
        port = parsed.get("port")
        if port and ":" not in target and ttype in ["TCP", "UDP"]:
            target = f"{target}:{port}"

        # 4. Name
        name = parsed.get("name")
        if not name:
            default_name = f"{ttype} Probe to {target}"
            if sys.stdin.isatty():
                try:
                    name = input(f"Enter Name [{default_name}]: ").strip()
                except (KeyboardInterrupt, EOFError):
                    print()
                    return
            name = name or default_name

        # 5. Timeout (ms)
        timeout_val = parsed.get("timeout")
        default_timeout = {
            "HTTP": 5000,
            "HTTPS": 5000,
            "PING": 2000,
            "DNS": 3000,
            "TCP": 5000,
            "UDP": 5000
        }.get(ttype, 2000)
        
        if not timeout_val:
            if sys.stdin.isatty():
                try:
                    t_str = input(f"Enter Timeout in ms [{default_timeout}]: ").strip()
                    timeout = int(t_str) if t_str else default_timeout
                except ValueError:
                    warn(f"Using default {default_timeout}ms")
                    timeout = default_timeout
                except (KeyboardInterrupt, EOFError):
                    print()
                    return
            else:
                timeout = default_timeout
        else:
            try:
                timeout = int(timeout_val)
            except ValueError:
                err("Timeout must be an integer.")
                return

        # 5b. Content matching (HTTP/HTTPS only)
        content_match = None
        if ttype in ["HTTP", "HTTPS"] and sys.stdin.isatty():
            try:
                cm_choice = input("Enable content matching? [y/N]: ").strip().lower()
            except (KeyboardInterrupt, EOFError):
                print()
                cm_choice = "n"
            if cm_choice == "y":
                try:
                    cm_mode_input = input("Match mode — (1) contains / (2) not_contains [1]: ").strip()
                    cm_mode = "not_contains" if cm_mode_input == "2" else "contains"
                    cm_value = input("Expected text (max 80 chars): ").strip()[:80]
                    cm_cs_input = input("Case sensitive? [y/N]: ").strip().lower()
                    cm_cs = (cm_cs_input == "y")
                except (KeyboardInterrupt, EOFError):
                    print()
                    cm_mode, cm_value, cm_cs = "contains", "", False
                if cm_value:
                    content_match = {
                        "enabled": True,
                        "mode": cm_mode,
                        "value": cm_value,
                        "case_sensitive": cm_cs
                    }

        # Fetch existing probes list so we don't wipe it out!
        r_get = api_get("/api/connectivity/custom")
        if r_get is None:
            err("Failed to retrieve existing experience probes. Aborting add.")
            return
            
        probes_list = r_get if isinstance(r_get, list) else r_get.get("targets", [])
        
        # Build the new probe dict
        new_probe = {
            "name": name,
            "type": ttype,
            "target": target,
            "timeout": timeout,
            "frequency": int(parsed.get("freq") or parsed.get("frequency") or 300),
            "enabled": True
        }
        if content_match:
            new_probe["content_match"] = content_match
        
        # Append and POST back
        probes_list.append(new_probe)
        r = api_post("/api/connectivity/custom", {"endpoints": probes_list})
        if r:
            ok(f"Experience target '{name}' added successfully")
            print(f"→ Equivalent CLI: experience add --name \"{name}\" --target \"{target}\" --type \"{ttype}\" --timeout {timeout} --freq {new_probe['frequency']}")

    elif sub == "remove":
        match_val = args[1] if len(args) > 1 else None
        if not match_val:
            err("Usage: experience remove <index_or_name>")
            return
            
        r_get = api_get("/api/connectivity/custom")
        if r_get is None:
            err("Failed to retrieve existing experience probes.")
            return
        probes_list = r_get if isinstance(r_get, list) else r_get.get("targets", [])
        if not probes_list:
            err("No probes configured.")
            return
            
        # Try matching by index (1-based)
        matched_idx = None
        try:
            val_idx = int(match_val)
            if 1 <= val_idx <= len(probes_list):
                matched_idx = val_idx - 1
        except ValueError:
            pass
            
        # If not index, try matching by name (case-insensitive)
        if matched_idx is None:
            for idx, p in enumerate(probes_list):
                if p.get("name", "").lower() == match_val.lower():
                    matched_idx = idx
                    break
                    
        if matched_idx is None:
            err(f"Probe matching '{match_val}' not found (tried index and name)")
            return
            
        removed_probe = probes_list.pop(matched_idx)
        r = api_post("/api/connectivity/custom", {"endpoints": probes_list})
        if r:
            ok(f"Experience target '{removed_probe.get('name')}' removed")

    elif sub == "probe":
        r = api_get("/api/connectivity/test", timeout=90)
        if r:
            hdr("━━ Connectivity Probes ━━━━━━━━━━━━━━━━━━━")
            results = r if isinstance(r, list) else r.get("results", [r])
            rows    = []
            for probe in results:
                name = probe.get("name") or probe.get("host","?")
                rtt  = probe.get("rtt") or probe.get("latency","?")
                rows.append([name[:25], probe.get("type","?"),
                             str(rtt)+"ms" if rtt != "?" else "?",
                             status_badge(probe.get("status","?"))])
            table(["Target", "Type", "RTT", "Status"], rows)

    elif sub == "export":
        filepath = args[1] if len(args) > 1 else "stigix-probes-export.json"
        r = api_get("/api/connectivity/custom/export")
        if r is None:
            return
        write_json_file(filepath, r)

    elif sub == "import":
        filepath = args[1] if len(args) > 1 else None
        if not filepath:
            err("Usage: experience import <filepath>")
            return
        data = read_json_file(filepath)
        if data is None:
            return
        endpoints = data if isinstance(data, list) else data.get("endpoints")
        if not endpoints:
            err("Invalid format: expected a JSON array or an object containing an 'endpoints' array")
            return

        # Warning confirmation to avoid accidental override
        if sys.stdin.isatty():
            try:
                confirm = input(c("33", "⚠ Warning: Importing will completely OVERWRITE the custom experience probes on the remote instance. Proceed? [y/N]: ")).strip().lower()
                if confirm != 'y':
                    print("Aborted.")
                    return
            except (KeyboardInterrupt, EOFError):
                print()
                return

        r = api_post("/api/connectivity/custom", {"endpoints": endpoints})
        if r:
            ok("Experience probes imported successfully")

    elif sub == "stats":
        import re
        stats_data = api_get("/api/connectivity/stats?range=1h")
        results_data = api_get("/api/connectivity/results?timeRange=1h&limit=1500")
        custom_data = api_get("/api/connectivity/custom")
        
        if custom_data is None:
            err("Failed to fetch custom experience probes config.")
            return
            
        probes_config = custom_data if isinstance(custom_data, list) else custom_data.get("targets", [])
        results_list = results_data.get("results", []) if results_data else []
        
        global_health = stats_data.get("globalHealth", 0) if stats_data else 0
        health_color = "32" if global_health >= 80 else ("33" if global_health >= 50 else "31")
        
        score_text = f"Global Score: {global_health}/100"
        padding_total = 64 - len(score_text)
        left_pad = padding_total // 2
        right_pad = padding_total - left_pad
        score_part = c(health_color, f"{global_health}/100")
        row_content = " " * left_pad + "Global Score: " + score_part + " " * right_pad
        
        hdr("╔══════════════════════════════════════════════════════════════╗")
        hdr("║" + "DIGITAL EXPERIENCE GLOBAL SUMMARY".center(64) + "║")
        hdr("╠══════════════════════════════════════════════════════════════╣")
        hdr(f"║{row_content}║")
        hdr("╚══════════════════════════════════════════════════════════════╝")
        print()
        
        # Group results by endpointId
        results_by_id = {}
        for r in results_list:
            eid = r.get("endpointId")
            if eid:
                if eid not in results_by_id:
                    results_by_id[eid] = []
                results_by_id[eid].append(r)
                
        rows = []
        for p in probes_config:
            pname = p.get("name", "Unknown")
            pid = re.sub(r'\s+', '-', pname.lower())
            
            presults = results_by_id.get(pid, [])
            ptype = p.get("type") or (presults[0].get("endpointType") if presults else "HTTP")
            ptarget = p.get("target") or p.get("host") or p.get("url") or (presults[0].get("url") if presults else "---")
            
            enabled = p.get("enabled", True)
            status_str = "ACTIVE" if enabled else "INACTIVE"
            
            if presults:
                last_res = presults[0]
                reachable_results = [r for r in presults if r.get("reachable", False)]
                
                last_score = last_res.get("score", 0)
                
                if reachable_results:
                    avg_score = round(sum(r.get("score", 0) for r in reachable_results) / len(reachable_results))
                    min_score = min(r.get("score", 0) for r in reachable_results)
                    max_score = max(r.get("score", 0) for r in reachable_results)
                    
                    avg_lat = sum(r.get("metrics", {}).get("total_ms", 0) for r in reachable_results) / len(reachable_results)
                    avg_lat_str = f"{avg_lat:.1f}ms" if avg_lat < 10 else f"{avg_lat:.0f}ms"
                else:
                    avg_score = 0
                    min_score = 0
                    max_score = 0
                    avg_lat_str = "---"
                    
                reliability = round((len(reachable_results) / len(presults)) * 100)
            else:
                last_score = 0
                avg_score = 0
                min_score = 0
                max_score = 0
                avg_lat_str = "---"
                reliability = 0
                
            status_color = "32" if enabled else "30"
            status_colored = c(status_color, status_str)
            
            score_color = "32" if last_score >= 80 else ("33" if last_score >= 50 else "31")
            score_str = c(score_color, f"{last_score}")
            score_sub = c("2", f"({avg_score} avg)")
            score_display = f"{score_str} {score_sub}"
            
            rel_color = "32" if reliability >= 95 else ("33" if reliability >= 80 else "31")
            reliability_str = c(rel_color, f"{reliability}%")
            
            rows.append([
                pname[:20],
                ptarget[:30],
                ptype,
                status_colored,
                score_display,
                avg_lat_str,
                reliability_str
            ])
            
        if not rows:
            dim("  No synthetic probes configured")
            return
            
        rows.sort(key=lambda x: x[0].lower())
        for row in rows:
            pname_raw = row[0]
            pcfg = next((p for p in probes_config if p.get("name","")[:20] == pname_raw), {})
            cm = pcfg.get("content_match", {})
            if cm.get("enabled"):
                # Find last content_match result for this probe
                pid = re.sub(r'\s+', '-', pcfg.get("name", "").lower())
                presults = results_by_id.get(pid, [])
                last_cm_ok = presults[0].get("content_match_ok") if presults else None
                last_cm_res = presults[0].get("content_match_result", "no data") if presults else "no data"
                cm_color = "32" if last_cm_ok else ("31" if last_cm_ok is False else "35")
                cm_status = c(cm_color, "\u2713 " + last_cm_res) if last_cm_ok else c("31", "\u2717 " + last_cm_res) if last_cm_ok is False else c("35", "? no data")
                row.append(f"\U0001f50d {cm.get('mode','contains')}: \"{cm.get('value','?')[:15]}\" {cm_status}")
            else:
                row.append("-")
        table(["Probe Name", "Target/URL", "Type", "Status", "Score", "Latency (avg)", "Reliability", "Content Match"], rows)

    else:
        _help_section("TARGET PROBES", [
            ("probes list",           "List connectivity probe targets"),
            ("probes add",            "Add a new target (interactive or --flags)"),
            ("probes remove <id>",    "Remove a target"),
            ("probes probe",          "Run all probes now"),
            ("probes stats",          "Show historical scores, latency, and reliability"),
            ("probes export [file]",  "Export custom probes to JSON"),
            ("probes import <file>",  "Import custom probes from JSON"),
        ])
        dim("  Flags for add: --name  --host  --type {http,ping,dns}  --port  --timeout")


def cmd_peer(args):
    if not require_auth(): return
    sub = args[0] if args else "list"

    if sub == "list":
        r = api_get("/api/targets")
        if r:
            peers = r if isinstance(r, list) else r.get("targets", [])
            if not peers:
                dim("  No Stigix targets configured")
                return
            rows = []
            for p in peers:
                enabled = "✓" if p.get("enabled", True) else "✗"
                caps = p.get("capabilities", {})
                caps_list = []
                for k, v in caps.items():
                     if v:
                         caps_list.append("failover" if k == "convergence" else k)
                caps_str = ", ".join(caps_list) if caps_list else "none"
                source = p.get("source", "managed")
                rows.append([
                    p.get("id", "")[:12],
                    p.get("name", "")[:20],
                    p.get("host", ""),
                    caps_str,
                    enabled,
                    source
                ])
            table(["ID", "Name", "Host", "Capabilities", "On", "Source"], rows)

    elif sub == "add":
        parsed = parse_flags(args[1:], ["name", "host", "voice", "convergence", "failover", "xfr", "security", "connectivity"])
        name = parsed.get("name") or input("Name (e.g. Branch-1): ").strip()
        host = parsed.get("host") or input("Host (IP or FQDN): ").strip()
        
        voice = str(parsed.get("voice", "true")).lower() == "true"
        failover_val = parsed.get("failover")
        convergence_val = parsed.get("convergence")
        if failover_val is not None:
            failover = str(failover_val).lower() == "true"
        elif convergence_val is not None:
            failover = str(convergence_val).lower() == "true"
        else:
            failover = True
        xfr = str(parsed.get("xfr", "true")).lower() == "true"
        security = str(parsed.get("security", "true")).lower() == "true"
        connectivity = str(parsed.get("connectivity", "true")).lower() == "true"

        if not name or not host:
            err("Name and host are required.")
            return

        body = {
            "name": name,
            "host": host,
            "enabled": True,
            "capabilities": {
                "voice": voice,
                "convergence": failover,
                "xfr": xfr,
                "security": security,
                "connectivity": connectivity
            }
        }
        r = api_post("/api/targets", body)
        if r:
            ok(f"Stigix target '{name}' added successfully")

    elif sub in ("remove", "enable", "disable"):
        pid = args[1] if len(args) > 1 else None
        if not pid:
            err(f"Usage: target {sub} <name/id/host>")
            return

        # Fetch targets from server to find match
        targets = api_get("/api/targets")
        if targets is None:
            targets = []
        else:
            targets = targets if isinstance(targets, list) else targets.get("targets", [])

        # Search for matching targets
        matches = []
        for p in targets:
            full_id = p.get("id", "")
            name = p.get("name", "")
            host = p.get("host", "")
            
            # Match by full ID, prefix match, name (case insensitive), or host IP
            if (full_id == pid or 
                (len(pid) >= 4 and full_id.startswith(pid)) or 
                name.lower() == pid.lower() or 
                host == pid):
                matches.append(p)

        if not matches:
            err(f"Stigix target '{pid}' not found")
            return
        elif len(matches) > 1:
            err(f"Multiple targets matched '{pid}':")
            for m in matches:
                info(f"  - {m.get('id')[:12]} | {m.get('name')} | {m.get('host')}")
            return

        target = matches[0]
        full_id = target.get("id")
        name = target.get("name")
        host = target.get("host")

        if sub == "remove":
            if sys.stdin.isatty():
                try:
                    confirm = input(f"Are you sure you want to delete Stigix target '{name}' ({host})? [y/N]: ").strip().lower()
                    if confirm != 'y':
                        return
                except (KeyboardInterrupt, EOFError):
                    print()
                    return
            r = api_delete(f"/api/targets/{full_id}")
            if r:
                ok(f"Stigix target '{name}' ({host}) removed")
        else:
            body = {"enabled": sub == "enable"}
            r = api_put(f"/api/targets/{full_id}", body)
            if r:
                ok(f"Stigix target '{name}' ({host}) {'enabled' if sub == 'enable' else 'disabled'}")

    elif sub == "export":
        filepath = args[1] if len(args) > 1 else "stigix-targets-export.json"
        targets = api_get("/api/targets")
        if targets is None:
            return
        targets_list = targets if isinstance(targets, list) else targets.get("targets", [])
        data_to_export = [{
            "name": t.get("name"),
            "host": t.get("host"),
            "enabled": t.get("enabled"),
            "capabilities": t.get("capabilities"),
            "ports": t.get("ports")
        } for t in targets_list]
        write_json_file(filepath, data_to_export)

    elif sub == "import":
        filepath = args[1] if len(args) > 1 else None
        if not filepath:
            err("Usage: target import <filepath>")
            return
        data = read_json_file(filepath)
        if data is None:
            return
        targets_to_import = data if isinstance(data, list) else data.get("targets")
        if not targets_to_import:
            err("Invalid format: expected a JSON array or an object containing a 'targets' array")
            return

        # Warning confirmation to avoid accidental override
        if sys.stdin.isatty():
            try:
                confirm = input(c("33", "⚠ Warning: Importing will completely OVERWRITE the Stigix targets on the remote instance. Proceed? [y/N]: ")).strip().lower()
                if confirm != 'y':
                    print("Aborted.")
                    return
            except (KeyboardInterrupt, EOFError):
                print()
                return

        r = api_post("/api/targets/import", {"targets": targets_to_import})
        if r:
            ok("Stigix targets imported successfully")

    else:
        _help_section("STIGIX TARGETS", [
            ("target list",             "List configured Stigix targets"),
            ("target add",              "Add a new Stigix target manually"),
            ("target remove <id>",      "Remove a Stigix target"),
            ("target enable <id>",      "Enable a Stigix target"),
            ("target disable <id>",     "Disable a Stigix target"),
            ("target export [file]",    "Export targets to JSON"),
            ("target import <file>",    "Import targets from JSON"),
        ])
        dim("  Flags for add: --name  --host  --voice {true,false}  --failover {true,false}")
        dim("                 --xfr {true,false}  --security {true,false}  --connectivity {true,false}")


def cmd_provision(args):
    """Manage Central Global Provisioning (Application catalogues, probes, SLA, security policies)."""
    if not require_auth(): return
    sub = args[0] if args else "status"

    if sub in ("status", "info"):
        r = api_get("/api/provisioning/config")
        if not r: return
        state = r.get("state", {})
        manifest = r.get("manifest", {})
        pending = r.get("pending", {})
        is_enabled = state.get("enabled", False)

        hdr("━━ GLOBAL PROVISIONING STATUS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
        status_text = c("1;32", "🟢 ENABLED") if is_enabled else c("1;31", "🔴 DISABLED")
        print(f"  Status       : {status_text}")
        
        applied_revs = state.get("appliedRevisions", {})
        bundles = manifest.get("bundles", [])
        bundle_dict = {b.get("type"): b for b in bundles}

        bundle_types = [
            ("applications",         "Applications Catalogue",   "applications"),
            ("connectivity-probes",  "Synthetic Probes",         "connectivityProbes"),
            ("convergence-sla",      "Convergence SLA",          "convergenceSla"),
            ("security-config",      "Security Policies",        "securityConfig"),
            ("voice-config",         "Voice (VoIP) Settings",    "voiceConfig"),
            ("iot-config",           "IoT Emulation Config",     "iotConfig"),
            ("prisma-sase",          "Prisma SASE Credentials",  "prismaSase"),
        ]

        rows = []
        for b_type, label, pending_key in bundle_types:
            pub_bundle = bundle_dict.get(b_type, {})
            pub_rev = pub_bundle.get("revision", "-")
            item_count = pub_bundle.get("itemCount", "-")
            
            applied = applied_revs.get(b_type, {})
            app_rev = applied.get("revision", "-") if isinstance(applied, dict) else (applied if applied else "-")
            
            has_pending = pending.get(pending_key, False)
            pending_str = c("1;33", "⚠ Modified (Unpublished)") if has_pending else c("2;37", "None")
            
            if pub_rev != "-" and app_rev != "-" and str(pub_rev) == str(app_rev):
                sync_badge = c("1;32", f"✓ rev {app_rev}")
            elif app_rev != "-":
                sync_badge = c("1;36", f"rev {app_rev} (pub: {pub_rev})")
            else:
                sync_badge = c("2;37", "—")

            rows.append([
                label,
                str(pub_rev) if pub_rev != "-" else "—",
                str(item_count) if item_count != "-" else "—",
                sync_badge,
                pending_str
            ])

        table(["Bundle", "Published Rev", "Items", "Local Applied", "Pending on Leader"], rows)

        if not is_enabled:
            dim("\n  Tip: Enable provisioning with 'provision enable' or 'provision on'")
        elif any(pending.values()):
            dim("\n  Tip: Publish modified bundles to all connected peers with 'provision publish <type|all>'")

    elif sub in ("on", "enable", "start"):
        r = api_post("/api/provisioning/config", {"enabled": True})
        if r:
            ok("Global Provisioning ENABLED — connected peers will automatically pull published bundles")

    elif sub in ("off", "disable", "stop"):
        r = api_post("/api/provisioning/config", {"enabled": False})
        if r:
            ok("Global Provisioning DISABLED — peers will use standalone local configurations")

    elif sub == "publish":
        target_type = args[1] if len(args) > 1 else None
        
        type_map = {
            "applications": "applications",
            "apps": "applications",
            "app": "applications",
            "probes": "connectivity-probes",
            "probe": "connectivity-probes",
            "connectivity-probes": "connectivity-probes",
            "sla": "convergence-sla",
            "convergence": "convergence-sla",
            "convergence-sla": "convergence-sla",
            "security": "security-config",
            "security-config": "security-config",
            "voice": "voice-config",
            "voice-config": "voice-config",
            "iot": "iot-config",
            "iot-config": "iot-config",
            "prisma": "prisma-sase",
            "prisma-sase": "prisma-sase",
        }

        if not target_type or target_type.lower() == "all":
            # Publish all bundle types
            types_to_publish = [
                "applications", "connectivity-probes", "convergence-sla",
                "security-config", "voice-config", "iot-config", "prisma-sase"
            ]
            success_count = 0
            for t in types_to_publish:
                res = api_post(f"/api/provisioning/publish/{t}", {})
                if res and res.get("success"):
                    pub = res.get("published", {})
                    rev = pub.get("revision", "?")
                    cnt = pub.get("itemCount", 0)
                    summary = pub.get("summary", {})
                    diff_str = f"(+{summary.get('added',0)} -{summary.get('removed',0)} ~{summary.get('modified',0)})"
                    ok(f"Published {t:<22} rev {rev:<3} ({cnt} items {diff_str})")
                    success_count += 1
                else:
                    err(f"Failed to publish {t}")
            if success_count > 0:
                ok(f"Successfully published {success_count} bundles to peer registry.")
        else:
            mapped_type = type_map.get(target_type.lower())
            if not mapped_type:
                err(f"Unknown bundle type '{target_type}'. Valid types: applications, probes, sla, security, voice, iot, prisma, all")
                return
            res = api_post(f"/api/provisioning/publish/{mapped_type}", {})
            if res and res.get("success"):
                pub = res.get("published", {})
                rev = pub.get("revision", "?")
                cnt = pub.get("itemCount", 0)
                summary = pub.get("summary", {})
                diff_str = f"(+{summary.get('added',0)} -{summary.get('removed',0)} ~{summary.get('modified',0)})"
                ok(f"Published '{mapped_type}' rev {rev} ({cnt} items {diff_str}) successfully!")
            else:
                err(f"Failed to publish '{mapped_type}': {res.get('error', 'unknown error') if res else 'request failed'}")

    elif sub == "rollback":
        if len(args) < 3:
            err("Usage: provision rollback <type> <revision>")
            info("  Example: provision rollback applications 2")
            return
        raw_type = args[1]
        rev_str = args[2]
        
        type_map = {
            "applications": "applications", "apps": "applications",
            "probes": "connectivity-probes", "connectivity-probes": "connectivity-probes",
            "sla": "convergence-sla", "convergence-sla": "convergence-sla",
            "security": "security-config", "security-config": "security-config",
            "voice": "voice-config", "voice-config": "voice-config",
            "iot": "iot-config", "iot-config": "iot-config",
            "prisma": "prisma-sase", "prisma-sase": "prisma-sase"
        }
        mapped_type = type_map.get(raw_type.lower(), raw_type)
        res = api_post(f"/api/provisioning/rollback/{mapped_type}/{rev_str}", {})
        if res and res.get("success"):
            new_rev = res.get("newPublished", {}).get("revision", "?")
            ok(f"Rolled back '{mapped_type}' to rev {rev_str} (re-published as rev {new_rev})")
        else:
            err(f"Rollback failed: {res.get('error', 'revision not found or invalid') if res else 'request failed'}")

    elif sub in ("history", "log", "logs"):
        r = api_get("/api/provisioning/config")
        if not r: return
        history = r.get("state", {}).get("history", [])
        if not history:
            dim("  No provisioning distribution history recorded yet")
            return
        rows = []
        for h in reversed(history[-20:]):
            ts = h.get("timestamp", "")
            if "T" in ts:
                ts = ts.split("T")[0] + " " + ts.split("T")[1][:8]
            summary = h.get("summary", {})
            diff = f"+{summary.get('added',0)} -{summary.get('removed',0)} ~{summary.get('modified',0)}"
            rows.append([
                ts,
                h.get("type", ""),
                f"rev {h.get('revision', '-')}",
                str(h.get("itemCount", "-")),
                diff,
                h.get("publishedBy", "local")
            ])
        table(["Timestamp", "Bundle Type", "Revision", "Items", "Diff", "Published By"], rows)

    elif sub in ("pending", "diff"):
        r = api_get("/api/provisioning/config")
        if not r: return
        pending = r.get("pending", {})
        has_any = any(pending.values())
        if not has_any:
            ok("All local configurations match the published global revisions — zero pending changes.")
        else:
            warn("The following local bundles have unpublished changes on this Leader:")
            for k, v in pending.items():
                if v:
                    info(f"  • {k} (Run 'provision publish {k}' to push to peers)")

    else:
        _help_section("GLOBAL PROVISIONING", [
            ("provision status",                 "Show provisioning state and bundle revisions"),
            ("provision enable / on",            "Enable Global Provisioning pull mode"),
            ("provision disable / off",          "Disable Global Provisioning"),
            ("provision publish [type|all]",     "Publish local bundle(s) to all peers"),
            ("provision rollback <type> <rev>",  "Rollback a bundle to an earlier revision"),
            ("provision history",                "Show recent provisioning audit trail"),
            ("provision pending",                "Check for unpublished local changes"),
        ])


def cmd_controller(args):
    """Manage Target Controller, Leader registration, static leader connection, and peer nodes."""
    if not require_auth(): return
    sub = args[0] if args else "status"

    if sub in ("status", "info"):
        reg = api_get("/api/registry/status")
        if not reg: return

        site_name = reg.get("site_name", "Unknown Site")
        detected_ip = reg.get("detected_ip", "Unknown")
        is_leader = reg.get("is_leader", False)
        mode = reg.get("mode", "dynamic")
        static_url = reg.get("static_leader_url")
        active_leader = reg.get("active_leader") or {}
        leader_ip = active_leader.get("ip") or ("Self (This Node)" if is_leader else "None")
        leader_status = active_leader.get("status", "connected" if is_leader else "standby")
        peers = reg.get("peers", [])

        hdr("━━ TARGET CONTROLLER / REGISTRY STATUS ━━━━━━━━━━━━━━━━")
        print(f"  Local Site Name   : {c('1;36', site_name)}")
        print(f"  Detected LAN IP   : {c('1;37', detected_ip)}")
        role_badge = c("1;33", "👑 HYBRID LEADER") if is_leader else c("1;34", "🔗 REMOTE PEER / BRANCH")
        print(f"  Node Role         : {role_badge}")
        mode_str = c("1;35", "Static Controller") if static_url else c("1;36", "Cloudflare Autodiscovery")
        print(f"  Discovery Mode    : {mode_str}")
        if static_url:
            print(f"  Static Leader URL : {c('1;37', static_url)}")
        print(f"  Active Leader     : {c('1;32' if leader_status == 'connected' else '1;33', f'{leader_ip} ({leader_status.upper()})')}")
        print(f"  Registered Peers  : {c('1;36', str(len(peers)))} remote nodes")

        if is_leader and peers:
            print()
            dim("  Connected Remote Peers (use 'controller peers' for full list):")
            rows = []
            for p in peers[:5]:
                rows.append([
                    p.get("site_name") or p.get("hostname") or "Unknown",
                    p.get("ip", ""),
                    p.get("mode", "managed"),
                    p.get("last_seen", "just now")
                ])
            table(["Site Name", "IP Address", "Mode", "Last Heartbeat"], rows)

    elif sub in ("peers", "list", "nodes"):
        reg = api_get("/api/registry/status")
        if not reg: return
        peers = reg.get("peers", [])
        if not peers:
            dim("  No remote peers currently registered with this Leader.")
            info("  Tip: Onboard a remote peer with 'controller onboard-command'")
            return
        rows = []
        for p in peers:
            caps = p.get("capabilities", {})
            caps_list = [k for k, v in caps.items() if v]
            caps_str = ", ".join(caps_list) if caps_list else "default"
            rows.append([
                p.get("site_name") or p.get("hostname") or "Unknown",
                p.get("ip", ""),
                p.get("role", "peer"),
                caps_str,
                p.get("last_seen", "just now"),
                status_badge("running" if p.get("online", True) else "down")
            ])
        table(["Site Name", "IP Address", "Role", "Capabilities", "Last Seen", "Status"], rows)

    elif sub in ("set-leader", "connect", "join"):
        if len(args) < 2:
            err("Usage: controller set-leader <url_or_ip>")
            info("  Example: controller set-leader 192.168.203.100")
            info("  Example: controller set-leader http://192.168.203.100:8080/api/registry")
            return
        raw_url = args[1].strip()
        if not raw_url.startswith("http://") and not raw_url.startswith("https://"):
            if ":" in raw_url:
                raw_url = f"http://{raw_url}"
            else:
                raw_url = f"http://{raw_url}:8080"
        if not raw_url.endswith("/api/registry"):
            raw_url = raw_url.rstrip("/") + "/api/registry"

        info(f"Connecting to Leader at {raw_url}...")
        # First test connectivity
        test_res = api_post("/api/registry/test-connectivity", {"url": raw_url})
        if test_res and test_res.get("status") == "ok":
            ok("Reachability and API handshake verified!")
        else:
            warn(f"Warning: Controller test returned: {test_res.get('error', 'unreachable') if test_res else 'failed'}")
            if sys.stdin.isatty():
                try:
                    c_conf = input("Do you want to save this leader configuration anyway? [y/N]: ").strip().lower()
                    if c_conf != 'y': return
                except (KeyboardInterrupt, EOFError):
                    return

        res = api_post("/api/registry/static-leader", {"url": raw_url})
        if res:
            ok(f"Static Leader configured successfully: {raw_url}")
            info("This node will now register and sync with the Leader.")

    elif sub in ("unset-leader", "autodiscover", "reset"):
        res = api_post("/api/registry/static-leader", {"url": None})
        if res:
            ok("Reverted to Cloudflare dynamic peer autodiscovery (Static leader unset)")

    elif sub in ("test", "ping", "check"):
        if len(args) < 2:
            err("Usage: controller test <url_or_ip>")
            return
        target = args[1].strip()
        if not target.startswith("http"): target = f"http://{target}"
        if not target.endswith("/api/registry"): target = target.rstrip("/") + "/api/registry"
        
        info(f"Testing connectivity to {target}...")
        res = api_post("/api/registry/test-connectivity", {"url": target})
        if res and res.get("status") == "ok":
            ok(f"Connection successful! Latency: {res.get('latencyMs', '?')}ms")
            if res.get("siteName"):
                info(f"Remote Leader Site Name: {res.get('siteName')}")
        else:
            err(f"Connection test failed: {res.get('error', 'Unreachable or invalid endpoint') if res else 'request failed'}")

    elif sub in ("site-name", "name", "rename"):
        if len(args) > 1:
            new_name = " ".join(args[1:]).strip()
            res = api_post("/api/registry/site-name", {"siteName": new_name})
            if res:
                ok(f"Local node site name updated to: '{new_name}'")
        else:
            reg = api_get("/api/registry/status")
            if reg:
                print(f"Current Site Name: {c('1;36', reg.get('site_name', 'Unknown'))}")

    elif sub in ("onboard-command", "onboard", "install-cmd"):
        reg = api_get("/api/registry/status")
        leader_ip = reg.get("detected_ip") if reg else None
        if not leader_ip:
            leader_ip = "<LEADER_IP>"
        leader_url = f"http://{leader_ip}:8080"
        
        install_cmd = f"curl -fsSL https://raw.githubusercontent.com/jsuzanne/stigix/v2/install.sh | sudo bash -s -- --controller {leader_url}"
        
        hdr("━━ REMOTE PEER ONBOARDING COMMAND ━━━━━━━━━━━━━━━━━━━━━━━")
        info("Run this single command on any remote Linux machine to join this Leader:")
        print()
        print(c("1;32", f"  {install_cmd}"))
        print()
        dim("  The remote node will be provisioned in Target Site mode and automatically")
        dim("  register with this Leader, pulling all published global configurations.")

    else:
        _help_section("TARGET CONTROLLER / LEADER", [
            ("controller status",                "Show Leader role, site name, and peer stats"),
            ("controller peers",                 "List registered remote branch nodes"),
            ("controller set-leader <ip|url>",   "Point this node to a central Leader"),
            ("controller autodiscover",          "Revert to Cloudflare dynamic autodiscovery"),
            ("controller test <url>",            "Test reachability to a remote Leader"),
            ("controller site-name [name]",      "Get or update local node site name"),
            ("controller onboard-command",       "Generate peer onboarding curl one-liner"),
        ])


def cmd_speedtest(args):
    if not require_auth(): return
    sub = args[0] if args else "help"

    if sub in ("list", "history"):
        r = api_get("/api/tests/xfr")
        if r:
            jobs = r if isinstance(r, list) else r.get("jobs", [])
            if not jobs:
                dim("  No speedtest history found")
                return
            rows = []
            for j in jobs[:20]:
                started = j.get("started_at")
                if started:
                    try:
                        ts = started.split("T")[1][:8]
                    except Exception:
                        ts = started
                else:
                    ts = "?"
                params = j.get("params", {})
                host = params.get("host", "?")
                proto = params.get("protocol", "tcp")
                status = j.get("status", "?")
                
                summary = j.get("summary") or {}
                sent = summary.get("sent_mbps", 0)
                recv = summary.get("received_mbps", 0)
                rtt = summary.get("rtt_ms_avg", 0)
                
                rows.append([
                    j.get("sequence_id", j.get("id", ""))[:12],
                    ts,
                    host,
                    proto.upper(),
                    f"{sent:.1f} Tx / {recv:.1f} Rx" if summary else "-",
                    f"{rtt:.1f}ms" if summary else "-",
                    status_badge(status)
                ])
            table(["ID", "Time", "Target", "Proto", "Speed (Mbps)", "RTT", "Status"], rows)

    elif sub == "run":
        # Parse out target host and remaining options
        target_host = None
        remaining_opts = []
        if len(args) > 1:
            first_arg = args[1]
            if not first_arg.startswith("--"):
                target_host = first_arg
                remaining_opts = args[2:]
            else:
                remaining_opts = args[1:]
        else:
            remaining_opts = []

        # If target host not provided, propose available XFR targets or prompt
        if not target_host:
            targets = api_get("/api/targets")
            if targets is None:
                targets = []
            else:
                targets = targets if isinstance(targets, list) else targets.get("targets", [])
            
            xfr_targets = [
                t for t in targets 
                if t.get("enabled", True) and t.get("capabilities", {}).get("xfr")
            ]
            
            if not xfr_targets:
                if sys.stdin.isatty():
                    try:
                        target_host = input("Enter speedtest target host/IP: ").strip()
                    except (KeyboardInterrupt, EOFError):
                        print()
                        return
                    if not target_host:
                        err("Target host/IP cannot be empty. Aborting.")
                        return
                else:
                    err("No speedtest target specified and non-interactive. Usage: speedtest run <target-host> [options]")
                    return
            else:
                if sys.stdin.isatty():
                    print("\nAvailable Speedtest Targets:")
                    for idx, xt in enumerate(xfr_targets, 1):
                        print(f"  {idx}: {xt.get('name')} ({xt.get('host')})")
                    manual_idx = len(xfr_targets) + 1
                    print(f"  {manual_idx}: [Manual IP/Host]")
                    print()
                    try:
                        choice = input("Select target [1]: ").strip()
                        if not choice:
                            idx_choice = 1
                        else:
                            idx_choice = int(choice)
                    except ValueError:
                        err("Invalid choice. Aborting.")
                        return
                    except (KeyboardInterrupt, EOFError):
                        print()
                        return

                    if 1 <= idx_choice <= len(xfr_targets):
                        target_host = xfr_targets[idx_choice - 1].get("host")
                    elif idx_choice == manual_idx:
                        try:
                            target_host = input("Enter speedtest target host/IP: ").strip()
                        except (KeyboardInterrupt, EOFError):
                            print()
                            return
                        if not target_host:
                            err("Target host/IP cannot be empty. Aborting.")
                            return
                    else:
                        err("Invalid index. Aborting.")
                        return
                else:
                    # Non-interactive fallback
                    target_host = xfr_targets[0].get("host")
                    info(f"Auto-selected speedtest target: {target_host} ({xfr_targets[0].get('name')})")
        else:
            # Resolve target name/IP if target_host was provided
            targets = api_get("/api/targets")
            if targets:
                targets_list = targets if isinstance(targets, list) else targets.get("targets", [])
                match = None
                for t in targets_list:
                    if t.get("name", "").lower() == target_host.lower() or t.get("host") == target_host:
                        match = t
                        break
                if match:
                    target_host = match.get("host")

        parsed = parse_flags(remaining_opts, ["port", "protocol", "direction", "duration", "bitrate", "streams", "psk"])

        def prompt_option(name, default_val, validator=None):
            if not sys.stdin.isatty():
                return default_val
            while True:
                try:
                    val = input(f"{name} [{default_val}]: ").strip()
                    if not val:
                        return default_val
                    if validator:
                        valid, parsed_val = validator(val)
                        if valid:
                            return parsed_val
                        else:
                            err(f"Invalid value for {name}. Please try again.")
                    else:
                        return val
                except (KeyboardInterrupt, EOFError):
                    print()
                    raise

        def validate_port(v):
            try:
                p = int(v)
                if 1 <= p <= 65535:
                    return True, p
            except ValueError:
                pass
            return False, None

        def validate_protocol(v):
            p = str(v).strip().lower()
            if p in ("tcp", "udp", "quic"):
                return True, p
            return False, None

        def validate_direction(v):
            d = str(v).strip().lower()
            if d in ("client-to-server", "c2s"):
                return True, "client-to-server"
            if d in ("server-to-client", "s2c"):
                return True, "server-to-client"
            if d in ("bidirectional", "bi"):
                return True, "bidirectional"
            return False, None

        def validate_duration(v):
            try:
                d = int(v)
                if d > 0:
                    return True, d
            except ValueError:
                pass
            return False, None

        def validate_streams(v):
            try:
                s = int(v)
                if s > 0:
                    return True, s
            except ValueError:
                pass
            return False, None

        def validate_bitrate(v):
            v = str(v).strip()
            if v:
                return True, v
            return False, None

        has_cli_flags = len(parsed) > 0

        # Port
        port = None
        if "port" in parsed:
            is_valid, parsed_port = validate_port(parsed["port"])
            if is_valid:
                port = parsed_port
            elif sys.stdin.isatty():
                warn(f"Invalid port '{parsed['port']}' provided on command line.")
                port = prompt_option("Port", 9000, validate_port)
            else:
                port = 9000
        else:
            if not has_cli_flags and sys.stdin.isatty():
                port = prompt_option("Port", 9000, validate_port)
            else:
                port = 9000

        # Protocol
        protocol = None
        if "protocol" in parsed:
            is_valid, parsed_proto = validate_protocol(parsed["protocol"])
            if is_valid:
                protocol = parsed_proto
            elif sys.stdin.isatty():
                warn(f"Invalid protocol '{parsed['protocol']}' provided on command line.")
                protocol = prompt_option("Protocol (tcp/udp/quic)", "tcp", validate_protocol)
            else:
                protocol = "tcp"
        else:
            if not has_cli_flags and sys.stdin.isatty():
                protocol = prompt_option("Protocol (tcp/udp/quic)", "tcp", validate_protocol)
            else:
                protocol = "tcp"

        # Direction
        direction = None
        if "direction" in parsed:
            is_valid, parsed_dir = validate_direction(parsed["direction"])
            if is_valid:
                direction = parsed_dir
            elif sys.stdin.isatty():
                warn(f"Invalid direction '{parsed['direction']}' provided on command line.")
                direction = prompt_option("Direction (client-to-server/server-to-client/bidirectional)", "client-to-server", validate_direction)
            else:
                direction = "client-to-server"
        else:
            if not has_cli_flags and sys.stdin.isatty():
                direction = prompt_option("Direction (client-to-server/server-to-client/bidirectional)", "client-to-server", validate_direction)
            else:
                direction = "client-to-server"

        # Duration
        duration = None
        if "duration" in parsed:
            is_valid, parsed_dur = validate_duration(parsed["duration"])
            if is_valid:
                duration = parsed_dur
            elif sys.stdin.isatty():
                warn(f"Invalid duration '{parsed['duration']}' provided on command line.")
                duration = prompt_option("Duration (sec)", 10, validate_duration)
            else:
                duration = 10
        else:
            if not has_cli_flags and sys.stdin.isatty():
                duration = prompt_option("Duration (sec)", 10, validate_duration)
            else:
                duration = 10

        # Bitrate
        bitrate = None
        if "bitrate" in parsed:
            is_valid, parsed_bit = validate_bitrate(parsed["bitrate"])
            if is_valid:
                bitrate = parsed_bit
            elif sys.stdin.isatty():
                warn(f"Invalid bitrate '{parsed['bitrate']}' provided on command line.")
                bitrate = prompt_option("Bitrate", "200M", validate_bitrate)
            else:
                bitrate = "200M"
        else:
            if not has_cli_flags and sys.stdin.isatty():
                bitrate = prompt_option("Bitrate", "200M", validate_bitrate)
            else:
                bitrate = "200M"

        # Streams
        streams = None
        if "streams" in parsed:
            is_valid, parsed_str = validate_streams(parsed["streams"])
            if is_valid:
                streams = parsed_str
            elif sys.stdin.isatty():
                warn(f"Invalid streams '{parsed['streams']}' provided on command line.")
                streams = prompt_option("Streams", 4, validate_streams)
            else:
                streams = 4
        else:
            if not has_cli_flags and sys.stdin.isatty():
                streams = prompt_option("Streams", 4, validate_streams)
            else:
                streams = 4

        # PSK
        psk = None
        if "psk" in parsed:
            if isinstance(parsed["psk"], bool) and parsed["psk"]:
                if sys.stdin.isatty():
                    psk = prompt_option("PSK (optional)", "")
                else:
                    psk = ""
            else:
                psk = str(parsed["psk"])
        else:
            if not has_cli_flags and sys.stdin.isatty():
                psk = prompt_option("PSK (optional)", "")
            else:
                psk = ""

        is_custom = has_cli_flags or sys.stdin.isatty()

        if is_custom:
            body = {
                "mode": "custom",
                "target": {"host": target_host, "port": port, "psk": psk},
                "protocol": protocol,
                "direction": direction,
                "duration_sec": duration,
                "bitrate": bitrate,
                "parallel_streams": streams
            }
        else:
            body = {
                "mode": "default",
                "target": {"host": target_host, "port": 9000}
            }

        info(f"Starting speedtest to {target_host}:{port} ({protocol.upper()} / {direction})...")
        r = api_post("/api/tests/xfr", body)
        if not r:
            return
            
        job_id = r.get("id")
        seq_id = r.get("sequence_id", job_id)
        ok(f"Speedtest job {seq_id} accepted.")
        
        stream_url = f"/api/tests/xfr/{job_id}/stream?token={JWT_TOKEN}"
        info("Streaming real-time performance metrics (Ctrl+C to stop)...")
        
        try:
            resp = HTTP_SESSION.get(f"{STIGIX_URL}{stream_url}", stream=True, timeout=90)
            current_event = None
            for line in resp.iter_lines():
                if not line:
                    continue
                line_str = line.decode('utf-8')
                if line_str.startswith("event:"):
                    current_event = line_str[6:].strip()
                elif line_str.startswith("data:"):
                    data_str = line_str[5:].strip()
                    try:
                        data = json.loads(data_str)
                        if current_event == "interval":
                            sent = data.get("sent_mbps", 0)
                            recv = data.get("received_mbps", 0)
                            rtt = data.get("rtt_ms", 0)
                            loss = data.get("loss_percent", 0)
                            print(f"  Tx: {sent:.1f} Mbps   Rx: {recv:.1f} Mbps   RTT: {rtt:.1f}ms   Loss: {loss:.1f}%")
                        elif current_event == "done":
                            print()
                            status = data.get("status", "completed").upper()
                            if status == "COMPLETED":
                                ok("Speedtest COMPLETED successfully!")
                            else:
                                err(f"Speedtest finished with status: {status}")
                            break
                    except Exception:
                        pass
        except KeyboardInterrupt:
            print()
            warn("Stopped watching speedtest stream.")
        except Exception as e:
            err(f"Stream error: {e}")

    else:
        _help_section("SPEEDTEST / XFR BANDWIDTH", [
            ("speedtest list / history",   "Show past bandwidth test jobs"),
            ("speedtest run <host>",       "Run default speedtest to target host"),
            ("speedtest run <host> [opts]","Run custom speedtest to target host"),
        ])
        dim("  Flags for run: --port  --protocol {tcp,udp,quic}  --direction {client-to-server,")
        dim("                 server-to-client,bidirectional}  --duration  --bitrate  --streams  --psk")


def cmd_failover(args):
    if not require_auth(): return
    sub = args[0] if args else "status"

    if sub == "status":
        r = api_get("/api/convergence/status")
        if isinstance(r, list) and r:
            running_tests = [t for t in r if t.get("running")]
            if running_tests:
                for t in running_tests:
                    ok(f"Running — ID: {t.get('testId','?')}  elapsed: {t.get('elapsed','?')}s")
                    for key in ("loss","blackout","rtt","ppsReceived"):
                        if key in t:
                            print(f"  {key}: {t[key]}")
            else:
                dim("No failover test running")
        else:
            dim("No failover test running")

    elif sub == "start":
        parsed = parse_flags(args[1:], ["target","pps","label"])
        target_host = parsed.get("target")
        pps    = int(parsed.get("pps", 50))
        label  = parsed.get("label", f"CLI-{int(time.time())}")

        # Fetch registry targets to propose/resolve
        targets = api_get("/api/targets")
        if targets is None:
            targets = []
        else:
            targets = targets if isinstance(targets, list) else targets.get("targets", [])

        # Filter targets with failover capability
        conv_targets = [
            t for t in targets
            if t.get("enabled", True) and (t.get("capabilities", {}).get("convergence") or t.get("capabilities", {}).get("failover"))
        ]

        if target_host:
            # Resolve target name/IP if target_host was provided
            match = None
            for t in targets:
                if t.get("name", "").lower() == target_host.lower() or t.get("host") == target_host:
                    match = t
                    break
            if match:
                target_host = match.get("host")
        else:
            # No target host provided: show selection menu or prompt
            if not conv_targets:
                if sys.stdin.isatty():
                    try:
                        target_host = input("Enter failover target IP/Host: ").strip()
                    except (KeyboardInterrupt, EOFError):
                        print()
                        return
                    if not target_host:
                        err("Target IP/Host cannot be empty. Aborting.")
                        return
                else:
                    err("No failover target specified. Usage: failover start --target <host>")
                    return
            else:
                if sys.stdin.isatty():
                    print("\nAvailable Failover Targets:")
                    for idx, ct in enumerate(conv_targets, 1):
                        print(f"  {idx}: {ct.get('name')} ({ct.get('host')})")
                    manual_idx = len(conv_targets) + 1
                    print(f"  {manual_idx}: [Manual IP/Host]")
                    print()
                    try:
                        choice = input("Select target [1]: ").strip()
                        if not choice:
                            idx_choice = 1
                        else:
                            idx_choice = int(choice)
                    except ValueError:
                        err("Invalid choice. Aborting.")
                        return
                    except (KeyboardInterrupt, EOFError):
                        print()
                        return

                    if 1 <= idx_choice <= len(conv_targets):
                        target_host = conv_targets[idx_choice - 1].get("host")
                    elif idx_choice == manual_idx:
                        try:
                            target_host = input("Enter failover target IP/Host: ").strip()
                        except (KeyboardInterrupt, EOFError):
                            print()
                            return
                        if not target_host:
                            err("Target IP/Host cannot be empty. Aborting.")
                            return
                    else:
                        err("Invalid index. Aborting.")
                        return
                else:
                    # Non-interactive fallback
                    target_host = conv_targets[0].get("host")
                    info(f"Auto-selected failover target: {target_host} ({conv_targets[0].get('name')})")

        r = api_post("/api/convergence/start", {"target": target_host, "pps": pps, "label": label})
        if r:
            ok(f"Failover test started: {r.get('testId','?')}")
            STATUS.invalidate()

    elif sub == "stop":
        r = api_post("/api/convergence/stop")
        if r:
            ok("Failover test stopped")
            STATUS.invalidate()

    elif sub == "history":
        limit = int(args[1]) if len(args) > 1 else 10
        r = api_get("/api/convergence/history")
        if r:
            rows = r if isinstance(r, list) else r.get("results", [])
            rows = rows[:limit]
            
            def get_verdict(max_blackout):
                if max_blackout is None:
                    return "?"
                try:
                    mb = float(max_blackout)
                except Exception:
                    return "?"
                if mb == 0:
                    return c("32", "PERFECT")
                if mb < 1000:
                    return c("32", "GOOD")
                if mb < 5000:
                    return c("33", "DEGRADED")
                if mb < 10000:
                    return c("31", "BAD")
                return c("1;31", "CRITICAL")

            history_rows = []
            for row in rows:
                tid = row.get("test_id") or row.get("testId") or "?"
                if " (" in tid:
                    tid = tid.split(" (")[0]
                label = row.get("label", "?")
                tgt = row.get("target", "?")
                max_bo = None
                for key in ("max_blackout_ms", "maxBlackout", "blackout"):
                    if key in row:
                        max_bo = row[key]
                        break
                if max_bo is not None:
                    bo_str = f"{max_bo}ms"
                else:
                    bo_str = "?"
                verd = get_verdict(max_bo)
                history_rows.append([
                    tid,
                    label,
                    tgt,
                    bo_str,
                    verd
                ])
            table(["ID", "Label", "Target", "Blackout", "Verdict"], history_rows)

    elif sub == "endpoints":
        r = api_get("/api/convergence/endpoints")
        if r:
            eps = r if isinstance(r, list) else r.get("endpoints",[])
            table(["Name","IP","Description"], [
                [e.get("name","?"), e.get("ip") or e.get("target","?"), e.get("description","")[:30]]
                for e in eps
            ])

    elif sub == "watch":
        interval = int(args[1]) if len(args) > 1 else 2
        info(f"Failover watch — refresh every {interval}s  (Ctrl+C to stop)")
        try:
            while True:
                do_clear()
                now = datetime.now().strftime("%H:%M:%S")
                hdr(f"━━ Failover Status  [{now}] ━━━━━━━━━━━━━━━━━")
                r = api_get("/api/convergence/status")
                if isinstance(r, list) and r:
                    running_tests = [t for t in r if t.get("running")]
                    if running_tests:
                        for t in running_tests:
                            ok(f"Running — ID: {t.get('testId','?')}  elapsed: {t.get('elapsed','?')}s")
                            for key in ("loss","blackout","rtt","ppsReceived"):
                                if key in t:
                                    info(f"  {key}: {t[key]}")
                    else:
                        dim("  No test running")
                else:
                    dim("  No test running")
                time.sleep(interval)
        except KeyboardInterrupt:
            print()
            ok("Watch stopped")

    else:
        _help_section("FAILOVER MONITORING", [
            ("failover status",          "Show running test state"),
            ("failover start",           "Start failover test (interactive or --flags)"),
            ("failover stop",            "Stop running test"),
            ("failover history [n]",     "Show past test results"),
            ("failover endpoints",       "List saved endpoints"),
            ("failover watch [sec]",     "Live poll test until stopped"),
        ])
        dim("  Flags for start: --target  --pps  --label")


def cmd_vyos(args):
    if not require_auth(): return
    sub = args[0] if args else "list"

    # Support 'vyos sequences run/stop <id>' redirection
    if sub == "sequences" and len(args) > 1 and args[1] in ("run", "stop"):
        sub = args[1]
        args = args[1:]

    if sub == "list":
        r = api_get("/api/vyos/routers")
        if r:
            routers = r if isinstance(r, list) else r.get("routers", [])
            table(["ID", "Name", "Host", "Status"], [
                [rt.get("id","?")[:10], rt.get("name","?")[:15],
                 rt.get("host","?"), status_badge(rt.get("status","?"))]
                for rt in routers
            ])

    elif sub == "sequences":
        r = api_get("/api/vyos/sequences")
        if r:
            seqs = r if isinstance(r, list) else r.get("sequences", [])
            table(["ID", "Name", "Mode", "Steps"], [
                [s.get("id","?")[:24], s.get("name","?")[:20],
                 s.get("mode","?"), len(s.get("steps",[]))]
                for s in seqs
            ])

    elif sub == "run":
        sid = args[1] if len(args) > 1 else None
        if not sid: err("Usage: vyos run <sequence-id>"); return
        
        # Resolve truncated sequence ID to full ID
        r_seqs = api_get("/api/vyos/sequences")
        if r_seqs:
            seqs = r_seqs if isinstance(r_seqs, list) else r_seqs.get("sequences", [])
            matched = [s for s in seqs if s.get("id") == sid]
            if not matched:
                matched = [s for s in seqs if s.get("id", "").startswith(sid)]
            if len(matched) == 1:
                sid = matched[0]["id"]
            elif len(matched) > 1:
                err(f"Ambiguous sequence ID '{sid}'. Multiple sequences match: " + ", ".join([s["id"] for s in matched]))
                return

        r = api_post(f"/api/vyos/sequences/run/{sid}")
        if r: ok(f"Sequence {sid} started")

    elif sub == "stop":
        sid = args[1] if len(args) > 1 else None
        if not sid: err("Usage: vyos stop <sequence-id>"); return
        
        # Resolve truncated sequence ID to full ID
        r_seqs = api_get("/api/vyos/sequences")
        if r_seqs:
            seqs = r_seqs if isinstance(r_seqs, list) else r_seqs.get("sequences", [])
            matched = [s for s in seqs if s.get("id") == sid]
            if not matched:
                matched = [s for s in seqs if s.get("id", "").startswith(sid)]
            if len(matched) == 1:
                sid = matched[0]["id"]
            elif len(matched) > 1:
                err(f"Ambiguous sequence ID '{sid}'. Multiple sequences match: " + ", ".join([s["id"] for s in matched]))
                return

        r = api_post(f"/api/vyos/sequences/stop/{sid}")
        if r: ok(f"Sequence {sid} stopped")

    elif sub == "history":
        limit = int(args[1]) if len(args) > 1 else 15
        r = api_get("/api/vyos/history")
        if r:
            items = r if isinstance(r, list) else r.get("history", [])
            rows  = []
            for item in items[:limit]:
                ts = datetime.fromtimestamp(item["timestamp"]/1000).strftime("%H:%M:%S") if "timestamp" in item else "?"
                rows.append([ts, item.get("router","?")[:10],
                             item.get("command","?")[:20],
                             status_badge(item.get("status","?"))])
            table(["Time", "Router", "Command", "Status"], rows)

    elif sub == "export":
        filepath = args[1] if len(args) > 1 else "vyos-config.json"
        info(f"Exporting VyOS configuration to {filepath}...")
        r = api_get("/api/vyos/config/export")
        if r is None:
            return
        write_json_file(filepath, r)
        ok(f"VyOS configuration exported to {filepath}")

    elif sub == "import":
        filepath = args[1] if len(args) > 1 else None
        if not filepath:
            err("Usage: vyos import <filepath>")
            return
        data = read_json_file(filepath)
        if data is None:
            return

        # Warning confirmation to avoid accidental override
        if sys.stdin.isatty():
            try:
                confirm = input(c("33", "⚠ Warning: Importing will completely OVERWRITE the current VyOS configuration (routers and sequences) on the remote instance. Proceed? [y/N]: ")).strip().lower()
                if confirm != 'y':
                    print("Aborted.")
                    return
            except (KeyboardInterrupt, EOFError):
                print()
                return

        info(f"Importing VyOS configuration from {filepath}...")
        r = api_post("/api/vyos/config/import", data)
        if r:
            ok("VyOS configuration imported successfully")

    else:
        _help_section("VyOS CONTROL", [
            ("vyos list",            "List configured routers"),
            ("vyos sequences",       "List action sequences"),
            ("vyos run <id>",        "Execute a sequence"),
            ("vyos stop <id>",       "Stop a sequence"),
            ("vyos history [n]",     "Show execution history"),
            ("vyos export [file]",   "Export VyOS configuration to JSON"),
            ("vyos import <file>",   "Import VyOS configuration from JSON"),
        ])


def cmd_voice(args):
    if not require_auth(): return
    sub = args[0] if args else "status"

    if sub == "status":
        r = api_get("/api/voice/status")
        if r:
            running = r.get("enabled") or r.get("running") or r.get("active", False)
            if running:
                ok(f"Voice simulation active — running calls in background (max_simultaneous={r.get('max_simultaneous_calls', 3)})")
            else:
                dim("Voice simulation is stopped")

    elif sub == "start":
        parsed = parse_flags(args[1:], ["target"])
        target = parsed.get("target")

        # 1. Fetch available voice targets from registry
        targets = api_get("/api/targets")
        if targets is None:
            targets = []
        else:
            targets = targets if isinstance(targets, list) else targets.get("targets", [])
        
        voice_targets = [
            t for t in targets 
            if t.get("enabled", True) and t.get("capabilities", {}).get("voice")
        ]

        selected_targets = []

        if not voice_targets:
            warn("No enabled peer targets with voice capability found in registry.")
            if sys.stdin.isatty() and not target:
                try:
                    choice = input("Start voice simulation daemon with default settings? [y/N]: ").strip().lower()
                    if choice != 'y':
                        return
                except (KeyboardInterrupt, EOFError):
                    print()
                    return
        else:
            # We have voice targets! Decide which to simulate.
            if target:
                if target.lower() == "all":
                    selected_targets = voice_targets
                else:
                    # Find by name or host IP
                    match = None
                    for vt in voice_targets:
                        if vt.get("name", "").lower() == target.lower() or vt.get("host") == target:
                            match = vt
                            break
                    if match:
                        selected_targets = [match]
                    else:
                        # Fallback: treat target as a raw IP/host
                        selected_targets = [{"name": target, "host": target, "ports": {"voice": 6100}}]
            elif sys.stdin.isatty():
                # Interactive target selection menu
                print("\nAvailable Voice Targets:")
                print("  0: [All Targets] (Simulate all concurrently)")
                for idx, vt in enumerate(voice_targets, 1):
                    print(f"  {idx}: {vt.get('name')} ({vt.get('host')})")
                
                print()
                try:
                    choice = input("Select target [0]: ").strip()
                    if not choice:
                        idx_choice = 0
                    else:
                        idx_choice = int(choice)
                except ValueError:
                    err("Invalid choice. Aborting.")
                    return
                except (KeyboardInterrupt, EOFError):
                    print()
                    return

                if idx_choice == 0:
                    selected_targets = voice_targets
                elif 1 <= idx_choice <= len(voice_targets):
                    selected_targets = [voice_targets[idx_choice - 1]]
                else:
                    err("Invalid index. Aborting.")
                    return
            else:
                # Non-interactive headless fallback: default to all available targets
                selected_targets = voice_targets

        # 2. Sync selected targets to voice configuration
        if selected_targets:
            # Get current config to preserve existing custom codecs/weights/durations
            cfg = api_get("/api/voice/config")
            current_servers = {}
            control_settings = {}
            if cfg and cfg.get("success"):
                control_settings = cfg.get("control", {})
                servers_str = cfg.get("servers", "")
                # Parse current servers string
                for line in servers_str.split("\n"):
                    line = line.strip()
                    if not line or line.startswith("#"):
                        continue
                    parts = line.split("|")
                    if parts:
                        current_servers[parts[0]] = parts

            # Rebuild servers configuration string
            new_lines = []
            for st in selected_targets:
                host = st.get("host")
                port = st.get("ports", {}).get("voice") or 6100
                key = f"{host}:{port}"
                
                # Check if it was already configured
                if key in current_servers:
                    new_lines.append("|".join(current_servers[key]))
                else:
                    # Defaults: G.711-ulaw, weight 50, duration 30
                    new_lines.append(f"{key}|G.711-ulaw|50|30")
            
            new_servers_str = "\n".join(new_lines)
            
            # Post updated config to server
            api_post("/api/voice/config", {
                "servers": new_servers_str,
                "control": control_settings
            })
            
            targets_desc = "all targets" if len(selected_targets) > 1 else selected_targets[0].get("name")
            info(f"Synchronized voice target configuration ({targets_desc}).")

        # 3. Start the voice simulation daemon
        r = api_post("/api/voice/control", {"enabled": True})
        if r:
            ok("Voice simulation daemon started successfully.")

    elif sub == "stop":
        r = api_post("/api/voice/control", {"enabled": False})
        if r: ok("Voice simulation daemon stopped")

    elif sub == "stats":
        r = api_get("/api/voice/stats")
        if r and isinstance(r, dict) and r.get("success"):
            stats_list = r.get("stats", [])
            
            # Fetch targets from registry to map host/IP to site name
            targets = api_get("/api/targets")
            targets_list = []
            if targets:
                targets_list = targets if isinstance(targets, list) else targets.get("targets", [])
                
            # Map host:port -> friendly site name
            target_names = {}
            for t in targets_list:
                name = t.get("name")
                host = t.get("host")
                vport = t.get("ports", {}).get("voice") or 6100
                if name and host:
                    target_names[f"{host}:{vport}"] = name

            def get_target_name(target_str):
                if target_str in target_names:
                    return target_names[target_str]
                # Fallback: matching IP only
                ip = target_str.split(":")[0] if ":" in target_str else target_str
                for t in targets_list:
                    if t.get("host") == ip:
                        return t.get("name")
                return "Manual"

            def derive_source_port(call_id):
                if call_id and call_id.startswith('CALL-'):
                    try:
                        num = int(call_id[5:])
                        return str(30000 + (num % 10000))
                    except ValueError:
                        pass
                return '?'

            def format_time(ts_str):
                if not ts_str:
                    return "?"
                try:
                    if "T" in ts_str:
                        return ts_str.split("T")[1][:8]
                    return ts_str[:8]
                except Exception:
                    return ts_str

            def quality_badge(q):
                if q == "EXCELLENT":
                    return c("32", "● EXCELLENT")
                elif q == "FAIR":
                    return c("33", "● FAIR")
                else:
                    return c("31", "● POOR")

            # Filter ended calls with valid QoS metrics
            fin = [c_obj for c_obj in stats_list if c_obj.get("event") == "end" and c_obj.get("loss_pct") is not None]

            # 1. Render Overall QoS Summary
            hdr("━━ Voice / VoIP QoS Summary ━━━━━━━━━━━━━━━━━━")
            if not fin:
                print("  Total Calls : 0")
                print("  Avg MOS     : ?")
                print("  Avg Jitter  : ?ms")
                print("  Packet Loss : ?%")
                print("  Avg RTT     : ?ms")
            else:
                avg_loss = sum(c_obj.get("loss_pct", 0) for c_obj in fin) / len(fin)
                rtts = [c_obj.get("avg_rtt_ms", 0) for c_obj in fin if c_obj.get("avg_rtt_ms")]
                avg_rtt = sum(rtts) / len(rtts) if rtts else 0.0
                jitters = [c_obj.get("jitter_ms", 0) for c_obj in fin if c_obj.get("jitter_ms")]
                avg_jitter = sum(jitters) / len(jitters) if jitters else 0.0
                mos_scores = [c_obj.get("mos_score", 0) for c_obj in fin if c_obj.get("mos_score")]
                avg_mos = sum(mos_scores) / len(mos_scores) if mos_scores else 0.0
                
                overall_q = "EXCELLENT" if avg_loss < 1 and avg_rtt < 100 else "FAIR" if avg_loss < 5 and avg_rtt < 200 else "POOR"
                mos_color = "32" if avg_mos >= 4.0 else "33" if avg_mos >= 3.0 else "31"
                
                print(f"  Total Calls : {len(fin)}")
                print(f"  Avg MOS     : {c(mos_color, f'{avg_mos:.2f}')} ({overall_q})")
                print(f"  Avg Jitter  : {avg_jitter:.1f}ms")
                print(f"  Packet Loss : {avg_loss:.1f}%")
                print(f"  Avg RTT     : {avg_rtt:.1f}ms")
            print()

            # 2. Render Per-Target QoS Statistics Table
            hdr("━━ Per-Target QoS Statistics ━━━━━━━━━━━━━━━━━━")
            if not fin:
                dim("  (no stats data available)")
            else:
                grouped = {}
                for call_obj in fin:
                    tgt = call_obj.get("target")
                    if not tgt:
                        continue
                    if tgt not in grouped:
                        grouped[tgt] = []
                    grouped[tgt].append(call_obj)

                pt_rows = []
                for tgt, t_calls in sorted(grouped.items(), key=lambda x: len(x[1]), reverse=True):
                    calls_count = len(t_calls)
                    t_loss = sum(c_obj.get("loss_pct", 0) for c_obj in t_calls) / calls_count
                    t_rtts = [c_obj.get("avg_rtt_ms", 0) for c_obj in t_calls if c_obj.get("avg_rtt_ms")]
                    t_avg_rtt = sum(t_rtts) / len(t_rtts) if t_rtts else 0.0
                    t_jitters = [c_obj.get("jitter_ms", 0) for c_obj in t_calls if c_obj.get("jitter_ms")]
                    t_avg_jitter = sum(t_jitters) / len(t_jitters) if t_jitters else 0.0
                    t_mos_scores = [c_obj.get("mos_score", 0) for c_obj in t_calls if c_obj.get("mos_score")]
                    t_avg_mos = sum(t_mos_scores) / len(t_mos_scores) if t_mos_scores else 0.0
                    
                    t_q = "EXCELLENT" if t_loss < 1 and t_avg_rtt < 100 else "FAIR" if t_loss < 5 and t_avg_rtt < 200 else "POOR"
                    t_name = get_target_name(tgt)
                    
                    pt_rows.append([
                        t_name,
                        tgt,
                        str(calls_count),
                        f"{t_loss:.1f}%",
                        f"{t_avg_rtt:.1f}ms",
                        f"{t_avg_mos:.2f}" if t_avg_mos else "N/A",
                        f"{t_avg_jitter:.1f}ms",
                        quality_badge(t_q)
                    ])
                table(["Site", "Endpoint", "Calls", "Avg Loss", "Avg RTT", "Avg MOS", "Avg Jitter", "Quality"], pt_rows)
            print()

            # 3. Render Call History Table
            hdr("━━ Call History (Recent Events) ━━━━━━━━━━━━━━━━━━")
            history_events = [c_obj for c_obj in stats_list if c_obj.get("event") in ("start", "end", "skipped")]
            if not history_events:
                dim("  (no history events available)")
            else:
                history_rows = []
                for item in history_events[:15]:
                    t_str = format_time(item.get("timestamp"))
                    call_id = item.get("call_id", "?")
                    disp = f"#{call_id}"
                    evt = item.get("event")
                    if evt == "start":
                        status = c("36", "RUNNING")
                    elif evt == "skipped":
                        status = c("33", "SKIPPED")
                    else:
                        status = c("32", "COMPLETED")
                    
                    tgt = item.get("target", "?")
                    site = get_target_name(tgt)
                    sp = derive_source_port(call_id)
                    
                    if evt == "end" and item.get("loss_pct") is not None:
                        loss_val = item.get("loss_pct", 0)
                        loss_color = "32" if loss_val < 1 else "33" if loss_val < 5 else "31"
                        loss_mos = f"{c(loss_color, f'{loss_val:.1f}%')}"
                        if item.get("mos_score") is not None:
                            mos_val = item.get("mos_score")
                            mos_color = "32" if mos_val >= 4 else "33" if mos_val >= 3 else "31"
                            loss_mos += f" (MOS: {c(mos_color, f'{mos_val:.2f}')})"
                    else:
                        loss_mos = "─"
                    
                    if evt == "end" and item.get("avg_rtt_ms") is not None:
                        rtt_val = item.get("avg_rtt_ms", 0)
                        rtt_color = "32" if rtt_val < 100 else "33" if rtt_val < 200 else "31"
                        rtt_jitter = c(rtt_color, f"{rtt_val:.1f}ms")
                        if item.get("jitter_ms") is not None:
                            rtt_jitter += f" (Jitter: {item.get('jitter_ms'):.1f}ms)"
                    else:
                        rtt_jitter = "─"
                    
                    history_rows.append([
                        t_str,
                        disp,
                        status,
                        site,
                        tgt,
                        sp,
                        loss_mos,
                        rtt_jitter
                    ])
                table(["Time", "Call ID", "Status", "Site", "Endpoint", "Src Port", "Loss / MOS", "RTT / Jitter"], history_rows)

    else:
        _help_section("VOICE / VoIP", [
            ("voice start",    "Start global VoIP simulation daemon (calls all enabled targets)"),
            ("voice stop",     "Stop VoIP simulation daemon"),
            ("voice status",   "Show VoIP simulation status"),
            ("voice stats",    "Show MOS / jitter / loss stats"),
        ])


def cmd_iot(args):
    if not require_auth(): return
    sub = args[0] if args else "list"

    if sub == "list":
        r = api_get("/api/iot/devices")
        if r:
            devices = r if isinstance(r, list) else r.get("devices", [])
            rows    = []
            for d in devices:
                running = "✓" if d.get("running") else "✗"
                rows.append([
                    d.get("id","?")[:12], d.get("name","?")[:20],
                    d.get("vendor","?")[:12], d.get("protocol","?"), running
                ])
            table(["ID", "Name", "Vendor", "Protocol", "Run"], rows)

    elif sub == "start":
        did = args[1] if len(args) > 1 else None
        if not did:
            devices_res = api_get("/api/iot/devices")
            if devices_res is None:
                return
            devices = devices_res if isinstance(devices_res, list) else devices_res.get("devices", [])
            ids = [d["id"] for d in devices if "id" in d]
            if not ids:
                info("No IoT devices configured.")
                return
            r = api_post("/api/iot/start-batch", {"ids": ids})
            if r: ok(f"Started {len(ids)} IoT devices")
        else:
            r = api_post(f"/api/iot/start/{did}")
            if r: ok(f"Device {did} started")

    elif sub == "stop":
        did = args[1] if len(args) > 1 else None
        if not did:
            devices_res = api_get("/api/iot/devices")
            if devices_res is None:
                return
            devices = devices_res if isinstance(devices_res, list) else devices_res.get("devices", [])
            ids = [d["id"] for d in devices if "id" in d]
            if not ids:
                info("No IoT devices configured.")
                return
            r = api_post("/api/iot/stop-batch", {"ids": ids})
            if r: ok(f"Stopped {len(ids)} IoT devices")
        else:
            r = api_post(f"/api/iot/stop/{did}")
            if r: ok(f"Device {did} stopped")

    elif sub == "stats":
        r = api_get("/api/iot/stats")
        if r:
            hdr("━━ IoT Stats ━━━━━━━━━━━━━━━━━━━━━━━━━━━")
            rows = [(k, v) for k, v in r.items() if not isinstance(v, (dict, list))]
            table(["Metric","Value"], rows)

    elif sub == "vulns":
        limit = int(args[1]) if len(args) > 1 else 20
        r = api_get(f"/api/iot/vulnerabilities?limit={limit}")
        if r:
            hdr("━━ IoT Vulnerabilities ━━━━━━━━━━━━━━━━━━━")
            items = r if isinstance(r, list) else r.get("vulnerabilities", [])
            rows  = []
            for v in items[:limit]:
                rows.append([
                    v.get("deviceId","?")[:12],
                    v.get("severity","?")[:8],
                    v.get("cve","?")[:15],
                    v.get("description","")[:35],
                ])
            table(["Device", "Severity", "CVE", "Description"], rows)

    elif sub == "import":
        file_path = None
        for arg in args[1:]:
            if not arg.startswith("--"):
                file_path = arg
                break
        
        if not file_path:
            if sys.stdin.isatty():
                try:
                    file_path = input("Enter path to JSON or CSV file to import: ").strip()
                except (KeyboardInterrupt, EOFError):
                    print("\nAborted.")
                    return
            if not file_path:
                err("Usage: iot import <file_path> [--merge] [--max-devices <N>] [--only-iot] [--enable-security] [--security-percentage <pct>]")
                return

        if not os.path.exists(file_path):
            err(f"File not found: {file_path}")
            return

        ext = os.path.splitext(file_path)[1].lower()
        import_type = None
        
        try:
            with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
                first_line = f.readline().strip()
                f.seek(0)
                file_content = f.read()
        except Exception as e:
            err(f"Failed to read file: {e}")
            return

        if ext == ".json":
            import_type = "json"
        elif ext == ".csv":
            headers = [h.strip().replace('"', '').lower() for h in first_line.split(',')]
            if any(col in headers for col in ['hostname', 'mac address', 'category', 'profile_vertical']):
                import_type = "prisma"
            elif any(col in headers for col in ['device name', 'ip address', 'mac address', 'cve', 'cvss', 'severity']):
                import_type = "vuln"
            else:
                if sys.stdin.isatty():
                    print("\nSelect CSV Import Type:")
                    print("  1: Prisma IoT Security Assets Inventory CSV")
                    print("  2: Palo Alto CVE Vulnerability Report CSV")
                    print()
                    try:
                        choice = input("Select type [1]: ").strip()
                        import_type = "vuln" if choice == "2" else "prisma"
                    except (KeyboardInterrupt, EOFError):
                        print("\nAborted.")
                        return
                else:
                    err("Unknown CSV format. Please ensure CSV headers match expected formats.")
                    return
        else:
            if sys.stdin.isatty():
                print("\nSelect Import File Type:")
                print("  1: Stigix JSON Config")
                print("  2: Prisma IoT Security Assets Inventory CSV")
                print("  3: Palo Alto CVE Vulnerability Report CSV")
                print()
                try:
                    choice = input("Select type [1]: ").strip()
                    import_type = {"1": "json", "2": "prisma", "3": "vuln"}.get(choice or "1", "json")
                except (KeyboardInterrupt, EOFError):
                    print("\nAborted.")
                    return
            else:
                err("Cannot determine file type. Use .json or .csv extensions.")
                return

        parsed_flags = parse_flags(args[1:], ["merge", "max-devices", "only-iot", "enable-security", "security-percentage"])
        
        merge_choice = "merge" in args or parsed_flags.get("merge")
        if merge_choice is None or (not merge_choice and "merge" not in args):
            merge_choice = False
            for arg in args[1:]:
                if arg.lower() == "--merge":
                    merge_choice = True
                    break
            if not merge_choice and sys.stdin.isatty() and import_type in ("prisma", "vuln"):
                try:
                    c_merge = input("Merge with existing simulated devices? [y/N]: ").strip().lower()
                    merge_choice = (c_merge == "y")
                except (KeyboardInterrupt, EOFError):
                    print("\nAborted.")
                    return

        if not merge_choice:
            if sys.stdin.isatty():
                try:
                    c_confirm = input("Warning: This will overwrite/replace your current IoT simulation setup. Proceed? [y/N]: ").strip().lower()
                    if c_confirm != "y":
                        print("Aborted.")
                        return
                except (KeyboardInterrupt, EOFError):
                    print("\nAborted.")
                    return

        if import_type == "json":
            info(f"Importing Stigix IoT JSON configuration from {file_path}...")
            r = api_post("/api/iot/config/import", {"content": file_content})
            if r and r.get("success"):
                ok("IoT configuration imported successfully!")
            else:
                err(f"Import failed: {r.get('error') if r else 'Unknown error'}")

        elif import_type == "prisma":
            max_dev = parsed_flags.get("max-devices")
            if max_dev is None:
                for i, arg in enumerate(args):
                    if arg in ("--max", "--max-devices") and i + 1 < len(args):
                        max_dev = args[i+1]
                        break
            if max_dev is None:
                if sys.stdin.isatty():
                    try:
                        max_dev_input = input("Max devices to import [100]: ").strip()
                        max_dev = int(max_dev_input) if max_dev_input else 100
                    except (ValueError, KeyboardInterrupt, EOFError):
                        max_dev = 100
                else:
                    max_dev = 100
            else:
                try:
                    max_dev = int(max_dev)
                except ValueError:
                    max_dev = 100

            only_iot = "only-iot" in args or parsed_flags.get("only-iot")
            if only_iot is None or (not only_iot and "only-iot" not in args):
                only_iot = False
                for arg in args:
                    if arg == "--only-iot":
                        only_iot = True
                        break
                if not only_iot and sys.stdin.isatty():
                    try:
                        only_iot_input = input("Only import IoT category devices? [Y/n]: ").strip().lower()
                        only_iot = (only_iot_input != "n")
                    except (KeyboardInterrupt, EOFError):
                        only_iot = True

            bad_behavior = "auto"
            sec_pct = 30
            enable_security = False
            
            for arg in args:
                if arg == "--enable-security":
                    enable_security = True
                    bad_behavior = "all"
            if "security-percentage" in parsed_flags:
                bad_behavior = "percentage"
                try:
                    sec_pct = int(parsed_flags["security-percentage"])
                except ValueError:
                    sec_pct = 30
            for i, arg in enumerate(args):
                if arg in ("--security-pct", "--security-percentage") and i + 1 < len(args):
                    bad_behavior = "percentage"
                    try:
                        sec_pct = int(args[i+1])
                    except ValueError:
                        sec_pct = 30

            if sys.stdin.isatty() and bad_behavior == "auto" and not enable_security:
                print("\nSelect Security / Bad Behavior configuration:")
                print("  1: Auto (Enable based on risk level in CSV)")
                print("  2: All (Enable attacks on all imported devices)")
                print("  3: None (Disable attacks on all imported devices)")
                print("  4: Percentage (Specify custom percentage of devices to be malicious)")
                print()
                try:
                    sec_choice = input("Select option [1]: ").strip()
                    if sec_choice == "2":
                        bad_behavior = "all"
                        enable_security = True
                    elif sec_choice == "3":
                        bad_behavior = "none"
                        sec_pct = 0
                    elif sec_choice == "4":
                        bad_behavior = "percentage"
                        pct_input = input("Percentage of devices [30]: ").strip()
                        sec_pct = int(pct_input) if pct_input else 30
                    else:
                        bad_behavior = "auto"
                except (ValueError, KeyboardInterrupt, EOFError):
                    bad_behavior = "auto"

            payload = {
                "csv_content": file_content,
                "merge": merge_choice,
                "max_devices": max_dev,
                "only_iot": only_iot,
            }
            if bad_behavior == "all":
                payload["enable_security"] = True
            elif bad_behavior == "none":
                payload["security_percentage"] = 0
            elif bad_behavior == "percentage":
                payload["security_percentage"] = sec_pct

            info(f"Importing Prisma IoT CSV from {file_path}...")
            r = api_post("/api/iot/import-prisma-csv", payload)
            if r and r.get("success"):
                ok(f"Prisma CSV imported: {r.get('imported')} devices ({r.get('bad_behavior')} bad behavior)")
            else:
                err(f"Import failed: {r.get('detail', r.get('error', 'Unknown error')) if r else 'Unknown error'}")

        elif import_type == "vuln":
            max_dev = parsed_flags.get("max-devices")
            if max_dev is None:
                for i, arg in enumerate(args):
                    if arg in ("--max", "--max-devices") and i + 1 < len(args):
                        max_dev = args[i+1]
                        break
            if max_dev is None:
                if sys.stdin.isatty():
                    try:
                        max_dev_input = input("Max devices to import [50]: ").strip()
                        max_dev = int(max_dev_input) if max_dev_input else 50
                    except (ValueError, KeyboardInterrupt, EOFError):
                        max_dev = 50
                else:
                    max_dev = 50
            else:
                try:
                    max_dev = int(max_dev)
                except ValueError:
                    max_dev = 50

            only_iot = "only-iot" in args or parsed_flags.get("only-iot")
            if only_iot is None or (not only_iot and "only-iot" not in args):
                only_iot = False
                for arg in args:
                    if arg == "--only-iot":
                        only_iot = True
                        break
                if not only_iot and sys.stdin.isatty():
                    try:
                        only_iot_input = input("Only import IoT category devices? [Y/n]: ").strip().lower()
                        only_iot = (only_iot_input != "n")
                    except (KeyboardInterrupt, EOFError):
                        only_iot = True

            bad_behavior = "auto"
            sec_pct = 80
            enable_security = False
            
            for arg in args:
                if arg == "--enable-security":
                    enable_security = True
                    bad_behavior = "all"
            if "security-percentage" in parsed_flags:
                bad_behavior = "percentage"
                try:
                    sec_pct = int(parsed_flags["security-percentage"])
                except ValueError:
                    sec_pct = 80
            for i, arg in enumerate(args):
                if arg in ("--security-pct", "--security-percentage") and i + 1 < len(args):
                    bad_behavior = "percentage"
                    try:
                        sec_pct = int(args[i+1])
                    except ValueError:
                        sec_pct = 80

            if sys.stdin.isatty() and bad_behavior == "auto" and not enable_security:
                print("\nSelect Security / Bad Behavior configuration:")
                print("  1: Auto (Enable based on risk level in CSV)")
                print("  2: All (Enable attacks on all imported devices)")
                print("  3: None (Disable attacks on all imported devices)")
                print("  4: Percentage (Specify custom percentage of devices to be malicious)")
                print()
                try:
                    sec_choice = input("Select option [1]: ").strip()
                    if sec_choice == "2":
                        bad_behavior = "all"
                        enable_security = True
                    elif sec_choice == "3":
                        bad_behavior = "none"
                        sec_pct = 0
                    elif sec_choice == "4":
                        bad_behavior = "percentage"
                        pct_input = input("Percentage of devices [80]: ").strip()
                        sec_pct = int(pct_input) if pct_input else 80
                    else:
                        bad_behavior = "auto"
                except (ValueError, KeyboardInterrupt, EOFError):
                    bad_behavior = "auto"

            payload = {
                "csv_content": file_content,
                "merge": merge_choice,
                "max_devices": max_dev,
                "only_iot": only_iot,
            }
            if bad_behavior == "all":
                payload["enable_security"] = True
            elif bad_behavior == "none":
                payload["security_percentage"] = 0
            elif bad_behavior == "percentage":
                payload["security_percentage"] = sec_pct

            info(f"Importing Vulnerability CSV from {file_path}...")
            r = api_post("/api/iot/import-vuln-csv", payload)
            if r and r.get("success"):
                ok(f"Vulnerability CSV imported: {r.get('imported')} devices ({r.get('bad_behavior')} bad behavior, {r.get('ics_cert_devices', 0)} ICS-CERT)")
            else:
                err(f"Import failed: {r.get('detail', r.get('error', 'Unknown error')) if r else 'Unknown error'}")

    elif sub == "export":
        file_path = args[1] if len(args) > 1 else None
        if not file_path:
            if sys.stdin.isatty():
                try:
                    file_path = input("Enter path to save JSON file [iot-devices.json]: ").strip()
                except (KeyboardInterrupt, EOFError):
                    print("\nAborted.")
                    return
            if not file_path:
                file_path = "iot-devices.json"

        info(f"Exporting IoT simulation configuration to {file_path}...")
        r = api_get("/api/iot/config/export")
        if r:
            try:
                with open(file_path, "w", encoding="utf-8") as f:
                    json.dump(r, f, indent=2)
                ok(f"IoT configuration exported to {file_path}")
            except Exception as e:
                err(f"Failed to write export file: {e}")

    else:
        _help_section("IoT SIMULATION", [
            ("iot list",          "List simulated devices"),
            ("iot start [id]",    "Start one or all devices"),
            ("iot stop [id]",     "Stop one or all devices"),
            ("iot stats",         "Show simulation stats"),
            ("iot vulns [n]",     "Show vulnerability findings"),
            ("iot import <file>", "Import JSON config or CSV report"),
            ("iot export [file]", "Export devices to JSON file"),
        ])


def cmd_system(args):
    if not require_auth(): return
    sub = args[0] if args else "info"

    if sub == "info":
        hdr("━━ System Info ━━━━━━━━━━━━━━━━━━━━━━━━━━")
        r = api_get("/api/admin/system/dashboard-data")
        if r:
            for k, v in r.items():
                if not isinstance(v, (dict, list)):
                    info(f"{k}: {v}")
        health = api_get("/api/system/health")
        if health:
            sys_obj = health.get("system", {})
            mem  = sys_obj.get("memory", {})
            disk = sys_obj.get("disk", {})
            print(f"  Memory  : {mem.get('usedPercent','?')}%  "
                  f"({mem.get('used',0)//1024//1024}MB / {mem.get('total',0)//1024//1024}MB)")
            print(f"  Disk    : {disk.get('usedPercent','?')}%  "
                  f"({disk.get('used',0)//1024//1024//1024}GB / {disk.get('total',0)//1024//1024//1024}GB)")

    elif sub == "restart":
        confirm = input("Restart Stigix containers? [y/N]: ").strip().lower()
        if confirm == "y":
            r = api_post("/api/admin/maintenance/restart")
            if r: ok("Restart initiated")
        else:
            dim("Cancelled")

    elif sub == "upgrade":
        if len(args) > 1 and args[1] in ("--help", "-h", "help"):
            _help_section("SYSTEM UPGRADE", [
                ("system upgrade",            "Interactive upgrade wizard (checks current version & lets you choose tags)"),
                ("system upgrade <tag>",      "Directly upgrade to the specified tag (e.g. stable, latest, v1.4.0)"),
            ])
            return

        target_tag = args[1] if len(args) > 1 else None

        if target_tag:
            # Direct tag upgrade
            if not sys.stdin.isatty():
                selected_tag = target_tag
            else:
                confirm = input(f"Upgrade Stigix to tag '{target_tag}'? [y/N]: ").strip().lower()
                if confirm == "y":
                    selected_tag = target_tag
                else:
                    dim("Cancelled")
                    return
        else:
            # Interactive upgrade wizard
            info("Checking current system version and updates...")
            v_info = api_get("/api/admin/maintenance/version")
            
            current_version = "unknown"
            latest_version = "unknown"
            update_avail = False
            
            if v_info:
                current_version = v_info.get("current", "unknown")
                latest_version = v_info.get("latest", "unknown")
                update_avail = v_info.get("updateAvailable", False)
                
            print(f"  Current version : {c('36', current_version)}")
            print(f"  Latest version  : {c('32', latest_version)} " + (c('33', "(update available)") if update_avail else "(up to date)"))
            print()
            
            if not sys.stdin.isatty():
                info("Non-interactive mode: defaulting upgrade tag to 'latest'")
                selected_tag = "latest"
            else:
                print("Select version / tag to upgrade to:")
                print(f"  1. Latest available release ({latest_version})")
                print("  2. 'latest' tag (latest beta/dev image)")
                print("  3. 'stable' tag (stable production image)")
                print("  4. Custom tag / version")
                print("  5. Cancel")
                print()
                
                choice = input("Enter choice [1-5]: ").strip()
                if choice == "1":
                    selected_tag = latest_version
                elif choice == "2":
                    selected_tag = "latest"
                elif choice == "3":
                    selected_tag = "stable"
                elif choice == "4":
                    custom_tag = input("Enter custom tag / version: ").strip()
                    if not custom_tag:
                        err("Custom tag cannot be empty. Cancelled.")
                        return
                    selected_tag = custom_tag
                else:
                    dim("Cancelled")
                    return
                
                confirm = input(f"Proceed with upgrade to '{selected_tag}'? [y/N]: ").strip().lower()
                if confirm != "y":
                    dim("Cancelled")
                    return

        # Execute the upgrade
        r = api_post("/api/admin/maintenance/upgrade", body={"version": selected_tag})
        if r:
            ok(f"Upgrade to '{selected_tag}' initiated successfully")
            print()
            
            # Start polling progress
            info("Monitoring upgrade progress...")
            last_log_idx = 0
            restarting_seen = False
            max_retries = 120  # up to 6 minutes
            retry_count = 0
            current_stage = None
            
            while retry_count < max_retries:
                try:
                    resp = HTTP_SESSION.get(f"{STIGIX_URL}/api/admin/maintenance/status", headers=_headers(), timeout=4)
                    if resp.status_code == 200:
                        data = resp.json()
                        stage = data.get("stage", "idle")
                        in_progress = data.get("inProgress", False)
                        logs = data.get("logs", [])
                        error = data.get("error")
                        
                        # Print new log lines
                        if len(logs) > last_log_idx:
                            for line in logs[last_log_idx:]:
                                if line.startswith("[ERROR]"):
                                    err(line)
                                elif line.startswith("[WARN]"):
                                    warn(line)
                                else:
                                    dim(f"  {line}")
                            last_log_idx = len(logs)
                            
                        if stage != current_stage:
                            current_stage = stage
                            if stage == "pruning":
                                info("Stage: Pruning unused Docker layers/containers...")
                            elif stage == "pulling":
                                info("Stage: Pulling target Docker image...")
                            elif stage == "restarting":
                                info("Stage: Recreating and restarting Stigix containers...")
                                restarting_seen = True
                            elif stage == "complete":
                                ok("Upgrade completed successfully! Backend is back online.")
                                return
                            elif stage == "failed":
                                err(f"Upgrade failed: {error or 'Unknown error'}")
                                return
                                
                        if not in_progress and stage == "complete":
                            ok("Upgrade completed successfully! Backend is back online.")
                            return
                        if not in_progress and stage == "failed":
                            err(f"Upgrade failed: {error or 'Unknown error'}")
                            return
                            
                    elif resp.status_code == 401:
                        err("Session unauthorized. Upgrade aborted.")
                        return
                        
                except (requests.exceptions.ConnectionError, requests.exceptions.Timeout):
                    if restarting_seen:
                        print(c("33", "  ⌛ Waiting for Stigix backend to come back online..."))
                        last_log_idx = 0
                    else:
                        # Connection lost momentarily before restart phase
                        pass
                        
                time.sleep(3)
                retry_count += 1
                
            err("Monitoring timed out. The upgrade pull completed but the container may not have restarted automatically.")
            warn("This can happen when the container restarts itself — the CLI loses connection before 'up -d' can run.")
            print()
            info("Run this from your host to bring it back up:")
            print(c("1;36", "    cd stigix && docker compose up -d"))
            print()

    elif sub == "interfaces":
        r = api_get("/api/system/interfaces")
        if r:
            ifaces = r if isinstance(r, list) else r.get("interfaces", [])
            for iface in ifaces:
                n = iface if isinstance(iface, str) else iface.get("name","?")
                info(n)

    elif sub == "logs":
        r = api_get("/api/logs")
        if r:
            lines = r if isinstance(r, list) else (r.get("logs") or r.get("lines") or [])
            for line in lines[-30:]:
                dim(line)

    else:
        _help_section("SYSTEM", [
            ("system info",          "System health, memory, disk"),
            ("system interfaces",    "List network interfaces"),
            ("system logs",          "Show backend logs (last 30 lines)"),
            ("system restart",       "Restart Stigix containers"),
            ("system upgrade",       "Pull latest Docker image"),
        ])


def cmd_connect(args):
    """Connect to a Stigix instance by IP/URL or by saved profile name.

    connect                       — show current instance + saved profiles
    connect <ip[:port]|url>       — connect to instance (tests reachability)
    connect save <name> [url]     — save current (or given) URL as a named profile
    connect forget <name>         — delete a saved profile
    connect list                  — list all saved profiles
    """
    global STIGIX_URL, JWT_TOKEN, PROFILES, INSTANCE_TOKENS

    sub = args[0] if args else None

    if sub in ("--help", "-h", "help"):
        _help_section("CONNECT", [
            ("connect",                    "Show current connection + saved profiles"),
            ("connect <ip[:port]|url>",    "Connect to a Stigix instance"),
            ("connect <profile-name>",     "Connect to a saved profile"),
            ("connect save <name> [url]",  "Save current URL as a named profile"),
            ("connect forget <name>",      "Delete a saved profile"),
            ("connect list",               "List all saved profiles"),
        ])
        return

    # ── connect (no args) — show current + profiles ──────────────────────────
    if not sub:
        host = STIGIX_URL.replace("https://","").replace("http://","")
        print(f"  Current  : {c('1;36', host)}  {'(' + c('32','authenticated') + ')' if JWT_TOKEN else c('33','no auth')}")
        if PROFILES:
            print()
            hdr("  Saved profiles:")
            for name, prof in PROFILES.items():
                u = prof.get("url","?")
                has_tok = "✓ token" if prof.get("token") else "  no token"
                active  = " ◀ active" if u == STIGIX_URL else ""
                print(f"    {c('36', name):<20}  {u:<30}  {dim(has_tok)}{c('32', active)}")
        else:
            dim("  No saved profiles — use: connect save <name>")
        return

    # ── connect list ─────────────────────────────────────────────────────────
    if sub == "list":
        if not PROFILES:
            dim("No saved profiles")
            return
        rows = []
        for name, prof in PROFILES.items():
            u       = prof.get("url","?")
            has_tok = "✓" if prof.get("token") else "✗"
            active  = "◀" if u == STIGIX_URL else ""
            rows.append([name, u, has_tok, active])
        table(["Name", "URL", "Token", ""], rows)
        return

    # ── connect save <name> [url] ─────────────────────────────────────────────
    if sub == "save":
        name = args[1] if len(args) > 1 else None
        if not name:
            err("Usage: connect save <name> [url]"); return
        url  = args[2] if len(args) > 2 else STIGIX_URL
        if not url.startswith("http"):
            url = f"http://{url}"
        # Save current token only if the URL matches current session
        tok = JWT_TOKEN if url == STIGIX_URL else PROFILES.get(name, {}).get("token")
        PROFILES[name] = {"url": url, "token": tok}
        save_session()
        ok(f"Profile '{name}' saved → {url}")
        return

    # ── connect forget <name> ─────────────────────────────────────────────────
    if sub == "forget":
        name = args[1] if len(args) > 1 else None
        if not name:
            err("Usage: connect forget <name>"); return
        if name not in PROFILES:
            err(f"No profile named '{name}'"); return
        del PROFILES[name]
        save_session()
        ok(f"Profile '{name}' removed")
        return

    # ── connect <name-or-url> ─────────────────────────────────────────────────
    # Check if the argument matches a saved profile name first
    if sub in PROFILES:
        prof = PROFILES[sub]
        url  = prof["url"]
        tok  = prof.get("token")
        info(f"Connecting to profile '{sub}' → {url}")
    else:
        url = sub
        if not url.startswith("http"):
            # Bare IP or hostname — add port 8080 if no port given
            if ":" not in url.split("/")[-1]:
                url = f"http://{url}:8080"
            else:
                url = f"http://{url}"
        tok = INSTANCE_TOKENS.get(url)
        if not tok:
            for name, prof in PROFILES.items():
                if prof.get("url") == url and prof.get("token"):
                    tok = prof.get("token")
                    break

    old_url = STIGIX_URL
    old_tok = JWT_TOKEN
    STIGIX_URL = url
    JWT_TOKEN  = tok  # restore profile token (may be None)

    r = api_get("/api/version")
    if r:
        # Update profile token after successful connect (token may come from profile)
        if sub in PROFILES:
            PROFILES[sub]["token"] = JWT_TOKEN
        save_session()
        STATUS.invalidate()
        ver = r.get("version","?")
        if JWT_TOKEN:
            ok(f"Connected to {url} — version {ver}  (token restored, session saved)")
        else:
            ok(f"Connected to {url} — version {ver}")
            warn("No token for this instance — run: auth login")
    else:
        warn(f"Could not reach {url}, reverting to {old_url}")
        STIGIX_URL = old_url
        JWT_TOKEN  = old_tok


def cmd_autocomplete(args):
    global AUTOCOMPLETE_ENABLED
    sub = args[0] if args else "status"
    
    if sub in ("--help", "-h", "help"):
        _help_section("AUTOCOMPLETE", [
            ("autocomplete status", "Show whether autocompletion is enabled"),
            ("autocomplete on",     "Enable CLI tab autocompletion"),
            ("autocomplete off",    "Disable CLI tab autocompletion"),
        ])
        return
        
    if sub == "on":
        AUTOCOMPLETE_ENABLED = True
        save_session()
        ok("Autocompletion enabled")
    elif sub == "off":
        AUTOCOMPLETE_ENABLED = False
        save_session()
        ok("Autocompletion disabled")
    elif sub == "status":
        state = "enabled" if AUTOCOMPLETE_ENABLED else "disabled"
        info(f"Autocompletion: {status_badge(state)}")
    else:
        err("Usage: autocomplete on | off | status")


def cmd_history(args):
    """Manage session command history.

    history                       — show commands run in this session
    history dump                  — dump all history (session + persistent) for copy-paste scripting
    history save <filename>       — save session commands to a local script file
    history clear                 — clear the session history in memory
    """
    global SESSION_HISTORY
    sub = args[0].lower() if args else "list"
    
    if sub in ("--help", "-h", "help"):
        _help_section("HISTORY", [
            ("history",                   "Show commands run in the current session"),
            ("history dump",              "Dump all history (session + file) — clean, copy-paste ready"),
            ("history save <filename>",   "Save session commands to a script file"),
            ("history clear",             "Clear current session history"),
        ])
        return

    if sub == "list":
        if not SESSION_HISTORY:
            dim("  (session history is empty)")
            dim(f"  prompt history file: {HISTORY_FILE}")
            return
        hdr("━━ Session Command History ━━━━━━━━━━━━━━━━━")
        for i, cmd in enumerate(SESSION_HISTORY, 1):
            print(f"  {i:>3}  {cmd}")
        dim(f"  prompt history file: {HISTORY_FILE}")

    elif sub == "dump":
        # Collect persistent history from HISTORY_FILE (prompt_toolkit format: lines starting with +)
        persistent = []
        if HISTORY_FILE.exists():
            try:
                for line in HISTORY_FILE.read_text(errors="replace").splitlines():
                    if line.startswith("+"):
                        persistent.append(line[1:])  # strip the leading +
            except Exception:
                pass
        # Merge: persistent (older) then current session (newer), deduplicate keeping order
        seen = set()
        all_cmds = []
        for cmd in persistent + SESSION_HISTORY:
            if cmd and cmd not in seen:
                seen.add(cmd)
                all_cmds.append(cmd)
        if not all_cmds:
            dim("  (no history found)")
            return
        print(f"# Stigix CLI history dump — {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        print(f"# {len(all_cmds)} unique commands  |  source: session + {HISTORY_FILE}")
        print()
        for cmd in all_cmds:
            print(cmd)
            
    elif sub == "clear":
        SESSION_HISTORY = []
        ok("Session command history cleared.")
        
    elif sub == "save":
        if len(args) < 2:
            err("Usage: history save <filename>")
            return
        filename = args[1]
        try:
            with open(filename, "w") as f:
                f.write("# Stigix CLI Auto-Generated Script\n")
                f.write("# Generated on " + datetime.now().strftime("%Y-%m-%d %H:%M:%S") + "\n\n")
                for cmd in SESSION_HISTORY:
                    f.write(cmd + "\n")
            ok(f"Saved {len(SESSION_HISTORY)} commands to {filename}")
        except Exception as e:
            err(f"Failed to save history: {e}")
    else:
        err("Usage: history [list | dump | save <filename> | clear]")


def cmd_help(args):
    """Full help screen."""
    do_clear()
    hdr("╔══════════════════════════════════════════════════════════╗")
    hdr(f"║  stigix-cli v{VERSION:<8} (Beta) — Stigix Local Console      ║")
    hdr("╚══════════════════════════════════════════════════════════╝")
    print(f"""
  {c('1','GENERAL')}
    connect                Connect to instance (show current + profiles)
    connect <ip[:port]>    Connect to any Stigix instance by IP
    connect <name>         Connect to a saved profile
    connect save <name>    Save current instance as named profile
    connect forget <name>  Remove a saved profile
    connect list           List all saved profiles
    status                 Global overview: backend, traffic, public IP
    auth login|logout      Authenticate / clear session
    autocomplete on|off    Enable / disable tab autocompletion
    history                Show commands run in current session
    history save <file>    Save session commands to a script file
    history clear          Clear current session command history

  {c('1','TRAFFIC')}
    traffic start|stop     Enable / disable traffic generation
    traffic status|stats   Show traffic state, rate, and active apps dashboard
    traffic speed [val]    Get or set delay in seconds or preset (turbo/fast/normal/slow)
    traffic density [val]  Get or set parallel clients count (1-20)
    traffic logs           Show last log lines
    traffic reset          Reset statistics
    traffic export [file]  Export traffic configuration to JSON
    traffic import <file>  Import traffic configuration from JSON

  {c('1','SECURITY')}
    security status        Blocked / allowed aggregate stats
    security url <url>     Test a single URL
    security url-batch     Test all enabled URL categories
    security dns <domain>  Test a DNS domain
    security dns-batch     Test all enabled DNS domains
    security eicar [ip]    EICAR Threat Prevention test
    security suite         {c('36','Run full security test suite')}
    security results [n]   Last N results (default 20)
    security clear         Clear history

  {c('1','TARGET PROBES')}
    probes list            List connectivity probe targets
    probes stats           Show historical scores, latency, and reliability
    probes add             Add a new probe (--name --host --type --port)
    probes remove <id>     Remove a probe
    probes probe           Run all probes now
    probes export [file]   Export custom probes to JSON
    probes import <file>   Import custom probes from JSON

  {c('1','STIGIX TARGETS')}
    target list            List configured Stigix targets
    target add             Add a target manually (--name --host)
    target remove <id>     Remove a target
    target enable <id>     Enable a target
    target disable <id>    Disable a target
    target export [file]   Export targets to JSON
    target import <file>   Import targets from JSON

  {c('1','TARGET CONTROLLER / LEADER')}
    controller status      Show node role, site name, and peer stats
    controller peers       List registered remote branch nodes
    controller set-leader  Point this node to a central Leader (<ip|url>)
    controller autodiscover Revert to Cloudflare dynamic autodiscovery
    controller test <url>  Test reachability to a remote Leader
    controller site-name   Get or update local node site name
    controller onboard     Generate peer onboarding curl one-liner

  {c('1','GLOBAL PROVISIONING')}
    provision status       Show provisioning state and bundle revisions
    provision enable / on  Enable Global Provisioning pull mode
    provision disable / off Disable Global Provisioning
    provision publish      Publish local bundle(s) to all peers ([type|all])
    provision rollback     Rollback a bundle to an earlier revision
    provision history      Show recent provisioning audit trail
    provision pending      Check for unpublished local changes

  {c('1','SPEEDTEST / XFR BANDWIDTH')}
    speedtest list         Show past speedtest jobs
    speedtest run <host>   Run speedtest (--port --protocol --direction)

  {c('1','FAILOVER MONITORING')}
    failover start      Start failover test  (--target --pps --label)
    failover stop       Stop running test
    failover status     Running test state
    failover history    Past test results
    failover endpoints  Saved endpoints
    failover watch [s]  {c('36','Live poll until Ctrl+C')}

  {c('1','VOICE / VoIP')}
    voice start            Start global VoIP simulation daemon
    voice stop             Stop VoIP simulation daemon
    voice status           Show VoIP simulation status
    voice stats            MOS / jitter / loss stats

  {c('1','VyOS CONTROL')}
    vyos list              Configured routers
    vyos sequences         Action sequences
    vyos run <id>          Execute a sequence
    vyos stop <id>         Stop a sequence
    vyos history [n]       Execution history
    vyos export [file]     Export config to JSON
    vyos import <file>     Import config from JSON

  {c('1','IoT SIMULATION')}
    iot list               Simulated devices
    iot start [id]         Start one or all
    iot stop [id]          Stop one or all
    iot stats              Simulation stats
    iot vulns [n]          Vulnerability findings
    iot import <file>      Import config/CSV
    iot export [file]      Export config to JSON

  {c('1','SD-WAN FLOWS')}
    flows query            Query SD-WAN Flow Browser (interactive or flags)

  {c('1','SYSTEM')}
    system info            Health, memory, disk
    system interfaces      Network interfaces
    system logs            Backend logs (last 30 lines)
    system restart         Restart containers
    system upgrade         Pull latest Docker image

  {c('1','OTHER')}
    help / ?               This screen
    exit / quit            Exit stigix-cli

  {c('2','KEYBOARD SHORTCUTS')}
    F1                     Help
    F5                     Status
    Ctrl+L                 Clear screen
    Tab                    Autocomplete
    ↑ / ↓                  Command history

  {c('2','TIPS')}
    Session is saved to ~/.stigix-cli.json (auto-loaded on start)
    Set STIGIX_URL=http://host:port to change default instance
    stigix-cli --exec "security suite"  for headless / scripted use
""")


# ─── Inline help helper ───────────────────────────────────────────────────────

def _help_section(title, cmds):
    hdr(f"━━ {title} ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
    w = max(len(cmd) for cmd, _ in cmds) + 2
    for cmd, desc in cmds:
        print(f"  {c('36', cmd):<{w+12}}  {desc}")


# ─── Utility ──────────────────────────────────────────────────────────────────

def parse_flags(args, keys):
    result = {}
    i = 0
    while i < len(args):
        a = args[i]
        if a.startswith("--"):
            k = a[2:]
            if k in keys:
                result[k] = args[i+1] if i+1 < len(args) else True
                i += 2
                continue
        i += 1
    return result


class StigixCompleter(Completer):
    def __init__(self, tree):
        self.tree = tree

    def get_completions(self, document, complete_event):
        if not AUTOCOMPLETE_ENABLED:
            return
        text = document.text_before_cursor
        words = text.split()
        if not text:
            for cmd in self.tree.keys():
                yield Completion(cmd, start_position=0)
            return

        in_space = text.endswith(' ')
        current_word = words[-1] if not in_space else ""
        prefix_words = words[:-1] if not in_space else words

        if len(prefix_words) == 0:
            for cmd in self.tree.keys():
                if cmd.startswith(current_word):
                    yield Completion(cmd, start_position=-len(current_word))
            return

        cmd = prefix_words[0].lower()
        if cmd not in self.tree or self.tree[cmd] is None:
            return

        if len(prefix_words) == 1:
            subcmds = self.tree[cmd]
            if isinstance(subcmds, dict):
                for sub in subcmds.keys():
                    if sub.startswith(current_word):
                        yield Completion(sub, start_position=-len(current_word))
                if cmd == "connect" and PROFILES:
                    for profile_name in PROFILES.keys():
                        if profile_name.startswith(current_word):
                            yield Completion(profile_name, start_position=-len(current_word))
            return

        subcmd = prefix_words[1].lower()
        subcmds = self.tree[cmd]
        if not isinstance(subcmds, dict) or subcmd not in subcmds:
            return

        # Suggest profiles to forget
        if cmd == "connect" and subcmd == "forget":
            if PROFILES:
                for profile_name in PROFILES.keys():
                    if profile_name.startswith(current_word):
                        yield Completion(profile_name, start_position=-len(current_word))
            return

        # Special case: suggest local JSON or CSV files for import / export
        if subcmd in ("import", "export"):
            import glob
            files = set()
            patterns = ["*.json"]
            if subcmd == "import":
                patterns.append("*.csv")
                
            for pattern in patterns:
                # 1. Current working directory
                for f in glob.glob(pattern):
                    files.add(f)
                # 2. config/
                if os.path.exists("config"):
                    for f in glob.glob(f"config/{pattern}"):
                        files.add(f)
                # 3. /app/config/
                if os.path.exists("/app/config"):
                    for f in glob.glob(f"/app/config/{pattern}"):
                        files.add(f"/app/config/{os.path.basename(f)}")
                        files.add(os.path.basename(f))
            
            for f in sorted(files):
                if f.startswith(current_word):
                    yield Completion(f, start_position=-len(current_word))
            return

        options = subcmds[subcmd]
        if not isinstance(options, dict):
            return

        last_word = prefix_words[-1] if len(prefix_words) > 0 else ""
        if last_word in options and isinstance(options[last_word], (set, list, dict)):
            choices = options[last_word]
            for choice in choices:
                if choice.startswith(current_word):
                    yield Completion(choice, start_position=-len(current_word))
            return

        typed_flags = set(w for w in prefix_words if w.startswith('--'))
        for flag in options.keys():
            if not flag.startswith('--') or flag not in typed_flags:
                if flag.startswith(current_word):
                    yield Completion(flag, start_position=-len(current_word))


DISPATCH = {
    "auth":           cmd_auth,
    "status":         cmd_status,
    "traffic":        cmd_traffic,
    "security":       cmd_security,
    "experience":     cmd_experience,
    "probes":         cmd_experience,
    "probe":          cmd_experience,
    "target":         cmd_peer,
    "peer":           cmd_peer,
    "controller":     cmd_controller,
    "registry":       cmd_controller,
    "leader":         cmd_controller,
    "provision":      cmd_provision,
    "provisioning":   cmd_provision,
    "prov":           cmd_provision,
    "speedtest":      cmd_speedtest,
    "failover":       cmd_failover,
    "convergence":    cmd_failover,
    "vyos":           cmd_vyos,
    "voice":          cmd_voice,
    "flows":          cmd_flows,
    "iot":            cmd_iot,
    "system":         cmd_system,
    "connect":        cmd_connect,
    "history":        cmd_history,
    "autocomplete":   cmd_autocomplete,
    "autocompletion": cmd_autocomplete,
    "help":           cmd_help,
    "?":              cmd_help,
}

COMPLETER_TREE = {
    "auth":        {"login": None, "logout": None, "status": None},
    "flows":       {"query": {
        "--site": None, "--protocol": {"tcp", "udp", "icmp"},
        "--src-ip": None, "--dst-ip": None,
        "--src-port": None, "--dst-port": None,
        "--minutes": None, "--fast": None
    }},
    "status":      None,
    "connect":     {"list": None, "save": None, "forget": None},
    "history":     {"list": None, "dump": None, "save": None, "clear": None},
    "autocomplete": {"on": None, "off": None, "status": None},
    "autocompletion": {"on": None, "off": None, "status": None},
    "traffic":     {
        "start": None, "stop": None, "status": None,
        "stats": None, "logs": None, "reset": None,
        "import": None, "export": None,
        "speed": {"turbo": None, "fast": None, "normal": None, "slow": None},
        "density": None,
    },
    "security":    {
        "status": None,
        "url": None, "url-batch": None,
        "dns": None, "dns-batch": None,
        "eicar": None,
        "suite": None, "results": None, "clear": None,
        "select-all": {"url": {"on": None, "off": None}, "dns": {"on": None, "off": None}},
        "schedule": {
            "url": {"on": None, "off": None},
            "dns": {"on": None, "off": None},
            "threat": {"on": None, "off": None}
        },
    },
    "experience":  {
        "list": None, "probe": None, "remove": None, "stats": None,
        "import": None, "export": None,
        "add":  {"--name": None, "--target": None, "--host": None, "--url": None,
                 "--type": {"http", "https", "ping", "icmp", "tcp", "udp", "dns"},
                 "--port": None, "--timeout": None},
    },
    "probes":      {
        "list": None, "probe": None, "remove": None, "stats": None,
        "import": None, "export": None,
        "add":  {"--name": None, "--target": None, "--host": None, "--url": None,
                 "--type": {"http", "https", "ping", "icmp", "tcp", "udp", "dns"},
                 "--port": None, "--timeout": None},
    },
    "probe":       {
        "list": None, "probe": None, "remove": None, "stats": None,
        "import": None, "export": None,
        "add":  {"--name": None, "--target": None, "--host": None, "--url": None,
                 "--type": {"http", "https", "ping", "icmp", "tcp", "udp", "dns"},
                 "--port": None, "--timeout": None},
    },
    "target":      {
        "list": None, "remove": None, "enable": None, "disable": None,
        "import": None, "export": None,
        "add":  {"--name": None, "--host": None,
                 "--voice": {"true", "false"},
                 "--convergence": {"true", "false"},
                 "--failover": {"true", "false"},
                 "--xfr": {"true", "false"},
                 "--security": {"true", "false"},
                 "--connectivity": {"true", "false"}},
    },
    "peer":        {
        "list": None, "remove": None, "enable": None, "disable": None,
        "import": None, "export": None,
        "add":  {"--name": None, "--host": None,
                 "--voice": {"true", "false"},
                 "--convergence": {"true", "false"},
                 "--failover": {"true", "false"},
                 "--xfr": {"true", "false"},
                 "--security": {"true", "false"},
                 "--connectivity": {"true", "false"}},
    },
    "controller": {
        "status": None, "info": None, "peers": None, "list": None, "nodes": None,
        "set-leader": None, "connect": None, "join": None,
        "unset-leader": None, "autodiscover": None, "reset": None,
        "test": None, "ping": None, "check": None,
        "site-name": None, "name": None, "rename": None,
        "onboard-command": None, "onboard": None, "install-cmd": None
    },
    "registry": {
        "status": None, "info": None, "peers": None, "list": None, "nodes": None,
        "set-leader": None, "connect": None, "join": None,
        "unset-leader": None, "autodiscover": None, "reset": None,
        "test": None, "ping": None, "check": None,
        "site-name": None, "name": None, "rename": None,
        "onboard-command": None, "onboard": None, "install-cmd": None
    },
    "leader": {
        "status": None, "info": None, "peers": None, "list": None, "nodes": None,
        "set-leader": None, "connect": None, "join": None,
        "unset-leader": None, "autodiscover": None, "reset": None,
        "test": None, "ping": None, "check": None,
        "site-name": None, "name": None, "rename": None,
        "onboard-command": None, "onboard": None, "install-cmd": None
    },
    "provision": {
        "status": None, "info": None,
        "on": None, "off": None, "enable": None, "disable": None, "start": None, "stop": None,
        "publish": {
            "applications": None, "apps": None,
            "probes": None, "connectivity-probes": None,
            "sla": None, "convergence-sla": None,
            "security": None, "security-config": None,
            "voice": None, "voice-config": None,
            "iot": None, "iot-config": None,
            "prisma": None, "prisma-sase": None,
            "all": None
        },
        "rollback": {
            "applications": None, "apps": None,
            "probes": None, "connectivity-probes": None,
            "sla": None, "convergence-sla": None,
            "security": None, "security-config": None,
            "voice": None, "voice-config": None,
            "iot": None, "iot-config": None,
            "prisma": None, "prisma-sase": None
        },
        "history": None, "logs": None, "pending": None, "diff": None
    },
    "provisioning": {
        "status": None, "info": None,
        "on": None, "off": None, "enable": None, "disable": None, "start": None, "stop": None,
        "publish": {
            "applications": None, "apps": None,
            "probes": None, "connectivity-probes": None,
            "sla": None, "convergence-sla": None,
            "security": None, "security-config": None,
            "voice": None, "voice-config": None,
            "iot": None, "iot-config": None,
            "prisma": None, "prisma-sase": None,
            "all": None
        },
        "rollback": {
            "applications": None, "apps": None,
            "probes": None, "connectivity-probes": None,
            "sla": None, "convergence-sla": None,
            "security": None, "security-config": None,
            "voice": None, "voice-config": None,
            "iot": None, "iot-config": None,
            "prisma": None, "prisma-sase": None
        },
        "history": None, "logs": None, "pending": None, "diff": None
    },
    "prov": {
        "status": None, "info": None,
        "on": None, "off": None, "enable": None, "disable": None, "start": None, "stop": None,
        "publish": {
            "applications": None, "apps": None,
            "probes": None, "connectivity-probes": None,
            "sla": None, "convergence-sla": None,
            "security": None, "security-config": None,
            "voice": None, "voice-config": None,
            "iot": None, "iot-config": None,
            "prisma": None, "prisma-sase": None,
            "all": None
        },
        "rollback": {
            "applications": None, "apps": None,
            "probes": None, "connectivity-probes": None,
            "sla": None, "convergence-sla": None,
            "security": None, "security-config": None,
            "voice": None, "voice-config": None,
            "iot": None, "iot-config": None,
            "prisma": None, "prisma-sase": None
        },
        "history": None, "logs": None, "pending": None, "diff": None
    },
    "speedtest":   {
        "list": None, "history": None,
        "run":  {"--port": None,
                 "--protocol": {"tcp", "udp", "quic"},
                 "--direction": {"client-to-server", "server-to-client", "bidirectional"},
                 "--duration": None, "--bitrate": None, "--streams": None, "--psk": None},
    },
    "failover": {
        "status": None, "stop": None, "history": None,
        "endpoints": None, "watch": None,
        "start": {"--target": None, "--pps": None, "--label": None},
    },
    "convergence": {
        "status": None, "stop": None, "history": None,
        "endpoints": None, "watch": None,
        "start": {"--target": None, "--pps": None, "--label": None},
    },
    "vyos":        {"list": None, "sequences": None, "run": None, "stop": None, "history": None, "import": None, "export": None},
    "voice":       {
        "status": None, "stop": None, "stats": None, "start": None,
    },
    "iot":         {"list": None, "start": None, "stop": None, "stats": None, "vulns": None, "import": None, "export": None},
    "system":      {"info": None, "interfaces": None, "logs": None, "restart": None, "upgrade": None},
    "help":        None,
    "?":           None,
    "exit":        None,
    "quit":        None,
}

# ─── Main loop ────────────────────────────────────────────────────────────────

def run_command(line):
    line = line.strip()
    if not line or line.startswith("#"):
        return
    import shlex
    try:
        parts = shlex.split(line)
    except ValueError:
        parts = line.split()
    cmd    = parts[0].lower()
    rest   = parts[1:]
    if cmd in ("exit", "quit"):
        print("Goodbye.")
        sys.exit(0)
    handler = DISPATCH.get(cmd)
    if handler:
        # Record command in session history (excluding history management and sensitive logins)
        is_sensitive = (cmd == "auth" and any(x.lower() == "login" for x in rest))
        if cmd != "history" and not is_sensitive:
            SESSION_HISTORY.append(line)
        try:
            handler(rest)
        except KeyboardInterrupt:
            print()
            warn("Interrupted")
    else:
        err(f"Unknown command: '{cmd}'  (type 'help' or '?' for list)")


def _prompt_text():
    """Dynamic prompt — changes colour based on auth state."""
    host = STIGIX_URL.replace("https://","").replace("http://","")
    if JWT_TOKEN:
        return HTML(f"<prompt>stigix</prompt><b>@</b><prompt>{host}</prompt><b> › </b>")
    else:
        return HTML(f"<warn>stigix</warn><b>@</b><warn>{host}</warn><b> ! </b>")


def run_interactive():
    do_clear()
    display_ver = VERSION if VERSION.startswith("v") else f"v{VERSION}"
    content = f"  stigix-cli {display_ver} (Beta) local console  "
    w = len(content)
    hdr("╔" + "═" * w + "╗")
    hdr(f"║{content}║")
    hdr("╚" + "═" * w + "╝")
    info(f"Target  : {STIGIX_URL}")
    if JWT_TOKEN:
        ok(f"Session : token loaded from {CONFIG_FILE}")
    else:
        warn("Not authenticated — run: auth login")
    dim("Type 'help' for commands, F1 for help, F5 for status")
    print()

    # Kick off initial toolbar data fetch in background
    STATUS.invalidate()
    STATUS.refresh()

    if not HAS_PROMPT_TOOLKIT:
        # ── Fallback: plain input() ───────────────────────────────────────────
        while True:
            try:
                line = input(f"stigix@{STIGIX_URL}{'!' if not JWT_TOKEN else ''} > ")
                run_command(line)
            except KeyboardInterrupt:
                print()
                continue
            except EOFError:
                print("\nGoodbye.")
                break
        return

    # ── prompt_toolkit REPL ───────────────────────────────────────────────────
    style = Style.from_dict({
        "prompt":  "#4dd0e1 bold",
        "warn":    "#FFA726 bold",
        "b":       "bold",
    })

    completer = StigixCompleter(COMPLETER_TREE)
    history   = FileHistory(str(HISTORY_FILE))
    bindings  = _make_bindings()

    session = PromptSession(
        completer=completer,
        auto_suggest=AutoSuggestFromHistory(),
        style=style,
        key_bindings=bindings,
        bottom_toolbar=_toolbar,
        history=history,
        refresh_interval=10,      # redraws toolbar every 10s for live status
        wrap_lines=True,
        mouse_support=False,
    )

    while True:
        try:
            line = session.prompt(_prompt_text)
            run_command(line)
        except KeyboardInterrupt:
            print()
            continue
        except EOFError:
            print("\nGoodbye.")
            break


def main():
    global STIGIX_URL

    parser = argparse.ArgumentParser(
        description="stigix-cli — local interactive console for Stigix",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  stigix-cli                              # Interactive prompt (localhost:8080)
  stigix-cli --url http://10.0.0.5:8080   # Connect to remote instance
  stigix-cli --exec "auth login"          # Run single command and exit
  stigix-cli --exec "security suite"      # Run full security suite headless
  stigix-cli --script run.txt             # Execute commands from a file
  stigix-cli --idle-timeout 600           # Exit after 10 min of inactivity
  stigix-cli --idle-timeout 0             # No idle timeout (run indefinitely)
        """,
    )
    parser.add_argument("--url",    default=None, metavar="URL",
                        help="Stigix backend URL (overrides env + saved session)")
    parser.add_argument("--exec",   metavar="CMD",
                        help="Execute a single command and exit (non-interactive)")
    parser.add_argument("--script", metavar="FILE",
                        help="Execute commands from a file, one per line")
    parser.add_argument("--autocomplete", metavar="TEXT", nargs="?", const="",
                        help="Generate autocomplete suggestions for the given input text")
    args = parser.parse_args()

    # Load saved session first, then override with --url if given
    load_session()

    if args.autocomplete is not None:
        if HAS_PROMPT_TOOLKIT:
            from prompt_toolkit.document import Document
            doc = Document(args.autocomplete, cursor_position=len(args.autocomplete))
            completer = StigixCompleter(COMPLETER_TREE)
            completions = list(completer.get_completions(doc, None))
            for c in completions:
                print(c.text)
        sys.exit(0)
    if args.url:
        STIGIX_URL = args.url
        if not STIGIX_URL.startswith("http"):
            STIGIX_URL = f"http://{STIGIX_URL}"

    if args.exec:
        run_command(args.exec)
    elif args.script:
        path = Path(args.script)
        if not path.exists():
            err(f"Script not found: {args.script}")
            sys.exit(1)
        for lineno, line in enumerate(path.read_text().splitlines(), 1):
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            info(f"[{lineno}] {line}")
            run_command(line)
    else:
        run_interactive()


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nInterrupted.")
        sys.exit(0)
