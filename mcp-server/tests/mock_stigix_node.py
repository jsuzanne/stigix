#!/usr/bin/env python3
"""
Mock Stigix Node — FastAPI server that simulates a Stigix node for MCP contract testing.

Supports multiple error modes selectable at runtime via /admin/set-mode.
Records all incoming requests for post-hoc assertion.

Usage:
    uvicorn mock_stigix_node:create_app --factory --port 19080
"""

import asyncio
import json
import re
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, Request, Response
from fastapi.responses import HTMLResponse, JSONResponse, PlainTextResponse


# ---------------------------------------------------------------------------
# Mock mode enum
# ---------------------------------------------------------------------------
VALID_MODES = {
    "nominal_minimal",  # Always returns 200 + minimal JSON (alias for nominal)
    "nominal",          # Returns richer contextual data (used by nominal tests)
    "http_404",         # Always returns 404
    "http_500",         # Always returns 500
    "empty_body",       # Returns 200 with empty body
    "non_json",         # Returns 200 with text/plain "OK"
    "spa_html_200",     # Returns 200 with full HTML SPA shell
    "slow",             # Delays response by N seconds, then 200 {}
    "down",             # Returns 503 immediately (simulates connection refused at app level)
    "old_build",        # Node reports version 1.2.1 — v2 routes return 404
}

# Characters forbidden in injection-sensitive fields
_INJECTION_RE = re.compile(r'[;\$`|&<>]')

SPA_HTML = """<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Stigix</title></head>
<body><div id="root"></div><script src="/assets/index.js"></script></body>
</html>"""

# ---------------------------------------------------------------------------
# Shared fixture data (referenced by multiple endpoints)
# ---------------------------------------------------------------------------

_DEM_PROBES = [
    {
        "id": "probe-a705fa0e52",
        "name": "MS - Azure Portal",
        "endpointId": "ms---azure-portal",
        "type": "HTTP",
        "target": "https://portal.azure.com",
        "enabled": True,
    },
    {
        "id": "probe-b812fa3c21",
        "name": "Google DNS",
        "endpointId": "google---dns",
        "type": "DNS",
        "target": "8.8.8.8",
        "enabled": True,
    },
]

_DEM_STATS_RESULTS = [
    {
        "endpointId": "ms---azure-portal",
        "samples_count": 12,
        "success_rate_pct": 91.7,
        "avg_latency_ms": 145.2,
        "probe_name": "MS - Azure Portal",
    },
    {
        "endpointId": "google---dns",
        "samples_count": 0,
        "success_rate_pct": None,
        "avg_latency_ms": None,
        "probe_name": "Google DNS",
    },
]

# VyOS routers — returned as a LIST (not a dict wrapper)
_VYOS_ROUTERS_LIST = [
    {
        "id": "vyosrouter",
        "name": "VyOS-DC1",
        "host": "192.168.1.254",
        "status": "up",
        "interfaces": [
            {
                "name": "eth0",
                "description": "BR1-INET-197",
                "address": ["203.0.113.1/29"],
                "status": "up",
            },
            {
                "name": "eth1",
                "description": "BR2-MPLS-198",
                "address": ["10.198.0.1/30"],
                "status": "up",
            },
        ],
    }
]

# VyOS sequences — returned as a LIST
_VYOS_SEQUENCES_LIST = [
    {
        "id": "test-scenario",
        "name": "Test Scenario",
        "enabled": True,
        "steps": [
            {"action": "set-latency", "interface": "eth0", "latency_ms": 50},
        ],
    }
]

# Security config with enabled categories and tests
_SECURITY_CONFIG = {
    "url_filtering": {
        "enabled": True,
        "enabled_categories": ["cat-gambling-01"],
    },
    "dns_security": {
        "enabled": True,
        "enabled_tests": ["dns-malware-01"],
    },
}

# Security profile with items
_SECURITY_PROFILE = {
    "url_filtering": {
        "items": [
            {
                "id": "cat-gambling-01",
                "name": "Gambling Sites",
                "url": "http://mock-gambling-test.invalid/test",
                "category": "gambling",
            },
        ],
    },
    "dns_security": {
        "items": [
            {
                "id": "dns-malware-01",
                "name": "Malware C2 Domain",
                "domain": "malware.test.domain",
            },
        ],
    },
}

# Dashboard data (used by get_app_score)
_DASHBOARD_DATA = {
    "stats": {
        "requests_by_app": {
            "teams.microsoft.com": 150,
            "zoom.us": 80,
            "webex.com": 45,
        },
        "errors_by_app": {
            "teams.microsoft.com": 3,
            "zoom.us": 1,
            "webex.com": 0,
        },
    },
    "version": "2.0.62-test",
    "uptime": 86400,
}


def create_app(
    port: int = 19080,
    mode: str = "nominal_minimal",
    slow_delay: float = 15.0,
    node_id: str = "mock-primary",
) -> FastAPI:
    """Factory function for the mock Stigix node."""

    state: Dict[str, Any] = {
        "mode": mode,
        "slow_delay": slow_delay,
        "node_id": node_id,
        "requests": [],
    }

    app = FastAPI(title=f"Mock Stigix Node ({node_id})")

    # ------------------------------------------------------------------
    # Admin endpoints (test harness control plane)
    # ------------------------------------------------------------------

    @app.post("/admin/set-mode")
    async def set_mode(request: Request):
        body = await request.json()
        new_mode = body.get("mode", "nominal_minimal")
        if new_mode not in VALID_MODES:
            return JSONResponse(
                {"error": f"Unknown mode: {new_mode}", "valid_modes": sorted(VALID_MODES)},
                status_code=400,
            )
        state["mode"] = new_mode
        if "slow_delay" in body:
            state["slow_delay"] = float(body["slow_delay"])
        return {"ok": True, "mode": new_mode}

    @app.get("/admin/mode")
    async def get_mode():
        return {"mode": state["mode"]}

    @app.get("/admin/requests")
    async def get_requests():
        return state["requests"]

    @app.delete("/admin/requests")
    async def clear_requests():
        state["requests"].clear()
        return {"ok": True, "cleared": True}

    # ------------------------------------------------------------------
    # Registry / targets endpoint (used by RegistryClient)
    # ------------------------------------------------------------------

    @app.get("/api/targets")
    async def api_targets(request: Request):
        _record(state, request)
        if state["mode"] == "old_build":
            return JSONResponse([
                {
                    "id": "mock-primary",
                    "name": "mock-primary",
                    "host": "127.0.0.1",
                    "kind": "fabric",
                    "role": "both",
                    "source": "managed",
                    "version": "1.2.1",
                    "build": "legacy",
                    "api_base_url": f"http://127.0.0.1:{port}",
                    "capabilities": {"xfr": True},
                    "capabilities_list": ["xfr-source"],
                    "public_ip": "203.0.113.1",
                    "meta": {"site_name": "mock-primary", "region": "test"},
                },
            ])
        return JSONResponse([
            {
                "id": "mock-primary",
                "name": "mock-primary",
                "host": "127.0.0.1",
                "kind": "fabric",
                "role": "both",
                "source": "managed",
                "version": "2.0.62-test",
                "build": "test-harness",
                "api_base_url": f"http://127.0.0.1:{port}",
                "capabilities": {"xfr": True, "voice": True, "iot": True, "dem": True},
                "capabilities_list": ["xfr-source", "xfr-target", "voice", "iot", "dem"],
                "public_ip": "203.0.113.1",
                "meta": {"site_name": "mock-primary", "region": "test"},
            },
            {
                "id": "mock-canary",
                "name": "mock-canary",
                "host": "127.0.0.2",
                "kind": "fabric",
                "role": "both",
                "source": "managed",
                "version": "2.0.62-test",
                "build": "test-harness",
                "api_base_url": f"http://127.0.0.1:{port + 1}",
                "capabilities": {"xfr": True, "voice": True, "dem": True},
                "capabilities_list": ["xfr-source", "xfr-target", "voice", "dem"],
                "public_ip": "203.0.113.2",
                "meta": {"site_name": "mock-canary", "region": "test"},
            },
        ])

    # ------------------------------------------------------------------
    # Catch-all API routes (mode-dependent behavior)
    # ------------------------------------------------------------------

    @app.api_route("/api/{path:path}", methods=["GET", "POST", "PUT", "DELETE", "PATCH"])
    async def catch_all_api(path: str, request: Request):
        body_bytes = await request.body()
        _record(state, request, body_bytes)

        mode = state["mode"]

        if mode == "http_404":
            return JSONResponse({"error": "Not Found"}, status_code=404)

        if mode == "http_500":
            return JSONResponse(
                {"success": False, "error": "Internal Server Error"},
                status_code=500,
            )

        if mode == "empty_body":
            return Response(content=b"", media_type="application/json", status_code=200)

        if mode == "non_json":
            return PlainTextResponse("OK", status_code=200)

        if mode == "spa_html_200":
            return HTMLResponse(SPA_HTML, status_code=200)

        if mode == "slow":
            await asyncio.sleep(state["slow_delay"])
            return JSONResponse({"success": True, "delayed": True})

        if mode == "down":
            return JSONResponse(
                {"error": "Service Unavailable"},
                status_code=503,
            )

        if mode == "old_build":
            return _old_build_response(path, request.method)

        # nominal and nominal_minimal — return contextual responses
        return await _nominal_response(path, request.method, body_bytes, request.query_params)

    return app


# ---------------------------------------------------------------------------
# Injection detection helper
# ---------------------------------------------------------------------------

def _contains_injection(value: str) -> bool:
    """Return True if the string contains shell injection characters."""
    return bool(_INJECTION_RE.search(value))


# ---------------------------------------------------------------------------
# Old build responses (v1.2.1 — many v2 routes missing)
# ---------------------------------------------------------------------------

_OLD_BUILD_UNAVAILABLE_PREFIXES = (
    "vyos",
    "connectivity/custom",
    "connectivity/test",
    "connectivity/results",
    "security/scores",
    "security/posture",
    "provisioning/publish",
    "provisioning/rollback",
    "provisioning/purge",
    "provisioning/history",
    "network/traceroute",
    "tcp-apps",
    "custom-tcp",
    "controller",
    "voice/ingress",
    "health-matrix",
    "diagnostics/system",
)


def _old_build_response(path: str, method: str) -> JSONResponse:
    """
    Simulate a v1.2.1 node:
    - V2-only routes return 404 with 'node_build' field.
    - Basic v1 routes return minimal data.
    """
    for prefix in _OLD_BUILD_UNAVAILABLE_PREFIXES:
        if prefix in path:
            return JSONResponse(
                {
                    "success": False,
                    "error": f"Route '{path}' not available on this node version",
                    "node_build": "1.2.1",
                    "min_required_version": "2.0.0",
                    "detail": "Upgrade the Stigix node to access this feature.",
                },
                status_code=404,
            )

    # v1 routes that DO exist
    if "status" in path:
        return JSONResponse({"success": True, "status": "ok", "version": "1.2.1"})
    if "network/public-ip" in path:
        return JSONResponse({"public_ip": "203.0.113.1"})
    if "traffic/status" in path or "traffic/stats" in path:
        return JSONResponse({"success": True, "enabled": False, "stats": {}})
    if "traffic/logs" in path:
        return JSONResponse({"success": True, "logs": []})
    if "apps" in path and method == "GET":
        return JSONResponse({"success": True, "applications": []})

    # Generic v1 fallback
    return JSONResponse({"success": True, "data": {}, "version": "1.2.1"})


# ---------------------------------------------------------------------------
# Nominal responses (realistic fixture data)
# ---------------------------------------------------------------------------

async def _nominal_response(path: str, method: str, body_bytes: bytes = b"", query_params: Any = None) -> JSONResponse:
    """Return contextual, realistic responses for common Stigix API paths.
    Used in both 'nominal' and 'nominal_minimal' modes."""

    body_json: Dict[str, Any] = {}
    if body_bytes:
        try:
            body_json = json.loads(body_bytes.decode("utf-8", errors="replace"))
        except (json.JSONDecodeError, ValueError):
            pass

    # -------- Admin / Dashboard --------
    if "admin/system/dashboard-data" in path:
        return JSONResponse(_DASHBOARD_DATA)

    # -------- Injection guard on traceroute target --------
    if "network/traceroute" in path:
        target = (query_params.get("target") if query_params else None) or body_json.get("target", "")
        if target and _contains_injection(str(target)):
            return JSONResponse(
                {
                    "success": False,
                    "error": "Invalid target: contains forbidden characters",
                    "target": str(target)[:100],
                },
                status_code=400,
            )
        return JSONResponse({
            "success": True,
            "target": target or "1.1.1.1",
            "hops": [
                {"hop": 1, "ip": "192.168.1.1", "rtt_ms": 1.2, "status": "ok"},
                {"hop": 2, "ip": "10.0.0.1", "rtt_ms": 5.8, "status": "ok"},
                {"hop": 3, "ip": "1.1.1.1", "rtt_ms": 12.3, "status": "ok"},
            ],
            "destination_reached": True,
            "total_hops": 3,
        })

    # -------- DEM / Connectivity --------
    if "connectivity/stats" in path:
        return JSONResponse({
            "globalHealth": 87,
            "avgResponseTime": 38.2,
            "probeCount": 2,
            "results": _DEM_STATS_RESULTS,
            # lastResults is read by get_probe_performance (get_probe_details tool)
            "lastResults": _DEM_STATS_RESULTS,
        })
    if "connectivity/custom" in path:
        if method in ("POST", "PUT"):
            return JSONResponse({"success": True, "targets": _DEM_PROBES})
        if method == "DELETE":
            return JSONResponse({"success": True})
        # GET — list probes
        return JSONResponse({"targets": _DEM_PROBES})
    if "connectivity/results" in path:
        return JSONResponse({"results": []})
    if "connectivity/test" in path:
        return JSONResponse({"results": [
            {"name": "MS - Azure Portal", "status": "success", "httpCode": 200, "latency_ms": 145.2},
            {"name": "Google DNS", "status": "success", "httpCode": None, "latency_ms": 8.1},
        ]})

    # -------- Controller --------
    if "controller/status" in path:
        return JSONResponse({
            "is_leader": False,
            "leader_ip": "192.168.203.100",
            "local_instances": [],
            "site_name": "mock-primary",
            "mode": "branch",
            "peer_count": 2,
        })
    if "controller/peers" in path:
        return JSONResponse([])
    if "controller/leader" in path:
        return JSONResponse({"success": True, "leader_url": None})
    if "controller/onboard" in path:
        return JSONResponse({
            "success": True,
            "command": "curl -sSL http://mock-primary:8080/onboard | bash",
            "curl_command": "curl -sSL http://mock-primary:8080/onboard | bash",
        })

    # -------- Provisioning --------
    if "provisioning/status" in path:
        return JSONResponse({
            "success": True,
            "provisioning_enabled": True,
            "appliedRevisions": {},
            "pendingChanges": False,
        })
    if "provisioning/history" in path:
        return JSONResponse({
            "success": True,
            "history": [
                {
                    "revision": 42,
                    "timestamp": "2026-09-23T21:00:00Z",
                    "addedCount": 7,
                    "modifiedCount": 0,
                    "removedCount": 0,
                    "bundle_type": "connectivity-probes",
                    "summary": "Added 7 DEM probes",
                },
                {
                    "revision": 41,
                    "timestamp": "2026-09-23T20:00:00Z",
                    "addedCount": 0,
                    "modifiedCount": 3,
                    "removedCount": 0,
                    "bundle_type": "connectivity-probes",
                    "summary": "Modified 3 probes",
                },
            ],
        })
    if "provisioning/publish" in path:
        return JSONResponse({
            "success": True,
            "published": {"revision": 43, "bundle_type": "connectivity-probes"},
        })
    if "provisioning/purge" in path:
        dry_run = body_json.get("dry_run", True)
        return JSONResponse({
            "success": True,
            "dry_run": dry_run,
            "to_delete": [],
            "message": "Nothing to purge" if dry_run else "Purge complete",
            "result": {},
        })
    if "provisioning/rollback" in path:
        return JSONResponse({"success": True, "message": "Rollback applied"})
    if "provisioning/mode" in path:
        return JSONResponse({"success": True, "provisioning_enabled": True})

    # -------- Network --------
    if "network/public-ip" in path:
        return JSONResponse({"public_ip": "203.0.113.1"})

    # -------- Traffic --------
    if "traffic/status" in path or "traffic/stats" in path:
        return JSONResponse({"success": True, "enabled": False, "stats": {}})
    if "traffic/rate" in path:
        return JSONResponse({"success": True, "rate": 1.0})
    if "traffic/logs" in path:
        return JSONResponse({"success": True, "logs": []})
    if "traffic/clients" in path:
        return JSONResponse({"success": True, "client_count": 1})

    # -------- Voice --------
    if "voice/status" in path or "voice/stats" in path:
        return JSONResponse({"success": True, "enabled": False, "stats": {}})
    if "voice/ingress" in path:
        return JSONResponse({"success": True, "calls": []})

    # -------- Diagnostics --------
    if "diagnostics" in path:
        return JSONResponse({"success": True, "diagnostics": {}})

    # -------- Node status --------
    if "status" in path and "traffic" not in path and "voice" not in path:
        return JSONResponse({"success": True, "status": "ok"})

    # -------- Node info --------
    if "node/info" in path or path.endswith("/info"):
        return JSONResponse({"success": True, "version": "2.0.62-test"})

    # -------- VyOS — MUST return lists, not dicts --------
    if "vyos/routers" in path and "/state" not in path:
        return JSONResponse(_VYOS_ROUTERS_LIST)
    if "vyos/history" in path:
        # Must be a list — vyos_execute_adhoc reads history[0].get("cli_equivalent")
        return JSONResponse([
            {
                "id": "hist-001",
                "timestamp": "2026-09-23T20:00:00Z",
                "command": "show-denied",
                "router_id": "vyosrouter",
                "cli_equivalent": "sudo vyos_sdwan_ctl.py show-denied",
                "result": "ok",
            },
        ])
    if "vyos/sequences" in path or "vyos/scenarios" in path:
        if method in ("POST", "PUT"):
            # run_vyos_sequence calls POST .../run/{seq_id};
            # vyos_execute_adhoc calls POST .../sequences (create) then POST .../sequences/run/{id}
            if "/run" in path:
                return JSONResponse({"success": True, "executed": True, "result": "ok"})
            # Create / update a sequence
            return JSONResponse({"success": True, "id": "test-scenario",
                                 "name": "Test Scenario", "enabled": True})
        if method == "DELETE":
            return JSONResponse({"success": True})
        # GET — return the list of sequences (set_vyos_scenario_status iterates this)
        return JSONResponse(_VYOS_SEQUENCES_LIST)
    if "vyos/router" in path and "/state" in path:
        return JSONResponse({
            "router_id": "vyosrouter",
            "interfaces": [
                {"name": "eth0", "admin_state": "up", "qos": {}, "blackhole_ips": []},
            ],
        })
    if "vyos/action" in path or "vyos/adhoc" in path:
        return JSONResponse({"success": True, "command": "show-denied", "output": "0 denied entries"})
    if "vyos" in path:
        return JSONResponse({"success": True, "routers": _VYOS_ROUTERS_LIST,
                             "scenarios": _VYOS_SEQUENCES_LIST, "timeline": []})

    # -------- Security --------
    if "security/config" in path:
        return JSONResponse(_SECURITY_CONFIG)
    if "security/profile" in path:
        return JSONResponse(_SECURITY_PROFILE)
    if "security/eicar-targets" in path:
        return JSONResponse({"targets": [
            {"type": "cloud", "target": "https://mock-eicar.stigix.io", "url": "https://mock-eicar.stigix.io/eicar.com.txt"},
        ]})
    if "security/url-test-batch" in path:
        return JSONResponse({"results": [
            {"url": "http://mock-gambling-test.invalid/test", "category": "Gambling Sites",
             "status": "blocked", "response_code": 403},
        ]})
    if "security/dns-test-batch" in path:
        return JSONResponse({"results": [
            {"domain": "malware.test.domain", "testName": "Malware C2 Domain",
             "status": "blocked", "resolved_ip": None},
        ]})
    if "security/posture" in path or "security/scores" in path:
        return JSONResponse({
            "url_filter": 85.0,
            "dns_security": 92.0,
            "threat_prevention": 100.0,
        })
    if "security" in path:
        return JSONResponse({"success": True, "results": []})

    # -------- Apps --------
    if "apps/config" in path:
        if method == "GET":
            return JSONResponse({"success": True, "config": {}, "applications": []})
        return JSONResponse({"success": True})
    if "apps" in path and method == "GET":
        return JSONResponse({"success": True, "applications": []})
    if "apps" in path:
        return JSONResponse({"success": True, "applications": []})

    # -------- Speedtest --------
    if "speedtest" in path:
        return JSONResponse({"success": True, "history": []})

    # -------- Convergence --------
    if "convergence/status" in path:
        return JSONResponse([
            {
                "test_id": "CONV-0249 (BR8-DC1-failover-demo-v4)",
                "testId": "CONV-0249",
                "label": "BR8-DC1-failover-demo-v4",
                "status": "running",
                "sent": 866,
                "received": 865,
                "server_received": 865,
                "loss_pct": 0.0,
                "live_loss_pct": 0.0,
                "total_loss_pct": 0.1,
                "tx_loss_pct": 0.1,
                "rx_loss_pct": 0.0,
                "tx_lost_packets": 1,
                "rx_lost_packets": 0,
                "max_blackout_ms": 0,
                "current_blackout_ms": 0,
                "avg_rtt_ms": 8.11,
                "current_rtt_ms": 8.0,
                "jitter_ms": 3.2,
                "rate_pps": 50,
                "duration_s": 19.7,
                "history": [1] * 100,
                "start_time": 1790248000.0,
                "target": "192.168.203.100",
                "port": 6200,
                "source_port": 30249,
                "running": True,
                "egress_path": None,
                "path_evolution": None,
            }
        ])
    if "convergence/history" in path:
        return JSONResponse([
            {
                "test_id": "CONV-0248 (BR8-DC1-failover-demo-v3)",
                "testId": "CONV-0248 (BR8-DC1-failover-demo-v3)",
                "label": "BR8-DC1-failover-demo-v3",
                "status": "stopped",
                "sent": 14981,
                "received": 14512,
                "server_received": 14512,
                "loss_pct": 3.1,
                "live_loss_pct": 0.0,
                "total_loss_pct": 3.1,
                "tx_loss_pct": 1.2,
                "rx_loss_pct": 2.0,
                "tx_lost_packets": 180,
                "rx_lost_packets": 289,
                "max_blackout_ms": 8859,
                "current_blackout_ms": 0,
                "avg_rtt_ms": 54.08,
                "current_rtt_ms": 22.1,
                "jitter_ms": 10.31,
                "rate_pps": 50,
                "duration_s": 304.7,
                "target": "192.168.203.100",
                "port": 6200,
                "source_port": 30248,
                "egress_path": "BR8-INET2 → DC1-INET",
                "path_evolution": "BR8-INET2 → DC1-INET",
                "timestamp": 1790247984681,
            },
            {
                "test_id": "CONV-0247 (BR8-DC1-failover-demo-v2)",
                "testId": "CONV-0247 (BR8-DC1-failover-demo-v2)",
                "label": "BR8-DC1-failover-demo-v2",
                "status": "stopped",
                "sent": 56699,
                "received": 56052,
                "server_received": 56052,
                "loss_pct": 1.1,
                "tx_loss_pct": 1.1,
                "rx_loss_pct": 0.0,
                "max_blackout_ms": 11742,
                "avg_rtt_ms": 20.97,
                "jitter_ms": 15.47,
                "duration_s": 1152.1,
                "egress_path": "BR8-INET2 → DC1-INET",
                "target": "192.168.203.100",
                "port": 6200,
                "source_port": 30247,
                "timestamp": 1790240000000,
            }
        ])
    if "convergence/stop" in path:
        return JSONResponse({"success": True, "stopped_test": "CONV-0249"})
    if "convergence" in path:
        return JSONResponse({"success": True, "status": "ok"})

    # -------- Fabric targets --------
    if "fabric/targets" in path or ("targets" in path and "fabric" in path):
        return JSONResponse({"success": True, "targets": []})

    # -------- Custom TCP Apps --------
    if "tcp-apps" in path or "custom-tcp" in path:
        return JSONResponse({"success": True, "apps": []})

    # -------- Prisma flows --------
    if "prisma" in path or "flows" in path:
        return JSONResponse({"success": True, "flows": []})

    # -------- Health matrix --------
    if "health" in path:
        return JSONResponse({"success": True, "matrix": {}})

    # -------- Impairments --------
    if "impairment" in path:
        return JSONResponse({"success": True, "impairments": []})

    # -------- Generic fallback --------
    return JSONResponse({"success": True, "data": {}})


# ---------------------------------------------------------------------------
# Request recorder
# ---------------------------------------------------------------------------

def _record(state: Dict, request: Request, body: bytes = None):
    """Record a request for later assertion."""
    state["requests"].append({
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "method": request.method,
        "path": str(request.url.path),
        "query": str(request.url.query) if request.url.query else None,
        "body": body.decode("utf-8", errors="replace") if body else None,
    })


# ---------------------------------------------------------------------------
# Standalone runner
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import uvicorn
    import sys

    port = int(sys.argv[1]) if len(sys.argv) > 1 else 19080
    node_id = sys.argv[2] if len(sys.argv) > 2 else "mock-primary"
    app = create_app(port=port, node_id=node_id)
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning")
