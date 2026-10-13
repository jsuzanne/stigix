> **Last Updated:** 2026-10-13 | **Created:** 2026-10-13 (v3.0.3)

# PRD — SD-WAN Overlay Multicast Validation Engine

**Status:** Draft v3 (revised) | **Owner:** Stigix Core Team | **Target:** v3.1.x

**Reference platform:** Palo Alto Networks **Prisma SD-WAN** (first validated target). **Design principle:** the engine is *vendor-neutral* — it only speaks standard IGMP/UDP multicast from the edge of the LAN, so it works with any SD-WAN solution that transports multicast. Vendor-specific knowledge is limited to documentation (Appendix A) and optional pre-flight hints.

---

## 1. Executive Summary & Vision

### 1.1 The Challenge
Enterprise SD-WAN deployments increasingly transport IP multicast: financial market data, corporate video/IPTV/CCTV, and industrial/IoT telemetry or bulk imaging.

Validating multicast over an SD-WAN overlay is hard:
1. Multicast is UDP-only, with no handshake or ACK. Loss is silent for the application.
2. The overlay must either do **Head-End Replication (HER)** (multicast converted into N unicast tunnels) or run **PIM-SM / PIM-SSM** across the overlay. The two behave very differently on failover.
3. Engineers lack a lightweight tool to measure **join latency**, **loss/duplication per receiver**, and **convergence time on WAN failure**.

### 1.2 The Solution
Extend the existing **Custom Apps** subsystem (`web-dashboard/custom-tcp-apps/`) with a new **Multicast Stream** app type: a distributed 1-to-N UDP multicast sender plus receivers that join the group, track sequence numbers, and report telemetry to the dashboard.

### 1.3 Goals and Non-Goals

| Goals | Non-Goals (v1) |
|---|---|
| IPv4 ASM (`239/8`) and SSM (`232/8`) streams | IPv6 / MLD, MSDP, anycast RP |
| Per-receiver loss, duplicates, reordering, jitter, throughput, join latency | Configuring the SD-WAN fabric (PIM, IGMP proxy, RP) — the network is assumed pre-configured |
| Convergence-time measurement during underlay chaos | Real video/audio codecs or decoding; multicast encryption validation |
| DC-side source **and branch-side source (BSS)** streams | Multicast routing daemon inside Stigix (no PIM speaker) |
| Copilot/MCP/CLI parity | Line-rate stress (> 50 Mbps) |
| Run inside existing container (host networking) | Bridge-mode Docker support |

```mermaid
flowchart TD
    subgraph DC["Datacenter (DC1)"]
        Sender["Stigix Multicast Sender<br/>Group 239.255.1.100:5000<br/>CBR 5 Mbps, TTL 64"]
        Edge1["SD-WAN Edge DC1<br/>IGMP / PIM RP"]
    end
    subgraph Overlay["SD-WAN Overlay"]
        T1["Path 1 (Primary)"]
        T2["Path 2 (Backup)"]
    end
    subgraph Branches["Branches"]
        E2["Edge BR1"] --> R1["Receiver BR1"]
        E3["Edge BR2"] --> R2["Receiver BR2"]
        E4["Edge BR8"] --> R3["Receiver BR8"]
    end
    Sender --> Edge1
    Edge1 --> T1
    Edge1 -.-> T2
    T1 --> E2
    T1 --> E3
    T1 --> E4
```

---

## 2. Personas & Use Cases

| Persona | Goal | Value |
|---|---|---|
| **SD-WAN Architect** | Certify HER vs. native PIM behavior | Confirm every subscribed branch receives the stream with zero duplicates |
| **NOC Engineer** | Measure impact of a link cut | Exact lost-packet count and **stream interruption time** |
| **Trading / Financial Engineer** | Validate low-jitter feed replication | Sequence tracking, jitter and micro-burst loss |
| **Security Engineer** | Verify segmentation | Prove a non-member node (or other VRF) receives **nothing** (negative test) |

Core test scenarios:
- **S1 – Baseline:** DC source, all receivers joined, 5 Mbps for 10 min: loss < 0.1%, 0 duplicates, jitter < 5 ms, join latency reported per receiver.
- **S2 – Branch-side source (BSS):** a branch node is the sender; DC and other branches receive. Same criteria as S1 (Prisma ION 6.1.1+ required, see Appendix A).
- **S3 – Failover:** primary WAN link down during the stream; report max gap per receiver; stream must resume without manual action (default threshold < 10 s, configurable).
- **S4 – Late join:** a receiver joins an already active group; join latency reported, no impact on other receivers.
- **S5 – Leak test:** receiver on an unauthorized segment/VRF must see 0 packets (`EXPECT_NONE`; any valid packet = FAIL).
- **S6 – SSM:** `232/8` with `source_ip`; only the declared source is received, a second source is ignored.
- **S7 – HER detection (informational):** duplicates = 0 at the receiver; an underlay capture shows N unicast copies vs. one multicast flow.
- **S8 – Leave:** after stop, traffic stops reaching the branch (prune check).

---

## 3. Functional Specifications

### 3.1 Sender
1. **Addressing:** ASM `239.0.0.0/8` (administratively scoped) and SSM `232.0.0.0/8`. Reject other ranges in validation, and reject reserved `224.0.0.0/24` (link-local).
2. **Parameters:** UDP port (default `5000`), egress interface (resolved to an IP; `IP_MULTICAST_IF`), TTL (default `64`), DSCP (`BE`, `CS5`, `EF`, custom), payload size (default `1316` bytes = 7 TS packets; range 64–1400 to avoid fragmentation). Use larger datagrams above 10 Mbps.
   - **Pacing:** `time.perf_counter()` with catch-up logic; fallback to `sendmmsg` or a native helper if Python cannot hold the target rate within ±2%.
   - DSCP is applied with `IP_TOS = dscp << 2`.
3. **Rate modes:**
   - **CBR:** 64 kbps – 50 Mbps (v1 cap, see 4.3).
   - **Burst:** N packets every T ms (e.g., 50 pkts every 100 ms).
4. **`IP_MULTICAST_LOOP` = 0** so a co-located receiver does not see its own traffic and skew tests.
5. **Packet header** (network byte order, packed, 24 bytes — `struct.pack("!IQQHH", ...)`; a naturally-aligned C struct would be padded to 32 bytes, so the wire format is explicitly packed), followed by padding:

   | Offset | Size | Field | Notes |
   |---|---|---|---|
   | 0 | 4 | `magic` | `0x53544758` ("STGX") — non-matching packets are counted as `foreign` and ignored |
   | 4 | 8 | `sequence_id` | per-stream, starts at 0 on each run |
   | 12 | 8 | `timestamp_ns` | sender wall clock; used for **jitter only**, never one-way delay |
   | 20 | 2 | `stream_id` | app identifier |
   | 22 | 2 | `run_id` | increments on sender restart so receivers can detect a reset instead of reporting huge loss |

### 3.2 Receiver
1. **Membership:**
   - ASM: `IP_ADD_MEMBERSHIP`.
   - SSM: `IP_ADD_SOURCE_MEMBERSHIP` (Linux constant `39`) with the sender's source IP (new `source_ip` field; requires IGMPv3 in the network; the UI warns if the host is forced to IGMPv2).
   - The receiver socket **binds to the group IP and port** (not `0.0.0.0`) so unrelated multicast traffic on the same port is filtered by the kernel.
   - Leave via `IP_DROP_MEMBERSHIP` (or `IP_DROP_SOURCE_MEMBERSHIP`) on stop. Periodic report replies to IGMP queries are handled by the **Linux kernel**, not by the application. The engine only **reports** the effective IGMP version (`/proc/net/igmp`, `force_igmp_version`) and may optionally enforce it.
2. **Metrics (per 1-second window and cumulative):**
   - Loss (gaps in `sequence_id`), reordering, **duplicates**, `foreign` packets.
   - Throughput (kbps) and pps.
   - **Jitter** per RFC 3550 using sender timestamps (clock offset cancels out in inter-arrival differences).
   - **One-way delay (optional):** shown **only** when both nodes report a synchronized clock (NTP/PTP offset below a configurable threshold, default 5 ms); otherwise hidden.
   - **Time-to-first-packet:** time from `IP_ADD_MEMBERSHIP` call to first valid packet. Documented as an approximation (the kernel sends the IGMP report asynchronously); it is an end-to-end figure that includes IGMP + PIM propagation.
   - **Max interruption (gap) in ms:** longest inter-arrival gap — the primary failover/convergence metric.
3. **Expectation mode:** `EXPECT_TRAFFIC` (default) or `EXPECT_NONE` (leak test). The verdict is computed locally.
4. **Health verdict:**

   | State | Rule (configurable thresholds) |
   |---|---|
   | `HEALTHY` | loss ≤ 0.1%, 0 duplicates |
   | `DEGRADED` | loss 0.1–2% or duplicates > 0 |
   | `FAILED` | loss > 2% or no packet for > 3 s |
   | `NO_TRAFFIC` | expected for `EXPECT_NONE` (shown as pass) |

---

## 4. Technical Architecture

### 4.1 Where it fits in the codebase
The existing Custom Apps backend lives in `web-dashboard/custom-tcp-apps/` (`tcp-app-manager.ts`, `api-routes.ts`, `config-store.ts`, `history-store.ts`, `validation.ts`, `types.ts`). The frontend is `web-dashboard/src/CustomApps.tsx` and `web-dashboard/src/components/custom-tcp/CustomAppWizardModal.tsx`.

Proposed additions:
- `engines/multicast_engine.py` — daemon (single process per role, `--role sender|receiver`), emits JSON stats lines on stdout / local Unix socket. Follows the pattern of other Python engines in `engines/`.
- `web-dashboard/custom-tcp-apps/multicast-manager.ts` — spawns/stops the daemon and ingests stats.
- Extend `types.ts` with `kind: 'tcp' | 'multicast'` (default `'tcp'`, so existing configs remain valid), and extend `validation.ts`.
- Reuse the existing leader→peer config sync and peer API so receivers run on the other nodes.

### 4.2 Orchestration

```mermaid
sequenceDiagram
    autonumber
    actor User as Engineer / Copilot
    participant Leader as Stigix Leader
    participant Recv as Receiver nodes
    participant Send as Sender node
    participant Net as SD-WAN Overlay

    User->>Leader: Create + Start multicast app
    Leader->>Recv: Start receivers (join group)
    Recv->>Net: IGMP membership report
    Recv-->>Leader: ready (joined)
    Leader->>Send: Start stream (only once receivers are ready)
    Send->>Net: UDP multicast, seq=0,1,2...
    Net->>Recv: Replicated stream
    Recv-->>Leader: Telemetry every 1-5 s
    User->>Leader: Stop
    Leader->>Send: Stop
    Leader->>Recv: Leave group, final report
```

Start order is **receivers first**, so the baseline is measured without join transients (unless the *late join* scenario is chosen).

### 4.3 Implementation notes and constraints
- **Networking:** requires `network_mode: host` (already used in `docker-compose.yml`). In bridge mode, multicast does not cross the container boundary; the UI/CLI refuse to start and explain why.
- **Host prerequisites to surface in a pre-flight check:**
  - `rp_filter` may drop multicast on asymmetric paths.
  - Interface must have the `MULTICAST` flag.
  - Local firewall must allow UDP to the group/port.
  - Detect and show the effective IGMP version (`/proc/net/igmp`).
  - `rp_filter` loose (`2`) or disabled on the receiver interface when paths are asymmetric.
  - **RPF check (most common lab failure):** if the source subnet is not reachable by unicast through the incoming interface, PIM drops the stream. When a join succeeds but no packet arrives, the UI shows a diagnostic banner (RPF / `rp_filter` / host networking hints).
  - **Self-test:** local sender→receiver test on the same segment, to separate host problems from network problems.
- **Performance:** a Python sender is suitable up to ~50 Mbps with 1316-byte payloads (~4.7 kpps) using a paced loop. Above that, a Node/C sender is a v2 item. The CBR limit is therefore 50 Mbps in v1.
- **Time:** wall-clock timestamps are used for jitter. One-way delay is reported only when clock sync is verified (see 3.2).
- **Safety limits:** max 10 concurrent multicast apps per node, max 50 Mbps aggregate, mandatory TTL ≤ 64 by default, and a confirmation when TTL > 16 (leak risk).
- **Persistence:** apps in `config/custom-tcp-apps.json` (same store); run history in the existing history store with per-receiver summary.

### 4.4 Data model (excerpt)
```json
{
  "id": "mc-001",
  "kind": "multicast",
  "name": "Market Data Feed",
  "group": "239.255.1.100",
  "port": 5000,
  "ssm_source": null,
  "sender_node": "DC1",
  "receivers": [
    {"node": "BR1", "expect": "traffic"},
    {"node": "BR2", "expect": "traffic"},
    {"node": "BR5", "expect": "none"}
  ],
  "rate": {"mode": "cbr", "kbps": 5000},
  "payload_bytes": 1316,
  "ttl": 64,
  "dscp": "CS5",
  "duration_s": 0
}
```

### 4.5 API (under existing `/api/custom-tcp`)

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/custom-tcp/multicast` | Create multicast app |
| `POST` | `/api/custom-tcp/multicast/:id/start` · `/stop` | Orchestrated start/stop |
| `GET` | `/api/custom-tcp/multicast/:id/stats` | Per-receiver live stats |
| `POST` | `/api/custom-tcp/multicast/:id/preflight` | Host/interface checks on all nodes |

---

## 5. UI/UX Specification

### 5.1 Wizard extension
`CustomAppWizardModal.tsx` gets a type step: `[ TCP | ⚡ Multicast Stream ]`. For multicast:
- Group IP (validated, with ASM/SSM badge), port, sender node, receiver multi-select (each with *Expect traffic / Expect none*), rate mode + value, payload size, DSCP, TTL (advanced), duration.
- Pre-flight button; result list per node (✅/⚠️/❌ with remediation text).

### 5.2 Live monitoring drawer
- Source: bitrate, packets sent, uptime.
- Receivers table:

  | Receiver | IGMP | Rx Mbps | Loss % | Dups | Jitter ms | Max gap ms | Join ms | Verdict |
  |---|---|---|---|---|---|---|---|---|
  | BR1 | v3 | 4.98 | 0.00 | 0 | 1.1 | 20 | 42 | 🟢 |
  | BR5 | v3 | 0.00 | — | 0 | — | — | — | 🟢 (expected none) |

- Timeline chart of per-receiver throughput with failover events overlaid (links to VyOS chaos actions).

---

## 6. Copilot, MCP & CLI Integration

Per the `stigix-mcp-sync` convention, every tool is mirrored in the CLI and the MCP manifest.

| Tool | Parameters | Description |
|---|---|---|
| `create_multicast_app` | `name, group, port, sender_node, receivers[], bitrate_kbps, ttl, dscp` | Create a stream |
| `start_multicast_app` / `stop_multicast_app` | `app_id` | Orchestrated start/stop |
| `get_multicast_stats` | `app_id` | Per-receiver loss, jitter, gap, verdict |
| `run_multicast_failover_test` | `app_id, vyos_action` | Runs a stream, injects the chaos action, returns max interruption per receiver |
| `run_multicast_scenario` | `scenario_id (S1–S8), app_id` | Runs a predefined scenario and returns pass/fail per receiver |

**Chaos fallback:** if the lab VyOS cannot route multicast, trigger the failover on the SD-WAN edge (link disable) or on the underlay switch instead.

RBAC mapping (see `PRD_ENTERPRISE_RBAC.md`): new capabilities `multicast:read` and `multicast:execute` (included in the *Test Operator* preset, `read` only in *Demo / Read-Only*).

---

## 7. Success Metrics & Acceptance Criteria

- Sender holds configured CBR within ±3% at 5, 20 and 50 Mbps.
- Loss detection accuracy: injected 1% `tc netem` loss reported within ±0.2%.
- Duplicates correctly flagged when a HER setup double-delivers.
- Failover test returns max interruption within ±100 ms of an external packet capture.
- Leak test (`EXPECT_NONE`) reports a failure when any valid packet is received.
- Existing TCP custom apps and their JSON configs are unaffected (regression suite `test-custom-tcp-*` passes).

## 8. Risks & Open Questions

| Risk / Question | Mitigation |
|---|---|
| Fabric is not multicast-enabled → apparent "failure" | Pre-flight + clear `NO_TRAFFIC` diagnostics, document network prerequisites |
| Multicast leakage onto the Internet | Default TTL 64 restricted to 239/8, explicit warning for high TTL |
| Python pacing jitter at high rates | 50 Mbps cap in v1; native sender in v2 |
| Which vendors on the fabric? | **Decided:** Prisma SD-WAN first; engine stays vendor-neutral (standard IGMP/UDP). Per-vendor notes in Appendix A |
| Receivers on non-Stigix hosts? | **Decided:** out of scope — receivers are Stigix nodes only (v1) |
| Prisma multicast feature/version prerequisites (ION software, WAN multicast profile) may differ per release | Validate against the current Prisma SD-WAN documentation and lab before GA; keep the appendix versioned |
| Docker `Dockerfile` sync | Run the `stigix-docker-audit` checklist for the new `engines/` and `custom-tcp-apps/` files |

## 9. Phased Roadmap (effort-based)

| Phase | Scope | Est. effort |
|---|---|---|
| **1 – Engine** | `multicast_engine.py` (sender/receiver, header, metrics), CLI standalone test | 2–3 days |
| **2 – Platform** | `multicast-manager.ts`, validation, routes, orchestration order, history | 2–3 days |
| **3 – UI** | Wizard mode, pre-flight, drawer and chart | 2–3 days |
| **4 – Automation** | Copilot/MCP/CLI tools, failover test, docs, FAQ, RBAC capabilities | 2 days |

Total ≈ 8–11 days for full scope; an MVP (phases 1–2 plus a minimal UI) is achievable in ~4–5 days.

---

## Appendix A — Vendor Notes (v1: Prisma SD-WAN)

> [!NOTE]
> Vendor behavior below must be validated against the Prisma SD-WAN release in use before GA. Stigix never configures the fabric; this appendix documents what the operator must have in place.

### A.1 Generic requirements (any SD-WAN)
| Layer | Requirement |
|---|---|
| Receiver LAN | Edge router runs **IGMPv2 or v3** (v3 mandatory for SSM) on the LAN interface facing the Stigix node |
| Source LAN | Edge router accepts multicast from the sender subnet (PIM/RPF on the source-facing interface) |
| Overlay | Either native multicast routing (PIM) or head-end replication, as supported by the vendor |
| Rendezvous | A reachable RP (ASM), consistent on all participating routers |
| Policy | Multicast not blocked by the vendor's security/path policy; DSCP/QoS class mapped if tested |

### A.2 Prisma SD-WAN (reference target)
Prisma SD-WAN supports multicast with **IGMP (v2/v3) on the LAN** and **PIM-SM across the fabric**, with a configured Rendezvous Point.

> [!WARNING]
> The version/feature details below come from a third-party technical review of Prisma SD-WAN TechDocs ("Multicast Routing"). They must be verified against the official documentation and the lab ION release before being relied upon.

| Item | Detail |
|---|---|
| Versions | LAN multicast from 5.6.1; LAN + WAN from 6.0.1; **Branch Side Source (BSS)** from 6.1.1 |
| Branch site | LAN senders and receivers; receives multicast from the WAN |
| Datacenter | Sends to branches over the VPN; **no LAN receivers on the DC** (so DC Stigix nodes act as senders only) |
| Branch ION settings | *L3 Direct Private WAN Forwarding* and *L3 LAN Forwarding* enabled; LAN interface: Multicast = Yes + IGMP version |
| DC ION interface | Type Port, *Peer with a Network*, Multicast = Yes |
| RP | Static RP (same address on all multicast routers) or dynamically learned |
| WAN | Multicast WAN configuration profile attached to the branch site; multicast enabled on the DC ION |
| BSS | Enable *Receive traffic from branch side sources* in the WAN multicast profile; define source + group on the sending site |
| Test helper | IGMP **Static Joins** on the branch interface, to separate IGMP failures from transport failures |

Stigix placement: the DC Stigix sender must sit on the segment peered with the ION (*Peer with a Network*), otherwise no PIM adjacency is formed.

Typical operator checklist:
1. Enable multicast on the Layer 3 LAN interfaces (receiver branches) and on the DC interface facing the source.
2. Create a **WAN multicast profile** and associate it with the participating sites.
3. Configure the multicast global parameters, then a **Static RP** (same RP address on every participating node), or dynamic RP learning if the design requires it.
4. Verify on the ION with the multicast diagnostics (`dump routing multicast status | pim | igmp | mroute`).

Stigix hints (optional, vendor-neutral output):
- If a receiver reports `FAILED` / no packets while the pre-flight is green, the diagnostic suggests checking: IGMP membership visible on the edge, PIM neighbor/RP reachability, and the `mroute` entry for the group.
- Failover scenario (S3) on Prisma: use the existing underlay chaos actions on the WAN circuit and observe **max gap** per branch; compare native PIM vs. any HER-style behavior observed (duplicates indicate double delivery).

### A.3 Future vendors
Any solution transporting multicast (e.g., other SD-WAN or router-based overlays such as VyOS) is expected to work unchanged. Adding a vendor requires only an appendix entry and, optionally, extra pre-flight hint text — **no engine change**.

---

## 📜 Revision History


| Date | Stigix Version | Author / Trigger | Summary of Changes |
|---|---|---|---|
| 2026-10-13 | `v3.0.3` | Stigix Core Team | Initial PRD creation for SD-WAN Overlay Multicast Validation Engine |
| 2026-10-13 | `v3.0.3` | Stigix Core Team | Revision: aligned with real code layout (`custom-tcp-apps/`), fixed SSM and IGMP handling, added `run_id`, leak/failover scenarios, pre-flight, data model, API, RBAC mapping, acceptance criteria, risks, realistic estimates |
| 2026-10-13 | `v3.0.3` | Stigix Core Team | Vendor-neutral design with Prisma SD-WAN as reference target (Appendix A); receivers limited to Stigix nodes |
| 2026-10-13 | `v3.0.3` | Perplexity technical review | Merged: BSS scope and scenario, SSM bind/constant, pacing, reordering, optional one-way delay, RPF/self-test diagnostics, scenarios S6–S8, `run_multicast_scenario`, VyOS chaos fallback, Prisma version/settings table (flagged for verification) |
