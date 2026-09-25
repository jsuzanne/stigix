#!/usr/bin/env python3
"""
Stigix MCP & Provisioning Health Check Script
Verifies that the Stigix node APIs and FastMCP provisioning endpoints are responsive without hanging.
"""

import sys
import time
import json
import httpx

def check_endpoint(name: str, url: str, headers: dict = None):
    start = time.time()
    try:
        r = httpx.get(url, headers=headers or {}, timeout=5.0)
        elapsed = round(time.time() - start, 3)
        status = r.status_code
        is_json = False
        try:
            r.json()
            is_json = True
        except Exception:
            pass
        print(f"[{name}] HTTP {status} in {elapsed}s | JSON: {is_json} | URL: {url}")
        return status == 200 and is_json
    except Exception as e:
        elapsed = round(time.time() - start, 3)
        print(f"[{name}] FAILED after {elapsed}s: {e}")
        return False

if __name__ == "__main__":
    target_host = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:3000"
    print(f"=== Testing Provisioning & Diagnostics Endpoints on {target_host} ===")
    
    endpoints = [
        ("Health Matrix", f"{target_host}/api/system/health-matrix"),
        ("Provisioning Status", f"{target_host}/api/provisioning/status"),
        ("Provisioning History", f"{target_host}/api/provisioning/history?limit=5"),
        ("Custom DEM Probes", f"{target_host}/api/connectivity/custom"),
        ("Traceroute Loopback", f"{target_host}/api/network/traceroute?target=127.0.0.1&max_hops=3"),
    ]
    
    success_count = 0
    for name, url in endpoints:
        if check_endpoint(name, url):
            success_count += 1
            
    print(f"\nResult: {success_count}/{len(endpoints)} checks passed.")
