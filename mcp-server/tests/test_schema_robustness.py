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
        if "error" not in result and "success" not in result and "status" not in result and "is_leader" not in result and "local_instances" not in result and "agent_id" not in result:
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
    with patch.object(orchestrator, "get_controller_status", new_callable=AsyncMock) as mock_ctrl:
        mock_ctrl.return_value = {"is_leader": False, "leader_ip": "192.168.203.100"}
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
    # 8. Test Malicious Traceroute Target Injection Rejection
    # -------------------------------------------------------------------------
    print("\n--- Testing Scenario 8: Malicious Target Command Injection Handling ---")
    mock_400_injection = httpx.Response(
        status_code=400,
        headers={"content-type": "application/json"},
        json={"success": False, "error": "Invalid target format. Target must be a valid IPv4, IPv6 address, or hostname without shell or special characters."},
        request=httpx.Request("GET", "http://127.0.0.1:8080/api/network/traceroute?target=1.1.1.1%3B+id")
    )
    with patch("httpx.AsyncClient.get", new_callable=AsyncMock) as mock_get:
        mock_get.return_value = mock_400_injection

        res = await orchestrator.run_path_trace("mock-node", "1.1.1.1; id")
        assert_dict_result("run_path_trace", "Malicious target injection 400 rejection", res)

    # -------------------------------------------------------------------------
    # 9. Test Purge Stale Leader (Dry-Run Simulation)
    # -------------------------------------------------------------------------
    print("\n--- Testing Scenario 9: Purge Stale Leader Dry-Run Simulation ---")
    mock_purge_resp = httpx.Response(
        status_code=200,
        headers={"content-type": "application/json"},
        json={
            "success": True,
            "dry_run": True,
            "message": "[DRY-RUN] Found 2 stale bundles and 12 revisions to purge.",
            "result": { "cleared_bundles": 2, "cleared_revisions": 12, "stale_revisions_list": ["connectivity-probes/rev-1.json"] }
        },
        request=httpx.Request("POST", "http://127.0.0.1:8080/api/provisioning/purge-stale-leader?dry_run=true")
    )
    with patch("httpx.AsyncClient.post", new_callable=AsyncMock) as mock_post:
        mock_post.return_value = mock_purge_resp

        res = await orchestrator.purge_stale_leader_state("mock-node", dry_run=True)
        assert_dict_result("purge_stale_leader_state", "Dry-run simulation", res)
        if res.get("dry_run") is True:
            print(f"   ✅ Dry-run confirmed: {res.get('message')}")
            tests_passed += 1
            tests_run += 1
        else:
            print(f"   ❌ FAILED: Expected dry_run=True, got {res.get('dry_run')}")
            tests_run += 1

    # -------------------------------------------------------------------------
    # 10. Test Traceroute Method & Port Parameters
    # -------------------------------------------------------------------------
    print("\n--- Testing Scenario 10: Traceroute TCP Method and Custom Port ---")
    mock_tcp_trace_resp = httpx.Response(
        status_code=200,
        headers={"content-type": "application/json"},
        json={
            "success": True,
            "target": "1.1.1.1",
            "method": "tcp",
            "port": 443,
            "destination_reached": True,
            "total_hops": 3,
            "hops": [
                {"hop": 1, "ip": "192.168.219.254", "rtt_ms": 1.2, "status": "reached"},
                {"hop": 2, "ip": "10.0.0.1", "rtt_ms": 8.4, "status": "reached"},
                {"hop": 3, "ip": "1.1.1.1", "rtt_ms": 14.1, "status": "reached"}
            ]
        },
        request=httpx.Request("GET", "http://127.0.0.1:8080/api/network/traceroute?target=1.1.1.1&max_hops=15&method=tcp&port=443")
    )
    with patch("httpx.AsyncClient.get", new_callable=AsyncMock) as mock_get:
        mock_get.return_value = mock_tcp_trace_resp

        res = await orchestrator.run_path_trace("mock-node", "1.1.1.1", method="tcp", port=443)
        assert_dict_result("run_path_trace", "TCP traceroute method & port", res)
        if res.get("method") == "tcp" and res.get("port") == 443:
            print(f"   ✅ TCP method and port 443 verified in output")
            tests_passed += 1
            tests_run += 1
        else:
            print(f"   ❌ FAILED: method={res.get('method')}, port={res.get('port')}")
            tests_run += 1

    # -------------------------------------------------------------------------
    # 11. Test get_controller_status summary_only Payload Pruning
    # -------------------------------------------------------------------------
    print("\n--- Testing Scenario 11: Controller Status Summary Only Payload Pruning ---")
    mock_controller_resp = httpx.Response(
        status_code=200,
        headers={"content-type": "application/json"},
        json={
            "is_leader": True,
            "local_instances": [
                {
                    "node": "DC1-Ubuntu",
                    "provisioning_status": {
                        "appliedRevisions": {"connectivity-probes": 20},
                        "history": [{"rev": 1, "diff": ["huge", "diff", "array"] * 100}]
                    }
                }
            ]
        },
        request=httpx.Request("GET", "http://127.0.0.1:8080/api/controller/status")
    )
    with patch("httpx.AsyncClient.get", new_callable=AsyncMock) as mock_get:
        mock_get.return_value = mock_controller_resp

        res = await orchestrator.get_controller_status("mock-node", summary_only=True)
        assert_dict_result("get_controller_status", "summary_only=True payload trimming", res)
        prov_status = res.get("local_instances", [{}])[0].get("provisioning_status", {})
        if "history" not in prov_status:
            print(f"   ✅ Large history successfully stripped in summary_only mode")
            tests_passed += 1
            tests_run += 1
        else:
            print(f"   ❌ FAILED: history was not pruned in summary_only mode")
            tests_run += 1

    # -------------------------------------------------------------------------
    # 12. Test get_dem_probe_stats: Shared Target URLs segregation (NEVER match by URL)
    # -------------------------------------------------------------------------
    print("\n--- Testing Scenario 12: Probes Sharing Same URL Must NOT Mix Samples ---")
    mock_custom_probes = [
        {"name": "Microsoft 365 Login", "type": "HTTP", "target": "https://login.microsoftonline.com/", "expectedStatusCodes": [200, 302, 403]},
        {"name": "MS - Entra ID", "type": "HTTP", "target": "https://login.microsoftonline.com/", "expectedStatusCodes": [200, 302]},
        {"name": "Core DNS", "type": "DNS", "target": "1.1.1.1"}
    ]
    mock_results_samples = [
        {"endpointName": "Microsoft 365 Login", "endpointId": "microsoft-365-login", "url": "https://login.microsoftonline.com/", "httpCode": 403, "metrics": {"total_ms": 42.5}, "success": True},
        {"endpointName": "Microsoft 365 Login", "endpointId": "microsoft-365-login", "url": "https://login.microsoftonline.com/", "httpCode": 403, "metrics": {"total_ms": 44.1}, "success": True},
        {"endpointName": "MS - Entra ID", "endpointId": "ms---entra-id", "url": "https://login.microsoftonline.com/", "httpCode": 200, "metrics": {"total_ms": 28.3}, "success": True},
    ]
    
    async def mock_router(url: str, *args, **kwargs):
        url_str = str(url)
        if "/api/connectivity/stats" in url_str:
            return httpx.Response(200, json={"globalHealth": 70, "avgResponseTime": 35.0}, request=httpx.Request("GET", url_str))
        elif "/api/connectivity/results" in url_str:
            return httpx.Response(200, json={"results": mock_results_samples}, request=httpx.Request("GET", url_str))
        elif "/api/connectivity/custom" in url_str:
            return httpx.Response(200, json={"targets": mock_custom_probes}, request=httpx.Request("GET", url_str))
        return httpx.Response(404, json={}, request=httpx.Request("GET", url_str))

    with patch("httpx.AsyncClient.get", side_effect=mock_router):
        res = await orchestrator.get_dem_probe_stats("mock-node", aggregate=True)
        assert_dict_result("get_dem_probe_stats", "Shared target URL probe separation", res)
        
        probes_summary = {p["name"]: p for p in res.get("probes_summary", [])}
        m365 = probes_summary.get("Microsoft 365 Login")
        entra = probes_summary.get("MS - Entra ID")
        dns_probe = probes_summary.get("Core DNS")

        tests_run += 1
        if m365 and m365.get("samples_count") == 2 and m365.get("success_count") == 2:
            print(f"   ✅ 'Microsoft 365 Login' samples segregated correctly (count=2, success=2)")
            tests_passed += 1
        else:
            print(f"   ❌ FAILED: 'Microsoft 365 Login' samples mixed: {m365}")

        tests_run += 1
        if entra and entra.get("samples_count") == 1 and entra.get("success_count") == 1:
            print(f"   ✅ 'MS - Entra ID' samples segregated correctly (count=1, success=1)")
            tests_passed += 1
        else:
            print(f"   ❌ FAILED: 'MS - Entra ID' samples mixed: {entra}")

        # Test 0 samples returning None for success_rate_pct and non-HTTP omitting expected_status_codes
        tests_run += 1
        if dns_probe and dns_probe.get("samples_count") == 0 and dns_probe.get("success_rate_pct") is None and "expected_status_codes" not in dns_probe:
            print(f"   ✅ 0-sample DNS probe: success_rate_pct is None and expected_status_codes omitted")
            tests_passed += 1
        else:
            print(f"   ❌ FAILED: DNS probe schema validation failed: {dns_probe}")

        # Global stats source alignment
        tests_run += 1
        if res.get("global_stats", {}).get("globalHealth") == 70:
            print(f"   ✅ global_stats aligns with get_dem_summary (globalHealth=70)")
            tests_passed += 1
        else:
            print(f"   ❌ FAILED: global_stats missing or incorrect: {res.get('global_stats')}")

    # -------------------------------------------------------------------------
    # 13. Test update_dem_probe: layer reporting ('local_override' vs 'global')
    # -------------------------------------------------------------------------
    print("\n--- Testing Scenario 13: update_dem_probe Layer Reporting ---")
    mock_overridden_probe = [
        {"name": "MS - Azure Portal", "type": "HTTP", "target": "https://portal.azure.com", "expectedStatusCodes": [200], "_source": "overridden", "_wasGlobal": True}
    ]
    with patch("httpx.AsyncClient.get", new_callable=AsyncMock) as mock_get, \
         patch("httpx.AsyncClient.post", new_callable=AsyncMock) as mock_post:
        
        mock_get.return_value = httpx.Response(200, json={"targets": mock_overridden_probe}, request=httpx.Request("GET", "http://127.0.0.1:8080/api/connectivity/custom"))
        mock_post.return_value = httpx.Response(200, json={"success": True}, request=httpx.Request("POST", "http://127.0.0.1:8080/api/connectivity/custom"))

        res = await orchestrator.update_dem_probe("mock-node", "MS - Azure Portal", expected_status_codes=[200, 301, 302, 403])
        assert_dict_result("update_dem_probe", "Local override layer reporting", res)
        tests_run += 1
        if res.get("layer") == "local_override":
            print(f"   ✅ Correctly reported layer='local_override' for overridden probe")
            tests_passed += 1
        else:
            print(f"   ❌ FAILED: Expected layer='local_override', got '{res.get('layer')}'")

    # -------------------------------------------------------------------------
    # 14. Test publish_configuration_bundle on Leader with local override probe
    # -------------------------------------------------------------------------
    print("\n--- Testing Scenario 14: Leader Publish Bundle with Override ---")
    mock_publish_resp = httpx.Response(
        status_code=200,
        headers={"content-type": "application/json"},
        json={
            "success": True,
            "published": {
                "type": "connectivity-probes",
                "revision": 25,
                "items_count": 1,
                "payload": [
                    {
                        "name": "MS - Azure Portal",
                        "type": "HTTP",
                        "target": "https://portal.azure.com",
                        "expectedStatusCodes": [200, 301, 302, 403]
                    }
                ]
            },
            "manifest": {"connectivity-probes": {"revision": 25, "checksum": "deadbeef1234"}}
        },
        request=httpx.Request("POST", "http://127.0.0.1:8080/api/provisioning/publish/connectivity-probes")
    )
    with patch.object(orchestrator, "get_controller_status", new_callable=AsyncMock) as mock_ctrl, \
         patch("httpx.AsyncClient.post", new_callable=AsyncMock) as mock_post:
        
        mock_ctrl.return_value = {"is_leader": True}
        mock_post.return_value = mock_publish_resp

        res = await orchestrator.publish_configuration_bundle("mock-node", "connectivity-probes")
        assert_dict_result("publish_configuration_bundle", "Leader publish bundle with override", res)
        tests_run += 1
        published_payload = res.get("published", {}).get("payload", [])
        azure_portal_probe = next((p for p in published_payload if p.get("name") == "MS - Azure Portal"), None)
        if azure_portal_probe and azure_portal_probe.get("expectedStatusCodes") == [200, 301, 302, 403]:
            print(f"   ✅ Published bundle includes updated expectedStatusCodes on Leader override")
            tests_passed += 1
        else:
            print(f"   ❌ FAILED: Expected expectedStatusCodes in published payload: {azure_portal_probe}")

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

