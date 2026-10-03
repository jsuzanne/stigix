> **Last Updated:** 2026-10-03 | **Created:** 2026-10-03 (v2.0.145)

# 📄 PRD — Stigix PCAP Stateful Replay Engine

## 1. Executive Summary & Business Vision

The **Stigix PCAP Stateful Replay Engine** allows network and security engineers to import real-world application and threat packet captures (`.pcap`, `.pcapng`) directly into Stigix and replay them as live, bidirectional, stateful application traffic between Stigix instances across SD-WAN overlays, SASE tunnels, and hybrid clouds.

### 🌟 The Field Problem (The "Palo Alto UTD / SE Lab" Dilemma)
In current enterprise PoCs, Ultimate Test Drive (UTD) labs, and SASE validation sessions:
* Systems Engineers (SEs) and Technical Marketing Engineers (TMEs) frequently struggle to populate Palo Alto **IoT Device Security**, **App-ID**, and **Threat Prevention** engines with realistic enterprise profiles.
* Today's workaround involves spinning up dedicated Linux VMs, running manual `tcpreplay` scripts, and wiring physical/virtual **TAP interfaces** to feed the firewalls. This is complex, fragile, non-routable across SD-WAN, and impossible to deploy on remote customer branch sites.
* **Stigix solves this completely:** A native, zero-config, 1-click PCAP Replay engine operating directly in-band between Stigix instances across SD-WAN overlays and Prisma SASE.

### The Value Proposition
* **"Bring Your Own Enterprise App" (BYO-App):** Capture 30 seconds of proprietary or legacy enterprise traffic (e.g. SAP GUI, Oracle DB, Citrix ICA, SWIFT, DICOM Medical Imaging, SCADA/Modbus) and replay it instantly across Stigix mesh nodes.
* **100% Deterministic Palo Alto App-ID & Threat Triggering:** Replays exact binary L7 payloads, ensuring firewalls and Prisma SASE recognize the real application signature (`sap-netweaver`, `citrix`, `oracle`, `modbus`) and detect IPS CVEs / C2 beacons.
* **Realistic SD-WAN Failover & QoS Validation:** Validates how SD-WAN underlay impairments (packet loss, latency jitter, bandwidth throttling) impact real business applications with natural TCP window backoff and retransmissions.

---

## 2. Public PCAP Hub & Curated Datasets Browser 🌐

In addition to custom file uploads, Stigix will feature an **Integrated Public PCAP Browser** to fetch and replay verified datasets from major cybersecurity and IoT research repositories with 1 click:

### Curated Repositories & Data Sources
| Repository / Source | Categories | Key Datasets |
| :--- | :--- | :--- |
| **[NETRESEC PcapFiles](https://www.netresec.com/?page=PcapFiles)** | Enterprise, Malware, SCADA, Forensics | CTU-13 Malware, PCAP Attack Repository, ICS/SCADA captures. |
| **[UNSW IoT Analytics](https://iotanalytics.unsw.edu.au/)** | Smart Home, Enterprise IoT, Medical | Real traffic traces from 30+ physical IoT devices (Cameras, Sensors, Audio). |
| **[Aalto University IoT Captures](https://research.aalto.fi/en/datasets/iot-devices-captures/)** | IoT Fleet & Smart Office | Smart assistants, bulbs, printers, IP cameras. |
| **[ICS/SCADA PCAPs (tjcruz-dei)](https://github.com/tjcruz-dei/ICS_PCAPS)** | Industrial & Critical Infrastructure | Modbus TCP, DNP3, IEC 60870-5-104, Siemens S7comm. |
| **[Stratosphere IPS CTU Lab](https://www.stratosphereips.org/)** | C2 Beacons & Botnets | Real-world Cobalt Strike, Sliver C2, Mirai, Emotet captures. |
| **[CIC Cybersecurity Datasets (UNB)](https://www.unb.ca/cic/datasets/index.html)** | IDS / IPS Validation & DDoS | CIC-IDS2017, CSE-CIC-IDS2018, IoT Attack Dataset 2023. |
| **[IEEE DataPort](https://ieee-dataport.org/datasets)** | Research & Industrial | Enterprise network traces, anomaly detection benchmarks. |

### 1-Click Browser Workflow
1. User opens **Custom Apps ➔ PCAP Replay Hub ➔ Browse Public Catalog**.
2. Filters by category: `IoT & OT Devices`, `Enterprise ERP & SaaS`, `Threat Prevention / CVEs`, `C2 Malwares`, `DLP / Data Exfiltration`.
3. Clicks **`[ 📥 Import & Prepare ]`** : Stigix downloads the `.pcap` directly from the research repository, extracts the L7 dialogue, and makes it ready for live replay.

---

## 3. Storage, Memory & Streaming Architecture

### ❓ The Storage Question: *"Does a 1GB PCAP produce a 1GB JSON?"*

In standard network packet captures:
1. **Network Header Overhead:** Ethernet (14B), IP (20B), and TCP headers (20–32B) represent 10–15% of the total capture size.
2. **Empty TCP ACKs & Handshakes:** Pure acknowledgment packets (without data payload) often make up **35% to 50% of total packets** in a TCP stream.
3. **Application Payload Size:** For interactive enterprise transactions (SAP, SQL, CRM, API, IoT telemetry), real application captures are typically between **500 KB and 50 MB**.

### Parsing & Storage Engine

```
[ Raw PCAP File (.pcap / .pcapng) ]
               │
               ▼ (Streaming Parser: scapy.PcapReader / dpkt)
┌─────────────────────────────────────────────────────────────┐
│ 1. Filter out pure TCP ACKs, SYN/FIN without payload        │
│ 2. Reassemble TCP Segments into logical L7 Application Turns│
│ 3. Extract metadata (Server Port, Timers, Byte Counts)      │
└──────────────────────────────┬──────────────────────────────┘
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ Optimized Binary Archive / Compressed Profile (.stx-pcap)   │
│  • Gzip-compressed binary payloads (60–80% size reduction)  │
│  • Chunked stream loading (Zero RAM explosion on Leader)    │
│  • Memory usage capped at < 64 MB per stream                 │
└──────────────────────────────┘
```

#### Size Comparison & Safety Limits:
| Input File | Typical Payload | Stigix Replay Profile | Memory Footprint |
| :--- | :--- | :--- | :--- |
| **5 MB** (ERP / IoT Transaction) | ~3.8 MB payload | **~900 KB** (Compressed) | ~4 MB RAM |
| **50 MB** (Database / Exploit Run) | ~42 MB payload | **~12 MB** (Compressed) | ~18 MB RAM |
| **1 GB** (Large Stream File) | ~900 MB payload | **Chunked Binary Stream** | ~32 MB Stream Buffer |

* **Recommended Capture Limit:** 100 MB for standard stateful interactive replays (covers 99.9% of application transaction and security testing).
* **Streaming Engine:** For captures > 50 MB, the engine reads and streams chunks on-demand without loading the full file into Node.js/Python heap memory.

---

## 4. Deployment Topologies & Routing

```text
A. East-West Private Mesh (LAN / SD-WAN Overlay)
   [ Branch BR8 (192.168.203.10) ] ────── SD-WAN Overlay ──────► [ DC1 (192.168.201.10) ]
   (Source: Stateful Client)                                      (Target: Stateful Server)

B. North-South Internet / SASE Egress Inspection
   [ Branch BR8 (LAN Private) ] ─── Prisma Access SASE ───► [ Stigix Cloud Target ]
   (Source: Attacks & SaaS Probes)  (SSL Decryption & IPS)   (Public IP: Hetzner/AWS)
```

* **East-West (Private Lab):** Replays between two private branch instances (e.g. `BR8 ➔ DC1`).
* **North-South (SASE Egress):** Replays from a private branch (BR8) towards a **Stigix Target hosted on a Public Cloud** (Hetzner / AWS).
  * **100% Legal & Compliant:** Traffic is transmitted between two self-owned Stigix instances.
  * **SASE Protection:** If Prisma Access detects an exploit payload (e.g. Log4j, C2), Prisma blocks it in the cloud before it ever hits the Hetzner host.

---

## 5. TLS, HTTPS & Certificate Handling 🔐

In packet captures, protocol security falls into two categories:

### A. Cleartext Protocols (Zero Certificate Complexity)
* Exploits and attacks: Log4Shell, SQL Injections, Path Traversal, Directory Exploits.
* Industrial & IoT: Modbus TCP, Siemens S7, DNP3, BACnet, MQTT.
* Healthcare: DICOM, HL7 v2.
* Network & C2: DNS Tunneling, SMB / EternalBlue, LDAP.
👉 **Handled natively with 100% fidelity without any certificate setup.**

### B. Encrypted HTTPS / TLS Protocols
* **Layer 7 Re-Encapsulation:** Stigix extracts the cleartext L7 application requests/responses from the capture.
* **Authentic TLS Transport:** Stigix Client and Target negotiate a fresh, valid TLS connection between themselves.
* **Prisma Access SSL Decryption:** Prisma Access intercepts the session, re-signs it on the fly using the **Forward Trust CA** already imported in Stigix, decrypts and inspects the payload, and validates App-ID / Threat Prevention without certificate errors.

---

## 6. Two-Phased Architectural Roadmap

### Phase 1: Stateful L7 Socket Replay (Current Focus)
* **Technology:** Pure Python Sockets + Asyncio State Machine on top of the existing `Custom TCP Apps` framework.
* **Mechanism:** 
  * Stigix Leader extracts the conversation turns (`Client Request ➔ Server Response`).
  * Target Node acts as a **Smart Stateful Listener** (waits for client request, answers with matching pre-recorded response).
  * Source Node acts as a **Stateful Client** (connects to Target, sends requests, awaits responses, records RTT/throughput).
* **Benefits:** 100% NAT/Firewall friendly, zero packet reset (`TCP RST`) issues, natural TCP congestion response under SD-WAN latency and packet loss.

### Phase 2: Raw Line-Rate Stress Replay (Future Evolution)
* **Technology:** `tcprewrite` + `tcpreplay` / AF_XDP raw sockets.
* **Mechanism:** Layer 2/Layer 3 packet-level injection directly into network interfaces.
* **Benefits:** Line-rate multi-gigabit throughput (1–10+ Gbps) for bandwidth saturation, DDoS simulation, and non-TCP/L2 protocol replay.

---

## 7. Data Model & Conversation Schema

When a PCAP is analyzed, it produces a structured replay manifest:

```json
{
  "id": "pcap-sap-ecc-01",
  "name": "SAP ECC Purchase Order Creation",
  "category": "Enterprise ERP",
  "original_file": "sap_po_create.pcap",
  "target_port": 3200,
  "protocol": "tcp_stateful_stream",
  "total_turns": 4,
  "total_bytes_client": 1420,
  "total_bytes_server": 8940,
  "conversation": [
    {
      "step": 1,
      "sender": "client",
      "wait_trigger": "immediate",
      "expected_bytes": 128,
      "payload_base64": "gAAAAABnd8...=="
    },
    {
      "step": 2,
      "sender": "server",
      "wait_trigger": "on_client_receive",
      "response_bytes": 1024,
      "payload_base64": "hBBBBABnd8...=="
    },
    {
      "step": 3,
      "sender": "client",
      "wait_trigger": "immediate",
      "expected_bytes": 256,
      "payload_base64": "jCCCCABnd8...=="
    },
    {
      "step": 4,
      "sender": "server",
      "wait_trigger": "on_client_receive",
      "response_bytes": 7916,
      "payload_base64": "kDDDDABnd8...=="
    }
  ],
  "replay_settings": {
    "loop": true,
    "concurrency": 2,
    "interval_ms": 500
  }
}
```

---

## 8. User Interface & Workflow Specification

### A. Upload & Public Catalog Browser
1. **Drag & Drop Zone:** Accepts `.pcap`, `.cap`, `.pcapng`.
2. **Public PCAP Hub:** 1-click catalog browsing from Netresec, UNSW IoT, ICS SCADA, and Stratosphere IPS.
3. **Auto-Inspection Summary:**
   * Detected Application Name & Detected Server Port (e.g. `3200`).
   * Total Conversations & Total Streams detected.
   * Client Bytes vs. Server Bytes breakdown.
   * Option to override target port if default port is in use.

### B. Deployment & Control Panel
* **Source & Target Selector:** Dropdown to pick which Stigix node plays the Client and which plays the Server (e.g. Source: `BR8-Ubuntu`, Target: `DC1-Ubuntu` or `Hetzner-Cloud`).
* **Traffic Flow Controls:**
  * **Cadence Slider:** Interval between replay sessions (0.1s to 5s).
  * **Concurrency Slider:** Number of parallel client threads (1 to 10 workers).
  * **Loop Mode:** Single-shot verification vs. continuous background generation.
* **Live Observability Cards:**
  * Active Sessions, Real-Time App Latency (RTT p50/p95), Goodput vs. Throughput, and Error/Timeout counters.

---

## 9. Implementation Milestones

| Milestone | Scope | Deliverables |
| :--- | :--- | :--- |
| **M1 — Parser Engine** | Python backend PCAP reassembly & streaming parser (`dpkt`/`scapy`). | CLI extractor script generating `.stx-pcap` JSON manifests. |
| **M2 — Stateful Server/Client Runtime** | Asynchronous Python state machine integrated into `custom-tcp-apps`. | Dynamic listener on Target node and loop generator on Source node. |
| **M3 — Public Catalog Integration** | Pre-indexed download hub for UNSW, Netresec, ICS SCADA, Stratosphere datasets. | 1-click preset library directly in the Web UI. |
| **M4 — Web Dashboard UI** | Drag & Drop upload modal, stream inspection card, and live controls. | Replay management UI integrated into Custom Apps tab. |
| **M5 — Central Provisioning** | Mesh distribution of replay profiles across Leader and Spokes. | Automatic deployment of server listeners and client workloads. |
| **M6 — Phase 2 Raw Replay Hook** | Interface hooks to optionally trigger `tcpreplay` for line-rate stress. | Advanced toggle for raw line-rate packet injection. |

---

## 📜 Revision History

| Date | Stigix Version | Author / Trigger | Summary of Changes |
|---|---|---|---|
| 2026-10-03 | `v2.0.145` | Stigix Core Team | Enriched PRD with Public PCAP Hub (Netresec, UNSW IoT, ICS SCADA, Stratosphere IPS), Palo Alto UTD lab field context, Cloud Target topologies, and TLS certificate strategy. |
| 2026-10-03 | `v2.0.145` | Stigix Core Team | Initial PRD for PCAP Stateful Replay Engine (L7 Socket & Line-Rate roadmap). |
