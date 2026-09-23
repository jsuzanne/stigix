#!/usr/bin/env python3
"""
Stigix Fabric Rollout Checker
=============================
Audits Stigix instances across the SD-WAN fabric to verify Docker image version,
git commit build SHA, role, and supported features (Path Trace, Provisioning, etc.).

Usage:
  python3 Scripts/check_fabric_rollout.py [--hosts 192.168.203.100,192.168.219.1] [--token <jwt>]
  python3 Scripts/check_fabric_rollout.py --registry-url https://registry.example.com
"""

import argparse
import json
import os
import sys
import urllib.request
import urllib.error
import ssl
from typing import Dict, Any, List, Optional

# Default fabric nodes if none provided
DEFAULT_NODES = [
    {"name": "DC1-Ubuntu (Leader)", "host": "192.168.203.100", "port": 80},
    {"name": "BR1 (Peer)", "host": "192.168.207.10", "port": 80},
    {"name": "BR2 (Peer)", "host": "192.168.206.10", "port": 80},
    {"name": "BR5 (Peer)", "host": "192.168.217.5", "port": 80},
    {"name": "BR8 (MCP/Peer)", "host": "192.168.219.1", "port": 80},
]

# ANSI colors
RESET = "\033[0m"
BOLD = "\033[1m"
GREEN = "\033[32m"
YELLOW = "\033[33m"
RED = "\033[31m"
CYAN = "\033[36m"
GRAY = "\033[90m"


def fetch_json(url: str, token: Optional[str] = None, timeout: float = 3.0) -> Optional[Dict[str, Any]]:
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    
    headers = {"User-Agent": "Stigix-Rollout-Checker/2.0"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
        
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=ctx) as response:
            content_type = response.headers.get("Content-Type", "")
            if "application/json" in content_type or response.status == 200:
                raw = response.read().decode("utf-8")
                # If SPA HTML is returned on old builds
                if raw.lstrip().startswith("<!DOCTYPE html") or raw.lstrip().startswith("<html"):
                    return None
                return json.loads(raw)
    except Exception:
        return None
    return None


def inspect_node(host: str, port: int = 80, token: Optional[str] = None) -> Dict[str, Any]:
    base_url = f"http://{host}:{port}"
    result: Dict[str, Any] = {
        "host": host,
        "port": port,
        "reachable": False,
        "version": "unknown",
        "build": "unknown",
        "role": "unknown",
        "traceroute_supported": False,
        "error": None
    }

    # 1. Query /api/version
    v_data = fetch_json(f"{base_url}/api/version", token=token, timeout=2.5)
    if v_data and isinstance(v_data, dict):
        result["reachable"] = True
        result["version"] = v_data.get("version", "unknown")
        result["build"] = v_data.get("build") or v_data.get("commit") or v_data.get("build_sha", "unknown")
    
    # 2. Query /api/status or /api/system/info for role & capabilities
    s_data = fetch_json(f"{base_url}/api/status", token=token, timeout=2.5)
    if s_data and isinstance(s_data, dict):
        result["reachable"] = True
        result["role"] = s_data.get("role", s_data.get("node_role", "peer"))
        if result["version"] == "unknown":
            result["version"] = s_data.get("version", "unknown")

    # 3. Test traceroute endpoint capability
    # Check if /api/network/traceroute route exists (POST without target will return 400 JSON on new build, or 404/200 HTML on old build)
    tr_ctx = ssl.create_default_context()
    tr_ctx.check_hostname = False
    tr_ctx.verify_mode = ssl.CERT_NONE
    headers = {"Content-Type": "application/json", "User-Agent": "Stigix-Rollout-Checker/2.0"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    tr_req = urllib.request.Request(f"{base_url}/api/network/traceroute", data=b"{}", headers=headers, method="POST")
    try:
        with urllib.request.urlopen(tr_req, timeout=2.0, context=tr_ctx) as resp:
            content = resp.read().decode("utf-8")
            if "application/json" in resp.headers.get("Content-Type", "") and not content.strip().startswith("<"):
                result["traceroute_supported"] = True
    except urllib.error.HTTPError as e:
        # HTTP 400 with json error means endpoint exists and handled the request
        try:
            err_body = e.read().decode("utf-8")
            if "application/json" in e.headers.get("Content-Type", "") or "Missing target" in err_body or "target" in err_body:
                result["traceroute_supported"] = True
        except Exception:
            pass
    except Exception:
        pass

    return result


def main():
    parser = argparse.ArgumentParser(description="Check Stigix version and rollout status across fabric nodes")
    parser.add_argument("--hosts", type=str, help="Comma-separated list of host:port or IP addresses")
    parser.add_argument("--token", type=str, default=os.getenv("STIGIX_JWT_TOKEN", ""), help="JWT auth token")
    parser.add_argument("--json", action="store_true", help="Output results as JSON")
    args = parser.parse_args()

    nodes_to_check = []
    if args.hosts:
        for item in args.hosts.split(","):
            item = item.strip()
            if not item:
                continue
            if ":" in item:
                h, p = item.split(":", 1)
                nodes_to_check.append({"name": item, "host": h, "port": int(p)})
            else:
                nodes_to_check.append({"name": item, "host": item, "port": 80})
    else:
        nodes_to_check = DEFAULT_NODES

    results = []
    for node in nodes_to_check:
        res = inspect_node(node["host"], node.get("port", 80), token=args.token)
        res["name"] = node.get("name", node["host"])
        results.append(res)

    if args.json:
        print(json.dumps(results, indent=2))
        return

    # Print Formatted Table
    print(f"\n{BOLD}{CYAN}=== Stigix Fabric Rollout Status ==={RESET}\n")
    header = f"{'NODE / HOST':<26} {'STATUS':<12} {'VERSION':<12} {'BUILD (COMMIT)':<16} {'ROLE':<10} {'PATH TRACE'}"
    print(BOLD + header + RESET)
    print("-" * 88)

    all_matched = True
    versions_found = set()

    for r in results:
        host_label = f"{r['name']}"
        if len(host_label) > 25:
            host_label = host_label[:22] + "..."
            
        if not r["reachable"]:
            status = f"{RED}OFFLINE{RESET}"
            ver_str = f"{GRAY}—{RESET}"
            build_str = f"{GRAY}—{RESET}"
            role_str = f"{GRAY}—{RESET}"
            trace_str = f"{GRAY}—{RESET}"
            all_matched = False
        else:
            status = f"{GREEN}ONLINE{RESET}"
            ver_str = f"{BOLD}{r['version']}{RESET}"
            versions_found.add(r['version'])
            build_str = r['build'][:10] if r['build'] != 'unknown' else 'unknown'
            role_str = r['role']
            trace_str = f"{GREEN}Yes (TCP/UDP){RESET}" if r['traceroute_supported'] else f"{YELLOW}No (Old build){RESET}"

        print(f"{host_label:<26} {status:<20} {ver_str:<20} {build_str:<16} {role_str:<10} {trace_str}")

    print("-" * 88)
    if len(versions_found) > 1:
        print(f"{YELLOW}Warning: Fabric version drift detected! Versions active: {', '.join(versions_found)}{RESET}\n")
    else:
        print(f"{GREEN}All active nodes aligned.{RESET}\n")


if __name__ == "__main__":
    main()
