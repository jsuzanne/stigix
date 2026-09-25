import sys
import asyncio
import logging
from contextlib import AsyncExitStack
from mcp.client.session import ClientSession
from mcp.client.sse import sse_client
from mcp.server.lowlevel import Server, NotificationOptions
from mcp.server.models import InitializationOptions
import mcp.types as types
from mcp.server.stdio import stdio_server

# ABSOLUTELY NO LOGS ON STDOUT
logging.basicConfig(level=logging.ERROR, stream=sys.stderr)
logger = logging.getLogger("stigix-bridge")

class SSEConnectionManager:
    def __init__(self, sse_url: str):
        self.sse_url = sse_url
        self.session = None
        self._exit_stack = None
        self._lock = asyncio.Lock()

    async def get_session(self) -> ClientSession:
        async with self._lock:
            if self.session is not None:
                return self.session

            print(f"Connecting to Stigix Mesh at {self.sse_url} (timeout 10s)...", file=sys.stderr)
            stack = AsyncExitStack()
            try:
                async def _connect():
                    read_stream, write_stream = await stack.enter_async_context(sse_client(self.sse_url))
                    session = await stack.enter_async_context(ClientSession(read_stream, write_stream))
                    await session.initialize()
                    return session

                session = await asyncio.wait_for(_connect(), timeout=10.0)
                self._exit_stack = stack
                self.session = session
                print("SSE Connection established. Session initialized successfully.", file=sys.stderr)
                return self.session
            except Exception as e:
                err_type = type(e).__name__
                err_msg = str(e) or repr(e) or err_type
                print(f"Connection failed to {self.sse_url} ({err_type}): {err_msg}", file=sys.stderr)
                try:
                    await stack.aclose()
                except Exception:
                    pass
                self.session = None
                self._exit_stack = None
                raise RuntimeError(f"Cannot connect to Stigix Mesh node at {self.sse_url}: {err_msg}") from e

    async def close(self):
        if self._exit_stack:
            try:
                await self._exit_stack.aclose()
            except Exception:
                pass
        self.session = None
        self._exit_stack = None

    async def handle_disconnect(self):
        print("Handling disconnection, resetting session...", file=sys.stderr)
        async with self._lock:
            await self.close()

READ_ONLY_PREFIXES = ("get_", "list_", "describe_", "compare_", "export_", "generate_peer_onboard_command")
MUTATING_TOOLS = {
    "vyos_execute_action", "vyos_bulk_reset", "run_vyos_scenario", "set_vyos_scenario_status",
    "run_test", "stop_test",
    "set_traffic_status", "set_traffic_rate", "set_voice_status", "set_traffic_client_count",
    "run_security_probe", "run_security_url_batch", "run_security_dns_batch", "run_full_security_audit", "run_eicar_test",
    "run_dem_probes_now", "add_dem_probe", "remove_dem_probe", "update_dem_probe",
    "add_fabric_target", "remove_fabric_target", "set_fabric_target_enabled",
    "import_app_config", "clone_node_config",
    "create_custom_tcp_app", "add_tcp_app_peer", "delete_custom_tcp_app",
    "start_tcp_app_listener", "stop_tcp_app_listener",
    "start_tcp_app_workload", "stop_tcp_app_workload",
    "test_tcp_app_handshake", "reset_tcp_app_metrics",
    "set_controller_leader", "set_provisioning_mode",
    "publish_configuration_bundle", "rollback_configuration_bundle", "purge_stale_leader_state",
}

def is_read_only_tool(name: str) -> bool:
    if name in MUTATING_TOOLS:
        return False
    if name.startswith("vyos_") or name.startswith("set_") or name.startswith("stop_") or name.startswith("create_") or name.startswith("delete_") or name.startswith("add_") or name.startswith("remove_") or name.startswith("import_") or name.startswith("start_"):
        return False
    if name.startswith("run_"):
        return name in ("run_path_trace", "run_system_diagnostics")
    return name.startswith(READ_ONLY_PREFIXES) or name in ("generate_report",)

async def execute_tool_with_retry(
    manager: SSEConnectionManager,
    tool_name: str,
    arguments: dict | None,
    timeout_sec: float
) -> types.CallToolResult:
    is_read_only = is_read_only_tool(tool_name)
    for attempt in range(2):
        start_time = asyncio.get_event_loop().time()
        try:
            session = await manager.get_session()
            res = await asyncio.wait_for(session.call_tool(tool_name, arguments), timeout=timeout_sec)
            elapsed = round(asyncio.get_event_loop().time() - start_time, 2)
            print(f"Tool '{tool_name}' executed successfully in {elapsed}s (attempt {attempt+1}).", file=sys.stderr)
            return res
        except asyncio.TimeoutError:
            print(f"[BRIDGE] Tool '{tool_name}' timed out after {timeout_sec}s. Reconnecting SSE session to restore clean request pipeline.", file=sys.stderr)
            await manager.handle_disconnect()
            return types.CallToolResult(
                content=[
                    types.TextContent(
                        type="text",
                        text=f"Error: Tool '{tool_name}' timed out after {int(timeout_sec)} seconds. The target node may be busy or unreachable."
                    )
                ],
                isError=True
            )
        except Exception as e:
            err_type = type(e).__name__
            err_str = str(e).strip()
            err_repr = repr(e)
            err_msg = err_str if err_str else (f"{err_type}: {err_repr}" if err_repr else err_type)
            print(f"[BRIDGE] Error calling tool '{tool_name}' ({err_type}, attempt {attempt+1}): {err_msg}", file=sys.stderr)
            is_connection_error = not err_str or any(kw in err_msg.lower() for kw in ["connection", "closed", "closedresourceerror", "eof", "broken pipe", "stream", "sse", "mcperror", "remoteprotocolerror", "timeout", "cancel"])
            if is_connection_error:
                print(f"[BRIDGE] Resetting session after transport anomaly ({err_type})...", file=sys.stderr)
                await manager.handle_disconnect()
                # Retry once ONLY for read-only tools
                if is_read_only and attempt == 0:
                    print(f"[BRIDGE] Reconnecting and retrying read-only tool '{tool_name}'...", file=sys.stderr)
                    continue
            return types.CallToolResult(
                content=[
                    types.TextContent(
                        type="text",
                        text=f"Error executing tool '{tool_name}': {err_msg}"
                    )
                ],
                isError=True
            )

TOOL_TIMEOUTS: dict[str, float] = {
    "run_path_trace": 120.0,
    "run_dem_probes_now": 120.0,
    "run_full_security_audit": 180.0,
    "run_security_url_batch": 120.0,
    "run_security_dns_batch": 120.0,
    "generate_report": 120.0,
    "list_active_impairments": 90.0,
}
DEFAULT_TOOL_TIMEOUT = 60.0

async def run_bridge(sse_url: str):
    """
    Dynamic bridge from Claude (STDIO) to Stigix (SSE) using low-level MCP Server
    with automatic background reconnection.
    """
    manager = SSEConnectionManager(sse_url)
    server = Server("Stigix-Bridge")

    # Try to connect initially to populate tools, but don't fail if unreachable.
    try:
        await manager.get_session()
    except Exception:
        print("Initial connection failed. Starting STDIO server anyway to support reconnection.", file=sys.stderr)

    @server.list_tools()
    async def handle_list_tools(request: types.ListToolsRequest) -> types.ListToolsResult:
        print("Claude requested list_tools, proxying to remote...", file=sys.stderr)
        try:
            session = await manager.get_session()
            res = await session.list_tools()
            print(f"Remote returned {len(res.tools)} tools.", file=sys.stderr)
            return res
        except Exception as e:
            print(f"Error listing tools: {e}", file=sys.stderr)
            await manager.handle_disconnect()
            return types.ListToolsResult(tools=[])

    @server.call_tool()
    async def handle_call_tool(name: str, arguments: dict | None) -> types.CallToolResult:
        timeout_sec = TOOL_TIMEOUTS.get(name, DEFAULT_TOOL_TIMEOUT)
        print(f"Claude calling tool '{name}' with args {arguments} (timeout: {timeout_sec}s)...", file=sys.stderr)
        return await execute_tool_with_retry(manager, name, arguments, timeout_sec)


    @server.list_resources()
    async def handle_list_resources(request: types.ListResourcesRequest) -> types.ListResourcesResult:
        print("Claude requested list_resources, proxying to remote...", file=sys.stderr)
        try:
            session = await manager.get_session()
            return await session.list_resources()
        except Exception as e:
            print(f"Error listing resources: {e}", file=sys.stderr)
            await manager.handle_disconnect()
            return types.ListResourcesResult(resources=[])

    @server.read_resource()
    async def handle_read_resource(uri) -> types.ReadResourceResult:
        print(f"Claude reading resource '{uri}'...", file=sys.stderr)
        try:
            session = await manager.get_session()
            return await session.read_resource(uri)
        except Exception as e:
            print(f"Error reading resource '{uri}': {e}", file=sys.stderr)
            await manager.handle_disconnect()
            raise

    print("Bridge initialized. Starting STDIO server loop...", file=sys.stderr)
    try:
        async with stdio_server() as (read, write):
            await server.run(
                read,
                write,
                server.create_initialization_options(
                    notification_options=NotificationOptions(),
                    experimental_capabilities={},
                ),
            )
    finally:
        await manager.close()

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python3 bridge.py <SSE_URL>", file=sys.stderr)
        sys.exit(1)
    
    try:
        asyncio.run(run_bridge(sys.argv[1]))
    except KeyboardInterrupt:
        sys.exit(0)
