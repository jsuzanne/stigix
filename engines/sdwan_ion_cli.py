#!/usr/bin/env python3
"""Read-only Prisma SD-WAN vION CLI execution via Controller Device Toolkit WebSocket (no SSH required).

Provides:
1. Strict command validation (`validate_command`, `RULES`, `FORBIDDEN_TOKENS` from `ion_cli_policy.py`):
   only read-only `dump` / `inspect` (and bounded diagnostic `ping` / `traceroute` / `debug`) commands
   are accepted; any state-changing or secret-bearing token is rejected before opening a session.
2. Automatic Device Toolkit user provisioning & rotation (`ensure_toolkit_user`):
   creates/updates a tenant-level Device Toolkit user (`stigix-ai-toolkit`) via the Prisma SASE API
   if no explicit credentials are provided, climbing the password complexity ladder and storing
   credentials locally with 0600 permissions (never logged or returned).
3. WebSocket Device Toolkit session (`_toolkit_connect`, `run_command`, `shape_output`):
   connects to `wss://<controller>/sdwan/v2.0/api/elements/<element_id>/ws/toolkitsessions`,
   handles `login:` / `Password:` prompts, auto-paginates `--More--`, strips ANSI sequences
   and keystroke echoes, and detects vION CLI syntax rejections (`unknown keyword` / `incomplete command`).
"""
from __future__ import annotations

import argparse
import asyncio
import hmac
import json
import os
import re
import secrets
import sys
from datetime import datetime, timezone
from typing import Any, Callable, Dict, List, Optional, Tuple

try:
    from prisma_sase import API
except ImportError:
    API = None

# ---------------------------------------------------------------------------
# 1. Read-Only ION CLI Policy (from ion_cli_policy.py)
# ---------------------------------------------------------------------------

MAX_COMMAND_CHARS = 160
READ_VERBS = frozenset({"dump", "inspect"})
DIAG_VERBS = frozenset({"ping", "traceroute", "debug"})
MAX_TOKENS = 12
MAX_TOKEN_CHARS = 64
MAX_OUTPUT_BYTES = 48 * 1024
_ALLOWED_CHARS = re.compile(r"^[A-Za-z0-9 _.:/=,-]+$")

FORBIDDEN_TOKENS = frozenset({
    "set", "reset", "reboot", "restart", "reload", "shutdown", "config", "configure", "conf", "shell", "bash",
    "sh", "sudo", "su", "tcpdump", "capture", "request", "delete", "remove", "clear", "erase", "format", "upgrade",
    "downgrade", "install", "download", "upload", "copy", "cp", "mv", "rm", "write", "commit", "save", "load", "enable",
    "disable", "add", "edit", "unset", "kill", "pkill", "exec", "eval", "curl", "wget", "scp", "ssh", "sftp", "tftp",
    "ftp", "nc", "netcat", "telnet", "password", "passwd", "secret", "key", "keys", "token", "tokens", "credential",
    "credentials", "certificate", "cert", "private", "args", "echo", "cat", "tail", "head",
    "grep", "sed", "awk", "flush", "start", "stop", "show", "exit", "xargs", "python", "perl", "tee", "dd",
    "mount", "umount", "chmod", "chown", "export", "env",
})

DEVICE_REJECT_RX = re.compile(r"(unknown keyword|incomplete command)", re.I)
REJECT_HINT = (
    "This command form is not valid on this ION version. The ION CLI cannot list its subcommands; "
    "use one of the known-good forms from the allowed list."
)

PORT = "<port>"
ALL_OR_PORT = "<all|port>"
HOST = "<ipv4>"
KV = "<kv>"

_KV_KEYS = {
    "app": r"[A-Za-z0-9_.-]{1,64}",
    "application": r"[A-Za-z0-9_.-]{1,64}",
    "srcv4": r"(?:\d{1,3}\.){3}\d{1,3}(?:/\d{1,2})?",
    "dstv4": r"(?:\d{1,3}\.){3}\d{1,3}(?:/\d{1,2})?",
    "protocol": r"[A-Za-z0-9_-]{1,16}",
    "sport": r"[0-9]{1,5}",
    "dport": r"[0-9]{1,5}",
}
_PORT = re.compile(r"[1-8]")
_IPV4 = re.compile(r"(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}")

RULES = (
    ("dump controller status", "controller connection state"),
    ("dump interface status <all|port>", "interface status (all or one data port)"),
    ("dump waninterface summary", "circuits (WAN interfaces) summary"),
    ("dump vpn summary all", "VPN (overlay) tunnels summary"),
    ("dump servicelink status all", "service links (IKE / ESP / DPD of the standard VPNs)"),
    ("dump service end points", "service endpoints"),
    ("dump routing peer status all", "BGP peer status"),
    ("dump routing peer received-routes all", "BGP routes received from peers"),
    ("dump routing peer advertised routes all", "BGP routes advertised to peers"),
    ("dump routing vpn-host-tracker status", "DC host tracking state"),
    ("dump intra-cluster-tunnel status", "DC intra-cluster tunnel state"),
    ("dump spoke-ha status", "branch HA state"),
    ("dump spoke-ha failover-timeline", "branch HA failover timeline"),
    ("dump reachability-probe status all", "L3 reachability probes"),
    ("inspect lqm stats all", "link quality (latency, loss, jitter, MOS) per path"),
    ("dump flow ifaces", "flow interfaces"),
    ("inspect flow brief", "active flows (observed to work on vION 6.5.3; trailing arguments are rejected)"),
    ("inspect system arp all", "ARP table"),
    ("inspect network-policy lookup <kv>", "which path-policy rule a flow matches"),
    ("inspect priority-policy lookup <kv>", "which QoS rule a flow matches"),
)

DEVICES_MAP = {
    "br1-vion1": "Branch-01-01",
    "br2-vion1": "Branch-02-01",
    "br3-vion1": "Branch-03-01",
    "br3-vion2": "Branch-03-02",
    "dc1-vion1": "DC-01-01",
    "dc1-vion2": "DC-01-02",
    "dc2-vion1": "DC-02-01",
    "dc3-vion1": "DC-03-01",
}


class IonCliError(ValueError):
    def __init__(self, code: str, message: str, hint: str = "", status: int = 400):
        super().__init__(message)
        self.code = code
        self.message = message
        self.hint = hint
        self.status = status

    def to_dict(self) -> Dict[str, Any]:
        out: Dict[str, Any] = {
            "success": False,
            "error": self.message,
            "code": self.code,
            "status": self.status,
        }
        if self.hint:
            out["hint"] = self.hint
        return out


def allowed_forms() -> List[str]:
    return [r[0] for r in RULES]


def describe_rules() -> str:
    forms = "; ".join(f"`{text}`" for text, _ in RULES)
    return (
        f"{forms} (<all|port>: all or a data port 1-8; <kv>: key=value pairs with keys "
        f"{', '.join(sorted(_KV_KEYS))})"
    )


def device_rejection(text: str) -> str:
    for line in [l for l in str(text or "").splitlines() if l.strip()][:3]:
        if DEVICE_REJECT_RX.search(line):
            return line.strip()[:200]
    return ""


def _kv_ok(token: str) -> bool:
    key, sep, value = token.partition("=")
    pat = _KV_KEYS.get(key)
    return bool(sep) and pat is not None and bool(re.fullmatch(pat, value))


def _match_args(rule_tokens: List[str], tokens: List[str]) -> bool:
    i = 0
    for r in rule_tokens:
        if r == KV:
            return all(_kv_ok(t) for t in tokens[i:]) and len(tokens) - i <= len(_KV_KEYS)
        if i >= len(tokens):
            return False
        t = tokens[i]
        if r == ALL_OR_PORT:
            ok = t == "all" or bool(_PORT.fullmatch(t))
        elif r == PORT:
            ok = bool(_PORT.fullmatch(t))
        elif r == HOST:
            ok = bool(_IPV4.fullmatch(t))
        else:
            ok = t == r
        if not ok:
            return False
        i += 1
    return i == len(tokens)


def validate_command(command: Any) -> str:
    """Validate and normalize an ION CLI command. Raises IonCliError if forbidden or malformed."""
    if not isinstance(command, str):
        raise IonCliError("bad_request", "command must be a string")
    if len(command) > MAX_COMMAND_CHARS:
        raise IonCliError("bad_request", f"command is longer than {MAX_COMMAND_CHARS} characters")
    if not command.strip() or not _ALLOWED_CHARS.fullmatch(command):
        raise IonCliError(
            "command_not_allowed",
            "The command has characters that are never sent to a device.",
            "Only letters, digits, spaces and . _ : / = , - are accepted: no pipes, quotes, "
            "separators or newlines. Allowed forms: " + describe_rules(),
        )
    tokens = command.split()
    bad = [t for t in tokens if t.lower() in FORBIDDEN_TOKENS]
    if bad:
        raise IonCliError(
            "command_not_allowed",
            f"{bad[0]!r} is not a read-only ION command word.",
            "Allowed forms: " + describe_rules(),
        )
    # Normalize protocol=tcp/udp/icmp to numeric IP protocol numbers expected by vION 6.8+
    _proto_map = {"tcp": "6", "udp": "17", "icmp": "1"}
    if len(tokens) >= 3 and tokens[0] == "inspect" and tokens[2] == "lookup":
        tokens = [
            f"protocol={_proto_map[t.split('=', 1)[1].lower()]}"
            if t.lower().startswith("protocol=") and t.split("=", 1)[1].lower() in _proto_map
            else t
            for t in tokens
        ]
    for text, _ in RULES:
        if _match_args(text.split(), tokens):
            return " ".join(tokens)
    if (
        tokens[0] in (READ_VERBS | DIAG_VERBS)
        and len(tokens) <= MAX_TOKENS
        and all(len(t) <= MAX_TOKEN_CHARS for t in tokens)
        and not any(".." in t or t.startswith("/") for t in tokens)
    ):
        return " ".join(tokens)
    raise IonCliError(
        "command_not_allowed",
        f"Only `dump`, `inspect`, `ping`, `traceroute` and `debug` commands may be run (at most {MAX_TOKENS} words).",
        "Known-good forms: " + describe_rules(),
    )


# ---------------------------------------------------------------------------
# 2. WebSocket Device Toolkit Transport (from toolkit_session.py & session.py)
# ---------------------------------------------------------------------------

LOGIN_RX = re.compile(r"(?:login|username)\s*:\s*$", re.I)
PASSWORD_RX = re.compile(r"password\s*:\s*$", re.I)
PROMPT_RX = re.compile(r"[>#$]\s*$")
LOGIN_FAILED_RX = re.compile(
    r"(login incorrect|authentication fail|access denied|invalid (?:user|login|credentials)|permission denied)",
    re.I,
)
_ANSI = re.compile(r"\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]")
_CTRL = re.compile(r"[\x00-\x08\x0b-\x1f\x7f]")
MORE_RX = re.compile(r"(?:--\s*more\s*--|\(\d+%\)\s*\[press space to continue[^\]]*\])", re.I)
PROMPT_LINE_RX = re.compile(r"^\s*([\w.@-]+)[>#$]\s?(.*)$")
MAX_RAW_CHARS = 256 * 1024
MAX_PAGES = 60
POLICY_MAX_CHARS = 48 * 1024
_ELEMENT_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
TOOLKIT_API_VERSION = "v2.0"
TOOLKIT_OPEN_TIMEOUT_S = 8
TOTAL_TIMEOUT_S = 27.0


class ToolkitError(Exception):
    MESSAGES = {
        "connect_failed": "The device toolkit session could not be opened.",
        "login_failed": "The device toolkit user was refused by the device.",
        "no_prompt": "The device did not show the expected prompt.",
        "timeout": "The device did not answer in time.",
        "closed": "The device closed the session.",
    }

    def __init__(self, code: str):
        super().__init__(self.MESSAGES[code])
        self.code = code
        self.message = self.MESSAGES[code]


def clean(text: str) -> str:
    text = _ANSI.sub("", text).replace("\r\n", "\n").replace("\r", "\n")
    return _CTRL.sub("", text)


def _decode(frame: Any) -> str:
    return frame.decode("utf-8", "replace") if isinstance(frame, (bytes, bytearray)) else str(frame)


async def _read(ws: Any, until: Optional[re.Pattern], timeout: float, idle: float, settle: float = 0.0) -> Tuple[str, bool, bool]:
    loop = asyncio.get_running_loop()
    end, buf, closed, matched = loop.time() + timeout, "", False, False
    while len(buf) < MAX_RAW_CHARS:
        left = end - loop.time()
        if left <= 0:
            break
        wait = min(left, settle if (matched and settle) else (idle if buf else left))
        try:
            frame = await asyncio.wait_for(ws.recv(), wait)
        except asyncio.TimeoutError:
            break
        except Exception:
            closed = True
            break
        buf += _decode(frame)
        matched = until is not None and bool(until.search(clean(buf)))
        if matched and not settle:
            break
    return buf, bool(until is not None and until.search(clean(buf))), closed


def _norm(text: str) -> str:
    return " ".join(text.split())


def _is_echo(line: str, command: str) -> bool:
    if _norm(line) == command:
        return True
    m = PROMPT_LINE_RX.match(line)
    return bool(m) and command.startswith(_norm(m.group(2)))


def _bare_prompt(line: str, host: str) -> bool:
    m = PROMPT_LINE_RX.match(line)
    if not m or m.group(2).strip():
        return False
    return not host or m.group(1).lower() == host.lower()


def command_done(buf: str, command: str, host: str) -> bool:
    lines = clean(buf).rstrip(" ").split("\n")
    if not _bare_prompt(lines[-1], host):
        return False
    cmd = _norm(command)
    before = lines[:-1]
    for i in range(len(before) - 1, -1, -1):
        if cmd and cmd in _norm(before[i]):
            return True
    return any(l.strip() and not _is_echo(l, cmd) for l in before)


async def _read_output(ws: Any, command: str, host: str, timeout: float, max_chars: int) -> Tuple[str, bool, bool, bool]:
    loop = asyncio.get_running_loop()
    end, buf, closed, answered, truncated = loop.time() + timeout, "", False, 0, False
    while True:
        left = end - loop.time()
        if left <= 0:
            break
        try:
            frame = await asyncio.wait_for(ws.recv(), left)
        except asyncio.TimeoutError:
            break
        except Exception:
            closed = True
            break
        buf += _decode(frame)
        text = clean(buf)
        if command_done(buf, command, host):
            try:
                more = await asyncio.wait_for(ws.recv(), 0.3)
                buf += _decode(more)
                continue
            except asyncio.TimeoutError:
                return buf, True, False, truncated
            except Exception:
                return buf, True, True, truncated
        marks = list(MORE_RX.finditer(text))
        if len(marks) > answered and not text[marks[-1].end():].strip():
            if answered >= MAX_PAGES or len(text) >= max_chars:
                truncated = True
                break
            answered = len(marks)
            try:
                await ws.send(" ")
            except Exception:
                closed = True
                break
        if len(buf) >= MAX_RAW_CHARS:
            truncated = True
            break
    return buf, False, closed, truncated


class CliOutput(str):
    truncated: bool = False


def shape_output(raw: str, command: str) -> str:
    text = MORE_RX.sub("", clean(raw))
    lines = text.split("\n")
    cmd = _norm(command)
    start = 0
    for i, line in enumerate(lines):
        if _is_echo(line, cmd) or not line.strip():
            start = i + 1
            continue
        break
    lines = [l.rstrip() for l in lines[start:]]
    while lines and (not lines[-1].strip() or _bare_prompt(lines[-1], "")):
        lines.pop()
    return "\n".join(lines).strip("\n")


async def run_command(
    connect: Callable[[], Any],
    username: str,
    password: str,
    command: str,
    *,
    login_timeout: float = 8.0,
    command_timeout: float = 15.0,
    idle: float = 1.5,
) -> CliOutput:
    try:
        cm = connect()
        ws = await cm.__aenter__()
    except Exception:
        raise ToolkitError("connect_failed") from None
    try:
        text, hit, closed = await _read(ws, LOGIN_RX, login_timeout, idle)
        if not hit:
            if PROMPT_RX.search(clean(text)):
                pass
            else:
                raise ToolkitError("closed" if closed else "no_prompt")
        else:
            await ws.send(username + "\r")
            text, hit, closed = await _read(ws, PASSWORD_RX, login_timeout, idle)
            if not hit:
                raise ToolkitError("closed" if closed else "no_prompt")
            await ws.send(password + "\r")
            text, hit, closed = await _read(ws, PROMPT_RX, login_timeout, idle)
            if LOGIN_FAILED_RX.search(clean(text)) or LOGIN_RX.search(clean(text)):
                raise ToolkitError("login_failed")
            if not hit:
                raise ToolkitError("closed" if closed else "no_prompt")
        m = PROMPT_LINE_RX.match(clean(text).rstrip(" ").split("\n")[-1])
        host = m.group(1) if m else ""
        await ws.send(command + "\r")
        out, done, closed, truncated = await _read_output(ws, command, host, command_timeout, POLICY_MAX_CHARS)
        if not done and not truncated and not clean(out).strip():
            raise ToolkitError("closed" if closed else "timeout")
        try:
            await ws.send("exit\r")
        except Exception:
            pass
        shaped = CliOutput(shape_output(out, command))
        shaped.truncated = bool(truncated or (not done and not closed))
        return shaped
    finally:
        try:
            await cm.__aexit__(None, None, None)
        except Exception:
            pass


def toolkit_connect(sdk: Any, element_id: str, *, connect_fn: Optional[Callable[..., Any]] = None) -> Any:
    """Open the Device Toolkit WebSocket for `element_id` using the authenticated `prisma_sase` SDK session."""
    if not _ELEMENT_ID_RE.fullmatch(str(element_id)):
        raise ValueError("Invalid element ID")
    is_default_connect = connect_fn is None
    if connect_fn is None:
        from websockets.asyncio.client import connect as connect_fn
    base = str(getattr(sdk, "controller", "https://api.sase.paloaltonetworks.com")).rstrip("/")
    wss = base.replace("https://", "wss://", 1) if base.startswith("https://") else base.replace("http://", "ws://", 1)
    url = f"{wss}/sdwan/{TOOLKIT_API_VERSION}/api/elements/{element_id}/ws/toolkitsessions?cols=207&rows=53"
    headers = dict(getattr(sdk, "_websocket_headers", None) or {})
    headers.pop("Host", None)
    # Remove any User-Agent from additional_headers so websockets 14+ does not send two User-Agent headers
    ua = headers.pop("User-Agent", None) or headers.pop("user-agent", None)
    session = getattr(sdk, "_session", None)
    if session is not None:
        cookies = session.cookies.get_dict()
        if cookies:
            headers["Cookie"] = "; ".join(f"{k}={v}" for k, v in cookies.items())
        sess_ua = session.headers.get("User-Agent")
        if sess_ua:
            ua = str(sess_ua)
        has_auth = any(k.lower() == "authorization" for k in headers)
        auth = session.headers.get("Authorization") or session.headers.get("X-Auth-Token")
        if auth and not has_auth:
            headers["authorization"] = str(auth)
    kwargs: Dict[str, Any] = {"additional_headers": headers, "open_timeout": TOOLKIT_OPEN_TIMEOUT_S}
    if ua and is_default_connect:
        kwargs["user_agent_header"] = str(ua)
    elif ua:
        headers["User-Agent"] = str(ua)
    ca_ctx = getattr(sdk, "_ca_ssl_context", None)
    if url.startswith("wss://") and ca_ctx:
        kwargs["ssl"] = ca_ctx
    return connect_fn(url, **kwargs)


# ---------------------------------------------------------------------------
# 3. Automatic Device Toolkit User Management (from toolkit_user.py)
# ---------------------------------------------------------------------------

_UP, _LOW, _DIG = "ABCDEFGHJKLMNPQRSTUVWXYZ", "abcdefghijkmnopqrstuvwxyz", "23456789"
INVALID_PASSWORD = "ELEMENTUSER_INVALID_PASSWORD"
DEFAULT_TOOLKIT_USERNAME = "stigix-ai"
READ_ONLY_USER_KEYS = frozenset({
    "id", "_etag", "_schema", "_created_on_utc", "_updated_on_utc",
    "_debug", "_info", "_warning", "_error", "_request_id", "_content_length",
    "_status_code", "tenant_id", "region", "site_id", "element_id",
})


def _draw(length: int, required: List[str]) -> str:
    chars = [secrets.choice(a) for a in required]
    chars += [secrets.choice(_UP + _LOW + _DIG) for _ in range(length - len(chars))]
    secrets.SystemRandom().shuffle(chars)
    return "".join(chars)


LADDER = (
    ("a16-sym", lambda: _draw(16, [_UP, _LOW, _DIG, "-_"])),
    ("b12-alnum", lambda: _draw(12, [_UP, _LOW, _DIG])),
    ("c32-alnum", lambda: "".join(secrets.choice(_UP + _LOW + _DIG) for _ in range(32))),
    ("d10-hash", lambda: _draw(10, [_UP, _LOW, _DIG, "#"])),
)
LADDER_LABELS = tuple(lbl for lbl, _ in LADDER)


def _resp_body(resp: Any) -> Any:
    if resp is None:
        return None
    if hasattr(resp, "cgx_content") and isinstance(resp.cgx_content, (dict, list, str)):
        return resp.cgx_content
    if hasattr(resp, "json") and callable(resp.json):
        try:
            return resp.json()
        except Exception:
            return None
    if isinstance(resp, dict):
        return resp
    return None


def _resp_ok(resp: Any) -> bool:
    body = _resp_body(resp)
    status = int(getattr(resp, "status_code", 0) or (200 if getattr(resp, "cgx_status", False) else 0))
    return 200 <= status < 300 and not (isinstance(body, dict) and body.get("_error"))


def _resp_err_code(resp: Any) -> str:
    body = _resp_body(resp)
    errors = body.get("_error") if isinstance(body, dict) else None
    code = errors[0].get("code") if isinstance(errors, list) and errors and isinstance(errors[0], dict) else None
    return str(code)[:32] if isinstance(code, str) and code.replace("_", "").replace(".", "").isalnum() else "-"


def _toolkit_secret_paths() -> List[str]:
    script_dir = os.path.dirname(os.path.abspath(__file__))
    return [
        os.path.join(os.getcwd(), "config", "prisma-toolkit-user.json"),
        os.path.join(script_dir, "..", "config", "prisma-toolkit-user.json"),
        "/data/stigix/config/prisma-toolkit-user.json",
        "/app/config/prisma-toolkit-user.json",
        "/tmp/prisma-toolkit-user.json",
    ]


def read_local_toolkit_secret() -> Optional[Dict[str, Any]]:
    env_user = os.getenv("PRISMA_SDWAN_TOOLKIT_USER")
    env_pass = os.getenv("PRISMA_SDWAN_TOOLKIT_PASSWORD")
    if env_user and env_pass:
        return {"username": env_user.strip(), "password": env_pass.strip(), "source": "env"}
    for p in _toolkit_secret_paths():
        if os.path.exists(p):
            try:
                with open(p, "r", encoding="utf-8") as f:
                    doc = json.load(f)
                if isinstance(doc, dict) and doc.get("username") and doc.get("password"):
                    return doc
            except Exception:
                pass
    return None


def write_local_toolkit_secret(doc: Dict[str, Any]) -> None:
    for p in _toolkit_secret_paths():
        parent = os.path.dirname(os.path.abspath(p))
        if os.path.isdir(parent) or p.startswith("/tmp/"):
            try:
                os.makedirs(parent, exist_ok=True)
                with open(p, "w", encoding="utf-8") as f:
                    json.dump(doc, f, indent=2)
                try:
                    os.chmod(p, 0o600)
                except Exception:
                    pass
                return
            except Exception:
                continue


def _read_back_password(sdk: Any, user_id: str, want: str) -> Optional[bool]:
    try:
        body = _resp_body(sdk.get.elementusers_password(user_id))
    except Exception:
        return None
    got = None
    if isinstance(body, str):
        got = body
    elif isinstance(body, dict) and isinstance(body.get("password"), str):
        got = body["password"]
    if got is None:
        return None
    return hmac.compare_digest(got.encode(), want.encode())


def ensure_toolkit_user(
    sdk: Any,
    *,
    uname: str = DEFAULT_TOOLKIT_USERNAME,
    role: str = "super",
    rotate: bool = False,
    read_secret: Callable[[], Optional[Dict[str, Any]]] = read_local_toolkit_secret,
    write_secret: Callable[[Dict[str, Any]], None] = write_local_toolkit_secret,
    password_factory: Optional[Callable[[str], str]] = None,
) -> Dict[str, Any]:
    """Ensure a tenant-level Device Toolkit user exists and return `{username, password, state, ...}`."""
    stored = read_secret()
    if stored and stored.get("source") == "env" and not rotate:
        return stored

    try:
        profile = _resp_body(sdk.get.profile())
        tenant_id = profile.get("tenant_id") if isinstance(profile, dict) else getattr(sdk, "tenant_id", None)
        if not tenant_id:
            raise IonCliError("toolkit_user_error", "Could not read tenant_id from controller profile.", status=502)
        listed = sdk.get.elementusers()
    except IonCliError:
        raise
    except Exception as e:
        raise IonCliError("toolkit_user_error", f"Controller could not be read ({type(e).__name__}).", status=502)

    if not _resp_ok(listed):
        raise IonCliError(
            "toolkit_user_error",
            f"Controller refused to list device toolkit users (code {_resp_err_code(listed)}).",
            status=502,
        )

    rows = (_resp_body(listed) or {}).get("items") or []
    existing = next(
        (u for u in rows if isinstance(u, dict) and (u.get("login_id") == uname or u.get("username") == uname)),
        None,
    )
    have_secret = isinstance(stored, dict) and stored.get("username") == uname and bool(stored.get("password"))
    fresh = rotate or existing is None or not have_secret
    stamp = datetime.now(timezone.utc).isoformat(timespec="seconds")

    if existing is not None and not fresh and existing.get("is_tenant_level") is True:
        return {
            "state": "unchanged",
            "username": uname,
            "password": stored["password"],
            "role": existing.get("role") or role,
        }

    state = "created" if existing is None else ("rotated" if rotate else "updated")
    start_class = (stored or {}).get("password_class")
    first_idx = LADDER_LABELS.index(start_class) if start_class in LADDER_LABELS else 0
    steps = list(LADDER[first_idx:]) + list(LADDER[:first_idx])

    desired_base = {
        "username": uname,
        "login_id": uname,
        "role": role,
        "tenant_id": str(tenant_id),
        "is_tenant_level": True,
    }
    user_id = existing.get("id") if existing else None
    last_code = "-"

    for label, gen in steps:
        password = password_factory(label) if password_factory else gen()
        doc = {
            "username": uname,
            "login_id": uname,
            "role": role,
            "password": password,
            "password_class": label,
            "updated_at": stamp,
        }
        write_secret(doc)
        payload = {**desired_base, "password": password}
        if user_id is None:
            resp = sdk.post.elementusers(payload)
        else:
            merged = {k: v for k, v in (existing or {}).items() if k not in READ_ONLY_USER_KEYS and k != "password"}
            merged.update(payload)
            resp = sdk.put.elementusers(user_id, merged)

        if not _resp_ok(resp):
            last_code = _resp_err_code(resp)
            if last_code == INVALID_PASSWORD:
                if user_id is None:
                    # Check if failed create left a user behind
                    re_rows = (_resp_body(sdk.get.elementusers()) or {}).get("items") or []
                    existing = next(
                        (u for u in re_rows if isinstance(u, dict) and (u.get("login_id") == uname or u.get("username") == uname)),
                        None,
                    )
                    user_id = existing.get("id") if existing else None
                continue
            raise IonCliError("toolkit_user_error", f"Controller refused device toolkit user ({state}, code {last_code}).", status=502)

        if user_id is None:
            b = _resp_body(resp)
            user_id = b.get("id") if isinstance(b, dict) else None

        verified = _read_back_password(sdk, user_id, password) if user_id else None
        if verified is False:
            raise IonCliError("toolkit_user_error", "Controller did not accept the password for the device toolkit user.", status=502)

        return {
            "state": state,
            "username": uname,
            "password": password,
            "role": role,
            "password_verified": verified,
            "password_class": label,
        }

    raise IonCliError("toolkit_user_error", f"Controller refused all password complexity classes (last code {last_code}).", status=502)


# ---------------------------------------------------------------------------
# 4. Flexible Element Resolution & High-Level Execution
# ---------------------------------------------------------------------------

def _normalize_site_token(name: str) -> str:
    s = str(name or "").strip().lower()
    m_br = re.match(r"^(?:br|branch)[-_]?0*(\d+)$", s)
    if m_br:
        return f"br{m_br.group(1)}"
    m_dc = re.match(r"^(?:dc|datacenter)[-_]?0*(\d+)$", s)
    if m_dc:
        return f"dc{m_dc.group(1)}"
    return re.sub(r"[-_\s]+", "", s)


def resolve_target_element(sdk: Any, device_or_site: str) -> Tuple[Dict[str, Any], Optional[str]]:
    """Resolve `device_or_site` (e.g. 'br1-vion1', 'Branch-01-01', 'BR1', 'Branch-01', 'DC1')
    to an element dict and its site name."""
    query = str(device_or_site or "").strip()
    if not query:
        raise IonCliError("bad_request", "device_or_site is required (e.g. 'BR1', 'br1-vion1', 'Branch-01-01')")

    sites_body = _resp_body(sdk.get.sites()) or {}
    sites = sites_body.get("items") or []
    site_names = {str(s["id"]): s.get("name") for s in sites if isinstance(s, dict) and s.get("id")}

    els_body = _resp_body(sdk.get.elements()) or {}
    elements = [e for e in (els_body.get("items") or []) if isinstance(e, dict)]

    q_low = query.lower()
    mapped_el_name = DEVICES_MAP.get(re.sub(r"[\s_]+", "-", q_low))

    # 1. Exact element name, mapped lab alias, or element ID match
    for el in elements:
        ename = str(el.get("name") or "")
        eid = str(el.get("id") or "")
        if ename.lower() == q_low or eid.lower() == q_low or (mapped_el_name and ename.lower() == mapped_el_name.lower()):
            return el, site_names.get(str(el.get("site_id")))

    # 2. Match by site name / canonical site token (e.g. 'BR1' -> 'Branch-01' -> element at Branch-01)
    q_norm = _normalize_site_token(query)
    matched_site_ids = [
        str(s["id"])
        for s in sites
        if str(s.get("name", "")).lower() == q_low
        or (q_norm and _normalize_site_token(str(s.get("name", ""))) == q_norm)
    ]
    if matched_site_ids:
        site_els = [e for e in elements if str(e.get("site_id")) in matched_site_ids]
        if site_els:
            # Prefer connected element first
            site_els.sort(key=lambda e: (not bool(e.get("connected")), str(e.get("name") or "")))
            chosen = site_els[0]
            return chosen, site_names.get(str(chosen.get("site_id")))

    # 3. Substring match on element name
    for el in elements:
        ename = str(el.get("name") or "").lower()
        if q_low in ename or (q_norm and q_norm in _normalize_site_token(ename)):
            return el, site_names.get(str(el.get("site_id")))

    available = sorted(
        f"{e.get('name')} ({site_names.get(str(e.get('site_id')), 'unbound')})"
        for e in elements
        if e.get("name")
    )[:20]
    raise IonCliError(
        "unknown_device",
        f"No vION element matching {query[:60]!r} found in this Prisma SD-WAN tenant.",
        hint="Available elements: " + (", ".join(available) or "none"),
        status=404,
    )


def execute_ion_cli(
    sdk: Any,
    device_or_site: str,
    command: str,
    *,
    connect_fn: Optional[Callable[[Any, str], Any]] = None,
    ensure_user_fn: Optional[Callable[..., Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    """Validate `command`, resolve `device_or_site`, ensure toolkit user credentials, and execute over WebSocket."""
    norm_cmd = validate_command(command)
    el, site_name = resolve_target_element(sdk, device_or_site)

    if el.get("connected") is False:
        raise IonCliError(
            "device_offline",
            f"Element {el.get('name')} (site {site_name}) is offline/disconnected from the controller.",
            hint="A Device Toolkit WebSocket session requires the vION to be online.",
            status=409,
        )

    ensure_fn = ensure_user_fn or ensure_toolkit_user
    ws_factory = connect_fn or (lambda s, eid: toolkit_connect(s, eid))
    element_id = str(el["id"])

    creds = ensure_fn(sdk, rotate=False)

    async def _run_once(u: str, p: str) -> CliOutput:
        return await asyncio.wait_for(
            run_command(lambda: ws_factory(sdk, element_id), u, p, norm_cmd),
            TOTAL_TIMEOUT_S,
        )

    try:
        try:
            raw = asyncio.run(_run_once(creds["username"], creds["password"]))
        except ToolkitError as te:
            if te.code == "login_failed" and creds.get("source") != "env":
                # Auto-rotate once if cached credentials were rejected by the vION
                creds = ensure_fn(sdk, rotate=True)
                raw = asyncio.run(_run_once(creds["username"], creds["password"]))
            else:
                raise
    except ToolkitError as e:
        raise IonCliError(e.code, e.message, status=502) from None
    except asyncio.TimeoutError:
        raise IonCliError("timeout", ToolkitError.MESSAGES["timeout"], status=504) from None
    except IonCliError:
        raise
    except Exception as e:
        raise IonCliError("unavailable", ToolkitError.MESSAGES["connect_failed"], hint=type(e).__name__, status=502) from None

    text = str(raw or "")
    rejected = device_rejection(text)
    if rejected:
        raise IonCliError(
            "command_rejected",
            f"The vION rejected the command: {rejected}",
            hint=REJECT_HINT,
            status=422,
        )

    data_bytes = text.encode("utf-8", "replace")
    truncated = len(data_bytes) > MAX_OUTPUT_BYTES or bool(getattr(raw, "truncated", False))
    if truncated:
        text = data_bytes[:MAX_OUTPUT_BYTES].decode("utf-8", "ignore") + (
            "\n... (truncated: paging stopped at size cap, page limit, or time budget)"
        )

    return {
        "success": True,
        "site": site_name,
        "element": el.get("name"),
        "element_id": element_id,
        "command": norm_cmd,
        "output": text,
        "truncated": truncated,
        "bytes": len(data_bytes),
        "read_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }


def _authenticate_sdk(credentials_path: str = "credentials.json") -> Any:
    if API is None:
        raise IonCliError("sdk_missing", "prisma_sase Python SDK is not installed on this node.", status=503)
    script_dir = os.path.dirname(os.path.abspath(__file__))
    if script_dir not in sys.path:
        sys.path.insert(0, script_dir)
    from getflow import load_credentials

    class _DummyArgs:
        credentials = credentials_path

    creds = load_credentials(_DummyArgs(), json_mode=True)
    sdk = API(update_check=False)
    sdk.rest_call_timeout = 10
    ok = sdk.interactive.login_secret(
        client_id=creds["client_id"],
        client_secret=creds["client_secret"],
        tsg_id=creds["tsg_id"],
    )
    if not ok:
        raise IonCliError("auth_failed", "Prisma SD-WAN login_secret returned False.", status=502)
    return sdk


def main() -> None:
    parser = argparse.ArgumentParser(description="Read-Only Prisma SD-WAN vION CLI via WebSocket Device Toolkit")
    parser.add_argument("--device", required=True, help="vION element name or site name (e.g. 'BR1', 'br1-vion1', 'Branch-01-01')")
    parser.add_argument("--command", required=True, help="Read-only ION CLI command (e.g. 'dump vpn summary all')")
    parser.add_argument("--credentials", default="credentials.json", help="Credentials file path")
    parser.add_argument("--json", action="store_true", help="Output JSON")
    parsed = parser.parse_args()

    try:
        # Validate command syntax first before authenticating to the controller
        validate_command(parsed.command)
        sdk = _authenticate_sdk(parsed.credentials)
        res = execute_ion_cli(sdk, parsed.device, parsed.command)
        print(json.dumps(res, indent=2))
    except IonCliError as err:
        print(json.dumps(err.to_dict(), indent=2))
        sys.exit(0)
    except Exception as exc:
        print(json.dumps({"success": False, "error": str(exc), "code": type(exc).__name__}, indent=2))
        sys.exit(1)


if __name__ == "__main__":
    main()
