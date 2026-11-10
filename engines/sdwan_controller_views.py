#!/usr/bin/env python3
"""Read-only Prisma SD-WAN Controller Views (Operational, Configuration & Object Digests).

Provides safe, bounded, secret-redacted read-only digests of a Prisma SD-WAN tenant:
- Operational views (`site_status`, `tunnels`, `interfaces`, `bgp`, `events`, `metrics`, `audit`, `software_licences`)
- Configuration views (`inventory`, `site_config`, `policy`, `circuits`)
- Generic object view (`object`) with automatic UUID -> name reference resolution and ordered policy rules.

Can be used both as an imported Python module (e.g. for unit tests) and as a CLI script
invoked by the Stigix Express server (`POST /api/prisma/controller-view`).
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from collections import namedtuple
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from enum import Enum
from typing import Any, Dict, List, Optional, Set, Tuple

try:
    from prisma_sase import API
except ImportError:
    API = None

Resp = namedtuple("Resp", ("status", "body"))

# ---------------------------------------------------------------------------
# Constants, Policy Bounds & Secret Redaction
# ---------------------------------------------------------------------------

MAX_BYTES = 64 * 1024
TEXT_CAP = 2048
TEXT_SHORT = 300
ENVELOPE_RESERVE = 512
CAP_ROWS = 200
CAP_PREFIXES = 50
CAP_SITES = 40
CAP_ELEMENTS = 40
CAP_MACHINES = 40
CAP_OBJECTS = 100
CAP_RULES = 60
NAME_LIST_MAX = 20
DEFAULT_CALLS = 35
DEFAULT_SECONDS = 25.0
BODY_MAX_BYTES = 8 * 1024
SDK_TIMEOUT_S = 10
BUDGET_CODE = "BUDGET_EXHAUSTED"

EVENT_HOURS = (1, 168)
METRIC_HOURS = (1, 24)
EVENT_KINDS = ("all", "alarm", "alert", "event")
EVENT_SEVERITIES = ("all", "critical", "major", "minor", "warning", "info")
METRICS = ("lqm", "bw", "sys")
METRIC_NAMES = {
    "lqm": ("LqmLatency", "LqmPacketLoss", "LqmJitter", "LqmMOS"),
    "bw": ("BandwidthUsage",),
    "sys": ("CPUUsage", "MemoryUsage"),
}
ANYNET_TYPES = ("public-anynet", "private-anynet")
STATE_UP = frozenset({"up", "connected", "established", "active", "online", "true"})
STATE_DOWN = frozenset({"down", "disconnected", "idle", "offline", "failed", "false"})
_CODE_RE = re.compile(r"^[A-Za-z0-9_.]{1,64}$")
_ERROR_CODE_RE = re.compile(r"[A-Za-z0-9_.-]{1,32}")

SECRET_KEYS = frozenset({
    "md5_secret", "bgp_secret", "secret", "shared_secret", "password", "passphrase",
    "auth_phrase", "priv_phrase", "community", "psk", "pre_shared_key",
})
_SECRET_KEY_RE = re.compile(
    r"secret|passwd|password|passphrase|private_?key|psk|md5|auth_key|token|community|"
    r"encrypted|pkcs12|xauth|auth_phrase|priv_phrase|pre_shared|(?:^|_)hash$",
    re.IGNORECASE,
)


def is_secret_key(key: Any) -> bool:
    return isinstance(key, str) and (key.lower() in SECRET_KEYS or bool(_SECRET_KEY_RE.search(key)))


class SdwanViewError(Exception):
    def __init__(self, status: int, code: str, message: str, *, hint: Optional[str] = None, detail: Optional[str] = None):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message
        self.hint = hint
        self.detail = detail

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


# ---------------------------------------------------------------------------
# Read-Only SDK Catalog & Wrapper
# ---------------------------------------------------------------------------

class Kind(str, Enum):
    CONFIG_GET = "config_get"
    OPS_GET = "ops_get"
    QUERY_POST = "query_post"


@dataclass(frozen=True)
class Entry:
    namespace: str
    method: str
    version: str
    kind: Kind
    arity: int


_ROWS = (
    ("get", "appdefs", "v2.6", Kind.CONFIG_GET, 0),
    ("get", "bgpconfigs", "v2.5", Kind.CONFIG_GET, 2),
    ("get", "bgppeers", "v3.0", Kind.CONFIG_GET, 2),
    ("get", "bulkconfigurations_sitetemplates", "v2.0", Kind.CONFIG_GET, 1),
    ("get", "dhcpservers", "v2.3", Kind.CONFIG_GET, 1),
    ("get", "elements", "v3.2", Kind.CONFIG_GET, 0),
    ("get", "elementsecurityzones", "v2.0", Kind.CONFIG_GET, 2),
    ("get", "enterpriseprefixset", "v2.1", Kind.CONFIG_GET, 0),
    ("get", "hubclusters", "v4.0", Kind.CONFIG_GET, 1),
    ("get", "interfaces", "v4.21", Kind.CONFIG_GET, 2),
    ("get", "ipsecprofiles", "v2.2", Kind.CONFIG_GET, 0),
    ("get", "lannetworks", "v3.3", Kind.CONFIG_GET, 1),
    ("get", "machines", "v2.5", Kind.CONFIG_GET, 0),
    ("get", "natpolicypools", "v2.0", Kind.CONFIG_GET, 0),
    ("get", "natpolicyrules", "v2.0", Kind.CONFIG_GET, 1),
    ("get", "natpolicysets", "v2.0", Kind.CONFIG_GET, 0),
    ("get", "natpolicysetstacks", "v2.0", Kind.CONFIG_GET, 0),
    ("get", "natzones", "v2.0", Kind.CONFIG_GET, 0),
    ("get", "networkcontexts", "v2.0", Kind.CONFIG_GET, 0),
    ("get", "networkpolicyglobalprefixes", "v2.1", Kind.CONFIG_GET, 0),
    ("get", "networkpolicyrules", "v2.4", Kind.CONFIG_GET, 1),
    ("get", "networkpolicysets", "v2.0", Kind.CONFIG_GET, 0),
    ("get", "networkpolicysetstacks", "v2.0", Kind.CONFIG_GET, 0),
    ("get", "ngfwsecuritypolicyrules", "v2.3", Kind.CONFIG_GET, 1),
    ("get", "ngfwsecuritypolicysets", "v2.0", Kind.CONFIG_GET, 0),
    ("get", "ngfwsecuritypolicysetstacks", "v2.0", Kind.CONFIG_GET, 0),
    ("get", "perfmgmtpolicysetstacks", "v2.0", Kind.CONFIG_GET, 0),
    ("get", "prefixfilters", "v2.0", Kind.CONFIG_GET, 1),
    ("get", "prioritypolicyrules", "v2.2", Kind.CONFIG_GET, 1),
    ("get", "prioritypolicysets", "v2.0", Kind.CONFIG_GET, 0),
    ("get", "prioritypolicysetstacks", "v2.0", Kind.CONFIG_GET, 0),
    ("get", "probeconfigs", "v2.0", Kind.CONFIG_GET, 0),
    ("get", "probeprofiles", "v2.0", Kind.CONFIG_GET, 0),
    ("get", "routing_prefixlists", "v2.1", Kind.CONFIG_GET, 2),
    ("get", "routing_routemaps", "v2.3", Kind.CONFIG_GET, 2),
    ("get", "securityzones", "v2.1", Kind.CONFIG_GET, 0),
    ("get", "servicebindingmaps", "v2.1", Kind.CONFIG_GET, 0),
    ("get", "serviceendpoints", "v3.1", Kind.CONFIG_GET, 0),
    ("get", "servicelabels", "v2.1", Kind.CONFIG_GET, 0),
    ("get", "sites", "v4.13", Kind.CONFIG_GET, 0),
    ("get", "sitesecurityzones", "v2.0", Kind.CONFIG_GET, 1),
    ("get", "spokeclusters", "v2.0", Kind.CONFIG_GET, 1),
    ("get", "staticroutes", "v2.3", Kind.CONFIG_GET, 2),
    ("get", "tenant_networkpolicylocalprefixes", "v2.0", Kind.CONFIG_GET, 0),
    ("get", "vrfcontextprofiles", "v2.0", Kind.CONFIG_GET, 0),
    ("get", "vrfcontexts", "v2.0", Kind.CONFIG_GET, 0),
    ("get", "waninterfacelabels", "v2.6", Kind.CONFIG_GET, 0),
    ("get", "waninterfaces", "v2.10", Kind.CONFIG_GET, 1),
    ("get", "wannetworks", "v2.1", Kind.CONFIG_GET, 0),
    ("get", "bgppeers_advertisedprefixes", "v2.1", Kind.OPS_GET, 3),
    ("get", "bgppeers_reachableprefixes", "v2.1", Kind.OPS_GET, 3),
    ("get", "bgppeers_status", "v2.3", Kind.OPS_GET, 2),
    ("get", "element_status", "v2.6", Kind.OPS_GET, 1),
    ("get", "element_waninterfaces_state", "v2.1", Kind.OPS_GET, 3),
    ("get", "hubcluster_status", "v4.0", Kind.OPS_GET, 2),
    ("get", "interfaces_status", "v3.9", Kind.OPS_GET, 3),
    ("get", "licenses", "v2.0", Kind.OPS_GET, 0),
    ("get", "machine_state", "v2.1", Kind.OPS_GET, 1),
    ("get", "site_status", "v2.0", Kind.OPS_GET, 1),
    ("get", "software_state", "v2.0", Kind.OPS_GET, 1),
    ("get", "software_status", "v2.1", Kind.OPS_GET, 1),
    ("get", "spokeclusters_status", "v2.0", Kind.OPS_GET, 2),
    ("get", "tenant_anynetlinks", "v4.0", Kind.OPS_GET, 1),
    ("get", "vpnlinks_state", "v2.0", Kind.OPS_GET, 1),
    ("get", "vpnlinks_status", "v2.2", Kind.OPS_GET, 1),
    ("get", "waninterfaces_status", "v2.1", Kind.OPS_GET, 2),
    ("post", "anynetlinks_correlationevents_query", "v2.2", Kind.QUERY_POST, 0),
    ("post", "anynetlinks_query", "v4.0", Kind.QUERY_POST, 0),
    ("post", "auditlog_query", "v2.1", Kind.QUERY_POST, 0),
    ("post", "bgppeers_status_query", "v2.1", Kind.QUERY_POST, 0),
    ("post", "element_correlationevents_query", "v2.1", Kind.QUERY_POST, 0),
    ("post", "events_query", "v3.7", Kind.QUERY_POST, 0),
    ("post", "events_summary", "v2.1", Kind.QUERY_POST, 0),
    ("post", "interfaces_status_query", "v2.0", Kind.QUERY_POST, 0),
    ("post", "machines_query", "v2.5", Kind.QUERY_POST, 0),
    ("post", "monitor_flows", "v3.11", Kind.QUERY_POST, 0),
    ("post", "monitor_lqm_point_metrics", "v2.0", Kind.QUERY_POST, 0),
    ("post", "monitor_metrics", "v2.6", Kind.QUERY_POST, 0),
    ("post", "monitor_sys_metrics", "v2.3", Kind.QUERY_POST, 0),
    ("post", "site_correlationevents_query", "v2.1", Kind.QUERY_POST, 0),
    ("post", "software_state_query", "v2.0", Kind.QUERY_POST, 0),
    ("post", "software_status_query", "v2.1", Kind.QUERY_POST, 0),
    ("post", "status_query", "v2.6", Kind.QUERY_POST, 0),
    ("post", "tenant_waninterfaces_query", "v2.10", Kind.QUERY_POST, 0),
    ("post", "topology", "v3.6", Kind.QUERY_POST, 0),
    ("post", "vpnlinks_query", "v2.0", Kind.QUERY_POST, 0),
)

ENTRIES: Dict[Tuple[str, str], Entry] = {(ns, m): Entry(ns, m, v, k, a) for ns, m, v, k, a in _ROWS}


class Budget:
    def __init__(self, calls: int = DEFAULT_CALLS, seconds: float = DEFAULT_SECONDS, clock=time.monotonic):
        self.max_calls = calls
        self.seconds = seconds
        self._clock = clock
        self.started = clock()
        self.calls = 0
        self.refused = 0

    @property
    def exhausted(self) -> bool:
        return self.calls >= self.max_calls or (self._clock() - self.started) >= self.seconds

    def spend(self) -> bool:
        if self.exhausted:
            self.refused += 1
            return False
        self.calls += 1
        return True


def _extract_resp(r: Any) -> Resp:
    if isinstance(r, Resp):
        return r
    status = int(getattr(r, "status_code", 0) or (200 if getattr(r, "cgx_status", False) else 0))
    body = None
    if hasattr(r, "cgx_content") and isinstance(r.cgx_content, (dict, list)):
        body = r.cgx_content
    elif hasattr(r, "json") and callable(r.json):
        try:
            body = r.json()
        except Exception:
            body = None
    elif isinstance(r, dict):
        body = r
        status = status or 200
    return Resp(status, body)


class _Namespace:
    __slots__ = ("_ro", "_ns", "_raw")

    def __init__(self, ro: "ReadOnlySdk", ns: str, raw: Any):
        object.__setattr__(self, "_ro", ro)
        object.__setattr__(self, "_ns", ns)
        object.__setattr__(self, "_raw", raw)

    def __getattribute__(self, name: str):
        if name.startswith("_"):
            raise AttributeError(f"{name} is not available")
        ns = object.__getattribute__(self, "_ns")
        e = ENTRIES.get((ns, name))
        if e is None:
            raise AttributeError(f"{ns}.{name} is not in the read-only catalog")
        raw = object.__getattribute__(self, "_raw")
        fn = getattr(raw, name, None)
        if fn is None:
            raise AttributeError(f"{ns}.{name} is not available in this SDK")
        ro = object.__getattribute__(self, "_ro")

        def call(*args):
            return object.__getattribute__(ro, "_call")(fn, e, args)

        call.__name__ = name
        return call


class ReadOnlySdk:
    """Read-only wrapper around prisma_sase.API with call/time budget and method whitelist."""

    __slots__ = ("get", "post", "_budget", "_sdk")

    def __init__(self, sdk: Any, budget: Optional[Budget] = None):
        object.__setattr__(self, "_sdk", sdk)
        object.__setattr__(self, "_budget", budget or Budget())
        object.__setattr__(self, "get", _Namespace(self, "get", sdk.get))
        object.__setattr__(self, "post", _Namespace(self, "post", sdk.post))

    @property
    def budget(self) -> Budget:
        return object.__getattribute__(self, "_budget")

    def _call(self, fn: Any, e: Entry, args: tuple) -> Resp:
        budget: Budget = object.__getattribute__(self, "_budget")
        if e.namespace == "post":
            if len(args) != e.arity + 1 or not isinstance(args[-1], dict):
                raise TypeError(f"{e.method}: expected {e.arity} id(s) and a body dict")
            if len(json.dumps(args[-1], default=str)) > BODY_MAX_BYTES:
                raise ValueError(f"{e.method}: request body exceeds {BODY_MAX_BYTES} bytes")
        elif len(args) not in (e.arity, e.arity + 1):
            raise TypeError(f"{e.method}: expected {e.arity} id(s)")
        if not budget.spend():
            return Resp(0, {"_error": [{"code": BUDGET_CODE}]})
        try:
            try:
                raw_resp = fn(*args, api_version=e.version)
            except TypeError:
                # Support fake/mock SDKs in unit tests that do not accept api_version kwarg
                raw_resp = fn(*args)
            return _extract_resp(raw_resp)
        except Exception as exc:
            return Resp(0, {"_error": [{"code": f"READ_FAILED_{type(exc).__name__}"}]})


# ---------------------------------------------------------------------------
# Shape, Projection, Reader & Site Name Resolution Helpers
# ---------------------------------------------------------------------------

def pick(row: Any, *names: str, default: Any = None) -> Any:
    if not isinstance(row, dict):
        return default
    for n in names:
        if "." in n:
            cur: Any = row
            for part in n.split("."):
                cur = cur.get(part) if isinstance(cur, dict) else None
            if cur is not None:
                return cur
        elif row.get(n) is not None:
            return row[n]
    return default


def project(row: Any, fields: tuple) -> Dict[str, Any]:
    out: Dict[str, Any] = {}
    for f in fields:
        if isinstance(f, tuple):
            name, *aliases = f
            v = pick(row, *aliases)
            if v is not None:
                out[name] = v
            continue
        v = pick(row, f)
        if v is None:
            continue
        if "." in f:
            cur = out
            parts = f.split(".")
            for p in parts[:-1]:
                cur = cur.setdefault(p, {})
            cur[parts[-1]] = v
        else:
            out[f] = v
    return out


def cut(value: Any, n: int = TEXT_SHORT) -> Optional[str]:
    if value is None:
        return None
    s = value if isinstance(value, str) else json.dumps(value, default=str)
    return s if len(s) <= n else s[:n] + "…"


def _drop_secret_keys(obj: Any) -> Any:
    if isinstance(obj, dict):
        return {k: _drop_secret_keys(v) for k, v in obj.items() if not is_secret_key(k)}
    if isinstance(obj, list):
        return [_drop_secret_keys(v) for v in obj]
    return obj


def _cut_leaves(obj: Any, cap: int = TEXT_CAP) -> Any:
    if isinstance(obj, dict):
        return {k: _cut_leaves(v, cap) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_cut_leaves(v, cap) for v in obj]
    if isinstance(obj, str) and len(obj) > cap:
        return obj[:cap] + "…"
    return obj


def _size(obj: Any) -> int:
    return len(json.dumps(obj, default=str))


def safe(obj: Any) -> Any:
    plain = json.loads(json.dumps(obj, default=str))
    return _cut_leaves(_drop_secret_keys(plain))


def fit_rows(rows: list, *, cap_rows: int, base: dict) -> Tuple[list, Dict[str, Any]]:
    kept, used = [], _size(base) + ENVELOPE_RESERVE
    for r in rows[:cap_rows]:
        sz = _size(r) + 2
        if used + sz > MAX_BYTES:
            break
        kept.append(r)
        used += sz
    dropped = len(rows) - len(kept)
    return kept, {"truncated": dropped > 0, "dropped": dropped}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def envelope(data: Any, *, partial: Optional[Dict[str, Any]] = None, notes: Optional[List[str]] = None, **extra: Any) -> Dict[str, Any]:
    out: Dict[str, Any] = {"success": True, "data": data, "read_at": now_iso(), **extra}
    if partial:
        out["partial"] = partial
    if notes:
        out["notes"] = list(notes)
    return out


def rows_of(resp: Optional[Resp]) -> List[Dict[str, Any]]:
    if resp is None:
        return []
    body = resp.body
    if isinstance(body, list):
        return [r for r in body if isinstance(r, dict)]
    if isinstance(body, dict):
        items = body.get("items")
        if isinstance(items, list):
            return [r for r in items if isinstance(r, dict)]
    return []


def status_error(resp: Resp) -> Optional[SdwanViewError]:
    s = resp.status
    if isinstance(s, int) and 200 <= s < 300 and not (isinstance(resp.body, dict) and resp.body.get("_error")):
        return None
    code = "-"
    errors = resp.body.get("_error") if isinstance(resp.body, dict) else None
    if isinstance(errors, list) and errors and isinstance(errors[0], dict):
        c = errors[0].get("code")
        code = c if isinstance(c, str) and _ERROR_CODE_RE.fullmatch(c) else "-"
    detail = f"status={s} code={code}"
    if code == BUDGET_CODE:
        return SdwanViewError(200, "partial", "The read budget of this call is used up.", detail=detail)
    if s in (401, 403):
        return SdwanViewError(
            403,
            "sdwan_denied",
            "The SD-WAN controller refused this read for the service account.",
            hint="Verify the service account has SD-WAN read permissions.",
            detail=detail,
        )
    if s == 404:
        return SdwanViewError(404, "not_found", "The SD-WAN controller has no such object.", detail=detail)
    if s == 429:
        return SdwanViewError(429, "rate_limited", "The SD-WAN controller is rate limiting this tenant.", detail=detail)
    return SdwanViewError(502, "unavailable", "The SD-WAN controller could not be read.", detail=detail)


def failure_reason(resp: Resp) -> str:
    code = "-"
    errors = resp.body.get("_error") if isinstance(resp.body, dict) else None
    if isinstance(errors, list) and errors and isinstance(errors[0], dict):
        c = errors[0].get("code")
        code = c if isinstance(c, str) and _ERROR_CODE_RE.fullmatch(c) else "-"
    return f"status={resp.status} code={code}"


class Reader:
    FATAL = ("sdwan_denied", "rate_limited")

    def __init__(self, sdk: Any):
        self.sdk = sdk if isinstance(sdk, ReadOnlySdk) else ReadOnlySdk(sdk)
        self.not_read: List[str] = []
        self.reasons: Dict[str, str] = {}

    @property
    def exhausted(self) -> bool:
        return self.sdk.budget.exhausted

    def resp(self, ns: str, method: str, *args: Any, label: Optional[str] = None) -> Optional[Resp]:
        r = getattr(getattr(self.sdk, ns), method)(*args)
        err = status_error(r)
        if err is None:
            return r
        if err.code in self.FATAL:
            raise err
        lbl = label or method
        self.not_read.append(lbl)
        self.reasons.setdefault(lbl, failure_reason(r))
        return None

    def rows(self, ns: str, method: str, *args: Any, label: Optional[str] = None) -> List[Dict[str, Any]]:
        r = self.resp(ns, method, *args, label=label)
        return rows_of(r)

    def body(self, ns: str, method: str, *args: Any, label: Optional[str] = None) -> Any:
        r = self.resp(ns, method, *args, label=label)
        return r.body if r is not None else None

    @property
    def partial(self) -> Optional[Dict[str, Any]]:
        if not self.not_read and not self.sdk.budget.refused:
            return None
        out: Dict[str, Any] = {"not_read": sorted(set(self.not_read))}
        if self.reasons:
            out["reasons"] = dict(sorted(self.reasons.items())[:8])
        if self.sdk.budget.refused or self.sdk.budget.exhausted:
            out["budget_exhausted"] = True
        return out


def names_by_id(rows: List[Dict[str, Any]]) -> Dict[str, str]:
    return {
        str(r["id"]): (r.get("name") or r.get("label") or r.get("display_name") or r.get("template_name") or str(r["id"]))
        for r in rows
        if isinstance(r, dict) and r.get("id") is not None
    }


def ref_name(m: Dict[str, str], ref_id: Any) -> Optional[str]:
    if ref_id is None:
        return None
    return m.get(str(ref_id))


def ref_names(m: Dict[str, str], ids: Any) -> List[str]:
    return [n for n in (m.get(str(i)) for i in (ids or [])) if n]


def check_choice(value: Any, allowed: tuple, what: str, default: Any = None) -> Any:
    if value in (None, ""):
        return default
    v = str(value).strip().lower()
    for a in allowed:
        if a.lower() == v:
            return a
    raise SdwanViewError(400, "bad_request", f"{what} must be one of: {', '.join(sorted(allowed))}")


def check_int(value: Any, lo: int, hi: int, what: str, default: Optional[int] = None) -> int:
    if value in (None, ""):
        if default is None:
            raise SdwanViewError(400, "bad_request", f"{what} is required")
        return default
    try:
        if isinstance(value, bool):
            raise ValueError()
        n = int(str(value).strip())
    except ValueError:
        raise SdwanViewError(400, "bad_request", f"{what} must be an integer from {lo} to {hi}")
    if not lo <= n <= hi:
        raise SdwanViewError(400, "bad_request", f"{what} must be an integer from {lo} to {hi}")
    return n


def check_name(value: Any, what: str = "name", max_len: int = 80) -> str:
    s = str(value or "").strip()
    if not s or len(s) > max_len or any(c in s for c in "\n\r\x00"):
        raise SdwanViewError(400, "bad_request", f"{what} is required (at most {max_len} characters)")
    return s


def _normalize_site_token(name: str) -> str:
    """Normalize 'BR1' / 'Branch-01' / 'DC-01' / 'DC1' to a canonical form for flexible site matching."""
    s = str(name or "").strip().lower()
    m_br = re.match(r"^(?:br|branch)[-_]?0*(\d+)$", s)
    if m_br:
        return f"br{m_br.group(1)}"
    m_dc = re.match(r"^(?:dc|datacenter)[-_]?0*(\d+)$", s)
    if m_dc:
        return f"dc{m_dc.group(1)}"
    return re.sub(r"[-_\s]+", "", s)


def resolve_site(sites: List[Dict[str, Any]], query: str) -> Dict[str, Any]:
    """Find a site by exact name (case-insensitive) first, then canonical token ('BR1' <-> 'Branch-01'), then ID."""
    want = query.strip().lower()
    for s in sites:
        if str(s.get("name", "")).lower() == want or str(s.get("id", "")).lower() == want:
            return s
    want_norm = _normalize_site_token(want)
    for s in sites:
        if want_norm and _normalize_site_token(str(s.get("name", ""))) == want_norm:
            return s
    for s in sites:
        sname = str(s.get("name", "")).lower()
        if want in sname or (sname and sname in want):
            return s
    available = sorted(str(s.get("name")) for s in sites if s.get("name"))[:NAME_LIST_MAX]
    raise SdwanViewError(
        404,
        "not_found",
        f"No site matching {query[:60]!r} in this Prisma SD-WAN tenant.",
        hint="Available sites: " + (", ".join(available) or "none"),
    )


# ---------------------------------------------------------------------------
# Generic Object View (from object_view.py)
# ---------------------------------------------------------------------------

INTERNAL_KEYS = frozenset({
    "id", "tenant_id", "region", "etag", "site_id", "element_id",
    "policy_set_id", "policyset_id", "security_policyset_id",
})

RESOLVERS: Dict[str, Tuple[str, str]] = {
    "probe_profile_id": ("probeprofiles", "probe_profile"),
    "probe_config_ids": ("probeconfigs", "probe_configs"),
    "probe_config_id": ("probeconfigs", "probe_config"),
    "label_id": ("waninterfacelabels", "label"),
    "network_id": ("wannetworks", "network"),
    "network_context_id": ("networkcontexts", "network_context"),
    "vrf_context_id": ("vrfcontexts", "vrf_context"),
    "service_label_id": ("servicelabels", "service_label"),
    "service_endpoint_ids": ("serviceendpoints", "service_endpoints"),
    "ipsec_profile_id": ("ipsecprofiles", "ipsec_profile"),
    "source_zone_ids": ("securityzones", "source_zones"),
    "destination_zone_ids": ("securityzones", "destination_zones"),
}


def needed_lookups(row_or_rows: Any, extra: Optional[Dict[str, Tuple[str, str]]] = None) -> Set[str]:
    table = {**RESOLVERS, **(extra or {})}
    found: Set[str] = set()

    def walk(o: Any) -> None:
        if isinstance(o, dict):
            for k, v in o.items():
                if k in table and v not in (None, "", []):
                    found.add(table[k][0])
                walk(v)
        elif isinstance(o, list):
            for v in o:
                walk(v)

    walk(row_or_rows)
    return found


class ObjectView:
    def __init__(self, names: Dict[str, Dict[str, str]], extra: Optional[Dict[str, Tuple[str, str]]] = None):
        self.names = names
        self.table = {**RESOLVERS, **(extra or {})}
        self.secrets = 0

    def value(self, o: Any) -> Any:
        if isinstance(o, dict):
            out: Dict[str, Any] = {}
            for k, v in o.items():
                if not isinstance(k, str) or k.startswith("_") or k in INTERNAL_KEYS:
                    continue
                if is_secret_key(k):
                    self.secrets += 1
                    continue
                if k.endswith("_id") or k.endswith("_ids"):
                    self._ref(out, k, v)
                    continue
                out[k] = self.value(v)
            return out
        if isinstance(o, list):
            return [self.value(v) for v in o]
        return o

    def _ref(self, out: Dict[str, Any], key: str, v: Any) -> None:
        if v in (None, "", []):
            return
        spec = self.table.get(key)
        lookup = self.names.get(spec[0]) if spec else None
        if spec and lookup is not None:
            if isinstance(v, list):
                resolved = [lookup.get(str(i)) for i in v]
                if all(r is not None for r in resolved):
                    out[spec[1]] = resolved
                    return
            elif lookup.get(str(v)) is not None:
                out[spec[1]] = lookup[str(v)]
                return
        base = key[:-4] if key.endswith("_ids") else key[:-3]
        if isinstance(v, list):
            out[base + "_count"] = len(v)
        else:
            out[base + "_set"] = True


# ---------------------------------------------------------------------------
# Operational Views (from ops_views.py)
# ---------------------------------------------------------------------------

def norm_state(raw: Any) -> str:
    s = str(raw).strip().lower() if raw is not None else ""
    if not s or s == "none":
        return "unknown"
    if s in STATE_UP:
        return "up"
    if s in STATE_DOWN:
        return "down"
    if s in ("init", "initializing", "connect", "opensent", "openconfirm", "active_pending"):
        return "init"
    return "unknown"


def _own_elements(rd: Reader, site: Optional[str] = None) -> Tuple[List[Dict[str, Any]], Dict[str, str], List[Tuple[Dict[str, Any], Optional[str]]]]:
    sites = rd.rows("get", "sites", label="sites")
    names = {str(s["id"]): s.get("name") for s in sites if s.get("id") is not None}
    matched_site_id: Optional[str] = None
    if site:
        matched_site = resolve_site(sites, site)
        matched_site_id = str(matched_site["id"])
    elements = rd.rows("get", "elements", label="elements")
    out: List[Tuple[Dict[str, Any], Optional[str]]] = []
    for el in sorted(elements, key=lambda e: str(e.get("name"))):
        sid = str(el.get("site_id"))
        sname = names.get(sid)
        if matched_site_id and sid != matched_site_id:
            continue
        out.append((el, sname))
    return sites, names, out


def view_site_status(sdk: Any, args: Dict[str, Any]) -> Dict[str, Any]:
    site_arg = check_name(args.get("site"), "site") if args.get("site") not in (None, "") else None
    rd = Reader(sdk)
    sites, _names, own = _own_elements(rd, site_arg)
    matched_site_id = str(resolve_site(sites, site_arg)["id"]) if site_arg else None
    rows = []
    by_site: Dict[str, Dict[str, Any]] = {}
    for s in sites:
        sid = str(s.get("id"))
        if matched_site_id and sid != matched_site_id:
            continue
        by_site[sid] = {
            "site": s.get("name"),
            "site_id": sid,
            "mode": pick(s, "admin_state"),
            "role": pick(s, "element_cluster_role"),
            "elements": [],
        }
    for el, _sname in own:
        sid = str(el.get("site_id"))
        row: Dict[str, Any] = {
            "name": el.get("name"),
            "element_id": str(el.get("id")) if el.get("id") else None,
            "connected": el.get("connected"),
            "state": pick(el, "state"),
            "version": pick(el, "software_version"),
            "model": pick(el, "model_name"),
        }
        if rd.exhausted:
            rd.not_read.append(f"element_status:{el.get('name')}")
        else:
            st = rd.body("get", "element_status", str(el["id"]), label=f"element_status:{el.get('name')}")
            if isinstance(st, dict):
                conn = pick(st, "connected", "is_connected", "controller_connected")
                if conn is not None:
                    row["connected"] = conn
                row["state_raw"] = pick(st, "state", "operational_state", "status")
                row["uptime"] = pick(st, "uptime", "uptime_seconds", "up_time")
                row["cpu_pct"] = pick(st, "cpu_usage", "cpu", "cpu_percent")
                row["memory_pct"] = pick(st, "memory_usage", "memory", "mem_percent")
        if not rd.exhausted:
            sw = rd.body("get", "software_state", str(el["id"]), label=f"software_state:{el.get('name')}")
            if isinstance(sw, dict):
                row["running_version"] = pick(sw, "version", "running_version", "current_version", "image_version")
        row = {k: v for k, v in row.items() if v is not None}
        if sid in by_site:
            by_site[sid]["elements"].append(row)
        rows.append(row)
    for sid, entry in by_site.items():
        if rd.exhausted:
            rd.not_read.append(f"site_status:{entry['site']}")
            continue
        st = rd.body("get", "site_status", sid, label=f"site_status:{entry['site']}")
        if isinstance(st, dict):
            entry["status_raw"] = pick(st, "state", "status", "operational_state")
            if pick(st, "admin_state"):
                entry["mode"] = st["admin_state"]
    connected = sum(1 for r in rows if r.get("connected") is True)
    data = {
        "sites": sorted(by_site.values(), key=lambda e: str(e["site"])),
        "summary": {
            "vions_connected": connected,
            "vions_seen": len(rows),
            "sites_active": sum(1 for e in by_site.values() if str(e.get("mode")).lower() == "active"),
            "sites": len(by_site),
        },
    }
    return envelope(safe(data), partial=rd.partial)


def _link_row(link: Dict[str, Any]) -> Dict[str, Any]:
    raw = pick(link, "status", "state")
    return {
        "from_site": link.get("source_site_name"),
        "to_site": link.get("target_site_name"),
        "state": norm_state(raw),
        "state_raw": raw,
        "type": link.get("type"),
        "from_circuit": pick(link, "source_wan_network", "source_circuit_name"),
        "to_circuit": pick(link, "target_wan_network", "target_circuit_name"),
    }


def view_tunnels(sdk: Any, args: Dict[str, Any]) -> Dict[str, Any]:
    site_arg = check_name(args.get("site"), "site") if args.get("site") not in (None, "") else None
    rd = Reader(sdk)
    body = rd.body("post", "topology", {"type": "anynet", "nodes": []}, label="topology")
    links = body.get("links") if isinstance(body, dict) else None
    rows = [
        _link_row(l)
        for l in (links if isinstance(links, list) else [])
        if isinstance(l, dict) and l.get("type") in ANYNET_TYPES
    ]
    if site_arg:
        want_norm = _normalize_site_token(site_arg)
        rows = [
            r for r in rows
            if site_arg.lower() in (str(r["from_site"]).lower(), str(r["to_site"]).lower())
            or (want_norm and want_norm in (_normalize_site_token(str(r["from_site"])), _normalize_site_token(str(r["to_site"]))))
        ]
    order = {"down": 0, "init": 1, "unknown": 2, "up": 3}
    rows.sort(key=lambda r: (order[r["state"]], str(r["from_site"]), str(r["to_site"])))
    counts: Dict[str, Any] = {"total": len(rows), "up": 0, "init": 0, "down": 0, "unknown": 0, "by_site": {}, "by_pair": {}}
    for r in rows:
        counts[r["state"]] += 1
        for s in (r["from_site"], r["to_site"]):
            c = counts["by_site"].setdefault(str(s), {"up": 0, "other": 0})
            c["up" if r["state"] == "up" else "other"] += 1
        pair = " <-> ".join(sorted((str(r["from_site"]), str(r["to_site"]))))
        c = counts["by_pair"].setdefault(pair, {"up": 0, "total": 0})
        c["total"] += 1
        c["up"] += int(r["state"] == "up")
    kept, meta = fit_rows(rows, cap_rows=CAP_ROWS, base=counts)
    if links is None and body is not None:
        rd.not_read.append("topology")
    return envelope(safe({"summary": counts, "tunnels": kept}), partial=rd.partial, **meta)


def _rows_of_prefixes(body: Any) -> Optional[List[str]]:
    if not isinstance(body, dict):
        return None
    items = body.get("items")
    if not isinstance(items, list):
        return None
    out = []
    for i in items:
        if isinstance(i, str):
            out.append(i)
        elif isinstance(i, dict):
            v = pick(i, "prefix", "network", "ipv4_prefix", "route")
            if v:
                out.append(str(v))
    return out


def view_bgp(sdk: Any, args: Dict[str, Any]) -> Dict[str, Any]:
    site_arg = check_name(args.get("site"), "site") if args.get("site") not in (None, "") else None
    show_prefixes = str(args.get("prefixes", "")).lower() in ("1", "true", "yes")
    rd = Reader(sdk)
    _sites, _names, own = _own_elements(rd, site_arg)
    peers = []
    for el, sname in own:
        if rd.exhausted:
            rd.not_read.append(f"bgppeers:{el.get('name')}")
            continue
        cfg = rd.rows("get", "bgppeers", str(el["site_id"]), str(el["id"]), label=f"bgppeers:{el.get('name')}")
        if not cfg:
            continue
        status = {
            p.get("id"): p
            for p in rd.rows("get", "bgppeers_status", str(el["site_id"]), str(el["id"]), label=f"bgppeers_status:{el.get('name')}")
        }
        for p in cfg:
            st = status.get(p.get("id")) or {}
            raw = pick(st, "state", "bgp_state")
            row: Dict[str, Any] = {
                "element": el.get("name"),
                "site": sname,
                "name": p.get("name"),
                "peer_ip": p.get("peer_ip"),
                "remote_as": pick(p, "remote_as_num", "remote_as"),
                "state": raw if raw else "unknown",
                "state_raw": raw,
                "uptime": pick(st, "uptime", "up_time"),
                "shutdown": p.get("shutdown"),
            }
            if not rd.exhausted and p.get("id") is not None:
                for key, method in (("received", "bgppeers_reachableprefixes"), ("advertised", "bgppeers_advertisedprefixes")):
                    b = rd.body("get", method, str(el["site_id"]), str(el["id"]), str(p["id"]), label=f"{method}:{p.get('name')}")
                    pf = _rows_of_prefixes(b)
                    if pf is not None:
                        row[f"{key}_count"] = len(pf)
                        if show_prefixes:
                            row[f"{key}_prefixes"] = pf[:CAP_PREFIXES]
            peers.append(row)
    established = sum(1 for p in peers if str(p["state"]).lower() == "established")
    kept, meta = fit_rows(peers, cap_rows=CAP_ROWS, base={})
    return envelope(safe({"summary": {"established": established, "total": len(peers)}, "peers": kept}), partial=rd.partial, **meta)


def view_interfaces(sdk: Any, args: Dict[str, Any]) -> Dict[str, Any]:
    site_arg = check_name(args.get("site"), "site")
    device = args.get("device")
    rd = Reader(sdk)
    sites, _n, own = _own_elements(rd, site_arg)
    matched_site = resolve_site(sites, site_arg)
    if device not in (None, ""):
        want = check_name(device, "device").lower()
        own = [(e, s) for e, s in own if want in str(e.get("name", "")).lower()]
        if not own:
            raise SdwanViewError(404, "not_found", f"Device {str(device)[:60]!r} not found at site {matched_site.get('name')}.")
    rows = []
    for el, _sname in own:
        if rd.exhausted:
            rd.not_read.append(f"interfaces_status:{el.get('name')}")
            continue
        cfg = {
            str(i.get("name")): i
            for i in rd.rows("get", "interfaces", str(el["site_id"]), str(el["id"]), label=f"interfaces:{el.get('name')}")
        }
        resp = None if rd.exhausted else rd.resp(
            "post",
            "interfaces_status_query",
            {"query_params": {"element_id": {"in": [str(el["id"])]}}},
            label=f"interfaces_status:{el.get('name')}",
        )
        status_rows = rows_of(resp) if resp is not None else []
        if status_rows:
            for it in status_rows:
                name = pick(it, "name", "interface_name")
                c_item = cfg.get(str(name)) or {}
                admin_up = c_item.get("admin_up")
                oper = pick(it, "operational_state", "link_state", "state")
                flag = "admin up, oper down" if admin_up is True and norm_state(oper) == "down" else None
                rows.append({
                    "element": el.get("name"),
                    "name": name,
                    "admin_up": admin_up,
                    "oper_state": oper,
                    "extended_state": pick(it, "extended_state"),
                    "ip": pick(it, "ipv4_addresses", "ipv4_address", "ip") or pick(c_item, "ipv4_config.static_config.address"),
                    "used_for": pick(it, "used_for") or c_item.get("used_for"),
                    "mtu": pick(it, "negotiated_mtu") or c_item.get("mtu"),
                    "flag": flag,
                })
        else:
            # Fallback to config interfaces if interfaces_status_query returned empty
            for name, c_item in cfg.items():
                rows.append({
                    "element": el.get("name"),
                    "name": name,
                    "admin_up": c_item.get("admin_up"),
                    "ip": pick(c_item, "ipv4_config.static_config.address"),
                    "used_for": c_item.get("used_for"),
                    "mtu": c_item.get("mtu"),
                })
    rows = [{k: v for k, v in r.items() if v is not None} for r in rows]
    kept, meta = fit_rows(rows, cap_rows=CAP_ROWS, base={})
    return envelope(
        safe({"site": matched_site.get("name"), "interfaces": kept, "flagged": [r for r in kept if r.get("flag")]}),
        partial=rd.partial,
        **meta,
    )


def _window(hours: int, now: Optional[datetime] = None) -> Tuple[str, str]:
    end = now or datetime.now(timezone.utc)
    start = end - timedelta(hours=hours)
    fmt = "%Y-%m-%dT%H:%M:%S.000Z"
    return start.strftime(fmt), end.strftime(fmt)


def view_events(sdk: Any, args: Dict[str, Any]) -> Dict[str, Any]:
    hours = check_int(args.get("hours"), *EVENT_HOURS, "hours", default=24)
    kind = check_choice(args.get("kind"), EVENT_KINDS, "kind", "all")
    severity = check_choice(args.get("severity"), EVENT_SEVERITIES, "severity", "all")
    code = args.get("code")
    if code not in (None, "") and not _CODE_RE.match(str(code)):
        raise SdwanViewError(400, "bad_request", "code must be a valid event code such as NW_BGP_PEER_DOWN")
    site_arg = check_name(args.get("site"), "site") if args.get("site") not in (None, "") else None
    rd = Reader(sdk)
    site_id = None
    sites = rd.rows("get", "sites", label="sites")
    names = {str(s["id"]): s.get("name") for s in sites if s.get("id")}
    if site_arg:
        matched = resolve_site(sites, site_arg)
        site_id = str(matched["id"])
    start, end = _window(hours)
    query: Dict[str, Any] = {}
    if site_id:
        query["site"] = [site_id]
    if kind != "all":
        query["type"] = [kind]
    sev_list = [severity] if severity in ("critical", "major", "minor") else ["critical", "major", "minor"]
    body: Dict[str, Any] = {
        "limit": {"count": CAP_ROWS, "sort_on": "time", "sort_order": "descending"},
        "start_time": start,
        "end_time": end,
        "view": {"summary": False},
        "severity": sev_list,
    }
    if query:
        body["query"] = query
    resp = rd.resp("post", "events_query", body, label="events_query")
    rows, by_code = [], {}
    for e in (rows_of(resp) if resp is not None else []):
        c = pick(e, "code", "event_code")
        if code and str(c or "").lower() != str(code).lower():
            continue
        if severity not in ("all", "critical", "major", "minor") and str(pick(e, "severity") or "").lower() != severity.lower():
            continue
        by_code[str(c)] = by_code.get(str(c), 0) + 1
        rows.append({
            "time": pick(e, "time", "_created_on_utc", "event_time"),
            "site": names.get(str(pick(e, "site_id"))) or pick(e, "site_name"),
            "element": pick(e, "element_name", "element"),
            "code": c,
            "severity": pick(e, "severity"),
            "type": pick(e, "type", "event_type"),
            "acknowledged": pick(e, "acknowledged"),
            "cleared": pick(e, "cleared"),
            "summary": cut(pick(e, "info", "summary", "message", "description"), TEXT_SHORT),
        })
    rows = [{k: v for k, v in r.items() if v is not None} for r in rows]
    kept, meta = fit_rows(rows, cap_rows=CAP_ROWS, base={"by_code": by_code})
    return envelope(
        safe({"hours": hours, "kind": kind, "severity": severity, "events": kept, "total_returned": len(rows), "by_code": by_code}),
        partial=rd.partial,
        **meta,
    )


def _series_summary(points: list) -> Optional[Dict[str, Any]]:
    vals = [float(p) for p in points if isinstance(p, (int, float)) and not isinstance(p, bool)]
    if not vals:
        return None
    return {
        "min": min(vals),
        "avg": round(sum(vals) / len(vals), 3),
        "max": max(vals),
        "last": vals[-1],
        "points": len(vals),
    }


def view_metrics(sdk: Any, args: Dict[str, Any]) -> Dict[str, Any]:
    site_arg = check_name(args.get("site"), "site")
    metric = check_choice(args.get("metric"), METRICS, "metric", "lqm")
    hours = check_int(args.get("hours"), *METRIC_HOURS, "hours", default=1)
    circuit = args.get("circuit")
    rd = Reader(sdk)
    sites = rd.rows("get", "sites", label="sites")
    match = resolve_site(sites, site_arg)
    method = "monitor_sys_metrics" if metric == "sys" else "monitor_metrics"
    start, end = _window(hours)
    body = {
        "start_time": start,
        "end_time": end,
        "interval": "5min",
        "metrics": [{"name": n, "statistics": ["average"], "unit": "ratio"} for n in METRIC_NAMES[metric]],
        "view": {"summary": False, "individual": "direction"},
        "filter": {"site": [str(match["id"])]},
    }
    resp = rd.resp("post", method, body, label=method)
    out = []
    data = resp.body if resp is not None and isinstance(resp.body, dict) else {}
    for m in (data.get("metrics") or []):
        if not isinstance(m, dict):
            continue
        for s in (m.get("series") or []):
            if not isinstance(s, dict):
                continue
            view = s.get("view") if isinstance(s.get("view"), dict) else {}
            label = cut(pick(view, "path", "waninterface", "interface", "direction") or pick(s, "name"), 120)
            if circuit and str(circuit).lower() not in str(label).lower():
                continue
            for d in (s.get("data") or []):
                if not isinstance(d, dict):
                    continue
                pts = [(p.get("value") if isinstance(p, dict) else p) for p in (d.get("datapoints") or [])]
                summ = _series_summary(pts)
                if summ:
                    out.append({"metric": m.get("name"), "path": label, **summ})
    kept, meta = fit_rows(out, cap_rows=CAP_ROWS, base={})
    return envelope(
        safe({"site": match.get("name"), "metric": metric, "hours": hours, "series": kept}),
        partial=rd.partial,
        notes=["Series are summarised (min / avg / max / last); raw points are not returned."],
        **meta,
    )


# ---------------------------------------------------------------------------
# Configuration & Object Views (from config_views.py & object_view.py)
# ---------------------------------------------------------------------------

SITE_FIELDS = (("role", "element_cluster_role"), ("mode", "admin_state"), "address.city", "address.country")
ELEMENT_FIELDS = (
    "name", ("model", "model_name"), ("serial", "serial_number", "sl_no"), "connected", "state",
    "software_version", "role", ("cluster", "cluster_name"), "l3_lan_forwarding",
    "l3_direct_private_wan_forwarding", "device_mode",
)
WANIF_FIELDS = (
    "name", "type", "link_bw_down", "link_bw_up", "bfd_mode", "bw_config_mode", "lqm_enabled",
    "use_for_application_reachability_probes", "use_lqm_for_non_hub_paths", "bwc_enabled",
)
LANNET_FIELDS = ("name", "ipv4_config.prefixes", "scope", "description")
IFACE_FIELDS = (
    "name", "type", "used_for", "admin_up", "mtu", "description", "ipv4_config.type",
    "ipv4_config.static_config.address", "ipv4_config.dhcp_config.dhcp_options", "scope", "parent",
    "bypass_pair", "nat_address", "nat_port", "dhcp_relay.enabled", "power_usage_threshold",
)
ROUTE_FIELDS = ("name", "destination_prefix", "description", "scope", "nexthops", "network_context_id")
BGPCONFIG_FIELDS = (
    ("local_as", "local_as_num", "local_as_number"), "router_id", "graceful_restart", "adv_interval",
    "maxpaths", "hold_time", "keepalive_time", "multi_hop_ttl",
)
BGPPEER_FIELDS = (
    "name", ("remote_as", "remote_as_num"), "peer_ip", "peer_type", "update_source", "scope", "shutdown",
    "multihop", "peer_retry_time", "route_reflector_client", "advertise_default_route", "bgp_config.hold_time",
)


def _stack_names(rd: Reader) -> Dict[str, Dict[str, str]]:
    out: Dict[str, Dict[str, str]] = {}
    for key, method in (
        ("network", "networkpolicysetstacks"),
        ("priority", "prioritypolicysetstacks"),
        ("nat", "natpolicysetstacks"),
        ("security", "ngfwsecuritypolicysetstacks"),
    ):
        if rd.exhausted:
            rd.not_read.append(method)
            continue
        out[key] = names_by_id(rd.rows("get", method, label=method))
    return out


def _stacks_of(site: Dict[str, Any], stacks: Dict[str, Dict[str, str]]) -> Dict[str, Optional[str]]:
    return {
        "network": ref_name(stacks.get("network", {}), site.get("network_policysetstack_id")),
        "priority": ref_name(stacks.get("priority", {}), site.get("priority_policysetstack_id")),
        "nat": ref_name(stacks.get("nat", {}), site.get("nat_policysetstack_id")),
        "security": ref_name(stacks.get("security", {}), site.get("security_policysetstack_id")),
    }


def _l3_summary(el: Dict[str, Any]) -> str:
    vals = [el.get("l3_lan_forwarding"), el.get("l3_direct_private_wan_forwarding")]
    if any(v is False for v in vals):
        return "off"
    return "on" if all(v is True for v in vals) else "unknown"


def _element_row(el: Dict[str, Any], site_names: Dict[str, str]) -> Dict[str, Any]:
    row = project(el, ELEMENT_FIELDS)
    row["site"] = site_names.get(str(el.get("site_id")))
    row["l3_forwarding"] = _l3_summary(el)
    ha = el.get("spoke_ha_config")
    if isinstance(ha, dict) and ha.get("enable"):
        row["ha"] = {"enabled": True, "priority": ha.get("priority")}
    return row


def view_inventory(sdk: Any, args: Dict[str, Any]) -> Dict[str, Any]:
    rd = Reader(sdk)
    sites = rd.rows("get", "sites", label="sites")
    elements = rd.rows("get", "elements", label="elements")
    stacks = _stack_names(rd)
    site_names = names_by_id(sites)
    site_rows = [
        {"name": s.get("name"), "site_id": str(s.get("id")), **project(s, SITE_FIELDS), "stacks": _stacks_of(s, stacks)}
        for s in sorted(sites, key=lambda s: str(s.get("name")))
    ]
    el_rows = [_element_row(e, site_names) for e in sorted(elements, key=lambda e: str(e.get("name")))]
    sites_kept, m1 = fit_rows(site_rows, cap_rows=CAP_SITES, base={})
    els_kept, m2 = fit_rows(el_rows, cap_rows=CAP_ELEMENTS, base={})
    dropped = m1["dropped"] + m2["dropped"]
    return envelope(
        safe({
            "sites": sites_kept,
            "elements": els_kept,
            "summary": {"sites_count": len(sites), "elements_count": len(elements)},
        }),
        partial=rd.partial,
        truncated=dropped > 0,
        dropped=dropped,
    )


def effective_probe(w: Dict[str, Any], cat: Optional[Dict[str, Any]], profile_names: Dict[str, str]) -> Tuple[Optional[str], str]:
    own = w.get("probe_profile_id")
    if own:
        return ref_name(profile_names, own) or "(unresolved profile)", "circuit"
    own_l3 = w.get("l3_reachability") or {}
    if own_l3.get("probe_config_ids") and not own_l3.get("use_element_default"):
        return "(own L3 probes)", "circuit L3 probes"
    if cat:
        label = cat.get("label") or cat.get("name")
        cp = cat.get("probe_profile_id")
        if cp:
            return ref_name(profile_names, cp) or "(unresolved profile)", f"category {label}"
        cl3 = cat.get("l3_reachability") or {}
        if cl3.get("probe_config_ids") and not cl3.get("use_element_default"):
            return "(category L3 probes)", f"category {label} L3 probes"
    return None, "none (circuit and category use the element default)"


def view_site_config(sdk: Any, args: Dict[str, Any]) -> Dict[str, Any]:
    site_arg = args.get("site")
    if site_arg in (None, ""):
        return view_inventory(sdk, args)
    name = check_name(site_arg, "site")
    rd = Reader(sdk)
    sites = rd.rows("get", "sites", label="sites")
    s = resolve_site(sites, name)
    sid = str(s["id"])
    site_names = {sid: s.get("name")}
    stacks = _stack_names(rd)
    out: Dict[str, Any] = {"site": s.get("name"), "site_id": sid, **project(s, SITE_FIELDS), "stacks": _stacks_of(s, stacks)}
    wan_names = {str(k): v for k, v in names_by_id(rd.rows("get", "wannetworks", label="wannetworks")).items()}
    label_rows = rd.rows("get", "waninterfacelabels", label="waninterfacelabels")
    labels = names_by_id(label_rows)
    cat_by_id = {str(x["id"]): x for x in label_rows if x.get("id") is not None}
    probe_profiles = names_by_id(rd.rows("get", "probeprofiles", label="probeprofiles"))
    waninterfaces = rd.rows("get", "waninterfaces", sid, label="waninterfaces")
    out["wan_interfaces"] = []
    for w in waninterfaces:
        cat = cat_by_id.get(str(w.get("label_id")))
        eff_prof, probe_src = effective_probe(w, cat, probe_profiles)
        out["wan_interfaces"].append({
            **project(w, WANIF_FIELDS),
            "network": ref_name(wan_names, w.get("network_id")),
            "label": ref_name(labels, w.get("label_id")),
            "effective_probe_profile": eff_prof,
            "probe_source": probe_src,
        })
    lan = rd.rows("get", "lannetworks", sid, label="lannetworks")
    out["lan_networks"] = [project(n, LANNET_FIELDS) for n in lan]
    out["lan_prefixes"] = None if "lannetworks" in rd.not_read else [
        f"{p} ({n.get('scope') or 'scope unknown'})"
        for n in lan
        for p in ((n.get("ipv4_config") or {}).get("prefixes") or [])
    ]
    wan_by_id = names_by_id(waninterfaces)
    lan_by_id = names_by_id(lan)
    hubs = rd.rows("get", "hubclusters", sid, label="hubclusters")
    spokes = rd.rows("get", "spokeclusters", sid, label="spokeclusters")
    out["hub_clusters"] = [project(h, ("name", "default_cluster", "peer_sites")) for h in hubs]
    out["spoke_clusters"] = [project(c, ("name", "default_cluster")) for c in spokes]
    elements = [e for e in rd.rows("get", "elements", label="elements") if str(e.get("site_id")) == sid]
    out["elements"] = []
    for el in sorted(elements, key=lambda e: str(e.get("name"))):
        eid = str(el["id"])
        row = _element_row(el, site_names)
        if rd.exhausted:
            rd.not_read.append(f"interfaces:{el.get('name')}")
            out["elements"].append(row)
            continue
        ifs = rd.rows("get", "interfaces", sid, eid, label=f"interfaces:{el.get('name')}")
        ifs_by_id = names_by_id(ifs)
        row["interfaces"] = [
            {
                **project(i, IFACE_FIELDS),
                "wan_interfaces": ref_names(wan_by_id, i.get("site_wan_interface_ids")),
                "lan_networks": ref_names(
                    lan_by_id,
                    [a.get("lan_network_id") for a in (i.get("attached_lan_networks") or []) if isinstance(a, dict)],
                ),
            }
            for i in ifs
        ]
        if out.get("lan_prefixes") is not None and not lan:
            for i in ifs:
                used_for = str(i.get("used_for") or "").lower()
                iscope = str(i.get("scope") or "").lower()
                addr = pick(i, "ipv4_config.static_config.address")
                if addr and (used_for in ("lan", "private") or iscope == "global") and not i.get("site_wan_interface_ids"):
                    entry = f"{addr} (interface {i.get('name')}, scope {i.get('scope') or 'unknown'})"
                    if entry not in out["lan_prefixes"]:
                        out["lan_prefixes"].append(entry)
        routes = rd.rows("get", "staticroutes", sid, eid, label=f"staticroutes:{el.get('name')}")
        row["static_routes"] = [
            {
                **project(r, ROUTE_FIELDS),
                "nexthops": [
                    {
                        "ip": pick(n, "nexthop_ip"),
                        "interface": ref_name(ifs_by_id, n.get("nexthop_interface_id")),
                        "admin_distance": n.get("admin_distance"),
                    }
                    for n in (r.get("nexthops") or [])
                    if isinstance(n, dict)
                ],
            }
            for r in routes
        ]
        cfg = rd.rows("get", "bgpconfigs", sid, eid, label=f"bgpconfigs:{el.get('name')}")
        row["bgp_config"] = project(cfg[0], BGPCONFIG_FIELDS) if cfg else None
        peers = rd.rows("get", "bgppeers", sid, eid, label=f"bgppeers:{el.get('name')}")
        row["bgp_peers"] = [project(p, BGPPEER_FIELDS) for p in peers]
        out["elements"].append(row)
    return envelope(safe(out), partial=rd.partial)


class _ObjType:
    __slots__ = ("method", "rules_method", "custom_only")

    def __init__(self, method: str, rules_method: Optional[str] = None, custom_only: bool = False):
        self.method = method
        self.rules_method = rules_method
        self.custom_only = custom_only


OBJECT_TYPES_MAP: Dict[str, _ObjType] = {
    "wannetworks": _ObjType("wannetworks"),
    "waninterfacelabels": _ObjType("waninterfacelabels"),
    "probeprofiles": _ObjType("probeprofiles"),
    "probeconfigs": _ObjType("probeconfigs"),
    "networkpolicysets": _ObjType("networkpolicysets", "networkpolicyrules"),
    "networkpolicysetstacks": _ObjType("networkpolicysetstacks"),
    "prioritypolicysets": _ObjType("prioritypolicysets", "prioritypolicyrules"),
    "prioritypolicysetstacks": _ObjType("prioritypolicysetstacks"),
    "natpolicysets": _ObjType("natpolicysets", "natpolicyrules"),
    "natpolicysetstacks": _ObjType("natpolicysetstacks"),
    "ngfwsecuritypolicysets": _ObjType("ngfwsecuritypolicysets", "ngfwsecuritypolicyrules"),
    "ngfwsecuritypolicysetstacks": _ObjType("ngfwsecuritypolicysetstacks"),
    "securityzones": _ObjType("securityzones"),
    "servicelabels": _ObjType("servicelabels"),
    "serviceendpoints": _ObjType("serviceendpoints"),
    "vrfcontexts": _ObjType("vrfcontexts"),
    "ipsecprofiles": _ObjType("ipsecprofiles"),
    "appdefs": _ObjType("appdefs", custom_only=True),
    "networkcontexts": _ObjType("networkcontexts"),
    "networkpolicyglobalprefixes": _ObjType("networkpolicyglobalprefixes"),
    "networkpolicylocalprefixes": _ObjType("tenant_networkpolicylocalprefixes"),
    "sitetemplates": _ObjType("bulkconfigurations_sitetemplates"),
}
OBJECT_TYPES = tuple(sorted(OBJECT_TYPES_MAP.keys()))


def _build_object_lookups(rd: Reader, rows: Any, extra: Optional[Dict[str, Tuple[str, str]]] = None) -> ObjectView:
    names: Dict[str, Dict[str, str]] = {}
    for method in sorted(needed_lookups(rows, extra)):
        if rd.exhausted:
            rd.not_read.append(method)
            continue
        got = rd.rows("get", method, label=method)
        if method not in rd.not_read:
            names[method] = names_by_id(got)
    return ObjectView(names, extra)


def view_object(sdk: Any, args: Dict[str, Any]) -> Dict[str, Any]:
    raw_type = args.get("object_type") or args.get("type")
    typ = check_choice(raw_type, OBJECT_TYPES, "object_type")
    if typ is None:
        raise SdwanViewError(400, "bad_request", f"object_type is required: one of {', '.join(OBJECT_TYPES)}")
    spec = OBJECT_TYPES_MAP[typ]
    rd = Reader(sdk)
    rows = rd.rows("get", spec.method, label=typ)
    if spec.custom_only:
        rows = [r for r in rows if str(r.get("visibility", "")).lower() == "customer" or r.get("system_app") is False]
    out: Dict[str, Any] = {"type": typ}
    wanted = str(args.get("name") or "").strip()
    name_key = {"appdefs": "display_name", "sitetemplates": "template_name"}.get(typ, "name")
    sets_method = typ.replace("stacks", "s") if typ.endswith("stacks") else None
    extra = (
        {"policyset_ids": (sets_method, "policy_sets"), "defaultrule_policyset_id": (sets_method, "default_rule_set")}
        if sets_method
        else None
    )
    if not wanted:
        view = _build_object_lookups(rd, rows[:CAP_OBJECTS], extra)
        shown = [
            {"name": pick(r, "name", "display_name", "template_name"), **view.value(r)}
            for r in rows[:CAP_OBJECTS]
        ]
        kept, meta = fit_rows(shown, cap_rows=CAP_OBJECTS, base=out)
        out["objects"] = kept
        out["total"] = len(rows)
        if meta["dropped"] or len(rows) > CAP_OBJECTS:
            out["truncated"] = True
            out["dropped"] = len(rows) - len(kept)
    else:
        match = next((r for r in rows if str(r.get(name_key, "")).lower() == wanted.lower()), None)
        if match is None:
            match = next((r for r in rows if wanted.lower() in str(r.get(name_key, "")).lower()), None)
        if match is None and spec.rules_method:
            # Fallback: caller passed a policy rule name (e.g. from get_prisma_flows `path_rule: "Hetzner via DC1"`)
            for candidate_set in rows:
                cid = candidate_set.get("id")
                if cid is None or rd.exhausted:
                    continue
                cand_rules = rd.rows("get", spec.rules_method, str(cid), label=spec.rules_method)
                rule_hit = next(
                    (
                        rl for rl in cand_rules
                        if str(rl.get("name", "")).lower() == wanted.lower()
                        or wanted.lower() in str(rl.get("name", "")).lower()
                    ),
                    None,
                )
                if rule_hit is not None:
                    match = candidate_set
                    out["matched_by"] = "policy_rule_name"
                    out["matched_rule_name"] = rule_hit.get("name")
                    break
        if match is None:
            available = sorted(str(r.get(name_key)) for r in rows if r.get(name_key))[:NAME_LIST_MAX]
            raise SdwanViewError(404, "not_found", f"No {typ} object named {wanted[:60]!r}.", hint=", ".join(available))
        view = _build_object_lookups(rd, match, extra)
        detail = view.value(match)
        if spec.rules_method and match.get("id") is not None:
            rules = rd.rows("get", spec.rules_method, str(match["id"]), label=spec.rules_method)
            rules = sorted(rules, key=lambda r: (r.get("order_number") is None, r.get("order_number") or 0))
            rview = _build_object_lookups(rd, rules[:CAP_RULES])
            shown = [rview.value(r) for r in rules[:CAP_RULES]]
            kept, _meta = fit_rows(shown, cap_rows=CAP_RULES, base={**out, "object": detail})
            detail["rules"] = kept
            detail["rule_count"] = len(rules)
            if len(rules) > len(kept):
                out["truncated"] = True
                out["dropped"] = len(rules) - len(kept)
            view.secrets += rview.secrets
        out["object"] = detail
    if view.secrets:
        out["fields_withheld"] = view.secrets
    return envelope(safe(out), partial=rd.partial)


# ---------------------------------------------------------------------------
# Dispatcher & CLI Entrypoint
# ---------------------------------------------------------------------------

VIEWS = {
    "site_status": view_site_status,
    "tunnels": view_tunnels,
    "bgp": view_bgp,
    "interfaces": view_interfaces,
    "events": view_events,
    "metrics": view_metrics,
    "inventory": view_inventory,
    "site_config": view_site_config,
    "object": view_object,
}


def dispatch_view(sdk: Any, view_name: str, args: Dict[str, Any]) -> Dict[str, Any]:
    v = check_choice(view_name, tuple(VIEWS.keys()), "view")
    if v is None:
        raise SdwanViewError(400, "bad_request", f"view is required: one of {', '.join(sorted(VIEWS.keys()))}")
    return VIEWS[v](sdk, args)


def _authenticate_sdk(credentials_path: str = "credentials.json") -> Any:
    if API is None:
        raise SdwanViewError(503, "sdk_missing", "prisma_sase Python SDK is not installed on this node.")
    script_dir = os.path.dirname(os.path.abspath(__file__))
    if script_dir not in sys.path:
        sys.path.insert(0, script_dir)
    from getflow import load_credentials

    class _DummyArgs:
        credentials = credentials_path

    creds = load_credentials(_DummyArgs(), json_mode=True)
    sdk = API(update_check=False)
    sdk.rest_call_timeout = SDK_TIMEOUT_S
    ok = sdk.interactive.login_secret(
        client_id=creds["client_id"],
        client_secret=creds["client_secret"],
        tsg_id=creds["tsg_id"],
    )
    if not ok:
        raise SdwanViewError(502, "auth_failed", "Prisma SD-WAN login_secret returned False.")
    return sdk


def main() -> None:
    parser = argparse.ArgumentParser(description="Read-Only Prisma SD-WAN Controller Views")
    parser.add_argument("--view", required=True, choices=sorted(VIEWS.keys()), help="Controller view to execute")
    parser.add_argument("--site", help="Site name or ID")
    parser.add_argument("--device", help="Element/device name filter (for interfaces view)")
    parser.add_argument("--prefixes", action="store_true", help="Include BGP reachable/advertised prefix lists")
    parser.add_argument("--hours", type=int, help="Lookback window in hours (events/metrics)")
    parser.add_argument("--kind", help="Event kind filter (all, alarm, alert, event)")
    parser.add_argument("--severity", help="Event severity filter (all, critical, major, minor, warning, info)")
    parser.add_argument("--code", help="Event code filter (e.g. NW_BGP_PEER_DOWN)")
    parser.add_argument("--metric", help="Metric category (lqm, bw, sys)")
    parser.add_argument("--circuit", help="Circuit/path substring filter for metrics")
    parser.add_argument("--object-type", dest="object_type", help="Object type for --view object")
    parser.add_argument("--name", help="Object name for --view object")
    parser.add_argument("--credentials", default="credentials.json", help="Credentials file path")
    parser.add_argument("--json", action="store_true", help="Output JSON")
    parsed = parser.parse_args()

    call_args = {
        "site": parsed.site,
        "device": parsed.device,
        "prefixes": parsed.prefixes,
        "hours": parsed.hours,
        "kind": parsed.kind,
        "severity": parsed.severity,
        "code": parsed.code,
        "metric": parsed.metric,
        "circuit": parsed.circuit,
        "object_type": parsed.object_type,
        "name": parsed.name,
    }
    try:
        sdk = _authenticate_sdk(parsed.credentials)
        res = dispatch_view(sdk, parsed.view, call_args)
        print(json.dumps(res, indent=2))
    except SdwanViewError as err:
        print(json.dumps(err.to_dict(), indent=2))
        sys.exit(0)
    except Exception as exc:
        print(json.dumps({"success": False, "error": str(exc), "code": type(exc).__name__}, indent=2))
        sys.exit(1)


if __name__ == "__main__":
    main()
