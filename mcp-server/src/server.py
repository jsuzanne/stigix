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


@mcp.tool()
async def get_diagnostics(agent_id: str) -> dict:
    """
    Fetch the full diagnostic dashboard for a node (CPU, Bitrate, App Stats, Voice, Peers).
    
    Args:
        agent_id: ID of the node.
    """
    check_leader()
    return await orchestrator.get_agent_dashboard(agent_id)


@mcp.tool()
async def get_app_score(agent_id: str, app_name: str) -> dict:
    """
    Calculate the success/error rate for a specific application on a node.
    
    Args:
        agent_id: ID of the node.
        app_name: Name of the application (e.g., 'teams', 'zoom', 'webex', 'teams.microsoft.com').
    """
    check_leader()
    data = await orchestrator.get_agent_dashboard(agent_id)
    if "error" in data:
        return data
        
    stats = data.get("stats", {})
    req_by_app = stats.get("requests_by_app", {})
    err_by_app = stats.get("errors_by_app", {})
    
    # Try fuzzy matching
    target_key = None
    app_lower = app_name.lower()
    for key in req_by_app.keys():
        if app_lower in key.lower():
            target_key = key
            break
            
    if not target_key:
        return {"error": f"Application '{app_name}' not found in stats. Available: {list(req_by_app.keys())[:5]}..."}
        
    requests = req_by_app.get(target_key, 0)
    errors = err_by_app.get(target_key, 0)
    success = requests - errors
    rate = (success / requests * 100) if requests > 0 else 0
    
    return {
        "agent": agent_id,
        "app": target_key,
        "total_requests": requests,
        "errors": errors,
        "success_rate": f"{rate:.2f}%",
        "status": "Healthy" if rate > 95 else "Degraded" if rate > 50 else "Critical"
    }


@mcp.tool()
async def run_security_probe(agent_id: str, probe_type: str, target: str) -> dict:
    """
    Launch a security test to check for policy enforcement (DNS, URL Filtering, or Threat/AV).
    
    Args:
        agent_id: ID of the node.
        probe_type: 'dns' (domain), 'url' (full url), or 'threat' (malware/EICAR).
        target: The domain, URL, or Scenario ID to test.
                For 'threat', you can use 'STIGIX-EICAR-01' or a direct file URL.
    """
    check_leader()
    return await orchestrator.trigger_security_test(agent_id, probe_type, target)


@mcp.tool()
async def list_vyos_routers(agent_id: str) -> List[dict]:
    """
    List all VyOS routers managed by a specific Stigix node.
    
    Args:
        agent_id: ID of the Stigix node managing the VyOS routers (e.g., 'Raspi4-Ubuntu').
    """
    check_leader()
    return await orchestrator.list_vyos_routers(agent_id)


@mcp.tool()
async def list_vyos_scenarios(agent_id: str) -> List[dict]:
    """
    List available VyOS configuration sequences (scenarios) on a specific Stigix node.
    
    Args:
        agent_id: ID of the Stigix node (e.g., 'BR1-Ubuntu').
    """
    check_leader()
    return await orchestrator.list_vyos_sequences(agent_id)


@mcp.tool()
async def run_vyos_scenario(agent_id: str, scenario_id: str) -> dict:
    """
    Execute a VyOS configuration sequence (scenario) on a specific Stigix node.
    
    Args:
        agent_id: ID of the Stigix node.
        scenario_id: The ID of the sequence to run (e.g., 'failover-paris').
    """
    check_leader()
    return await orchestrator.run_vyos_sequence(agent_id, scenario_id)


@mcp.tool()
async def get_vyos_timeline(agent_id: str, limit: int = 20) -> List[dict]:
    """
    Get the history of recent VyOS configuration changes on a specific Stigix node.
    
    Args:
        agent_id: ID of the Stigix node.
        limit: Number of recent actions to fetch (default 20).
    """
    check_leader()
    return await orchestrator.get_vyos_history(agent_id, limit)


@mcp.tool()
async def set_vyos_scenario_status(agent_id: str, scenario_id: str, enabled: bool) -> dict:
    """
    Enable or disable a specific VyOS configuration sequence (scenario) on a node.
    Use this to stop a cyclic scenario that interferes with manual actions.
    
    Args:
        agent_id: ID of the Stigix node.
        scenario_id: The ID of the sequence/scenario (e.g., 'seq-12345').
        enabled: True to enable/start, False to disable/stop.
    """
    check_leader()
    return await orchestrator.set_vyos_scenario_status(agent_id, scenario_id, enabled)


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
