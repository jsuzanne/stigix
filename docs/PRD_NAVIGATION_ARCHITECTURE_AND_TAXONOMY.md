> **Last Updated:** 2026-10-11 | **Created:** 2026-10-11 (v2.2.9)

# Product Requirement Document (PRD): Stigix Navigation Architecture & Functional Taxonomy

## 1. Executive Summary & Problem Statement

### 1.1 Context & The "Horizontal Sprawl" Problem
Over the evolution from Stigix v1 to v2.2.x, the platform expanded from a simple SaaS traffic generator into an end-to-end SD-WAN and SASE validation engine. It currently hosts **15 top-level modules**:

| Module Name | Primary Objective |
|---|---|
| **Traffic Generator** | Multi-app SaaS background traffic generator |
| **Digital Experience (DEM)** | Synthetic path probes and SLA telemetry |
| **Bandwidth Test (XFR / iPerf)** | Throughput, latency, and packet loss validation |
| **Security Validation** | SASE / NGFW inspection (URL, DNS, EICAR, Threats) |
| **IoT Emulation** | Real-on-wire IoT device and vulnerability simulation |
| **Voice Simulation** | RTP VoIP MOS, jitter, and codec degradation testing |
| **Custom TCP/HTTP Apps** | Enterprise custom application emulator |
| **PCAP Replay** | Stateful L7 PCAP replay engine |
| **Packet Capture** | BPF sniffer & Wireshark-grade 3-pane web inspector |
| **Failover Monitoring** | Sub-second blackout and convergence monitoring |
| **Topology** | Underlay, SD-WAN overlay, and SASE tunnel visualization |
| **VyOS Control** | WAN impairment injection & router orchestrator |
| **Live Events** | Real-time event streaming and logging |
| **AI Copilot** | Conversational troubleshooting and orchestration |
| **Settings** | Targets, controller, provisioning, and fleet maintenance |

### 1.2 The User Experience Pain Point
On standard widescreen displays (1366x768, 1440x900, and 1080p laptop displays), these 15 buttons **wrap into 2 or even 3 horizontal lines** (as seen in production screenshots). This creates several severe usability issues:
1. **Vertical Screen Real-Estate Waste**: Taking up 120px–160px purely for navigation pushes critical content (Wireshark packet lists, Topology canvases, and Flow graphs) below the fold.
2. **Cognitive Overload**: A flat list of 15 unstructured buttons violates Hick's Law, forcing engineers to visually scan the entire header to locate a specific tool.
3. **No Room for Roadmap Features**: Planned additions (Use Case Scenarios, Automated Test Suites, Flow Browser queries) cannot be accommodated without breaking the layout further.

---

## 2. Structural Options Analysis

We evaluate the two competing architectural paradigms:

---

### Architecture Option A: Vertical Collapsible Sidebar (Left Rail)
*Examples in industry: Grafana, AWS Management Console, Datadog, Portainer, Proxmox.*

```text
┌──────┬─────────────────────────────────────────────────────────────┐
│ Logo │ Header Bar (Instance, Health Badge, Cluster Status, User)   │
├──────┼─────────────────────────────────────────────────────────────┤
│ [📁] │                                                             │
│Traffic│ Content Area (Full Vertical Height)                         │
│ [🛡️] │                                                             │
│Security│ • High vertical resolution (vital for PCAP 3-pane & graphs) │
│ [🌐] │                                                             │
│ Infra │ • Unaffected by top header scrolling                        │
│ [⚙️] │                                                             │
│Settings│                                                             │
│ [«]  │                                                             │
└──────┴─────────────────────────────────────────────────────────────┘
```

#### Advantages
* **Infinite Vertical Scalability**: Can accommodate 30+ items with natural vertical scrolling.
* **Preserves Vertical Height**: Screens are 16:9 or 16:10 (wide, not tall). Vertical screen space is the rarest and most critical asset for data tables, hex packet views, and live graphs.
* **Collapsible to Mini-Rail (60px)**: When collapsed, displays crisp Lucide icons with instant hover tooltips, freeing up 96% of the screen width for Topology and Wireshark inspection.
* **Industry Standard for Ops Tools**: Enterprise DevOps and NOC engineers are intimately familiar with left-hand vertical sidebars.

#### Disadvantages
* **Consumes Horizontal Space (240px when expanded)**: May compress high-density data tables or wide topology canvases unless auto-collapsed.
* **Visual Disruption**: Shifts the existing mental model of Stigix from a top-down dashboard to a sidebar portal.

---

### Architecture Option B: Hierarchical Domain Ribbons (Categorized Top Header + Sub-Tabs)
*Examples in industry: Palo Alto Strata Cloud Manager, Microsoft Azure Portal, Fortinet FortiOS, Cisco Catalyst SD-WAN.*

```text
┌─────────────────────────────────────────────────────────────────────────┐
│ [Logo] Stigix  |  [ Traffic & Apps ]  [ Testing & SLA ]  [ Observe ]  [ Infra ]  [ Admin ] │
├─────────────────────────────────────────────────────────────────────────┤
│ Sub-Ribbon:  [ SaaS Gen ]  [ Custom Apps ]  [ VoIP Voice ]  [ IoT Devices ]  [ PCAP Replay ] │
├─────────────────────────────────────────────────────────────────────────┤
│ Content Area                                                            │
│ (Leverages 100% of horizontal viewport width)                           │
└─────────────────────────────────────────────────────────────────────────┘
```

#### Advantages
* **100% Horizontal Viewport Preservation**: Crucial for the **Topology Canvas** (D3 forced-directed graph) and the **Packet Capture** 3-pane inspector (Summary list + Packet Details tree + Raw Hex Dump).
* **Zero Cognitive Fatigue**: Consolidates 15 confusing items into **5 clear functional domains** on a single, clean 1-line top ribbon.
* **Consistency with Existing Proven Patterns**: Stigix already uses sub-tabs with high user satisfaction in:
  * `Settings` (Traffic Distribution, Synthetic Probes, Custom Apps, Target Controller, SASE API...)
  * `VyOS Control` (Impairments, Interfaces, Static Routes, Firewall, Configuration...)
* **Zero Breaking Change**: Feels like a natural refinement of the existing interface rather than a jarring layout redesign.

#### Disadvantages
* **Requires 2 Clicks (or Hover)** to navigate between sub-modules of different domains (e.g. from VoIP to Packet Capture).
* **Vertical Height Usage**: Still consumes two horizontal bars (~90px total), although significantly cleaner than 2 wrapped rows of cluttered buttons.

---

## 3. Comparison Matrix

| Evaluation Criteria | Option A: Vertical Sidebar | Option B: Domain Ribbons (Hierarchical) | Hybrid: Collapsible Rail + Header |
|---|---|---|---|
| **Max Screen Width for Canvas / Tables** | ⚠️ Moderate (minus 240px unless collapsed) | 🟢 **100% Full Width** | 🟢 **96% Full Width** (60px rail) |
| **Max Screen Height for Logs / Wireshark** | 🟢 **Optimal** | ⚠️ Uses ~90px top | 🟢 **Optimal** |
| **Scalability for New Features** | 🟢 Very High | 🟢 High (within categories) | 🟢 Very High |
| **Cognitive Simplicity (Hick's Law)** | ⚠️ Requires expanding categories | 🟢 **Extremely Clear (5 Domains)** | 🟢 High |
| **Familiarity with Current Stigix UX** | 🔴 Low (total redesign) | 🟢 **High (matches Settings & VyOS)** | 🟡 Medium |
| **Implementation Complexity** | 🟡 Medium (~2 days) | 🟢 **Low (~1 day)** | 🔴 Higher (~3 days) |

---

## 4. Proposed Functional Taxonomy (Categorization)

Whether implemented via Domain Ribbons or a Vertical Sidebar, the **15 modules must be grouped into 5 coherent functional pillars**:

```text
┌──────────────────────────────────────────────────────────────────────────┐
│ STIGIX FUNCTIONAL DOMAINS                                                │
├──────────────────────────────────────────────────────────────────────────┤
│ 1. 🚀 TRAFFIC GENERATION & EMULATION                                     │
│    ├── SaaS Traffic Generator   (Multi-app background load & APM)        │
│    ├── Custom TCP / HTTP Apps   (Enterprise private apps & impairments)  │
│    ├── VoIP Simulation          (RTP G.711/G.729 call load & MOS score)  │
│    ├── IoT Device Emulation     (Physical device real-on-wire profiles)  │
│    └── PCAP Replay              (Stateful L7 replay & verdict audit)     │
├──────────────────────────────────────────────────────────────────────────┤
│ 2. 🧪 TESTING & SLA VALIDATION                                           │
│    ├── Security Validation      (URL, DNS, EICAR, C2 malware tests)      │
│    ├── Bandwidth Speedtest      (XFR & iPerf3 line-rate validation)      │
│    ├── Digital Experience (DEM) (Synthetic path probes & SLA latency)   │
│    └── Failover Monitoring      (Millisecond blackout & path switch)     │
├──────────────────────────────────────────────────────────────────────────┤
│ 3. 🔍 OBSERVABILITY & ANALYSIS                                           │
│    ├── Packet Capture           (Live BPF sniffer & 3-pane web inspector)│
│    ├── Live Events              (WebSocket telemetry streaming)          │
│    └── Flow Browser             (Prisma SD-WAN flow session queries)     │
├──────────────────────────────────────────────────────────────────────────┤
│ 4. 🌐 NETWORK INFRASTRUCTURE                                             │
│    ├── Topology Map             (Underlay, SD-WAN mesh & SASE circuits)  │
│    └── VyOS Router Control      (WAN impairment injection & routing)     │
├──────────────────────────────────────────────────────────────────────────┤
│ 5. ⚙️ PLATFORM & ORCHESTRATION                                           │
│    ├── Settings & Fleet         (Targets, Target Controller, Upgrades)   │
│    └── AI Copilot               (Interactive LLM Assistant / FastMCP)    │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## 5. Strategic Recommendation

### 🏆 Recommended Solution: The "Domain Ribbon" Model (Option B) with Sub-Tabs

**Why this is the superior choice for Stigix:**
1. **The Topology & Packet Capture Imperative**: Stigix has two hallmark killer features:
   - The interactive **D3 Topology Canvas** (requiring full horizontal span to display Hubs, Branch Gateways, and Spoke rings without crowding).
   - The **Wireshark-Grade Packet Capture Inspector** (requiring a wide layout to accommodate the Packet List, the Protocol Tree, and the Hex Dump side-by-side).
   *A static left sidebar permanently robs these tools of crucial horizontal space.*
2. **Proven Ergonomic Success**: Users are already enthusiastic about the structured sub-menu pill bars inside **VyOS Control** and **Settings**. Extending this mental model across the whole application creates immediate visual harmony.
3. **Clean Single-Row Header**: By reducing 15 top buttons into **5 Domain Tabs**, the primary header fits comfortably on even a 1280px display with **zero wrapping**.
4. **Contextual Sub-Ribbon**: The secondary sub-ribbon displays only the 2 to 5 relevant tools for the selected domain, keeping the operator focused on their active task.

---

## 6. Implementation Specifications

### 6.1 Top Ribbon Design Tokens
* **Height**: 48px fixed.
* **Style**: Sleek glassmorphism (`bg-card/80 backdrop-blur-md border-b border-border`).
* **Pill Style**:
  * Inactive: `text-text-muted hover:text-text-primary hover:bg-card-hover font-semibold text-xs tracking-wider uppercase`
  * Active: `bg-blue-600 text-white shadow-[0_0_15px_rgba(37,99,235,0.3)] font-black text-xs tracking-wider uppercase`

### 6.2 Sub-Ribbon Design Tokens
* **Height**: 40px fixed.
* **Style**: Subtle muted strip (`bg-muted/30 border-b border-border/50 px-6 flex items-center gap-2`).
* **Items**: Underline or pill indicator matching the existing sub-menu style in `VyOS` and `Settings`.

### 6.3 State Management & URL Deep-Linking
* URL query parameter support: `?domain=traffic&sub=pcap_replay` to allow direct bookmarks and shareable links for specific test workflows.
* Retain state when switching between domains so active tests are not accidentally interrupted.

---

## 7. Migration & Rollout Plan

1. **Phase 1 (Taxonomy Engine)**: Create `domainNavigationConfig.ts` defining the 5 domains, their icons, and member views.
2. **Phase 2 (Header Refactoring)**: Replace the 15-button wrap in `App.tsx` with the 5-domain primary bar and the dynamic sub-ribbon.
3. **Phase 3 (User Preference Toggle - Optional)**: Provide an option in *Settings ➔ Preferences* allowing operators who prefer a vertical sidebar to toggle a "Compact Left Icon Rail".

---

## 📜 Revision History

| Date | Stigix Version | Author / Trigger | Summary of Changes |
|---|---|---|---|
| 2026-10-11 | `v2.2.9` | Stigix Architecture Team | Initial PRD: Navigation architecture study, comparison of Horizontal Domain Ribbons vs Vertical Sidebar, and definition of the 5-pillar functional taxonomy. |
