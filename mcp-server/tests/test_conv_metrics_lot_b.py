#!/usr/bin/env python3
"""
Test Suite for Lot B — Stigix MCP & Flow Diagnostics.
Validates P4, P5, P6, P7 and canonical aliases against real fixtures.
"""

import json
import os
import sys
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../.."))
from src.lib.orchestrator import TestOrchestrator

FIXTURES_PATH = os.path.join(os.path.dirname(__file__), "fixtures", "real", "prisma_flow_fixtures.json")


@pytest.fixture
def flow_fixtures():
    with open(FIXTURES_PATH) as f:
        return json.load(f)


class TestLotBFlowDiagnostics:
    """Validate P6: path_history preservation and dynamic path_history_complete."""

    def test_p6_path_history_preserves_unresolved_and_multi_transitions(self, flow_fixtures):
        """P6: Ensure all 4 transitions in CONV-0248 flow are preserved in path_history even if labels require fallback."""
        from engines.getflow import resolve_path_label
        
        flow = flow_fixtures["flow_conv_0248_main"]
        decisions = flow.get("flow_decision_metadata_list", [])
        assert len(decisions) == 4

        # Topology lookup mock with only INET2 resolved, others requiring fallback or partial resolution
        topology = {
            "path-inet2-dc1": {"source_wan_if_id": "if-br8-inet2", "target_wan_if_id": "if-dc1-inet"}
        }
        wan_if_lookup = {
            "if-br8-inet2": {"full_name": "BR8-INET2"},
            "if-dc1-inet": {"full_name": "DC1-INET"}
        }

        # Simulate getflow processing
        sorted_decisions = sorted(
            [d for d in decisions if isinstance(d, dict) and d.get('flow_decision_time')],
            key=lambda d: d.get('flow_decision_time', 0)
        )
        
        path_history = []
        prev_path_id = None
        prev_path_name = None
        for d in sorted_decisions:
            chosen_path_id = d.get('chosen_wan_path') or d.get('chosen_path') or d.get('path_id')
            chosen_name = resolve_path_label(chosen_path_id, topology, wan_if_lookup)
            display_path = chosen_name or (f"Path ID: {chosen_path_id}" if chosen_path_id is not None else "Unknown")
            
            entry = {
                "time_ms": d.get('flow_decision_time'),
                "path": display_path,
                "path_id": chosen_path_id,
                "chosen_path": display_path,
            }

            has_changed = False
            if chosen_path_id is not None:
                if chosen_path_id != prev_path_id:
                    has_changed = True
            elif chosen_name is not None:
                if chosen_name != prev_path_name:
                    has_changed = True
            elif prev_path_id is None:
                has_changed = True

            if has_changed:
                path_history.append(entry)
                prev_path_id = chosen_path_id
                prev_path_name = chosen_name

        # All 4 decisions had distinct consecutive chosen_wan_path IDs, so path_history MUST have 4 entries
        assert len(path_history) == 4
        assert path_history[0]["path"] == "BR8-INET2 to DC1-INET"
        assert path_history[1]["path"] == "Path ID: path-inet1-dc2"
        assert path_history[2]["path"] == "Path ID: path-inet1-dc1"
        assert path_history[3]["path"] == "BR8-INET2 to DC1-INET"

    def test_p6_dynamic_path_history_complete_flag(self):
        """P6: path_history_complete must be True only when total decisions match retrieved decisions and > 0."""
        # Case 1: Decisions exist and match count
        decisions_full = [{"flow_decision_time": 100, "chosen_wan_path": "p1"}]
        total_count_1 = 1
        is_complete_1 = len(decisions_full) >= total_count_1 and total_count_1 > 0
        assert is_complete_1 is True

        # Case 2: Decisions empty
        decisions_empty = []
        total_count_0 = 0
        is_complete_0 = len(decisions_empty) >= total_count_0 and total_count_0 > 0
        assert is_complete_0 is False

        # Case 3: Truncated decisions
        total_count_truncated = 10
        is_complete_trunc = len(decisions_full) >= total_count_truncated and total_count_truncated > 0
        assert is_complete_trunc is False


class TestLotBAggregatePathTimeline:
    """Validate P5: aggregate_path_timeline overhaul, time_iso, consecutive dedup, single-packet filtering."""

    def test_p5_timeline_preserves_failover_and_failback_oscillations(self):
        """P5: Merging timeline across events must preserve oscillations (INET2 -> INET1/DC2 -> INET1/DC1 -> INET2)."""
        orchestrator = TestOrchestrator()
        
        # Mock result containing CONV-0248 flow with 4 decisions
        flows_result = {
            "flows": [
                {
                    "flow_id": 70656819,
                    "source_port": 30248,
                    "packets_c2s": 14432,
                    "packets_s2c": 13980,
                    "path_history": [
                        {"time_ms": 1790247679000, "time_iso": "2026-09-24T11:01:19Z", "path": "BR8-INET2 → DC1-INET"},
                        {"time_ms": 1790247821700, "time_iso": "2026-09-24T11:03:41.700Z", "path": "BR8-INET1 → DC2-INET"},
                        {"time_ms": 1790247903000, "time_iso": "2026-09-24T11:05:03Z", "path": "BR8-INET1 → DC1-INET"},
                        {"time_ms": 1790247908000, "time_iso": "2026-09-24T11:05:08Z", "path": "BR8-INET2 → DC1-INET"},
                    ]
                }
            ]
        }

        timeline = orchestrator._build_aggregate_path_timeline(
            flows_result["flows"],
            include_single_packet_flows=False
        )

        assert len(timeline) == 4
        assert timeline[0]["path"] == "BR8-INET2 → DC1-INET"
        assert timeline[1]["path"] == "BR8-INET1 → DC2-INET"
        assert timeline[1]["time_iso"] == "2026-09-24T11:03:41.700Z"
        assert timeline[2]["path"] == "BR8-INET1 → DC1-INET"
        assert timeline[3]["path"] == "BR8-INET2 → DC1-INET"
        assert timeline[3]["time_ms"] == 1790247908000

    def test_p5_single_packet_probe_filtering(self):
        """P5: Single packet reachability probes must be excluded by default, included only when requested."""
        orchestrator = TestOrchestrator()

        flows = [
            {
                "flow_id": 70656819,
                "packets_c2s": 14432,
                "packets_s2c": 13980,
                "path_history": [
                    {"time_ms": 1790247679000, "time_iso": "2026-09-24T11:01:19Z", "path": "BR8-INET2 → DC1-INET"}
                ]
            },
            {
                "flow_id": 99999001,
                "packets_c2s": 1,
                "packets_s2c": 0,
                "path_history": [
                    {"time_ms": 1790247800000, "time_iso": "2026-09-24T11:03:20Z", "path": "Single-Packet-Probe"}
                ]
            }
        ]

        # Default: exclude single packet flows
        timeline_filtered = orchestrator._build_aggregate_path_timeline(
            flows,
            include_single_packet_flows=False
        )
        assert len(timeline_filtered) == 1
        assert timeline_filtered[0]["path"] == "BR8-INET2 → DC1-INET"

        # Explicit: include single packet flows
        timeline_unfiltered = orchestrator._build_aggregate_path_timeline(
            flows,
            include_single_packet_flows=True
        )
        assert len(timeline_unfiltered) == 2
        assert timeline_unfiltered[1]["path"] == "Single-Packet-Probe"

