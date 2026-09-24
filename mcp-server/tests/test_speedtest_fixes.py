#!/usr/bin/env python3
"""
Test suite for Speedtest (XFR) Bug Fixes (Bugs 8, 9, 10).
Validated against exact BR8 live production fixtures (XFR-0904 & XFR-0905).
"""

import json
import os
import sys
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../.."))
from src.types import TestStatus
from src.lib.orchestrator import TestOrchestrator

FIXTURES_PATH = os.path.join(os.path.dirname(__file__), "fixtures", "real", "speedtest_fixtures.json")


@pytest.fixture
def xfr_fixtures():
    with open(FIXTURES_PATH) as f:
        return json.load(f)


class TestSpeedtestFixes:
    """Validate fixes for speedtest bugs 8, 9, 10 using real BR8 production captures."""

    def test_bug_8_get_test_status_preserves_xfr_metrics(self, xfr_fixtures):
        """
        Bug 8: get_test_status on XFR-0904 (BR8 live test) must preserve throughput_mbps (15.0),
        retransmits (685), latency_ms (17.1) and transfer metrics in model_dump().
        """
        job = xfr_fixtures["xfr_0904_completed"]
        summary = job["summary"]

        xfr_metrics = {
            "throughput_mbps": float(summary["throughput_mbps"]),
            "loss_percent": float(summary["loss_percent"]),
            "latency_ms": float(summary["rtt_ms_avg"]),
            "sent_mbps": float(summary["sent_mbps"]),
            "received_mbps": float(summary["received_mbps"]),
            "retransmits": int(summary["retransmits"]),
            "bytes_total": int(summary["bytes_total"]),
            "started_at": job["started_at"],
            "finished_at": job["finished_at"]
        }

        status = TestStatus(
            test_id="XFR-0904",
            local_id="XFR-0904",
            status="finished",
            source_id="br8",
            target_id="dc1",
            metrics=xfr_metrics
        )

        dumped = status.model_dump()
        assert dumped["metrics"] is not None
        assert dumped["metrics"]["throughput_mbps"] == 15.0
        assert dumped["metrics"]["retransmits"] == 685
        assert dumped["metrics"]["latency_ms"] == 17.1
        assert dumped["metrics"]["bytes_total"] == 56821350
        assert "verdict" not in dumped["metrics"]

    def test_bug_9_xfr_test_run_bitrate_never_50_pps(self):
        """
        Bug 9: run_test on XFR must report 'max' (default) or '200M' (explicit), NEVER '50 pps'.
        """
        orchestrator = TestOrchestrator()

        # Case A: Default bitrate (None or 0) for XFR -> 'max'
        bitrate_default = orchestrator._compute_display_bitrate(profile="xfr", bitrate=None, pps=None)
        assert bitrate_default == "max"

        bitrate_zero = orchestrator._compute_display_bitrate(profile="xfr", bitrate="0", pps=None)
        assert bitrate_zero == "max"

        # Case B: Custom bitrate for XFR -> '200M'
        bitrate_custom = orchestrator._compute_display_bitrate(profile="xfr", bitrate="200M", pps=None)
        assert bitrate_custom == "200M"

        # Case C: Conv test still reports pps -> '50 pps' or '100 pps'
        bitrate_conv = orchestrator._compute_display_bitrate(profile="conv", bitrate=None, pps=None)
        assert bitrate_conv == "50 pps"

        bitrate_conv_custom = orchestrator._compute_display_bitrate(profile="conv", bitrate=None, pps=100)
        assert bitrate_conv_custom == "100 pps"

    def test_bug_10_list_speedtest_history_resolves_target_from_params_host(self, xfr_fixtures):
        """
        Bug 10: list_speedtest_history must resolve target IP from job.params.host ('192.168.203.100', never '?').
        """
        job = xfr_fixtures["xfr_0904_completed"]
        orchestrator = TestOrchestrator()

        target_resolved = orchestrator._extract_xfr_target(job)
        assert target_resolved == "192.168.203.100"
        assert target_resolved != "?"
