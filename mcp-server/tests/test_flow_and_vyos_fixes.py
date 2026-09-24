import os
import sys
import pytest
from unittest.mock import AsyncMock, patch, MagicMock
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from src.lib.orchestrator import TestOrchestrator
from src.types import StigixEndpoint

class TestFlowAndVyosFixes:
    @pytest.mark.asyncio
    async def test_vyos_execute_action_returns_commit_timestamp(self):
        orchestrator = TestOrchestrator()
        endpoint = StigixEndpoint(
            id="BR8-Ubuntu",
            kind="fabric",
            role="both",
            capabilities=["vyos"],
            test_ip="192.168.1.154",
            api_base_url="http://192.168.1.154:8080",
            meta={"site_name": "BR8-Ubuntu"}
        )
        orchestrator.registry.get_endpoint = AsyncMock(return_value=endpoint)

        async def mock_post(url, json=None, headers=None):
            resp = MagicMock()
            resp.status_code = 200
            resp.content = b'{"success": true}'
            resp.json.return_value = {"success": True}
            resp.raise_for_status = MagicMock()
            return resp

        async def mock_get(url, headers=None):
            resp = MagicMock()
            resp.status_code = 200
            resp.json.return_value = [{
                "timestamp": "2026-09-24T16:34:00.123Z",
                "timestamp_ms": 1790267640123,
                "cli_equivalent": "set interfaces ethernet eth1 disable"
            }]
            resp.raise_for_status = MagicMock()
            return resp

        async def mock_delete(url, headers=None):
            resp = MagicMock()
            resp.status_code = 200
            resp.raise_for_status = MagicMock()
            return resp

        with patch("httpx.AsyncClient.post", side_effect=mock_post), \
             patch("httpx.AsyncClient.get", side_effect=mock_get), \
             patch("httpx.AsyncClient.delete", side_effect=mock_delete):
            res = await orchestrator.vyos_execute_adhoc(
                agent_id="BR8-Ubuntu",
                router_id="VYOS-DC1",
                command="interface-down",
                interface="eth1"
            )
            assert res.get("success") is True
            assert res.get("commit_timestamp") == "2026-09-24T16:34:00.123Z"
            assert res.get("commit_timestamp_ms") == 1790267640123
            assert res.get("cli_equivalent") == "set interfaces ethernet eth1 disable"

    @pytest.mark.asyncio
    async def test_get_prisma_flows_forward_body_and_doc(self):
        orchestrator = TestOrchestrator()
        endpoint = StigixEndpoint(
            id="BR8-Ubuntu",
            kind="fabric",
            role="both",
            capabilities=["prisma"],
            test_ip="192.168.1.154",
            api_base_url="http://192.168.1.154:8080",
            meta={"site_name": "BR8-Ubuntu"}
        )
        orchestrator.registry.get_endpoint = AsyncMock(return_value=endpoint)

        captured_body = {}
        async def mock_post(url, json=None, headers=None):
            nonlocal captured_body
            captured_body = json
            resp = MagicMock()
            resp.status_code = 200
            resp.json.return_value = {"flows": []}
            resp.raise_for_status = MagicMock()
            return resp

        with patch("httpx.AsyncClient.post", side_effect=mock_post):
            res = await orchestrator.query_prisma_flows(
                agent_id="BR8-Ubuntu",
                body={
                    "site_name": "BR8",
                    "udp_src_port": 30251,
                    "udp_dst_port": 6200,
                    "fast": False,
                    "page_size": 20,
                    "include_single_packet_flows": True,
                    "aggregate_path_timeline": True
                }
            )
            assert res.get("names_resolved") is True
            assert captured_body.get("udp_src_port") == 30251
            assert captured_body.get("udp_dst_port") == 6200
            assert "include_single_packet_flows" not in captured_body
            assert "aggregate_path_timeline" not in captured_body
