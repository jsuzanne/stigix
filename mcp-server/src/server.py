"""
SD-WAN Traffic Generator MCP Server.

This is the main entry point for the Model Context Protocol (MCP) server
that orchestrates multiple SD-WAN traffic generator instances.

Supports both SSE (Server-Sent Events) and STDIO transports.
"""

import logging
import os
import sys
from typing import Optional, List

# CRITICAL: All logs to stderr to avoid polluting stdio
logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO"),
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    stream=sys.stderr  # NEVER use stdout
)

logger = logging.getLogger(__name__)

try:
    from fastmcp import FastMCP
except ImportError:
    logger.error("Failed to import fastmcp. Please install it with: pip install fastmcp")
    sys.exit(1)

# Import Stigix Orchestrator components
from .lib.registry import RegistryClient
from .lib.orchestrator import TestOrchestrator
from .types import StigixEndpoint, TestStatus, TestRun

# Initialize FastMCP
mcp = FastMCP("stigix-orchestrator")

# Core services
registry = RegistryClient()
orchestrator = TestOrchestrator()

def check_leader():
    """Safety check: only the leader should expose central orchestration."""
    is_leader = os.getenv("IS_LEADER", "true").lower() == "true"
    if not is_leader:
        raise RuntimeError("Service Unavailable: This instance is NOT the elected Target Controller (Leader).")

# -----------------------------------------------------------------------------
# Tool Definitions
# -----------------------------------------------------------------------------

@mcp.tool()
async def list_endpoints(kind: Optional[str] = None) -> List[dict]:
    """
    List available Stigix endpoints (Fabric nodes and Internet targets).
    
    Args:
        kind: Optional filter ('fabric' or 'internet')
    """
    check_leader()
    endpoints = await registry.list_endpoints(kind=kind)
    return [e.model_dump() for e in endpoints]


@mcp.tool()
async def run_test(
    source_id: str,
    target_id: str,
    profile: str = "CONV-001",
    duration: str = "30s",
    bitrate: Optional[str] = None,
    label: Optional[str] = None,
    protocol: Optional[str] = None,
    direction: Optional[str] = None,
    pps: Optional[int] = None
) -> dict:
    """
    Start a coordinated traffic test. 
    The source initiates (client) and the target receives (server).

    PROFILES:
    - 'xfr' (speedtest): Data transfer. Supports 'protocol', 'direction', 'bitrate'.
    - 'conv' (convergence): Probe test. Long-running, supports 'pps', 'label'. Must be stopped using 'stop_test'.
    - 'voice' / 'iot': Simulation.
    
    Args:
        source_id: Node ID (initiator).
        target_id: Node ID(s) (receivers). Multi: 'T1,T2'.
        profile: Test type ('xfr', 'speedtest', 'conv', 'voice', 'iot').
        duration: [XFR ONLY] Duration (e.g. '30s'). Ignored for 'conv' (runs indefinitely).
        bitrate: [XFR ONLY] (e.g. '200M').
        pps: [CONV ONLY] (e.g. 100).
        protocol: [XFR ONLY] ('tcp', 'udp', 'quic').
        direction: [XFR ONLY] ('client-to-server', 'server-to-client', 'bidirectional').
        label: [CONV ONLY] Custom label. Defaults to local CONV-XXXX id if empty.
    """
    check_leader()
    
    # Resolve source
    source = await registry.get_endpoint(source_id)
    if not source:
        return {"error": f"Source endpoint '{source_id}' not found."}

    # Resolve all targets
    target_ids = [t.strip() for t in target_id.split(',')]
    targets = []
    for tid in target_ids:
        target = await registry.get_endpoint(tid)
        if not target:
            return {"error": f"Target endpoint '{tid}' not found."}
        targets.append(target)

    try:
        results = await orchestrator.run_tests(
            source=source,
            targets=targets,
            profile=profile,
            duration=duration,
            bitrate=bitrate,
            label=label,
            protocol=protocol,
            direction=direction,
            pps=pps
        )
        
        # Return individual TestRun model_dumps in a list
        return {"tests": [t.model_dump() for t in results]}
    except Exception as e:
        return {"error": str(e)}


@mcp.tool()
async def get_test_status(test_id: str) -> dict:
    """
    Get the status and metrics of a specific test.
    
    Args:
        test_id: The global test ID (e.g., G-20260313-ABCD) or a local ID (CONV-XXXX).
    """
    check_leader()
    try:
        status = await orchestrator.get_status(test_id)
        return status.model_dump()
    except ValueError as e:
        return {"error": str(e)}


@mcp.tool()
async def stop_test(test_id: str) -> dict:
    """
    Stop an active traffic test (especially for convergence tests).
    
    Args:
        test_id: The global test ID (e.g., G-20260313-ABCD) or a local ID (CONV-XXXX).
    """
    check_leader()
    try:
        return await orchestrator.stop_test(test_id)
    except Exception as e:
        return {"error": str(e)}


@mcp.tool()
async def set_traffic_status(source_id: str, enabled: bool) -> dict:
    """
    Start or stop application traffic generation on a specific node.
    
    Args:
        source_id: ID of the node (must be kind='fabric')
        enabled: True to start, False to stop
    """
    check_leader()
    source = await registry.get_endpoint(source_id)
    if not source:
        return {"error": f"Node '{source_id}' not found."}
    
    try:
        return await orchestrator.set_traffic_status(source, enabled)
    except Exception as e:
        return {"error": str(e)}


@mcp.tool()
async def set_voice_status(source_id: str, enabled: bool) -> dict:
    """
    Start or stop voice simulation on a specific node.
    
    Args:
        source_id: ID of the node (must be kind='fabric')
        enabled: True to start, False to stop
    """
    check_leader()
    source = await registry.get_endpoint(source_id)
    if not source:
        return {"error": f"Node '{source_id}' not found."}
    
    try:
        return await orchestrator.set_voice_status(source, enabled)
    except Exception as e:
        return {"error": str(e)}


# -----------------------------------------------------------------------------
# Main Entry Point
# -----------------------------------------------------------------------------

if __name__ == "__main__":
    logger.info(f"Entrypoint reached with __name__ == {__name__}")
    # Read configuration from environment
    transport = os.getenv("MCP_TRANSPORT", "stdio").lower()
    port = int(os.getenv("MCP_PORT", "3101"))
    host = os.getenv("MCP_HOST", "0.0.0.0")
    
    logger.info(f"Starting Stigix MCP Orchestrator with {transport} transport")
    
    if transport == "sse":
        logger.info(f"SSE endpoint: http://{host}:{port}/sse")
        mcp.run(transport="sse", port=port, host=host)
    else:
        logger.info("STDIO transport (direct Claude Desktop connection)")
        mcp.run(transport="stdio")
