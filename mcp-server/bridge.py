import sys
import asyncio
import logging
from mcp.client.session import ClientSession
from mcp.client.sse import sse_client
from mcp.server.lowlevel import Server, NotificationOptions
from mcp.server.models import InitializationOptions
import mcp.types as types
from mcp.server.stdio import stdio_server

# ABSOLUTELY NO LOGS ON STDOUT
logging.basicConfig(level=logging.ERROR, stream=sys.stderr)
logger = logging.getLogger("stigix-bridge")

async def run_bridge(sse_url: str):
    """
    Dynamic bridge from Claude (STDIO) to Stigix (SSE) using low-level MCP Server.
    """
    print(f"Connecting to Stigix Mesh at {sse_url}...", file=sys.stderr)
    
    try:
        async with sse_client(sse_url) as (read_stream, write_stream):
            print(f"SSE Connection established. Initializing session...", file=sys.stderr)
            async with ClientSession(read_stream, write_stream) as session:
                await session.initialize()
                print(f"Remote session initialized. Proxying tools...", file=sys.stderr)
                
                # Use low-level Server for dynamic proxying
                server = Server("Stigix-Bridge")
                
                @server.list_tools()
                async def handle_list_tools(request: types.ListToolsRequest) -> types.ListToolsResult:
                    print("Claude requested list_tools, proxying to remote...", file=sys.stderr)
                    try:
                        res = await session.list_tools()
                        print(f"Remote returned {len(res.tools)} tools.", file=sys.stderr)
                        return res
                    except Exception as e:
                        print(f"Error listing tools: {e}", file=sys.stderr)
                        return types.ListToolsResult(tools=[])

                @server.call_tool()
                async def handle_call_tool(name: str, arguments: dict | None) -> types.CallToolResult:
                    print(f"Claude calling tool '{name}' with args {arguments}...", file=sys.stderr)
                    try:
                        res = await session.call_tool(name, arguments)
                        print(f"Tool '{name}' executed successfully.", file=sys.stderr)
                        return res
                    except Exception as e:
                        print(f"Error calling tool '{name}': {e}", file=sys.stderr)
                        return types.CallToolResult(content=[types.TextContent(type="text", text=f"Error: {str(e)}")], isError=True)

                # Also proxy resources for completeness
                @server.list_resources()
                async def handle_list_resources(request: types.ListResourcesRequest) -> types.ListResourcesResult:
                    print("Claude requested list_resources, proxying to remote...", file=sys.stderr)
                    try:
                        return await session.list_resources()
                    except Exception as e:
                        print(f"Error listing resources: {e}", file=sys.stderr)
                        return types.ListResourcesResult(resources=[])

                @server.read_resource()
                async def handle_read_resource(uri) -> types.ReadResourceResult:
                    print(f"Claude reading resource '{uri}'...", file=sys.stderr)
                    try:
                        return await session.read_resource(uri)
                    except Exception as e:
                        print(f"Error reading resource '{uri}': {e}", file=sys.stderr)
                        raise

                print("Bridge initialized. Ready for Claude.", file=sys.stderr)
                
                async with stdio_server() as (read, write):
                    print("Starting STDIO server loop...", file=sys.stderr)
                    await server.run(
                        read,
                        write,
                        server.create_initialization_options(
                            notification_options=NotificationOptions(),
                            experimental_capabilities={},
                        ),
                    )

    except Exception as e:
        import traceback
        traceback.print_exc(file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python3 bridge.py <SSE_URL>", file=sys.stderr)
        sys.exit(1)
    
    asyncio.run(run_bridge(sys.argv[1]))
