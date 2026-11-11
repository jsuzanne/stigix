"""Unit tests for Phase 3 Read-Only Prisma SD-WAN vION CLI via WebSocket Device Toolkit."""
import asyncio
import os
import sys
import pytest

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
ENGINES_DIR = os.path.join(REPO_ROOT, "engines")
MCP_DIR = os.path.join(REPO_ROOT, "mcp-server")
for p in (ENGINES_DIR, MCP_DIR):
    if p not in sys.path:
        sys.path.insert(0, p)

from sdwan_ion_cli import (
    IonCliError,
    RULES,
    build_command_fallbacks,
    ensure_toolkit_user,
    execute_ion_cli,
    parse_inspect_flow_brief,
    validate_command,
)


def test_validate_command_policy():
    # Known-good curated commands
    assert validate_command("dump controller status") == "dump controller status"
    assert validate_command("dump interface status all") == "dump interface status all"
    assert validate_command("dump interface status 2") == "dump interface status 2"
    assert validate_command("dump vpn summary all") == "dump vpn summary all"
    assert validate_command("inspect flow brief") == "inspect flow brief"
    assert (
        validate_command("inspect network-policy lookup srcv4=192.168.201.2 dstv4=10.99.99.2 protocol=tcp dport=443")
        == "inspect network-policy lookup srcv4=192.168.201.2 dstv4=10.99.99.2 protocol=6 dport=443"
    )

    # Forbidden tokens or injection characters must be rejected
    for forbidden in (
        "set interface 1 admin-down",
        "reboot",
        "dump vpn summary all; reboot",
        "dump vpn summary all | grep up",
        "inspect user password",
        "config terminal",
        "shell",
        "tcpdump -i eth0",
    ):
        with pytest.raises(IonCliError):
            validate_command(forbidden)


class _FakeResp:
    def __init__(self, body, status_code=200):
        self.cgx_content = body
        self.status_code = status_code
        self.cgx_status = 200 <= status_code < 300


class _FakeUserSdk:
    def __init__(self):
        self.created_passwords = []
        self.stored_pw = None
        self.get = self
        self.post = self
        self.put = self

    def profile(self):
        return _FakeResp({"tenant_id": "tenant-123"})

    def elementusers(self, payload=None, *args):
        if payload is None:
            if self.stored_pw is None:
                return _FakeResp({"items": []})
            return _FakeResp({
                "items": [
                    {
                        "id": "u-1",
                        "username": "stigix-ai",
                        "login_id": "stigix-ai",
                        "role": "super",
                        "is_tenant_level": True,
                    }
                ]
            })
        # POST create: reject first ladder class ("a16-sym") to test ladder fallback
        pw = payload.get("password", "")
        self.created_passwords.append(pw)
        if len(self.created_passwords) == 1:
            return _FakeResp({"_error": [{"code": "ELEMENTUSER_INVALID_PASSWORD"}]}, status_code=400)
        self.stored_pw = pw
        return _FakeResp({"id": "u-1", "username": "stigix-ai"}, status_code=201)

    def elementusers_password(self, user_id):
        return _FakeResp({"password": self.stored_pw})


def test_ensure_toolkit_user_climbs_password_ladder():
    sdk = _FakeUserSdk()
    saved_docs = []

    res = ensure_toolkit_user(
        sdk,
        read_secret=lambda: None,
        write_secret=lambda doc: saved_docs.append(doc),
    )

    assert res["state"] == "created"
    assert res["password_class"] == "b12-alnum"
    assert res["password_verified"] is True
    assert len(sdk.created_passwords) == 2
    assert saved_docs[-1]["password"] == res["password"]


class _FakeWebSocket:
    """Simulates a vION Device Toolkit WebSocket terminal with login, Password, --More-- pager, and ANSI codes."""

    def __init__(self, expected_user: str, expected_pass: str, output_lines: list):
        self.expected_user = expected_user
        self.expected_pass = expected_pass
        self.output_lines = output_lines
        self._queue: asyncio.Queue = asyncio.Queue()
        self._state = "login"
        self._user_sent = ""

    async def __aenter__(self):
        await self._queue.put("\x1b[2Jbr1-vion1 login: ")
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def recv(self):
        return await self._queue.get()

    async def send(self, data: str):
        s = data.strip("\r\n")
        if self._state == "login":
            self._user_sent = s
            self._state = "password"
            await self._queue.put("Password: ")
        elif self._state == "password":
            if self._user_sent == self.expected_user and s == self.expected_pass:
                self._state = "prompt"
                await self._queue.put("\r\nbr1-vion1# ")
            else:
                self._state = "login"
                await self._queue.put("\r\nLogin incorrect\r\nbr1-vion1 login: ")
        elif self._state == "prompt":
            if data == " ":
                # Pager spacebar pressed
                await self._queue.put(f"\r\n{self.output_lines[1]}\r\nbr1-vion1# ")
            elif s != "exit":
                if len(self.output_lines) > 1:
                    await self._queue.put(f"{s}\r\n\x1b[32m{self.output_lines[0]}\x1b[0m\r\n--More--")
                else:
                    await self._queue.put(f"{s}\r\n{self.output_lines[0]}\r\nbr1-vion1# ")


class _FakeCliSdk:
    def __init__(self):
        self.get = self

    def sites(self):
        return _FakeResp({"items": [{"id": "site-1", "name": "Branch-01"}]})

    def elements(self):
        return _FakeResp({"items": [{"id": "el-1", "name": "Branch-01-01", "site_id": "site-1", "connected": True}]})


def test_execute_ion_cli_pagination_and_auto_rotation():
    sdk = _FakeCliSdk()
    attempts = []

    def _fake_ensure(s, rotate=False):
        attempts.append(rotate)
        if not rotate:
            return {"username": "stigix-ai-toolkit", "password": "stale-password"}
        return {"username": "stigix-ai-toolkit", "password": "fresh-password"}

    def _fake_connect(s, eid):
        return _FakeWebSocket(
            expected_user="stigix-ai-toolkit",
            expected_pass="fresh-password",
            output_lines=["Tunnel-1: UP (DC1-INET)", "Tunnel-2: UP (DC1-MPLS)"],
        )

    res = execute_ion_cli(
        sdk,
        "BR1",
        "dump vpn summary all",
        connect_fn=_fake_connect,
        ensure_user_fn=_fake_ensure,
    )

    assert res["success"] is True
    assert res["site"] == "Branch-01"
    assert res["element"] == "Branch-01-01"
    assert attempts == [False, True]  # First tried cached, then auto-rotated on login_failed
    assert "Tunnel-1: UP (DC1-INET)" in res["output"]
    assert "Tunnel-2: UP (DC1-MPLS)" in res["output"]
    assert "--More--" not in res["output"]
    assert "\x1b" not in res["output"]


def test_execute_ion_cli_device_rejection():
    sdk = _FakeCliSdk()

    def _fake_ensure(s, rotate=False):
        return {"username": "stigix-ai-toolkit", "password": "ok-password"}

    def _fake_connect(s, eid):
        return _FakeWebSocket(
            expected_user="stigix-ai-toolkit",
            expected_pass="ok-password",
            output_lines=["% Error: Unknown keyword routes"],
        )

    with pytest.raises(IonCliError) as exc_info:
        execute_ion_cli(
            sdk,
            "BR1",
            "dump routing peer status all",
            connect_fn=_fake_connect,
            ensure_user_fn=_fake_ensure,
        )
    assert exc_info.value.code == "command_rejected"
    assert exc_info.value.status == 422


def test_phase4_diagnostic_playbook_and_mcp_manifest_sync():
    """Verify the SD-WAN diagnostic playbook is present in Copilot and MCP, and all tools are in tools_manifest.yaml."""
    import re
    import yaml

    ai_manager_path = os.path.join(REPO_ROOT, "web-dashboard", "ai-copilot", "ai-manager.ts")
    with open(ai_manager_path, "r", encoding="utf-8") as f:
        ai_manager_src = f.read()

    assert "PRISMA SD-WAN & vION DIAGNOSTIC PLAYBOOK" in ai_manager_src
    assert "l3_lan_forwarding" in ai_manager_src
    assert "l3_direct_private_wan_forwarding" in ai_manager_src
    assert "effective_probe_profile" in ai_manager_src
    assert "dump reachability-probe status all" in ai_manager_src

    server_py_path = os.path.join(MCP_DIR, "src", "server.py")
    with open(server_py_path, "r", encoding="utf-8") as f:
        server_src = f.read()

    assert "SD-WAN Diagnostic Playbook (First Checks):" in server_src
    tool_fns = re.findall(r"@mcp\.tool\(\)\s+async def (\w+)", server_src)

    manifest_path = os.path.join(MCP_DIR, "tests", "tools_manifest.yaml")
    with open(manifest_path, "r", encoding="utf-8") as f:
        manifest = yaml.safe_load(f).get("tools", {})

    for required_tool in (
        "get_prisma_flows",
        "get_prisma_ops_view",
        "get_prisma_site_config",
        "get_prisma_object",
        "run_prisma_ion_cli",
    ):
        assert required_tool in tool_fns
        assert required_tool in manifest


def test_cross_version_fallbacks_and_regex_flow_parser():
    """Verify cross-version command fallback ladder and regex-anchored flow brief parsing."""
    fbs = build_command_fallbacks("inspect flow brief dstv4=192.168.203.100 sport=30454", "6.8.1-b4")
    assert "inspect flow brief dstv4=192.168.203.100" in fbs
    assert "inspect flow brief" in fbs

    np_fbs = build_command_fallbacks(
        "inspect network-policy lookup srcv4=192.168.201.2 dstv4=10.99.99.2 protocol=6 dport=443 app=ssl",
        "6.5.2-b9",
    )
    assert "inspect network-policy lookup srcv4=192.168.201.2 dstv4=10.99.99.2 protocol=tcp dport=443 app=ssl" in np_fbs
    assert "inspect network-policy lookup srcv4=192.168.201.2 dstv4=10.99.99.2 app=ssl" in np_fbs
    assert "inspect network-policy lookup srcv4=192.168.201.2 dstv4=10.99.99.2 application=ssl" in np_fbs

    sample_output = (
        "VRF   SRC   DST   SPORT   DPORT   PROTOCOL   START-TIME   APP-ID   NET-POLICY   PRI-POLICY   SEC-POLICY   SEC-ACTION   WANPATH-ID   PATH-TYPE\n"
        "Global  192.168.208.100 192.168.203.100 30454 6200 17 2026-11-10 22:12:41 FailoverTest-131093 All-Traffic-Enterprise-D All-Traffic-Enterprise-D Allow Lan to Over\n"
        "lay ALLOW 1762789921682021645 lan_to_public_vpn\n"
        "Global  192.168.208.100 192.168.203.100 30455 6200 17 2026-11-10 22:13:00 FailoverTest-131093 All-Traffic-Enterprise-D All-Traffic-Enterprise-D FUTURE_COL_A FUTURE_COL_B ALLOW 1762789923250022645 lan_to_public_vpn\n"
    )
    rows = parse_inspect_flow_brief(sample_output)
    assert len(rows) == 2
    assert rows[0]["source_port"] == 30454
    assert rows[0]["sec_policy"] == "Allow Lan to Overlay"
    assert rows[0]["wanpath_id"] == "1762789921682021645"
    assert rows[0]["raw_path_type"] == "lan_to_public_vpn"
    assert rows[1]["source_port"] == 30455
    assert rows[1]["wanpath_id"] == "1762789923250022645"


def test_resolve_live_flow_cli_strict_port_filter(monkeypatch):
    """Ensure resolve_live_flow_cli never returns an unrelated port (e.g. 8085) when port 9000 is requested."""
    import sdwan_ion_cli

    def _fake_exec(sdk, device_or_site, cmd, **kwargs):
        return {
            "success": True,
            "site_id": "site-1",
            "site": "BR8",
            "element": "br8-vion1",
            "software_version": "6.5.2-b9",
            "command": cmd,
            "duration_ms": 1100,
            "read_at": "2026-11-11T08:48:00Z",
            "output": (
                "Global 192.168.208.100 192.168.203.100 54120 8085 6 2026-11-11 08:47:10 "
                "STX_Onprem8085-131103 All-Traffic All-Traffic Allow ALLOW 1762789921682021645 lan_to_public_vpn\n"
            ),
        }

    monkeypatch.setattr(sdwan_ion_cli, "execute_ion_cli", _fake_exec)
    monkeypatch.setattr(sdwan_ion_cli, "resolve_wanpath_id", lambda *a, **kw: ("VPN: BR8-INET1 to DC1-INET1", "VPN"))

    # Requesting dst_port=9000 when only port 8085 is active must return 0 flows (not 8085!)
    res_9000 = sdwan_ion_cli.resolve_live_flow_cli(
        None,
        "BR8",
        dst_ip="192.168.203.100",
        dst_port=9000,
        protocol=6,
    )
    assert res_9000["flows"] == []

    # Requesting dst_port=8085 must return the 8085 flow
    res_8085 = sdwan_ion_cli.resolve_live_flow_cli(
        None,
        "BR8",
        dst_ip="192.168.203.100",
        dst_port=8085,
        protocol=6,
    )
    assert len(res_8085["flows"]) == 1
    assert res_8085["flows"][0]["destination_port"] == 8085
    assert res_8085["flows"][0]["app_id"] == "STX_Onprem8085-131103"


