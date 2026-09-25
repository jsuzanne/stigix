import os
import sys
import pytest
from unittest.mock import AsyncMock, patch, MagicMock
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from src.lib.orchestrator import TestOrchestrator
from src.types import StigixEndpoint, ConvMetrics

class TestConvergenceFixesPoint3And5:
    @pytest.mark.asyncio
    async def test_get_convergence_history_includes_running_tests(self):
        orchestrator = TestOrchestrator()
        endpoint = StigixEndpoint(
            id="BR8-Ubuntu",
            kind="fabric",
            role="both",
            capabilities=["convergence"],
            test_ip="192.168.1.154",
            api_base_url="http://192.168.1.154:8080",
            meta={"site_name": "BR8-Ubuntu"}
        )
        orchestrator.registry.get_endpoint = AsyncMock(return_value=endpoint)

        # Mock status returning an active running test
        running_test_payload = [{
            "testId": "0252",
            "test_id": "CONV-0252 (DC1-Ubuntu)",
            "label": "DC1-Ubuntu",
            "running": True,
            "status": "running",
            "target": "192.168.201.10",
            "source_port": 30252,
            "sent": 120,
            "received": 118,
            "loss_pct": 1.6,
            "max_blackout_ms": 0.0,
            "timestamp": 1790268000000
        }]

        # Mock history returning finished test CONV-0251
        finished_test_payload = [{
            "test_id": "CONV-0251 (DC1-Ubuntu)",
            "label": "DC1-Ubuntu",
            "timestamp": 1790267429825,
            "path_evolution": "BR8-INET2 → DC1-INET ➔ BR8-INET1 → DC2-INET",
            "sent": 10189.0,
            "server_received": 9949.0,
            "received": 9722.0,
            "loss_percent": 4.6,
            "uplink_loss_pct": 2.4,
            "downlink_loss_pct": 2.3,
            "tx_loss_ms": 4800.0,
            "rx_loss_ms": 4540.0,
            "max_blackout_ms": 9270.0,
            "latency_ms": 13.95,
            "jitter_ms": 4.38,
            "duration_s": 208.8,
            "egress_path": "BR8-INET1 → DC2-INET",
            "verdict": "BAD"
        }]

        async def mock_get(url, headers=None):
            resp = MagicMock()
            resp.status_code = 200
            resp.raise_for_status = MagicMock()
            if "/api/convergence/status" in url:
                resp.json.return_value = running_test_payload
            elif "/api/convergence/history" in url:
                resp.json.return_value = finished_test_payload
            else:
                resp.json.return_value = []
            return resp

        with patch("httpx.AsyncClient.get", side_effect=mock_get):
            res = await orchestrator.get_convergence_history(agent_id="BR8-Ubuntu", limit=10)
            assert res.get("count") == 2
            history = res.get("history", [])
            assert len(history) == 2

            # Check Running Test (first in list)
            running_item = history[0]
            assert running_item["local_id"] == "CONV-0252"
            assert running_item["label"] == "DC1-Ubuntu"
            assert running_item["running"] is True
            assert running_item["status"] == "running"
            assert running_item["source_port"] == 30252
            assert "testId" not in running_item  # No duplicate testId

            # Check Finished Test CONV-0251
            finished_item = history[1]
            assert finished_item["local_id"] == "CONV-0251"
            assert finished_item["label"] == "DC1-Ubuntu"
            assert finished_item["source_port"] == 30251  # Derived or extracted
            assert finished_item["path_evolution"] == "BR8-INET2 → DC1-INET ➔ BR8-INET1 → DC2-INET"
            assert finished_item["echo_received"] == 9949.0
            assert finished_item["uplink_loss_ms"] == 4800.0
            assert finished_item["downlink_loss_ms"] == 4540.0
            assert finished_item["verdict"] == "BAD"
            assert "testId" not in finished_item

    def test_conv_metrics_from_daemon_ingests_echo_and_loss_ms(self):
        daemon_payload = {
            "sent": 10189.0,
            "server_received": 9949.0,
            "received": 9722.0,
            "loss_percent": 4.6,
            "uplink_loss_pct": 2.4,
            "downlink_loss_pct": 2.3,
            "tx_loss_ms": 4800.0,
            "rx_loss_ms": 4540.0,
            "max_blackout_ms": 9270.0,
            "latency_ms": 13.95,
            "jitter_ms": 4.38,
            "duration_s": 208.8,
            "egress_path": "BR8-INET1 → DC2-INET"
        }
        metrics = ConvMetrics.from_daemon(daemon_payload)
        dump = metrics.model_dump()
        assert dump["echo_received"] == 9949.0
        assert dump["uplink_loss_ms"] == 4800.0
        assert dump["downlink_loss_ms"] == 4540.0
        assert dump["verdict"] == "BAD"
