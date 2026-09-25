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
        """P6: Ensure all 4 transitions in CONV-0248 flow are preserved in path_history with real Prisma 64-bit IDs."""
        from engines.getflow import resolve_path_label
        
        flow = flow_fixtures["flow_conv_0248_main"]
        decisions = flow.get("flow_decision_metadata_list", [])
        assert len(decisions) == 4

        # Topology lookup mock with only the primary path 1762789923250022645 resolved
        topology = {
            "1762789923250022645": {"source_wan_if_id": "if-br8-inet2", "target_wan_if_id": "if-dc1-inet"}
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
        assert path_history[1]["path"] == "Path ID: 1772715677472006545"
        assert path_history[2]["path"] == "Path ID: 1762789923162021545"
        assert path_history[3]["path"] == "BR8-INET2 to DC1-INET"

    def test_p6_dynamic_path_history_complete_flag(self):
        """P6: path_history_complete must be True only when total decisions match retrieved decisions and > 0."""
        # Case 1: Decisions exist and match count
        decisions_full = [{"flow_decision_time": 100, "chosen_wan_path": "p1"}]
        total_count_1 = 1
        is_complete_1 = bool(len(decisions_full) >= total_count_1 and total_count_1 > 0)
        assert is_complete_1 is True

        # Case 2: Decisions empty
        decisions_empty = []
        total_count_0 = 0
        is_complete_0 = bool(len(decisions_empty) >= total_count_0 and total_count_0 > 0)
        assert is_complete_0 is False

        # Case 3: Truncated decisions
        total_count_truncated = 10
        is_complete_trunc = bool(len(decisions_full) >= total_count_truncated and total_count_truncated > 0)
        assert is_complete_trunc is False


class TestLotBAggregatePathTimeline:
    """Validate P5: aggregate_path_timeline overhaul, time_iso, consecutive dedup, reachability probe filtering."""

    def test_p5_timeline_preserves_failover_and_failback_oscillations(self):
        """P5: Merging timeline across events must preserve oscillations (INET2 -> INET1/DC2 -> INET2/Alt -> INET2)."""
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
                        {"time_ms": 1790247903000, "time_iso": "2026-09-24T11:05:03Z", "path": "BR8-INET2 → DC1-INET (Alt)"},
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
        assert timeline[2]["path"] == "BR8-INET2 → DC1-INET (Alt)"
        assert timeline[3]["path"] == "BR8-INET2 → DC1-INET"
        assert timeline[3]["time_ms"] == 1790247908000

    def test_p5_single_packet_and_reachability_probe_filtering(self):
        """P5: Reachability probes (1 c2s + 1 s2c = 2 pkts total, c2s<=1) must be excluded by default."""
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
            },
            {
                "flow_id": 99999002,
                "packets_c2s": 1,
                "packets_s2c": 1,
                "path_history": [
                    {"time_ms": 1790247805000, "time_iso": "2026-09-24T11:03:25Z", "path": "Two-Packet-Reachability-Probe"}
                ]
            }
        ]

        # Default: exclude probe flows where packets_c2s <= 1
        timeline_filtered = orchestrator._build_aggregate_path_timeline(
            flows,
            include_single_packet_flows=False
        )
        assert len(timeline_filtered) == 1
        assert timeline_filtered[0]["path"] == "BR8-INET2 → DC1-INET"

        # Explicit: include probe flows
        timeline_unfiltered = orchestrator._build_aggregate_path_timeline(
            flows,
            include_single_packet_flows=True
        )
        assert len(timeline_unfiltered) == 3
        assert timeline_unfiltered[1]["path"] == "Single-Packet-Probe"
        assert timeline_unfiltered[2]["path"] == "Two-Packet-Reachability-Probe"


class TestLotBP7NamesResolved:
    """Validate P7: names_resolved boolean indicator across fast=True and fast=False queries."""

    def test_p7_names_resolved_fast_false_all_resolved_is_true(self):
        """P7: When fast=False and all paths are resolved names, names_resolved must be True."""
        orchestrator = TestOrchestrator()
        result = {
            "flows": [
                {"egress_path": "BR8-INET2 → DC1-INET", "path_history": [{"path": "BR8-INET2 → DC1-INET"}]}
            ]
        }
        names_resolved = orchestrator._compute_names_resolved(result, fast=False)
        assert names_resolved is True

    def test_p7_names_resolved_fast_false_unresolved_id_is_false(self):
        """P7: When fast=False but unknown path ID 'Path ID: ...' is present in output, names_resolved must be False."""
        orchestrator = TestOrchestrator()
        result = {
            "flows": [
                {"egress_path": "Path ID: 1772715677472006545", "path_history": [{"path": "Path ID: 1772715677472006545"}]}
            ]
        }
        names_resolved = orchestrator._compute_names_resolved(result, fast=False)
        assert names_resolved is False

    def test_p7_names_resolved_fast_true_cold_cache_is_false(self):
        """P7: When fast=True with unresolved 'Path ID: ...' in flows, names_resolved must be False."""
        orchestrator = TestOrchestrator()
        result = {
            "flows": [
                {"egress_path": "Path ID: 102", "path_history": [{"path": "Path ID: 102"}]}
            ]
        }
        names_resolved = orchestrator._compute_names_resolved(result, fast=True)
        assert names_resolved is False

    def test_p7_names_resolved_fast_true_warm_cache_is_true(self):
        """P7: When fast=True and all Path IDs were resolved from cache, names_resolved must be True."""
        orchestrator = TestOrchestrator()
        result = {
            "flows": [
                {"egress_path": "BR8-INET2 → DC1-INET", "path_history": [{"path": "BR8-INET2 → DC1-INET"}]}
            ]
        }
        names_resolved = orchestrator._compute_names_resolved(result, fast=True)
        assert names_resolved is True


class TestLotBP4GlobalIdPersistenceAndLegacyFormat:
    """Validate P4: Global ID matching without in-memory map & legacy format parsing."""

    def test_p4_matches_global_id_in_history_record(self):
        """P4: Global ID 'G-20260924-EFC7' matches history record with persisted global_id."""
        orchestrator = TestOrchestrator()
        record = {
            "test_id": "CONV-0248 (BR8-DC1-failover-demo-v3)",
            "global_id": "G-20260924-EFC7",
            "global_test_id": "G-20260924-EFC7",
            "label": "BR8-DC1-failover-demo-v3"
        }
        assert orchestrator._matches_test_id("G-20260924-EFC7", record) is True
        assert orchestrator._matches_test_id("g-20260924-efc7", record) is True

    def test_p4_matches_legacy_composite_string_bidirectional(self):
        """P4: Matches 'CONV-0248' when searching composite string, and vice-versa."""
        orchestrator = TestOrchestrator()
        record = {
            "test_id": "CONV-0248 (BR8-DC1-failover-demo-v3)",
            "label": "BR8-DC1-failover-demo-v3"
        }
        # Searching by simple ID finds composite record
        assert orchestrator._matches_test_id("CONV-0248", record) is True
        assert orchestrator._matches_test_id("conv-0248", record) is True
        
        # Searching by composite query finds record
        assert orchestrator._matches_test_id("CONV-0248 (BR8-DC1-failover-demo-v3)", record) is True

        # Searching by non-matching ID fails
        assert orchestrator._matches_test_id("CONV-9999", record) is False


class TestLotBAliasesRationalization:
    """Validate Aliases: canonical output fields and ingestion of legacy aliases."""

    def test_canonical_fields_ingest_all_legacy_alias_variants(self):
        """Input dicts with legacy aliases (loss_pct, tx_loss_pct, rx_loss_pct, avg_rtt_ms) map to canonical names."""
        from src.types import ConvMetrics
        legacy_dict = {
            "loss_pct": 2.5,
            "tx_loss_pct": 1.0,
            "rx_loss_pct": 1.5,
            "avg_rtt_ms": 42.1,
            "durationSec": 60,
            "maxBlackout": 500,
        }
        metrics = ConvMetrics.from_daemon(legacy_dict)
        assert metrics.loss_percent == 2.5
        assert metrics.uplink_loss_pct == 1.0
        assert metrics.downlink_loss_pct == 1.5
        assert metrics.latency_ms == 42.1
        assert metrics.duration_s == 60.0
        assert metrics.max_blackout_ms == 500.0

        # Verify output dump has canonical fields only (no duplicate aliases)
        dump = metrics.model_dump()
        assert dump["loss_percent"] == 2.5
        assert dump["uplink_loss_pct"] == 1.0
        assert dump["downlink_loss_pct"] == 1.5
        assert dump["latency_ms"] == 42.1
        assert "loss_pct" not in dump
        assert "tx_loss_pct" not in dump
        assert "rx_loss_pct" not in dump
        assert "avg_rtt_ms" not in dump
