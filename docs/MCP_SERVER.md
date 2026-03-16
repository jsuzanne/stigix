# MCP Server for SD-WAN Traffic Generator

**Model Context Protocol (MCP) Server for Multi-Agent Orchestration**

---

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Quick Start](#quick-start)
- [Configuration](#configuration)
- [Natural Language Examples](#natural-language-examples)
- [Available Tools](#available-tools)
- [Traffic Profiles](#traffic-profiles)
- [Claude Desktop Setup](#claude-desktop-setup)
- [Troubleshooting](#troubleshooting)
- [Development](#development)

---

## Overview

The MCP Server provides a **natural language interface** to orchestrate multiple SD-WAN traffic generator instances simultaneously. Using Claude Desktop, you can manage traffic tests across multiple sites with simple conversational commands.

### Key Features

✅ **Multi-Agent Orchestration** - Control multiple traffic generators from one interface via the Cloudflare Registry.
✅ **Natural Language** - Use plain English/French with Claude Desktop.
✅ **Zero Code Changes** - Completely independent, communicates via REST APIs only.
✅ **Traffic Profiles** - Pre-configured parameters for raw (XFR), convergence, voice, and IoT tests.
✅ **Test Management** - Start, stop, monitor coordinated multi-target tests natively.

---

## Architecture

```text
┌─────────────────────┐
│  Claude Desktop     │  Natural Language Interface
│  (User)             │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐      1. Autodiscovery
│  MCP Server         │ ────────────────────────► ┌──────────────────────┐
│  (Docker Container) │                           │  Cloudflare Registry │
└──────────┬──────────┘ ◄──────────────────────── └──────────────────────┘
           │                 Returns active IPs
           ▼ HTTP APIs (JWT Auth)
┌─────────────────────────────────────┐
│  Traffic Generator Agents           │
│  ┌─────────┐  ┌─────────┐  ┌──────┐│
│  │ Paris   │  │ London  │  │ NYC  ││
│  └─────────┘  └─────────┘  └──────┘│
└─────────────────────────────────────┘
```

**Communication Flow:**
1. MCP Server queries the central Stigix Registry (`stigix-registry.stigix.workers.dev`) to find active nodes and their APIs.
2. User speaks to Claude Desktop in natural language.
3. Claude calls MCP tools (`list_endpoints`, `run_test`, `stop_test`).
4. MCP Server authenticates with JWT tokens and executes REST API calls across agents.
5. Results are aggregated, finalized, and returned to Claude.

*(For detailed API endpoints, see `API_REFERENCE.md`)*

---

## Quick Start

### 1. Build the MCP Server

```bash
cd /path/to/stigix
docker compose build mcp-server
```

### 2. Configure Environment

The MCP server relies on the centralized Stigix Registry for node discovery. Ensure your `.env` contains:
```env
STIGIX_REGISTRY_URL=https://stigix-registry.stigix.workers.dev
JWT_SECRET=your-global-secret
```

### 3. Start the MCP Server

```bash
# Option 1: Start individually
docker compose up -d mcp-server

# Option 2: Add mcp-server to default services by making sure it's untagged/enabled in docker-compose.yml
docker compose up -d
```

### 4. Verify It's Running

```bash
docker compose logs mcp-server
# Should see: "MCP Server ready (stdio transport)"
```

---

## Natural Language Examples

### List Available Endpoints

**English**: "What agents are available?"  
**French**: "Quels sont les agents disponibles ?"

**Claude calls**: `list_endpoints()`

**Response**: Prints a topology of available clients and servers, their IP addresses, and capacities.

---

### Start a Multi-Target Convergence Test

**English**: "Start a convergence test from Paris to London and NYC."  
**French**: "Lance un test de convergence depuis Paris vers London et NYC à 50 pps."

**Claude calls**: `run_test(source_id="paris", target_id="london,nyc", profile="conv", pps=50)`

**Response**: Reports the auto-generated Job ID and the Local Sub-IDs for each target flow (ex: `CONV-0021`).

---

### Stop a Convergence Test

**English**: "Stop the convergence test on Paris."  
**French**: "Arrête le test de convergence G-20260313-ABCD."

**Claude calls**: `stop_test(test_id="G-20260313-ABCD")`

**Response**: Sends the stop signal, waits for the backend grace period, and parses the final stabilised metrics (loss, latency, jitter).

---

### Start a Speedtest (XFR)

**English**: "Do a 30s bidirectional speedtest between Paris and NYC over UDP."  

**Claude calls**: `run_test(source_id="paris", target_id="nyc", profile="xfr", duration="30s", protocol="udp", direction="bidirectional")`

---

## Available Tools

| Tool | Description | Parameters |
|------|-------------|------------|
| `list_endpoints` | Scans the Registry for available routers/servers. | None |
| `run_test` | Starts a test (Speedtest, Convergence, etc.) from `source_id` to one/multiple `target_id`. | `source_id`, `target_id`, `profile`, `protocol`, `pps`, etc. |
| `stop_test` | Stops a long-running convergence test and fetches final metrics. | `test_id` (Global or Local ID) |
| `get_test_status`| Fetches live or historical metrics for a test. | `test_id` |
| `set_traffic_status` | Enables/Disables background application traffic on an endpoint. | `endpoint_id`, `status` ("on"/"off") |
| `set_voice_status` | Enables/Disables background VoIP QoS simulation. | `endpoint_id`, `status` |

---

## Claude Desktop Setup

### macOS Configuration

Edit `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "sdwan-traffic-gen": {
      "command": "docker",
      "args": [
        "exec",
        "-i",
        "sdwan-mcp",
        "python",
        "-m",
        "src.server"
      ]
    }
  }
}
```

### Windows Configuration

Edit `%APPDATA%\Claude\claude_desktop_config.json` with the same content.

### Restart Claude Desktop

After editing the config, **restart Claude Desktop** to load the MCP server.

---

## Troubleshooting

### MCP Server Not Appearing in Claude Desktop

**Symptoms**: Claude doesn't recognize MCP commands or says it has no tools.

**Solutions**:
1. Check `claude_desktop_config.json` syntax.
2. Ensure the container name `sdwan-mcp` matches the one running on your local Docker engine (`docker ps`).
3. Check MCP logs: `docker compose logs mcp-server`.

### Empty Endpoint List

**Symptoms**: `list_endpoints()` returns nothing.

**Solutions**:
1. Check network connectivity to the Cloudflare Worker URL.
2. Ensure your backend agents are actively pinging the registry. Re-run `node heartbeat.js` or standard boot sequences on the agents.

### Metrics are Zero when Stopping a Test

**Symptoms**: Claude returns 0% loss and 0 latency directly after a `stop_test`.

**Solutions**:
1. Ensure the `convergence_orchestrator.py` agent script is not crashing immediately on launch on the target node.
2. The MCP waits up to 10 seconds for history resolution. Check the `convergence-history.jsonl` file on the remote `source_id` to see if logs are writing correctly.

---

**For more API details**, see `API_REFERENCE.md`.
