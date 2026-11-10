"""Pure helpers for Prisma SD-WAN flow decision analysis.

Translates raw Prisma SD-WAN flow monitor records (`post.monitor_flows`) into
human-readable circuit names, WAN path labels (Direct & VPN), Path Policy rule
names, NAT actions, and structured decision metadata (`chosen_wan_path`,
`policy_allowed_wan_paths`, `state_up_policy_allowed_wan_paths`,
`sla_filtered_state_up_policy_allowed_wan_paths`, `available_wan_networks`).

Designed to be 100% fault-tolerant: any failed API lookup degrades gracefully
to the raw ID and never raises an exception.
"""
from __future__ import annotations

import re
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

PROTO_NAMES = {1: "ICMP", 6: "TCP", 17: "UDP", 47: "GRE", 50: "ESP", 58: "ICMPv6"}

_NAT_KEY = re.compile(r"(?:^|_)nat(?:_|$)", re.I)  # nat_policy_action, not destination_*
_DECISION_PATH_KEYS = (
    "policy_allowed_wan_paths",
    "state_up_policy_allowed_wan_paths",
    "sla_filtered_state_up_policy_allowed_wan_paths",
)


def _iso(epoch: float) -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime(epoch))


def _ms_iso(ms: Any) -> Optional[str]:
    try:
        return datetime.fromtimestamp(int(ms) / 1000, tz=timezone.utc).isoformat(timespec="seconds")
    except (TypeError, ValueError, OSError):
        return None


def _body(resp: Any) -> Any:
    """Extract JSON body from a Prisma SASE SDK response (`cgx_content`),
    a `requests.Response` (`.json()`), or a read-only `Resp` tuple (`.body`)."""
    if resp is None:
        return None
    if hasattr(resp, "cgx_content") and isinstance(resp.cgx_content, dict):
        return resp.cgx_content
    if hasattr(resp, "body") and not hasattr(resp, "json"):
        return resp.body
    if hasattr(resp, "json") and callable(resp.json):
        return resp.json()
    if isinstance(resp, dict):
        return resp
    return None


def _items(resp: Any) -> List[Dict[str, Any]]:
    try:
        return (_body(resp) or {}).get("items") or []
    except Exception:
        return []


def _real_id(v: Any) -> bool:
    return v not in (None, "", "0", 0)


class FlowResolver:
    """Lazy ID -> name lookups for one site. A failed lookup degrades to the
    raw ID, never to an exception.

    Can also be pre-seeded with `wan_if_lookup` or `topology` dicts already
    fetched by `getflow.py` to avoid duplicate network calls.
    """

    def __init__(
        self,
        sdk: Any,
        site_id: str,
        wan_if_lookup: Optional[Dict[str, Dict[str, Any]]] = None,
        topology_links: Optional[List[Dict[str, Any]]] = None,
    ):
        self.sdk = sdk
        self.site_id = site_id
        self._wans: Optional[Dict[str, str]] = None
        self._paths: Optional[Dict[str, str]] = None
        self._rules: Dict[str, Dict[str, str]] = {}
        self._pre_wan_lookup = wan_if_lookup or {}
        self._pre_topo_links = topology_links

    def _wan_names(self) -> Dict[str, str]:
        if self._wans is None:
            self._wans = {}
            # First seed from pre-fetched wan_if_lookup if provided
            for wid, info in self._pre_wan_lookup.items():
                if isinstance(info, dict):
                    label = info.get("circuit_name") or info.get("interface_name") or info.get("full_name")
                    if label:
                        self._wans[str(wid)] = str(label)
                elif isinstance(info, str):
                    self._wans[str(wid)] = info
            # Query site waninterfaces if still empty or missing
            if not self._wans and self.sdk is not None and _real_id(self.site_id):
                try:
                    for w in _items(self.sdk.get.waninterfaces(self.site_id)):
                        wid = w.get("id")
                        if wid:
                            self._wans[str(wid)] = w.get("name") or w.get("label") or str(wid)
                except Exception:
                    pass
        return self._wans

    def _fetch_topology_links(self) -> List[Dict[str, Any]]:
        if self._pre_topo_links is not None:
            return self._pre_topo_links
        if self.sdk is None or not _real_id(self.site_id):
            return []
        try:
            if hasattr(self.sdk, "post") and hasattr(self.sdk.post, "topology"):
                resp = self.sdk.post.topology({"type": "basenet", "nodes": [self.site_id]})
                return (_body(resp) or {}).get("links") or []
            if hasattr(self.sdk, "_session"):
                url = "https://api.sase.paloaltonetworks.com/sdwan/v3.6/api/topology"
                resp = self.sdk._session.post(url, json={"type": "basenet", "nodes": [self.site_id]}, timeout=20)
                if resp.status_code == 200:
                    return (resp.json() or {}).get("links") or []
        except Exception:
            pass
        return []

    def _path_labels(self) -> Dict[str, str]:
        if self._paths is None:
            self._paths = {}
            links = self._fetch_topology_links()
            for lk in links:
                if not isinstance(lk, dict):
                    continue
                pid = lk.get("path_id")
                kind = lk.get("type") or ""
                if not pid:
                    continue
                pid_str = str(pid)
                if kind.endswith("-stub"):
                    target_circuit = (
                        lk.get("target_circuit_name")
                        or self._wan_names().get(str(lk.get("target_wan_if_id") or ""))
                        or self._wan_names().get(pid_str)
                        or pid_str
                    )
                    self._paths[pid_str] = f"Direct: {target_circuit}"
                else:
                    label = "VPN" if kind.lower() == "vpn" else (kind or "VPN")
                    src_ckt = (
                        lk.get("source_circuit_name")
                        or self._wan_names().get(str(lk.get("source_wan_if_id") or ""))
                    )
                    tgt_site = lk.get("target_site_name")
                    tgt_ckt = (
                        lk.get("target_circuit_name")
                        or self._wan_names().get(str(lk.get("target_wan_if_id") or ""))
                    )
                    if src_ckt and tgt_site and tgt_ckt:
                        self._paths[pid_str] = f"{label}: {src_ckt} -> {tgt_site} ({tgt_ckt})"
                    elif src_ckt and tgt_ckt:
                        self._paths[pid_str] = f"{label}: {src_ckt} -> {tgt_ckt}"
        return self._paths

    def circuit(self, wan_id: Any) -> Optional[str]:
        if not _real_id(wan_id):
            return None
        wid = str(wan_id)
        return self._wan_names().get(wid, wid)

    def path(self, path_id: Any) -> Optional[str]:
        if not _real_id(path_id):
            return None
        pid = str(path_id)
        label = self._path_labels().get(pid)
        if label:
            return label
        name = self._wan_names().get(pid)
        return f"Direct: {name}" if name else pid

    def rule(self, set_id: Any, rule_id: Any) -> Optional[str]:
        if not _real_id(rule_id):
            return None
        rid = str(rule_id)
        if _real_id(set_id):
            sid = str(set_id)
            if sid not in self._rules:
                self._rules[sid] = {}
                if self.sdk is not None:
                    try:
                        for r in _items(self.sdk.get.networkpolicyrules(sid)):
                            if r.get("id"):
                                self._rules[sid][str(r["id"])] = r.get("name") or str(r["id"])
                    except Exception:
                        pass
            return self._rules.get(sid, {}).get(rid, rid)
        return rid


def resolve_flow(f: Dict[str, Any], r: FlowResolver) -> Dict[str, Any]:
    """Resolve a single flow record into human-readable circuit, path, policy rule,
    NAT dictionary, and decision list (capped at first 3 decision metadata entries
    for compact digest, while preserving full structure)."""
    proto = f.get("protocol")
    decisions: List[Dict[str, Any]] = []
    for m in (f.get("flow_decision_metadata_list") or [])[:3]:
        if not isinstance(m, dict):
            continue
        d: Dict[str, Any] = {k: [r.path(p) for p in (m.get(k) or [])] for k in _DECISION_PATH_KEYS}
        d["available_wan_networks"] = [r.circuit(w) for w in (m.get("available_wan_networks") or [])]
        d["preferred_wan_path"] = r.path(m.get("preferred_wan_path"))
        d["chosen_wan_path"] = r.path(m.get("chosen_wan_path"))
        if m.get("flow_decision_time"):
            d["decision_time_ms"] = m.get("flow_decision_time")
            d["decision_time"] = _ms_iso(m.get("flow_decision_time"))
        decisions.append(d)

    return {
        "start": _ms_iso(f.get("flow_start_time_ms")),
        "end": _ms_iso(f.get("flow_end_time_ms")),
        "source": f"{f.get('source_ip')}:{f.get('source_port')}",
        "destination": f"{f.get('destination_ip')}:{f.get('destination_port')}",
        "protocol": PROTO_NAMES.get(proto, str(proto)),
        "destination_port": f.get("destination_port"),
        "flow_action": f.get("flow_action"),
        "path_type": f.get("path_type"),
        "flow_direction": f.get("flow_direction"),
        "circuit": r.circuit(f.get("waninterface_id")),
        "path": r.path(f.get("path_id")),
        "network_policy": r.rule(f.get("network_policy_set_id"), f.get("network_policy_id")),
        "nat": {k: v for k, v in f.items() if _NAT_KEY.search(k) and v not in (None, "", [], {})},
        "packets_c2s": f.get("packets_c2s"),
        "packets_s2c": f.get("packets_s2c"),
        "bytes_c2s": f.get("bytes_c2s"),
        "bytes_s2c": f.get("bytes_s2c"),
        "decisions": decisions,
    }


def summarize_resolved_flow(resolved: Dict[str, Any], raw_flow: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Produce the compact decision summary fields (`chosen_path`, `allowed_paths`,
    `usable_paths`, `sla_filtered_paths`, `available_circuits`, `path_rule`, `nat`, `application`)."""
    d = (resolved.get("decisions") or [{}])[0]
    app = None
    if raw_flow:
        for k in ("app_name", "application", "app_id"):
            if raw_flow.get(k) not in (None, ""):
                app = raw_flow.get(k)
                break
    return {
        "protocol_name": resolved.get("protocol"),
        "flow_action": resolved.get("flow_action"),
        "flow_direction": resolved.get("flow_direction"),
        "circuit": resolved.get("circuit"),
        "path": resolved.get("path"),
        "path_rule": resolved.get("network_policy"),
        "network_policy": resolved.get("network_policy"),
        "nat": resolved.get("nat") or None,
        "chosen_path": d.get("chosen_wan_path"),
        "preferred_path": d.get("preferred_wan_path"),
        "allowed_paths": d.get("policy_allowed_wan_paths"),
        "usable_paths": d.get("state_up_policy_allowed_wan_paths"),
        "sla_filtered_paths": d.get("sla_filtered_state_up_policy_allowed_wan_paths"),
        "available_circuits": d.get("available_wan_networks"),
        "application": app,
        "decisions": resolved.get("decisions"),
    }
