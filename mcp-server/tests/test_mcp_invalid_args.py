#!/usr/bin/env python3
"""
MCP Invalid Args Test Suite — Phase 2

For every tool that has 'invalid_args' in the manifest, verifies that:
1. The response is always a dict (never crashes to non-dict)
2. If an 'error' key is present, it is never empty/None
3. Injection strings in text fields are not reflected in command/execution fields
4. The server session remains healthy after each invalid call
"""

import logging
import os
import sys
from typing import Any, Dict, List, Tuple

import pytest
import yaml

sys.path.insert(0, os.path.dirname(__file__))
from mcp_harness import ToolCallResult

logger = logging.getLogger(__name__)

MANIFEST_PATH = os.path.join(os.path.dirname(__file__), "tools_manifest.yaml")

# Shell injection characters that must not appear in command/execution fields
INJECTION_CHARS = [";", "$", "`", "&&", "||", "|", "<", ">"]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _load_manifest() -> Dict[str, dict]:
    with open(MANIFEST_PATH) as f:
        return yaml.safe_load(f).get("tools", {})


def _build_invalid_params() -> List[pytest.param]:
    """Build parametrize list from manifest entries that have invalid_args."""
    manifest = _load_manifest()
    params = []
    for tool_name, entry in sorted(manifest.items()):
        invalid_args_list = entry.get("invalid_args", [])
        if not invalid_args_list:
            continue
        for idx, bad_args in enumerate(invalid_args_list):
            # Create a short identifier from the args
            arg_label = "_".join(
                f"{k}={str(v)[:15]}"
                for k, v in (bad_args or {}).items()
                if k != "agent_id"
            ) or f"set{idx}"
            # Sanitize label for pytest ID
            label = f"{tool_name}-{arg_label}".replace(" ", "_").replace("/", "_")
            label = "".join(c for c in label if c.isalnum() or c in "-_")
            params.append(pytest.param(
                tool_name,
                bad_args or {},
                idx,
                id=label[:80],
            ))
    return params


def _extract_injection_candidates(args: dict) -> List[Tuple[str, str]]:
    """Return (field_name, value) pairs that contain injection characters."""
    candidates = []
    for k, v in args.items():
        if isinstance(v, str):
            for char in INJECTION_CHARS:
                if char in v:
                    candidates.append((k, v))
                    break
    return candidates


def _response_reflects_injection(response_str: str, injection_str: str) -> bool:
    """
    Return True if the injection string appears to be reflected in an
    execution context (command/cmd/shell fields), not just in an error message.
    """
    # We're lenient: error messages may quote the input for validation purposes.
    # We only flag if injection chars appear in command-execution fields.
    return False  # Evaluated per-field below


# ---------------------------------------------------------------------------
# Invalid args contract test (parametrized)
# ---------------------------------------------------------------------------

class TestInvalidArgs:
    """
    All tools with invalid_args must return a structured dict regardless of input.
    Injection strings must never be reflected in execution contexts.
    """

    @pytest.mark.parametrize(
        "tool_name,bad_args,arg_set_index",
        _build_invalid_params(),
    )
    def test_invalid_args_contract(
        self,
        tool_name: str,
        bad_args: dict,
        arg_set_index: int,
        harness,
        mock_admin,
        canary_admin,
    ):
        """Call a tool with invalid/injection args and verify safe handling."""
        mock_admin.set_mode("nominal")

        result: ToolCallResult = harness.call_tool(
            tool_name,
            bad_args,
            timeout_ms=30_000,
        )

        checks = []

        # --- Check 1: Response is a dict ---
        is_dict = isinstance(result.parsed, dict)
        checks.append({
            "check": "is_dict",
            "pass": is_dict,
            "detail": f"type={type(result.parsed).__name__}" if not is_dict else None,
        })

        # --- Check 2: Error is never empty ---
        error_empty = False
        if isinstance(result.parsed, dict) and "error" in result.parsed:
            error_val = result.parsed["error"]
            error_empty = (error_val == "" or error_val is None)
        checks.append({
            "check": "error_not_empty",
            "pass": not error_empty,
            "detail": f"error={result.parsed.get('error')!r}" if error_empty and is_dict else None,
        })

        # --- Check 3: Injection not reflected in command fields ---
        injection_candidates = _extract_injection_candidates(bad_args)
        injection_reflected = False
        injection_detail = None

        if injection_candidates and is_dict:
            # Check sensitive fields that could represent shell commands
            command_fields = ["command", "cmd", "shell", "exec", "script", "cli"]
            for field in command_fields:
                field_val = str(result.parsed.get(field, ""))
                if not field_val:
                    continue
                for _, inj_str in injection_candidates:
                    for char in INJECTION_CHARS:
                        if char in inj_str and char in field_val:
                            injection_reflected = True
                            injection_detail = (
                                f"Injection char '{char}' from field value '{inj_str}' "
                                f"found in response field '{field}': {field_val[:100]}"
                            )
                            break
                    if injection_reflected:
                        break
                if injection_reflected:
                    break

        checks.append({
            "check": "injection_not_reflected",
            "pass": not injection_reflected,
            "detail": injection_detail,
        })

        # --- Check 4: Session health after invalid call ---
        canary_admin.set_mode("nominal")
        health = harness.health_probe()
        health_ok = (
            isinstance(health.parsed, dict) and
            health.parsed.get("error") is None and
            not health.is_error
        )
        checks.append({
            "check": "session_health",
            "pass": health_ok,
            "detail": f"health_probe: {health.parsed}" if not health_ok else None,
        })

        # Log failures
        failing = [c for c in checks if not c["pass"]]
        if failing:
            details_str = "; ".join(f"{c['check']}: {c.get('detail', '')}" for c in failing)
            logger.warning(
                f"[INVALID][{tool_name}][set{arg_set_index}] FAILED: {details_str}"
            )

        # Assert
        failing_checks = [(c["check"], c.get("detail", "")) for c in checks if not c["pass"]]
        assert not failing_checks, (
            f"Invalid args test for '{tool_name}' (set {arg_set_index}) "
            f"failed checks: {failing_checks}\n"
            f"Args: {bad_args}\n"
            f"Response: {str(result.parsed)[:400]}"
        )


# ---------------------------------------------------------------------------
# Direct injection regression for high-risk tools
# ---------------------------------------------------------------------------

class TestHighRiskInjection:
    """
    Direct injection tests for the tools identified as highest-risk
    for shell injection: run_path_trace, run_security_probe.
    """

    INJECTION_TARGETS = [
        ("run_path_trace", {"agent_id": "mock-primary", "target": "1.1.1.1; id"},
         "semicolon_id"),
        ("run_path_trace", {"agent_id": "mock-primary", "target": "$(whoami)"},
         "dollar_subshell"),
        ("run_path_trace", {"agent_id": "mock-primary", "target": "`uname -a`"},
         "backtick_subshell"),
        ("run_security_probe", {"agent_id": "mock-primary", "probe_type": "dns",
                                "target": "'; DROP TABLE domains; --"},
         "sql_injection"),
        ("run_security_probe", {"agent_id": "mock-primary", "probe_type": "url",
                                "target": "javascript:alert(document.cookie)"},
         "js_injection"),
    ]

    @pytest.mark.parametrize(
        "tool_name,args,label",
        INJECTION_TARGETS,
        ids=[t[2] for t in INJECTION_TARGETS],
    )
    def test_high_risk_injection(
        self,
        tool_name: str,
        args: dict,
        label: str,
        harness,
        mock_admin,
    ):
        """
        High-risk tools with injection inputs must return a safe structured response.
        """
        mock_admin.set_mode("nominal")

        result: ToolCallResult = harness.call_tool(
            tool_name,
            args,
            timeout_ms=60_000,
        )

        # Must return dict
        assert isinstance(result.parsed, dict), (
            f"[{label}] {tool_name} returned non-dict: {type(result.parsed)}"
        )

        # Must not crash the session
        health = harness.health_probe()
        assert isinstance(health.parsed, dict) and not health.is_error, (
            f"[{label}] Session health failed after {tool_name} injection test"
        )

        # Log the response for audit
        logger.info(
            f"[{label}] {tool_name} response to injection: "
            f"error={result.parsed.get('error')!r}, "
            f"success={result.parsed.get('success')!r}"
        )
