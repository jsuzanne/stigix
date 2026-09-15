# 📡 Stigix API Studio & Live Observability Guide

> **Target Audience**: NOC Engineers, NetOps, SecOps, and Automation Engineers  
> **Applicable Version**: Stigix `v2.0.55+`

---

## 🎯 Overview

**API Studio** is Stigix’s real-time API observability hub and interactive test playground. It bridges the gap between backend background micro-engines (Python SDK scripts, Node.js daemons, VyOS automation) and the web dashboard.

As a NOC or NetOps engineer, you can use API Studio to:
1. **Instantly diagnose API failures** between Stigix and external network controllers (Palo Alto Prisma SASE, Strata Cloud Manager, VyOS routers, Cloudflare Workers).
2. **Inspect full HTTP transactions** (exact URL, headers, JSON request/response payloads, latency, and status codes).
3. **Replay and debug failing calls in 1 click** without opening a terminal or writing Python scripts.
4. **Test and create network objects** (e.g. custom SD-WAN appdefs, site queries, router firewall rules) using pre-built presets and automated credential injection.
5. **Generate reproducible automation snippets** (cURL, Python `prisma_sase`, Python `requests`, Node.js `fetch`) for escalation tickets or CI/CD pipelines.

```
+-----------------------------------------------------------------------------+
|                                STIGIX API STUDIO                             |
+-----------------------------------------------------------------------------+
|                                                                             |
|   [ Live API Inspector ]                       [ API Playground & Presets ] |
|   * Real-time SSE event stream                 * Palo Alto SASE Presets     |
|   * Inbound & Outbound logging                 * VyOS Router Presets        |
|   * Python getflow / prisma_apps hooks         * Auto-Authentication        |
|   * 1-Click "Replay in Playground"   ----->    * cURL / Python / JS Export  |
|                                                                             |
+-----------------------------------------------------------------------------+
```

---

## 🧭 Navigation & Layout

To access API Studio:
1. Open the Stigix Dashboard.
2. Click the **API Studio** tab (`Live` badge) in the top navigation bar.
3. Toggle between the two sub-views:
   - **`Live API Inspector`**: Real-time streaming log of all active transactions.
   - **`API Playground & Presets`**: Interactive visual composer and request builder.

---

## 1. 🔍 Live API Inspector (Troubleshooting & Telemetry)

The Live API Inspector captures every inbound and outbound HTTP/REST transaction happening across the Stigix node with sub-50ms latency.

### Key Controls
| Control | Description |
| :--- | :--- |
| **`● Live Streaming / Paused`** | Real-time connection indicator with pulse dot. Click **Pause** to freeze the stream when analyzing rapid bursts of traffic. |
| **Search Bar** | Live filter across URLs, paths, methods, status codes, script names (`getflow.py`, `prisma_custom_apps.py`), and error strings. |
| **Status Filter Chips** | Instant filtering by `2xx` (Success), `4xx` (Client/Auth errors), `5xx` (Server errors), or `Errors Only`. |
| **Source Selector** | Filter by initiator: `Node.js`, `Python` (micro-engines), `VyOS API`, or `Security Probes`. |
| **`Export JSON`** | Downloads the full transaction log as a formatted JSON file for incident reports and ticketing. |
| **`Clear`** | Flushes the current in-memory buffer (500-event FIFO circular buffer). |

### Log Table Columns
- **Time**: Local timestamp of execution.
- **Status**: Color-coded HTTP status badge (`200 OK` 🟢, `401 Unauthorized` 🟡, `500 Error` 🔴).
- **Method**: HTTP verb (`GET`, `POST`, `PUT`, `DELETE`, `PATCH`).
- **Source**: Indicates direction (↗ Outbound vs ↙ Inbound) and the script name (e.g. `getflow.py`, `prisma_custom_apps.py`, `api_playground`).
- **Path / Endpoint**: The target REST path and base domain.
- **Latency**: End-to-end execution time in milliseconds (amber if > 1000ms).

---

## 2. ⚡ Slide-Over Inspection & 1-Click Replay

Clicking on any row in the log table opens the **Detail Drawer** with full visibility:

1. **Overview**: Exact URL, timestamp, execution duration, and masking status.
2. **Response Body**: Formatted, syntax-highlighted JSON returned by the controller.
3. **Request Body**: The payload sent by Stigix.
4. **Headers**: Both request and response headers (Content-Type, User-Agent, Rate-Limit headers).
5. **cURL Snippet**: A pre-formatted, reproducible `curl` command with 1-click copy.
6. **`[⚡ Replay in Playground]`**: **The most powerful NOC tool** — immediately clones the URL, method, headers, and body into the API Playground for instant tweaking and re-execution.

---

## 3. 🧪 Interactive API Playground & Preset Catalog

The API Playground allows NOC engineers to safely query, test, and manipulate remote APIs without opening SSH terminals.

### Preset Catalog
The preset selector includes pre-configured templates for common operational tasks:

#### A. Palo Alto Prisma SD-WAN (CloudGenix)
* **`List All Sites`** (`GET /sdwan/v2.1/api/sites`): Fetches all branch & DC sites on the tenant.
* **`List ION Elements`** (`GET /sdwan/v2.1/api/elements`): Lists all hardware and virtual ION appliances with serial numbers and software versions.
* **`List Custom Applications`** (`GET /sdwan/v2.1/api/appdefs`): Inspects all custom L7 applications defined in Prisma SD-WAN.
* **`Create Custom App Definition`** (`POST /sdwan/v2.1/api/appdefs`): Pre-filled JSON schema to register a new TCP/UDP application definition.
* **`Query SD-WAN Flow Metrics`** (`POST /sdwan/v2.1/api/flowmetrics`): Queries flow bandwidth and packet metrics across VPN paths.

#### B. Palo Alto Strata Cloud Manager & Logging Service (SCM / SLS)
* **`Query SLS Traffic Logs`** (`POST /logging-service/v2/query`): Live query for recent firewall and security traffic logs.

#### C. VyOS SD-WAN Router
* **`Show Network Interfaces`** (`POST /show` with `{"op": "show", "path": ["interfaces"]}`): Query interface IP, link state, and duplex directly from the VyOS REST API.
* **`Show IP Route Table`** (`POST /show` with `{"op": "show", "path": ["ip", "route"]}`): Inspect live routing table.

#### D. Stigix Platform & Probes
* **`Get Discovered Topology`** (`GET /api/topology`): Real-time underlay mesh topology.
* **`System Health & Engine Status`** (`GET /api/system/health`): Health matrix across all daemons.
* **`Ping Cloudflare Target Worker`** (`GET /__down?bytes=1024`): Latency check to cloud edge targets.

### Auto-Authentication Selector
You don't need to manually copy OAuth bearer tokens or API keys:
- **`Prisma SASE OAuth`**: Automatically retrieves your client credentials from Stigix Settings / environment, performs the OAuth2 token exchange with Palo Alto Networks, injects `Authorization: Bearer <token>` and `X-PAN-TSG-ID`, and resolves the regional base URL.
- **`VyOS API Key`**: Automatically pulls the API key and host configured in Stigix VyOS Control.
- **`Stigix JWT Token`**: Injects your current dashboard session authentication.

---

## 4. 🛠️ Practical NOC Troubleshooting Scenarios

### Scenario 1: Prisma SASE Topology Discovery Fails ("Authentication Failed")

**Symptoms**:
The Topology page shows *"Topology Not Configured"* or *"Authentication Failed"* after saving credentials.

**NOC Investigation Steps**:
1. Open **API Studio** → **Live API Inspector**.
2. Look for recent requests from `Python (getflow.py)` to `/auth/v1/oauth2/access_token` or `/sdwan/v2.1/api/sites`.
3. Click the failing transaction row (e.g. `401 Unauthorized` or `403 Forbidden`).
4. In the drawer, check the **Response Body**:
   - `401 Unauthorized`: Client ID or Client Secret is mistyped or revoked on `apps.paloaltonetworks.com`.
   - `403 Forbidden`: The Service Account lacks the **SD-WAN Administrator** role or the TSG ID scope is incorrect.
5. Click **`[⚡ Replay in Playground]`**.
6. Switch to the **Code Export** tab, copy the **cURL snippet**, and execute it directly in a terminal to confirm TSG permissions.

---

### Scenario 2: Verifying a Custom App on Prisma SD-WAN

**Goal**:
Verify whether a new TCP port (e.g. port `3200` for SAP ERP) is classified correctly by Prisma SD-WAN.

**NOC Steps**:
1. Open **API Studio** → **API Playground**.
2. Select Preset: **`Prisma SD-WAN - Create Custom App Definition`**.
3. In the **JSON Body** tab, customize the port and app name:
   ```json
   {
     "name": "SAP_ERP_PROD",
     "display_name": "SAP ERP Production",
     "app_type": "custom",
     "category": "business_systems",
     "sub_category": "enterprise_resource_planning",
     "tcp_rules": [
       { "port": "3200" }
     ]
   }
   ```
4. Ensure **Auto Auth** is set to `Prisma SASE OAuth`.
5. Click **`Send`**.
6. In the **Response Inspector** on the right, verify status `201 Created` and check the returned `id`.
7. Switch to the **Live API Inspector** tab to see the logged transaction.

---

### Scenario 3: Checking VyOS Router Interfaces Remotely

**Goal**:
Confirm if interface `eth1` (WAN) is UP on the VyOS router without SSH access.

**NOC Steps**:
1. In **API Playground**, select Preset: **`VyOS SD-WAN - Show Network Interfaces`**.
2. Ensure **Auto Auth** is set to `VyOS API Key`.
3. Click **`Send`**.
4. The Response Inspector immediately formats and displays the JSON output showing interface states, IPs, and link drop statistics.

---

## 5. 🔒 Security & Secret Masking Policy

To comply with enterprise security standards and prevent accidental credential leakage in screenshots or screen shares:

- All sensitive headers (`Authorization: Bearer ...`, `client_secret`, `x-api-key`, `password`, `token`) are automatically sanitized before being stored in the buffer or rendered in the UI (`***MASKED***`).
- The internal telemetry proxy runs locally within the Stigix container and never leaks plaintext secrets to third-party telemetry providers.
- Logging occurs entirely in-memory (RAM) and is non-persistent unless explicitly exported via the **Export JSON** button.

---

## 6. 💻 Instant Code Generators

Every request composed in the API Playground can be exported instantly to ready-to-run code by opening the **Code Export** tab:

1. **`cURL`**: Single command with headers and formatted data payloads.
2. **`Python (prisma_sase)`**: Ready-to-paste Python script using Palo Alto's official SDK.
3. **`Python (requests)`**: Standalone Python script using standard `requests` library.
4. **`Node.js (fetch)`**: Native modern JavaScript / TypeScript `fetch` snippet.

Use these snippets to quickly attach reproducible proof to ServiceNow/Jira tickets or provide automation scripts to network engineering teams.
