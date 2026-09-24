#!/usr/bin/env python3
"""
Test Suite for Lot A — Stigix Convergence Metrics & Build Info Refactor.
Validates P1, P2, P3, P8, P10 against real responses and fixtures from deployed build.
"""

import json
import os
import sys
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from src.types import ConvMetrics, compute_conv_verdict, TestStatus
from src.lib.orchestrator import TestOrchestrator

FIXTURES_PATH = os.path.join(os.path.dirname(__file__), "fixtures", "real", "convergence_fixtures.json")


@pytest.fixture
def real_fixtures():
    with open(FIXTURES_PATH) as f:
        return json.load(f)


class TestLotAConvMetrics:
    """Validate P1, P2, P3, P8, P10 against real responses."""

    def test_p1_running_conv_metrics_t20s_real_payload(self, real_fixtures):
        """P1: Verify CONV-0249 running at T+20s has loss_percent=0.0 (not None), in-flight uplink=0.1, verdict=PERFECT."""
        running_raw = real_fixtures["raw_daemon_conv_0249_running"]
        metrics = ConvMetrics.from_daemon(running_raw)

        # loss_percent must be 0.0 (float), NOT None
        assert metrics.loss_percent == 0.0
        assert metrics.loss_pct == 0.0
        assert metrics.sent == 866.0
        assert metrics.received == 865.0
        assert metrics.latency_ms == 8.11
        assert metrics.jitter_ms == 3.2
        assert metrics.duration_s == 19.7
        assert metrics.max_blackout_ms == 0.0
        assert metrics.verdict == "PERFECT"
        assert metrics.egress_path is None
        # Directional loss reflects 1 packet in-flight at T+20s
        assert metrics.uplink_loss_pct == 0.1
        assert metrics.tx_loss_pct == 0.1
        assert metrics.downlink_loss_pct == 0.0
        assert metrics.rx_loss_pct == 0.0

    def test_p1_verdict_calculation_thresholds(self):
        """P1 & P3: Single verdict function validation across all thresholds."""
        assert compute_conv_verdict(None) is None
        assert compute_conv_verdict("") is None
        assert compute_conv_verdict(0) == "PERFECT"
        assert compute_conv_verdict(380) == "GOOD"
        assert compute_conv_verdict(999) == "GOOD"
        assert compute_conv_verdict(1000) == "DEGRADED"
        assert compute_conv_verdict(4999) == "DEGRADED"
        assert compute_conv_verdict(5000) == "BAD"
        assert compute_conv_verdict(8859) == "BAD"
        assert compute_conv_verdict(9999) == "BAD"
        assert compute_conv_verdict(10000) == "CRITICAL"
        assert compute_conv_verdict(11742) == "CRITICAL"

    def test_p2_finished_conv_0248_history_real_payload(self, real_fixtures):
        """P2: Verify CONV-0248 real history response captures tx=1.2, rx=2.0, loss=3.1, verdict=BAD, egress."""
        finished_raw = real_fixtures["raw_daemon_conv_0248_history"]
        metrics = ConvMetrics.from_daemon(finished_raw)

        assert metrics.sent == 14981.0
        assert metrics.received == 14512.0
        assert metrics.loss_percent == 3.1
        assert metrics.uplink_loss_pct == 1.2
        assert metrics.downlink_loss_pct == 2.0
        assert metrics.max_blackout_ms == 8859.0
        assert metrics.latency_ms == 54.08
        assert metrics.jitter_ms == 10.31
        assert metrics.duration_s == 304.7
        assert metrics.egress_path == "BR8-INET2 → DC1-INET"
        assert metrics.verdict == "BAD"

        # Ensure phantom fields are no longer on the model
        assert not hasattr(metrics, "blackout_count")
        assert not hasattr(metrics, "total_blackout_ms")
        assert not hasattr(metrics, "min_latency_ms")
        assert not hasattr(metrics, "max_latency_ms")
        assert not hasattr(metrics, "min_jitter_ms")
        assert not hasattr(metrics, "max_jitter_ms")

    def test_p2_stop_test_conv_0249_real_payload(self, real_fixtures):
        """P2: Verify CONV-0249 stop_test output has 0.0% loss, egress_path=null, verdict=PERFECT."""
        stopped_raw = real_fixtures["raw_daemon_conv_0249_stopped"]
        metrics = ConvMetrics.from_daemon(stopped_raw)

        assert metrics.sent == 3283.0
        assert metrics.received == 3283.0
        assert metrics.loss_percent == 0.0
        assert metrics.uplink_loss_pct == 0.0
        assert metrics.downlink_loss_pct == 0.0
        assert metrics.max_blackout_ms == 0.0
        assert metrics.latency_ms == 8.14
        assert metrics.jitter_ms == 5.83
        assert metrics.duration_s == 70.7
        assert metrics.egress_path is None
        assert metrics.verdict == "PERFECT"

    def test_p2_legacy_finished_conv_0247(self, real_fixtures):
        """P2: Verify test CONV-0247 (11742ms blackout) gives CRITICAL verdict."""
        raw_0247 = real_fixtures["finished_conv_0247"]
        metrics = ConvMetrics.from_daemon(raw_0247)

        assert metrics.max_blackout_ms == 11742.0
        assert metrics.verdict == "CRITICAL"
        assert metrics.egress_path == "BR8-INET2 → DC1-INET"
        assert metrics.loss_percent == 1.1

    def test_p3_cross_tool_schema_coherence(self, real_fixtures):
        """P3: TestStatus and history dump for finished CONV-0248 must have identical metrics."""
        finished_raw = real_fixtures["finished_conv_0248"]
        metrics_obj = ConvMetrics.from_daemon(finished_raw)
        dumped = metrics_obj.model_dump()

        status = TestStatus(
            test_id="G-20260924-EFC7",
            local_id="CONV-0248",
            status="finished",
            source_id="BR8",
            target_id="DC1",
            metrics=metrics_obj,
        )
        status_dump = status.model_dump()

        assert status_dump["metrics"]["loss_percent"] == dumped["loss_percent"] == 3.1
        assert status_dump["metrics"]["loss_pct"] == dumped["loss_pct"] == 3.1
        assert status_dump["metrics"]["uplink_loss_pct"] == dumped["uplink_loss_pct"] == 1.2
        assert status_dump["metrics"]["downlink_loss_pct"] == dumped["downlink_loss_pct"] == 2.0
        assert status_dump["metrics"]["latency_ms"] == dumped["latency_ms"] == 54.08
        assert status_dump["metrics"]["avg_rtt_ms"] == dumped["avg_rtt_ms"] == 54.08
        assert status_dump["metrics"]["verdict"] == dumped["verdict"] == "BAD"
        assert status_dump["metrics"]["egress_path"] == dumped["egress_path"] == "BR8-INET2 → DC1-INET"

    def test_p8_null_convention_for_unknowns(self):
        """P8: Unknown or empty fields must normalize to None (null), not empty string."""
        raw_empty = {
            "sent": 100,
            "received": 100,
            "loss_pct": "",
            "egress_path": "",
            "verdict": "",
            "max_blackout_ms": None,
        }
        metrics = ConvMetrics.from_daemon(raw_empty)
        assert metrics.loss_percent is None
        assert metrics.egress_path is None
        assert metrics.verdict is None
        assert metrics.max_blackout_ms is None

    def test_p10_build_info_traceability(self):
        """P10: Build info helper must provide git_commit and build_date."""
        orchestrator = TestOrchestrator()
        build_info = orchestrator.get_build_info()

        assert "version" in build_info
        assert "git_commit" in build_info
        assert "build_date" in build_info
        assert build_info["version"] != ""
        assert build_info["git_commit"] != ""
        assert build_info["build_date"] != ""
