"""
SD-WAN Traffic Generator MCP Server.

This is the main entry point for the Model Context Protocol (MCP) server
that orchestrates multiple SD-WAN traffic generator instances.

Supports both SSE (Server-Sent Events) and STDIO transports.
"""

import logging
import os
import sys
import time
import json
import inspect
import functools
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, List

# CRITICAL: All logs to stderr to avoid polluting stdio
logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO"),
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    stream=sys.stderr  # NEVER use stdout
)

logger = logging.getLogger(__name__)

# DO NOT POLLUTE STDOUT (Reserved for JSON-RPC in stdio mode)
# Redirect any accidental print or library log to stderr
class StdoutRedirector:
    def write(self, data):
        sys.stderr.write(data)
    def flush(self):
        sys.stderr.flush()

if os.getenv("MCP_TRANSPORT", "stdio").lower() == "stdio":
    sys.stdout = StdoutRedirector()

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


# -----------------------------------------------------------------------------
# MCP Interaction Logger
# Wraps all public async orchestrator methods to log calls to mcp-history.jsonl.
# Zero impact on Claude / MCP protocol — purely Stigix-side visibility.
# -----------------------------------------------------------------------------

_MCP_LOG_FILE = Path(os.getenv("LOG_DIR", "/app/logs")) / "mcp-history.jsonl"
_MCP_LOG_MAX_LINES = 500


def _append_mcp_log(tool: str, agent_id: str, duration_ms: int, status: str, error: str = None) -> None:
    """Append one interaction entry to mcp-history.jsonl."""
    try:
        _MCP_LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
        entry: dict = {
            "ts": datetime.now(timezone.utc).isoformat(),
            "tool": tool,
            "agent_id": str(agent_id) if agent_id else "—",
            "duration_ms": duration_ms,
            "status": status,
        }
        if error:
            entry["error"] = error[:120]
        with open(_MCP_LOG_FILE, "a") as fh:
            fh.write(json.dumps(entry) + "\n")
        # Rotate: keep only the last N lines
        try:
            lines = _MCP_LOG_FILE.read_text().splitlines()
            if len(lines) > _MCP_LOG_MAX_LINES:
                _MCP_LOG_FILE.write_text("\n".join(lines[-_MCP_LOG_MAX_LINES:]) + "\n")
        except Exception:
            pass
    except Exception:
        pass  # Never let logging break a tool


def _patch_orchestrator_logging(instance) -> None:
    """
    Monkey-patch all public async methods on the orchestrator instance
    to transparently log call metadata (tool name, agent_id, duration, status).
    Called once at startup — no changes required to individual tool functions.
    """
    for attr_name in list(vars(type(instance))):
        if attr_name.startswith("_"):
            continue
        method = getattr(instance, attr_name)
        if not inspect.iscoroutinefunction(method):
            continue

        def _make_wrapper(fn, name):
            @functools.wraps(fn)
            async def _wrapper(*args, **kwargs):
                start = time.monotonic()
                # Best-effort agent_id extraction from first positional arg or kwarg
                agent_id = kwargs.get("agent_id")
                if agent_id is None and args:
                    candidate = args[0]
                    if isinstance(candidate, str):
                        agent_id = candidate
                status = "ok"
                error_str = None
                try:
                    result = await fn(*args, **kwargs)
                    # Surface errors returned as dicts/lists
                    if isinstance(result, dict) and "error" in result:
                        status = "error"
                        error_str = str(result["error"])[:120]
                    elif isinstance(result, list) and result and isinstance(result[0], dict) and "error" in result[0]:
                        status = "error"
                        error_str = str(result[0]["error"])[:120]
                    return result
                except Exception as exc:
                    status = "error"
                    error_str = str(exc)[:120]
                    raise
                finally:
                    duration_ms = int((time.monotonic() - start) * 1000)
                    _append_mcp_log(name, agent_id, duration_ms, status, error_str)
            return _wrapper

        setattr(instance, attr_name, _make_wrapper(method, attr_name))


# Apply logging patch to orchestrator
_patch_orchestrator_logging(orchestrator)

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
    Start a coordinated traffic test between Stigix endpoints.
    The source initiates (client) and the target receives (server).

    TARGET CONSTRAINTS (CRITICAL):
    - 'xfr': Target MUST be another Stigix node OR a dedicated XFR target.
    - 'conv': Target MUST be a Stigix Fabric node (internal probe daemon required).
    - 'voice': Target MUST be a Stigix Fabric node (voice echo server required).
    - 'iot': Target MUST be a Stigix Fabric node.

    PROFILES:
    - 'xfr' (speedtest): Data transfer test. Fixed duration, stops automatically.
    - 'conv' (convergence): CONTINUOUS failover/probe test. DOES NOT STOP AUTOMATICALLY.
    - 'voice' / 'iot': Application-specific simulations.

    ⚠️  CONVERGENCE WORKFLOW (profile='conv') — MANDATORY BEHAVIOR:
    1. Call run_test once to START the test.
    2. Immediately inform the user of the test ID (e.g., "Test CONV-0129 started, dis-moi quand arrêter").
    3. STOP IMMEDIATELY — do NOT call get_test_status, do NOT poll.
    4. Wait for the user to explicitly say "stop" / "arrête" / "stop test".
    5. Only then call stop_test(test_id) to get final results.

    Args:
        source_id: Node ID (initiator).
        target_id: Node ID(S) (receivers). Use comma-separated list for multi-target: 'T1,T2'.
        profile: Test type ('xfr', 'speedtest', 'conv', 'voice', 'iot').
        duration: [XFR ONLY] Duration (e.g. '30s'). Ignored for 'conv'.
        bitrate: [XFR ONLY] (e.g. '200M').
        pps: [CONV ONLY] Probe rate (e.g. 100).
        protocol: [XFR ONLY] ('tcp', 'udp', 'quic').
        direction: [XFR ONLY] ('client-to-server', 'server-to-client', 'bidirectional').
        label: [CONV ONLY] Custom label for correlation.
    """
    
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
    try:
        status = await orchestrator.get_status(test_id)
        return status.model_dump()
    except ValueError as e:
        return {"error": str(e)}


@mcp.tool()
async def stop_test(test_id: str) -> dict:
    """
    Stop an active traffic test and retrieve final metrics.
    Call this ONLY when the user explicitly asks to stop (for convergence tests).
    After stopping, always summarize the final metrics (packets sent/received, loss %, latency, jitter).

    Args:
        test_id: The global test ID (e.g., G-20260313-ABCD) or a local ID (CONV-XXXX).
    """
    try:
        return await orchestrator.stop_test(test_id)
    except Exception as e:
        return {"error": str(e)}


@mcp.tool()
async def set_traffic_status(source_id: str, enabled: bool) -> dict:
    """
    Starts or stops the application traffic generation on a specific node.
    
    Args:
        source_id: ID of the node.
        enabled: True to start, False to stop.
    """
    source = await orchestrator.registry.get_endpoint(source_id)
    if not source:
        return {"error": f"Source {source_id} not found."}
    return await orchestrator.set_traffic_status(source, enabled)


@mcp.tool()
async def set_traffic_rate(agent_id: str, rate: float) -> dict:
    """
    Adjust the traffic generation speed (sleep interval between requests).
    
    Args:
        agent_id: ID of the node.
        rate: The delay in seconds between requests (0.1 to 10.0). 
              Lower is faster (0.1 = Turbo, 10.0 = Slow).
    """
    source = await orchestrator.registry.get_endpoint(agent_id)
    if not source:
        return {"error": f"Agent {agent_id} not found."}
    
    # Clip rate to reasonable values as per UI
    clipped_rate = max(0.1, min(10.0, rate))
    try:
        return await orchestrator.set_traffic_rate(source, clipped_rate)
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
    return await orchestrator.get_agent_dashboard(agent_id)


@mcp.tool()
async def get_app_score(agent_id: str, app_name: str) -> dict:
    """
    Calculate the success/error rate for a specific application on a node.
    
    Args:
        agent_id: ID of the node.
        app_name: Name of the application (e.g., 'teams', 'zoom', 'webex', 'teams.microsoft.com').
    """
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
async def get_security_test_options(agent_id: str, probe_type: str) -> dict:
    """
    Get the LIVE list of security test targets/categories for a specific probe type,
    fetched directly from the node's actual configured security profile.
    Always use this before run_security_probe to get the correct URLs and domains.

    Args:
        agent_id: ID of the Stigix node to query (required — options vary per node).
        probe_type: 'dns', 'url', or 'threat'.
    """
    return await orchestrator.get_security_profile_dynamic(agent_id, probe_type)


@mcp.tool()
async def run_security_probe(agent_id: str, probe_type: str, target: str) -> dict:
    """
    Launch a security test to check for policy enforcement (DNS, URL Filtering, or Threat/AV).
    It is RECOMMENDED to use 'get_security_test_options' first to propose a destination to the user.
    
    Args:
        agent_id: ID of the node.
        probe_type: 'dns' (domain), 'url' (full url), or 'threat' (malware/EICAR).
        target: The domain, URL, or Scenario ID to test.
                For 'threat', you can use 'STIGIX-EICAR-01' or a direct file URL.
    """
    return await orchestrator.trigger_security_test(agent_id, probe_type, target)


@mcp.tool()
async def list_vyos_routers(agent_id: str) -> List[dict]:
    """
    List all VyOS routers managed by a specific Stigix node.

    Use this to discover which Stigix node is the VyOS controller — i.e., which node
    manages the most routers or the central underlay router. Call this on several nodes
    (from list_endpoints) when it is not yet known which node controls VyOS.

    The node that returns the most routers (or the router whose interfaces match the
    user's intent) is the correct controller to use for subsequent vyos_execute_action calls.

    Args:
        agent_id: ID of the Stigix node to query. Do NOT assume a specific node — derive
                  the correct agent_id from list_endpoints() and user context.
    """
    return await orchestrator.list_vyos_routers(agent_id)


@mcp.tool()
async def list_vyos_scenarios(agent_id: str) -> List[dict]:
    """
    List available VyOS configuration sequences (scenarios) on a specific Stigix node.

    Args:
        agent_id: ID of the Stigix node. Use the VyOS controller node identified via
                  list_vyos_routers(), not the branch node for the site being configured.
    """
    return await orchestrator.list_vyos_sequences(agent_id)


@mcp.tool()
async def run_vyos_scenario(agent_id: str, scenario_id: str) -> dict:
    """
    Execute a VyOS configuration sequence (scenario) on a specific Stigix node.
    
    Args:
        agent_id: ID of the Stigix node.
        scenario_id: The ID of the sequence to run (e.g., 'failover-paris').
    """
    return await orchestrator.run_vyos_sequence(agent_id, scenario_id)


@mcp.tool()
async def get_vyos_timeline(agent_id: str, limit: int = 20) -> List[dict]:
    """
    Get the history of recent VyOS configuration changes on a specific Stigix node.
    
    Args:
        agent_id: ID of the Stigix node.
        limit: Number of recent actions to fetch (default 20).
    """
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
    return await orchestrator.set_vyos_scenario_status(agent_id, scenario_id, enabled)


@mcp.tool()
async def get_vyos_interfaces(agent_id: str, router_id: Optional[str] = None) -> List[dict]:
    """
    List VyOS routers and their CHAOS-ELIGIBLE interfaces managed by a Stigix node.

    Only interfaces that have a description configured are returned — interfaces without
    a description are management interfaces and are silently excluded from this list.
    They are never proposed as targets and Claude should never act on them.

    Each interface includes:
      - name       : OS interface name (e.g. eth1)
      - description: human-readable label set on VyOS (e.g. BR1-MPLS-197)
      - addresses  : list of IP/prefix (e.g. ["192.168.197.254/24"])
      - status     : 'up' | 'down' | 'unknown'  — reflects the VyOS admin state
                     ('down' means the interface has the 'disable' flag set on VyOS)

    Use the status field to:
      - Report interface state when the user asks "which interfaces are up/down?"
      - Warn the user before applying an action on a 'down' interface
      - Diagnose connectivity issues without executing any command

    ⚠️  CRITICAL — CONTROLLER DISCOVERY (read before choosing agent_id):
    ──────────────────────────────────────────────────────────────────────
    The mesh typically has ONE central Stigix node that manages the underlay VyOS router
    (the router that carries WAN interfaces for ALL branches: BR1-INET-*, BR2-MPLS-*, etc.).
    Branch Stigix nodes (BR1-Ubuntu, BR2-Ubuntu …) may also manage a LOCAL VyOS router
    for their own site — but that local router does NOT have the WAN interfaces for other sites.

    NEVER assume that "BR1 internet" means calling this tool with agent_id="BR1-Ubuntu".
    The interface labelled "BR1-INET-*" is on the central underlay router managed by
    the CONTROLLER node (often a different node, e.g., BR8-Ubuntu or Raspi4-Ubuntu).

    HOW TO FIND THE RIGHT CONTROLLER NODE:
    ──────────────────────────────────────
    1. If the user has already stated which Stigix node to use → use that node.
    2. If the user previously established a controller node (e.g., "control via BR8") → use it.
    3. If no controller is known yet:
       a. Call list_endpoints() to get all available Stigix node IDs.
       b. Call list_vyos_routers(agent_id) on 1–3 candidate nodes (prefer nodes whose
          name does NOT match the site being targeted, as a branch node rarely manages
          other branches' WAN interfaces).
       c. The node that returns the most VyOS routers, OR whose router interfaces contain
          descriptions matching the user's intent (e.g. "BR1-INET") → that is the controller.
       d. Announce which controller you are using: "I will use <NODE_ID> as the VyOS
          controller." Then proceed with this node for all subsequent VyOS actions.
    4. If still ambiguous, ASK the user: "Which Stigix node should I use as the VyOS
       controller? (e.g. BR8, Raspi4-Ubuntu, DC1...)" — do NOT guess.

    ⚠️  CRITICAL — SITE NAME RESOLUTION:
    ─────────────────────────────────────
    Site/router names mentioned by the user (e.g. "BR1", "BR2", "DC1", "HQ") are NOT
    Stigix agent IDs. They appear in the interface DESCRIPTIONS of the VyOS routers.

    NEVER respond with "I don't have a node called BR1" or similar.
    ALWAYS call this tool first and search the returned interface descriptions for
    keywords matching the user's intent (e.g. "BR1" matches description "BR1-MPLS-197").

    The correct flow when the user says "Add latency on BR1 MPLS":
      1. Identify the controller node (see CONTROLLER DISCOVERY above)
      2. Call get_vyos_interfaces(agent_id=<controller>) → receive all routers + interfaces
      3. Search descriptions for "BR1" AND "MPLS" → find eth1 "BR1-MPLS-197" on vyosrouter
      4. Propose: "I found eth1 (BR1-MPLS-197) on vyosrouter (via <controller>).
                   Shall I apply latency? (yes/no)"
      5. On confirmation → call vyos_execute_action

    ALWAYS CALL THIS FIRST before any vyos_execute_action.

    DISAMBIGUATION WORKFLOW (mandatory):
    ─────────────────────────────────────
    After receiving the list, you MUST:

    1. SCAN all returned interfaces across ALL routers for keyword matches with the
       user's intent (e.g. "MPLS", "WAN", "LAN", "DC1", "Internet" in the description).

    2. PRESENT the eligible interfaces to the user in a clean format:
       - Router name + status (online/offline)
       - For each chaos-eligible interface: name | description | IP | status (🟢 up / 🔴 down)

    3. IF exactly ONE interface matches the intent → propose it and ask for confirmation:
       "I found MPLS-Link-DC1 on vyoslandc1 / eth1 (192.168.281.18/24) — 🟢 up.
        Shall I apply [action] to this interface? (yes/no)"
       Warn the user if the interface is 'down' before confirming.
       Wait for user confirmation before calling vyos_execute_action.

    4. IF multiple interfaces match → list ALL candidates and ask the user to choose:
       "I found MPLS links on 2 routers:
        1. vyoslandc1 / eth1 — MPLS-Link-DC1 (192.168.281.18/24) — online
        2. vyoslandc2new / eth1 — MPLS-Link-DC2 (192.168.386.4/24) — online
       Which one should I target?"
       Do NOT call vyos_execute_action until the user picks one.

    5. IF a router is offline → warn the user, skip its interfaces.

    6. IF no interface matches the user's intent → tell the user and list all available
       descriptions so they can rephrase or pick one explicitly.

    7. IF a router has NO chaos-eligible interfaces at all (all management, no descriptions)
       → it will appear with chaos_eligible_interfaces: [] and a note. Inform the user that
       this router has no interfaces configured for chaos and how to add one.

    8. IF no router has any chaos-eligible interface → inform the user that natural language
       targeting is not possible and guide them to add descriptions on the VyOS routers:
         set interfaces ethernet ethX description "MPLS-Link-DC1"
       Without descriptions no action can be performed via this tool.

    Args:
        agent_id: ID of the Stigix controller node managing the VyOS routers.
                  Derive this from CONTROLLER DISCOVERY above — do NOT assume.
        router_id: Optional. Filter to a specific router ID. If omitted, returns all routers.
    """
    results = await orchestrator.get_vyos_interfaces(agent_id, router_id)

    # Filter: keep only chaos-eligible interfaces (those with a non-empty description).
    # Management interfaces (no description) are silently excluded.
    total_eligible = 0
    for r in results:
        if "error" in r:
            continue
        eligible = [
            iface for iface in r.get("interfaces", [])
            if iface.get("description") not in (None, "", "(no description)")
        ]
        r["interfaces"] = eligible
        r["chaos_eligible_count"] = len(eligible)
        total_eligible += len(eligible)
        if len(eligible) == 0:
            r["_note"] = (
                f"Router '{r.get('router_name', r.get('router_id'))}' has no chaos-eligible "
                "interfaces (no descriptions configured). To enable natural language targeting, "
                "add descriptions on the VyOS router: "
                "set interfaces ethernet ethX description 'MPLS-Link-DC1'"
            )

    if total_eligible == 0 and any("error" not in r for r in results):
        # Surface a top-level warning: nothing can be targeted by natural language
        for r in results:
            if "error" not in r:
                r["_global_warning"] = (
                    "No chaos-eligible interfaces found across any router on this node. "
                    "Natural language targeting is not possible until interface descriptions "
                    "are configured on the VyOS routers. "
                    "Example: set interfaces ethernet eth1 description 'MPLS-Link-DC1'"
                )
                break  # one warning is enough

    return results


@mcp.tool()
async def get_vyos_router_state(agent_id: str, router_id: str) -> dict:
    """
    Fetch the LIVE state of a specific VyOS router managed by a Stigix node.
    Read-only — safe to call at any time without side effects.

    Returns per-interface:
      - name, description, addresses
      - admin_state: 'up' | 'down'  (down = interface has 'disable' flag set)
      - qos_active: null if no QoS, otherwise {policy, delay_ms, loss_pct, rate, ...}

    Returns globally:
      - blackhole_blocks: list of {prefix, description} for tag-999 blackhole routes
      - blackhole_count: number of active IP blocks

    Use this tool when the user asks:
      - "What is the state of the VyOS routers?"
      - "Are there any interfaces down?"
      - "Is there any QoS active on the network?"
      - "Are there any IP blocks in place?"
      - "Show me the current network state / état des lieux"

    After receiving the data, present it as a structured summary:
      - List all interfaces with 🟢 up / 🔴 down status
      - For interfaces with qos_active: show parameters (e.g. "+150ms delay, 3% loss")
      - List blackhole IP blocks if any
      - Suggest relevant bulk reset actions if issues are found

    Args:
        agent_id: ID of the Stigix node (MCP gateway).
        router_id: ID of the specific VyOS router (e.g. 'vyosrouter', 'vyoslandc1').
    """
    return await orchestrator.get_vyos_state(agent_id, router_id)


@mcp.tool()
async def vyos_bulk_reset(
    agent_id: str,
    router_id: str,
    scope: str
) -> dict:
    """
    Execute a bulk reset action on a VyOS router.
    Always call get_vyos_router_state FIRST to know what actions are needed, then
    propose a clear summary to the user and require confirmation before executing.

    scope values:
      - 'all-qos'     : Clear QoS (latency/loss/rate) on ALL interfaces that have qos_active
      - 'all-blocks'  : Remove ALL blackhole IP blocks (tag-999) on this router
      - 'unshut-all'  : Bring up ALL interfaces with admin_state='down'
      - 'full-reset'  : Combination of all three above in order: clear-qos, clear-blocks, unshut

    Workflow (mandatory):
    1. Call get_vyos_router_state to get current state
    2. Build a list of affected elements:
       - For 'all-qos': interfaces where qos_active is not null
       - For 'all-blocks': all blackhole_blocks entries
       - For 'unshut-all': interfaces where admin_state == 'down'
    3. Present the plan to the user:
       "I am about to:
        - Clear QoS on eth1 (BR1-MPLS-197, +150ms), eth7 (BR2-INET-226, +300ms)
        - Remove 2 IP blocks: 1.2.3.4/32, 4.3.2.1/32
        Confirm? (yes/no)"
    4. Wait for user confirmation
    5. Execute via vyos_execute_action calls

    Args:
        agent_id: ID of the Stigix node.
        router_id: ID of the VyOS router to reset.
        scope: One of 'all-qos', 'all-blocks', 'unshut-all', 'full-reset'.
    """
    # Step 1: Get current state
    state = await orchestrator.get_vyos_state(agent_id, router_id)
    if "error" in state:
        return state

    interfaces = state.get("interfaces", [])
    blackhole_blocks = state.get("blackhole_blocks", [])

    actions_taken = []
    errors = []

    if scope in ("all-qos", "full-reset"):
        qos_ifaces = [i for i in interfaces if i.get("qos_active")]
        for iface in qos_ifaces:
            result = await orchestrator.vyos_execute_adhoc(
                agent_id=agent_id,
                router_id=router_id,
                command="clear-qos",
                interface=iface["name"]
            )
            if result.get("success") is not False:
                actions_taken.append(f"clear-qos on {iface['name']} ({iface.get('description', '')})")
            else:
                errors.append(f"clear-qos {iface['name']}: {result.get('error', 'unknown error')}")

    if scope in ("all-blocks", "full-reset"):
        if blackhole_blocks:
            result = await orchestrator.vyos_execute_adhoc(
                agent_id=agent_id,
                router_id=router_id,
                command="clear-blocks"
            )
            if result.get("success") is not False:
                actions_taken.append(f"clear-blocks: removed {len(blackhole_blocks)} IP block(s)")
            else:
                errors.append(f"clear-blocks: {result.get('error', 'unknown error')}")
        else:
            actions_taken.append("clear-blocks: no blocks to remove (already clean)")

    if scope in ("unshut-all", "full-reset"):
        down_ifaces = [i for i in interfaces if i.get("admin_state") == "down"]
        for iface in down_ifaces:
            result = await orchestrator.vyos_execute_adhoc(
                agent_id=agent_id,
                router_id=router_id,
                command="interface-up",
                interface=iface["name"]
            )
            if result.get("success") is not False:
                actions_taken.append(f"interface-up on {iface['name']} ({iface.get('description', '')})")
            else:
                errors.append(f"interface-up {iface['name']}: {result.get('error', 'unknown error')}")

    if scope not in ("all-qos", "all-blocks", "unshut-all", "full-reset"):
        return {
            "error": f"Unknown scope '{scope}'. Valid values: 'all-qos', 'all-blocks', 'unshut-all', 'full-reset'"
        }

    return {
        "success": len(errors) == 0,
        "scope": scope,
        "router_id": router_id,
        "actions_taken": actions_taken,
        "errors": errors,
        "summary": f"{len(actions_taken)} action(s) executed, {len(errors)} error(s)"
    }


@mcp.tool()
async def vyos_execute_action(
    agent_id: str,
    router_id: str,
    command: str,
    interface: Optional[str] = None,
    latency_ms: Optional[int] = None,
    loss_pct: Optional[float] = None,
    corruption_pct: Optional[float] = None,
    rate: Optional[str] = None,
    ip: Optional[str] = None
) -> dict:
    """
    Execute an ad-hoc VyOS network action on a specific router interface.
    Creates a temporary sequence, runs it immediately, then deletes it.
    Returns the result AND the VyOS CLI equivalent for full transparency.

    ⚠️  ONLY CALL THIS AFTER:
    1. Having called get_vyos_interfaces to list all routers and interfaces.
    2. Having identified the exact target router + interface (no ambiguity).
    3. Having presented the action to the user and received explicit confirmation.
       — For destructive commands (interface-down, deny-traffic) confirmation is MANDATORY.
       — For impairments (set-latency, set-loss, set-rate) always show what you are about to do.

    NEVER call this tool speculatively. Always resolve router_id and interface from
    get_vyos_interfaces output first.

    COMMANDS:
    - 'interface-down'   : Shut an interface down. Requires: interface
    - 'interface-up'     : Re-enable an interface. Requires: interface
    - 'set-impairment'   : Apply latency, packet loss, and/or bandwidth limit (any combination).
                           Maps to VyOS set-qos — pass only the params you need:
                             latency_ms=50          → 50ms delay
                             loss_pct=3             → 3% packet loss
                             rate='10mbit'          → bandwidth cap
                             latency_ms=100, loss_pct=5 → both at once
                           Requires: interface + at least one of latency_ms / loss_pct / rate
    - 'clear-qos'        : Remove all QoS impairments (latency/loss/rate). Requires: interface
    - 'deny-traffic'     : Add firewall rule to block an IP. Requires: ip
    - 'allow-traffic'    : Remove firewall block for an IP. Requires: ip
    - 'clear-all-blocks' : Remove all IP block rules.
    - 'show-denied'      : List currently blocked IPs.

    CONFIRMATION SCRIPT (use before calling):
    "I'm about to [command] on [router_name] / [interface] ([description]).
     This will [effect]. Confirm? (yes/no)"

    Args:
        agent_id:        Stigix node ID (e.g. 'BR8-Ubuntu').
        router_id:       VyOS router ID from get_vyos_interfaces (e.g. 'VYOS-DC1').
        command:         One of the commands listed above.
        interface:       Interface name (e.g. 'eth1'). Required for most commands.
        latency_ms:      Latency in ms. Used with 'set-latency'.
        loss_pct:        Packet loss % (0-100). Used with 'set-loss'.
        corruption_pct:  Corruption % (0-100). Used with 'set-corruption'.
        rate:            Bandwidth limit string (e.g. '10mbit'). Used with 'set-rate'.
        ip:              IP address. Used with 'deny-traffic' / 'allow-traffic'.
    """
    return await orchestrator.vyos_execute_adhoc(
        agent_id, router_id, command, interface,
        latency_ms, loss_pct, corruption_pct, rate, ip
    )


@mcp.tool()
async def get_dem_summary(agent_id: str) -> dict:
    """
    Get a summary of Digital Experience Monitoring (DEM) health and recent probe results.
    Returns global health score and individual probe statuses.
    
    Args:
        agent_id: ID of the Stigix node.
    """
    return await orchestrator.get_dem_stats(agent_id)


@mcp.tool()
async def get_probe_details(agent_id: str, probe_name: str) -> dict:
    """
    Get detailed performance metrics for a specific DEM probe (ICMP, HTTP, HTTPS, etc.).
    Returns rich stats like score, total_ms, and reachability.
    
    Args:
        agent_id: ID of the Stigix node.
        probe_name: Name or ID of the probe to investigate (e.g., 'Google DNS', 'SaaS App').
    """
    return await orchestrator.get_probe_performance(agent_id, probe_name)


# -----------------------------------------------------------------------------
# Phase 1 Tool Additions — Aligned with stigix-cli capabilities
# -----------------------------------------------------------------------------

@mcp.tool()
async def get_node_status(agent_id: str) -> dict:
    """
    Get a comprehensive status summary for a specific Stigix node.
    Aggregates health, version, traffic status, site info, and live convergence state.
    Use this as the first tool when troubleshooting or checking on a node.

    Args:
        agent_id: ID of the Stigix node (e.g., 'BR8', 'Hetzner').
    """
    return await orchestrator.get_node_status(agent_id)


@mcp.tool()
async def get_traffic_stats(agent_id: str) -> dict:
    """
    Get live traffic generation statistics for a specific node.
    Returns per-application request counts, error rates, client count,
    and current traffic running status.

    Args:
        agent_id: ID of the Stigix node.
    """
    return await orchestrator.get_traffic_stats(agent_id)


@mcp.tool()
async def get_traffic_logs(agent_id: str, limit: int = 50) -> dict:
    """
    Fetch recent traffic generation logs from a specific node.
    Useful for debugging application simulation issues.

    Args:
        agent_id: ID of the Stigix node.
        limit: Maximum number of log entries to return (default 50).
    """
    return await orchestrator.get_traffic_logs(agent_id, limit)


@mcp.tool()
async def get_security_results_stats(agent_id: str) -> dict:
    """
    Get the security posture scorecard for a Stigix node.

    Returns TWO sections:

    1. posture_scores — THE AUTHORITATIVE SECURITY SCORES (always use these):
       - url_filter        : weighted score 0–100 for URL filtering effectiveness
       - dns_security      : weighted score 0–100 for DNS threat blocking
       - threat_prevention : weighted score 0–100 for EICAR/threat file blocking
       These match exactly what is displayed in the Security dashboard.
       Scores are weighted by threat category severity, NOT a simple blocked/total ratio.

    2. score_trend — last 24 scoring runs, newest first. Each entry:
       { ts, type, url, dns, threat, trigger }
       Use this to describe score evolution (e.g. "DNS stable at 97.6, URL dropped from 38 to 36.8").

    REPORTING GUIDELINES:
    - Always lead with posture_scores
    - Describe trend if any score changed by more than 3 points over the last 24 runs
    - Do NOT mention or compute raw test counts — they come from a different source
      and will not match what the user sees in the Security Efficacy panel

    Args:
        agent_id: ID of the Stigix node (e.g. 'BR8-Ubuntu').
    """
    return await orchestrator.get_security_results_stats(agent_id)


@mcp.tool()
async def get_security_config(agent_id: str) -> dict:
    """
    Get the security policy configuration for a specific node.
    Returns both the module enable/disable config and the full dynamic test target profile
    (DNS domains, URL categories, threat scenarios) configured on the node.

    Args:
        agent_id: ID of the Stigix node.
    """
    return await orchestrator.get_security_config(agent_id)


@mcp.tool()
async def get_security_test_options_dynamic(agent_id: str, probe_type: str) -> dict:
    """
    Get the DYNAMIC list of security test targets/categories for a specific probe type,
    fetched live from the node's actual configured profile.
    Prefer this over 'get_security_test_options' as it reflects the real configuration.

    Args:
        agent_id: ID of the Stigix node to fetch the profile from.
        probe_type: 'dns', 'url', or 'threat'.
    """
    return await orchestrator.get_security_profile_dynamic(agent_id, probe_type)


@mcp.tool()
async def list_dem_probes(agent_id: str) -> dict:
    """
    List all configured Digital Experience Monitoring (DEM) probes on a specific node.
    Returns probe names, types (HTTP, PING, DNS, TCP, UDP), targets, and enabled status.

    Args:
        agent_id: ID of the Stigix node.
    """
    return await orchestrator.list_dem_probes(agent_id)


@mcp.tool()
async def run_dem_probes_now(agent_id: str) -> dict:
    """
    Trigger an immediate run of all DEM experience probes on a specific node.
    Returns RTT, status, and reachability for each probe.
    Note: This may take up to 30-60 seconds depending on the number of probes.

    Args:
        agent_id: ID of the Stigix node.
    """
    return await orchestrator.run_probes_now(agent_id)


@mcp.tool()
async def get_dem_probe_stats(agent_id: str) -> dict:
    """
    Get historical DEM probe statistics for a specific node.
    Returns the global health score, per-probe average latency, and reliability
    over the last hour. Includes raw probe results for detailed analysis.

    Args:
        agent_id: ID of the Stigix node.
    """
    return await orchestrator.get_dem_probe_stats(agent_id)


@mcp.tool()
async def list_fabric_targets(agent_id: str) -> dict:
    """
    List all manually-configured Stigix peer/fabric targets on a specific node.
    Returns each target's name, host, capabilities (xfr, voice, convergence, security),
    enabled status, and source (managed vs autodiscovered).

    Args:
        agent_id: ID of the Stigix node to query.
    """
    return await orchestrator.list_fabric_targets(agent_id)


@mcp.tool()
async def list_speedtest_history(agent_id: str, limit: int = 20) -> dict:
    """
    Get the speedtest (XFR) history for a specific node.
    Returns past test results including target, protocol, throughput (Mbps), RTT, and status.

    Args:
        agent_id: ID of the Stigix node.
        limit: Maximum number of historical results to return (default 20).
    """
    return await orchestrator.list_speedtest_history(agent_id, limit)


# -----------------------------------------------------------------------------
# Phase 2 Tool Additions
# -----------------------------------------------------------------------------

@mcp.tool()
async def run_security_url_batch(agent_id: str) -> dict:
    """
    Run a FULL batch URL filtering audit on a specific node.
    Automatically reads the enabled URL categories from the node's security config
    and tests all of them at once. Returns a summary (blocked/allowed/unknown)
    and individual results for each category.
    Note: This test can take up to 3 minutes to complete.

    Args:
        agent_id: ID of the Stigix node to run the audit on.
    """
    return await orchestrator.run_security_url_batch(agent_id)


@mcp.tool()
async def run_security_dns_batch(agent_id: str) -> dict:
    """
    Run a FULL batch DNS security audit on a specific node.
    Automatically reads the enabled DNS test domains from the node's security config
    and tests all of them at once. Returns a summary (blocked/allowed/unknown)
    and individual results for each domain.
    Note: This test can take up to 3 minutes to complete.

    Args:
        agent_id: ID of the Stigix node to run the audit on.
    """
    return await orchestrator.run_security_dns_batch(agent_id)


@mcp.tool()
async def add_dem_probe(
    agent_id: str,
    name: str,
    target: str,
    probe_type: str = "HTTP",
    timeout_ms: int = 5000
) -> dict:
    """
    Add a new Digital Experience Monitoring (DEM) probe to a specific node.
    The probe is appended to the existing list — existing probes are preserved.

    Args:
        agent_id: ID of the Stigix node.
        name: Display name for the probe (e.g., 'Google DNS', 'Azure West').
        target: Target host/URL/IP (e.g., 'https://example.com', '8.8.8.8', '1.2.3.4:5201').
        probe_type: Type of probe — 'HTTP', 'HTTPS', 'PING', 'TCP', 'UDP', or 'DNS'. Default: 'HTTP'.
        timeout_ms: Probe timeout in milliseconds. Default: 5000.
    """
    return await orchestrator.add_dem_probe(agent_id, name, target, probe_type, timeout_ms)


@mcp.tool()
async def remove_dem_probe(agent_id: str, probe_name: str) -> dict:
    """
    Remove a DEM experience probe by name from a specific node.
    The match is case-insensitive. All other probes are preserved.

    Args:
        agent_id: ID of the Stigix node.
        probe_name: Exact name of the probe to remove (case-insensitive).
    """
    return await orchestrator.remove_dem_probe(agent_id, probe_name)


@mcp.tool()
async def add_fabric_target(
    agent_id: str,
    name: str,
    host: str,
    voice: bool = True,
    convergence: bool = True,
    xfr: bool = True,
    security: bool = True,
    connectivity: bool = True
) -> dict:
    """
    Add a new Stigix fabric peer/target to a specific node.
    Use this to register a new branch or node into the mesh.

    Args:
        agent_id: ID of the Stigix node that will manage this target.
        name: Display name for the new target (e.g., 'Branch-Paris').
        host: IP address or FQDN of the target node.
        voice: Enable voice simulation capability. Default: True.
        convergence: Enable convergence/failover probe capability. Default: True.
        xfr: Enable XFR speedtest capability. Default: True.
        security: Enable security probe capability. Default: True.
        connectivity: Enable connectivity probe capability. Default: True.
    """
    return await orchestrator.add_fabric_target(agent_id, name, host, voice, convergence, xfr, security, connectivity)


@mcp.tool()
async def remove_fabric_target(agent_id: str, target_name_or_host: str) -> dict:
    """
    Remove a Stigix fabric peer/target from a specific node.
    Matches by name (case-insensitive), host IP, or ID prefix.

    Args:
        agent_id: ID of the Stigix node managing the target.
        target_name_or_host: Name, IP address, or ID prefix of the target to remove.
    """
    return await orchestrator.remove_fabric_target(agent_id, target_name_or_host)


@mcp.tool()
async def set_fabric_target_enabled(agent_id: str, target_name_or_host: str, enabled: bool) -> dict:
    """
    Enable or disable a Stigix fabric peer/target on a specific node.
    Disabled targets are ignored for testing but remain configured.

    Args:
        agent_id: ID of the Stigix node managing the target.
        target_name_or_host: Name, IP address, or ID prefix of the target.
        enabled: True to enable, False to disable.
    """
    return await orchestrator.set_fabric_target_enabled(agent_id, target_name_or_host, enabled)


@mcp.tool()
async def set_traffic_client_count(agent_id: str, client_count: int) -> dict:
    """
    Set the number of parallel traffic worker clients on a specific node.
    Higher values generate more concurrent application traffic (simulates more users).
    Valid range: 1 to 20.

    Args:
        agent_id: ID of the Stigix node.
        client_count: Number of parallel workers (1 = minimal, 20 = maximum density).
    """
    return await orchestrator.set_traffic_client_count(agent_id, client_count)


# -----------------------------------------------------------------------------
# Phase 3 Tool Additions
# -----------------------------------------------------------------------------

@mcp.tool()
async def run_full_security_audit(agent_id: str) -> dict:
    """
    Run the COMPLETE security suite on a specific node in one command.
    Executes 3 phases sequentially:
      1. URL Filtering batch (all enabled categories)
      2. DNS Security batch (all enabled domains)
      3. EICAR Threat Prevention (cloud EICAR URL)
    Returns detailed results for each phase plus a global summary.
    Note: This test can take up to 7-10 minutes to complete.
    Use this when you want a comprehensive security posture report for a node.

    Args:
        agent_id: ID of the Stigix node to audit.
    """
    return await orchestrator.run_full_security_audit(agent_id)


@mcp.tool()
async def run_eicar_test(agent_id: str, custom_url: Optional[str] = None) -> dict:
    """
    Run an EICAR malware/threat prevention test on a specific node.
    By default, uses the cloud EICAR URL fetched from the node itself.
    Optionally, supply a custom URL to test a specific threat vector.

    Args:
        agent_id: ID of the Stigix node.
        custom_url: Optional custom threat URL to test (e.g. a direct EICAR file URL).
                    If not provided, the node's configured cloud EICAR URL is used.
    """
    return await orchestrator.run_eicar_test(agent_id, custom_url)


@mcp.tool()
async def get_public_ip(agent_id: str) -> dict:
    """
    Get the public (WAN) exit IP address of a specific node.
    Useful to verify which internet path a node is using or confirm VPN/SD-WAN routing.

    Args:
        agent_id: ID of the Stigix node.
    """
    return await orchestrator.get_public_ip(agent_id)


@mcp.tool()
async def list_apps(agent_id: str) -> dict:
    """
    List all applications configured in the traffic simulation profile of a specific node.
    Shows which apps (Teams, Zoom, Salesforce, etc.) are being simulated.

    Args:
        agent_id: ID of the Stigix node.
    """
    return await orchestrator.list_apps(agent_id)


@mcp.tool()
async def export_app_config(agent_id: str) -> dict:
    """
    Export the full application traffic configuration from a specific node as JSON.
    Use this to backup a node's app profile before making changes,
    or to copy the config to another node via import_app_config.

    Args:
        agent_id: ID of the Stigix node to export from.
    """
    return await orchestrator.export_app_config(agent_id)


@mcp.tool()
async def import_app_config(agent_id: str, config: dict) -> dict:
    """
    Import an application traffic configuration to a specific node.
    WARNING: This OVERWRITES the current app config on the node.
    Use export_app_config first to get the config from another node, then pass it here.

    Args:
        agent_id: ID of the Stigix node to import to.
        config: The application config JSON object (obtained from export_app_config).
    """
    return await orchestrator.import_app_config(agent_id, config)


# -----------------------------------------------------------------------------
# Main Entry Point
# -----------------------------------------------------------------------------

# -----------------------------------------------------------------------------
# Phase 4 Tool Additions
# -----------------------------------------------------------------------------

@mcp.tool()
async def get_convergence_history(agent_id: str, limit: int = 10) -> dict:
    """
    Get the convergence/failover test history for a specific node.
    Returns past test results including the target peer, max blackout duration (ms),
    and a human-readable verdict (PERFECT / GOOD / DEGRADED / BAD / CRITICAL).

    Args:
        agent_id: ID of the Stigix node.
        limit: Maximum number of historical results to return (default 10).
    """
    return await orchestrator.get_convergence_history(agent_id, limit)


@mcp.tool()
async def list_security_results(agent_id: str, limit: int = 20) -> dict:
    """
    Get the last N individual security test results from a specific node.
    Returns all test types (URL, DNS, Threat) in chronological order (newest first).
    Useful for investigating recent security events or test failures.

    Args:
        agent_id: ID of the Stigix node.
        limit: Maximum number of results to return (default 20).
    """
    return await orchestrator.list_security_results(agent_id, limit)


@mcp.tool()
async def compare_nodes(agent_id_a: str, agent_id_b: str) -> dict:
    """
    Compare two Stigix nodes side-by-side across key dimensions.
    Fetches snapshots of both nodes in parallel and returns:
    - Per-node: health, version, traffic status, DEM health, security %, fabric peer count
    - A diff section highlighting any differences between the two nodes
    Use this to investigate why two nodes behave differently.

    Args:
        agent_id_a: ID of the first Stigix node.
        agent_id_b: ID of the second Stigix node.
    """
    return await orchestrator.compare_nodes(agent_id_a, agent_id_b)


@mcp.tool()
async def generate_report(agent_ids: Optional[List[str]] = None) -> dict:
    """
    Generate a fabric-wide summary report across all (or specified) Stigix nodes.
    Fetches node snapshots in parallel and returns:
    - Per-node: health, version, traffic status, DEM health, security %, peer count
    - Global summary: healthy/unhealthy count, traffic running count, total peers
    Use this to get an overview of the entire Stigix fabric at a glance.

    Args:
        agent_ids: Optional list of agent IDs to include. If omitted, reports on ALL registered nodes.
    """
    return await orchestrator.generate_report(agent_ids)


# -----------------------------------------------------------------------------
# Node Config Clone (Tool #52)
# -----------------------------------------------------------------------------

@mcp.tool()
async def clone_node_config(
    source_id: str,
    target_id: str,
    scope: Optional[List[str]] = None
) -> dict:
    """
    Clone configuration from one Stigix node to another.
    Reads config from source_id and writes it to target_id for each selected component.
    Each component is processed independently — partial success is reported.

    ⚠️  This is a WRITE operation — it OVERWRITES the target node's config for each scope item.
    Always confirm with the user before executing.

    Scope (optional, defaults to ALL):
    - 'apps'             : Application traffic simulation profile (URLs, apps, weights)
    - 'dem_probes'       : Custom DEM / connectivity probes (HTTP, HTTPS, PING, DNS...)
    - 'security_profile' : Vendor security test profile (URL categories, DNS domains)
    - 'vyos_scenarios'   : VyOS failover sequences

    Example use cases:
    - "Copie la config de BR8 vers BR5" → clone all components
    - "Clone seulement les probes DEM de BR8 vers DC1" → scope=['dem_probes']

    Args:
        source_id: Exact node ID from list_endpoints() (source).
        target_id: Exact node ID from list_endpoints() (destination).
        scope: Components to clone. Defaults to ['apps', 'dem_probes', 'security_profile', 'vyos_scenarios'].
    """
    return await orchestrator.clone_node_config(source_id, target_id, scope)


# -----------------------------------------------------------------------------
# Prisma Flow Browser (Tool #53)
# -----------------------------------------------------------------------------

@mcp.tool()
async def get_prisma_flows(
    agent_id: str,
    site_name: Optional[str] = None,
    site_id: Optional[str] = None,
    protocol: Optional[int] = None,
    udp_src_port: Optional[int] = None,
    udp_dst_port: Optional[int] = None,
    tcp_src_port: Optional[int] = None,
    tcp_dst_port: Optional[int] = None,
    src_ip: Optional[str] = None,
    dst_ip: Optional[str] = None,
    minutes: Optional[int] = 15,
    hours: Optional[int] = None,
    fast: Optional[bool] = False,
    page_size: Optional[int] = 10
) -> dict:
    """
    Query the Prisma SD-WAN Flow Browser to retrieve paths and stats for specific flows.
    Fetches the flows from the target site with filtering options.

    Args:
        agent_id: ID of the Stigix node executing the query (local backend).
        site_name: Name of the site to query flows for (alternative to site_id, e.g. 'BR8').
        site_id: UUID of the site to query.
        protocol: Filter by protocol number (6=TCP, 17=UDP, 1=ICMP).
        udp_src_port: Filter by UDP source port.
        udp_dst_port: Filter by UDP destination port.
        tcp_src_port: Filter by TCP source port.
        tcp_dst_port: Filter by TCP destination port.
        src_ip: Filter by source IP.
        dst_ip: Filter by destination IP.
        minutes: Number of minutes to look back (default: 15).
        hours: Number of hours to look back (overrides minutes).
        fast: Skip detailed VPN path name resolution to speed up execution.
        page_size: Maximum number of flow records to return.
    """
    body = {
        "site_name": site_name,
        "site_id": site_id,
        "protocol": protocol,
        "udp_src_port": udp_src_port,
        "udp_dst_port": udp_dst_port,
        "tcp_src_port": tcp_src_port,
        "tcp_dst_port": tcp_dst_port,
        "src_ip": src_ip,
        "dst_ip": dst_ip,
        "minutes": minutes,
        "hours": hours,
        "fast": fast,
        "page_size": page_size
    }
    # Clean None values
    body = {k: v for k, v in body.items() if v is not None}
    return await orchestrator.query_prisma_flows(agent_id, body)


# -----------------------------------------------------------------------------
# System Health Matrix & Live Diagnostics (Phase 1)
# -----------------------------------------------------------------------------

@mcp.tool()
async def get_health_matrix(agent_id: str) -> dict:
    """
    Get the 360° System Health Matrix of a Stigix node.
    Returns the global operational score (0-100%) and detailed status across all 9 subsystems:
    1. Prisma SD-WAN (TSG ID, controller connection, region)
    2. Stigix Mesh (Leader vs Branch mode, active leader IP, peer count)
    3. Stigix Cloud (Cloudflare Edge Worker keys & probe scenarios)
    4. Custom TCP Apps (active listeners, client workloads, registered apps)
    5. DEM Probes (configured synthetic endpoints)
    6. Voice & VoIP (G.711/Opus simulation daemon, MOS score)
    7. Live Events Bus (WebSocket streaming state)
    8. VyOS Underlay (configured routers, active interfaces, UP/SHUT ports)
    9. Host Hardware (Memory RAM used/total, Disk usage %, process uptime, host mode)

    Args:
        agent_id: ID of the Stigix node (from list_endpoints()).
    """
    return await orchestrator.get_health_matrix(agent_id)


@mcp.tool()
async def run_system_diagnostics(agent_id: str) -> dict:
    """
    Run live round-trip latency self-diagnostics across all 6 core engines of a Stigix node.
    Actively probes Prisma API, Cloudflare Workers, Mesh Leader sync, VyOS SSH API,
    Custom TCP App engine, and Host Memory I/O.
    Returns real-time latency (ms), health status, and diagnostic details per engine.

    Args:
        agent_id: ID of the Stigix node (from list_endpoints()).
    """
    return await orchestrator.run_system_diagnostics(agent_id)


# -----------------------------------------------------------------------------
# Voice & VoIP Analytics (Phase 1)
# -----------------------------------------------------------------------------

@mcp.tool()
async def get_voice_stats(agent_id: str) -> dict:
    """
    Get detailed outbound VoIP simulation statistics and quality metrics from a node.
    Returns overall and per-target MOS scores, jitter (ms), packet loss (%), and RTT.

    Args:
        agent_id: ID of the Stigix node.
    """
    return await orchestrator.get_voice_stats(agent_id)


@mcp.tool()
async def get_voice_ingress_calls(agent_id: str) -> dict:
    """
    Inspect incoming VoIP calls received on UDP port 6100 by a Stigix node.
    Identifies remote caller site tags embedded in RTP payloads, active call IDs,
    codecs used, and real-time MOS/jitter/loss metrics on ingress.

    Args:
        agent_id: ID of the Stigix node.
    """
    return await orchestrator.get_voice_ingress(agent_id)


# -----------------------------------------------------------------------------
# Custom TCP Applications (Phase 2)
# -----------------------------------------------------------------------------

@mcp.tool()
async def list_custom_tcp_apps(agent_id: str) -> dict:
    """
    List all configured Custom TCP Applications on a node and their live operational status.
    Returns app names, description, listener port/state, client workload state, target peers,
    RTT handshake latencies, throughput, and error rates.

    Args:
        agent_id: ID of the Stigix node.
    """
    return await orchestrator.list_custom_tcp_apps(agent_id)


@mcp.tool()
async def start_tcp_app_listener(agent_id: str, app_id: str) -> dict:
    """
    Start the local TCP server listener for a specific Custom TCP Application.

    Args:
        agent_id: ID of the Stigix node.
        app_id: Application identifier (e.g. 'app-erp', 'app-pos', 'app-sql').
    """
    return await orchestrator.start_tcp_app_listener(agent_id, app_id)


@mcp.tool()
async def stop_tcp_app_listener(agent_id: str, app_id: str) -> dict:
    """
    Stop the local TCP server listener for a specific Custom TCP Application.

    Args:
        agent_id: ID of the Stigix node.
        app_id: Application identifier (e.g. 'app-erp', 'app-pos', 'app-sql').
    """
    return await orchestrator.stop_tcp_app_listener(agent_id, app_id)


@mcp.tool()
async def start_tcp_app_workload(agent_id: str, app_id: str) -> dict:
    """
    Start outbound client synthetic workload generator for a Custom TCP Application.
    Generates synthetic TCP transactions towards remote branch/hub peers according to profile.

    Args:
        agent_id: ID of the Stigix node.
        app_id: Application identifier.
    """
    return await orchestrator.start_tcp_app_workload(agent_id, app_id)


@mcp.tool()
async def stop_tcp_app_workload(agent_id: str, app_id: str) -> dict:
    """
    Stop outbound client synthetic workload generator for a Custom TCP Application.

    Args:
        agent_id: ID of the Stigix node.
        app_id: Application identifier.
    """
    return await orchestrator.stop_tcp_app_workload(agent_id, app_id)


@mcp.tool()
async def test_tcp_app_handshake(agent_id: str, app_id: str, peer_id: Optional[str] = None) -> dict:
    """
    Execute an instant single-shot TCP 3-way handshake latency test to a target peer.
    Measures exact TCP SYN-ACK connection setup time in milliseconds without starting a continuous workload.

    Args:
        agent_id: ID of the Stigix node initiating the test.
        app_id: Application identifier.
        peer_id: Optional specific target peer ID. If omitted, tests the default configured primary peer.
    """
    return await orchestrator.test_tcp_app_handshake(agent_id, app_id, peer_id)


@mcp.tool()
async def get_tcp_app_sessions(agent_id: str, app_id: str) -> dict:
    """
    Inspect active incoming and outgoing TCP sessions for a Custom TCP Application.
    Shows client IPs, ports, duration, bytes exchanged, and state.

    Args:
        agent_id: ID of the Stigix node.
        app_id: Application identifier.
    """
    return await orchestrator.get_tcp_app_sessions(agent_id, app_id)


@mcp.tool()
async def reset_tcp_app_metrics(agent_id: str, app_id: str) -> dict:
    """
    Reset operational latency and bandwidth counters for a Custom TCP Application.

    Args:
        agent_id: ID of the Stigix node.
        app_id: Application identifier.
    """
    return await orchestrator.reset_tcp_app_metrics(agent_id, app_id)


# -----------------------------------------------------------------------------
# Target Controller & Mesh Leader (Phase 2)
# -----------------------------------------------------------------------------

@mcp.tool()
async def get_controller_status(agent_id: str) -> dict:
    """
    Get Target Controller and Mesh status on a Stigix node.
    Shows whether the node operates as Leader or Branch/Peer, configured Site Name,
    active Leader IP, discovery mode (Static vs Dynamic Autodiscover), and number of connected peers.

    Args:
        agent_id: ID of the Stigix node.
    """
    return await orchestrator.get_controller_status(agent_id)


@mcp.tool()
async def list_controller_peers(agent_id: str) -> dict:
    """
    List all remote branch nodes registered with the Leader node.
    Returns site names, LAN IPs, roles, capabilities (voice, xfr, failover, apps), and last heartbeat timestamps.

    Args:
        agent_id: ID of the Leader Stigix node.
    """
    return await orchestrator.list_controller_peers(agent_id)


@mcp.tool()
async def set_controller_leader(agent_id: str, leader_url: Optional[str] = None) -> dict:
    """
    Configure the central Leader for a branch node, or revert to dynamic autodiscovery.

    Args:
        agent_id: ID of the Stigix node.
        leader_url: IP or URL of the central Leader (e.g. '192.168.203.100'). If None/empty, reverts to Cloudflare dynamic autodiscovery.
    """
    return await orchestrator.set_controller_leader(agent_id, leader_url)


@mcp.tool()
async def generate_peer_onboard_command(agent_id: str) -> dict:
    """
    Generate a ready-to-run curl one-liner command to onboard and connect a new remote branch node to this Leader.

    Args:
        agent_id: ID of the Leader Stigix node.
    """
    return await orchestrator.generate_peer_onboard_command(agent_id)


# -----------------------------------------------------------------------------
# Global Configuration Provisioning (Phase 2)
# -----------------------------------------------------------------------------

@mcp.tool()
async def get_provisioning_status(agent_id: str) -> dict:
    """
    Get Global Configuration Provisioning status across the SD-WAN fabric.
    Shows whether provisioning pull mode is enabled, published revision hashes for all bundle types
    (applications, connectivity-probes, convergence-sla, security-config, voice-config, iot-config, custom-tcp-apps, prisma-sase),
    locally applied revisions on this node, and any pending unpublished changes.

    Args:
        agent_id: ID of the Stigix node.
    """
    return await orchestrator.get_provisioning_status(agent_id)


@mcp.tool()
async def set_provisioning_mode(agent_id: str, enabled: bool) -> dict:
    """
    Enable or disable the Global Provisioning pull daemon on a node.
    When enabled, the node automatically synchronizes published configuration bundles from the Leader.

    Args:
        agent_id: ID of the Stigix node.
        enabled: True to enable automatic pull mode, False to disable.
    """
    return await orchestrator.set_provisioning_mode(agent_id, enabled)


@mcp.tool()
async def publish_configuration_bundle(agent_id: str, bundle_type: str = "all") -> dict:
    """
    Publish local configuration bundle(s) across the entire SD-WAN mesh.
    Computes a new cryptographic revision hash and notifies all connected branch peers to pull the update.

    Bundle types:
    - 'all'                 : Publish all configuration bundles at once
    - 'applications'        : Traffic simulation applications & catalogues
    - 'connectivity-probes' : Synthetic DEM probes
    - 'convergence-sla'     : SLA thresholds and failover timers
    - 'security-config'     : Security audit URL categories & DNS domains
    - 'voice-config'        : VoIP call generators & targets
    - 'iot-config'          : IoT device simulation catalogues
    - 'custom-tcp-apps'     : Custom TCP application definitions & listeners
    - 'prisma-sase'         : Prisma SD-WAN credentials

    Args:
        agent_id: ID of the Leader Stigix node.
        bundle_type: Name of the bundle to publish (default 'all').
    """
    return await orchestrator.publish_configuration_bundle(agent_id, bundle_type)


@mcp.tool()
async def rollback_configuration_bundle(agent_id: str, bundle_type: str, revision: str) -> dict:
    """
    Rollback a configuration bundle to a prior revision hash across the mesh.

    Args:
        agent_id: ID of the Leader Stigix node.
        bundle_type: The bundle to rollback (e.g. 'applications', 'connectivity-probes', 'custom-tcp-apps').
        revision: Target revision hash to restore.
    """
    return await orchestrator.rollback_configuration_bundle(agent_id, bundle_type, revision)


@mcp.tool()
async def get_provisioning_history(agent_id: str, limit: int = 15) -> dict:
    """
    Get the audit trail of published configuration bundles and rollbacks on a node.

    Args:
        agent_id: ID of the Stigix node.
        limit: Number of history records to return (default 15).
    """
    return await orchestrator.get_provisioning_history(agent_id, limit)


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
