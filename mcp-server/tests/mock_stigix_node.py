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
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, Request, Response
from fastapi.responses import HTMLResponse, JSONResponse, PlainTextResponse


# ---------------------------------------------------------------------------
# Mock mode enum
# ---------------------------------------------------------------------------
VALID_MODES = {
    "nominal_minimal",  # Always returns 200 + minimal JSON
    "http_404",         # Always returns 404
    "http_500",         # Always returns 500
    "empty_body",       # Returns 200 with empty body
    "non_json",         # Returns 200 with text/plain "OK"
    "spa_html_200",     # Returns 200 with full HTML SPA shell
    "slow",             # Delays response by N seconds, then 200 {}
    "down",             # Returns 503 immediately (simulates connection refused at app level)
}

SPA_HTML = """<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Stigix</title></head>
<body><div id="root"></div><script src="/assets/index.js"></script></body>
</html>"""


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

        # nominal_minimal — return contextual minimal responses
        return _nominal_response(path, request.method)

    return app


# ---------------------------------------------------------------------------
# Nominal minimal responses (just enough structure to pass tool parsing)
# ---------------------------------------------------------------------------

def _nominal_response(path: str, method: str) -> JSONResponse:
    """Return a minimal but structurally valid response for common Stigix API paths."""

    # Connectivity / DEM
    if "connectivity/stats" in path:
        return JSONResponse({"globalHealth": 85, "avgResponseTime": 42.0, "probeCount": 3})
    if "connectivity/custom" in path:
        return JSONResponse({"targets": [
            {"name": "Test Probe", "type": "HTTP", "target": "https://example.com", "enabled": True, "id": "test-probe-1"}
        ]})
    if "connectivity/results" in path:
        return JSONResponse({"results": []})
    if "connectivity/test" in path:
        return JSONResponse({"results": [
            {"name": "Test Probe", "status": "success", "httpCode": 200, "latency_ms": 42.0}
        ]})

    # Controller
    if "controller/status" in path:
        return JSONResponse({"is_leader": False, "leader_ip": "192.168.203.100", "local_instances": []})
    if "controller/peers" in path:
        return JSONResponse([])

    # Provisioning
    if "provisioning/status" in path:
        return JSONResponse({"success": True, "provisioning_enabled": True, "appliedRevisions": {}})
    if "provisioning/history" in path:
        return JSONResponse({"success": True, "history": []})
    if "provisioning/publish" in path:
        return JSONResponse({"success": True, "published": {"revision": 1}})
    if "provisioning/purge" in path:
        return JSONResponse({"success": True, "dry_run": True, "message": "Nothing to purge", "result": {}})
    if "provisioning/rollback" in path:
        return JSONResponse({"success": True, "message": "Rollback applied"})
    if "provisioning/mode" in path:
        return JSONResponse({"success": True, "provisioning_enabled": True})

    # Network
    if "network/traceroute" in path:
        return JSONResponse({"success": True, "target": "1.1.1.1", "hops": [], "destination_reached": False, "total_hops": 0})
    if "network/public-ip" in path:
        return JSONResponse({"public_ip": "203.0.113.1"})

    # Traffic
    if "traffic/status" in path or "traffic/stats" in path:
        return JSONResponse({"success": True, "enabled": False, "stats": {}})
    if "traffic/rate" in path:
        return JSONResponse({"success": True, "rate": 1.0})
    if "traffic/logs" in path:
        return JSONResponse({"success": True, "logs": []})
    if "traffic/clients" in path:
        return JSONResponse({"success": True, "client_count": 1})

    # Voice
    if "voice/status" in path or "voice/stats" in path:
        return JSONResponse({"success": True, "enabled": False, "stats": {}})
    if "voice/ingress" in path:
        return JSONResponse({"success": True, "calls": []})

    # Diagnostics
    if "diagnostics" in path:
        return JSONResponse({"success": True, "diagnostics": {}})

    # Status / health
    if "status" in path:
        return JSONResponse({"success": True, "status": "ok"})

    # Node info
    if "node/info" in path or "info" in path:
        return JSONResponse({"success": True, "version": "2.0.62-test"})

    # Apps
    if "apps" in path and method == "GET":
        return JSONResponse({"success": True, "applications": []})
    if "apps/config" in path:
        return JSONResponse({"success": True, "config": {}})

    # Security
    if "security" in path:
        return JSONResponse({"success": True, "results": []})

    # VyOS
    if "vyos" in path:
        return JSONResponse({"success": True, "routers": [], "scenarios": [], "timeline": []})

    # Speedtest
    if "speedtest" in path:
        return JSONResponse({"success": True, "history": []})

    # Convergence
    if "convergence" in path:
        return JSONResponse({"success": True, "history": []})

    # Fabric targets
    if "targets" in path and "fabric" in path:
        return JSONResponse({"success": True, "targets": []})
    if "targets" in path:
        return JSONResponse({"success": True, "targets": []})

    # Custom TCP Apps
    if "tcp-apps" in path or "custom-tcp" in path:
        return JSONResponse({"success": True, "apps": []})

    # Prisma flows
    if "prisma" in path or "flows" in path:
        return JSONResponse({"success": True, "flows": []})

    # Health matrix
    if "health" in path:
        return JSONResponse({"success": True, "matrix": {}})

    # Impairments
    if "impairment" in path:
        return JSONResponse({"success": True, "impairments": []})

    # Generic fallback
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
