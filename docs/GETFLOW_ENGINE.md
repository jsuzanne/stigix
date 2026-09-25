> **Last Updated:** 2026-06-01 | **Created:** 2026-06-01 (v1.4.0-patch.138)

# 🛣️ Prisma SD-WAN Flow Browser Query Engine (`getflow.py`)

The `getflow.py` script (located in the `engines/` directory) is a high-performance Python CLI utility that connects to the **Palo Alto Networks Prisma SASE (SD-WAN) API** using the official Prisma SASE SDK. 

It acts as the primary integration engine for Stigix to discover network topologies, auto-detect site branches, and analyze sub-second failover paths during convergence tests.

---

## 🎯 Role in Stigix

Within the Stigix environment, `getflow.py` is invoked programmatically by the Stigix Node.js backend (`server.ts`) for three main features:

1. **Auto-Detection of Node hostname / Site Branch**
   During startup, Stigix calls `getflow.py --auto-detect` to match the container's primary local IP against the site subnets configured in Prisma SD-WAN. This enables zero-config deployment where the Stigix node automatically names itself after your physical branch (e.g. `BR8-Ubuntu`).
2. **Live VPN Topology Mapping**
   When viewing the **VPN Topology Overlay** tab in the dashboard, the backend triggers `getflow.py --build-topology`. The script queries the Prisma SASE topology API, maps ION devices, resolved WAN interfaces, active VPN peer paths, and outputs the structured JSON that feeds the React interface.
3. **Convergence test path enrichment**
   After running a sub-second convergence failover test (via the Failover tab or MCP tool), Stigix schedules an asynchronous lookup via `getflow.py --site-name <SITE> --udp-src-port <PORT> --dst-ip <IP>`. The script searches the Prisma Flow Browser to find the exact exit path (e.g., MPLS, Internet-1, Standard VPN) that the test packet took, enabling visual correlation of failover events.

---

## ⚙️ CLI Options & Parameters

You can run `getflow.py` in standalone mode or debug mode. Below is the list of all available options:

### 🔑 Authentication & Configuration
* `--credentials <PATH>`  
  Path to the legacy credentials JSON file. Defaults to `credentials.json`.  
  *Note: Stigix prefers loading credentials from environment variables (`PRISMA_SDWAN_CLIENT_ID`, `PRISMA_SDWAN_CLIENT_SECRET`, `PRISMA_SDWAN_TSG_ID`) which override this flag.*
* `--region <de|us>`  
  The Prisma SASE API endpoint region. Defaults to `de`. Use `de` for Europe/EMEA, or `us` for Americas.

### 🔍 Discovery & Topology
* `--list-sites`  
  List all configured sites in the Prisma tenant and exits.
* `--list-lan-interfaces`  
  Lists all LAN interfaces with static IPv4 configured across all sites.
* `--list-dc-lan-interfaces`  
  Lists all private/Data Center LAN interfaces with static IPv4 configured. Used by Stigix targets discovery.
* `--build-topology`  
  Constructs and exports the full mesh topology JSON including IONs, WAN circuits, LAN interfaces, and VPN peer link states.
* `--auto-detect`  
  Attempts to match the host local IP address against all discovered ION LAN subnets to identify which site branch this Stigix node is running on.

### 🚦 Flow Browser Queries (Flow Correlation)
* `--site-id <ID>`  
  Specify the Prisma Site UUID to scope the flow browser query.
* `--site-name <NAME>`  
  Specify the Site Name to scope the flow browser query (resolves name to ID automatically).
* `--udp-src-port <PORT>`  
  Filter flows by their UDP source port. Crucial for matching Stigix convergence probe flows (e.g., `30000+` ports).
* `--src-ip <IP>`  
  Filter flows matching a specific source IP.
* `--dst-ip <IP>`  
  Filter flows matching a specific destination IP.
* `--protocol <NUMBER>`  
  Filter flows by protocol (e.g. `17` for UDP, `6` for TCP, `1` for ICMP).
* `--hours <N>`  
  Number of hours to look back (default: `1`).
* `--minutes <N>`  
  Number of minutes to look back (overrides `--hours` if set). Useful for finding very recent test flows.
* `--page-size <N>`  
  Number of flow records to query per page (default: `1` for speed optimization).

### 🛠️ Execution & Format Modifiers
* `--json`  
  Formats the output strictly as a JSON string to stdout. Essential for scripting and Node.js integrations.
* `--fast`  
  Skips heavy path name resolution to speed up queries.
* `--debug`  
  Enables verbose debug printing to stderr.
* `--debug-topo`  
  Enables verbose logging of VPN link state evaluations during topology generation.
* `--output <FILENAME>`  
  Saves the JSON result directly to a file.

---

## 🚀 Standalone Usage Examples

To run these commands, log into the running Stigix Docker container:

```bash
docker exec -it stigix sh
```

### 1. Test Prisma API connectivity & List Sites
Verify your service account credentials and query the tenant site list:
```bash
python3 /app/engines/getflow.py --list-sites
```

### 2. Auto-Detect Site
Simulate the startup detection process:
```bash
python3 /app/engines/getflow.py --auto-detect --json
```

### 3. Extract DC LAN IPs
List DC private interfaces to dynamically locate test targets:
```bash
python3 /app/engines/getflow.py --list-dc-lan-interfaces --json | jq -r '.dc_lan_interfaces[].ip'
```

### 4. Locate Convergence Test Path (Post-Test)
Query which WAN path a specific Stigix convergence test (running on source port `30075` towards `192.168.203.100`) took over the last 5 minutes:
```bash
python3 /app/engines/getflow.py --site-name BR8 --udp-src-port 30075 --dst-ip 192.168.203.100 --minutes 5 --json
```

---

## ❌ Troubleshooting

* **Authentication failed (HTTP 401/403)**
  * Ensure `PRISMA_SDWAN_CLIENT_ID`, `PRISMA_SDWAN_CLIENT_SECRET`, and `PRISMA_SDWAN_TSG_ID` are set correctly in your `.env` file.
  * Ensure the Service Account in Prisma SASE has the appropriate permissions (read-only minimum).
  * Double check your `--region` flag (use `--region us` if your Prisma tenant resides in the Americas tenant).
* **Flows not found / empty result**
  * Flow browser records can take up to **60–90 seconds** to be indexed and made available in the Prisma Flow Browser API. Stigix delays path lookup requests by 60 seconds automatically.
  * Check that traffic was actually sent and that the UDP source port matches your convergence test profile settings.
