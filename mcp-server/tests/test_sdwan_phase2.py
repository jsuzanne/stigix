"""Unit tests for Phase 2 Read-Only Prisma SD-WAN Controller Views."""
import os
import sys
import pytest

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
ENGINES_DIR = os.path.join(REPO_ROOT, "engines")
MCP_DIR = os.path.join(REPO_ROOT, "mcp-server")
for p in (ENGINES_DIR, MCP_DIR):
    if p not in sys.path:
        sys.path.insert(0, p)

from sdwan_controller_views import (
    ReadOnlySdk,
    SdwanViewError,
    dispatch_view,
    resolve_site,
)


class _FakeResp:
    def __init__(self, body, status_code=200):
        self.cgx_content = body
        self.status_code = status_code
        self.cgx_status = 200 <= status_code < 300


class _FakeGet:
    def sites(self):
        return _FakeResp({
            "items": [
                {
                    "id": "site-1",
                    "name": "Branch-01",
                    "admin_state": "active",
                    "element_cluster_role": "SPOKE",
                    "network_policysetstack_id": "nstack-1",
                    "priority_policysetstack_id": "pstack-1",
                    "nat_policysetstack_id": "natstack-1",
                    "security_policysetstack_id": "sstack-1",
                    "address": {"city": "Paris", "country": "FR"},
                },
                {
                    "id": "site-2",
                    "name": "DC-01",
                    "admin_state": "active",
                    "element_cluster_role": "HUB",
                },
            ]
        })

    def elements(self):
        return _FakeResp({
            "items": [
                {
                    "id": "el-1",
                    "name": "br1-vion1",
                    "site_id": "site-1",
                    "connected": True,
                    "state": "bound",
                    "software_version": "6.5.3-b4",
                    "model_name": "ion 3102v",
                    "role": "SPOKE",
                    "l3_lan_forwarding": True,
                    "l3_direct_private_wan_forwarding": False,
                },
                {
                    "id": "el-2",
                    "name": "dc1-vion1",
                    "site_id": "site-2",
                    "connected": True,
                    "state": "bound",
                    "software_version": "6.5.3-b4",
                    "model_name": "ion 7108v",
                    "role": "HUB",
                    "l3_lan_forwarding": True,
                    "l3_direct_private_wan_forwarding": True,
                },
            ]
        })

    def element_status(self, el_id):
        return _FakeResp({"connected": True, "state": "online", "uptime": 86400, "cpu_usage": 12, "memory_usage": 44})

    def software_state(self, el_id):
        return _FakeResp({"running_version": "6.5.3-b4"})

    def site_status(self, site_id):
        return _FakeResp({"state": "active", "admin_state": "active"})

    def interfaces(self, site_id, el_id):
        return _FakeResp({
            "items": [
                {
                    "id": "if-1",
                    "name": "1",
                    "type": "port",
                    "used_for": "public",
                    "admin_up": True,
                    "mtu": 1500,
                    "site_wan_interface_ids": ["wanif-1"],
                    "ipv4_config": {"type": "dhcp"},
                },
                {
                    "id": "if-2",
                    "name": "2",
                    "type": "port",
                    "used_for": "lan",
                    "admin_up": True,
                    "mtu": 1500,
                    "attached_lan_networks": [{"lan_network_id": "lan-1"}],
                    "ipv4_config": {"type": "static", "static_config": {"address": "192.168.201.1/24"}},
                },
            ]
        })

    def bgpconfigs(self, site_id, el_id):
        return _FakeResp({"items": [{"local_as_num": 65001, "router_id": "10.0.0.1"}]})

    def bgppeers(self, site_id, el_id):
        return _FakeResp({
            "items": [
                {
                    "id": "peer-1",
                    "name": "CORE-BGP",
                    "peer_ip": "10.255.0.1",
                    "remote_as_num": "65000",
                    "shutdown": False,
                    "bgp_secret": "super-secret-md5",
                }
            ]
        })

    def bgppeers_status(self, site_id, el_id):
        return _FakeResp({"items": [{"id": "peer-1", "state": "Established", "uptime": 3600}]})

    def bgppeers_reachableprefixes(self, site_id, el_id, peer_id):
        return _FakeResp({"items": [{"prefix": "10.99.99.0/24"}, {"prefix": "10.100.0.0/16"}]})

    def bgppeers_advertisedprefixes(self, site_id, el_id, peer_id):
        return _FakeResp({"items": [{"prefix": "192.168.201.0/24"}]})

    def networkpolicysetstacks(self):
        return _FakeResp({"items": [{"id": "nstack-1", "name": "Enterprise-Net-Stack"}]})

    def prioritypolicysetstacks(self):
        return _FakeResp({"items": [{"id": "pstack-1", "name": "Enterprise-QoS-Stack"}]})

    def natpolicysetstacks(self):
        return _FakeResp({"items": [{"id": "natstack-1", "name": "Enterprise-NAT-Stack"}]})

    def ngfwsecuritypolicysetstacks(self):
        return _FakeResp({"items": [{"id": "sstack-1", "name": "Enterprise-Sec-Stack"}]})

    def wannetworks(self):
        return _FakeResp({"items": [{"id": "wnet-1", "name": "ISP-Orange", "type": "publicwan"}]})

    def waninterfacelabels(self):
        return _FakeResp({
            "items": [
                {
                    "id": "wlbl-1",
                    "name": "Primary Internet",
                    "label": "public-10",
                    "probe_profile_id": "pprof-1",
                }
            ]
        })

    def probeprofiles(self):
        return _FakeResp({
            "items": [
                {
                    "id": "pprof-1",
                    "name": "CloudFlare-Probe-Profile",
                    "probe_config_ids": ["pcfg-1"],
                }
            ]
        })

    def probeconfigs(self):
        return _FakeResp({
            "items": [
                {
                    "id": "pcfg-1",
                    "name": "ICMP-1.1.1.1",
                    "protocol": "icmp",
                    "endpoints": [{"ipv4_address": "1.1.1.1"}],
                }
            ]
        })

    def waninterfaces(self, site_id):
        return _FakeResp({
            "items": [
                {
                    "id": "wanif-1",
                    "name": "BR1-INET-1",
                    "type": "publicwan",
                    "network_id": "wnet-1",
                    "label_id": "wlbl-1",
                    "bfd_mode": "aggressive",
                    "lqm_enabled": True,
                    "link_bw_down": 100,
                    "link_bw_up": 100,
                }
            ]
        })

    def lannetworks(self, site_id):
        return _FakeResp({
            "items": [
                {
                    "id": "lan-1",
                    "name": "BR1-LAN",
                    "scope": "GLOBAL",
                    "ipv4_config": {"prefixes": ["192.168.201.0/24"]},
                }
            ]
        })

    def hubclusters(self, site_id):
        return _FakeResp({"items": []})

    def spokeclusters(self, site_id):
        return _FakeResp({"items": []})

    def staticroutes(self, site_id, el_id):
        return _FakeResp({
            "items": [
                {
                    "id": "sr-1",
                    "name": "Sub-LAN",
                    "destination_prefix": "192.168.210.0/24",
                    "scope": "GLOBAL",
                    "nexthops": [{"nexthop_ip": "192.168.201.254", "nexthop_interface_id": "if-2", "admin_distance": 1}],
                }
            ]
        })

    def networkpolicysets(self):
        return _FakeResp({"items": [{"id": "nset-1", "name": "Branch-Path-Policy"}]})

    def networkpolicyrules(self, set_id):
        return _FakeResp({
            "items": [
                {"id": "r-2", "name": "Default-Rule", "order_number": 20, "enabled": True, "network_context_id": "nc-1"},
                {"id": "r-1", "name": "Voice-EF-Rule", "order_number": 10, "enabled": True, "network_context_id": "nc-1", "shared_secret": "hidden"},
            ]
        })

    def networkcontexts(self):
        return _FakeResp({"items": [{"id": "nc-1", "name": "Voice-Context"}]})


class _FakePost:
    def topology(self, body):
        return _FakeResp({
            "links": [
                {
                    "type": "public-anynet",
                    "source_site_name": "Branch-01",
                    "target_site_name": "DC-01",
                    "status": "down",
                    "source_wan_network": "ISP-Orange",
                    "target_wan_network": "DC-INET",
                },
                {
                    "type": "private-anynet",
                    "source_site_name": "Branch-01",
                    "target_site_name": "DC-01",
                    "status": "up",
                    "source_wan_network": "MPLS-1",
                    "target_wan_network": "DC-MPLS",
                },
            ]
        })

    def interfaces_status_query(self, body):
        return _FakeResp({
            "items": [
                {"name": "1", "operational_state": "down", "ipv4_address": "203.0.113.10/24", "used_for": "public", "negotiated_mtu": 1500},
                {"name": "2", "operational_state": "up", "ipv4_address": "192.168.201.1/24", "used_for": "lan", "negotiated_mtu": 1500},
            ]
        })

    def events_query(self, body):
        return _FakeResp({
            "items": [
                {
                    "time": "2026-11-10T19:00:00Z",
                    "site_id": "site-1",
                    "element_name": "br1-vion1",
                    "code": "NW_VPN_LINK_DOWN",
                    "severity": "major",
                    "type": "alarm",
                    "acknowledged": False,
                    "cleared": False,
                    "summary": "VPN link to DC-01 is down",
                }
            ]
        })

    def monitor_metrics(self, body):
        return _FakeResp({
            "metrics": [
                {
                    "name": "LqmLatency",
                    "series": [
                        {
                            "name": "BR1-INET-1",
                            "view": {"path": "BR1-INET-1 -> DC-01"},
                            "data": [{"datapoints": [{"value": 12.0}, {"value": 18.0}, {"value": 15.0}]}],
                        }
                    ],
                }
            ]
        })


class _FakeSdk:
    def __init__(self):
        self.get = _FakeGet()
        self.post = _FakePost()


def test_readonly_sdk_blocks_writes_and_unlisted_methods():
    ro = ReadOnlySdk(_FakeSdk())
    with pytest.raises(AttributeError):
        _ = ro.put
    with pytest.raises(AttributeError):
        _ = ro.delete
    with pytest.raises(AttributeError):
        _ = ro.get.elementusers


def test_resolve_site_canonical_matching():
    sites = [{"id": "s1", "name": "Branch-01"}, {"id": "s2", "name": "DC-01"}]
    assert resolve_site(sites, "BR1")["id"] == "s1"
    assert resolve_site(sites, "Branch-01")["id"] == "s1"
    assert resolve_site(sites, "DC1")["id"] == "s2"


def test_ops_views_tunnels_interfaces_bgp_events_metrics():
    sdk = _FakeSdk()

    # Tunnels: down sorted before up
    tun = dispatch_view(sdk, "tunnels", {"site": "BR1"})
    assert tun["success"] is True
    assert tun["data"]["summary"]["total"] == 2
    assert tun["data"]["summary"]["down"] == 1
    assert tun["data"]["tunnels"][0]["state"] == "down"

    # Interfaces: flags "admin up, oper down" on port 1
    ifs = dispatch_view(sdk, "interfaces", {"site": "BR1"})
    assert ifs["success"] is True
    assert len(ifs["data"]["flagged"]) == 1
    assert ifs["data"]["flagged"][0]["name"] == "1"
    assert ifs["data"]["flagged"][0]["flag"] == "admin up, oper down"

    # BGP: includes prefix counts and lists when prefixes=True, and strips bgp_secret
    bgp_res = dispatch_view(sdk, "bgp", {"site": "BR1", "prefixes": True})
    assert bgp_res["success"] is True
    peer = bgp_res["data"]["peers"][0]
    assert peer["state"] == "Established"
    assert peer["received_count"] == 2
    assert peer["received_prefixes"] == ["10.99.99.0/24", "10.100.0.0/16"]
    assert "bgp_secret" not in peer

    # Events
    ev = dispatch_view(sdk, "events", {"site": "BR1", "hours": 24})
    assert ev["success"] is True
    assert ev["data"]["by_code"]["NW_VPN_LINK_DOWN"] == 1

    # Metrics
    met = dispatch_view(sdk, "metrics", {"site": "BR1", "metric": "lqm", "hours": 1})
    assert met["success"] is True
    assert met["data"]["series"][0]["avg"] == 15.0


def test_site_config_and_object_views():
    sdk = _FakeSdk()

    # Site config: checks l3_forwarding ('off' because l3_direct_private_wan_forwarding is False on br1-vion1),
    # lan_prefixes with scope, and effective_probe_profile inherited from category public-10
    sc = dispatch_view(sdk, "site_config", {"site": "BR1"})
    assert sc["success"] is True
    data = sc["data"]
    assert data["site"] == "Branch-01"
    assert data["lan_prefixes"] == ["192.168.201.0/24 (GLOBAL)"]
    assert data["wan_interfaces"][0]["effective_probe_profile"] == "CloudFlare-Probe-Profile"
    assert data["wan_interfaces"][0]["probe_source"] == "category public-10"
    assert data["elements"][0]["l3_forwarding"] == "off"
    assert data["elements"][0]["static_routes"][0]["nexthops"][0]["interface"] == "2"

    # Object view: networkpolicysets with ordered rules, UUID -> name resolution, and secret withholding
    obj = dispatch_view(sdk, "object", {"object_type": "networkpolicysets", "name": "Branch-Path-Policy"})
    assert obj["success"] is True
    rules = obj["data"]["object"]["rules"]
    assert [r["name"] for r in rules] == ["Voice-EF-Rule", "Default-Rule"]
    assert rules[0]["network_context"] == "Voice-Context"
    assert "shared_secret" not in rules[0]
    assert obj["data"]["fields_withheld"] == 1
