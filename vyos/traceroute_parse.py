"""Neutral traceroute / tracepath output parser for Stigix VyOS Live Inspector.

Pure functions, standard library only. Public API:

  parse_traceroute(output)                    -> list[hop]  (full list, capped at MAX_HOPS)
  compact_hops(hops)                          -> list       (trailing non-responding run collapsed)
  path_summary(hops, *, reached=None, destination_ips=())  -> one-line string
  reached_destination(hops, destination_ips)  -> bool
  last_responding_hop(hops)                   -> {"hop", "ip"} | None
  traceroute_fields(output, destination_ips)  -> dict with the per-test result fields
                                                 (hops, last_responding_hop, reached_destination, path_summary)

A hop is {hop:int, ip:str|None, rtt_ms:float|None, annotation:str|None, responded:bool}.
Formats: `traceroute -n -q 1` (" 1  10.0.0.1  1.789 ms", " 2  *", "... !H"), traceroute with names
(" 1  gw (10.0.0.1)  1.2 ms"), and `tracepath -n` (" 1:  10.0.0.1  0.5ms", " 2:  no reply", "... reached").
A collapsed entry is {hop_from, hop_to, responded: False}.
"""
from __future__ import annotations

import ipaddress
import re

MAX_HOPS = 30
_SUMMARY_MAX_PARTS = 8

_IPV4 = r"\d{1,3}(?:\.\d{1,3}){3}"
_TR_LINE = re.compile(r"^\s*(\d{1,3})\s+(\S.*)$")
_TP_LINE = re.compile(r"^\s*(\d{1,3})\??:\s+(\S.*)$")
_ANNOT = re.compile(r"(![A-Z<>0-9]{1,4})")
_RTT_MS = re.compile(r"(\d+(?:\.\d+)?)\s*ms\b")
_RTT_TP = re.compile(r"(\d+(?:\.\d+)?)ms\b")
_UNREACHABLE = frozenset({"!H", "!N", "!S", "!F", "!X", "!U", "!A", "!Z", "!Q", "!T"})


def _valid_ip(text):
    try:
        return str(ipaddress.IPv4Address(text))
    except ValueError:
        return None


def _hop(n, ip, rtt, annotation):
    return {
        "hop": n,
        "ip": ip,
        "rtt_ms": rtt,
        "annotation": annotation,
        "responded": ip is not None or rtt is not None,
    }


def _parse_traceroute_rest(n: int, rest: str):
    ip = None
    m = re.search(rf"\(({_IPV4})\)", rest)
    if m:
        ip = _valid_ip(m.group(1))
    if ip is None:
        m = re.match(rf"({_IPV4})(?:\s|$)", rest)
        if m:
            ip = _valid_ip(m.group(1))
    rtt = None
    m = _RTT_MS.search(rest)
    if m:
        rtt = float(m.group(1))
    a = _ANNOT.search(rest)
    return _hop(n, ip, rtt, a.group(1) if a else None)


def _parse_tracepath_rest(n: int, rest: str):
    if re.search(r"\bno reply\b", rest):
        return _hop(n, None, None, None)
    ip = None
    m = re.match(rf"({_IPV4})(?:\s|$)", rest)
    if m:
        ip = _valid_ip(m.group(1))
    rtt = None
    m = _RTT_TP.search(rest) or _RTT_MS.search(rest)
    if m:
        rtt = float(m.group(1))
    a = _ANNOT.search(rest)
    annotation = a.group(1) if a else ("reached" if re.search(r"\breached\b", rest) else None)
    return _hop(n, ip, rtt, annotation)


def parse_traceroute(output) -> list:
    """Hops of a traceroute / tracepath transcript, in order, one entry per hop number (first line wins),
    capped at MAX_HOPS. Lines that are not hops (headers, "Resume:", continuation lines) are ignored."""
    hops: list = []
    seen: set = set()
    for line in str(output or "").splitlines():
        if "[LOCALHOST]" in line or line.lstrip().startswith(("traceroute to", "Resume:")):
            continue
        m = _TP_LINE.match(line)
        parser = _parse_tracepath_rest
        if not m:
            m = _TR_LINE.match(line)
            parser = _parse_traceroute_rest
        if not m:
            continue
        n = int(m.group(1))
        if n < 1 or n in seen:
            continue
        seen.add(n)
        hops.append(parser(n, m.group(2).strip()))
        if len(hops) >= MAX_HOPS:
            break
    return hops


def compact_hops(hops) -> list:
    """The hops with a trailing run of non-responding hops collapsed into one
    {hop_from, hop_to, responded: False} entry (the rest is kept as is)."""
    hops = list(hops or [])
    cut = len(hops)
    while cut > 0 and not hops[cut - 1].get("responded"):
        cut -= 1
    out = [dict(h) for h in hops[:cut]]
    if cut < len(hops):
        out.append({"hop_from": hops[cut]["hop"], "hop_to": hops[-1]["hop"], "responded": False})
    return out


def last_responding_hop(hops):
    for h in reversed(list(hops or [])):
        if h.get("responded") and h.get("ip"):
            return {"hop": h["hop"], "ip": h["ip"]}
    return None


def reached_destination(hops, destination_ips=()) -> bool:
    """True when the last hop is the destination (its address, or tracepath's "reached") and did not
    answer with an unreachable annotation."""
    hops = list(hops or [])
    if not hops:
        return False
    last = hops[-1]
    if not last.get("responded") or last.get("annotation") in _UNREACHABLE:
        return False
    if last.get("annotation") == "reached":
        return True
    dest_set = {destination_ips} if isinstance(destination_ips, str) else set(destination_ips or ())
    return bool(last.get("ip")) and last["ip"] in dest_set


def _part(h: dict) -> str:
    if "hop_from" in h:
        a, b = h["hop_from"], h["hop_to"]
        return f"{a}..{b} no reply" if a != b else f"{a} no reply"
    text = f"{h['hop']} {h.get('ip') or '*'}"
    if h.get("annotation") and h["annotation"] != "reached":
        text += f" {h['annotation']}"
    return text


def path_summary(hops, *, reached=None, destination_ips=()) -> str:
    """One line: 'reached in 4 hops', or the path up to where it stopped
    ('1 10.89.103.10 -> 2..20 no reply'). `reached` overrides the detection from destination_ips."""
    hops = list(hops or [])
    if not hops:
        return "no hops in the output"
    if reached is None:
        reached = reached_destination(hops, destination_ips)
    if reached:
        n = hops[-1]["hop"]
        return f"reached in {n} hop{'s' if n != 1 else ''}"
    parts = [_part(h) for h in compact_hops(hops)]
    if len(parts) > _SUMMARY_MAX_PARTS:
        parts = parts[:3] + ["..."] + parts[-4:]
    text = " -> ".join(parts)
    last = hops[-1]
    if last.get("annotation") in _UNREACHABLE:
        return f"{text} (unreachable, destination not reached)"
    if last.get("responded"):
        return f"{text} (destination not reached)"
    return text


def traceroute_fields(output, destination_ips=()) -> dict:
    """The per-test result fields: hops (compact), full_hops, last_responding_hop, reached_destination, path_summary.
    Empty dict when the output holds no hop line."""
    hops = parse_traceroute(output)
    if not hops:
        return {}
    reached = reached_destination(hops, destination_ips)
    return {
        "hops": compact_hops(hops),
        "full_hops": hops,
        "last_responding_hop": last_responding_hop(hops),
        "reached_destination": reached,
        "path_summary": path_summary(hops, reached=reached),
    }
