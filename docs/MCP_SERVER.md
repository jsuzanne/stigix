# Stigix MCP Server

**Model Context Protocol (MCP) Server for Distributed Natural Language Orchestration**

---

## 🎯 Overview

The Stigix MCP Server provides a **natural language interface** to orchestrate your entire SD-WAN validation mesh. Using Claude Desktop, you can manage traffic tests, security probes, and network impairments across multiple sites using simple conversational commands.

### Key Features

✅ **Mesh-Ready Orchestration** - Control any node in the mesh from any other node via distributed discovery.
✅ **Natural Language** - Command your infrastructure in plain English or French.
✅ **Distributed Control** - The MCP server runs on every Stigix instance, providing total redundancy.
✅ **Full Toolset** - Integrated support for Speedtests (XFR), Convergence, Voice/IoT simulations, Security probes, and VyOS impairments.
✅ **SSE Transport** - Native support for Server-Sent Events (SSE) for easy remote access.

---

## 🏗️ Distributed Architecture

Starting with **v1.2.1-patch.204**, Stigix uses a fully distributed "Any-Node Control" architecture.

```text
┌─────────────────────┐      (Remote or Local)
│  Claude Desktop     │      Natural Language Interface
│  (User)             │
└──────────┬──────────┘
           │
           ▼ SSE (Port 3100)
┌─────────────────────┐      1. Registry Sync
│  Target MCP Server  │ ────────────────────────► ┌──────────────────────┐
│  (on Any Node)      │                           │   Stigix Registry    │
└──────────┬──────────┘ ◄──────────────────────── └──────────────────────┘
           │                 Full Mesh Visibility
           ▼ HTTP APIs (JWT Auth)
┌─────────────────────────────────────┐
│  Distributed Stigix Mesh            │
│  ┌─────────┐  ┌─────────┐  ┌──────┐│
│  │ Branch-1│  │ Branch-2│  │ DC-1 ││
│  └─────────┘  └─────────┘  └──────┘│
└─────────────────────────────────────┘
```

**How it works:**
1. **Registry Sync**: The Registry Leader distributes target configurations to all nodes.
2. **Ubiquitous MCP**: Every Stigix node runs an MCP server.
3. **Redundant Entry Points**: You can connect Claude to **any** node's IP. That node will use its synchronized registry to pilot any other node in the mesh.

---

## 🚀 Quick Start

### 1. Deployment
The MCP server is included by default in the Stigix `docker-compose.yml`. It starts automatically on port **3100** using the **SSE** transport.

### 2. Remote Access
Ensure port **3100** is reachable from your machine (or use an SSH tunnel).

### 3. Claude Desktop Setup

Depending on your OS, locate the configuration file (note the quotes for paths with spaces):
- **macOS**: `"~/Library/Application Support/Claude/claude_desktop_config.json"`
- **Windows**: `"%APPDATA%\Claude\claude_desktop_config.json"`

Add the following configuration (you can add multiple servers for different nodes):

```json
{
  "mcpServers": {
    "stigix-leader": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/inspector", "http://192.168.122.15:3100/sse"]
    },
    "stigix-br8": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/inspector", "http://192.168.203.102:3100/sse"]
    }
  }
}
```
*Replace `<NODE_IP>` with the IP of any Stigix instance.*

---

## 🛠️ Available MCP Tools

| Component | Tool Name | Description | Examples (Natural Language) |
| :--- | :--- | :--- | :--- |
| **Discovery** | `list_endpoints` | List Fabric nodes or targets. | *"Active nodes?", "Internet targets?", "List fabric endpoints"* |
| **Traffic** | `run_test` | Start xfr, conv, voice, iot test. | *"Speedtest BR1->Paris", "Probe to 8.8.8.8 (100 PPS)"* |
| **Traffic** | `get_test_status` | Get metrics for a specific test. | *"Result for test G-2026...", "Stats for CONV-1234"* |
| **Traffic** | `stop_test` | Stop a long-running test. | *"Stop probe 8.8.8.8", "Kill test CONV-567"* |
| **Management** | `set_traffic_status` | Start/stop app traffic simulation. | *"Start traffic on Raspi4", "Disable simulation London"* |
| **Management** | `set_traffic_rate` | Adjust generation speed (0.1s - 10s). | *"Turbo mode on BR1 (0.1s)", "Slow down Paris to 5s"* |
| **Management** | `set_voice_status` | Start/stop voice simulation. | *"Launch voice sim on BR1", "Stop VoIP Paris"* |
| **Diagnostics** | `get_diagnostics` | Full node dashboard & health. | *"Health of node BR1", "Dashboard for Raspi4", "CPU/RAM Paris"* |
| **Diagnostics** | `get_app_score` | Success rate for a specific app. | *"Teams score on Raspi4", "Webex stats London"* |
| **Security** | `get_security_test_options` | Available targets (DNS/URL/Threat). | *"DNS options?", "Malware sites?", "Threat scenarios"* |
| **Security** | `run_security_probe` | Test DNS/URL/Threat filtering. | *"Test malware.com", "Check EICAR on BR1"* |
| **VyOS** | `list_vyos_routers` | List managed VyOS routers. | *"VyOS routers managed by BR1", "List VyOS gear"* |
| **VyOS** | `list_vyos_scenarios` | List config sequences (scenarios). | *"Available scenarios?", "Failover sequences"* |
| **VyOS** | `run_vyos_scenario` | Execute a config sequence. | *"Apply failover-paris", "Run mission force-4g"* |
| **VyOS** | `get_vyos_timeline` | History of VyOS changes. | *"Recent VyOS changes", "Router history"* |
| **VyOS** | `set_vyos_scenario_status` | Enable/Disable a cyclic scenario. | *"Stop cyclic flapping", "Disable seq-123"* |
| **DEM** | `get_dem_summary` | Global Experience score & status. | *"Global DEM state", "Which probes are failing?"* |
| **DEM** | `get_probe_details` | Detailed metrics for one probe. | *"Details for Google DNS probe", "Analyze latency for SaaS"* |

---

## 💡 Usage Examples

### 1. Target Compatibility Rules (Important)
Before launching a test, ensure the target endpoint supports the requested profile:

- **`xfr` (Speedtest)**: Requires a Stigix node or a dedicated XFR target.
- **`conv` (Convergence)**: Requires a Stigix Fabric node (it uses internal probing daemons).
- **`voice` (VoIP)**: Requires a Stigix Fabric node (it uses the Voice Echo server).
- **`iot` (Data)**: Requires a Stigix Fabric node.

> [!TIP]
> Use `list_endpoints` to check the `kind` and `capabilities` of each node before proposing a test.

### 2. Performance & Troubleshooting
**User:** *"Teams quality is bad at the Paris site, can you investigate?"*
- `get_app_score(agent_id="Paris-BR1", app_name="Teams")`
- `get_dem_summary(agent_id="Paris-BR1")`
- `get_probe_details(agent_id="Paris-BR1", probe_name="Microsoft 365")`
- `get_diagnostics(agent_id="Paris-BR1")`

### 2. Network Orchestration (VyOS)
**User:** *"Main link is down in Paris, failover to 4G."*
- `list_vyos_scenarios(agent_id="Paris-BR1")`
- `run_vyos_scenario(agent_id="Paris-BR1", scenario_id="force-4g-failover")`
- `get_vyos_timeline(agent_id="Paris-BR1")`

### 3. Security Validation
**User:** *"Verify if the URL filtering policy is active on node BR1."*
- `get_security_test_options(probe_type="url")`
- `run_security_probe(agent_id="BR1", probe_type="url", target="http://gambling.com")`
- `run_security_probe(agent_id="BR1", probe_type="threat", target="STIGIX-EICAR-01")`

### 4. Traffic Control & Simulation
**User:** *"I want to stress the network from London."*
- `set_traffic_status(source_id="London", enabled=true)`
- `set_traffic_rate(agent_id="London", rate=0.1)` (Turbo Mode)
- `run_test(source_id="London", target_id="Paris,DC1", profile="xfr", bitrate="200M")`

---

*Last Updated: March 16, 2026*
