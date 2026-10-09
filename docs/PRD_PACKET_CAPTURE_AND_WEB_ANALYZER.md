# Product Requirements Document (PRD)
## Stigix Live Packet Capture & Web Analyzer

* **Product:** Stigix (The Engine for SASE & SD-WAN Validation)
* **Component:** Network Observability & Packet Capture Module
* **Status:** Specification / Draft v1.0
* **Date:** October 2026
* **Author:** Antigravity AI & Stigix Engineering Team

---

## 1. Vision & Executive Summary

### 1.1 Context & Problem Statement
Today, Stigix excels at **active traffic generation** (Voice, Video, bulk transfers, synthetic DEM probes, Custom TCP Apps) and **trace replay** (PCAP Replay). However, whenever an anomaly occurs in a lab or customer deployment (packet loss, jitter spike, TCP connection drop after 300s, SASE firewall blocking by Prisma/Palo Alto):
* Network engineers are forced to open an SSH terminal directly to the host machine.
* Manually run complex `tcpdump` commands with specific CLI flags.
* Copy the output capture file back to their local workstation via SCP/SFTP.
* Open the `.pcap` in Wireshark locally to diagnose issues.

### 1.2 Product Goal
Provide an integrated **Packet Capture & Web Inspector** natively inside the Stigix Web Dashboard allowing users to:
1. **Capture** traffic on the active transmit/receive network interface directly from the Web UI.
2. **Inspect and filter** captured packets in-browser with a responsive, modern Wireshark-like 3-pane inspector.
3. **Close the operational loop** with the Stigix ecosystem: download `.pcap` files or inject them in **1 click into the PCAP Replay Engine**.

```mermaid
graph LR
    A[Stigix Traffic Engine] -->|Ingress / Egress Traffic| B(Host Network Interface)
    B -->|tcpdump / ring buffer| C[Capture Service]
    C -->|Stream / NDJSON| D[Web Packet Analyzer UI]
    C -->|Export .pcap| E[Local Wireshark]
    C -->|1-Click Inject| F[Stigix PCAP Replay Engine]
```

---

## 2. Personas & Core Use Cases

| Persona | Role | Core Value Proposition |
|---|---|---|
| **SASE / SD-WAN Architect** | Qualification & Benchmarking | Unambiguously prove whether a cloud security gateway (Prisma Access, Zscaler, FortiGate) drops or resets a flow (TCP RST, ToS/DSCP rewrite). |
| **Network Support Engineer** | Incident Troubleshooting | Quickly understand why a persistent session drops (e.g., 300-second firewall idle timeout, missing keepalives, MTU path fragmentation). |
| **QA / Automation Engineer** | Continuous Validation | Trigger automatic captures when a synthetic DEM probe breaches its SLA threshold. |

---

## 3. Functional Specifications

The module consists of three major components:

### 3.1 Backend Capture Orchestrator
1. **Interface Selection:**
   * Auto-discovery of available physical and virtual interfaces (`interfaces.txt` and system introspection).
   * Default selection: the active interface configured for traffic generation.
2. **Capture Filters (BPF - Berkeley Packet Filter):**
   * Free-form BPF input field (e.g., `tcp port 80 or tcp port 443`, `host 192.168.122.51`).
   * 1-Click Quick Presets ("Traffic Gen Only", "Custom TCP Apps Only", "DNS Only", "Voice RTP/SIP Only").
3. **Safety Guardrails & Resource Limits:**
   * **Duration Limit:** Configurable auto-stop (default: 30 seconds, maximum: 300 seconds).
   * **Packet Limit:** Automatic stop upon reaching a threshold (e.g., 5,000 packets max).
   * **Disk Quota:** Immediate abort if the capture file exceeds 50 MB.
   * **Optional Snaplen:** Option to truncate packets to the first 128 bytes (headers only) to preserve bandwidth, CPU, and user privacy.

---

### 3.2 In-Browser Packet Inspector
The user interface provides a clean, modern 3-pane layout inspired by standard protocol analyzers:

```
+---------------------------------------------------------------------------------------+
| [Interface: eth0 v] [Filter: tcp.flags.reset == 1  [Apply]] [▶ Start] [■ Stop] [⬇ Export]|
+---------------------------------------------------------------------------------------+
| No. | Time    | Source         | Destination    | Proto | Len | Info                 |
| 1   | 0.0000  | 192.168.123.102| 192.168.203.100| TCP   | 74  | 54321 → 2323 [SYN]    |
| 2   | 0.0012  | 192.168.203.100| 192.168.123.102| TCP   | 74  | 2323 → 54321 [SYN,ACK]|
| 3   | 0.0013  | 192.168.123.102| 192.168.203.100| TCP   | 66  | 54321 → 2323 [ACK]    |
+---------------------------------------------------------------------------------------+
| ▼ Frame 2: 74 bytes on wire                                                           |
| ▶ Ethernet II, Src: 52:54:00:... Dst: 52:54:00:...                                   |
| ▼ Internet Protocol Version 4, Src: 192.168.203.100, Dst: 192.168.123.102           |
| ▼ Transmission Control Protocol, Src Port: 2323, Dst Port: 54321                      |
|     Flags: 0x012 (SYN, ACK)                                                           |
+---------------------------------------------------------------------------------------+
| 0000  52 54 00 12 34 56 52 54  00 78 9a bc 08 00 45 00  RT..4VRT .x....E.            |
| 0010  00 3c 1a 2b 40 00 40 06  b2 a1 c0 a8 cb 64 c0 a8  .<.+@.@. .....d..            |
+---------------------------------------------------------------------------------------+
```

1. **Virtual Packet Table:**
   * High-performance virtualized rendering (handles thousands of frames smoothly without browser lag).
   * Protocol-based syntax highlighting (TCP in blue/green, UDP/RTP in yellow/orange, ICMP/Errors/RST in rose/red).
2. **Protocol Tree Dissection:**
   * Expandable OSI layers: Frame, Ethernet, IPv4/IPv6, TCP/UDP, Application Payload.
   * Clear display of TCP flags, acknowledgment numbers, window sizing, and ToS/DSCP headers.
3. **Hex/ASCII Dump Viewer:**
   * Synchronized byte highlighting when selecting fields in the protocol tree.

---

### 3.3 Dynamic Display Filtering
* Client-side dynamic filtering without needing to re-capture:
  * By IP: `ip.addr == 192.168.203.100` or `ip.src == ...`
  * By Port: `tcp.port == 2323`
  * By Anomaly: `tcp.flags.reset == 1`, `tcp.analysis.retransmission`
  * By Protocol: `dns`, `icmp`, `tls`, `http`

---

### 3.4 Ecosystem Synergies
* **1-Click "Send to Replay":** Automatically exports the captured trace into `/app/config/pcapsamples/` to replay it instantly across other sites via the stateful L7 replay engine.
* **Auto-Trigger on SLA Breach (Phase 3):** Option to maintain a 10 MB in-memory ring buffer. If a DEM probe drops below critical thresholds (< 40% score or > 10% packet loss), the preceding 30 seconds are frozen into a downloadable `.pcap` linked to the incident event.

---

## 4. Technical Architecture

### 4.1 Backend Engine (Node.js & Linux Native)
* **Packet Capture:** Controlled execution of `tcpdump` / `dumpcap` child process:
  ```bash
  tcpdump -i <iface> -U -s 1500 -w - [BPF_FILTER]
  ```
* **Dissection & Streaming:**
  * Real-time packet parsing via piped `tshark -T ek` (Elasticsearch NDJSON format) or native NDJSON streaming over WebSocket / Server-Sent Events (SSE).
  * Concurrent writing of raw binary `.pcap` to `/var/log/sdwan-traffic-gen/captures/`.
* **API Endpoints:**
  * `POST /api/capture/start` : Initiates a capture session with specified options.
  * `POST /api/capture/stop` : Gracefully halts the active capture session.
  * `GET /api/capture/stream` : WebSocket / SSE stream providing dissected packets.
  * `GET /api/capture/download/:id` : Downloads the raw `.pcap` file.
  * `POST /api/capture/send-to-replay` : Copies the trace into the PCAP replay catalog.

### 4.2 Frontend Architecture (React & TypeScript)
* Virtualized table component for low memory footprint and 60 FPS scrolling.
* Lightweight client-side NDJSON parser.
* Consistent dark mode theme adhering to Stigix glassmorphism and Tailwind tokens.

---

## 5. Performance, Safety & Resource Guardrails

### 5.1 Performance Risk Profile
Capturing network traffic in a multi-gigabit environment introduces potential contention:
* **Low-to-Medium Flows (90% of use cases):** Synthetic DEM probes, Custom TCP apps (Telnet, APIs), Voice RTP, and Security validation generate between 10 to 5,000 pps (packets per second). In this operating envelope, `tcpdump` resource overhead is **completely negligible (< 1-2% CPU, < 10 MB RAM)**.
* **High-Throughput Collision (High Risk):** During full-rate Bandwidth Tests (XFR / iPerf3 at 500 Mbps – 1 Gbps), packet arrival rates can reach **80,000+ pps**, equivalent to **~125 MB/s of raw disk I/O**. Without strict safeguards, an unconstrained capture could introduce CPU throttling, saturate disk I/O, and artificially skew speedtest results.

---

### 5.2 The 5 Non-Negotiable Performance Guardrails

```
+-----------------------------------------------------------------------------------------+
|                              PACKET CAPTURE SAFETY PIPELINE                             |
+-----------------------------------------------------------------------------------------+
| [NIC Interface]                                                                         |
|        │                                                                                |
|        ▼                                                                                |
| 1. KERNEL BPF FILTER  ─── (Drop unwanted bulk flows e.g. 'not port 9000' in kernel)    |
|        │                                                                                |
|        ▼                                                                                |
| 2. SNAPLEN TRUNCATION ─── (Truncate to 128B headers: cuts 93% of disk & CPU load)       |
|        │                                                                                |
|        ▼                                                                                |
| 3. NICE / IONICE      ─── (Process priority nice -n 10, ionice -c 3: Zero traffic impact)|
|        │                                                                                |
|        ▼                                                                                |
| 4. HARD LIMITS        ─── (Auto-stop at 30s or 50 MB ceiling: Zero disk exhaustion)     |
|        │                                                                                |
|        ▼                                                                                |
| 5. DECOUPLED STREAM   ─── (Throttled UI preview at 50 pps max; full dissection on-demand) |
+-----------------------------------------------------------------------------------------+
```

#### 🛡️ Guardrail 1: Default Header-Only Snaplen (`snaplen = 128 bytes`)
* **Policy:** By default, all captures automatically enforce `-s 128` (or `-s 96` for standard IP/TCP).
* **Benefit:** Retains 100% of crucial diagnostic headers (Ethernet, VLAN 802.1Q, IPv4/IPv6, TCP/UDP ports, TCP sequence/ACK numbers, flags, window sizes, and ToS/DSCP QoS markings) while discarding bulky application payloads.
* **Impact:** Reduces disk I/O and memory throughput by **90% to 95%** compared to full-frame capture. Full payload capture requires an explicit, intentional toggle in the UI.

#### 🛡️ Guardrail 2: In-Kernel BPF Filtering (Pre-Copy Drop)
* **Policy:** Capture filters are compiled and evaluated directly within the Linux kernel socket filter engine (`cBPF`/`eBPF`).
* **Benefit:** Unmatching packets (e.g. background traffic or other ports) are discarded inside the network driver/kernel ring buffer **before** any memory copy to userspace occurs, consuming zero disk and near-zero CPU.

#### 🛡️ Guardrail 3: XFR / High-Speed Test Collision Avoidance
* **Policy:**
  * When capturing on an interface where Stigix XFR (Port 9000) or high-speed bandwidth testing is running, the capture engine automatically appends `and not port 9000` to general captures unless the user explicitly checks "Include High-Speed Bandwidth Traffic".
  * The Web UI displays a clear visual badge: `⚠️ Bandwidth Test Active — High-speed ports excluded to protect test accuracy`.

#### 🛡️ Guardrail 4: Decoupled Two-Stage Dissection Pipeline
* **Policy:**
  * **During Capture:** The backend process writes raw binary `.pcap` to disk without running real-time heavy protocol dissection on every packet.
  * **Live UI Preview:** The WebSocket/SSE stream feeds a sampled summary to the browser (capped at **50 packets/sec** for smooth 60 FPS UI rendering, regardless of line rate).
  * **Full Dissection:** Exhaustive packet-by-packet dissection is performed only on-demand when the user pauses/stops capture or clicks a specific frame.

#### 🛡️ Guardrail 5: Strict Operational & Storage Quotas
* **Time Guard:** Default hard timeout of **30 seconds** (configurable up to a maximum ceiling of 300 seconds).
* **File Quota:** Emergency auto-stop triggered immediately if the file size reaches **50 MB** or packet count hits **5,000 frames**.
* **Disk Retention (FIFO):** Automatic rotation keeping a maximum of **5 capture sessions** (maximum total footprint: 250 MB). Oldest traces are purged automatically.
* **Process Scheduling:** The capture worker process is executed with `nice -n 10` (lower CPU priority) and `ionice -c 3` (idle I/O priority), ensuring that the primary Stigix traffic generation engines and MCP server always retain 100% scheduling priority.

---

## 6. Implementation Roadmap

### 🚀 Phase 1: Core Capture & Download (Quick Win - 1 to 2 days)
* Add the **Live Capture** interface to the dashboard.
* Interface dropdown, BPF filter input, 30s timer, Start/Stop controls.
* Backend `tcpdump` execution, clean termination, and direct `.pcap` download.

### 🔍 Phase 2: In-Browser Inspector & Display Filters (2 to 3 days)
* Live packet table rendering via WebSocket / SSE.
* Protocol dissection tree (Ethernet / IP / TCP / UDP).
* Client-side display filter engine.
* 1-Click "Send to PCAP Replay" button.

### ⚡ Phase 3: Automated Capture on DEM SLA Breach (Advanced)
* Background circular ring buffer (10 MB).
* Automated freeze and archive triggered upon synthetic probe health degradation.
