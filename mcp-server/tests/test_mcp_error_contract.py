#!/usr/bin/env python3
"""
MCP Error Contract Test Suite — Phase 1

For every tool × every error mock mode, validates:
1. Output is always a structured dict
2. Error messages are never empty
3. Response time within timeout class
4. Response size within budget
5. Session health after every error-path call (catches session hangs)
6. Write/destructive tools with defaults don't produce unsafe side effects
"""

import json
import logging
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(__file__))
from mcp_harness import ToolCallResult, ToolEntry
from report_generator import generate_reports

logger = logging.getLogger(__name__)

MOCK_MODES = ["http_404", "http_500", "empty_body", "non_json", "spa_html_200", "slow", "down"]

# Collect all results for report generation
_all_results = []


# ---------------------------------------------------------------------------
# Parametrized error contract test
# ---------------------------------------------------------------------------

class TestErrorContract:
    """Every tool must return a structured dict with non-empty error on every failure mode."""

    @pytest.mark.parametrize("mock_mode", MOCK_MODES)
    def test_tool_error_contract(self, mock_mode, tool_entries, harness, mock_admin, canary_admin):
        """Run all tools against a single mock mode and collect results."""
        for entry in tool_entries:
            checks = []

            # Set mock mode (with capped slow delay)
            slow_delay = 3.0 if mock_mode == "slow" else 1.0
            timeout_for_call = entry.timeout_ms
            if mock_mode == "slow":
                timeout_for_call = 8_000  # 8s cap for slow tests (3s delay + margin)
            elif mock_mode == "down":
                timeout_for_call = 15_000

            mock_admin.set_mode(mock_mode, slow_delay=slow_delay)

            # Call the tool
            result = harness.call_tool(entry.name, entry.default_args, timeout_ms=timeout_for_call)

            # Check 1: Output is a dict
            is_dict = isinstance(result.parsed, dict)
            checks.append({"check": "is_dict", "pass": is_dict,
                           "detail": f"type={type(result.parsed).__name__}" if not is_dict else None})

            # Check 2: Error is never empty
            error_empty = False
            if isinstance(result.parsed, dict) and "error" in result.parsed:
                error_val = result.parsed["error"]
                error_empty = (error_val == "" or error_val is None)
            checks.append({"check": "error_not_empty", "pass": not error_empty,
                           "detail": f"error={result.parsed.get('error')!r}" if error_empty and isinstance(result.parsed, dict) else None})

            # Check 3: Response time within budget (with 500ms margin for jitter)
            time_ok = result.elapsed_ms <= timeout_for_call + 500
            checks.append({"check": "response_time", "pass": time_ok,
                           "detail": f"{result.elapsed_ms:.0f}ms > {timeout_for_call}ms" if not time_ok else None})

            # Check 4: Response size within budget
            size_ok = result.size_bytes <= entry.size_budget_kb * 1024
            checks.append({"check": "response_size", "pass": size_ok,
                           "detail": f"{result.size_bytes}B > {entry.size_budget_kb}KB" if not size_ok else None})

            # Check 5: Session health probe (canary must still work)
            canary_admin.set_mode("nominal_minimal")
            health = harness.health_probe()
            health_ok = (isinstance(health.parsed, dict) and
                        health.parsed.get("error") is None and
                        not health.is_error)
            checks.append({"check": "session_health", "pass": health_ok,
                           "detail": f"health_probe returned: {health.parsed}" if not health_ok else None})

            all_pass = all(c["pass"] for c in checks)

            test_result = {
                "tool_name": entry.name,
                "category": entry.category,
                "mock_mode": mock_mode,
                "pass": all_pass,
                "checks": checks,
                "elapsed_ms": result.elapsed_ms,
                "size_bytes": result.size_bytes,
                "error_message": str(result.parsed.get("error", ""))[:200] if isinstance(result.parsed, dict) else None,
            }
            _all_results.append(test_result)

            # Log failures but don't stop the matrix
            failing = [c for c in checks if not c["pass"]]
            if failing:
                fail_details = "; ".join(f"{c['check']}: {c.get('detail', '')}" for c in failing)
                logger.warning(f"[{entry.name}][{mock_mode}] FAILED: {fail_details}")


# ---------------------------------------------------------------------------
# Explicit regression cases
# ---------------------------------------------------------------------------

class TestRegressions:
    """Explicit regression tests for known bugs."""

    def test_run_dem_probes_now_empty_error(self, harness, mock_admin):
        """
        Regression: run_dem_probes_now must NEVER return {"error": ""}.
        Seen live on BR8 (2026-09-23) in http_500 and non_json modes.
        """
        for mode in ["http_500", "non_json"]:
            mock_admin.set_mode(mode)
            result = harness.call_tool("run_dem_probes_now", {"agent_id": "mock-primary"}, timeout_ms=30_000)

            assert isinstance(result.parsed, dict), \
                f"run_dem_probes_now in {mode}: expected dict, got {type(result.parsed)}"

            error_val = result.parsed.get("error")
            assert error_val != "", \
                f"REGRESSION: run_dem_probes_now returned empty error string in {mode} mode! Full response: {result.parsed}"

            if error_val is not None:
                assert len(str(error_val)) > 0, \
                    f"REGRESSION: error is falsy in {mode}: {error_val!r}"


# ---------------------------------------------------------------------------
# Write/destructive tools safe defaults check
# ---------------------------------------------------------------------------

class TestSafeDefaults:
    """Write/destructive tools called with default args must not produce dangerous side effects."""

    def test_write_tools_requests(self, harness, mock_admin, tool_entries):
        """Report any non-GET requests sent by write/destructive tools with default arguments."""
        write_tools = [e for e in tool_entries if e.category in ("write", "destructive")]

        mock_admin.set_mode("nominal_minimal")

        for entry in write_tools:
            mock_admin.clear_requests()
            harness.call_tool(entry.name, entry.default_args, timeout_ms=15_000)
            requests = mock_admin.get_requests()

            non_get = [r for r in requests if r["method"] != "GET"]
            if non_get:
                logger.info(
                    f"[{entry.name}] Write tool sent {len(non_get)} non-GET request(s) with default args: "
                    f"{[(r['method'], r['path']) for r in non_get]}"
                )


# ---------------------------------------------------------------------------
# Report generation (session-scoped finalizer)
# ---------------------------------------------------------------------------

@pytest.fixture(scope="session", autouse=True)
def generate_scorecard(request):
    """Generate the report after all tests complete."""
    yield
    if _all_results:
        report_dir = os.path.join(os.path.dirname(__file__), "reports")
        json_path, md_path = generate_reports(_all_results, report_dir)
        print(f"\n{'='*60}")
        print(f"📊 MCP Contract Report: {json_path}")
        print(f"📋 MCP Scorecard:       {md_path}")
        print(f"{'='*60}")

        # Print summary
        from report_generator import compute_tool_status
        by_tool = {}
        for r in _all_results:
            by_tool.setdefault(r["tool_name"], {})[r["mock_mode"]] = r

        ok = sum(1 for t in by_tool.values() if compute_tool_status(t) == "OK")
        degraded = sum(1 for t in by_tool.values() if compute_tool_status(t) == "DEGRADED")
        ko = sum(1 for t in by_tool.values() if compute_tool_status(t) == "KO")
        total = len(by_tool)

        print(f"✅ OK: {ok}/{total}  ⚠️ DEGRADED: {degraded}/{total}  ❌ KO: {ko}/{total}")

        if ko > 0:
            ko_names = [t for t, modes in by_tool.items() if compute_tool_status(modes) == "KO"]
            print(f"❌ KO tools: {', '.join(ko_names)}")
