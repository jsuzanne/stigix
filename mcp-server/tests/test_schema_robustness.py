#!/usr/bin/env python3
"""
Automated Test Suite: FastMCP Output Schema Robustness Contract
Validates that orchestrator tools always return structured dicts matching output schemas
across all failure/fallback paths (404, 500, empty body, HTML SPA, timeouts, connection drops).
"""

import sys
import os
import asyncio
from unittest.mock import AsyncMock, patch, MagicMock
import httpx

# Add mcp-server root to path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from src.lib.orchestrator import TestOrchestrator
from src.types import StigixEndpoint


async def run_tests():
    print("=================================================================")
    print(" 🛡️  FastMCP Output Schema & Error Path Robustness Test Suite")
    print("=================================================================")

    orchestrator = TestOrchestrator()

    # Mock an agent endpoint in registry
    mock_agent = StigixEndpoint(
        id="mock-node",
        kind="fabric",
        role="both",
        api_base_url="http://127.0.0.1:8080"
    )
    orchestrator.registry.get_endpoint = AsyncMock(return_value=mock_agent)
    orchestrator.registry.list_endpoints = AsyncMock(return_value=[mock_agent])

    tests_run = 0
    tests_passed = 0

    def assert_dict_result(tool_name: str, scenario: str, result: any):
        nonlocal tests_run, tests_passed
        tests_run += 1
        if not isinstance(result, dict):
            print(f"❌ [{tool_name}] {scenario}: FAILED - Expected dict, got {type(result)}: {result}")
            return False
        if "error" not in result and "success" not in result and "status" not in result:
            print(f"❌ [{tool_name}] {scenario}: FAILED - Missing standard status keys in dict: {result}")
            return False
        print(f"✅ [{tool_name}] {scenario}: PASSED ({result.get('status') or 'ok'})")
        tests_passed += 1
        return True

    # -------------------------------------------------------------------------
    # 1. Test 404 Not Found (Old Build / Missing Endpoint)
    # -------------------------------------------------------------------------
    print("\n--- Testing Scenario 1: HTTP 404 (Missing Endpoint / Older Node Build) ---")
    mock_404_resp = httpx.Response(
        status_code=404,
        headers={"content-type": "application/json"},
        json={"error": "Not Found"},
        request=httpx.Request("GET", "http://127.0.0.1:8080/api/network/traceroute")
    )
    with patch("httpx.AsyncClient.get", new_callable=AsyncMock) as mock_get:
        mock_get.return_value = mock_404_resp

        res = await orchestrator.run_path_trace("mock-node", "1.1.1.1")
        assert_dict_result("run_path_trace", "HTTP 404 Unsupported fallback", res)
        if res.get("status") != "unsupported":
            print(f"   ⚠️ Expected status 'unsupported', got {res.get('status')}")

    # -------------------------------------------------------------------------
    # 2. Test 500 Internal Server Error
    # -------------------------------------------------------------------------
    print("\n--- Testing Scenario 2: HTTP 500 (Internal Server Error) ---")
    mock_500_resp = httpx.Response(
        status_code=500,
        headers={"content-type": "application/json"},
        json={"success": False, "error": "Internal Error"},
        request=httpx.Request("GET", "http://127.0.0.1:8080/api/network/traceroute")
    )
    with patch("httpx.AsyncClient.get", new_callable=AsyncMock) as mock_get:
        mock_get.return_value = mock_500_resp

        res = await orchestrator.run_path_trace("mock-node", "1.1.1.1")
        assert_dict_result("run_path_trace", "HTTP 500 error response", res)

    # -------------------------------------------------------------------------
    # 3. Test HTML SPA Fallback (Non-JSON 200 response)
    # -------------------------------------------------------------------------
    print("\n--- Testing Scenario 3: HTML SPA Fallback Body ---")
    mock_html_resp = httpx.Response(
        status_code=200,
        headers={"content-type": "text/html; charset=utf-8"},
        text="<!DOCTYPE html><html><head><title>Stigix</title></head><body><div id='root'></div></body></html>",
        request=httpx.Request("GET", "http://127.0.0.1:8080/api/provisioning/history")
    )
    with patch("httpx.AsyncClient.get", new_callable=AsyncMock) as mock_get:
        mock_get.return_value = mock_html_resp

        res = await orchestrator.get_provisioning_history("mock-node")
        assert_dict_result("get_provisioning_history", "HTML SPA Body non-JSON", res)

    # -------------------------------------------------------------------------
    # 4. Test Network Timeout Exception (asyncio.TimeoutError / httpx.TimeoutException)
    # -------------------------------------------------------------------------
    print("\n--- Testing Scenario 4: Connection Timeout Exception ---")
    with patch("httpx.AsyncClient.get", side_effect=httpx.ReadTimeout("Read timed out")):
        res = await orchestrator.run_path_trace("mock-node", "1.1.1.1")
        assert_dict_result("run_path_trace", "httpx.ReadTimeout", res)

    # -------------------------------------------------------------------------
    # 5. Test Connection Refused / Network Drop
    # -------------------------------------------------------------------------
    print("\n--- Testing Scenario 5: Connection Refused Exception ---")
    with patch("httpx.AsyncClient.get", side_effect=httpx.ConnectError("Connection refused")):
        res = await orchestrator.get_provisioning_status("mock-node")
        assert_dict_result("get_provisioning_status", "httpx.ConnectError", res)

    # -------------------------------------------------------------------------
    # 6. Test Provisioning History Normalization (Older format with diffs -> compact)
    # -------------------------------------------------------------------------
    print("\n--- Testing Scenario 6: Provisioning History Counter Normalization ---")
    old_build_history_resp = httpx.Response(
        status_code=200,
        headers={"content-type": "application/json"},
        json={
            "success": True,
            "history": [
                {
                    "timestamp": "2026-09-23T18:00:00Z",
                    "action": "publish",
                    "type": "connectivity-probes",
                    "revision": 20,
                    "checksum": "a1b2c3d4e5f6",
                    "summary": { "added": 7, "modified": 0, "removed": 0 },
                    "diff": { "added": ["p1", "p2", "p3", "p4", "p5", "p6", "p7"], "modified": [], "removed": [] }
                }
            ]
        },
        request=httpx.Request("GET", "http://127.0.0.1:8080/api/provisioning/history")
    )
    with patch("httpx.AsyncClient.get", new_callable=AsyncMock) as mock_get:
        mock_get.return_value = old_build_history_resp

        res = await orchestrator.get_provisioning_history("mock-node", summary_only=True)
        assert_dict_result("get_provisioning_history", "Compact history normalization", res)
        entry = res.get("history", [{}])[0]
        if entry.get("addedCount") == 7:
            print(f"   ✅ Correctly parsed addedCount = {entry.get('addedCount')}")
            tests_passed += 1
            tests_run += 1
        else:
            print(f"   ❌ FAILED: Expected addedCount = 7, got {entry.get('addedCount')}")
            tests_run += 1

    # -------------------------------------------------------------------------
    # 7. Test Non-Leader Publish Guard
    # -------------------------------------------------------------------------
    print("\n--- Testing Scenario 7: Non-Leader Publish Guard ---")
    orchestrator.get_controller_status = AsyncMock(return_value={"is_leader": False, "leader_ip": "192.168.203.100"})
    res = await orchestrator.publish_configuration_bundle("mock-node", "connectivity-probes")
    assert_dict_result("publish_configuration_bundle", "Non-leader reject guard", res)
    if res.get("status") == "rejected":
        print(f"   ✅ Successfully rejected non-leader publish with status='rejected'")
        tests_passed += 1
        tests_run += 1
    else:
        print(f"   ❌ FAILED: Expected status='rejected', got {res.get('status')}")
        tests_run += 1

    # -------------------------------------------------------------------------
    # Summary
    # -------------------------------------------------------------------------
    print("\n=================================================================")
    print(f" 🏁 Test Results: {tests_passed}/{tests_run} assertions passed.")
    print("=================================================================")

    if tests_passed == tests_run:
        print("🎉 ALL FASTMCU OUTPUT SCHEMA CONTRACT TESTS PASSED!")
        return 0
    else:
        print("💥 SOME TESTS FAILED!")
        return 1


if __name__ == "__main__":
    exit_code = asyncio.run(run_tests())
    sys.exit(exit_code)
