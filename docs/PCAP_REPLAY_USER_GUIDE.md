> **Last Updated:** 2026-10-04 | **Created:** 2026-10-04 (v2.0.149)

# 📖 User Guide — Stigix Stateful PCAP Replay Engine
## *Zero-Config L7 Application Replay, SASE Security Benchmarking & Fleet Auto-Sync*

---

## 📑 Table of Contents
1. [Why Stateful PCAP Replay? (Stateful Socket Turns vs Raw Packet Blasting)](#1-why-stateful-pcap-replay-stateful-socket-turns-vs-raw-packet-blasting)
2. [Architecture Overview & Zero-Config Replay](#2-architecture-overview--zero-config-replay)
3. [Step-by-Step Guide: From Raw PCAP to Live SASE Validation](#3-step-by-step-guide-from-raw-pcap-to-live-sase-validation)
   - [Step 1: Upload Capture (.pcap, .pcapng, or Encrypted .zip)](#step-1-upload-capture-pcap-pcapng-or-encrypted-zip)
   - [Step 2: Flow Inspection, Noise Filtering & Profile Compilation](#step-2-flow-inspection-noise-filtering--profile-compilation)
   - [Step 3: Instant Fleet Auto-Sync Across All Spoke Nodes](#step-3-instant-fleet-auto-sync-across-all-spoke-nodes)
   - [Step 4: Executing the Replay (Server Listener & Client Initiator)](#step-4-executing-the-replay-server-listener--client-initiator)
4. [Decoding SASE Firewall Verdicts](#4-decoding-sase-firewall-verdicts)
   - [Verdict 1: BYPASS (Allowed)](#verdict-1-bypass-allowed)
   - [Verdict 2: ENFORCED (TCP RST Injection)](#verdict-2-enforced-tcp-rst-injection)
   - [Verdict 3: ENFORCED (Silent Drop / Timeout)](#verdict-3-enforced-silent-drop--timeout)
   - [Verdict 4: ENFORCED (HTTP Block Page)](#verdict-4-enforced-http-block-page)
   - [Verdict 5: INCONCLUSIVE (Network / Transport Failure)](#verdict-5-inconclusive-network--transport-failure)
5. [The Modal Workflow vs Main PCAP Replay Dashboard](#5-the-modal-workflow-vs-main-pcap-replay-dashboard)
6. [Wireshark-Style Hex Dump & Payload Inspector](#6-wireshark-style-hex-dump--payload-inspector)
7. [Looping & Continuous Soak Testing](#7-looping--continuous-soak-testing)
8. [Frequently Asked Questions (FAQ) & Troubleshooting](#8-frequently-asked-questions-faq--troubleshooting)

---

## 1. Why Stateful PCAP Replay? (Stateful Socket Turns vs Raw Packet Blasting)

Traditional packet replay tools (such as `tcpreplay` or raw scapy senders) suffer from fatal limitations when testing modern Next-Gen Firewalls (NGFW) and SASE security architectures (Palo Alto Prisma Access / SD-WAN):

* **Raw Packet Blasting Breaks on L3/L4 Routing**: Tools like `tcpreplay` blast raw Ethernet frames with historical, hardcoded MAC addresses and source IP addresses from where the PCAP was originally captured (e.g. `10.42.0.12`). In a modern routed SD-WAN overlay, these packets are immediately discarded as martians or spoofed traffic.
* **TCP Handshake Desynchronization**: A real firewall state machine tracks TCP Sequence numbers ($SEQ$), Acknowledgements ($ACK$), and TCP window sizes. Blasting replayed packets without negotiating a real, live TCP 3-way handshake with the recipient causes the firewall to drop everything as invalid out-of-order packets.
* **No Real-Time Server Emulation**: Enterprise applications and exploits require stateful request/reply dialogues (e.g., Client sends HTTP GET ➔ Server responds 200 OK ➔ Client requests sub-resource).

### The Stigix Solution: Stateful L7 Turn Replay

Stigix parses the original packet capture, reconstructs the bidirectional application dialogue into ordered **L7 Conversation Turns**, scrubs sensitive credentials, and packages the flow into a compact `.stx-replay` profile:

```
  ┌─────────────────────────────────────────────────────────────────────────────┐
  │                    REAL SD-WAN / PRISMA SASE OVERLAY                        │
  │                                                                             │
  │   STIGIX CLIENT (e.g. BR8)                        STIGIX SERVER (e.g. DC1)  │
  │   Real IP: 192.168.219.1                          Real IP: 192.168.203.100  │
  │                                                                             │
  │   1. Live TCP 3-Way Handshake (SYN ➔ SYN-ACK ➔ ACK) on port 10080          │
  │   2. Turn #1: Client sends 645B L7 Payload (Scrubbed Exploitation Payload) │
  │        ═══════════════════════════════════════════════════════►             │
  │                   [ Palo Alto NGFW / Prisma SASE ]                          │
  │                   App-ID & Threat Inspection Engine                         │
  │                                                                             │
  │   3. Turn #2: Server responds with 1201B L7 Payload (HTTP 200 OK)           │
  │        ◄═══════════════════════════════════════════════════════             │
  │   4. Clean TCP Teardown / SASE Verdict Generated                            │
  └─────────────────────────────────────────────────────────────────────────────┘
```

Only the Layer 7 application payload is replayed, while Layer 3 and Layer 4 use live, valid sockets traversing your real overlay tunnels!

---

## 2. Architecture Overview & Zero-Config Replay

1. **PCAP Engine (`pcap_parser.py`)**: Uses high-performance Scapy streaming to inspect captures, discover flows, classify background noise, sanitize credentials (passwords, tokens, emails), and generate gzipped `.stx-replay` profiles.
2. **Replay Runtime (`pcap_replay_runtime.py`)**: An asynchronous socket state machine that executes both Server (Listener) and Client (Initiator) roles. It streams real-time JSON events (`turn_completed`, `session_finished`, `loop_cycle_completed`) over stdout to the Web Dashboard.
3. **Global Mesh Provisioning (`provisioning-manager.ts`)**: Profiles compiled or uploaded on the Leader node (DC1) are automatically broadcasted across all spoke nodes (BR1, BR2, BR5, BR8) over encrypted WebSocket tunnels.
4. **Interactive Dashboard (`PcapReplay.tsx`)**: Real-time 3-column workspace featuring a Profiles Catalogue, an interactive Conversation Storyboard with Hex Dump/ASCII inspection, and a SASE Telemetry Hub.

---

## 3. Step-by-Step Guide: From Raw PCAP to Live SASE Validation

### Step 1: Upload Capture (.pcap, .pcapng, or Encrypted .zip)

1. Open the Stigix Dashboard and navigate to the **PCAP Replay** tab.
2. Click the purple **`IMPORT & PARSE PCAP`** button in the top banner.
3. In the upload dropzone:
   - Drag and drop your `.pcap`, `.pcapng`, or `.zip` archive.
   - If importing a password-protected research ZIP (e.g. malware or exploit kit samples), enter the archive password in the **Archive Password (Optional)** field. Stigix also automatically tests standard research passwords (`infected`, `virus`, `infected666p`, etc.).
4. Click **`Inspect & Parse Capture`**.

---

### Step 2: Flow Inspection, Noise Filtering & Profile Compilation

1. **Inspect Flows**: Stigix displays a comprehensive breakdown of all TCP and UDP conversations contained in the file.
2. **Intelligent Noise Filtering**:
   - Background broadcast/multicast packets (`LLMNR`, `mDNS`, `DHCPv6`, NetBIOS, SSDP) are automatically tagged as background noise.
   - Use the **`Unicast Only`** button to deselect all noisy background traffic with one click.
   - Use **`+ TCP`** / **`- TCP`** or **`+ UDP`** / **`- UDP`** to quickly filter by transport protocol.
3. **Configure Replay Metadata**:
   - **Scenario Name**: Give your profile an intuitive name (e.g., `Log4j-Exploit-Simulation`, `VoIP-SIP-Call`).
   - **Default Server Port**: Specify the listener port (defaults to the original port or `10080`).
   - **Scrub Credentials**: Leave checked to automatically redact emails, passwords, and API keys.
4. Click **`Compile & Save Profile`**.

---

### Step 3: Instant Fleet Auto-Sync Across All Spoke Nodes

When you compile a profile on the Leader node (**DC1**):
* Stigix writes the `.stx-replay` file to `/app/config/pcap-profiles/`.
* The **Mesh Provisioning Manager** detects the new profile, bundles it, and broadcasts it to all connected spoke nodes (**BR1, BR2, BR5, BR8**).
* Within milliseconds, the profile appears in the **Profiles Catalogue** across all remote branch dashboards without requiring any manual SCP, SSH, or export/import!

---

### Step 4: Executing the Replay (Server Listener & Client Initiator)

To benchmark firewall inspection between two SD-WAN sites:

#### 1. On the Receiver Node (e.g., DC1):
1. Select the profile in the **Profiles Catalogue** (e.g. `1512`).
2. Switch to **`SERVER MODE`** in the top ribbon.
3. Click the red button: **`START SERVER LISTENER: [Scenario] (PORT 10080)`**.
4. The status pill will display **`PID [x] SERVER • RUNNING`** and enter listening state.

#### 2. On the Initiator Node (e.g., BR8):
1. Select the same profile (`1512`).
2. Switch to **`CLIENT MODE`**.
3. Choose the target destination from the peer dropdown (e.g., **`DC1-Ubuntu (192.168.203.100)`**).
4. Verify the port matches the server (`10080`).
5. Click **`LAUNCH CLIENT: [Scenario] ➔ 192.168.203.100`**.

---

## 4. Decoding SASE Firewall Verdicts

As the conversation turns execute across the SD-WAN overlay, the **SASE Telemetry Hub** calculates a real-time security enforcement verdict:

```
┌───────────────────────────────────────────────────────────────────────────────┐
│ SASE VERDICT: BYPASS (ALLOWED)                         PID 20435 · CLIENT OK  │
│ Full L7 application session completed without inspection drop or TCP RST.     │
├───────────────┬─────────────────┬────────────────────┬────────────────────────┤
│ TURNS PROGRESS│ DATA VOLUME     │ REPLAY DURATION    │ TARGET HOST            │
│    2 / 2      │ 2.3 KB          │ 3.29 ms            │ 192.168.203.100:10080  │
└───────────────┴─────────────────┴────────────────────┴────────────────────────┘
```

### Verdict 1: BYPASS (Allowed)
* **Visual in UI**: 🟢 **Emerald Green Banner** (`CheckCircle2` icon), all turns show green **`DONE`** badges.
* **Network Behavior**: The full conversational transaction completed without disruption. The client sent its requests, the server returned its exact expected responses, and the TCP session terminated cleanly.
* **Firewall Interpretation**: The firewall allowed the traffic. If this was a benign application test, this validates normal service delivery. If this was a malware sample or exploit kit, it indicates a **security gap (policy bypassed)** requiring firewall policy tuning.

### Verdict 2: ENFORCED (TCP RST Injection)
* **Visual in UI**: 🔴 **Bright Red Banner** (`ShieldAlert` icon), `SASE VERDICT: ENFORCED (RESET)`.
* **Network Behavior**: 
  - Modern Next-Gen Firewalls (Palo Alto NGFW / Prisma Access) configure Threat Prevention profiles (Antivirus, Anti-Spyware, Vulnerability Protection) with an active reset action (`reset-client`, `reset-server`, or `reset-both`).
  - As the Deep Packet Inspection (DPI) engine parses the L7 payload stream in real-time, it matches an attack signature.
  - The firewall instantly manufactures and injects a **TCP packet with the `RST` (Reset) flag** set, spoofing the sequence numbers of the conversation.
  - The host operating system receives this RST packet and severs the TCP socket.
* **Firewall Interpretation**: **Security policy successfully enforced!** The threat was actively intercepted and terminated before damage could occur.

### Verdict 3: ENFORCED (Silent Drop / Timeout)
* **Visual in UI**: 🟠 **Amber / Orange Banner** (`ShieldAlert` icon), `SASE VERDICT: ENFORCED (DROP)`.
* **Network Behavior**: 
  - Strict security rules, Blackhole routing, or Denial-of-Service (DoS) mitigation profiles are often set to the **`drop`** action instead of reset.
  - The firewall quietly discards the attacking packets into a blackhole without sending any response (no RST, no ICMP unreachable).
  - The client waiting for the expected server response experiences a complete communication freeze until its application-layer socket timer expires (default: 5 seconds).
* **Firewall Interpretation**: **Security policy successfully enforced via drop!** The firewall prevented the payload from reaching the target server without confirming its presence to the attacker.

### Verdict 4: ENFORCED (HTTP Block Page)
* **Visual in UI**: 🔴 **Crimson Banner**, `SASE VERDICT: ENFORCED (BLOCK PAGE)`.
* **Network Behavior**: 
  - When URL Filtering, Decryption, or Web Proxy policies trigger, the firewall acts as a man-in-the-middle proxy and returns an HTTP response containing a branded corporate access denial notice (`<title>Access Denied</title>`, Palo Alto block page template).
  - Stigix inspects the returned payload and recognizes that the real application response was substituted with a security notification page.
* **Firewall Interpretation**: **User-facing security enforcement!** The access was blocked and redirected to a captive notification portal.

### Verdict 5: INCONCLUSIVE (Network / Transport Failure)
* **Visual in UI**: ⚪ **Muted Gray Banner**, `PID [x] CLIENT · FAILED`.
* **Network Behavior**: The TCP 3-way handshake failed immediately (e.g. `Connection refused` in 0.06 ms with `0 B TX / 0 B RX`) because the server process was not listening or the route was unavailable.
* **Firewall Interpretation**: **Test invalid**. The firewall could neither permit nor block the flow because **the attack payload was never actually transmitted across the wire**. Ensure the Server Listener is started on the target host before launching the client.

---

## 5. The Modal Workflow vs Main PCAP Replay Dashboard

When using the **`IMPORT & PARSE PCAP`** modal, you will notice 3 numbered tabs:

1. **`1. Upload Capture`**: File selection & archive password input.
2. **`2. Flow Inspection & Compile`**: Flow selection and profile compilation.
3. **`3. Live Replay Runner`**: Legacy embedded mini-runner.

### Why does clicking "Compile" exit the modal?
As soon as you click **`Compile & Save Profile`**, Stigix automatically closes the modal and redirects you directly to the **Full-Page PCAP Replay Dashboard**.

This behavior is intentional:
* The full-page dashboard provides a significantly superior experience: a large 3-column workspace, real-time Hex Dump inspection, full-width timeline, and persistent server controls.
* The tab `3. Live Replay Runner` remains accessible inside the modal if an operator wants to run a quick test without saving to the permanent catalog, but the primary workspace is the main dashboard.

---

## 6. Wireshark-Style Hex Dump & Payload Inspector

Clicking on any turn in the **Conversation Sequence** highlights that specific step and populates the **Turn Payload Inspector** at the bottom of the screen:

* **HEX DUMP View**: Displays classical 16-byte aligned hexadecimal offsets on the left, paired with printable ASCII characters on the right.
* **CLEAN ASCII View**: Strips binary framing and displays sanitized HTTP headers, REST JSON, or decoded text.
* **Copy Payload Action**: 1-click clipboard icon copies raw hex or sanitized ASCII for external analysis in CyberChef or Wireshark.

---

## 7. Looping & Continuous Soak Testing

To perform continuous load testing, firewall session table stress testing, or long-term SD-WAN SLA validation:

1. In **`CLIENT MODE`**, check the **`Loop`** checkbox.
2. Enter the desired interval in the **`[3] s`** input field (defaults to 3 seconds).
3. Click **`LAUNCH CLIENT`**.
4. The client will repeat the full conversation turn sequence every $N$ seconds, continuously updating the **Cumulative Data Volume** counter (`Total MB Exchanged`) and displaying a live pulsing **`Loop #X`** badge.
5. Click **`STOP CLIENT`** at any time to cease transmission.

---

## 8. Frequently Asked Questions (FAQ) & Troubleshooting

### Q: Why do I get "Connection refused" immediately when launching the client?
**A**: Ensure that the **Server Mode** listener is actively running on the target machine on the exact same port (`10080` by default). Remember:
* If testing across SD-WAN from **BR8 ➔ DC1**, start the Server on **DC1** and launch the Client from **BR8** towards `192.168.203.100`.
* If testing on a single machine (**Loopback**), target `127.0.0.1`.

### Q: Does the PCAP replay expose my real passwords or production IP addresses?
**A**: No. The PCAP compilation engine automatically scrubs sensitive credentials (Basic Auth, Bearer tokens, passwords, emails). Furthermore, original L3 IP addresses from the capture are completely discarded: all replayed packets use the live, valid IP addresses of your Stigix hosts.

### Q: How does the Server know when a session is finished?
**A**: The server follows the state machine defined in the `.stx-replay` file. Once the final turn is acknowledged and transmitted, the server cleanly closes the client socket and immediately returns to listening for the next incoming test.

---

## 📜 Revision History

| Date | Stigix Version | Author / Trigger | Summary of Changes |
|---|---|---|---|
| 2026-10-04 | `v2.0.149` | Stigix Core Team | Initial creation of the Stateful PCAP Replay Engine User Guide |
