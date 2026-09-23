# Stigix MCP Server

**Model Context Protocol (MCP) Server for Distributed Natural Language Orchestration**

---

## 🎯 Overview

The Stigix MCP Server provides a **natural language interface** to orchestrate your entire SD-WAN validation mesh. Using Claude Desktop, you can manage traffic tests, security probes, network impairments, DEM experience monitoring — all from conversational commands.

### Key Features

✅ **Mesh-Ready Orchestration** - Control any node in the mesh from any other node via distributed discovery.  
✅ **Natural Language** - Command your infrastructure in plain English or French.  
✅ **Distributed Control** - The MCP server runs on every Stigix instance, providing total redundancy.  
✅ **Full Toolset** - 80 tools covering 100% of stigix-cli capabilities: traffic, security, DEM probes, custom TCP apps, voice ingress, mesh controller & provisioning, system health matrix, fabric targets, VyOS, config clone, and analytics.  
✅ **SSE Transport** - Native support for Server-Sent Events (SSE) for easy remote access.  
✅ **Interactive Enterprise Demo Script** - See [MCP Demo Scenario](file:///Users/jsuzanne/Github/stigix/docs/MCP_DEMO_SCENARIO.md) for a step-by-step 360° validation walkthrough and [MCP Failover Live Prompt](file:///Users/jsuzanne/Github/stigix/docs/MCP_FAILOVER_PROMPT.md) for automated live SD-WAN failover simulation.  

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

### ⚠️ Cross-Node Prerequisite: Shared `JWT_SECRET`

For the MCP to orchestrate tests **across nodes** (e.g., launching a speedtest from BR5 via the MCP connected to BR8), **all Stigix nodes must share the same `JWT_SECRET`**.

The MCP signs every cross-node API call with its own `JWT_SECRET`. If the remote node uses a different secret, it rejects the request with HTTP 401 — silently returning empty results.

> [!IMPORTANT]
> The `install.sh` script generates a **unique random secret per node**. In a multi-node fabric, you must manually synchronize this secret across all nodes.

**Setup (run on each node):**
```bash
# Set the shared secret in .env (use the same value on all nodes)
echo "JWT_SECRET=<your-shared-secret>" >> ~/stigix/.env

# Restart to apply
docker compose -f docker-compose-latest-beta.bridge.yml restart
```

**Verify:**
```bash
# Each node should show the same value
docker exec stigix printenv JWT_SECRET
```

---

## 🚀 Quick Start

### 1. Deployment
The MCP server is included by default in the Stigix `docker-compose.yml`. It starts automatically on port **3100** using the **SSE** transport.

### 2. Prerequisites
Depending on the setup method you choose below, you will need:
* **Option A (Node/npx Method - Recommended):** Node.js installed on your machine (provides the `npx` command).
* **Option B (Python Bridge Method):** Python 3.10+ installed on your machine.

---

## 🚦 Claude Desktop Configuration

Stigix uses **Server-Sent Events (SSE)** for remote connectivity. Since Claude Desktop primarily supports **STDIO**, you can connect to it using one of the following two options:

### 1. Locate your Configuration File
Open the `claude_desktop_config.json` file on your machine:
- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

---

### Option A: Zero-Setup (Node/npx Method) — Recommended
If you have **Node.js** installed, this is the easiest option because it does not require cloning this repository, setting up Python, or configuring virtual environments.

Add this entry under `mcpServers` (replace the URL with the IP/port of your Stigix instance):

```json
{
  "mcpServers": {
    "stigix-cloud": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/inspector",
        "http://<STIGIX_NODE_IP>:3100/sse"
      ]
    }
  }
}
```

---

### Option B: Local Python Bridge Method
Use this option if you do not have Node.js installed, or if you prefer running the Python bridge script locally.

#### Step 0: Clone the Repository
Since this method relies on local scripts (`setup-bridge.sh`, `bridge.py`, etc.), you must first clone the Stigix repository to your machine if you haven't already:
```bash
git clone https://github.com/jsuzanne/stigix.git
cd stigix
```

#### Step 1: Initialize the local python environment

Choose the setup instructions matching your operating system:

##### 🍎 macOS / Linux
Open your terminal, navigate to your cloned `stigix` repository directory, and run:
```bash
# Make the setup script executable
chmod +x ./mcp-server/setup-bridge.sh

# Run the setup script
./mcp-server/setup-bridge.sh
This script automatically checks for Python 3 (requires Python 3.10 or higher), creates a `.venv` folder, and installs all the required libraries for you.

**Example output of a successful installation:**
```text
🚀 Setting up Stigix MCP Bridge in /Users/jsuzanne/Github/stigix/mcp-server...
🐍 Using Python executable: /opt/homebrew/bin/python3.11 (Python 3.11.15)
📦 Creating virtual environment...
📥 Installing dependencies...
Collecting pip
  Downloading pip-26.0.1-py3-none-any.whl (1.8 MB)
...
Successfully installed mcp-1.2.1 fastmcp-0.4.1 ...

✅ Setup Complete!
--------------------------------------------------------
To use this bridge in Claude Desktop, use these paths:

Python: /Users/jsuzanne/Github/stigix/mcp-server/.venv/bin/python3
Bridge: /Users/jsuzanne/Github/stigix/mcp-server/bridge.py
--------------------------------------------------------
```

##### 🪟 Windows (PowerShell)
Open PowerShell, navigate to your cloned `stigix` repository directory, and run:
```powershell
# Navigate into the mcp-server directory
cd mcp-server

# Create the Python virtual environment
python -m venv .venv

# Upgrade pip and install the required dependencies
.\.venv\Scripts\pip.exe install --upgrade pip
.\.venv\Scripts\pip.exe install -r .\requirements.txt
```

#### Step 2: Configure Claude Desktop
Add this entry under `mcpServers` in your configuration file:

**macOS / Linux:**
```json
{
  "mcpServers": {
    "stigix-bridge": {
      "command": "<PATH_TO_STIGIX_REPOSITORY>/mcp-server/.venv/bin/python3",
      "args": [
        "<PATH_TO_STIGIX_REPOSITORY>/mcp-server/bridge.py",
        "http://<STIGIX_NODE_IP>:3100/sse"
      ],
      "env": {
        "PYTHONPATH": "<PATH_TO_STIGIX_REPOSITORY>/mcp-server"
      }
    }
  }
}
```

**Windows (PowerShell):**
```json
{
  "mcpServers": {
    "stigix-bridge": {
      "command": "C:\\path\\to\\stigix\\mcp-server\\.venv\\Scripts\\python.exe",
      "args": [
        "C:\\path\\to\\stigix\\mcp-server\\bridge.py",
        "http://<STIGIX_NODE_IP>:3100/sse"
      ],
      "env": {
        "PYTHONPATH": "C:\\path\\to\\stigix\\mcp-server"
      }
    }
  }
}
```

> [!IMPORTANT]
> - **Paths**: Replace `<PATH_TO_STIGIX_REPOSITORY>` (or `C:\path\to\stigix`) with the actual absolute path to where you cloned the repository.
> - **URL**: Replace `<STIGIX_NODE_IP>` with the IP of the Stigix instance you want to pilot.
> - **Windows paths**: Use double backslashes `\\` in JSON strings, or forward slashes `/`.

---

### 3. Verify Connection
1. **Restart Claude Desktop** completely (Cmd+Q, then reopen).
2. Click the 🔨 **hammer icon** (bottom right of the prompt box).
3. If everything is correct, you should see your configured server with a green status and the full list of tools.

### 4. Troubleshooting
If the server doesn't appear or shows a red error:
- Check the bridge logs on macOS: `tail -f ~/Library/Logs/Claude/mcp.log`
- Manually test the Python bridge (if using Option B):
  ```bash
  <PATH_TO_STIGIX_REPOSITORY>/mcp-server/.venv/bin/python3 <PATH_TO_STIGIX_REPOSITORY>/mcp-server/bridge.py http://<STIGIX_NODE_IP>:3100/sse
  ```
  If it says `"Bridge initialized. Ready for Claude"`, the python setup is correct.

#### ⚠️ Cross-Node Tests return `tests: []` (empty)

When orchestrating a test **from** one node **via** another (e.g., MCP on BR8 launching a speedtest from BR5), all nodes **must share the same `JWT_SECRET`**.

The MCP server signs API calls with its own `JWT_SECRET`. If the target node uses a different `JWT_SECRET`, it rejects the call with HTTP 401 — which results in a silent `tests: []` response.

**Diagnosis:**
```bash
# Check JWT_SECRET on each node
docker exec stigix printenv JWT_SECRET
```

**Fix:** set the same `JWT_SECRET` in the `.env` file on every node:
```bash
# On each node (BR5, DC1, etc.)
echo "JWT_SECRET=<your-shared-secret>" >> ~/stigix/.env
docker compose -f docker-compose-latest-beta.bridge.yml restart
```

> [!IMPORTANT]
> After patch.128, failed cross-node tests will return `status: "error"` with the actual error message instead of `tests: []`, making diagnosis much easier.



## 🛠️ Available MCP Tools (80 tools)

> [!TIP]
> All tools that target a specific node accept an `agent_id` parameter — this is the node's name as shown in `list_endpoints` (e.g., `"BR8"`, `"Paris"`, `"Hetzner"`).

### Discovery & Status (5 tools)

| Tool | Description | Example |
|---|---|---|
| `list_endpoints` | List all fabric nodes or internet targets | *"Active nodes?", "Internet targets?"* |
| `get_node_status` | Full status summary (health, version, traffic, site, convergence) | *"Status of BR8?", "Is Paris healthy?"* |
| `get_public_ip` | WAN exit IP of a node | *"What's the public IP of BR8?"* |
| `generate_report` | Fabric-wide report across all (or specified) nodes in parallel | *"Give me an overview of all nodes"* |
| `compare_nodes` | Side-by-side comparison of two nodes | *"Compare BR8 and Hetzner"* |

### Traffic Generation (9 tools)

| Tool | Description | Example |
|---|---|---|
| `set_traffic_status` | Start or stop application traffic simulation | *"Start traffic on BR8"* |
| `set_traffic_rate` | Adjust traffic speed (0.1s – 10s delay) | *"Turbo mode on BR8"* |
| `set_traffic_client_count` | Set number of parallel workers (1–20) | *"Set 10 clients on Paris"* |
| `set_voice_status` | Start or stop voice simulation | *"Launch voice sim on BR8"* |
| `get_traffic_stats` | Live per-app request counts, error rates, client count | *"Traffic stats for BR8?"* |
| `get_traffic_logs` | Recent traffic generation logs | *"Show last 50 logs for BR8"* |
| `list_apps` | Apps configured in the traffic profile | *"What apps is BR8 simulating?"* |
| `export_app_config` | Export app config as JSON (for backup or cloning) | *"Export BR8's app config"* |
| `import_app_config` | Import app config to a node (overwrites current) | *"Copy Paris app config to BR8"* |

### Voice Simulation & Ingress Monitoring (2 tools)

| Tool | Description | Example |
|---|---|---|
| `get_voice_stats` | Deep voice metrics (MOS, jitter, packet loss, active calls) | *"Voice quality stats on BR8"* |
| `get_voice_ingress_calls` | Ingress RTP audio streams, NAT-proof tagging, peer breakdown | *"List active incoming voice streams on DC1"* |

### Test Orchestration (3 tools)

| Tool | Description | Example |
|---|---|---|
| `run_test` | Start XFR, convergence, voice, or IoT test | *"Speedtest BR8 → Paris"* |
| `get_test_status` | Get metrics for a running or completed test | *"Status of test CONV-1234?"* |
| `stop_test` | Stop a running test | *"Stop the convergence test"* |

### XFR Speedtest (1 tool)

| Tool | Description | Example |
|---|---|---|
| `list_speedtest_history` | Past XFR speedtest results with throughput, RTT, status | *"Last speedtests from BR8?"* |

### Convergence / Failover (1 tool)

| Tool | Description | Example |
|---|---|---|
| `get_convergence_history` | Past failover tests with max blackout (ms) and verdict | *"Convergence history for BR8?"* |

### Security Testing (10 tools)

| Tool | Description | Example |
|---|---|---|
| `get_security_results_stats` | Security test scorecard (blocked/allowed summary) | *"Security score for BR8?"* |
| `list_security_results` | Last N individual security test results (all types) | *"Last 20 security tests on BR8"* |
| `get_security_config` | Security policy config + dynamic test target profile | *"Security config on BR8?"* |
| `get_security_test_options` | Available test options (static list, legacy) | *"DNS test options?"* |
| `get_security_test_options_dynamic` | Live test options fetched from node profile | *"URL filtering options on BR8?"* |
| `run_security_probe` | Run a single DNS / URL / Threat test | *"Test malware.com on BR8"* |
| `run_security_url_batch` | Full URL filtering audit (all enabled categories) | *"Run full URL audit on BR8"* |
| `run_security_dns_batch` | Full DNS security audit (all enabled domains) | *"Run full DNS audit on BR8"* |
| `run_eicar_test` | EICAR threat prevention test (cloud URL or custom) | *"EICAR test on BR8"* |
| `run_full_security_audit` | Complete suite: URL batch + DNS batch + EICAR | *"Full security audit on BR8"* |

### DEM / Experience Probes (8 tools)

| Tool | Description | Example |
|---|---|---|
| `get_dem_summary` | Global DEM health score and status | *"DEM overview for BR8?"* |
| `get_probe_details` | Detailed metrics for one probe by name | *"Details for Google DNS probe on BR8"* |
| `list_dem_probes` | List all configured DEM probes | *"What probes are on BR8?"* |
| `run_dem_probes_now` | Trigger immediate probe run, return results | *"Run probes now on BR8"* |
| `get_dem_probe_stats` | Historical DEM stats: median, p95, success rate with name filter & aggregation | *"DEM stats for BR8 filtering 'MS -'"* |
| `update_dem_probe` | Update probe settings (status codes, timeout, interval) without losing history | *"Update Office 365 probe to accept 200,204,401"* |
| `add_dem_probe` | Add a new DEM probe (HTTP/HTTPS/PING/TCP/UDP/DNS) | *"Add a PING probe to 8.8.8.8 on BR8"* |
| `remove_dem_probe` | Remove a probe by name | *"Remove 'Google DNS' probe from BR8"* |

### Custom TCP Applications & Workloads (11 tools)

| Tool | Description | Example |
|---|---|---|
| `create_custom_tcp_app` | Create and deploy custom TCP application (POS, CRM, ERP, etc.) with auto-peering | *"Deploy POS app on port 9000"* |
| `list_custom_tcp_apps` | List all custom TCP apps, listening ports, traffic status, and peer assignments | *"List custom TCP apps on DC1"* |
| `add_tcp_app_peer` | Attach a target mesh peer to an existing custom TCP app | *"Add BR8 as peer to app-pos"* |
| `delete_custom_tcp_app` | Delete a custom TCP application and release ports | *"Delete app-pos on DC1"* |
| `start_tcp_app_listener` | Start TCP server daemon listening on a specific port | *"Start listener for app-pos on DC1"* |
| `stop_tcp_app_listener` | Stop TCP server daemon on a specific port | *"Stop listener for app-pos on DC1"* |
| `start_tcp_app_workload` | Start periodic simulated client traffic generator | *"Start workload for app-pos on BR8"* |
| `stop_tcp_app_workload` | Stop periodic simulated client traffic generator | *"Stop workload for app-pos on BR8"* |
| `test_tcp_app_handshake` | Execute instant one-shot SYN/ACK 3-way handshake round-trip probe | *"Test TCP handshake to DC1:9000 from BR8"* |
| `get_tcp_app_sessions` | Retrieve active TCP connections, states, and byte counters | *"Show active sessions for app-pos"* |
| `reset_tcp_app_metrics` | Reset session, handshake, and throughput counters for an app | *"Reset metrics for app-pos on BR8"* |

### Multi-Instance Controller & Mesh Management (4 tools)

| Tool | Description | Example |
|---|---|---|
| `get_controller_status` | Controller operational mode (Leader vs Member), sync state, and active leader IP | *"Is DC1 the mesh leader?"* |
| `list_controller_peers` | List all connected mesh peers, sync health, and heartbeat latency | *"Show all mesh peers on DC1"* |
| `set_controller_leader` | Promote or designate node as the active configuration Leader | *"Set DC1 as the Leader"* |
| `generate_peer_onboard_command` | Generate zero-touch Docker CLI / curl onboarding snippet to attach a new peer | *"Generate onboard command for new branch"* |

### Global Mesh Provisioning & Central Distribution (5 tools)

| Tool | Description | Example |
|---|---|---|
| `get_provisioning_status` | Global provisioning status, bundle version (e.g. rev 22), published bundles | *"Provisioning status on DC1"* |
| `set_provisioning_mode` | Toggle provisioning synchronization mode (`automatic` vs `manual`) | *"Set provisioning to automatic"* |
| `publish_configuration_bundle` | Publish configuration bundle (`connectivity-probes`, `custom-tcp-apps`, `traffic-profiles`) to mesh | *"Publish custom TCP apps to all peers"* |
| `rollback_configuration_bundle` | Rollback a configuration bundle to previous revision | *"Rollback custom-tcp-apps to rev 21"* |
| `get_provisioning_history` | Audit trail of all published revisions, timestamps, and target peers | *"Show provisioning history on DC1"* |

### System Health Matrix & Live Diagnostics (2 tools)

| Tool | Description | Example |
|---|---|---|
| `get_health_matrix` | 360° System Health Matrix across all 9 subsystems (operational score 0-100%) | *"Show health matrix for BR8"* |
| `run_system_diagnostics` | Run deep diagnostic checks across all subsystems on demand | *"Run full system diagnostics on BR8"* |

### Diagnostics & Analytics (4 tools)

| Tool | Description | Example |
|---|---|---|
| `get_diagnostics` | Full node dashboard: CPU, bitrate, app stats, voice, peers | *"Health of BR8", "CPU/RAM Paris"* |
| `get_app_score` | Success rate for a specific application | *"Teams score on BR8?"* |
| `get_prisma_flows` | Query Prisma SD-WAN Flow Browser for path/session details | *"Query Prisma flows on BR8 for UDP port 30075"* |
| `run_path_trace` | Live traceroute / hop-by-hop latency and drop inspection | *"Traceroute from BR8 to 192.168.203.100"* |

### Configuration Synchronization (1 tool)

| Tool | Description | Example |
|---|---|---|
| `clone_node_config` | Clone configuration (apps, DEM probes, security profile, VyOS) between nodes | *"Clone DEM probes from BR8 to BR5"* |

### Fabric Target Management (4 tools)

| Tool | Description | Example |
|---|---|---|
| `list_fabric_targets` | List all peer targets with capabilities | *"What are BR8's fabric targets?"* |
| `add_fabric_target` | Register a new peer in the mesh | *"Add Hetzner (1.2.3.4) as a target on BR8"* |
| `remove_fabric_target` | Remove a peer by name, host, or ID | *"Remove Hetzner target from BR8"* |
| `set_fabric_target_enabled` | Enable or disable a peer target | *"Disable Paris target on BR8"* |

### VyOS Router Management (10 tools)

| Tool | Description | Example |
|---|---|---|
| `list_vyos_routers` | List managed VyOS routers | *"VyOS routers managed by BR8"* |
| `list_vyos_scenarios` | List available config sequences | *"Available VyOS scenarios?"* |
| `run_vyos_scenario` | Execute a config sequence | *"Apply failover-paris scenario"* |
| `get_vyos_timeline` | History of VyOS configuration changes | *"Recent VyOS changes on BR8"* |
| `set_vyos_scenario_status` | Enable or disable a cyclic scenario | *"Stop cyclic flapping on BR8"* |
| `get_vyos_interfaces` | List VyOS router interfaces with descriptions and up/down status — required first step before ad-hoc actions | *"Show interfaces of the router on BR8"* |
| `vyos_execute_action` | Execute any VyOS action via natural language: shut/enable interface, add latency/loss/rate, block/unblock IP | *"Shut MPLS on BR1"*, *"Add 150ms latency on WAN"*, *"Block 10.0.0.5"* |
| `get_vyos_router_state` | **Live state audit**: per-interface admin status (🟢/🔴), active QoS params (delay/loss/rate), and all tag-999 IP blocks in one call | *"What is the current state of vyosrouter?"* |
| `list_active_impairments` | **Fabric Impairment Audit**: check all VyOS routers for active shaping, injected latency/loss, or shut links | *"Are there any active impairments left across the fabric?"* |
| `vyos_bulk_reset` | **Bulk reset**: clear all active QoS, remove all IP blocks, and/or unshut all down interfaces — scope: `all-qos`, `all-blocks`, `unshut-all`, `full-reset` | *"Reset everything on BR8"* |

> [!TIP]
> `get_vyos_interfaces` reads interface **descriptions** to resolve natural language intent. For `vyos_execute_action` to work with prompts like *"shut the MPLS link"*, descriptions must be set on the VyOS router (e.g., `set interfaces ethernet eth1 description "MPLS-Link-DC1"`). See [VYOS_CONTROL.md](VYOS_CONTROL.md) → *Interface Naming Best Practices*.

---

## 💡 Usage Examples

> [!TIP]
> Copy-paste these prompts directly into Claude Desktop. Replace `<NODE_ID>` with an actual node ID from `list_endpoints()`.

---

### 1. Discovery & Inventory

**List all nodes in the fabric:**
```
Show me all available Stigix endpoints.
```
→ `list_endpoints()` — Returns all fabric nodes and internet targets with their IDs.

**Filter by type:**
```
List only Stigix Fabric nodes.
List only Internet targets.
```
→ `list_endpoints(kind="fabric")` / `list_endpoints(kind="internet")`

**Fabric-wide report:**
```
Generate a full report across all Stigix nodes.
```
→ `generate_report()` — Fetches all nodes in parallel: health, version, traffic, DEM, security %, peer count + global summary.

---

### 2. Node Status & Diagnostics

**Full status of a node:**
```
Give me the full status of node <NODE_ID>.
```
→ `get_node_status(agent_id="<NODE_ID>")` — Health, version, traffic status, site info, convergence state.

**Full diagnostics dashboard:**
```
Show me the full diagnostics dashboard for node <NODE_ID>.
```
→ `get_diagnostics(agent_id="<NODE_ID>")` — CPU, bitrate, app stats, voice, peers.

**Public IP / WAN path:**
```
What is the public IP of node <NODE_ID>? What WAN path does it use?
```
→ `get_public_ip(agent_id="<NODE_ID>")`

**Side-by-side comparison:**
```
Compare nodes <NODE_ID_A> and <NODE_ID_B> side by side.
```
→ `compare_nodes(agent_id_a="<NODE_ID_A>", agent_id_b="<NODE_ID_B>")` — Health / version / traffic / DEM / security diff table.

---

### 3. Traffic Generation

**Start / stop traffic:**
```
Start application traffic generation on node <NODE_ID>.
Stop application traffic generation on node <NODE_ID>.
```
→ `set_traffic_status(source_id="<NODE_ID>", enabled=True/False)`

**Tune traffic intensity:**
```
Set the traffic rate on node <NODE_ID> to 0.5 seconds between requests.
Set node <NODE_ID> to 5 parallel simulated clients.
```
→ `set_traffic_rate(agent_id="<NODE_ID>", rate=0.5)` / `set_traffic_client_count(agent_id="<NODE_ID>", client_count=5)`

**Check simulated applications:**
```
Which applications are being simulated on node <NODE_ID>?
```
→ `list_apps(agent_id="<NODE_ID>")` — e.g. Teams, Zoom, Salesforce, …

**App-specific success rate:**
```
What is the success rate of Teams on node <NODE_ID>?
```
→ `get_app_score(agent_id="<NODE_ID>", app_name="teams")` — Success rate %, Healthy/Degraded/Critical.

**Recent traffic logs:**
```
Show me the last 20 traffic logs for node <NODE_ID>.
```
→ `get_traffic_logs(agent_id="<NODE_ID>", limit=20)`

---

### 4. Digital Experience Monitoring (DEM)

**DEM health overview:**
```
Give me the DEM summary for node <NODE_ID>.
```
→ `get_dem_summary(agent_id="<NODE_ID>")` — Global health score + per-probe status.

**List all probes:**
```
List all DEM probes configured on node <NODE_ID>.
```
→ `list_dem_probes(agent_id="<NODE_ID>")` — Name, type (HTTP/PING/DNS/TCP/UDP), target, enabled status.

**Historical probe stats (filtered & aggregated with median / p95):**
```
Show me DEM probe stats for node <NODE_ID> filtering only "MS -" probes over the last 60 minutes.
```
→ `get_dem_probe_stats(agent_id="<NODE_ID>", probe_name_filter="MS -", window_minutes=60, aggregate=True)`  
*Returns calculated median RTT, p95 RTT, min/max/avg latency, and success rates per probe, avoiding massive raw data payloads.*

**Update an existing probe (without losing historical data):**
```
Update the "Office 365" probe on node <NODE_ID> to accept HTTP status codes 200, 204, 301, 302, 401, 403 and set timeout to 5000ms.
```
→ `update_dem_probe(agent_id="<NODE_ID>", probe_name="Office 365", expected_status_codes=[200, 204, 301, 302, 401, 403], timeout_ms=5000)`

**Details for a specific probe:**
```
Give me the performance details for the "Google DNS" probe on node <NODE_ID>.
```
→ `get_probe_details(agent_id="<NODE_ID>", probe_name="Google DNS")` — Score, latency, reachability.

**Trigger probes immediately:**
```
Trigger an immediate run of all DEM probes on node <NODE_ID>.
```
→ `run_dem_probes_now(agent_id="<NODE_ID>")` — Live RTT + status per probe. *May take 30–60 s.*

**Add a probe:**
```
Add a PING probe to 8.8.8.8 named "Google DNS Test" on node <NODE_ID>.
```
→ `add_dem_probe(agent_id="<NODE_ID>", name="Google DNS Test", target="8.8.8.8", probe_type="PING")`  
Valid types: `HTTP`, `HTTPS`, `PING`, `TCP`, `UDP`, `DNS`.

**Remove a probe:**
```
Remove the "Google DNS Test" probe from node <NODE_ID>.
```
→ `remove_dem_probe(agent_id="<NODE_ID>", probe_name="Google DNS Test")`


---

### 5. Fabric Targets (Peers)

**List peers:**
```
List all Fabric peers configured on node <NODE_ID>.
```
→ `list_fabric_targets(agent_id="<NODE_ID>")` — Name, host, capabilities (xfr, voice, conv, security), enabled status.

**Enable / disable a peer:**
```
Disable the fabric target "<TARGET_NAME>" on node <NODE_ID>.
Re-enable the fabric target "<TARGET_NAME>" on node <NODE_ID>.
```
→ `set_fabric_target_enabled(agent_id="<NODE_ID>", target_name_or_host="<TARGET_NAME>", enabled=False/True)`

---

### 6. Traffic Tests (XFR Speedtest & Convergence)

**Target compatibility rules:**
- **`xfr`** (Speedtest): Stigix node or dedicated XFR target.
- **`conv`** (Convergence): Stigix Fabric node only.
- **`voice`** / **`iot`**: Stigix Fabric node only.

> [!TIP]
> Use `list_endpoints` to check the `kind` and `capabilities` of each node before launching a test.

**Speedtest history:**
```
Show me the last 10 speedtests from node <NODE_ID>.
```
→ `list_speedtest_history(agent_id="<NODE_ID>", limit=10)` — Target, protocol, throughput Mbps, RTT.

**Launch a speedtest:**
```
Run a 30-second speedtest between <SOURCE_ID> and <TARGET_ID> using TCP.
```
→ `run_test(source_id="<SOURCE_ID>", target_id="<TARGET_ID>", profile="xfr", duration="30s", protocol="tcp")`  
Returns a test ID to poll with `get_test_status`.

**Launch with bitrate cap:**
```
Run a speedtest between <SOURCE_ID> and <TARGET_ID> capped at 100M bidirectional.
```
→ `run_test(..., bitrate="100M", direction="bidirectional")`

**Check test status:**
```
What is the status of test <TEST_ID>?
```
→ `get_test_status(test_id="<TEST_ID>")` — Status (running/completed/error) + metrics.

**Stop a test:**
```
Stop test <TEST_ID>.
```
→ `stop_test(test_id="<TEST_ID>")` — Stop confirmation + final metrics.

**Convergence test:**
```
Start a convergence test between <SOURCE_ID> and <TARGET_ID> at 100 pps.
```
→ `run_test(source_id="<SOURCE_ID>", target_id="<TARGET_ID>", profile="conv", pps=100)`  
⚠️ Claude announces the test ID and **waits for you to say "stop"** — it does not poll automatically.

**Convergence history:**
```
Show me the last 5 convergence tests for node <NODE_ID>.
```
→ `get_convergence_history(agent_id="<NODE_ID>", limit=5)` — Max blackout (ms) + verdict: PERFECT / GOOD / DEGRADED / BAD / CRITICAL.

---

### 7. Security Testing

**Security configuration:**
```
Show me the security configuration for node <NODE_ID>.
```
→ `get_security_config(agent_id="<NODE_ID>")` — Enabled modules, test profile (DNS, URL, threat).

**Security scorecard:**
```
What is the current security score for node <NODE_ID>?
```
→ `get_security_results_stats(agent_id="<NODE_ID>")` — `posture_scores` (url_filter, dns_security, threat_prevention 0–100) + 24 h trend.

**Recent security test results:**
```
Show me the last 10 security test results for node <NODE_ID>.
```
→ `list_security_results(agent_id="<NODE_ID>", limit=10)` — Chronological URL/DNS/Threat results.

**Discover available test targets (dynamic, from the node's active profile):**
```
What DNS security targets are available on node <NODE_ID>?
What URL categories are configured on node <NODE_ID>?
What EICAR targets are available on node <NODE_ID>?
```
→ `get_security_test_options(agent_id="<NODE_ID>", probe_type="dns"|"url"|"threat")`  
ℹ️ This tool is **dynamic** — it reads the node's active security profile. Switching the vendor profile (e.g. to Fortinet) instantly updates what Claude sees here.

**Single DNS test (Claude 2-step workflow):**
```
Run a DNS security test for the malware domain on node <NODE_ID>.
```
1. `get_security_test_options(agent_id="<NODE_ID>", probe_type="dns")` → fetches real domain list
2. `run_security_probe(agent_id="<NODE_ID>", probe_type="dns", target="<malware-domain>")` → runs the test

→ Returns Blocked/Allowed + reason. **MCP** badge appears in the Security Log.

**Single URL filtering test (Claude 2-step workflow):**
```
Test URL filtering for the "Hacking" category on node <NODE_ID>.
```
1. `get_security_test_options(agent_id="<NODE_ID>", probe_type="url")` → finds the exact URL
2. `run_security_probe(agent_id="<NODE_ID>", probe_type="url", target="<url>")` → tests it

**EICAR test against a specific target (Claude 3-step workflow):**
```
Run an EICAR threat prevention test against the Hetzner target from node <NODE_ID>.
```
1. `get_security_test_options(agent_id="<NODE_ID>", probe_type="threat")` → sees list (Hetzner, DC1, …)
2. Selects "Hetzner"
3. `run_security_probe(agent_id="<NODE_ID>", probe_type="threat", target="http://<hetzner-ip>:8082/eicar.com.txt")`

→ Blocked 🟢 (IPS active) or Allowed 🔴 (policy issue).

**Full batch audits:**
```
Run a full DNS security audit on node <NODE_ID>.      ← ~3 min
Run a full URL filtering audit on node <NODE_ID>.     ← ~3 min
Run a full security audit on node <NODE_ID>.          ← ~7-10 min (URL + DNS + EICAR)
```
→ `run_security_dns_batch` / `run_security_url_batch` / `run_full_security_audit`  
All return a per-test summary (blocked/allowed/unknown) + global count.

---

### 8. VyOS Network Chaos

> [!IMPORTANT]
> `get_vyos_interfaces` reads interface **descriptions** to resolve natural language intent. For prompts like *"shut the MPLS link"* to work, descriptions must be set on the VyOS router (e.g., `set interfaces ethernet eth1 description "MPLS-Link-DC1"`). See [VYOS_CONTROL.md](VYOS_CONTROL.md).

**List managed routers:**
```
List the VyOS routers managed by node <NODE_ID>.
```
→ `list_vyos_routers(agent_id="<NODE_ID>")`

**List available scenarios:**
```
What VyOS scenarios are available on node <NODE_ID>?
```
→ `list_vyos_scenarios(agent_id="<NODE_ID>")`

**List chaos-eligible interfaces:**
```
Show me the network interfaces available for chaos engineering on node <NODE_ID>.
```
→ `get_vyos_interfaces(agent_id="<NODE_ID>")` — Interfaces with description, IP, up/down status.

**Live router state:**
```
What is the current state of router <ROUTER_ID> managed by node <NODE_ID>?
```
→ `get_vyos_router_state(agent_id="<NODE_ID>", router_id="<ROUTER_ID>")`:
```
Interface eth0 (ALL-MPLS-190): 🟢 up
Interface eth1 (BR1-MPLS-197): 🟢 up  +150ms delay  (qos_active)
Interface eth7 (BR2-INET-226): 🔴 down  (admin disabled)
IP Blocks: 192.168.1.100/32 (tag-999)
```

**Fabric Impairment & Cleanup Audit (Across all nodes / routers):**
```
Audit all active network impairments, injected latencies, or disabled links across the fabric.
```
→ `list_active_impairments()` — Checks every managed VyOS router across the mesh and reports active `tc netem` shaping or shut links. Perfect for pre-test baseline validation and post-test cleanup verification.

**Add latency (NL → confirmation → execute):**
```
Add 100ms of latency on the MPLS link of BR1 via node <NODE_ID>.
```
Claude workflow:
1. `get_vyos_interfaces(agent_id="<NODE_ID>")` → finds the MPLS interface for BR1
2. Presents: *"I found eth1 (BR1-MPLS-197). Apply 100ms? (yes/no)"*
3. On confirmation → `vyos_execute_action(agent_id, router_id, "set-impairment", interface="eth1", latency_ms=100)`

⚠️ Claude **must not** apply the action without explicit confirmation.

**Add packet loss:**
```
Add 5% packet loss on the WAN interface of router <ROUTER_ID> on node <NODE_ID>.
```
→ Same flow → `set-impairment` with `loss_pct=5`.

**Clear QoS / bulk reset / full reset:**
```
Remove QoS on eth1 of router <ROUTER_ID> managed by node <NODE_ID>.
Clear all active QoS on router <ROUTER_ID> managed by node <NODE_ID>.
Do a full reset of router <ROUTER_ID> — QoS, IP blocks, and downed interfaces.
```
→ `vyos_execute_action(..., "clear-qos", interface="eth1")`  
→ `vyos_bulk_reset(..., scope="all-qos")`  
→ `vyos_bulk_reset(..., scope="full-reset")`

**Block / unblock an IP:**
```
Block traffic to 1.2.3.4 on router <ROUTER_ID> managed by node <NODE_ID>.
Unblock traffic to 1.2.3.4 on router <ROUTER_ID> managed by node <NODE_ID>.
```
→ `vyos_execute_action(agent_id, router_id, "deny-traffic"|"allow-traffic", ip="1.2.3.4")`  
⚠️ Claude asks for confirmation before blocking.

**Run a VyOS scenario / toggle cyclic:**
```
Run scenario "<SCENARIO_ID>" on node <NODE_ID>.
Disable the cyclic scenario "<SCENARIO_ID>" running on node <NODE_ID>.
```
→ `run_vyos_scenario(...)` / `set_vyos_scenario_status(..., enabled=False)`

**Change history:**
```
Show me the last 10 VyOS changes applied via node <NODE_ID>.
```
→ `get_vyos_timeline(agent_id="<NODE_ID>", limit=10)`

---

### 9. Voice Simulation

```
Start voice simulation on node <NODE_ID>.
Stop voice simulation on node <NODE_ID>.
```
→ `set_voice_status(source_id="<NODE_ID>", enabled=True/False)`  
⚠️ Node must be of fabric type.

---

### 10. Config Export, Import & Multi-Deployment Clone

**Export application config:**
```
Export the application configuration from node <NODE_ID>.
```
→ `export_app_config(agent_id="<NODE_ID>")` — Returns a JSON config object.

**Copy application config to another node:**
```
Copy the application configuration from node <SOURCE_ID> to <DEST_ID>.
```
Claude workflow:
1. `export_app_config(agent_id="<SOURCE_ID>")` → fetches JSON
2. Warns that import will overwrite the existing config
3. On confirmation → `import_app_config(agent_id="<DEST_ID>", config=<JSON>)`

**Full node clone (multi-deployment):**
```
Clone the full configuration from BR8 to BR5: apps, DEM probes, security profile, and VyOS scenarios.
```
→ `clone_node_config(source_id="<BR8_ID>", target_id="<BR5_ID>")`  
Returns a per-component report:
```json
{
  "source": "BR8-Ubuntu",
  "target": "ubuntubr5",
  "components": {
    "apps":             { "status": "ok", "message": "Application config cloned." },
    "dem_probes":       { "status": "ok", "count": 6, "message": "6 DEM probe(s) cloned." },
    "security_profile": { "status": "ok", "vendor": "paloalto", "url_categories": 65, "dns_domains": 11 },
    "vyos_scenarios":   { "status": "ok", "cloned": 3, "message": "3/3 VyOS scenarios cloned." }
  },
  "summary": "✅ All components cloned successfully."
}
```

**Partial clone (one or more components):**
```
Clone only the DEM probes from BR8 to BR5, without touching apps or the security profile.
Copy the security profile from BR8 to BR5.
```
→ `clone_node_config(source_id="<BR8_ID>", target_id="<BR5_ID>", scope=["dem_probes"])`  
→ `clone_node_config(source_id="<BR8_ID>", target_id="<BR5_ID>", scope=["security_profile"])`

Available scope values: `apps`, `dem_probes`, `security_profile`, `vyos_scenarios`.

> [!IMPORTANT]
> `clone_node_config` is a **write operation** — it overwrites the target node's config for each selected component. Claude will always ask for confirmation before executing.

> [!WARNING]
> Prerequisite: `JWT_SECRET` must be identical on both nodes. Verify with:
> ```bash
> docker exec stigix printenv JWT_SECRET   # run on each node
> ```

---

### 11. Prisma Flow Browser

**Query flows for specific criteria:**
```
Query the Prisma Flow Browser on BR8 for TCP port 8082 sessions to 192.168.203.100 over the last 15 minutes.
```
→ `get_prisma_flows(agent_id="BR8", site_name="BR8", protocol=6, tcp_dst_port=8082, dst_ip="192.168.203.100", minutes=15)`

---

### 12. Custom TCP Applications & Enterprise Workloads

**Deploy custom enterprise app (e.g. POS on port 9000):**
```
Create a custom TCP app "app-pos" on DC1 on port 9000 and attach all mesh peers.
```
→ `create_custom_tcp_app(agent_id="DC1", name="app-pos", port=9000, target_peers="all", auto_start_workload=True)`

**Test instant round-trip TCP 3-way handshake:**
```
Test TCP 3-way handshake from BR8 to DC1 on port 9000.
```
→ `test_tcp_app_handshake(agent_id="BR8", target_host="192.168.203.100", target_port=9000)`

**List all custom TCP applications:**
```
List all custom TCP apps on DC1.
```
→ `list_custom_tcp_apps(agent_id="DC1")`

---

### 13. Mesh Controller & Global Provisioning

**Check mesh leader and peers:**
```
What is the controller status of DC1? Show all connected peers.
```
→ `get_controller_status(agent_id="DC1")` / `list_controller_peers(agent_id="DC1")`

**Publish configuration bundle to entire mesh:**
```
Publish the custom-tcp-apps configuration bundle to all mesh nodes.
```
→ `publish_configuration_bundle(agent_id="DC1", bundle_type="custom-tcp-apps")`

**Audit provisioning history:**
```
Show the last 5 provisioning bundle deployments on DC1 in compact summary mode.
```
→ `get_provisioning_history(agent_id="DC1", limit=5, summary_only=True)`

**Generate zero-touch onboarding command:**
```
Generate an onboarding command for a new branch node.
```
→ `generate_peer_onboard_command(agent_id="DC1", peer_name="BR9-Lyon")`

---

### 14. System Health Matrix & Live Diagnostics

**360° System Health Matrix:**
```
Show the 360-degree System Health Matrix for BR8.
```
→ `get_health_matrix(agent_id="BR8")` — Returns operational score (0-100%) across all 9 subsystems.

**Deep on-demand diagnostics:**
```
Run full system diagnostics on BR8.
```
→ `run_system_diagnostics(agent_id="BR8")`

**Hop-by-hop Path Trace / Traceroute:**
```
Run a path trace from BR8 to 192.168.203.100 with a max of 15 hops to locate packet loss or latency.
```
→ `run_path_trace(agent_id="BR8", target="192.168.203.100", max_hops=15, timeout_sec=2)`

---

### 15. Voice Ingress & RTP Quality

**Inspect live voice streams:**
```
Show live voice stats and ingress RTP audio streams on DC1.
```
→ `get_voice_stats(agent_id="DC1")` / `get_voice_ingress_calls(agent_id="DC1")`

---

### 16. Edge Cases & Error Handling

**Non-existent node (expected clean error):**
```
Give me the status of node "NODE-THAT-DOES-NOT-EXIST".
```
→ Claude returns a clean error message — no crash, no empty response.

**Ambiguous VyOS NL resolution:**
```
Add 200ms of latency on the Internet link of BR2 via node <NODE_ID>.
```
If multiple Internet links exist on BR2, Claude:
1. Lists all candidates with their descriptions
2. Asks you to pick one explicitly
3. Does **not** apply any action until a choice is made

---


## 🔄 Keeping MCP Tools Up-to-Date

When `stigix-cli.py` is updated (new commands, bug fixes, new API parameters), the MCP server tools should be synchronized to match. The project includes an agent skill for this:

**`.agent/skills/stigix-mcp-sync/`** — Run this skill after any CLI changes to:
1. Detect new or modified API endpoints in the CLI
2. Cross-reference against the living CLI→MCP registry (`references/cli_to_mcp_map.md`)
3. Implement missing tools following the existing orchestrator pattern
4. Deploy the updated MCP server

---

## 🔁 Upgrading Stigix — Do I Need to Restart Claude Desktop?

**Short answer: yes, typically.**

### Why

Claude Desktop connects to the Stigix MCP server through a persistent SSE connection:

```
Claude Desktop
    │  spawns (child process)
    ▼
npx @modelcontextprotocol/inspector     ← stdio bridge
    │  SSE persistent connection
    ▼
http://<node>:3100/sse                  ← MCP Server (Python, in Docker)
```

When the Stigix container restarts during an upgrade:
1. The SSE connection **drops** immediately
2. The `npx inspector` child process receives a connection error and **dies**
3. Claude Desktop detects its MCP child is dead → marks the server as **unavailable**
4. The MCP tools are no longer accessible until reconnection

### How to Reconnect

**Option A — Fastest:** In Claude Desktop settings, find `stigix-cloud` under Developer → MCP Servers and toggle it off/on (if supported by your Claude Desktop version).

**Option B — Reliable:** Fully quit Claude Desktop (`Cmd+Q` on macOS), then relaunch. The `npx inspector` process restarts and re-establishes the SSE connection.

> [!NOTE]
> You do **not** need to change `claude_desktop_config.json` — only the running connection needs to be refreshed.

### Typical Upgrade Workflow

```bash
# On the Stigix node
docker compose pull && docker compose up -d

# On your Mac — after the container is back online
# Quit Claude Desktop → Reopen
# Verify: Settings → MCP Server → Service Status should show ● Online
```

---

## 🧠 What Does Stigix Actually Receive from Claude?

**The natural language text never reaches Stigix.**

When you type a prompt in Claude Desktop (e.g. *"What is the security score for BR8?"*), the translation happens entirely on Anthropic's servers:

```
You type:  "What is the security score for BR8?"
                │
                ▼  sent to Anthropic (Claude LLM)
           Claude reasons, selects the right tool and arguments
                │
                ▼  generates a structured JSON-RPC call
           {
             "method": "tools/call",
             "params": {
               "name": "get_security_score",
               "arguments": { "agent_id": "BR8-Ubuntu" }
             }
           }
                │
                ▼  npx inspector → SSE → port 3100
           Stigix MCP Server receives ONLY this structured call
```

**Stigix never sees** *"What is the security score for BR8?"*. It only receives the resolved tool name and arguments. The natural language stays between you and Anthropic's API.

This also means:
- **Privacy**: your conversational text is not logged by Stigix
- **What Stigix logs** (`mcp-history.jsonl`): only `tool_name`, `agent_id`, `duration_ms`, `status` — never the prompt
- **Debugging**: if a tool is called with wrong arguments, the issue is in Claude's reasoning (docstring quality), not in Stigix

---

*Last Updated: v1.4.0-patch.142 — 2026-06-01*



---

## Automated Test Harness

The MCP server ships with a self-contained test harness that validates every tool's contract against a lightweight mock Stigix node — no live infrastructure required.

### Architecture

```
tests/
├── conftest.py              # pytest fixtures: starts mock server + MCP process
├── mcp_harness.py           # ToolCallResult wrapper, timeout helpers
├── mock_stigix_node.py      # FastAPI mock (nominal + canary nodes on random ports)
├── report_generator.py      # JSON scorecard + per-tool report
├── tools_manifest.yaml      # Ground truth: args, expected keys, categories, budgets
├── test_mcp_nominal.py      # Happy-path contract tests (one per tool with nominal_args)
├── test_mcp_regression.py   # Edge-case & regression tests
└── test_mcp_invalid_args.py # Injection / boundary / type-error tests
```

### Running the tests

```bash
cd mcp-server
# Install dev dependencies (first time only)
uv pip install -e ".[dev]"

# Run the full nominal suite
pytest tests/test_mcp_nominal.py -v

# Run a single tool
pytest tests/test_mcp_nominal.py -k get_security_results_stats -v

# Run all suites
pytest tests/ -v --timeout=300
```

Expected result: **79 passed, 2 skipped** (`get_test_status` and `stop_test` are skipped — they require ephemeral in-memory state created by `run_test`).

### tools_manifest.yaml

Every MCP tool is described in `tests/tools_manifest.yaml`. Key fields per tool:

| Field | Purpose |
|-------|---------|
| `category` | `read` / `write` / `action` — gates which test suites run |
| `scope` | `node` / `vyos` / `security` — groups related tools |
| `nominal_args` | Arguments for the happy-path call |
| `expected_keys` | At least one of these must appear in the response |
| `timeout_class` | `fast` (2 s) / `medium` (10 s) / `slow` (30 s) |
| `size_budget_kb` | Maximum response size |
| `skip_nominal` | `true` to skip the nominal test (state-dependent tools) |
| `skip_reason` | Human-readable explanation for `skip_nominal` |
| `invalid_args` | List of malformed arg sets for the invalid_args suite |

### Adding a new tool to the harness

1. Add an entry to `tools_manifest.yaml` under `tools:`.
2. Add a `nominal_args` block that resolves to a real mock endpoint.
3. Verify that `mock_stigix_node.py` handles the new endpoint path.
4. Run `pytest tests/test_mcp_nominal.py -k <tool_name> -v` to confirm.

If the tool is state-dependent (requires a prior call to create state), set `skip_nominal: true` and document the reason in `skip_reason`.

### Mock node

The mock starts two FastAPI instances on random ports:

- **mock-primary** — returns nominal responses for all endpoints
- **mock-canary** — identical, used for multi-node tests

The mock is session-scoped: it starts once per `pytest` run and is shared across all tests.
