> **Last Updated:** 2026-09-30 | **Created:** 2026-09-30 (v2.0.111)

# Stigix Private & Hybrid Deployment Topologies Guide

This guide provides a comprehensive, pedagogical overview of all deployment scenarios supported by Stigix. It explains how the **Control Plane** (Fleet Gateway WebSocket Tunnels, Local Registry, and Global Provisioning) and the **Data Plane** (Traffic Generator, DEM, VoIP, IPerf, and Security) operate across private labs, enterprise LAN/WANs, and multi-cloud environments (AWS, GCP, Azure, Hetzner) **without requiring inbound firewall ports or public IP addresses on the Leader**.

---

## 🎯 Architecture Overview & Key Concepts

Stigix distinguishes between two communication layers:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       STIGIX COMMUNICATION LAYERS                           │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  1. CONTROL PLANE (Layer 7 — WebSocket & HTTP RPC)                          │
│     • Fleet Gateway Tunnels (M5 Inbound & M6 Outbound Reverse Dial)          │
│     • Telemetry streaming (CPU, RAM, interface status every 15s)            │
│     • Single Pane of Glass Proxy UI (1-click remote node control)           │
│     • Global Provisioning Sync (Apps, Custom TCP, Probes, SLA, Security)   │
│                                                                             │
│  2. DATA PLANE (Layer 3/4 — IP Synthetic & Security Traffic)                │
│     • IPerf3 throughput tests & Bandwidth Stress                            │
│     • Real-Time VoIP SIP/RTP audio streams                                  │
│     • Synthetic DEM SaaS probes (Office 365, Salesforce, AWS)               │
│     • EICAR & Security malware inspection flows                             │
│     • Custom TCP Application daemons (SAP, POS, HL7, Banking)               │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 🌐 The 4 Deployment Topologies

```mermaid
flowchart TB
    subgraph S1["Scenario 1: On-Premise LAN / MPLS"]
        L1["Leader (DC1: 192.168.1.10)"] ---|"Direct HTTP / LAN"| P1["Spokes (BR1, BR2)"]
    end

    subgraph S2["Scenario 2: Remote Branch behind NAT/CGNAT"]
        P2["Spoke behind NAT (Home / 4G)"] -->|"M5: Spoke dials Leader WS"| L2["Leader (DC1: Port 8080 Open)"]
    end

    subgraph S3["Scenario 3: Private Leader + Cloud Peers (Zero Inbound)"]
        L3["Leader (Private RFC1918 LAN - 0 Inbound Ports)"] -->|"M6: Leader dials Cloud WS"| P3["Cloud Peer (Hetzner, AWS, GCP)"]
    end

    subgraph S4["Scenario 4: Public SaaS Leader"]
        L4["Leader (Public FQDN / Cloudflare)"] <-->|"Cloudflare Worker Registry"| P4["Global Mesh Nodes"]
    end
```

---

### Scenario 1: Private Leader + Private Spokes (Standard On-Premise / LAN / MPLS)

#### Use Case
You are running Stigix inside an enterprise data center or private lab where all nodes reside on the same Layer 2/3 network (e.g. `192.168.122.0/24`, `192.168.123.0/24`) or are interconnected via MPLS/corporate VPN.

```mermaid
sequenceDiagram
    autonumber
    participant DC1 as DC1 Leader (192.168.122.51)
    participant BR1 as BR1 Branch Peer (192.168.122.57)

    Note over BR1,DC1: Control Plane (Direct HTTP)
    BR1->>DC1: HTTP POST /api/registry/heartbeat (every 15s)
    DC1-->>BR1: 200 OK (Peer Registered)
    BR1->>DC1: HTTP GET /api/provisioning/pull
    DC1-->>BR1: Returns configuration bundles

    Note over BR1,DC1: Data Plane (Direct IP Routing)
    BR1->>DC1: IPerf3 / Voice RTP / TCP Custom Traffic
```

* **Control Plane**: Spokes send direct HTTP heartbeats to `http://<LEADER_IP>:8080/api/registry`.
* **Data Plane**: Full bidirectional routing between all nodes.
* **Configuration**:
  * **Leader**: Select `Role: Forced Leader` or set `STIGIX_REGISTRY_MODE=leader`.
  * **Spoke**: In `Settings -> Target Controller`, set *Leader IP / FQDN* to `http://192.168.122.51:8080/api/registry`.

---

### Scenario 2: Private Leader + Remote Spokes behind NAT / CGNAT (Inbound Tunnel M5)

#### Use Case
The Leader resides in a central data center (with port 8080 reachable from branches), while branch nodes are deployed in home offices, retail shops, or LTE/5G routers behind strict NAT or CGNAT where **no inbound ports can be opened on the branch**.

```mermaid
sequenceDiagram
    autonumber
    participant DC1 as DC1 Leader (Hub)
    participant Spoke as Spoke (Behind Home NAT / 4G)

    Note over Spoke,DC1: M5: Spoke initiates outbound WebSocket connection
    Spoke->>DC1: WS Connect to ws://<DC1_IP>:8080/fleet-tunnel
    DC1-->>Spoke: WS Established (Persistent L7 Tunnel)
    
    loop Every 15s
        Spoke->>DC1: WS peer:telemetry (CPU, RAM, Status)
    end

    Note over DC1,Spoke: Operator clicks Spoke in DC1 UI (Zero Port Forwarding)
    DC1->>Spoke: WS gateway:forward (GET /api/status)
    Spoke-->>DC1: WS gateway:forward response
```

* **Control Plane**: Spoke opens an outbound WebSocket connection to the Leader. Once open, the Leader can proxy UI requests and inspect logs in real time.
* **Data Plane**: Spoke can generate traffic toward the Leader; Leader cannot originate direct IP traffic into the Spoke unless routed through an SD-WAN overlay tunnel.
* **Configuration**:
  * **Spoke**: In `Settings -> Target Controller`, configure the Leader URL. The WebSocket client connects automatically.

---

### Scenario 3: Private Leader + Multi-Cloud Peers (Outbound Reverse Dial M6 — Zero Inbound on Leader)

#### Use Case
**This is the most powerful and secure hybrid deployment.**
* Your Leader resides in your **Private Home LAN / Lab** (e.g. `192.168.122.51`) behind a standard internet router. **You do NOT want to open any port on your firewall or expose your lab to the Internet.**
* You deploy Stigix nodes on Public Cloud VPS providers (**Hetzner, AWS EC2, GCP Compute Engine, Azure VM**).

```mermaid
sequenceDiagram
    autonumber
    actor Admin as Admin (Lab UI)
    participant DC1 as DC1 Private Leader (LAN)
    participant Cloud as Hetzner / AWS Peer (Public IP: 142.132.193.157)

    Admin->>DC1: Adds Manual Target "Hetzner" (142.132.193.157:8080)
    
    Note over DC1,Cloud: M6: Leader initiates outbound connection to Cloud
    DC1->>Cloud: WS Connect to ws://142.132.193.157:8080/fleet-tunnel
    Cloud-->>DC1: WS Tunnel Established (Persistent L7 Link)

    Note over Cloud,DC1: Automated Provisioning Sync over WS
    Cloud->>DC1: WS provisioning:get_manifest
    DC1-->>Cloud: Manifest (Revisions & Checksums)
    Cloud->>DC1: WS provisioning:pull_bundle (custom-tcp-apps, apps, probes)
    DC1-->>Cloud: Bundle Payloads
    Cloud->>Cloud: Hot-reloads TCP Servers & SaaS Probes (rev 1 applied)

    loop Telemetry Stream
        Cloud->>DC1: WS peer:telemetry (every 15s)
        DC1->>DC1: Ingests into Local Registry (Status: Online ⚡ WS Tunnel)
    end

    Note over Admin,Cloud: Single Pane of Glass Control
    Admin->>DC1: Switches to "⚡ Hetzner" in top bar
    DC1->>Cloud: WS gateway:forward (Executes tests on Cloud)
    Cloud-->>DC1: Returns results to Leader UI
```

#### Why this works without configuration on the Cloud Peer:
1. **Zero-Touch Cloud Setup**: Start the container on the VPS (`docker run -d -p 8080:8080 jsuzanne/stigix:v2`). No need to log into the VPS or configure Leader IP.
2. **Leader Adoption**: Add the target host in `DC1 -> Settings -> Stigix Targets`. DC1 immediately dials out to the VPS.
3. **Bi-Directional L7 Control**:
   * Hetzner streams real-time telemetry back to DC1.
   * Hetzner pulls all configuration bundles (`custom-tcp-apps`, SaaS apps, connectivity probes) over the WebSocket tunnel.
   * Hetzner status switches to **`⚡ WS Tunnel Synced`** with all green revision badges.
4. **Data Plane Behavior**:
   * Hetzner acts as an external reflector / responder for traffic originating from branches (`BR1 -> Hetzner`).
   * Hetzner can execute synthetic tests toward public SaaS/Cloud endpoints (Office 365, AWS, Salesforce) controlled directly from DC1's dashboard.

---

### Scenario 4: Public SaaS Leader + Distributed Global Mesh

#### Use Case
You deploy the Stigix Leader on a public cloud instance with a valid DNS name (e.g. `https://stigix.company.com`) or via Cloudflare Worker Registry.

* **Control Plane**: All spoke nodes globally register to the central registry.
* **Data Plane**: Full mesh testing across multi-region networks.
* **Configuration**: Nodes use Cloudflare Worker Autodiscovery (`STIGIX_REGISTRY_URL`) or direct HTTPS URLs.

---

## 📊 Feature & Protocol Compatibility Matrix

| Capability | Scenario 1 (LAN/MPLS) | Scenario 2 (NAT Spoke M5) | Scenario 3 (Cloud Peer M6) | Scenario 4 (Public SaaS) |
| :--- | :---: | :---: | :---: | :---: |
| **Inbound Ports required on Leader** | None (LAN only) | Port 8080 | **0 (Zero)** | Port 443 / 8080 |
| **Inbound Ports required on Peer** | None (LAN only) | **0 (Zero)** | Port 8080 | 0 (Zero) |
| **Telemetry Streaming (CPU/RAM/Health)** | ✅ HTTP Poll (15s) | ✅ WS Push (15s) | ✅ WS Push (15s) | ✅ HTTP / WS |
| **Single-Pane-of-Glass Remote Proxy UI** | ✅ Direct | ✅ WS Proxy | ✅ WS Proxy | ✅ Direct / WS |
| **Global Provisioning Sync** | ✅ HTTP Pull | ✅ WS Pull/Push | ✅ WS Pull/Push | ✅ HTTP Pull |
| **Custom TCP Apps Server Mode** | ✅ | ✅ | ✅ | ✅ |
| **Traffic Generation from Branch to Node**| ✅ | ✅ | ✅ | ✅ |
| **Traffic Generation from Node to Branch**| ✅ | Requires VPN | Requires VPN | Requires VPN |

---

## 🛠️ Step-by-Step Runbook: Adding a Cloud VPS Target (Scenario 3)

### Step 1: Deploy Stigix on Cloud VPS (e.g. Hetzner, AWS, GCP, Azure)
Run standard Docker on the remote server:
```bash
docker run -d \
  --name stigix \
  --restart unless-stopped \
  -p 8080:8080 \
  jsuzanne/stigix:v2
```

### Step 2: Add Target on your Private Leader (DC1)
1. Open your private Leader dashboard (`https://sdwandc1.carenaje.fr` or `http://192.168.122.51:8080`).
2. Navigate to **Settings ➔ Stigix Targets**.
3. Click **`+ ADD TARGET`**:
   * **Target Name**: `Hetzner-Cloud`
   * **Host / IP**: `142.132.193.157`
   * **Port**: `8080`
   * **Capabilities**: Check Voice, Speedtest, Security, Failover.
4. Click **Save**.

### Step 3: Verify Automated Adoption & Sync
1. Navigate to **Settings ➔ Target Controller**:
   * The Cloud node will show status **`⚡ WS Tunnel Synced`**.
   * Clicking **`TEST`** verifies the WebSocket link and displays round-trip latency (`RTT: ~18ms`).
2. Navigate to **Mesh Overview**:
   * `Hetzner-Cloud` displays with the **`⚡ WS Tunnel`** badge.
3. Use the **Instance Switcher** in the top navigation bar to select `⚡ Hetzner-Cloud` and control the remote node directly from your private lab.

---

## 📜 Revision History

| Date | Stigix Version | Author / Trigger | Summary of Changes |
|---|---|---|---|
| 2026-09-30 | `v2.0.111` | Stigix Core Team | Initial creation of Private & Hybrid Deployment Topologies Guide covering M5/M6 WebSocket Tunnels, Zero-Inbound Leader, and Multi-Cloud Provisioning Sync |
