#!/usr/bin/env python3
"""
MCP Nominal Test Suite — Phase 2

For every tool that has 'nominal_args' in the manifest, calls the tool
against a 'nominal' mock node and validates:
1. Response is a structured dict
2. No 'error' key (or error is None/absent)
3. At least one expected_key is present in the response (when declared)
4. Response time within timeout_class budget
5. Response size within size_budget_kb
"""

import logging
import os
import sys
from typing import Any, Dict, List

import pytest
import yaml

sys.path.insert(0, os.path.dirname(__file__))
from mcp_harness import ToolCallResult, _timeout_class_to_ms
from report_generator import generate_reports

logger = logging.getLogger(__name__)

MANIFEST_PATH = os.path.join(os.path.dirname(__file__), "tools_manifest.yaml")

# Collect results for scorecard
_nominal_results: List[Dict[str, Any]] = []


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _load_manifest() -> Dict[str, dict]:
    with open(MANIFEST_PATH) as f:
        return yaml.safe_load(f).get("tools", {})


def _build_nominal_params() -> List[pytest.param]:
    """Build parametrize list from manifest entries that have nominal_args."""
    manifest = _load_manifest()
    params = []
    for tool_name, entry in sorted(manifest.items()):
        nominal_args = entry.get("nominal_args")
        if nominal_args is None:
            continue  # Skip tools without nominal_args
        if entry.get("skip_nominal"):
            # State-dependent tool: still register a skipped param so it appears in the report
            reason = entry.get("skip_reason", "skip_nominal=true in tools_manifest.yaml")
            params.append(pytest.param(
                tool_name,
                nominal_args,
                entry.get("expected_keys", []),
                entry.get("timeout_class", "fast"),
                entry.get("size_budget_kb", 20),
                id=tool_name,
                marks=pytest.mark.skip(reason=reason),
            ))
            continue
        params.append(pytest.param(
            tool_name,
            nominal_args,
            entry.get("expected_keys", []),
            entry.get("timeout_class", "fast"),
            entry.get("size_budget_kb", 20),
            id=tool_name,
        ))
    return params


# ---------------------------------------------------------------------------
# Nominal contract test (parametrized per tool)
# ---------------------------------------------------------------------------

class TestNominal:
    """Every tool with nominal_args must pass the happy-path contract."""

    @pytest.mark.parametrize(
        "tool_name,nominal_args,expected_keys,timeout_class,size_budget_kb",
        _build_nominal_params(),
    )
    def test_nominal_call(
        self,
        tool_name: str,
        nominal_args: dict,
        expected_keys: list,
        timeout_class: str,
        size_budget_kb: float,
        harness,
        mock_admin,
    ):
        """Call each tool with nominal_args against a nominal mock and validate response."""
        # Ensure mock is in nominal mode
        mock_admin.set_mode("nominal")

        timeout_ms = _timeout_class_to_ms(timeout_class)
        result: ToolCallResult = harness.call_tool(tool_name, nominal_args, timeout_ms=timeout_ms)

        checks = []
        details = {}

        # --- Check 1: Response is a dict ---
        is_dict = isinstance(result.parsed, dict)
        checks.append({"check": "is_dict", "pass": is_dict,
                       "detail": f"type={type(result.parsed).__name__}" if not is_dict else None})

        # --- Check 2: No error key (or error is None/absent) ---
        error_present = False
        error_val = None
        if isinstance(result.parsed, dict):
            error_val = result.parsed.get("error")
            error_present = (error_val is not None)
        checks.append({"check": "no_error", "pass": not error_present,
                       "detail": f"error={error_val!r}" if error_present else None})

        # --- Check 3: At least one expected key present ---
        has_expected = True
        missing_keys = []
        if expected_keys and isinstance(result.parsed, dict):
            found = [k for k in expected_keys if k in result.parsed]
            if not found:
                has_expected = False
                missing_keys = expected_keys
        checks.append({"check": "expected_keys", "pass": has_expected,
                       "detail": f"none of {missing_keys} in response" if not has_expected else None})

        # --- Check 4: Response time ---
        time_ok = result.elapsed_ms <= timeout_ms + 500
        checks.append({"check": "response_time", "pass": time_ok,
                       "detail": f"{result.elapsed_ms:.0f}ms > {timeout_ms}ms" if not time_ok else None})

        # --- Check 5: Response size ---
        size_ok = result.size_bytes <= size_budget_kb * 1024
        checks.append({"check": "response_size", "pass": size_ok,
                       "detail": f"{result.size_bytes}B > {size_budget_kb}KB" if not size_ok else None})

        all_pass = all(c["pass"] for c in checks)

        _nominal_results.append({
            "tool_name": tool_name,
            "phase": "nominal",
            "pass": all_pass,
            "checks": checks,
            "elapsed_ms": result.elapsed_ms,
            "size_bytes": result.size_bytes,
        })

        # Log failures for visibility
        failing = [c for c in checks if not c["pass"]]
        if failing:
            details_str = "; ".join(f"{c['check']}: {c.get('detail', '')}" for c in failing)
            logger.warning(f"[NOMINAL][{tool_name}] FAILED: {details_str}")

        # Assert — all checks must pass for a nominal call
        failing_checks = [c["check"] for c in checks if not c["pass"]]
        assert not failing_checks, (
            f"Nominal call to '{tool_name}' failed checks: {failing_checks}\n"
            f"Response: {str(result.parsed)[:400]}"
        )


# ---------------------------------------------------------------------------
# Report generation (session-scoped finalizer)
# ---------------------------------------------------------------------------

@pytest.fixture(scope="session", autouse=True)
def generate_nominal_scorecard(request):
    """Generate nominal test scorecard after all tests complete."""
    yield
    if _nominal_results:
        report_dir = os.path.join(os.path.dirname(__file__), "reports")
        os.makedirs(report_dir, exist_ok=True)

        import json
        from datetime import datetime, timezone

        ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
        json_path = os.path.join(report_dir, f"nominal_report_{ts}.json")
        with open(json_path, "w") as f:
            json.dump({"generated_at": ts, "results": _nominal_results}, f, indent=2)

        ok = sum(1 for r in _nominal_results if r["pass"])
        ko = len(_nominal_results) - ok
        print(f"\n{'='*60}")
        print(f"📊 Nominal Test Report: {json_path}")
        print(f"✅ PASS: {ok}/{len(_nominal_results)}  ❌ FAIL: {ko}/{len(_nominal_results)}")
        print(f"{'='*60}")
