# Stigix AI Copilot & FastMCP — End-to-End Enterprise Demo Scenario

**Interactive 360° SD-WAN & SASE Validation Demo Script for Network Engineers, Security Architects, and CIOs**

---

## 🎯 Executive Overview

This document provides an exhaustive, field-ready demonstration scenario showcasing the full power of **Claude Desktop (FastMCP)** and the embedded **Stigix In-App AI Copilot**.

It simulates a real-world enterprise situation: **validating and commissioning a new regional branch office (BR1) connecting across SD-WAN and SASE to the central Datacenter (DC1)**.

### Demonstrated Capabilities
1. 🗺️ **Underlay & Fabric Topology Mapping** (`get_network_topology`, `list_endpoints`, `get_health_matrix`)
2. 🌐 **Direct Internet Breakout & SaaS Experience (DEM)** (`get_public_ip`, `run_dem_probes_now`, `get_dem_summary`)
3. 🏢 **Central Application Access & Handshake Latency** (`create_custom_tcp_app`, `test_tcp_handshake`, `get_app_score`)
4. 🏭 **IoT Massive Industrial Fleet Simulation** (`set_iot_status`, `get_iot_stats`, `run_test(iot)`)
5. 📞 **Voice VoIP RTP Telemetry & MOS Score** (`set_voice_status`, `run_test(voice)`)
6. 🛡️ **SASE Security Audit (URL Filtering, DNS, EICAR)** (`run_full_security_audit`, `run_eicar_test`, `get_security_results_stats`)
7. 🚀 **Gigabit Multi-Stream Bandwidth Qualification** (`run_test(xfr)`, `get_test_status`)
8. 💥 **Chaos Engineering & Sub-Second SD-WAN Failover** (`run_test(conv)`, `vyos_execute_action`, `stop_test`)
9. 📡 **Central Global Provisioning & Mesh Broadcast** (`publish_configuration_bundle`)
10. 📄 **Automated C-Level Commissioning Report**

---

## 🏗️ Demo Topology Architecture

```text
┌─────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                       STIGIX FABRIC MESH                                       │
│                                                                                                 │
│  [ Branch BR1 / BR8 ] ═══════════════╦═══════════════> [ Datacenter DC1 (Leader) ]              │
│       │                              ║                      │                                   │
│       ├─ 🌐 Internet & SaaS (DEM)    ║                      ├─ 🏢 Central Apps (ERP / POS TCP)  │
│       ├─ 🔒 SASE Security & EICAR    ║                      ├─ 📡 Global Provisioning Master    │
│       ├─ 📞 VoIP Simulation (G.711)  ║                      └─ 💾 PostgreSQL Database           │
│       ├─ 🏭 IoT Smart Factory Fleet  ║                                                          │
│       └─ ⚙️ VyOS Dual-WAN Underlay   ╩══════════════════════════════════════════════════════════┘
```

---

## 📜 Step-by-Step Prompt Script (Copy & Paste Sequence)

### Step 1: Topology Discovery & 360° Health Matrix
> **Module:** `Topology & Mesh Discovery`  
> **Underlying Tools:** `get_network_topology`, `list_endpoints`, `get_health_matrix`

```text
Discover all endpoints in our Stigix network. Provide a full 360° health matrix and connectivity view between our branch BR1, peer nodes, and datacenter DC1, including public and private IP addresses.
```

---

### Step 2: Direct Internet Breakout & SaaS Experience (DEM)
> **Module:** `Digital Experience Monitoring (DEM)`  
> **Underlying Tools:** `get_public_ip`, `run_dem_probes_now`, `get_dem_summary`

```text
Check the Direct Internet Breakout on BR1, retrieve its public egress IP, and run a fresh evaluation of our DEM synthetic probes (Google, Microsoft 365, Teams, Salesforce). Give me the global experience score and flag any degraded paths.
```

---

### Step 3: Central Enterprise Application Validation (DC1)
> **Module:** `Custom TCP Apps & Handshake Diagnostics`  
> **Underlying Tools:** `create_custom_tcp_app`, `test_tcp_handshake`, `get_app_score`

```text
We have deployed a critical ERP service 'app-erp-finance' on port 18443 on DC1. Register the application, measure the TCP SYN-ACK connection setup time from BR1, and calculate the application readiness score.
```

---

### Step 4: Massive Industrial IoT Simulation (Smart Factory)
> **Module:** `IoT Telemetry Engine`  
> **Underlying Tools:** `set_iot_status`, `get_iot_stats`, `run_test(profile='iot')`

```text
Activate IoT simulation on BR1 to simulate 100 industrial telemetry sensors sending high-frequency MQTT/CoAP payloads toward DC1. Report the messages-per-second throughput, error rate, and WAN bandwidth impact.
```

---

### Step 5: VoIP Call Simulation & MOS Score Calculation
> **Module:** `Voice Engine (RTP / SIP)`  
> **Underlying Tools:** `set_voice_status`, `run_test(profile='voice')`, `get_node_status`

```text
Start VoIP voice simulation (bidirectional G.711 RTP stream) between BR1 and DC1. Measure jitter, one-way packet latency, packet loss percentage, and calculate the estimated Mean Opinion Score (MOS).
```

---

### Step 6: SASE Security Posture & Threat Prevention Audit
> **Module:** `Security Engine (URL Filtering, DNS Security, Antivirus)`  
> **Underlying Tools:** `run_full_security_audit`, `run_eicar_test`, `get_security_results_stats`

```text
Execute a complete SASE security audit on BR1: test URL category filtering, DNS protection against malicious C2 domains, and trigger an EICAR test file download to verify that our SASE perimeter blocks it.
```

---

### Step 7: Gigabit Bandwidth Qualification & Stress Test
> **Module:** `Bandwidth Engine (XFR / Multi-Stream TCP)`  
> **Underlying Tools:** `run_test(profile='xfr')`, `get_test_status`

```text
Run a 10-second bidirectional XFR speedtest with 4 parallel TCP streams between BR1 and DC1 to saturate the WAN link and measure maximum sustained upload and download throughput.
```

---

### Step 8: Chaos Engineering & Sub-Second SD-WAN Failover
> **Module:** `VyOS Router Automation & Failover Lab`  
> **Underlying Tools:** `run_test(profile='conv')`, `vyos_execute_action`, `stop_test`

```text
Start a high-frequency convergence probe (100 packets/sec) from BR1 to DC1. Disable the primary WAN interface (eth1) on router BR1-VyOS to trigger an underlay failover. Once BGP converges to the backup link, stop the probe and report the exact downtime in milliseconds.
```

---

### Step 9: Central Configuration Provisioning & Mesh Broadcast
> **Module:** `Central Global Provisioning`  
> **Underlying Tools:** `publish_configuration_bundle(agent_id='DC1', bundle_type='all')`, `get_provisioning_status`

```text
All validations passed successfully. Publish all configuration bundles (Applications, DEM Probes, SASE Policies, Voice, TCP Apps) from leader DC1 across the entire SD-WAN mesh.
```

---

### Step 10: Official Executive Commissioning Report
> **Module:** `Executive AI Synthesis`

```text
Generate the official executive commissioning report for the CIO and Architecture Board: summarize all tested domains (Topology, SaaS DEM, Central ERP, IoT, VoIP MOS, SASE Security, Throughput, and Failover SLA), with concrete numbers and a clear GO/NO-GO production decision.
```

---

## 📊 Summary Table of Tools & Capabilities

| Step | Focus Area | FastMCP / AI Copilot Tools Used | Key Customer Metric |
| :--- | :--- | :--- | :--- |
| **1** | Topology & Health | `get_network_topology`, `get_health_matrix` | RTT Matrix, Node status |
| **2** | Internet & SaaS DEM | `get_public_ip`, `run_dem_probes_now` | DNS / Connect / TLS RUM |
| **3** | Central ERP Apps | `create_custom_tcp_app`, `test_tcp_handshake` | TCP SYN-ACK ms, App Score |
| **4** | Industrial IoT | `set_iot_status`, `get_iot_stats` | Messages/sec, payload loss |
| **5** | VoIP Voice Quality | `set_voice_status`, `run_test(voice)` | Jitter, Packet loss, MOS > 4.2 |
| **6** | SASE Threat Defense | `run_full_security_audit`, `run_eicar_test` | Block rate %, EICAR intercepted |
| **7** | Bandwidth Stress | `run_test(xfr)`, `get_test_status` | Mbps Upload/Download, Retransmits |
| **8** | Failover SLA | `run_test(conv)`, `vyos_execute_action` | Switchover time in milliseconds |
| **9** | Mesh Sync | `publish_configuration_bundle` | Revision hash, Mesh sync state |
| **10** | C-Level Report | Markdown synthesis | Formal GO/NO-GO approval |

---

## 🔗 Related Documentation & Specialized Prompts

* 📖 **[MCP Server Reference](file:///Users/jsuzanne/Github/stigix/docs/MCP_SERVER.md)**: Full architecture, tool catalog (77 tools), SSE transport, and Claude Desktop configuration.
* ⚡ **[Live SD-WAN Failover Prompt (BR8 → DC1)](file:///Users/jsuzanne/Github/stigix/docs/MCP_FAILOVER_PROMPT.md)**: Turnkey, single-prompt interactive live failover simulation with real-time narration.
* 🧪 **[Convergence Lab Guide](file:///Users/jsuzanne/Github/stigix/docs/CONVERGENCE_LAB.md)**: Sub-second high-precision convergence test framework details.

