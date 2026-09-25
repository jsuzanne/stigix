import os
import sys
import pytest
import asyncio
from unittest.mock import AsyncMock, patch, MagicMock
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import bridge
from src.lib.registry import RegistryClient
from src.types import StigixEndpoint

class TestBridgeRetryPolicy:
    def test_read_only_vs_mutating_classification(self):
        # Read-only tools MUST return True
        assert bridge.is_read_only_tool("get_prisma_flows") is True
        assert bridge.is_read_only_tool("get_vyos_router_state") is True
        assert bridge.is_read_only_tool("get_convergence_history") is True
        assert bridge.is_read_only_tool("list_speedtest_history") is True
        assert bridge.is_read_only_tool("get_test_status") is True
        assert bridge.is_read_only_tool("run_path_trace") is True

        # Mutating / dangerous tools MUST return False (NEVER retry)
        assert bridge.is_read_only_tool("vyos_execute_action") is False
        assert bridge.is_read_only_tool("vyos_bulk_reset") is False
        assert bridge.is_read_only_tool("run_test") is False
        assert bridge.is_read_only_tool("stop_test") is False
        assert bridge.is_read_only_tool("set_traffic_status") is False
        assert bridge.is_read_only_tool("publish_configuration_bundle") is False

    @pytest.mark.asyncio
    async def test_read_only_tool_retries_once_on_session_drop(self):
        manager = bridge.SSEConnectionManager("http://mock-mesh/sse")
        
        # Mock session that fails once with connection error, then succeeds on reconnect
        session1 = MagicMock()
        session1.call_tool = AsyncMock(side_effect=RuntimeError("ClosedResourceError: session closed due to inactivity"))
        
        session2 = MagicMock()
        success_result = MagicMock()
        session2.call_tool = AsyncMock(return_value=success_result)
        
        call_count = 0
        async def mock_get_session():
            nonlocal call_count
            call_count += 1
            return session1 if call_count == 1 else session2

        manager.get_session = AsyncMock(side_effect=mock_get_session)
        manager.handle_disconnect = AsyncMock()

        # Execute retry-wrapped call
        res = await bridge.execute_tool_with_retry(
            manager,
            tool_name="get_prisma_flows",
            arguments={"agent_id": "BR8-Ubuntu"},
            timeout_sec=10.0
        )
        assert res == success_result
        assert call_count == 2
        manager.handle_disconnect.assert_called_once()

    @pytest.mark.asyncio
    async def test_mutating_tool_never_retries_on_session_drop(self):
        manager = bridge.SSEConnectionManager("http://mock-mesh/sse")
        
        session = MagicMock()
        session.call_tool = AsyncMock(side_effect=RuntimeError("ClosedResourceError"))
        manager.get_session = AsyncMock(return_value=session)
        manager.handle_disconnect = AsyncMock()

        res = await bridge.execute_tool_with_retry(
            manager,
            tool_name="vyos_execute_action",
            arguments={"agent_id": "BR8-Ubuntu", "command": "interface-down"},
            timeout_sec=10.0
        )
        # Should NOT retry, should return error result
        assert res.isError is True
        assert "ClosedResourceError" in res.content[0].text
        assert session.call_tool.call_count == 1
        manager.handle_disconnect.assert_called_once()


class TestRegistryAgentResolution:
    @pytest.mark.asyncio
    async def test_resolves_reg_self_and_reg_shared_prefixes(self):
        registry = RegistryClient()
        br8_ep = StigixEndpoint(
            id="BR8-Ubuntu",
            kind="fabric",
            role="both",
            capabilities=["xfr", "convergence"],
            test_ip="192.168.1.154",
            api_base_url="http://192.168.1.154:8080",
            meta={"site_name": "BR8-Ubuntu"}
        )
        with patch.object(registry, "list_endpoints", AsyncMock(return_value=[br8_ep])):
            # Exact
            assert (await registry.get_endpoint("BR8-Ubuntu")) == br8_ep
            # reg-self- prefix
            assert (await registry.get_endpoint("reg-self-BR8-Ubuntu")) == br8_ep
            # target- prefix
            assert (await registry.get_endpoint("target-BR8-Ubuntu")) == br8_ep
            # reg-shared- prefix
            assert (await registry.get_endpoint("reg-shared-BR8-Ubuntu")) == br8_ep

    @pytest.mark.asyncio
    async def test_cached_endpoints_used_when_discovery_fails(self):
        registry = RegistryClient()
        cached_ep = StigixEndpoint(
            id="BR8-Ubuntu",
            kind="fabric",
            role="both",
            capabilities=["xfr"],
            test_ip="192.168.1.154",
            api_base_url="http://192.168.1.154:8080",
            meta={"site_name": "BR8-Ubuntu"}
        )
        registry._cached_endpoints = [cached_ep]
        registry._cached_at = 9999999999.0

        # Simulate discovery failure
        with patch("httpx.AsyncClient.get", side_effect=RuntimeError("Connection timeout to :8080")):
            endpoints = await registry.list_endpoints()
            assert len(endpoints) == 1
            assert endpoints[0].id == "BR8-Ubuntu"
