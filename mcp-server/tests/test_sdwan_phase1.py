"""Unit tests for Phase 1 SD-WAN flow decision analysis and MCP registry/orchestrator fixes."""
import os
import sys
import pytest

# Add engines/ and mcp-server/src to sys.path
REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
ENGINES_DIR = os.path.join(REPO_ROOT, "engines")
MCP_DIR = os.path.join(REPO_ROOT, "mcp-server")
for p in (ENGINES_DIR, MCP_DIR):
    if p not in sys.path:
        sys.path.insert(0, p)

from sdwan_flow_analysis import FlowResolver, resolve_flow, summarize_resolved_flow
from src.lib.registry import StigixEndpoint, RegistryClient
from src.lib.orchestrator import TestOrchestrator


class _FakeResp:
    def __init__(self, body):
        self.cgx_content = body


class _FakeGet:
    def waninterfaces(self, site_id):
        return _FakeResp({
            "items": [
                {"id": "wan-1", "name": "INET-PRIMARY"},
                {"id": "wan-2", "name": "MPLS-BACKUP"},
            ]
        })

    def networkpolicyrules(self, set_id):
        return _FakeResp({
            "items": [
                {"id": "rule-100", "name": "Voice-Priority-Rule"},
                {"id": "rule-200", "name": "Default-Enterprise-Rule"},
            ]
        })


class _FakePost:
    def topology(self, payload):
        return _FakeResp({
            "links": [
                {
                    "path_id": "path-direct-1",
                    "type": "publicwan-stub",
                    "target_circuit_name": "INET-PRIMARY",
                    "target_wan_if_id": "wan-1",
                },
                {
                    "path_id": "path-vpn-1",
                    "type": "vpn",
                    "source_circuit_name": "INET-PRIMARY",
                    "target_site_name": "DC1",
                    "target_circuit_name": "DC1-INET-1",
                },
                {
                    "path_id": "path-vpn-2",
                    "type": "vpn",
                    "source_circuit_name": "MPLS-BACKUP",
                    "target_site_name": "DC1",
                    "target_circuit_name": "DC1-MPLS-1",
                },
            ]
        })


class _FakeSdk:
    def __init__(self):
        self.get = _FakeGet()
        self.post = _FakePost()


def test_flow_resolver_and_resolve_flow():
    sdk = _FakeSdk()
    resolver = FlowResolver(sdk, "site-br1")

    raw_flow = {
        "flow_start_time_ms": 1700000000000,
        "flow_end_time_ms": 1700000060000,
        "source_ip": "192.168.201.10",
        "source_port": 54321,
        "destination_ip": "10.99.99.2",
        "destination_port": 443,
        "protocol": 6,
        "app_id": "ssl",
        "flow_action": "allow",
        "path_type": "vpn",
        "flow_direction": "left_to_right",
        "waninterface_id": "wan-1",
        "path_id": "path-vpn-1",
        "network_policy_set_id": "set-1",
        "network_policy_id": "rule-100",
        "nat_policy_action": "snat",
        "bytes_c2s": 1200,
        "bytes_s2c": 4800,
        "packets_c2s": 10,
        "packets_s2c": 15,
        "flow_decision_metadata_list": [
            {
                "flow_decision_time": 1700000001000,
                "chosen_wan_path": "path-vpn-1",
                "preferred_wan_path": "path-vpn-1",
                "policy_allowed_wan_paths": ["path-vpn-1", "path-vpn-2", "path-direct-1"],
                "state_up_policy_allowed_wan_paths": ["path-vpn-1", "path-vpn-2"],
                "sla_filtered_state_up_policy_allowed_wan_paths": ["path-vpn-1"],
                "available_wan_networks": ["wan-1", "wan-2"],
            }
        ],
    }

    resolved = resolve_flow(raw_flow, resolver)
    summary = summarize_resolved_flow(resolved, raw_flow)

    assert resolved["protocol"] == "TCP"
    assert resolved["circuit"] == "INET-PRIMARY"
    assert resolved["path"] == "VPN: INET-PRIMARY -> DC1 (DC1-INET-1)"
    assert resolved["network_policy"] == "Voice-Priority-Rule"
    assert resolved["nat"] == {"nat_policy_action": "snat"}
    assert len(resolved["decisions"]) == 1

    assert summary["chosen_path"] == "VPN: INET-PRIMARY -> DC1 (DC1-INET-1)"
    assert summary["preferred_path"] == "VPN: INET-PRIMARY -> DC1 (DC1-INET-1)"
    assert summary["allowed_paths"] == [
        "VPN: INET-PRIMARY -> DC1 (DC1-INET-1)",
        "VPN: MPLS-BACKUP -> DC1 (DC1-MPLS-1)",
        "Direct: INET-PRIMARY",
    ]
    assert summary["usable_paths"] == [
        "VPN: INET-PRIMARY -> DC1 (DC1-INET-1)",
        "VPN: MPLS-BACKUP -> DC1 (DC1-MPLS-1)",
    ]
    assert summary["sla_filtered_paths"] == ["VPN: INET-PRIMARY -> DC1 (DC1-INET-1)"]
    assert summary["available_circuits"] == ["INET-PRIMARY", "MPLS-BACKUP"]
    assert summary["path_rule"] == "Voice-Priority-Rule"
    assert summary["application"] == "ssl"


@pytest.mark.asyncio
async def test_registry_get_endpoint_empty_and_bare_prefix_guard(monkeypatch):
    reg = RegistryClient()
    fake_endpoints = [
        StigixEndpoint(
            id="reg-self-br1",
            kind="target",
            role="both",
            api_base_url="http://192.168.201.2:8080",
            test_ip="192.168.201.2",
            public_ip="1.2.3.4",
            capabilities=[],
            meta={"site_name": "BR1"},
        ),
        StigixEndpoint(
            id="target-dc1",
            kind="target",
            role="both",
            api_base_url="http://10.99.99.2:8080",
            test_ip="10.99.99.2",
            public_ip="5.6.7.8",
            capabilities=[],
            meta={"site_name": "DC1"},
        ),
    ]

    async def _fake_list(kind=None, force_refresh=False):
        return fake_endpoints

    monkeypatch.setattr(reg, "list_endpoints", _fake_list)

    # Empty, whitespace, or bare prefix must return None, never the first endpoint
    assert await reg.get_endpoint("") is None
    assert await reg.get_endpoint("   ") is None
    assert await reg.get_endpoint("target-") is None
    assert await reg.get_endpoint("reg-self-") is None
    assert await reg.get_endpoint("reg-shared-") is None

    # Valid lookups still work across exact, prefix-stripped, and partial matches
    ep_br1 = await reg.get_endpoint("BR1")
    assert ep_br1 is not None and ep_br1.id == "reg-self-br1"

    ep_dc1 = await reg.get_endpoint("target-dc1")
    assert ep_dc1 is not None and ep_dc1.id == "target-dc1"


@pytest.mark.asyncio
async def test_orchestrator_magic_join_awaits_self_registry(monkeypatch):
    orch = TestOrchestrator()

    async def _fake_get_endpoint(identifier: str):
        return None

    monkeypatch.setattr(orch.registry, "get_endpoint", _fake_get_endpoint)

    res1 = await orch.generate_magic_join_token("nonexistent-node")
    assert res1["success"] is False and "not found" in res1["error"]

    res2 = await orch.list_magic_join_tokens("nonexistent-node")
    assert res2["success"] is False and "not found" in res2["error"]

    res3 = await orch.revoke_magic_join_token("nonexistent-node", "tok-1")
    assert res3["success"] is False and "not found" in res3["error"]

    res4 = await orch.join_cluster_via_token("nonexistent-node", "STX-abc.def")
    assert res4["success"] is False and "not found" in res4["error"]
