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
import time
from datetime import datetime, timedelta, timezone
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
MAX_OUTPUT_BYTES = 512 * 1024
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
    ("dump servicelink summary all", "service links summary (Prisma Access / Zscaler / Standard VPNs)"),
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
    ("inspect flow brief", "active flows (all)"),
    ("inspect flow brief <kv>", "active flows filtered by key=value (srcv4, dstv4, sport, dport, protocol, app)"),
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
    if len(tokens) >= 3 and tokens[0] == "inspect" and (tokens[2] == "lookup" or tokens[1:3] == ["flow", "brief"]):
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
    r"(account locked|login incorrect|authentication fail|access denied|invalid (?:user|login|credentials)|permission denied)",
    re.I,
)
_PASSWORD_OR_FAIL_RX = re.compile(
    r"(?:password\s*:\s*$)|(?:account locked|login incorrect|authentication fail|access denied|invalid (?:user|login|credentials)|permission denied)",
    re.I | re.M,
)
_PROMPT_OR_FAIL_RX = re.compile(
    r"(?:[>#$]\s*$)|(?:account locked|login incorrect|authentication fail|access denied|invalid (?:user|login|credentials)|permission denied)",
    re.I | re.M,
)
_ANSI = re.compile(r"\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]")
_CTRL = re.compile(r"[\x00-\x08\x0b-\x1f\x7f]")
MORE_RX = re.compile(r"(?:--\s*more\s*--|\(\d+%\)\s*\[press space to continue[^\]]*\])", re.I)
PROMPT_LINE_RX = re.compile(r"^\s*([\w.@-]+)[>#$]\s?(.*)$")
MAX_RAW_CHARS = 1024 * 1024
MAX_PAGES = 180
POLICY_MAX_CHARS = 512 * 1024
_ELEMENT_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
TOOLKIT_API_VERSION = "v2.0"
TOOLKIT_OPEN_TIMEOUT_S = 10
TOTAL_TIMEOUT_S = 45.0


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
    lines = clean(buf).rstrip().split("\n")
    if not _bare_prompt(lines[-1], host):
        return False
    cmd = _norm(command)
    before = lines[:-1]
    for i in range(len(before) - 1, -1, -1):
        if cmd and cmd in _norm(before[i]):
            return True
    return any(l.strip() and not _is_echo(l, cmd) for l in before)


async def _read_output(
    ws: Any,
    command: str,
    host: str,
    timeout: float,
    max_chars: int,
    early_stop_check: Optional[Callable[[str], bool]] = None,
) -> Tuple[str, bool, bool, bool]:
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
            if early_stop_check is not None:
                try:
                    if early_stop_check(MORE_RX.sub("", text)):
                        await ws.send("q")
                        try:
                            await asyncio.wait_for(ws.recv(), 0.25)
                        except Exception:
                            pass
                        return buf, True, False, False
                except Exception:
                    pass
            if answered >= MAX_PAGES or len(text) >= max_chars:
                truncated = True
                try:
                    await ws.send("q")
                    await asyncio.wait_for(ws.recv(), 0.2)
                except Exception:
                    pass
                break
            answered = len(marks)
            try:
                await ws.send(" ")
            except Exception:
                closed = True
                break
        if len(buf) >= MAX_RAW_CHARS:
            truncated = True
            try:
                await ws.send("q")
                await asyncio.wait_for(ws.recv(), 0.2)
            except Exception:
                pass
            break
    return buf, False, closed, truncated


class CliOutput(str):
    truncated: bool = False
    executed_command: str = ""


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
    login_timeout: float = 14.0,
    command_timeout: float = 22.0,
    idle: float = 1.5,
    early_stop_check: Optional[Callable[[str], bool]] = None,
    fallback_commands: Optional[List[str]] = None,
) -> CliOutput:
    try:
        cm = connect()
        ws = await cm.__aenter__()
    except Exception:
        raise ToolkitError("connect_failed") from None
    try:
        text, hit, closed = await _read(ws, LOGIN_RX, login_timeout, max(idle, 8.0))
        if not hit and not closed and not PROMPT_RX.search(clean(text)):
            try:
                await ws.send("\r")
                extra, hit, closed = await _read(ws, LOGIN_RX, min(6.0, login_timeout), max(idle, 5.0))
                text += extra
            except Exception:
                pass
        if not hit:
            if PROMPT_RX.search(clean(text)):
                pass
            else:
                raise ToolkitError("closed" if closed else "no_prompt")
        else:
            await ws.send(username + "\r")
            text, hit, closed = await _read(ws, _PASSWORD_OR_FAIL_RX, login_timeout, max(idle, 8.0))
            if LOGIN_FAILED_RX.search(clean(text)):
                raise ToolkitError("login_failed")
            if not hit or not PASSWORD_RX.search(clean(text)):
                raise ToolkitError("closed" if closed else "no_prompt")
            await ws.send(password + "\r")
            # After password submission, vION echoes '\r\n' immediately and then spawns the toolkit CLI shell,
            # which can take 8-16s on busy branch vIONs (e.g. BR1). Wait full post-password timeout before idle cutoff.
            post_pw_timeout = max(login_timeout, 20.0) if login_timeout >= 5.0 else login_timeout
            post_pw_settle = 0.12 if login_timeout >= 5.0 else 0.0
            text, hit, closed = await _read(ws, _PROMPT_OR_FAIL_RX, post_pw_timeout, post_pw_timeout, settle=post_pw_settle)
            if LOGIN_FAILED_RX.search(clean(text)) or LOGIN_RX.search(clean(text)):
                raise ToolkitError("login_failed")
            if not hit or not PROMPT_RX.search(clean(text)):
                raise ToolkitError("closed" if closed else "no_prompt")
        m = PROMPT_LINE_RX.match(clean(text).rstrip().split("\n")[-1])
        host = m.group(1) if m else ""

        candidates: List[str] = [command]
        for fb in fallback_commands or []:
            if fb and fb not in candidates:
                candidates.append(fb)

        shaped_text = ""
        used_cmd = command
        was_truncated = False
        for idx, cand in enumerate(candidates):
            used_cmd = cand
            await ws.send(cand + "\r")
            out, done, closed, truncated = await _read_output(
                ws, cand, host, command_timeout, POLICY_MAX_CHARS, early_stop_check=early_stop_check
            )
            if not done and not truncated and not clean(out).strip():
                raise ToolkitError("closed" if closed else "timeout")
            shaped_text = shape_output(out, cand)
            was_truncated = bool(truncated or (not done and not closed))
            # If the device rejected this syntax and we have a fallback candidate, try it immediately in the same session
            if device_rejection(shaped_text) and idx + 1 < len(candidates) and not closed:
                continue
            # On Hub/Transit vIONs, vpn_to_core flows may be indexed with reversed srcv4/dstv4 columns;
            # ONLY if the query had BOTH srcv4= and dstv4= and returned 0 rows, try the reversed srcv4/dstv4 pair
            # immediately in the same open WebSocket session (~0.2s). Never fall back to dropping srcv4= on 0 rows.
            if (
                cand.startswith("inspect flow brief ")
                and "srcv4=" in cand
                and "dstv4=" in cand
                and idx + 1 < len(candidates)
                and "srcv4=" in candidates[idx + 1]
                and "dstv4=" in candidates[idx + 1]
                and not closed
                and not parse_inspect_flow_brief(shaped_text)
            ):
                continue
            break

        try:
            await ws.send("exit\r")
            try:
                await asyncio.wait_for(ws.recv(), 0.2)
            except Exception:
                pass
        except Exception:
            pass
        shaped = CliOutput(shaped_text)
        shaped.truncated = was_truncated
        shaped.executed_command = used_cmd
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


def _deterministic_toolkit_password(tenant_id: str, uname: str, label: str) -> str:
    """Derive a deterministic tenant-scoped password so all Stigix nodes in a fleet share
    the exact same Device Toolkit password and never overwrite each other across nodes."""
    digest = hmac.new(
        str(tenant_id or "stigix").encode("utf-8"),
        f"stigix-toolkit-v2:{uname}:{label}".encode("utf-8"),
        "sha256",
    ).digest()
    pool = _UP + _LOW + _DIG
    if label == "a16-sym":
        chars = [
            _UP[digest[0] % len(_UP)],
            _LOW[digest[1] % len(_LOW)],
            _DIG[digest[2] % len(_DIG)],
            "-_"[digest[3] % 2],
        ]
        chars += [pool[digest[4 + i] % len(pool)] for i in range(12)]
        return "".join(chars)
    if label == "b12-alnum":
        chars = [
            _UP[digest[0] % len(_UP)],
            _LOW[digest[1] % len(_LOW)],
            _DIG[digest[2] % len(_DIG)],
        ]
        chars += [pool[digest[3 + i] % len(pool)] for i in range(9)]
        return "".join(chars)
    if label == "c32-alnum":
        return "".join(pool[digest[i % len(digest)] % len(pool)] for i in range(32))
    chars = [
        _UP[digest[0] % len(_UP)],
        _LOW[digest[1] % len(_LOW)],
        _DIG[digest[2] % len(_DIG)],
        "#",
    ]
    chars += [pool[digest[4 + i] % len(pool)] for i in range(6)]
    return "".join(chars)


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
        "/app/config/prisma-toolkit-user.json",
        "/data/stigix/config/prisma-toolkit-user.json",
        os.path.join(os.getcwd(), "config", "prisma-toolkit-user.json"),
        os.path.join(script_dir, "..", "config", "prisma-toolkit-user.json"),
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

    is_real_sdk = getattr(sdk, "_session", None) is not None
    now_epoch = datetime.now(timezone.utc).timestamp()
    if (
        is_real_sdk
        and not rotate
        and isinstance(stored, dict)
        and stored.get("username") == uname
        and stored.get("password")
    ):
        return {
            "state": "cached",
            "username": uname,
            "password": stored["password"],
            "role": stored.get("role") or role,
        }

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
        if is_real_sdk and isinstance(stored, dict):
            write_secret({**stored, "verified_epoch": now_epoch})
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

    # When rotating on a real SDK (e.g. after PAM account lock or stale password),
    # delete and recreate the user so the vION clears its PAM faillock tally.
    if rotate and is_real_sdk and user_id is not None and hasattr(getattr(sdk, "delete", None), "elementusers"):
        try:
            del_resp = sdk.delete.elementusers(user_id)
            if _resp_ok(del_resp):
                user_id = None
                existing = None
                time.sleep(1.5)
        except Exception:
            pass

    for label, gen in steps:
        if password_factory is not None:
            password = password_factory(label)
        elif is_real_sdk:
            password = _deterministic_toolkit_password(str(tenant_id), uname, label)
        else:
            password = gen()
        doc = {
            "username": uname,
            "login_id": uname,
            "role": role,
            "password": password,
            "password_class": label,
            "updated_at": stamp,
            "verified_epoch": now_epoch,
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

        if is_real_sdk:
            # Allow Prisma SASE Controller 3.5s to propagate the new user/password to vION elements
            time.sleep(3.5)

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


from contextlib import contextmanager

try:
    import fcntl
except ImportError:
    fcntl = None  # type: ignore

TARGET_CACHE_FILE = "/tmp/stigix_ion_target_cache.json"
ION_CLI_LOCK_FILE = "/tmp/stigix_ion_cli.lock"


@contextmanager
def _ion_cli_lock():
    """Serialize Device Toolkit WebSocket sessions across processes on the same node."""
    if fcntl is None:
        yield
        return
    fd = None
    try:
        fd = open(ION_CLI_LOCK_FILE, "w", encoding="utf-8")
        fcntl.flock(fd.fileno(), fcntl.LOCK_EX)
    except Exception:
        pass
    try:
        yield
    finally:
        if fd is not None:
            try:
                fcntl.flock(fd.fileno(), fcntl.LOCK_UN)
            except Exception:
                pass
            try:
                fd.close()
            except Exception:
                pass


INVENTORY_CACHE_FILE = "/tmp/stigix_ion_inventory.json"


def _load_tenant_inventory(sdk: Any) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """Return `(sites, elements)` for the tenant, using in-memory + 10-minute file cache on real SDKs."""
    mem = getattr(sdk, "_stigix_inventory", None)
    if isinstance(mem, tuple) and len(mem) == 2:
        return mem

    is_real_sdk = getattr(sdk, "_session", None) is not None
    now_epoch = datetime.now(timezone.utc).timestamp()
    if is_real_sdk and os.path.exists(INVENTORY_CACHE_FILE):
        try:
            with open(INVENTORY_CACHE_FILE, "r", encoding="utf-8") as f:
                doc = json.load(f) or {}
            if (now_epoch - float(doc.get("ts") or 0)) < 600:
                sites = [s for s in (doc.get("sites") or []) if isinstance(s, dict)]
                elements = [e for e in (doc.get("elements") or []) if isinstance(e, dict)]
                if sites and elements:
                    try:
                        setattr(sdk, "_stigix_inventory", (sites, elements))
                    except Exception:
                        pass
                    return sites, elements
        except Exception:
            pass

    sites_body = _resp_body(sdk.get.sites()) or {}
    sites = [s for s in (sites_body.get("items") or []) if isinstance(s, dict)]
    els_body = _resp_body(sdk.get.elements()) or {}
    elements = [e for e in (els_body.get("items") or []) if isinstance(e, dict)]

    try:
        setattr(sdk, "_stigix_inventory", (sites, elements))
    except Exception:
        pass

    if is_real_sdk and sites and elements:
        try:
            with open(INVENTORY_CACHE_FILE, "w", encoding="utf-8") as f:
                json.dump({"ts": now_epoch, "sites": sites, "elements": elements}, f)
        except Exception:
            pass

    return sites, elements


def resolve_target_element(sdk: Any, device_or_site: str) -> Tuple[Dict[str, Any], Optional[str]]:
    """Resolve `device_or_site` (e.g. 'br1-vion1', 'Branch-01-01', 'BR1', 'Branch-01', 'DC1')
    to an element dict and its site name."""
    query = str(device_or_site or "").strip()
    if not query:
        raise IonCliError("bad_request", "device_or_site is required (e.g. 'BR1', 'br1-vion1', 'Branch-01-01')")

    is_real_sdk = getattr(sdk, "_session", None) is not None
    q_key = _normalize_site_token(query) or query.lower()
    now_epoch = datetime.now(timezone.utc).timestamp()

    if is_real_sdk and os.path.exists(TARGET_CACHE_FILE):
        try:
            with open(TARGET_CACHE_FILE, "r", encoding="utf-8") as f:
                cache_doc = json.load(f)
            entry = (cache_doc or {}).get(q_key)
            if isinstance(entry, dict) and (now_epoch - float(entry.get("ts") or 0)) < 600:
                if isinstance(entry.get("element"), dict) and entry["element"].get("id"):
                    return entry["element"], entry.get("site_name")
        except Exception:
            pass

    def _save_target_cache(el_obj: Dict[str, Any], sname: Optional[str]) -> Tuple[Dict[str, Any], Optional[str]]:
        if is_real_sdk:
            try:
                cache_doc = {}
                if os.path.exists(TARGET_CACHE_FILE):
                    with open(TARGET_CACHE_FILE, "r", encoding="utf-8") as f:
                        cache_doc = json.load(f) or {}
                cache_doc[q_key] = {"element": el_obj, "site_name": sname, "ts": now_epoch}
                with open(TARGET_CACHE_FILE, "w", encoding="utf-8") as f:
                    json.dump(cache_doc, f)
            except Exception:
                pass
        return el_obj, sname

    sites, elements = _load_tenant_inventory(sdk)
    site_names = {str(s["id"]): s.get("name") for s in sites if isinstance(s, dict) and s.get("id")}

    q_low = query.lower()
    mapped_el_name = DEVICES_MAP.get(re.sub(r"[\s_]+", "-", q_low))

    # 1. Exact element name, mapped lab alias, or element ID match
    for el in elements:
        ename = str(el.get("name") or "")
        eid = str(el.get("id") or "")
        if ename.lower() == q_low or eid.lower() == q_low or (mapped_el_name and ename.lower() == mapped_el_name.lower()):
            return _save_target_cache(el, site_names.get(str(el.get("site_id"))))

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
            return _save_target_cache(chosen, site_names.get(str(chosen.get("site_id"))))

    # 3. Substring match on element name
    for el in elements:
        ename = str(el.get("name") or "").lower()
        if q_low in ename or (q_norm and q_norm in _normalize_site_token(ename)):
            return _save_target_cache(el, site_names.get(str(el.get("site_id"))))

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


def resolve_site_elements(sdk: Any, device_or_site: str) -> Tuple[List[Dict[str, Any]], Optional[str]]:
    """Return all connected vION elements for a site (e.g. ['DC1-R1', 'DC1-R2'] for 'DC1')
    or a single-element list if `device_or_site` names a specific element."""
    if sdk is None or getattr(sdk, "get", None) is None:
        return ([{"name": device_or_site, "connected": True}], device_or_site)

    query = str(device_or_site or "").strip()
    if not query:
        return ([], None)

    try:
        sites, elements = _load_tenant_inventory(sdk)
        site_names = {str(s["id"]): s.get("name") for s in sites if isinstance(s, dict) and s.get("id")}
    except Exception:
        return ([], None)

    q_low = query.lower()
    mapped_el_name = DEVICES_MAP.get(re.sub(r"[\s_]+", "-", q_low))

    # 1. If query matches an exact element name, return just that element
    for el in elements:
        ename = str(el.get("name") or "")
        eid = str(el.get("id") or "")
        if ename.lower() == q_low or eid.lower() == q_low or (mapped_el_name and ename.lower() == mapped_el_name.lower()):
            return ([el], site_names.get(str(el.get("site_id"))))

    # 2. Match by site name / canonical site token -> return all connected elements for that site
    q_norm = _normalize_site_token(query)
    matched_site_ids = [
        str(s["id"])
        for s in sites
        if str(s.get("name", "")).lower() == q_low
        or (q_norm and _normalize_site_token(str(s.get("name", ""))) == q_norm)
    ]
    if matched_site_ids:
        site_els = [e for e in elements if str(e.get("site_id")) in matched_site_ids and bool(e.get("connected"))]
        if not site_els:
            site_els = [e for e in elements if str(e.get("site_id")) in matched_site_ids]
        if site_els:
            # Prefer cached active HA member first if present in TARGET_CACHE_FILE
            preferred_id = None
            q_key = q_norm or q_low
            if os.path.exists(TARGET_CACHE_FILE):
                try:
                    with open(TARGET_CACHE_FILE, "r", encoding="utf-8") as f:
                        cache_doc = json.load(f) or {}
                    cached_el = (cache_doc.get(q_key) or {}).get("element") or {}
                    preferred_id = str(cached_el.get("id") or "")
                except Exception:
                    pass
            site_els.sort(
                key=lambda e: (
                    0 if (preferred_id and str(e.get("id")) == preferred_id) else 1,
                    not bool(e.get("connected")),
                    str(e.get("name") or ""),
                )
            )
            sname = site_names.get(str(site_els[0].get("site_id")))
            return (site_els, sname)

    return ([], None)


CAPABILITIES_CACHE_FILE = "/tmp/stigix_ion_capabilities.json"


def _load_capabilities_cache() -> Dict[str, Any]:
    if os.path.exists(CAPABILITIES_CACHE_FILE):
        try:
            with open(CAPABILITIES_CACHE_FILE, "r", encoding="utf-8") as f:
                doc = json.load(f)
            return doc if isinstance(doc, dict) else {}
        except Exception:
            pass
    return {}


def _save_capability(sw_version: str, family: str, mode: str) -> None:
    if not sw_version:
        return
    try:
        doc = _load_capabilities_cache()
        ver_map = doc.get(sw_version) if isinstance(doc.get(sw_version), dict) else {}
        if ver_map.get(family) != mode:
            ver_map[family] = mode
            doc[sw_version] = ver_map
            with open(CAPABILITIES_CACHE_FILE, "w", encoding="utf-8") as f:
                json.dump(doc, f)
    except Exception:
        pass


def build_command_fallbacks(norm_cmd: str, sw_version: str = "") -> List[str]:
    """Build an ordered list of fallback CLI syntaxes for cross-version compatibility (e.g. vION 6.5 vs 6.8 vs 7.x)."""
    tokens = norm_cmd.split()
    fallbacks: List[str] = []
    caps = (_load_capabilities_cache().get(sw_version) or {}) if sw_version else {}

    # 1. inspect flow brief [<kv>]
    if len(tokens) >= 3 and tokens[:3] == ["inspect", "flow", "brief"]:
        kv_tokens = tokens[3:]
        ip_only = [t for t in kv_tokens if t.startswith(("srcv4=", "dstv4="))]
        dst_only = [t for t in kv_tokens if t.startswith("dstv4=")]
        rev_ip_only = [
            ("dstv4=" + t.split("=", 1)[1]) if t.startswith("srcv4=") else ("srcv4=" + t.split("=", 1)[1])
            for t in ip_only
        ]
        # Keep canonical order (srcv4= before dstv4=) in reversed IP filter
        rev_ip_only.sort(key=lambda x: 0 if x.startswith("srcv4=") else 1)
        cmd_ip = ("inspect flow brief " + " ".join(ip_only)).strip()
        cmd_dst = ("inspect flow brief " + " ".join(dst_only)).strip()
        cmd_rev_ip = ("inspect flow brief " + " ".join(rev_ip_only)).strip() if rev_ip_only else ""
        cmd_bare = "inspect flow brief"

        cached_mode = caps.get("inspect_flow_brief")
        if cached_mode in ("ip_only", "bare"):
            ordered = [cmd_ip, cmd_rev_ip, cmd_dst, cmd_bare, norm_cmd]
        else:
            ordered = [norm_cmd, cmd_ip, cmd_rev_ip, cmd_dst, cmd_bare]
        for c in ordered:
            if c and c not in fallbacks:
                fallbacks.append(c)
        return fallbacks

    # 2. inspect network-policy / priority-policy lookup <kv>
    if len(tokens) >= 4 and tokens[0] == "inspect" and tokens[2] == "lookup":
        prefix = " ".join(tokens[:3])
        kv_tokens = tokens[3:]
        # Candidate A: only srcv4, dstv4, app/application (universal across 6.5 and 6.8)
        core_kv = [t for t in kv_tokens if t.startswith(("srcv4=", "dstv4=", "app=", "application="))]
        # Candidate B: symbolic protocol name (6.5 style) instead of numeric
        rev_proto = {"17": "udp", "6": "tcp", "1": "icmp"}
        sym_kv = [
            f"protocol={rev_proto[t.split('=', 1)[1]]}"
            if t.startswith("protocol=") and t.split("=", 1)[1] in rev_proto
            else t
            for t in kv_tokens
        ]
        # Candidate C: swap app= <-> application= across ION versions
        alt_app_kv = [
            f"application={t.split('=', 1)[1]}" if t.startswith("app=")
            else (f"app={t.split('=', 1)[1]}" if t.startswith("application=") else t)
            for t in core_kv
        ]
        for cand_kv in (kv_tokens, sym_kv, core_kv, alt_app_kv):
            if cand_kv:
                c = f"{prefix} {' '.join(cand_kv)}"
                if c not in fallbacks:
                    fallbacks.append(c)
        return fallbacks

    # 3. dump servicelink status/summary all
    if tokens[:2] == ["dump", "servicelink"]:
        for c in ("dump servicelink summary all", "dump servicelink status all"):
            if c not in fallbacks:
                fallbacks.append(c)
        if norm_cmd not in fallbacks:
            fallbacks.insert(0, norm_cmd)
        return fallbacks

    return [norm_cmd]


def _append_cli_audit_log(entry: Dict[str, Any]) -> None:
    """Append a structured JSONL audit record for every vION WebSocket CLI execution."""
    candidates = [
        "/var/log/sdwan-traffic-gen/ion-cli-audit.jsonl",
        "/tmp/stigix_ion_cli_audit.jsonl",
    ]
    for path in candidates:
        parent = os.path.dirname(path)
        if os.path.isdir(parent):
            try:
                with open(path, "a", encoding="utf-8") as f:
                    f.write(json.dumps(entry, separators=(",", ":")) + "\n")
                return
            except Exception:
                continue


def execute_ion_cli(
    sdk: Any,
    device_or_site: str,
    command: str,
    *,
    connect_fn: Optional[Callable[[Any, str], Any]] = None,
    ensure_user_fn: Optional[Callable[..., Dict[str, Any]]] = None,
    early_stop_check: Optional[Callable[[str], bool]] = None,
) -> Dict[str, Any]:
    """Validate `command`, resolve `device_or_site`, ensure toolkit user credentials, and execute over WebSocket."""
    t0 = time.monotonic()
    norm_cmd = validate_command(command)
    with _ion_cli_lock():
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
        sw_version = str(el.get("software_version") or "")
        candidates = build_command_fallbacks(norm_cmd, sw_version)
        primary_cmd = candidates[0] if candidates else norm_cmd
        fallback_cmds = candidates[1:] if len(candidates) > 1 else None

        creds = ensure_fn(sdk, rotate=False)

        async def _run_once(u: str, p: str) -> CliOutput:
            return await asyncio.wait_for(
                run_command(
                    lambda: ws_factory(sdk, element_id),
                    u,
                    p,
                    primary_cmd,
                    early_stop_check=early_stop_check,
                    fallback_commands=fallback_cmds,
                ),
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
                elif te.code in ("no_prompt", "connect_failed", "closed"):
                    # Brief backoff if the vION VTY is still tearing down a previous WebSocket session
                    time.sleep(1.0)
                    raw = asyncio.run(_run_once(creds["username"], creds["password"]))
                else:
                    raise
        except ToolkitError as e:
            _append_cli_audit_log({
                "timestamp": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                "site": site_name,
                "element": el.get("name"),
                "software_version": sw_version,
                "requested_command": norm_cmd,
                "duration_ms": int((time.monotonic() - t0) * 1000),
                "success": False,
                "error_code": e.code,
            })
            raise IonCliError(e.code, e.message, status=502) from None
        except asyncio.TimeoutError:
            _append_cli_audit_log({
                "timestamp": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                "site": site_name,
                "element": el.get("name"),
                "software_version": sw_version,
                "requested_command": norm_cmd,
                "duration_ms": int((time.monotonic() - t0) * 1000),
                "success": False,
                "error_code": "timeout",
            })
            raise IonCliError("timeout", ToolkitError.MESSAGES["timeout"], status=504) from None
        except IonCliError:
            raise
        except Exception as e:
            raise IonCliError("unavailable", ToolkitError.MESSAGES["connect_failed"], hint=type(e).__name__, status=502) from None

    text = str(raw or "")
    executed_cmd = getattr(raw, "executed_command", "") or primary_cmd
    duration_ms = int((time.monotonic() - t0) * 1000)
    rejected = device_rejection(text)
    if rejected:
        _append_cli_audit_log({
            "timestamp": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "site": site_name,
            "element": el.get("name"),
            "software_version": sw_version,
            "requested_command": norm_cmd,
            "executed_command": executed_cmd,
            "duration_ms": duration_ms,
            "success": False,
            "error_code": "command_rejected",
        })
        raise IonCliError(
            "command_rejected",
            f"The vION rejected the command: {rejected}",
            hint=REJECT_HINT,
            status=422,
        )

    # Record successful syntax mode for this software_version only when a filtered command was requested
    if sw_version and executed_cmd.startswith("inspect flow brief") and len(norm_cmd.split()) > 3:
        ex_toks = executed_cmd.split()
        if len(ex_toks) == 3:
            _save_capability(sw_version, "inspect_flow_brief", "bare")
        elif all(t.startswith(("srcv4=", "dstv4=")) for t in ex_toks[3:]):
            _save_capability(sw_version, "inspect_flow_brief", "ip_only")

    data_bytes = text.encode("utf-8", "replace")
    truncated = len(data_bytes) > MAX_OUTPUT_BYTES or bool(getattr(raw, "truncated", False))
    if truncated:
        text = data_bytes[:MAX_OUTPUT_BYTES].decode("utf-8", "ignore") + (
            "\n... (truncated: paging stopped at size cap, page limit, or time budget)"
        )

    read_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    _append_cli_audit_log({
        "timestamp": read_at,
        "site": site_name,
        "element": el.get("name"),
        "software_version": sw_version,
        "requested_command": norm_cmd,
        "executed_command": executed_cmd,
        "duration_ms": duration_ms,
        "bytes": len(data_bytes),
        "truncated": truncated,
        "success": True,
    })

    return {
        "success": True,
        "site": site_name,
        "site_id": str(el.get("site_id") or ""),
        "element": el.get("name"),
        "element_id": element_id,
        "software_version": sw_version,
        "command": executed_cmd,
        "output": text,
        "truncated": truncated,
        "bytes": len(data_bytes),
        "duration_ms": duration_ms,
        "read_at": read_at,
    }


_FLOW_HEAD_RX = re.compile(
    r"^(?P<vrf>\S+)\s+"
    r"(?P<src>(?:\d{1,3}\.){3}\d{1,3})\s+"
    r"(?P<dst>(?:\d{1,3}\.){3}\d{1,3})\s+"
    r"(?P<sport>\d+)\s+"
    r"(?P<dport>\d+)\s+"
    r"(?P<proto>\d+)\s+"
    r"(?P<start>\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})\s+"
    r"(?P<app>\S+)\s+"
    r"(?P<rest>.+)$"
)
_FLOW_TAIL_RX = re.compile(r"^(?P<mid>.*?)\s+(?P<sec_action>\S+)\s+(?P<wanpath>\d{15,20}|--)\s+(?P<path>[A-Za-z0-9_.-]+)\s*$")


def parse_inspect_flow_brief(output: str) -> List[Dict[str, Any]]:
    """Parse `inspect flow brief` tabular CLI output using regex anchors (`_FLOW_HEAD_RX` and `_FLOW_TAIL_RX`)
    so column additions or multi-word policy names across ION OS versions (6.5, 6.8, 7.x) never break extraction."""
    raw_lines = str(output or "").splitlines()
    merged_lines: List[str] = []
    for line in raw_lines:
        if not line.strip():
            continue
        stripped = line.strip()
        if stripped.startswith("VRF ") and "SRC" in stripped and "DST" in stripped:
            continue
        if stripped.startswith("SEC-ACTION") and "WANPATH-ID" in stripped:
            continue
        toks = stripped.split()
        is_new_record = len(toks) >= 6 and bool(_IPV4.fullmatch(toks[1])) and bool(_IPV4.fullmatch(toks[2]))
        if is_new_record:
            merged_lines.append(stripped)
        elif merged_lines:
            sep = "  " if line.startswith("  ") else (" " if line[0].isspace() else "")
            merged_lines[-1] = f"{merged_lines[-1]}{sep}{stripped}"

    flows: List[Dict[str, Any]] = []
    for row in merged_lines:
        m_head = _FLOW_HEAD_RX.match(row)
        if not m_head:
            continue
        rest = m_head.group("rest")
        m_tail = _FLOW_TAIL_RX.match(rest)
        if m_tail:
            mid_raw = m_tail.group("mid").strip()
            multi_cols = [c.strip() for c in re.split(r"\s{2,}", mid_raw) if c.strip()]
            if len(multi_cols) >= 3:
                mid_tokens = [multi_cols[0], multi_cols[1], " ".join(multi_cols[2:])]
            else:
                mid_tokens = mid_raw.split()
            sec_action = m_tail.group("sec_action")
            wanpath_id = m_tail.group("wanpath")
            raw_path_type = m_tail.group("path")
        else:
            r_toks = rest.split()
            if len(r_toks) < 3:
                continue
            mid_tokens = r_toks[:-3]
            sec_action = r_toks[-3]
            wanpath_id = r_toks[-2]
            raw_path_type = r_toks[-1]

        flows.append({
            "vrf": m_head.group("vrf"),
            "source_ip": m_head.group("src"),
            "destination_ip": m_head.group("dst"),
            "source_port": int(m_head.group("sport")),
            "destination_port": int(m_head.group("dport")),
            "protocol": int(m_head.group("proto")),
            "start_time": m_head.group("start"),
            "app_id": m_head.group("app"),
            "net_policy": mid_tokens[0] if len(mid_tokens) >= 1 else None,
            "pri_policy": mid_tokens[1] if len(mid_tokens) >= 2 else None,
            "sec_policy": " ".join(mid_tokens[2:]) if len(mid_tokens) >= 3 else None,
            "sec_action": sec_action,
            "wanpath_id": wanpath_id,
            "raw_path_type": raw_path_type,
        })
    return flows


def parse_servicelink_summary(output: str) -> List[Dict[str, Any]]:
    """Parse `dump servicelink summary all` CLI output into structured ServiceLink tunnel records."""
    links: List[Dict[str, Any]] = []
    for raw_line in str(output or "").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("-") or line.startswith("Total") or line.lower().startswith("vrf"):
            continue
        toks = line.split()
        if len(toks) >= 7 and toks[1].startswith("sl"):
            links.append({
                "vrf": toks[0],
                "device": toks[1],
                "name": toks[2],
                "status": toks[3],
                "ext_state": toks[4],
                "parent_dev": toks[5] if len(toks) > 5 else None,
                "local_ip": toks[6] if len(toks) > 6 else None,
                "peer": toks[7] if len(toks) > 7 else None,
                "type": toks[8] if len(toks) > 8 else None,
                "ipsec_profile": toks[9] if len(toks) > 9 else None,
            })
    return links


def resolve_wanpath_id(
    sdk: Any,
    site_id: str,
    site_name: str,
    wanpath_id: str,
    raw_path_type: str = "",
) -> Tuple[str, str]:
    """Translate a vION `WANPATH-ID` (e.g. '1772715676674020345') into `(egress_path, path_type)`
    matching Stigix `getflow.py` conventions (e.g. `('BR8-INET2 → DC2-INET', 'VPN')`)."""
    wid = str(wanpath_id or "").strip()
    if not wid or wid in ("--", "0", "N/A"):
        return (raw_path_type or "Direct / Local", "DirectInternet")

    topo_cache_file = f"/tmp/stigix_site_topo_{site_id}.json"
    now_epoch = datetime.now(timezone.utc).timestamp()
    topo: Dict[str, Any] = {}

    if site_id and os.path.exists(topo_cache_file):
        try:
            with open(topo_cache_file, "r", encoding="utf-8") as f:
                cached = json.load(f)
            if isinstance(cached, dict) and (now_epoch - float(cached.get("ts") or 0)) < 600:
                topo = cached.get("links") or {}
        except Exception:
            topo = {}

    if (not topo or wid not in topo) and sdk is not None and site_id:
        try:
            script_dir = os.path.dirname(os.path.abspath(__file__))
            if script_dir not in sys.path:
                sys.path.insert(0, script_dir)
            from getflow import get_topology
            fresh_topo = get_topology(sdk, site_id, debug=False)
            if isinstance(fresh_topo, dict) and fresh_topo:
                topo = fresh_topo
                try:
                    with open(topo_cache_file, "w", encoding="utf-8") as f:
                        json.dump({"ts": now_epoch, "links": topo}, f)
                except Exception:
                    pass
        except Exception:
            pass

    link = topo.get(wid) if isinstance(topo, dict) else None
    raw_low = str(raw_path_type or "").lower()

    if isinstance(link, dict):
        ltype = str(link.get("type") or "").lower()
        if ltype.endswith("-stub") or raw_low == "lan_to_wan":
            ckt = link.get("target_circuit_name") or link.get("source_circuit_name") or wid
            return (str(ckt), "DirectInternet")
        if "servicelink" in ltype or raw_low == "lan_to_servicelink":
            ckt = link.get("source_circuit_name") or link.get("target_circuit_name") or wid
            return (f"{ckt} → Standard VPN", "ServiceLink")

        src_ckt = str(link.get("source_circuit_name") or "Unknown")
        tgt_ckt = str(link.get("target_circuit_name") or "Unknown")
        tgt_site = str(link.get("target_site_name") or "")
        # In basenet topology, mesh links may be oriented Remote -> Local
        if site_name and (
            tgt_site.upper() == site_name.upper()
            or (
                tgt_ckt.upper().startswith(f"{site_name.upper()}-")
                and not src_ckt.upper().startswith(f"{site_name.upper()}-")
            )
        ):
            local_ckt, remote_ckt = tgt_ckt, src_ckt
        else:
            if site_name and src_ckt != "Unknown" and not src_ckt.upper().startswith(f"{site_name.upper()}-"):
                src_ckt = f"{site_name}-{src_ckt}"
            if tgt_site and tgt_ckt != "Unknown" and not tgt_ckt.upper().startswith(f"{tgt_site.upper()}-"):
                tgt_ckt = f"{tgt_site}-{tgt_ckt}"
            local_ckt, remote_ckt = src_ckt, tgt_ckt
        return (f"{local_ckt} → {remote_ckt}", "VPN")

    # Fallback: check site waninterfaces if direct WAN interface ID
    if sdk is not None and site_id:
        try:
            script_dir = os.path.dirname(os.path.abspath(__file__))
            if script_dir not in sys.path:
                sys.path.insert(0, script_dir)
            from sdwan_flow_analysis import FlowResolver
            resolved = FlowResolver(sdk, site_id).path(wid)
            if resolved and resolved != wid:
                p_type = "DirectInternet" if resolved.startswith("Direct:") else "VPN"
                clean_lbl = resolved.replace("Direct: ", "").replace("VPN: ", "").replace(" -> ", " → ")
                return (clean_lbl, p_type)
        except Exception:
            pass

    p_type = "VPN" if "vpn" in raw_low else ("ServiceLink" if "servicelink" in raw_low else "DirectInternet")
    return (f"{p_type} ({wid})", p_type)


def resolve_live_flow_cli(
    sdk: Any,
    device_or_site: str,
    *,
    dst_ip: Optional[str] = None,
    src_ip: Optional[str] = None,
    src_port: Optional[int] = None,
    dst_port: Optional[int] = None,
    protocol: Optional[int] = None,
    allow_relaxed_fallback: bool = False,
    allow_snat_fallback: bool = False,
) -> Dict[str, Any]:
    """Query real-time active dataplane flow(s) on a vION via `inspect flow brief <kv>`
    and resolve the active `WANPATH-ID` to a human-readable `egress_path`.

    Note: vION `inspect flow brief` accepts `srcv4=<ip>` and `dstv4=<ip>` in CLI,
    and rejects `sport=` / `protocol=` keywords. Port and protocol filtering is
    therefore performed locally on the parsed flow table.
    When `device_or_site` resolves to a multi-element HA site (e.g. 'DC1' with
    'DC1-R1' and 'DC1-R2'), automatically checks sibling HA elements if the first
    element has 0 matching flows.
    """
    kv_parts: List[str] = []
    # When allow_snat_fallback is True (Ingress Branch ION) and dst_ip is known, query by
    # dstv4=<dst_ip> in CLI and filter src_ip in Python so that if the Ingress ION applies
    # Source NAT (e.g. BR1 translating 192.168.207.10 -> 10.10.207.135), we still see the flow
    # in a single CLI round-trip.
    if src_ip and not (allow_snat_fallback and dst_ip):
        kv_parts.append(f"srcv4={src_ip}")
    if dst_ip:
        kv_parts.append(f"dstv4={dst_ip}")

    cmd = "inspect flow brief" + (" " + " ".join(kv_parts) if kv_parts else "")

    def _norm_proto_int(val: Any) -> Optional[int]:
        if val is None:
            return None
        s = str(val).strip().upper()
        if not s:
            return None
        if s in ("6", "TCP"):
            return 6
        if s in ("17", "UDP"):
            return 17
        if s in ("1", "ICMP"):
            return 1
        return int(s) if s.isdigit() and int(s) > 0 else None

    want_proto_int = _norm_proto_int(protocol)

    def _proto_ok(row_proto: Any, want_proto: Optional[int]) -> bool:
        if not want_proto or want_proto <= 0:
            return True
        p_str = str(row_proto or "").strip().upper()
        proto_aliases = {
            6: ("6", "TCP"),
            17: ("17", "UDP"),
            1: ("1", "ICMP"),
        }
        allowed = proto_aliases.get(want_proto, (str(want_proto),))
        return p_str in allowed

    def _stop_when_found(partial_text: str) -> bool:
        has_sport = bool(src_port and int(src_port) > 0)
        has_dport = bool(dst_port and int(dst_port) > 0)
        is_icmp = bool(want_proto_int == 1)
        if not has_sport and not has_dport and not is_icmp:
            return False
        # Only stop early when querying a single destination IP; in batch mode (no dst_ip)
        # we want the full flow table so all active destination targets are collected.
        if not dst_ip:
            return False
        rows = parse_inspect_flow_brief(partial_text)
        for r in rows:
            if not str(r.get("wanpath_id") or "").isdigit():
                continue
            if str(r.get("app_id") or "").lower() == "cloudgenix-probe":
                continue
            if dst_ip and r.get("destination_ip") != dst_ip and r.get("source_ip") != dst_ip:
                continue
            if src_ip and r.get("source_ip") != src_ip and r.get("destination_ip") != src_ip:
                continue
            if not _proto_ok(r.get("protocol"), want_proto_int):
                continue
            if is_icmp:
                return True
            if has_sport and (
                str(r.get("source_port")) == str(int(src_port))
                or str(r.get("destination_port")) == str(int(src_port))
            ):
                return True
            if has_dport and (
                str(r.get("destination_port")) == str(int(dst_port))
                or str(r.get("source_port")) == str(int(dst_port))
            ):
                return True
        return False

    def _filter_rows(all_rows: List[Dict[str, Any]]) -> Tuple[List[Dict[str, Any]], str]:
        all_rows.sort(key=lambda r: str(r.get("start_time") or ""), reverse=True)
        filtered = all_rows
        if dst_ip:
            filtered = [r for r in filtered if r.get("destination_ip") == dst_ip or r.get("source_ip") == dst_ip]
            non_probe = [r for r in filtered if str(r.get("app_id") or "").lower() != "cloudgenix-probe"]
            if non_probe:
                filtered = non_probe
            non_self = [r for r in filtered if str(r.get("sec_policy") or "").strip().lower() != "self-zone"]
            if non_self:
                filtered = non_self
            valid_path = [r for r in filtered if str(r.get("raw_path_type") or "").strip().lower() != "unknown_flow_path"]
            if valid_path:
                filtered = valid_path
            exact_dst = [r for r in filtered if r.get("destination_ip") == dst_ip]
            if exact_dst:
                filtered = exact_dst
        snat_used = False
        if src_ip:
            src_matches = [r for r in filtered if r.get("source_ip") == src_ip or r.get("destination_ip") == src_ip]
            exact_src = [r for r in src_matches if r.get("source_ip") == src_ip]
            if exact_src:
                filtered = exact_src
            elif src_matches:
                filtered = src_matches
            elif allow_snat_fallback and filtered:
                # Ingress Branch ION applies Source NAT (e.g. BR1 translating 192.168.207.10 -> 10.10.207.135)
                snat_used = True
            else:
                filtered = []
        if want_proto_int and want_proto_int > 0:
            proto_matches = [r for r in filtered if _proto_ok(r.get("protocol"), want_proto_int)]
            if proto_matches or not allow_relaxed_fallback or want_proto_int == 1:
                filtered = proto_matches

        has_sport = bool(src_port and int(src_port) > 0)
        has_dport = bool(dst_port and int(dst_port) > 0)
        confidence = "snat_translated" if snat_used else ("exact_5tuple" if (has_sport or has_dport) else "host_pair")
        if has_sport or has_dport:
            sport_matches = (
                [
                    r for r in filtered
                    if str(r.get("source_port")) == str(int(src_port)) or str(r.get("destination_port")) == str(int(src_port))
                ]
                if has_sport
                else []
            )
            dport_matches = (
                [
                    r for r in filtered
                    if str(r.get("destination_port")) == str(int(dst_port)) or str(r.get("source_port")) == str(int(dst_port))
                ]
                if has_dport
                else []
            )
            if sport_matches:
                filtered = sport_matches
                if has_dport:
                    both = [
                        r for r in filtered
                        if str(r.get("destination_port")) == str(int(dst_port)) or str(r.get("source_port")) == str(int(dst_port))
                    ]
                    if both:
                        filtered = both
                    else:
                        confidence = "sport_match"
            elif dport_matches:
                filtered = dport_matches
                confidence = "dport_match" if has_sport else "exact_5tuple"
            elif allow_relaxed_fallback and filtered:
                # Keep host/protocol matches with lower confidence for interactive E2E trace
                confidence = "host_pair_relaxed"
            else:
                # Strict port enforcement: never fall back to unrelated ports on the same destination IP
                filtered = []
        return filtered, confidence

    candidate_els, resolved_sname = resolve_site_elements(sdk, device_or_site)
    ha_checked: List[Dict[str, Any]] = []
    cli_res: Optional[Dict[str, Any]] = None
    parsed_rows: List[Dict[str, Any]] = []
    match_confidence = "exact_5tuple"
    total_table_flows = 0

    if len(candidate_els) <= 1:
        cli_res = execute_ion_cli(sdk, device_or_site, cmd, early_stop_check=_stop_when_found)
        raw_rows = parse_inspect_flow_brief(cli_res.get("output") or "")
        total_table_flows = len(raw_rows)
        parsed_rows, match_confidence = _filter_rows(raw_rows)
        ha_checked.append({
            "element": cli_res.get("element"),
            "total_flows": total_table_flows,
            "matched_flows": len(parsed_rows),
            "status": "ok",
        })
    else:
        last_err: Optional[Exception] = None
        for el_obj in candidate_els:
            el_name = str(el_obj.get("name") or device_or_site)
            try:
                res_el = execute_ion_cli(sdk, el_name, cmd, early_stop_check=_stop_when_found)
                raw_rows = parse_inspect_flow_brief(res_el.get("output") or "")
                matched_el, conf_el = _filter_rows(raw_rows)
                ha_checked.append({
                    "element": res_el.get("element") or el_name,
                    "total_flows": len(raw_rows),
                    "matched_flows": len(matched_el),
                    "status": "ok",
                })
                if cli_res is None or len(matched_el) > len(parsed_rows) or (len(parsed_rows) == 0 and len(raw_rows) > total_table_flows):
                    cli_res = res_el
                    parsed_rows = matched_el
                    match_confidence = conf_el
                    total_table_flows = len(raw_rows)
                if len(matched_el) > 0:
                    # Update target cache so future lookups hit the active HA element first
                    q_key = _normalize_site_token(device_or_site) or device_or_site.lower()
                    try:
                        cache_doc = {}
                        if os.path.exists(TARGET_CACHE_FILE):
                            with open(TARGET_CACHE_FILE, "r", encoding="utf-8") as f:
                                cache_doc = json.load(f) or {}
                        cache_doc[q_key] = {
                            "element": el_obj,
                            "site_name": resolved_sname or res_el.get("site"),
                            "ts": datetime.now(timezone.utc).timestamp(),
                        }
                        with open(TARGET_CACHE_FILE, "w", encoding="utf-8") as f:
                            json.dump(cache_doc, f)
                    except Exception:
                        pass
                    break
            except Exception as e:
                last_err = e
                ha_checked.append({
                    "element": el_name,
                    "total_flows": 0,
                    "matched_flows": 0,
                    "status": "error",
                    "error": str(e),
                })
        if cli_res is None:
            if last_err:
                raise last_err
            raise IonCliError("unavailable", f"No reachable vION elements for {device_or_site}")

    site_id = str(cli_res.get("site_id") or "")
    site_name = str(cli_res.get("site") or resolved_sname or device_or_site)

    enriched_flows: List[Dict[str, Any]] = []
    for row in parsed_rows:
        egress_path, path_type = resolve_wanpath_id(
            sdk,
            site_id,
            site_name,
            str(row.get("wanpath_id") or ""),
            str(row.get("raw_path_type") or ""),
        )
        enriched_flows.append({
            **row,
            "egress_path": egress_path,
            "path_type": path_type,
            "match_confidence": match_confidence,
            "path_history": [{"path": egress_path, "path_type": path_type, "timestamp": cli_res.get("read_at")}],
        })

    return {
        "success": True,
        "source": "ion_cli_websocket",
        "site_name": site_name,
        "site_id": site_id,
        "element": cli_res.get("element"),
        "software_version": cli_res.get("software_version"),
        "command": cli_res.get("command"),
        "duration_ms": cli_res.get("duration_ms"),
        "query_time": cli_res.get("read_at"),
        "total_table_flows": total_table_flows,
        "match_confidence": match_confidence,
        "ha_elements_checked": ha_checked,
        "flows": enriched_flows,
    }


def list_tenant_sites_cli(sdk: Any) -> Dict[str, Any]:
    """List all Prisma SD-WAN sites and their bound vION elements for E2E Flow Trace selection."""
    sites_raw, elements = _load_tenant_inventory(sdk)
    sites = [s for s in sites_raw if isinstance(s, dict) and s.get("id")]

    els_by_site: Dict[str, List[Dict[str, Any]]] = {}
    for el in elements:
        sid = str(el.get("site_id") or "")
        if sid:
            els_by_site.setdefault(sid, []).append({
                "id": str(el.get("id") or ""),
                "name": el.get("name"),
                "connected": bool(el.get("connected")),
                "role": el.get("role"),
                "software_version": el.get("software_version"),
            })

    out_sites: List[Dict[str, Any]] = []
    for s in sites:
        sid = str(s["id"])
        sname = str(s.get("name") or sid)
        s_els = els_by_site.get(sid, [])
        if not s_els:
            continue
        s_els.sort(key=lambda e: (not bool(e.get("connected")), str(e.get("name") or "")))
        role = s.get("element_cluster_role") or (
            "HUB" if any(e.get("role") == "HUB" for e in s_els) or "dc" in sname.lower() else "SPOKE"
        )
        out_sites.append({
            "site_id": sid,
            "site_name": sname,
            "role": role,
            "connected": any(e.get("connected") for e in s_els),
            "elements": s_els,
        })

    out_sites.sort(key=lambda s: (not s["connected"], s["role"] == "HUB", s["site_name"]))
    return {
        "success": True,
        "sites": out_sites,
    }


def _extract_peer_site_from_egress(sdk: Any, egress_path: str, current_site_name: str) -> Optional[str]:
    """Extract the peer SD-WAN site name from an `egress_path` like 'BR8-INET1 → DC1-INET'."""
    if not egress_path or "→" not in egress_path:
        return None
    rhs = egress_path.split("→", 1)[1].strip()
    if not rhs or rhs.lower() in ("standard vpn", "direct / local", "unknown"):
        return None
    # Candidate prefix before '-' (e.g. 'DC1-INET' -> 'DC1', 'BR5-INET2' -> 'BR5')
    cand_prefix = rhs.split("-", 1)[0].strip()
    try:
        sites_raw, _ = _load_tenant_inventory(sdk)
        sites = [s for s in sites_raw if isinstance(s, dict) and s.get("name")]
        for s in sites:
            sname = str(s.get("name") or "")
            if sname.upper() == current_site_name.upper():
                continue
            if rhs.upper().startswith(sname.upper() + "-") or sname.upper() == cand_prefix.upper():
                return sname
    except Exception:
        pass
    if cand_prefix and cand_prefix.upper() != current_site_name.upper():
        return cand_prefix
    return None


def _prime_ha_element_from_wanpath(sdk: Any, source_site_id: str, wanpath_id: str, peer_site_name: str) -> None:
    """Use the cached site topology link for `wanpath_id` to prime `TARGET_CACHE_FILE` with the
    exact remote HA element (`DC1-R1` vs `DC1-R2`, `DC2-R1` vs `DC2-R2`) that terminates this VPN tunnel."""
    wid = str(wanpath_id or "").strip()
    if not source_site_id or not wid or not peer_site_name:
        return
    topo_cache_file = f"/tmp/stigix_site_topo_{source_site_id}.json"
    if not os.path.exists(topo_cache_file):
        return
    try:
        with open(topo_cache_file, "r", encoding="utf-8") as f:
            cached = json.load(f) or {}
        link = (cached.get("links") or {}).get(wid)
        if not isinstance(link, dict):
            return
        cand_el_ids = {
            str(link.get("target_site_id") or "").strip(),
            str(link.get("source_site_id") or "").strip(),
        } - {""}
        if not cand_el_ids:
            return
        _, elements = _load_tenant_inventory(sdk)
        for el in elements:
            eid = str(el.get("id") or "").strip()
            if eid in cand_el_ids and bool(el.get("connected", True)):
                q_key = _normalize_site_token(peer_site_name) or peer_site_name.lower()
                ename_norm = _normalize_site_token(str(el.get("name") or ""))
                if ename_norm == q_key or str(el.get("name") or "").lower().startswith(peer_site_name.lower()):
                    cache_doc = {}
                    if os.path.exists(TARGET_CACHE_FILE):
                        try:
                            with open(TARGET_CACHE_FILE, "r", encoding="utf-8") as cf:
                                cache_doc = json.load(cf) or {}
                        except Exception:
                            cache_doc = {}
                    cache_doc[q_key] = {
                        "element": el,
                        "site_name": peer_site_name,
                        "ts": datetime.now(timezone.utc).timestamp(),
                    }
                    with open(TARGET_CACHE_FILE, "w", encoding="utf-8") as cf:
                        json.dump(cache_doc, cf)
                    return
    except Exception:
        pass


def trace_flow_path_cli(
    sdk: Any,
    source_site: str,
    *,
    dst_ip: Optional[str] = None,
    src_ip: Optional[str] = None,
    src_port: Optional[int] = None,
    dst_port: Optional[int] = None,
    protocol: Optional[int] = None,
) -> Dict[str, Any]:
    """Execute an End-to-End SD-WAN Dataplane Flow Trace:
    1. Inspect active flow table on the Ingress Branch ION (`source_site`) to extract App-ID,
       Network/Path Policy, QoS Priority Policy, Security Zone/Policy/Action, and Egress WAN Path.
    2. Automatically determine the Forwarding Mode:
       - `VPN_OVERLAY` (Site-to-Site or DC Backhaul): automatically chain `inspect flow brief`
         onto the peer/transit Hub or Branch ION (e.g. DC1-R2 / DC2-R1 / BR5) to verify tunnel arrival!
       - `SERVICELINK_SSE` (Prisma Access / Zscaler / Standard IPSec): query `dump servicelink summary all`
         on the ingress ION to report live ServiceLink tunnel status.
       - `DIRECT_INTERNET_DIA` (Local Breakout): report direct WAN circuit breakout.
    """
    t0 = time.monotonic()
    ingress = resolve_live_flow_cli(
        sdk,
        source_site,
        dst_ip=dst_ip,
        src_ip=src_ip,
        src_port=src_port,
        dst_port=dst_port,
        protocol=protocol,
        allow_relaxed_fallback=True,
        allow_snat_fallback=True,
    )

    ingress_flows = ingress.get("flows") or []
    primary_flow = ingress_flows[0] if ingress_flows else None

    forwarding_mode = "NO_ACTIVE_FLOW"
    peer_site_name: Optional[str] = None
    transit_hop: Optional[Dict[str, Any]] = None
    servicelinks: List[Dict[str, Any]] = []

    if primary_flow:
        p_type = str(primary_flow.get("path_type") or "")
        raw_path = str(primary_flow.get("raw_path_type") or "").lower()
        egress_path = str(primary_flow.get("egress_path") or "")
        net_pol = str(primary_flow.get("net_policy") or "").lower()

        if p_type == "ServiceLink" or "servicelink" in raw_path or "zscaler" in egress_path.lower() or "prisma" in egress_path.lower() or "zscaler" in net_pol or "prisma" in net_pol:
            forwarding_mode = "SERVICELINK_SSE"
            try:
                sys.stderr.write(
                    "STIGIX_TRACE_PROGRESS:"
                    + json.dumps(
                        {
                            "phase": "SERVICELINK_CLI",
                            "forwarding_mode": forwarding_mode,
                            "peer_site_name": "ServiceLink SSE",
                            "ingress_ion": {
                                "element": ingress.get("element"),
                                "site_name": ingress.get("site_name"),
                                "software_version": ingress.get("software_version"),
                                "total_table_flows": ingress.get("total_table_flows"),
                                "matched_flows_count": len(ingress_flows),
                                "duration_ms": ingress.get("duration_ms"),
                            },
                            "primary_flow": primary_flow,
                        },
                        separators=(",", ":"),
                    )
                    + "\n"
                )
                sys.stderr.flush()
            except Exception:
                pass
            try:
                sl_res = execute_ion_cli(sdk, str(ingress.get("element") or source_site), "dump servicelink summary all")
                servicelinks = parse_servicelink_summary(sl_res.get("output") or "")
            except Exception:
                servicelinks = []
        elif p_type == "VPN" or "vpn" in raw_path:
            peer_site_name = _extract_peer_site_from_egress(sdk, egress_path, str(ingress.get("site_name") or source_site))
            if peer_site_name:
                is_dc_peer = "dc" in peer_site_name.lower() or "hub" in peer_site_name.lower()
                # Check if destination IP is public vs RFC1918 to distinguish DC Backhaul vs Private DC App
                flow_dst = str(primary_flow.get("destination_ip") or dst_ip or "")
                is_private_dst = (
                    flow_dst.startswith("10.")
                    or flow_dst.startswith("192.168.")
                    or bool(re.match(r"^172\.(1[6-9]|2[0-9]|3[0-1])\.", flow_dst))
                )
                if is_dc_peer and not is_private_dst:
                    forwarding_mode = "DC_BACKHAUL_INTERNET"
                elif is_dc_peer:
                    forwarding_mode = "DC_PRIVATE_APP"
                else:
                    forwarding_mode = "BRANCH_TO_BRANCH_VPN"

                try:
                    _prime_ha_element_from_wanpath(
                        sdk,
                        str(ingress.get("site_id") or ""),
                        str(primary_flow.get("wanpath_id") or ""),
                        peer_site_name,
                    )
                    try:
                        sys.stderr.write(
                            "STIGIX_TRACE_PROGRESS:"
                            + json.dumps(
                                {
                                    "phase": "TRANSIT_ION_CLI",
                                    "forwarding_mode": forwarding_mode,
                                    "peer_site_name": peer_site_name,
                                    "ingress_ion": {
                                        "element": ingress.get("element"),
                                        "site_name": ingress.get("site_name"),
                                        "software_version": ingress.get("software_version"),
                                        "total_table_flows": ingress.get("total_table_flows"),
                                        "matched_flows_count": len(ingress_flows),
                                        "duration_ms": ingress.get("duration_ms"),
                                    },
                                    "primary_flow": primary_flow,
                                },
                                separators=(",", ":"),
                            )
                            + "\n"
                        )
                        sys.stderr.flush()
                    except Exception:
                        pass
                    transit_hop = resolve_live_flow_cli(
                        sdk,
                        peer_site_name,
                        dst_ip=str(primary_flow.get("destination_ip") or dst_ip or "") or None,
                        src_ip=str(primary_flow.get("source_ip") or src_ip or "") or None,
                        src_port=primary_flow.get("source_port") or src_port,
                        dst_port=primary_flow.get("destination_port") or dst_port,
                        protocol=primary_flow.get("protocol") or protocol,
                        allow_relaxed_fallback=True,
                    )
                except Exception as e:
                    transit_hop = {
                        "success": False,
                        "site_name": peer_site_name,
                        "error": str(e),
                        "flows": [],
                    }
            else:
                forwarding_mode = "VPN_OVERLAY"
        else:
            forwarding_mode = "DIRECT_INTERNET_DIA"

    return {
        "success": True,
        "duration_ms": int((time.monotonic() - t0) * 1000),
        "forwarding_mode": forwarding_mode,
        "peer_site_name": peer_site_name,
        "ingress_ion": ingress,
        "primary_flow": primary_flow,
        "transit_ion": transit_hop,
        "servicelinks": servicelinks,
    }


_SASE_SESSION_CACHE_FILE = "/tmp/stigix_sase_sdk_session.json"
_SASE_SESSION_TTL_S = 600  # 10 minutes (Prisma SASE OAuth tokens expire after 15 minutes)


def _authenticate_sdk(credentials_path: str = "credentials.json", *, force_refresh: bool = False) -> Any:
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

    now_epoch = datetime.now(timezone.utc).timestamp()
    if not force_refresh and os.path.exists(_SASE_SESSION_CACHE_FILE):
        try:
            with open(_SASE_SESSION_CACHE_FILE, "r", encoding="utf-8") as f:
                cached = json.load(f)
            if (
                isinstance(cached, dict)
                and cached.get("client_id") == creds.get("client_id")
                and cached.get("tsg_id") == str(creds.get("tsg_id"))
                and (now_epoch - float(cached.get("ts") or 0)) < _SASE_SESSION_TTL_S
                and cached.get("ws_headers")
            ):
                sdk.controller = str(cached.get("controller") or sdk.controller)
                sdk.tenant_id = cached.get("tenant_id")
                sdk.jwt_expires_at = datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(seconds=_SASE_SESSION_TTL_S)
                sdk._refresh_jwt = lambda: True
                sdk._websocket_headers = dict(cached.get("ws_headers") or {})
                sess = getattr(sdk, "_session", None)
                if sess is not None and isinstance(cached.get("session_headers"), dict):
                    sess.headers.update(cached["session_headers"])
                return sdk
        except Exception:
            pass

    ok = sdk.interactive.login_secret(
        client_id=creds["client_id"],
        client_secret=creds["client_secret"],
        tsg_id=creds["tsg_id"],
    )
    if not ok:
        raise IonCliError("auth_failed", "Prisma SD-WAN login_secret returned False.", status=502)

    try:
        sess = getattr(sdk, "_session", None)
        cache_doc = {
            "ts": now_epoch,
            "client_id": creds.get("client_id"),
            "tsg_id": str(creds.get("tsg_id")),
            "controller": getattr(sdk, "controller", "https://api.sase.paloaltonetworks.com"),
            "tenant_id": getattr(sdk, "tenant_id", None),
            "jwt_expires_epoch": now_epoch + 900,
            "ws_headers": dict(getattr(sdk, "_websocket_headers", None) or {}),
            "session_headers": dict(sess.headers) if sess is not None and hasattr(sess, "headers") else {},
        }
        with open(_SASE_SESSION_CACHE_FILE, "w", encoding="utf-8") as f:
            json.dump(cache_doc, f)
        try:
            os.chmod(_SASE_SESSION_CACHE_FILE, 0o600)
        except Exception:
            pass
    except Exception:
        pass

    return sdk


def main() -> None:
    parser = argparse.ArgumentParser(description="Read-Only Prisma SD-WAN vION CLI via WebSocket Device Toolkit")
    parser.add_argument("--device", default="", help="vION element name or site name (e.g. 'BR1', 'br1-vion1', 'Branch-01-01')")
    parser.add_argument("--command", default="", help="Read-only ION CLI command (e.g. 'dump vpn summary all')")
    parser.add_argument("--resolve-flow", action="store_true", help="Resolve active dataplane flow via inspect flow brief + topology lookup")
    parser.add_argument("--trace-path", action="store_true", help="Execute end-to-end SD-WAN flow trace across ingress and transit/hub IONs")
    parser.add_argument("--list-sites", action="store_true", help="List all Prisma SD-WAN sites and connected ION elements")
    parser.add_argument("--dst-ip", default=None, help="Destination IPv4 filter for --resolve-flow / --trace-path")
    parser.add_argument("--src-ip", default=None, help="Source IPv4 filter for --resolve-flow / --trace-path")
    parser.add_argument("--src-port", type=int, default=None, help="Source port filter for --resolve-flow / --trace-path")
    parser.add_argument("--dst-port", type=int, default=None, help="Destination port filter for --resolve-flow / --trace-path")
    parser.add_argument("--protocol", type=int, default=None, help="IP protocol number filter (e.g. 17 for UDP, 6 for TCP)")
    parser.add_argument("--credentials", default="credentials.json", help="Credentials file path")
    parser.add_argument("--json", action="store_true", help="Output JSON")
    parsed = parser.parse_args()

    try:
        if parsed.list_sites:
            sdk = _authenticate_sdk(parsed.credentials)
            try:
                res = list_tenant_sites_cli(sdk)
            except Exception:
                sdk = _authenticate_sdk(parsed.credentials, force_refresh=True)
                res = list_tenant_sites_cli(sdk)
            print(json.dumps(res, indent=2))
            return

        if not parsed.device:
            raise IonCliError("bad_request", "--device is required unless --list-sites is specified.")

        if parsed.trace_path:
            sdk = _authenticate_sdk(parsed.credentials)
            try:
                res = trace_flow_path_cli(
                    sdk,
                    parsed.device,
                    dst_ip=parsed.dst_ip,
                    src_ip=parsed.src_ip,
                    src_port=parsed.src_port,
                    dst_port=parsed.dst_port,
                    protocol=parsed.protocol,
                )
            except IonCliError as e:
                if e.code in ("connect_failed", "unavailable", "toolkit_user_error"):
                    sdk = _authenticate_sdk(parsed.credentials, force_refresh=True)
                    res = trace_flow_path_cli(
                        sdk,
                        parsed.device,
                        dst_ip=parsed.dst_ip,
                        src_ip=parsed.src_ip,
                        src_port=parsed.src_port,
                        dst_port=parsed.dst_port,
                        protocol=parsed.protocol,
                    )
                else:
                    raise
            print(json.dumps(res, indent=2))
            return

        if parsed.resolve_flow:
            sdk = _authenticate_sdk(parsed.credentials)
            try:
                res = resolve_live_flow_cli(
                    sdk,
                    parsed.device,
                    dst_ip=parsed.dst_ip,
                    src_ip=parsed.src_ip,
                    src_port=parsed.src_port,
                    dst_port=parsed.dst_port,
                    protocol=parsed.protocol,
                )
            except IonCliError as e:
                if e.code in ("connect_failed", "unavailable", "toolkit_user_error"):
                    sdk = _authenticate_sdk(parsed.credentials, force_refresh=True)
                    res = resolve_live_flow_cli(
                        sdk,
                        parsed.device,
                        dst_ip=parsed.dst_ip,
                        src_ip=parsed.src_ip,
                        src_port=parsed.src_port,
                        dst_port=parsed.dst_port,
                        protocol=parsed.protocol,
                    )
                else:
                    raise
            print(json.dumps(res, indent=2))
            return

        if not parsed.command:
            raise IonCliError("bad_request", "Either --command, --resolve-flow, --trace-path, or --list-sites is required.")
        # Validate command syntax first before authenticating to the controller
        validate_command(parsed.command)
        sdk = _authenticate_sdk(parsed.credentials)
        try:
            res = execute_ion_cli(sdk, parsed.device, parsed.command)
        except IonCliError as e:
            if e.code in ("connect_failed", "unavailable", "toolkit_user_error"):
                sdk = _authenticate_sdk(parsed.credentials, force_refresh=True)
                res = execute_ion_cli(sdk, parsed.device, parsed.command)
            else:
                raise
        print(json.dumps(res, indent=2))
    except IonCliError as err:
        print(json.dumps(err.to_dict(), indent=2))
        sys.exit(0)
    except Exception as exc:
        print(json.dumps({"success": False, "error": str(exc), "code": type(exc).__name__}, indent=2))
        sys.exit(1)


if __name__ == "__main__":
    main()
