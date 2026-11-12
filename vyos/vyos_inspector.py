#!/usr/bin/env python3
"""Read-only VyOS Live Inspector engine for Stigix.

Validates every command against `vyos_cli_policy.py` (READ-ONLY BY CONSTRUCTION) and executes it
against a configured Stigix VyOS router using:
  1. VyOS HTTPS REST API (`/show`, `/traceroute`, `/retrieve`) with the router's `apiKey`
  2. SSH transport (`paramiko` or `ssh` / `sshpass`) for active probes (`ping`, `traceroute` with source-address),
     bounded text packet capture (`sudo timeout 10 tcpdump ...`), and kernel statistics (`/bin/ip -s link show`,
     `/sbin/tc -s qdisc show dev <eth>`), with automatic HTTPS API fallbacks where applicable.

Output is stripped of ANSI codes, redacted of secrets/keys, truncated to safe line/byte budgets,
and enriched with structured fields (interfaces table, netem queue summary, ping stats, traceroute hops).
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import ssl
import subprocess
import sys
import time
import urllib.request
import uuid

try:
    import urllib3  # type: ignore
    urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
except ImportError:
    urllib3 = None  # type: ignore

try:
    import requests  # type: ignore
except ImportError:
    requests = None  # type: ignore

# Ensure local directory imports work regardless of cwd
_THIS_DIR = os.path.dirname(os.path.abspath(__file__))
if _THIS_DIR not in sys.path:
    sys.path.insert(0, _THIS_DIR)

import vyos_cli_policy as P
import traceroute_parse as TR

_ANSI = re.compile(r"\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b[()][A-Za-z0-9]|\r")
_SECRET_LINE = re.compile(
    r"(passw|secret|\bkeys?\b|[-_]keys?\b|\bkeys?[-_]|token|communit|phash|plaintext|encrypted|pre-?shared|psk|md5|"
    r"\$[0-9a-z]{1,3}\$|private|credential|certificate|\bca\b|\bauth|ike-group|esp-group|\bpki\b)",
    re.I,
)
_SECRET_PREFIXES = ("set system login", "set service https api", "set service snmp", "set vpn ipsec", "set pki")
MAX_INTERFACE_ROWS = 32


def _clean(text) -> str:
    return _ANSI.sub("", str(text or "")).replace("\x00", "")


def redact_text(text: str, known_secrets: tuple[str, ...] = ()) -> str:
    """Redact known secrets (API keys, SSH passwords) from output text."""
    out = str(text or "")
    for s in known_secrets:
        if s and len(str(s).strip()) >= 4:
            out = out.replace(str(s).strip(), "***REDACTED***")
    return out


def filter_config(text: str, section: str = "") -> tuple[str, int]:
    """Return (kept text, withheld line count): only `set` lines, those of `section` when given, no secret-looking line."""
    kept, withheld = [], 0
    for line in text.splitlines():
        s = line.strip()
        if not s.startswith("set "):
            continue
        if section and not (s.startswith(f"set {section} ") or s == f"set {section}"):
            continue
        low = s.lower()
        if low.startswith(_SECRET_PREFIXES) or _SECRET_LINE.search(s):
            withheld += 1
            continue
        kept.append(s)
    return "\n".join(kept), withheld


def config_dict_to_set_commands(cfg: dict, prefix: list[str] | None = None) -> list[str]:
    """Convert a VyOS `/retrieve` JSON config dictionary into flat `set ...` CLI lines."""
    if prefix is None:
        prefix = []
    lines: list[str] = []
    if not isinstance(cfg, dict):
        return lines
    for k, v in cfg.items():
        cur = prefix + [str(k)]
        if isinstance(v, dict):
            if not v:
                lines.append("set " + " ".join(cur))
            else:
                lines.extend(config_dict_to_set_commands(v, cur))
        elif isinstance(v, list):
            for item in v:
                if isinstance(item, dict):
                    lines.extend(config_dict_to_set_commands(item, cur))
                else:
                    lines.append("set " + " ".join(cur + [str(item)]))
        elif v is None or v == "":
            lines.append("set " + " ".join(cur))
        else:
            lines.append("set " + " ".join(cur + [str(v)]))
    return lines


def _match_lines(text: str, address: str) -> list[str]:
    rx = re.compile(rf"(?<![0-9.]){re.escape(address)}(?![0-9])")
    return [l for l in text.splitlines() if rx.search(l)]


def _cap_bytes(text: str, limit: int) -> tuple[str, bool]:
    raw = text.encode("utf-8", "replace")
    if len(raw) <= limit:
        return text, False
    return raw[:limit].decode("utf-8", "ignore") + f"\n... (truncated, {len(raw) - limit} more bytes)", True


def shape_output(parsed: P.Parsed, raw: str, *, known_secrets: tuple[str, ...] = ()) -> dict:
    """Post-process, redact, and cap output according to the matched policy rule."""
    text = _clean(raw)
    meta: dict = {"truncated": False}
    if parsed.post in ("config", "section"):
        text, withheld = filter_config(text, parsed.arg if parsed.post == "section" else "")
        meta["lines_withheld"] = withheld
        if withheld:
            meta["note"] = (
                f"{withheld} configuration lines that look like secrets (keys, passwords, hashes, communities) were withheld."
            )
    elif parsed.post == "match":
        lines = _match_lines(text, parsed.arg)
        meta["lines_total"] = len(lines)
        if len(lines) > P.MAX_TABLE_LINES:
            lines, meta["truncated"] = lines[:P.MAX_TABLE_LINES], True
        text = "\n".join(lines)
    elif parsed.post == "table":
        lines = text.splitlines()
        meta["lines_total"] = len(lines)
        if len(lines) > P.MAX_TABLE_LINES:
            text, meta["truncated"] = "\n".join(lines[:P.MAX_TABLE_LINES]), True
    elif parsed.post == "tail":
        lines = text.splitlines()
        text = "\n".join(lines[-int(parsed.arg):]) if parsed.arg.isdigit() else text
    text = redact_text(text, known_secrets)
    text, cut = _cap_bytes(text, parsed.max_bytes)
    meta["truncated"] = meta["truncated"] or cut
    return {"output": text, **meta}


# ---- Structured parsers (Interfaces, Netem Queue, Ping) ---------------------------------------------------------
_SL = re.compile(r"^[uDA]/[uDA]$")
_LINK_HEAD = re.compile(r"^\d+:\s+([^:\s]+):\s+<([^>]*)>(.*)$")
_NUMS = re.compile(r"^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)")


def parse_show_interfaces(text: str) -> dict:
    """`show interfaces` -> {name: {addresses, state, description}}."""
    out: dict = {}
    last = None
    for line in _clean(text).splitlines():
        if not line.strip() or line.startswith(("Codes:", "Interface", "---------")):
            continue
        tokens = line.split()
        if line[0] in " \t":
            if last and len(tokens) == 1 and "/" in tokens[0]:
                out[last]["addresses"].append(tokens[0])
            continue
        idx = next((i for i, t in enumerate(tokens) if _SL.match(t)), None)
        name = tokens[0].split("@")[0]
        row = {
            "addresses": [t for t in (tokens[1:idx] if idx is not None else tokens[1:]) if "/" in t or t == "-"],
            "state": tokens[idx] if idx is not None else None,
            "description": " ".join(tokens[idx + 1:]) if idx is not None else "",
        }
        row["addresses"] = [a for a in row["addresses"] if a != "-"]
        out[name] = row
        last = name
    return out


def parse_ip_link_stats(text: str) -> dict:
    """`ip -s link show` -> {name: {admin_up, link_up, mtu, rx_packets, rx_errors, rx_dropped, tx_packets, tx_errors, tx_dropped}}."""
    out: dict = {}
    cur, expect = None, None
    for line in _clean(text).splitlines():
        m = _LINK_HEAD.match(line)
        if m:
            name = m.group(1).split("@")[0]
            flags = set(m.group(2).split(","))
            rest = m.group(3)
            mtu = re.search(r"\bmtu (\d+)", rest)
            st = re.search(r"\bstate (\w+)", rest)
            cur = out[name] = {
                "admin_up": "UP" in flags,
                "link_up": "LOWER_UP" in flags and (st.group(1) != "DOWN" if st else True),
                "mtu": int(mtu.group(1)) if mtu else None,
                "oper_state": st.group(1) if st else None,
            }
            expect = None
            continue
        if cur is None:
            continue
        s = line.strip()
        if s.startswith("RX:"):
            expect = "rx"
        elif s.startswith("TX:"):
            expect = "tx"
        elif expect:
            n = _NUMS.match(line)
            if n:
                cur[f"{expect}_bytes"], cur[f"{expect}_packets"] = int(n.group(1)), int(n.group(2))
                cur[f"{expect}_errors"], cur[f"{expect}_dropped"] = int(n.group(3)), int(n.group(4))
            expect = None
    return out


def _ifkey(name: str):
    m = re.fullmatch(r"([a-z]+)(\d*)", name)
    return (name != "lo", m.group(1) if m else name, int(m.group(2)) if m and m.group(2) else 0)


def merge_interfaces(show: dict, stats: dict) -> list[dict]:
    rows = []
    for name in sorted(set(show) | set(stats), key=_ifkey):
        s, k = show.get(name, {}), stats.get(name, {})
        state = s.get("state")
        admin_up = (not state.startswith("A")) if state else k.get("admin_up")
        link_up = (state == "u/u") if state else k.get("link_up")
        rows.append({
            "name": name,
            "admin": None if admin_up is None else ("up" if admin_up else "down"),
            "link": None if link_up is None else ("up" if link_up else "down"),
            "addresses": s.get("addresses") or [],
            "description": s.get("description") or "",
            "mtu": k.get("mtu"),
            **{f: k.get(f) for f in ("rx_bytes", "rx_packets", "rx_errors", "rx_dropped", "tx_bytes", "tx_packets", "tx_errors", "tx_dropped")},
        })
    return rows[:MAX_INTERFACE_ROWS]


def parse_netem_queue_output(text: str) -> dict:
    """Extract structured qdisc / netem telemetry (delay, loss, rate, sent_packets, dropped, overlimits) from tc/queue output."""
    clean = _clean(text)
    qdiscs: list[dict] = []
    cur: dict | None = None
    for line in clean.splitlines():
        s = line.strip()
        m_q = re.match(r"^qdisc\s+(\S+)\s+(\S+):\s+(.*)$", s)
        if m_q:
            qtype, handle, rest = m_q.group(1), m_q.group(2), m_q.group(3)
            delay_m = re.search(r"\bdelay\s+(\S+)", rest)
            loss_m = re.search(r"\bloss\s+(\S+)", rest)
            rate_m = re.search(r"\brate\s+(\S+)", rest)
            corrupt_m = re.search(r"\bcorrupt\s+(\S+)", rest)
            reorder_m = re.search(r"\breorder\s+(\S+)", rest)
            cur = {
                "qdisc": qtype,
                "handle": handle,
                "raw_params": rest,
                "delay": delay_m.group(1) if delay_m else None,
                "loss": loss_m.group(1) if loss_m else None,
                "rate": rate_m.group(1) if rate_m else None,
                "corrupt": corrupt_m.group(1) if corrupt_m else None,
                "reorder": reorder_m.group(1) if reorder_m else None,
                "sent_bytes": None,
                "sent_packets": None,
                "dropped": None,
                "overlimits": None,
            }
            qdiscs.append(cur)
            continue
        if cur is not None:
            m_sent = re.search(r"Sent\s+(\d+)\s+bytes\s+(\d+)\s+pkt\s+\(dropped\s+(\d+),\s+overlimits\s+(\d+)", s)
            if m_sent:
                cur["sent_bytes"] = int(m_sent.group(1))
                cur["sent_packets"] = int(m_sent.group(2))
                cur["dropped"] = int(m_sent.group(3))
                cur["overlimits"] = int(m_sent.group(4))
    has_netem = any(q["qdisc"] == "netem" or q.get("delay") or q.get("loss") or q.get("rate") for q in qdiscs)
    total_dropped = sum((q.get("dropped") or 0) for q in qdiscs)
    return {
        "qdiscs": qdiscs,
        "netem_active": has_netem,
        "total_dropped": total_dropped,
    }


def parse_ping_output(text: str) -> dict:
    """Extract structured summary from ping output."""
    clean = _clean(text)
    summary: dict = {}
    m_pkt = re.search(r"(\d+)\s+packets transmitted,\s+(\d+)\s+(?:packets )?received,.*?(\d+(?:\.\d+)?)%\s+packet loss", clean)
    if m_pkt:
        tx, rx, loss = int(m_pkt.group(1)), int(m_pkt.group(2)), float(m_pkt.group(3))
        summary["transmitted"] = tx
        summary["received"] = rx
        summary["loss_pct"] = loss
        summary["reachable"] = rx > 0
    m_rtt = re.search(r"(?:rtt|round-trip)\s+min/avg/max/(?:mdev|stddev)\s*=\s*(\d+(?:\.\d+)?)/(\d+(?:\.\d+)?)/(\d+(?:\.\d+)?)", clean)
    if m_rtt:
        summary["rtt_min_ms"] = float(m_rtt.group(1))
        summary["rtt_avg_ms"] = float(m_rtt.group(2))
        summary["rtt_max_ms"] = float(m_rtt.group(3))
    return summary


# ---- Transport Helpers (VyOS HTTPS API + SSH) -------------------------------------------------------------------
def _vyos_multipart_post(url: str, payload: str, api_key: str, timeout_s: int = 20, verify: bool = False) -> dict:
    """Send a multipart/form-data POST request to VyOS HTTPS REST API (`requests` with stdlib `urllib.request` fallback)."""
    if requests is not None:
        files = {
            "data": (None, payload),
            "key": (None, api_key),
        }
        resp = requests.post(url, files=files, verify=verify, timeout=timeout_s)
        resp.raise_for_status()
        return resp.json()

    boundary = f"----StigixVyosBoundary{uuid.uuid4().hex}"
    body_lines = [
        f"--{boundary}",
        'Content-Disposition: form-data; name="data"',
        "",
        payload,
        f"--{boundary}",
        'Content-Disposition: form-data; name="key"',
        "",
        api_key,
        f"--{boundary}--",
        "",
    ]
    body = "\r\n".join(body_lines).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
        method="POST",
    )
    ctx = None if verify else ssl._create_unverified_context()
    with urllib.request.urlopen(req, timeout=timeout_s, context=ctx) as resp:
        raw = resp.read().decode("utf-8", errors="replace")
        return json.loads(raw)


def vyos_https_show(host: str, api_key: str, path_tokens: list[str], timeout_s: int = 20, verify: bool = False) -> str:
    """Call VyOS HTTPS `/show` endpoint with op='show' and path=path_tokens."""
    url = f"https://{host}/show"
    payload = json.dumps({"op": "show", "path": path_tokens})
    r = _vyos_multipart_post(url, payload, api_key, timeout_s=timeout_s, verify=verify)
    if not r.get("success", False):
        err = r.get("error") or "VyOS /show returned success=false"
        raise RuntimeError(str(err))
    return str(r.get("data") or "")


def vyos_https_traceroute(host: str, api_key: str, target_host: str, timeout_s: int = 25, verify: bool = False) -> str:
    """Call VyOS HTTPS `/traceroute` endpoint."""
    url = f"https://{host}/traceroute"
    payload = json.dumps({"op": "traceroute", "host": target_host})
    r = _vyos_multipart_post(url, payload, api_key, timeout_s=timeout_s, verify=verify)
    if not r.get("success", False):
        err = r.get("error") or "VyOS /traceroute returned success=false"
        raise RuntimeError(str(err))
    return str(r.get("data") or "")


def vyos_https_retrieve_config(host: str, api_key: str, timeout_s: int = 20, verify: bool = False) -> dict:
    """Retrieve full running config via VyOS HTTPS `/retrieve` endpoint."""
    url = f"https://{host}/retrieve"
    payload = json.dumps({"op": "showConfig", "path": []})
    r = _vyos_multipart_post(url, payload, api_key, timeout_s=timeout_s, verify=verify)
    if not r.get("success", False):
        raise RuntimeError(str(r.get("error") or "VyOS /retrieve failed"))
    data = r.get("data")
    return data if isinstance(data, dict) else {}


def vyos_ssh_exec(
    host: str,
    cmd: str,
    *,
    ssh_user: str = "",
    ssh_password: str = "",
    ssh_key: str = "",
    ssh_port: int = 22,
    timeout_s: int = 20,
    is_vyos_op: bool = False,
) -> str:
    """Execute a command on a VyOS router over SSH using paramiko or openssh client."""
    user = (ssh_user or os.environ.get("VYOS_SSH_USER") or "vyos").strip()
    password = ssh_password if ssh_password != "" else os.environ.get("VYOS_SSH_PASSWORD", "vyos")
    key_path = (ssh_key or os.environ.get("VYOS_SSH_KEY") or "").strip()
    port = int(ssh_port or os.environ.get("VYOS_SSH_PORT") or 22)

    remote_cmd = f"/bin/vbash -ic {json.dumps(cmd)}" if is_vyos_op else cmd

    # 1. Try paramiko if installed
    try:
        import paramiko  # type: ignore

        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        connect_kwargs: dict = {
            "hostname": host,
            "port": port,
            "username": user,
            "timeout": min(10, timeout_s),
            "banner_timeout": 10,
            "auth_timeout": 10,
            "allow_agent": False,
            "look_for_keys": False,
        }
        if key_path and os.path.exists(key_path):
            connect_kwargs["key_filename"] = key_path
        elif password:
            connect_kwargs["password"] = password
        else:
            connect_kwargs["look_for_keys"] = True

        try:
            client.connect(**connect_kwargs)
            stdin, stdout, stderr = client.exec_command(remote_cmd, timeout=timeout_s)
            stdin.close()
            out_bytes = stdout.read()
            err_bytes = stderr.read()
            out_text = out_bytes.decode("utf-8", "replace")
            err_text = err_bytes.decode("utf-8", "replace")
            combined = out_text if out_text.strip() else (out_text + "\n" + err_text).strip()
            return combined
        finally:
            try:
                client.close()
            except Exception:
                pass
    except ImportError:
        pass
    except Exception as e:
        paramiko_err = e
    else:
        paramiko_err = None

    # 2. Fallback to system ssh / sshpass
    ssh_bin = shutil.which("ssh")
    if not ssh_bin:
        if paramiko_err:
            raise ConnectionError(f"SSH connection failed: {paramiko_err}")
        raise ConnectionError("Neither paramiko nor ssh binary is available in this environment")

    ssh_args = [
        ssh_bin,
        "-p",
        str(port),
        "-o",
        "StrictHostKeyChecking=no",
        "-o",
        "UserKnownHostsFile=/dev/null",
        "-o",
        f"ConnectTimeout={min(8, timeout_s)}",
    ]
    if key_path and os.path.exists(key_path):
        ssh_args.extend(["-i", key_path, "-o", "BatchMode=yes"])
    elif password and shutil.which("sshpass"):
        ssh_args = [shutil.which("sshpass") or "sshpass", "-p", password] + ssh_args
    else:
        ssh_args.extend(["-o", "BatchMode=yes"])

    ssh_args.extend([f"{user}@{host}", remote_cmd])
    proc = subprocess.run(ssh_args, capture_output=True, text=True, timeout=timeout_s + 5)
    if proc.returncode != 0 and not proc.stdout.strip():
        err_msg = proc.stderr.strip() or f"SSH exited with code {proc.returncode}"
        if paramiko_err:
            err_msg = f"{paramiko_err} / {err_msg}"
        raise ConnectionError(err_msg)
    return proc.stdout if proc.stdout.strip() else (proc.stdout + "\n" + proc.stderr).strip()


# ---- Main Execution Engine --------------------------------------------------------------------------------------
def run_inspect(
    host: str,
    api_key: str,
    command: str,
    *,
    router_id: str = "",
    kinds=None,
    ssh_user: str = "",
    ssh_password: str = "",
    ssh_key: str = "",
    ssh_port: int = 22,
    verify: bool = False,
    clock=time.monotonic,
) -> dict:
    """Validate and run one read-only VyOS inspection or probe command."""
    t0 = clock()
    try:
        parsed = P.parse_command(command, kinds=kinds)
    except P.VyosCliError as e:
        return {
            "ok": False,
            "success": False,
            "device": router_id or host,
            "command": str(command or ""),
            "error": {"code": e.code, "message": e.message, "hint": e.hint},
            "duration_s": round(clock() - t0, 2),
        }

    known_secrets = tuple(s for s in (api_key, ssh_password) if s)
    base: dict = {
        "ok": True,
        "success": True,
        "device": router_id or host,
        "host": host,
        "command": parsed.command,
        "kind": parsed.kind,
        "category": parsed.category,
    }
    if parsed.send != parsed.command:
        base["sent_as"] = parsed.send
    if not parsed.verified:
        base["spelling_unverified"] = True

    raw = ""
    transport_used = "https"
    extra_fields: dict = {}

    try:
        # CASE 1: `show interfaces statistics` -> kernel `/bin/ip -s link show` + `show interfaces`
        if parsed.post == "statistics":
            show_if_raw = ""
            stats_raw = ""
            try:
                show_if_raw = vyos_https_show(host, api_key, ["interfaces"], timeout_s=parsed.timeout_s, verify=verify)
            except Exception:
                pass
            try:
                stats_raw = vyos_ssh_exec(
                    host,
                    "/bin/ip -s link show",
                    ssh_user=ssh_user,
                    ssh_password=ssh_password,
                    ssh_key=ssh_key,
                    ssh_port=ssh_port,
                    timeout_s=parsed.timeout_s,
                    is_vyos_op=False,
                )
                transport_used = "ssh+https" if show_if_raw else "ssh"
                raw = stats_raw
            except Exception:
                # Fallback to HTTPS /show ["interfaces", "counters"] or ["interfaces"]
                transport_used = "https"
                try:
                    counters_raw = vyos_https_show(
                        host, api_key, ["interfaces", "counters"], timeout_s=parsed.timeout_s, verify=verify
                    )
                except Exception:
                    counters_raw = ""
                raw = "\n\n".join(p for p in (show_if_raw, counters_raw) if p.strip())
                if not raw.strip():
                    raise RuntimeError("Could not read interface statistics via SSH or HTTPS /show")

            show_parsed = parse_show_interfaces(show_if_raw) if show_if_raw else {}
            stats_parsed = parse_ip_link_stats(stats_raw) if stats_raw else {}
            if show_parsed or stats_parsed:
                extra_fields["interfaces"] = merge_interfaces(show_parsed, stats_parsed)

        # CASE 2: `show interfaces ethernet <eth> queue` -> qdisc / netem inspection
        elif parsed.post == "queue":
            iface = parsed.arg
            queue_chunks: list[str] = []
            # 2a. Try SSH `tc -s qdisc show dev <eth>` first if reachable (gives exact kernel netem + drop counters)
            try:
                tc_out = vyos_ssh_exec(
                    host,
                    f"/sbin/tc -s qdisc show dev {iface}",
                    ssh_user=ssh_user,
                    ssh_password=ssh_password,
                    ssh_key=ssh_key,
                    ssh_port=ssh_port,
                    timeout_s=parsed.timeout_s,
                    is_vyos_op=False,
                )
                if tc_out.strip() and not P.device_rejection(tc_out):
                    queue_chunks.append(f"=== Kernel tc qdisc statistics ({iface}) ===\n{tc_out.strip()}")
                    transport_used = "ssh"
            except Exception:
                pass

            # 2b. Try VyOS HTTPS `/show` `["interfaces", "ethernet", iface, "queue"]` or `["qos", "interface", iface]`
            for path_candidate in (
                ["interfaces", "ethernet", iface, "queue"],
                ["qos", "interface", iface],
                ["traffic-policy"],
            ):
                try:
                    out_cand = vyos_https_show(host, api_key, path_candidate, timeout_s=parsed.timeout_s, verify=verify)
                    if out_cand.strip() and not P.device_rejection(out_cand):
                        queue_chunks.append(f"=== VyOS {' '.join(['show'] + path_candidate)} ===\n{out_cand.strip()}")
                        break
                except Exception:
                    continue

            # 2c. Also check configured network-emulator policy & interface counters via HTTPS `/retrieve` + `/show`
            try:
                cfg = vyos_https_retrieve_config(host, api_key, timeout_s=parsed.timeout_s, verify=verify)
                eth_cfg = cfg.get("interfaces", {}).get("ethernet", {}).get(iface, {})
                attached_pol = None
                ne_pol_data = None
                if "traffic-policy" in cfg:
                    attached_pol = eth_cfg.get("traffic-policy", {}).get("out")
                    if attached_pol:
                        ne_pol_data = cfg.get("traffic-policy", {}).get("network-emulator", {}).get(attached_pol)
                else:
                    egress = cfg.get("qos", {}).get("interface", {}).get(iface, {}).get("egress")
                    if isinstance(egress, dict):
                        attached_pol = next(iter(egress), None)
                    elif isinstance(egress, str):
                        attached_pol = egress
                    if attached_pol:
                        ne_pol_data = cfg.get("qos", {}).get("policy", {}).get("network-emulator", {}).get(attached_pol)

                if attached_pol or ne_pol_data:
                    pol_summary = f"=== Active Netem Policy on {iface}: {attached_pol} ===\n{json.dumps(ne_pol_data or {}, indent=2)}"
                    queue_chunks.append(pol_summary)
                    extra_fields["configured_netem"] = {"policy": attached_pol, "parameters": ne_pol_data}
                else:
                    queue_chunks.append(f"=== Configured Netem Policy on {iface}: none (clean) ===")
                    extra_fields["configured_netem"] = None
            except Exception:
                pass

            # 2d. Include `show interfaces ethernet <eth>` counters if queue_chunks has no tc output
            try:
                eth_out = vyos_https_show(
                    host, api_key, ["interfaces", "ethernet", iface], timeout_s=parsed.timeout_s, verify=verify
                )
                if eth_out.strip() and not P.device_rejection(eth_out):
                    queue_chunks.append(f"=== Interface {iface} Counters ===\n{eth_out.strip()}")
            except Exception:
                pass

            raw = "\n\n".join(queue_chunks) if queue_chunks else f"No queue output returned for {iface}."
            extra_fields["queue_stats"] = parse_netem_queue_output(raw)

        # CASE 3: `show configuration commands [section <section>]`
        elif parsed.kind == P.KIND_CONFIG:
            try:
                raw = vyos_https_show(
                    host, api_key, ["configuration", "commands"], timeout_s=parsed.timeout_s, verify=verify
                )
                if not raw.strip() or P.device_rejection(raw):
                    raise RuntimeError("Empty or rejected configuration commands from /show")
            except Exception:
                cfg = vyos_https_retrieve_config(host, api_key, timeout_s=parsed.timeout_s, verify=verify)
                raw = "\n".join(config_dict_to_set_commands(cfg))

        # CASE 4: Standard `show ...` commands
        elif parsed.kind == P.KIND_SHOW:
            path_tokens = parsed.send.split()[1:] if parsed.send.startswith("show ") else parsed.send.split()
            try:
                raw = vyos_https_show(host, api_key, path_tokens, timeout_s=parsed.timeout_s, verify=verify)
                if P.device_rejection(raw):
                    # Try SSH fallback if HTTPS /show didn't recognize the form
                    try:
                        ssh_raw = vyos_ssh_exec(
                            host,
                            parsed.send,
                            ssh_user=ssh_user,
                            ssh_password=ssh_password,
                            ssh_key=ssh_key,
                            ssh_port=ssh_port,
                            timeout_s=parsed.timeout_s,
                            is_vyos_op=True,
                        )
                        if ssh_raw.strip() and not P.device_rejection(ssh_raw):
                            raw = ssh_raw
                            transport_used = "ssh"
                    except Exception:
                        pass
            except Exception as https_err:
                # Fallback to SSH if HTTPS /show failed
                try:
                    raw = vyos_ssh_exec(
                        host,
                        parsed.send,
                        ssh_user=ssh_user,
                        ssh_password=ssh_password,
                        ssh_key=ssh_key,
                        ssh_port=ssh_port,
                        timeout_s=parsed.timeout_s,
                        is_vyos_op=True,
                    )
                    transport_used = "ssh"
                except Exception:
                    raise https_err

            if parsed.command == "show interfaces":
                extra_fields["interfaces_parsed"] = parse_show_interfaces(raw)

        # CASE 5: Active Probes (`ping` and `traceroute`)
        elif parsed.kind == P.KIND_PROBE:
            tokens = parsed.command.split()
            dst = parsed.arg
            src = tokens[-1] if "source-address" in tokens else ""
            if tokens[0] == "ping":
                count = tokens[3]
                linux_ping_cmd = f"/bin/ping -n -c {count} -W 2" + (f" -I {src}" if src else "") + f" {dst}"
                try:
                    raw = vyos_ssh_exec(
                        host,
                        linux_ping_cmd,
                        ssh_user=ssh_user,
                        ssh_password=ssh_password,
                        ssh_key=ssh_key,
                        ssh_port=ssh_port,
                        timeout_s=parsed.timeout_s,
                        is_vyos_op=False,
                    )
                    transport_used = "ssh"
                except Exception as ssh_err:
                    return {
                        **base,
                        "ok": False,
                        "success": False,
                        "error": {
                            "code": "ssh_required_for_ping",
                            "message": f"Ping from VyOS router requires SSH access to {host}: {redact_text(str(ssh_err), known_secrets)[:180]}",
                            "hint": "Ensure SSH service is enabled on the VyOS router (`set service ssh`) and credentials match (default user `vyos`, or configure SSH credentials in router settings / VYOS_SSH_USER & VYOS_SSH_PASSWORD).",
                        },
                        "duration_s": round(clock() - t0, 2),
                    }
                extra_fields["ping_summary"] = parse_ping_output(raw)
            else:
                # traceroute: try SSH first (supports source-address and fast -n -q 1 -w 1 -m 12), fallback to HTTPS /traceroute
                try:
                    raw = vyos_ssh_exec(
                        host,
                        parsed.send,
                        ssh_user=ssh_user,
                        ssh_password=ssh_password,
                        ssh_key=ssh_key,
                        ssh_port=ssh_port,
                        timeout_s=parsed.timeout_s,
                        is_vyos_op=False,
                    )
                    transport_used = "ssh"
                except Exception as ssh_err:
                    if src:
                        # Still try HTTPS traceroute with a note that source-address is only honored over SSH
                        try:
                            raw = vyos_https_traceroute(host, api_key, dst, timeout_s=parsed.timeout_s, verify=verify)
                            transport_used = "https"
                            extra_fields["probe_note"] = (
                                f"Executed via VyOS HTTPS /traceroute (SSH unavailable for source-address {src})."
                            )
                        except Exception:
                            raise ssh_err
                    else:
                        raw = vyos_https_traceroute(host, api_key, dst, timeout_s=parsed.timeout_s, verify=verify)
                        transport_used = "https"

                tr_data = TR.traceroute_fields(raw, destination_ips=(dst,))
                if tr_data:
                    extra_fields["traceroute"] = tr_data

        # CASE 6: Bounded Text Packet Capture (`capture <ifname> count <1-50> <filter>`)
        elif parsed.kind == P.KIND_CAPTURE:
            try:
                raw = vyos_ssh_exec(
                    host,
                    parsed.send,
                    ssh_user=ssh_user,
                    ssh_password=ssh_password,
                    ssh_key=ssh_key,
                    ssh_port=ssh_port,
                    timeout_s=P.CAPTURE_SECONDS + 5,
                    is_vyos_op=False,
                )
                transport_used = "ssh"
            except Exception as ssh_err:
                return {
                    **base,
                    "ok": False,
                    "success": False,
                    "error": {
                        "code": "ssh_required_for_capture",
                        "message": f"Bounded packet capture on VyOS requires SSH access to {host}: {redact_text(str(ssh_err), known_secrets)[:180]}",
                        "hint": "Ensure SSH service is enabled on the VyOS router (`set service ssh`) and credentials match (default user `vyos`, or configure SSH credentials in router settings).",
                    },
                    "duration_s": round(clock() - t0, 2),
                }

    except Exception as e:
        err_str = redact_text(f"{type(e).__name__}: {e}", known_secrets)[:240]
        code = "timeout" if "timeout" in err_str.lower() or "timed out" in err_str.lower() else "router_unreachable"
        return {
            **base,
            "ok": False,
            "success": False,
            "error": {"code": code, "message": err_str},
            "duration_s": round(clock() - t0, 2),
        }

    shaped = shape_output(parsed, raw, known_secrets=known_secrets)
    rejected = P.device_rejection(raw) if parsed.kind != P.KIND_CAPTURE else ""
    res = {
        **base,
        "transport": transport_used,
        **shaped,
        **extra_fields,
        "duration_s": round(clock() - t0, 2),
    }
    if rejected:
        res.update({
            "ok": False,
            "success": False,
            "rejected": redact_text(rejected, known_secrets),
            "error": {
                "code": "command_rejected",
                "message": "The router did not accept this form.",
                "hint": P.REJECT_HINT,
            },
        })
    if parsed.kind == P.KIND_CAPTURE and not shaped["output"].strip():
        res["note"] = "No packets matched the filter within the capture window."
    return res


def main():
    parser = argparse.ArgumentParser(description="Stigix VyOS Read-Only Live Inspector")
    parser.add_argument("--host", help="VyOS router IP or hostname")
    parser.add_argument("--key", help="VyOS HTTPS API key")
    parser.add_argument("--router-id", default="", help="Router ID label")
    parser.add_argument("--ssh-user", default="", help="Optional SSH username (default: vyos)")
    parser.add_argument("--ssh-password", default="", help="Optional SSH password")
    parser.add_argument("--ssh-key", default="", help="Optional SSH private key path")
    parser.add_argument("--ssh-port", type=int, default=22, help="Optional SSH port (default: 22)")
    parser.add_argument("--secure", action="store_true", help="Verify TLS certificates")

    sub = parser.add_subparsers(dest="subcmd", required=True)

    sub.add_parser("rules", help="Output JSON catalog of allowed read-only rules")

    p_show = sub.add_parser("cli-show", help="Execute a read-only show or config command")
    p_show.add_argument("--command", required=True, help="Read-only show command")

    p_probe = sub.add_parser("probe", help="Execute an active probe (ping/traceroute) or bounded capture")
    p_probe.add_argument("--command", required=True, help="Probe or capture command")

    p_inspect = sub.add_parser("inspect", help="Execute any allowed read-only show, config, probe, or capture command")
    p_inspect.add_argument("--command", required=True, help="Allowed VyOS command")

    args = parser.parse_args()

    if args.subcmd == "rules":
        print(json.dumps({
            "ok": True,
            "rules": P.rules_catalog(),
            "show_forms": P.allowed_forms(P.SHOW_KINDS),
            "probe_forms": P.allowed_forms(P.ACTIVE_KINDS),
            "config_sections": list(P.CONFIG_SECTIONS),
            "chains": list(P.CHAINS),
        }, indent=2))
        sys.exit(0)

    if not args.host or not args.key:
        print(json.dumps({"ok": False, "success": False, "error": {"code": "bad_request", "message": "--host and --key are required"}}))
        sys.exit(1)

    kinds = P.SHOW_KINDS if args.subcmd == "cli-show" else (P.ACTIVE_KINDS if args.subcmd == "probe" else None)
    res = run_inspect(
        args.host,
        args.key,
        args.command,
        router_id=args.router_id,
        kinds=kinds,
        ssh_user=args.ssh_user,
        ssh_password=args.ssh_password,
        ssh_key=args.ssh_key,
        ssh_port=args.ssh_port,
        verify=args.secure,
    )
    print(json.dumps(res, indent=2))
    sys.exit(0 if res.get("ok") else 1)


if __name__ == "__main__":
    main()
