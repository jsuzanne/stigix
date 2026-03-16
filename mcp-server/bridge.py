import sys
import asyncio
import logging
from mcp.client.session import ClientSession
from mcp.client.sse import sse_client
from mcp.server import Server
from mcp.server.stdio import stdio_server

# ABSOLUTELY NO LOGS ON STDOUT
logging.basicConfig(level=logging.CRITICAL, stream=sys.stderr)

async def run_bridge(sse_url: str):
    """
    Simplest possible bridge from Claude (STDIO) to Stigix (SSE).
    """
    async with sse_client(sse_url) as (read_stream, write_stream):
        async with ClientSession(read_stream, write_stream) as session:
            await session.initialize()
            
            # Local server to talk to Claude
            bridge = Server("stigix-bridge")
            
            # Proxy all tools
            remote_tools = await session.list_tools()
            for tool in remote_tools.tools:
                async def make_caller(name=tool.name):
                    async def call_proxy(**kwargs):
                        res = await session.call_tool(name, kwargs)
                        return res.content
                    return call_proxy
                
                bridge.tool(name=tool.name, description=tool.description)(
                    await make_caller(tool.name)
                )

            # Start bridging
            async with stdio_server() as (read, write):
                await bridge.run(read, write, bridge.create_initialization_options())

if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(1)
    try:
        asyncio.run(run_bridge(sys.argv[1]))
    except:
        pass
