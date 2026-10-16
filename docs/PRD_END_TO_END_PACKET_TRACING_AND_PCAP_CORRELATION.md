> **Last Updated:** 2026-10-16 | **Created:** 2026-10-16 (v3.0.33)

# 🔬 PRD: End-to-End Distributed Packet Tracing, Quad-Hop Correlation & AI Copilot Diagnostics

---

## 1. Executive Summary & Vision

In enterprise SD-WAN topologies (Branch ION gateways connecting across hybrid WAN underlays like MPLS, Internet, and 5G to Data Center Hubs), one of the most critical network engineering questions is deceptively simple:
> **"Does my IP traffic pass end-to-end, and if not, exactly *where* was it last seen and *where* did it disappear?"**

Currently, troubleshooting packet loss, asymmetric routing, MTU clamping, or firewall drops requires manually logging into multiple command-lines, running disjointed `tcpdump` commands, guessing timestamps, and manually correlating PCAP files in Wireshark.

This PRD specifies **Stigix Distributed Trace**: a unified, multi-point packet capture orchestration and automated correlation system with:
1. **Unified UX / Single Pane of Glass:** Trigger a capture on a single port (Stigix Linux interface or ION LAN/WAN circuit), a 2-point trace (Source Stigix <-> Destination Stigix for round-trip validation), or a **Quad-Hop Trace** (`Stigix-BR` $\rightarrow$ `ION-BR` $\rightarrow$ `ION-DC` $\rightarrow$ `Stigix-DC`).
2. **Barrier Synchronization Orchestrator:** Distributed job runner managing sub-tasks across nodes, waiting for all capture probes to complete, pulling artifacts, and synchronizing time offsets.
3. **Automated Hop-by-Hop Correlation:** Immediate detection of packet presence (`Seen` / `Not Seen` / `Dropped At`), one-way latency ($\Delta t$), TTL degradation, and sequence discrepancies.
4. **AI Copilot & LLM Root-Cause Diagnosis:** Native ingestion of the consolidated trace by the Stigix AI Copilot to deliver instant plain-language conclusions and recommendations.
5. **Model Context Protocol (MCP) Integration:** Exposing FastMCP tools (`stigix_trace_start`, `stigix_trace_status`, `stigix_trace_analyze`) for autonomous AI-driven investigations.
6. **Strict Resource Optimization:** Kernel-level BPF filtering, snaplen payload truncation, ring buffers, and low-footprint streaming analysis to protect CPU and memory on production nodes.

---

## 2. Technical Feasibility & Discovery Findings

### 2.1 Audit of Third-Party / AI Propositions vs. Real Prisma SD-WAN APIs

During initial architectural exploration, theoretical LLM outputs proposed invoking direct REST endpoints on Prisma SD-WAN:
- Theoretical Start Endpoint: `POST /sdwan/v2.1/api/elements/{element_id}/toolkit`
- Theoretical Artifact Endpoint: `GET /sdwan/v2.1/api/elements/{element_id}/toolkit_artifacts`

#### Live Verification Results (Palo Alto Prisma SASE Lab Tenant)
Direct automated API probes executed against active Palo Alto Networks Prisma SASE controllers confirmed:
- `GET /sdwan/v2.1/api/profile` & `v2.0`: **200 OK** (OAuth2 bearer authentication valid).
- `POST /sdwan/v2.1/api/elements/{element_id}/toolkit`: **`404 ROUTE_NOT_FOUND_0001`**.
- `GET /sdwan/v2.1/api/elements/{element_id}/toolkit_artifacts`: **`404 ROUTE_NOT_FOUND_0001`**.

#### Architectural Reality of Prisma SD-WAN (ION) Device Toolkit
1. **Interactive WebSocket Architecture:**
   The Prisma SD-WAN Device Toolkit operates over an interactive full-duplex WebSocket:
   ```text
   wss://api.sase.paloaltonetworks.com/sdwan/v2.0/api/elements/{element_id}/ws/toolkitsessions?cols=207&rows=53
   ```
   This session proxies an interactive TTY shell into the ION operating system.
2. **Shell Command Semantics:**
   Packet captures in the ION Device Toolkit are executed as interactive shell commands:
   ```text
   # Streaming console view:
   tcpdump interface=<id> args="host 10.1.1.5 and port 443" show

   # Saved capture on device flash:
   tcpdump interface=<id> args="host 10.1.1.5" save file=trace.pcap
   ```
3. **Artifact Retrieval Constraints:**
   There is no native public REST API to download PCAP files directly from ION flash storage via HTTP GET. Offloading saved `.pcap` files from an ION appliance requires an outbound SCP export command executed within the toolkit shell:
   ```text
   file export 1 trace.pcap scp://user:pass@stigix-collector.internal:/var/stigix/pcaps/
   ```
4. **Authentication Prerequisite:**
   Connecting to `ws/toolkitsessions` requires element-level administrative privileges or dedicated credentials, which are distinct from tenant-level OAuth service account scopes.

---

## 3. End-to-End Distributed Architecture

### 3.1 Trace Topologies & Hop Pipeline

Stigix supports three operational capture topologies:

```mermaid
flowchart TD
    subgraph Topology_Options["Supported Capture Topologies"]
        direction TB
        Opt1["1. Single-Port Capture\n(Quick inspection on any Stigix interface or ION circuit)"]
        Opt2["2. Dual-Point Capture\n(Source Stigix <-> Destination Stigix: Round-trip & latency)"]
        Opt3["3. Quad-Hop Full Transit Capture\n(Stigix-BR -> ION-BR -> ION-DC -> Stigix-DC: Exact Drop Pinpointing)"]
    end
```

#### Quad-Hop Transit Pipeline Architecture:
```mermaid
sequenceDiagram
    autonumber
    actor User as Engineer / AI Copilot
    participant Orch as Stigix Trace Orchestrator
    participant BR_Host as Stigix-BR (Agent)
    participant BR_ION as ION-BR (Gateway)
    participant DC_ION as ION-DC (Hub)
    participant DC_Host as Stigix-DC (Agent)
    participant AI as Stigix AI Copilot (LLM)

    User->>Orch: POST /api/fleet/trace/start (Target Nodes, BPF Filter, Max: 100 pkts)
    Orch->>BR_Host: Arm Capture (Sub-job 1)
    Orch->>DC_Host: Arm Capture (Sub-job 2)
    opt ION Ingress/Egress Capture
        Orch->>BR_ION: Arm Toolkit Shell (Sub-job 3)
        Orch->>DC_ION: Arm Toolkit Shell (Sub-job 4)
    end

    Note over Orch: Barrier Synchronization (Wait for all probes to hit packet count or timeout)
    BR_Host-->>Orch: Sub-job 1 Done (100 pkts captured)
    DC_Host-->>Orch: Sub-job 2 Done (97 pkts captured)
    opt ION Probes
        BR_ION-->>Orch: Sub-job 3 Exported via SCP (100 pkts)
        DC_ION-->>Orch: Sub-job 4 Exported via SCP (97 pkts)
    end

    Note over Orch: Barrier Complete: Pull artifacts & Correlate Timelines
    Orch->>Orch: Analyze Packet Signatures (TCP Seq / IP ID / Delta-t / TTL)
    Orch->>AI: Send Structured Correlation Matrix
    AI->>User: Natural Language Diagnosis ("3 packets dropped between ION-DC WAN and LAN")
```

---

## 4. Distributed Job Orchestration & Barrier Synchronization

A primary technical challenge in multi-agent packet captures is **timing and artifact synchronization**. Stigix handles this through a deterministic State Machine:

```mermaid
stateDiagram-v2
    [*] --> INITIALIZING: Job Created
    INITIALIZING --> ARMED: Sub-tasks dispatched to nodes
    ARMED --> CAPTURING: Trigger condition met (Traffic generated)
    CAPTURING --> BARRIER_WAIT: Nodes report capture stopped (count/timeout)
    BARRIER_WAIT --> COLLECTING: All active nodes completed or timed out
    COLLECTING --> CORRELATING: PCAPs transferred to Hub & merged
    CORRELATING --> ENRICHING: Query getflow.py SD-WAN paths
    ENRICHING --> AI_ANALYSIS: LLM Copilot generates diagnosis
    AI_ANALYSIS --> COMPLETED: Final report ready for UI / MCP
    CAPTURING --> FAILED: Critical timeout / Node unreachability
```

### 4.1 Barrier Synchronization Protocol
1. **Parallel Dispatch:** The coordinator issues `POST /api/node/trace/arm` simultaneously to all designated targets via the Stigix Fleet Tunnel / Mesh.
2. **Deterministic Boundaries:** Each sub-job runs with strict guards:
   - `max_packets` (default: 100, hard limit: 1,000 for quick captures).
   - `timeout_seconds` (default: 15s, hard limit: 60s).
   - `snaplen` (default: 96 bytes for headers only, or 1514 for full packet).
3. **Barrier Waiting:** The coordinator sets a barrier deadline $T_{barrier} = T_{timeout} + 5\text{s}$.
   - If all nodes report completion before $T_{barrier}$, synchronization succeeds immediately.
   - If a node fails to report, the coordinator marks that specific hop as `OFFLINE / TIMEOUT` and proceeds with correlating the remaining hops.
4. **Artifact Ingestion:** Captured PCAPs are streamed back to the coordinator over HTTP/SCP, stored in `/tmp/stigix_traces/{trace_id}/`, and indexed.

---

## 5. Hop-by-Hop Correlation & Matrix Analysis

### 5.1 Packet Signature Matching
To match packets across heterogeneous nodes without relying on identical absolute clocks, the correlation engine uses an immutable **Packet Fingerprint**:
$$\text{Signature} = \begin{cases} 
(\text{SrcIP}, \text{DstIP}, \text{TCP}, \text{SeqNum}) & \text{for TCP} \\
(\text{SrcIP}, \text{DstIP}, \text{UDP}, \text{IP\_ID}) & \text{for UDP} \\
(\text{SrcIP}, \text{DstIP}, \text{ICMP}, \text{ICMP\_Seq}) & \text{for ICMP}
\end{cases}$$

### 5.2 Hop Status Classification
For each observed packet signature along the pipeline, the engine assigns an explicit status per hop:
- **`SEEN`**: Packet matched with valid checksum, timestamp recorded.
- **`NOT_SEEN`**: Packet was observed at prior hop but never appeared at this hop.
- **`DROPPED_AT`**: Pinpoints the exact segment where transit failed ($Hop_N = \text{SEEN}$, $Hop_{N+1} = \text{NOT\_SEEN}$).
- **`RETRANSMITTED`**: Duplicate sequence detected with newer timestamp.

### 5.3 Metric Computation
- **One-Way Transit Latency ($\Delta t$):** $\Delta t_{Hop_A \to Hop_B} = t_B - t_A$.
- **TTL Decrement ($\Delta TTL$):** Confirms routing hops and loop absence.
- **MSS / MTU Degradation:** Detects fragmentation flags (`DF` bit set with ICMP NeedFrag).

---

## 6. AI Copilot & LLM Root-Cause Analysis

Once the correlation engine produces the structured trace matrix, the **Stigix AI Copilot** automatically processes the telemetry through an inference pipeline to generate an executive diagnostic summary.

### 6.1 Sample LLM Diagnosis Output
```markdown
### 🤖 Stigix AI Copilot Trace Diagnosis

- **Flow:** `192.168.101.50:49152` ➔ `10.0.10.100:8080` (TCP)
- **Status:** ⚠️ Partial Packet Drop Detected (3.0% Loss)
- **Bottleneck Location:** Segment between **ION-DC1 (WAN)** and **ION-DC1 (LAN)**

#### Hop-by-Hop Breakdown:
1. **Stigix-BR1 (Egress):** 100 packets transmitted successfully.
2. **ION-BR1 (LAN ➔ WAN):** 100 packets encapsulated onto circuit `Internet-1`.
3. **WAN Transit:** Transit delay averaged **14.2ms** (Jitter: ±1.2ms). No drops on underlay.
4. **ION-DC1 (WAN Ingress):** 100 packets arrived intact.
5. **ION-DC1 (LAN Egress):** Only **97 packets** forwarded. Packets #32, #45, #86 dropped.
6. **Stigix-DC1 (Ingress):** 97 packets received.

#### 💡 Root Cause & Recommendations:
- The drop occurred inside the DC ION appliance before egressing to the LAN interface.
- **Prisma Flow Browser Correlation:** Flow is classified under Security Zone `Untrusted-WAN` to `DC-Core`. 
- **Recommendation:** Check ION-DC1 Security Policy Rule #14 ("Drop TCP out-of-order") or egress queue buffer saturation on interface `controller 1`.
```

---

## 7. Model Context Protocol (MCP) Integration

To enable autonomous debugging from Claude, Antigravity IDE, or external AI agents, the trace system exposes standard FastMCP tools in `mcp-server/src/server.py`:

### 7.1 MCP Tool Specifications

#### 1. `stigix_trace_start`
- **Description:** Arm and execute a synchronized multi-point packet capture across Stigix nodes and SD-WAN hops.
- **Parameters:**
  - `targets`: List of target node IDs (e.g. `["BR1", "DC1"]`).
  - `filter`: BPF filter string (e.g. `"host 10.0.10.100 and port 8080"`).
  - `max_packets`: Maximum packets to capture per node (default: 100, max: 1000).
  - `timeout_seconds`: Maximum capture duration (default: 15).
  - `include_sdwan_telemetry`: Boolean to auto-query `getflow.py`.

#### 2. `stigix_trace_status`
- **Description:** Poll active trace execution state, barrier synchronization status, and captured packet counts.
- **Parameters:**
  - `trace_id`: Unique identifier of the trace job.

#### 3. `stigix_trace_correlate`
- **Description:** Retrieve the correlated multi-hop packet matrix, one-way latency, packet loss ratio, and download link for merged `.pcapng`.
- **Parameters:**
  - `trace_id`: Unique identifier of the trace job.

#### 4. `stigix_trace_ai_diagnose`
- **Description:** Run LLM root-cause analysis on a completed trace and return structured insights, drop locations, and troubleshooting suggestions.
- **Parameters:**
  - `trace_id`: Unique identifier of the trace job.

---

## 8. Resource & Performance Optimization (CPU & Memory Guardrails)

Because trace captures may run on resource-constrained edge appliances or virtual branches, strict optimization guardrails are enforced:

1. **Kernel-Level BPF Filtering:** All captures apply BPF filters directly at socket creation (`SO_ATTACH_FILTER`), ensuring out-of-scope background packets never enter user space.
2. **Snaplen Header Truncation:** For pure routing/loss diagnosis, captures truncate packet payloads (`-s 96`), retaining only Ethernet, IP, and TCP/UDP headers. This reduces PCAP file sizes and memory consumption by **>90%**.
3. **Hard Packet & Time Caps:** Every capture enforces a hard upper bound ($N \le 100$ default, hard cap $1,000$) and a timeout ($T \le 30\text{s}$). Captures terminate immediately upon reaching either threshold.
4. **Streaming PCAP Ingestion:** The correlation engine processes packets via generators/iterators rather than loading multi-megabyte PCAPs entirely into RAM.
5. **Transient Storage Cleanup:** Raw single-node PCAP chunks in `/tmp/stigix_traces/` are retained for a maximum TTL of 2 hours, with automated background pruning.

---

## 9. API Data Contract

### 9.1 Start Distributed Trace (`POST /api/fleet/trace/start`)
```json
{
  "trace_name": "BR1-to-DC1-Transit-Check",
  "topology": "quad_hop",
  "targets": [
    { "type": "stigix_agent", "node_id": "BR1-Ubuntu", "interface": "eth0" },
    { "type": "prisma_ion", "element_id": "1711389728258005345", "interface": "1" },
    { "type": "prisma_ion", "element_id": "1677770383436024545", "interface": "1" },
    { "type": "stigix_agent", "node_id": "DC1-Debian", "interface": "eth0" }
  ],
  "filter": {
    "protocol": "tcp",
    "src_ip": "192.168.101.50",
    "dst_ip": "10.0.10.100",
    "dst_port": 8080,
    "bpf_override": "tcp and port 8080"
  },
  "limits": {
    "max_packets": 100,
    "timeout_seconds": 15,
    "snaplen_bytes": 96
  },
  "enrichment": {
    "prisma_sdwan_flow": true,
    "ai_copilot_diagnosis": true
  }
}
```

### 9.2 Correlated Trace Report (`GET /api/fleet/trace/{trace_id}`)
```json
{
  "trace_id": "trc-89f412a0",
  "status": "COMPLETED",
  "duration_ms": 1840,
  "barrier_sync": {
    "all_completed": true,
    "total_targets": 4,
    "completed_targets": 4,
    "timed_out_targets": 0
  },
  "hop_pipeline": [
    { "hop_index": 1, "name": "Stigix-BR1 (LAN Source)", "status": "SEEN", "packet_count": 100 },
    { "hop_index": 2, "name": "ION-BR1 (Edge Gateway)", "status": "SEEN", "packet_count": 100 },
    { "hop_index": 3, "name": "ION-DC1 (Hub Gateway)", "status": "DROPPED_AT", "packet_count": 97 },
    { "hop_index": 4, "name": "Stigix-DC1 (LAN Destination)", "status": "SEEN", "packet_count": 97 }
  ],
  "analysis": {
    "total_transmitted": 100,
    "total_received": 97,
    "packet_loss_count": 3,
    "packet_loss_ratio_pct": 3.0,
    "average_oneway_latency_ms": 14.52,
    "min_latency_ms": 13.04,
    "max_latency_ms": 15.94,
    "average_ttl_decrement": 2.0
  },
  "sdwan_underlay": {
    "site": "BR1",
    "exit_interface": "Internet-1",
    "path_type": "standard_vpn",
    "remote_site": "DC1",
    "flow_health": "GOOD"
  },
  "ai_copilot": {
    "summary": "3 packets dropped inside ION-DC1 between WAN arrival and LAN forwarding.",
    "root_cause_hypothesis": "Security policy drop or queue congestion on ION-DC1 LAN.",
    "suggested_action": "Verify ION-DC1 zone policy for destination 10.0.10.100."
  },
  "artifacts": {
    "merged_pcapng": "/api/fleet/trace/trc-89f412a0/merged.pcapng",
    "source_pcaps": {
      "BR1-Ubuntu": "/api/fleet/trace/trc-89f412a0/BR1-Ubuntu.pcap",
      "DC1-Debian": "/api/fleet/trace/trc-89f412a0/DC1-Debian.pcap"
    }
  }
}
```

---

## 10. User Experience & Dashboard Integration

### 10.1 Trace Studio UI (`web-dashboard`)
1. **Interactive Hop Matrix:** A visual pipeline diagram with color-coded node pills:
   - 🟢 `Stigix-BR1 (100 pkts)` ➔ 🟢 `ION-BR1 (100 pkts)` ➔ 🔴 `ION-DC1 (97 pkts / 3 Drops)` ➔ 🟢 `Stigix-DC1 (97 pkts)`
2. **Instant Aller-Retour (Round-Trip) Toggle:** One-click mode to validate bidirectional symmetry (Forward: BR ➔ DC, Reverse: DC ➔ BR).
3. **Side-by-Side Packet Diff Viewer:** Click on any dropped packet to view its timestamp, sequence number, and the exact hop where it ceased to appear.
4. **One-Click Wireshark Export:** Download merged multi-interface `.pcapng` with pre-annotated interface labels.
5. **AI Copilot Drawer:** Interactive chat sidebar summarizing the diagnostic finding and offering auto-remediation actions.

---

## 11. Phased Implementation Roadmap

| Phase | Milestone | Deliverable |
|---|---|---|
| **Phase 1** | Standalone PoC Script | Python test utility (`Scripts/validate_pcap_trace.py`) executing dual-agent trigger, correlation, and drop analysis. *(Completed)* |
| **Phase 2** | Trace Orchestrator & Barrier Sync | Implement trace coordinator and node-level capture agents in `web-dashboard/server.ts`. |
| **Phase 3** | FastMCP Server Tools | Add `stigix_trace_*` tools to `mcp-server/src/server.py` and `ai-tools.ts`. |
| **Phase 4** | Trace Studio UI & Hop Matrix | Visual pipeline, packet diff table, and one-click Wireshark download in React dashboard. |
| **Phase 5** | AI Copilot Integration | Auto-summarize trace matrices with Gemini / Claude root-cause diagnostics. |
| **Phase 6** | ION Hardware Toolkit Gateway | Embedded SCP receiver + WebSocket runner for deep ION hardware packet extraction. |

---

## 📜 Revision History

| Date | Stigix Version | Author / Trigger | Summary of Changes |
|---|---|---|---|
| 2026-10-16 | `v3.0.33` | Stigix Core Team | Major PRD update: Added Quad-Hop Trace pipeline (`Stigix-BR` $\rightarrow$ `ION-BR` $\rightarrow$ `ION-DC` $\rightarrow$ `Stigix-DC`), Barrier Synchronization orchestrator, AI Copilot LLM root-cause diagnosis, FastMCP tool specifications, and CPU/memory resource optimization guardrails. |
| 2026-10-16 | `v3.0.33` | Stigix Core Team | Initial PRD creation documenting API discovery findings and multi-tier correlation. |
