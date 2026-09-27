> **Last Updated:** 2026-09-27 | **Created:** 2026-09-27 (v2.0.66)

# Stigix Terminology Consolidation Guide

> [!NOTE]
> This document is a **reference proposal** for consolidating Stigix UI terminology.
> It does NOT change any functionality — only UI labels, tooltips, and documentation wording.
> Review at your own pace, then decide which level of consolidation to apply.

## Table of Contents

1. [Core Semantic Model](#1-core-semantic-model)
2. [Current Terminology Map](#2-current-terminology-map)
3. [Identified Issues](#3-identified-issues)
4. [Proposed Consolidation — 3 Levels](#4-proposed-consolidation--3-levels)
5. [Detailed Change Matrix](#5-detailed-change-matrix)
6. [Unified Glossary](#6-unified-glossary)
7. [Implementation Checklist](#7-implementation-checklist)

---

## 1. Core Semantic Model

> [!IMPORTANT]
> **A Stigix Target is NOT a generic IP address.** A Target is a Stigix peer node that runs
> responder services (Voice echo, Convergence echo, Speedtest/XFR, Security/EICAR, Custom TCP server).
> It MUST be a Stigix node.

This is defined in [`targets.ts`](../web-dashboard/src/types/targets.ts):

```typescript
/**
 * A Target is a site running sdwan-voice-echo / stigix that exposes
 * multiple services on well-known ports.
 */
```

The Stigix architecture is therefore a **Target-centric model**:

```
                      ┌──────────────────────┐
                      │       LEADER         │
                      │  (Target Controller) │
                      │  Discovers, manages  │
                      │  and provisions all  │
                      │  targets in the mesh │
                      └──────────┬───────────┘
                                 │ registers / syncs
              ┌──────────────────┼──────────────────┐
              ▼                  ▼                   ▼
     ┌─────────────┐    ┌─────────────┐     ┌─────────────┐
     │   TARGET     │    │   TARGET     │     │   TARGET     │
     │  (BR1-Peer)  │    │  (BR2-Peer)  │     │  (DC1-Peer)  │
     │             │    │             │     │             │
     │ ☎ Voice 6100│    │ ☎ Voice 6100│     │ ☎ Voice 6100│
     │ ⚡ Conv 6200│    │ ⚡ Conv 6200│     │ ⚡ Conv 6200│
     │ 📡 XFR 5201 │    │ 📡 XFR 5201 │     │ 📡 XFR 5201 │
     │ 🛡 EICAR 8082│   │ 🛡 EICAR 8082│    │ 🛡 EICAR 8082│
     │ 🔌 TCP Apps │    │ 🔌 TCP Apps │     │ 🔌 TCP Apps │
     └─────────────┘    └─────────────┘     └─────────────┘
```

**Key insight**: "Target" and "Peer" are not separate concepts — they are two facets of the same entity. A peer IS a target. The Leader discovers peers and exposes them as targets to the rest of the mesh.

---

## 2. Current Terminology Map

### 2.1 Target Controller Tab (Settings)

This screen manages the **mesh topology and provisioning**.

| Current UI Term | Location | Actual Meaning |
|:---|:---|:---|
| **Target Controller** | Settings tab label (`Settings.tsx:1826`) | The clustering/mesh screen — discovers and manages targets |
| **Mesh Role Mode** | Selector (`Settings.tsx:4105`) | Auto-Detect / Leader / Peer role switcher |
| **Connected Peers** | Table heading (`Settings.tsx:4345`) | List of Stigix targets registered with the leader |
| **Instance** | Column header (`Settings.tsx:4376`) | Name of a Stigix node (e.g. BR1-Ubuntu) |
| **Central Global Provisioning** | Card (`Settings.tsx:4165`) | Config push system from leader to all targets |
| **Master Publisher** | Toggle button (`Settings.tsx:4179`) | Enables/disables centralized config distribution |

### 2.2 Stigix Targets Tab (Settings)

This screen manages the **list of known peer nodes and their services**.

| Current UI Term | Location | Actual Meaning |
|:---|:---|:---|
| **Stigix Targets** | Settings tab label (`Settings.tsx:1825`) | The target node directory screen |
| **Stigix Targets Repository** | Title (`Settings.tsx:4733`) | Registry of all known Stigix peer nodes |
| **Discovered & Remote Target Endpoints** | Section header (`Settings.tsx:5058`) | Targets learned from the leader or added manually |
| **Target Controller Leader** | Description text (`Settings.tsx:4979, 5061`) | Cross-reference to the leader node |
| **Local Appliance Target & Security Service** | Section (`Settings.tsx:4927`) | Local node identity + EICAR responder service |

### 2.3 Header & Navigation

| Current UI Term | Location | Actual Meaning |
|:---|:---|:---|
| **Registry Leader** | Header badge (`App.tsx:803`) | Role badge when this node is the leader |
| **Peer Node** | Header badge (`App.tsx:803`) | Role badge when this node is a target/peer |
| **Fleet** | Main nav tab (`App.tsx:1124`) | Multi-target observability (leader only) |
| **Fleet Control Plane** | Page title (`Fleet.tsx:247`) | Same view, full title |

### 2.4 Module-Specific Terms

| Current UI Term | Location | Actual Meaning |
|:---|:---|:---|
| **Stigix Voice Targets** | Voice module (`Voice.tsx:791`) | Targets with voice responder enabled |
| **Stigix Targets** | Failover module (`Failover.tsx:624`) | Targets available for convergence testing |
| **Target Peer** | Custom TCP Apps (`CustomApps.tsx:1296`) | A Stigix peer targeted for TCP traffic |
| **Endpoint** | Voice, Security, Failover (various) | Overloaded: IP:port columns, EICAR URLs, convergence IPs |
| **Appliance** | Custom Apps (`CustomApps.tsx:596`), Settings | Synonym for "this local Stigix node" |

---

## 3. Identified Issues

With the understanding that **Target = Stigix peer node with responder services**, the terminology issues are more specific than initially assessed.

### 3.1 ✅ "Target Controller" — Actually Correct

**Previous assessment**: collision with "Stigix Targets" tab → rename to "Mesh Controller".

**Revised assessment**: The "Target Controller" literally controls targets (discovers peers, manages registration, provisions config to them). The name is **semantically accurate**. The proximity with "Stigix Targets" is not a collision — it is a coherent naming family:

- **Target Controller** = the system that manages targets
- **Stigix Targets** = the list of known targets

The user understands that one is the control plane, the other is the data plane.

### 3.2 ✅ "Target Peer" in Custom Apps — Actually Correct

**Previous assessment**: rename to "Remote Host" to avoid collision with cluster "Peer".

**Revised assessment**: A "Target Peer" IS a Stigix peer that is targeted. The term is precise and correct. Custom TCP Apps specifically target Stigix peer nodes running TCP server responders.

### 3.3 ⚠️ "Registry Leader" Badge — Leaks Implementation Detail

The header badge says **"Registry Leader"** but the settings tab is called **"Target Controller"**. Two different names for the same role:

```
Header badge:     "Registry Leader"    ← uses "Registry" (internal mechanism)
Settings tab:     "Target Controller"  ← uses "Target Controller" (user-facing concept)
Description text: "Target Controller Leader"  ← a third variant
```

**Recommendation**: Standardize on one term. The badge should align with the Settings tab vocabulary.

### 3.4 ⚠️ "Connected Peers" vs "Stigix Targets" — Same Data, Different Names

The "Connected Peers" table in the Target Controller tab shows the exact same nodes as the "Stigix Targets" tab. But they use different column names:

| Target Controller ("Connected Peers") | Stigix Targets |
|:---|:---|
| Column: **Instance** | Label: **Target name** |
| Shows: IP, Capabilities, Last Seen | Shows: IP, Capabilities, Reachability |

These are the same entities viewed from two different angles. The terminology should be consistent.

### 3.5 ⚠️ "Instance" vs "Node" vs "Appliance" — Three Words for One Thing

| Term | Where Used |
|:---|:---|
| **Instance** | Connected Peers table column, empty-state text |
| **Node** | Descriptions ("this node", "spoke nodes"), Local Node badge |
| **Appliance** | Custom Apps ("Appliance Start Options"), Targets tab ("Local Appliance Target") |

Three synonyms for the same concept: a Stigix machine.

### 3.6 ⚠️ "Endpoint" — Overloaded Across Modules

"Endpoint" is used for:
- IP:port columns in Voice streams
- EICAR URLs in Security (external URLs that are NOT Stigix nodes)
- Convergence probe addresses in Failover
- "Discovered & Remote Target **Endpoints**" in the Targets tab

In the Security module specifically, `eicar_endpoints` includes external URLs like `https://secure.eicar.org/eicar.com.txt` which are **not Stigix nodes**. This is the one place where the test destination is genuinely not a Stigix Target.

### 3.7 ⚠️ "Central Global Provisioning" / "Master Publisher" — Verbose & Inconsistent

These terms don't use the established "Fleet" vocabulary from the main navigation:

```
Main nav:          "Fleet"              ← established term
Provisioning card: "Central Global Provisioning"  ← different name
Toggle button:     "Master Publisher"   ← yet another name
```

---

## 4. Proposed Consolidation — 3 Levels

### Level A — Surgical (4 changes, minimal disruption)

Focus only on the **badge/label inconsistency** and the **machine synonym** problem.

| Current | Proposed | Rationale |
|:---|:---|:---|
| Badge: **Registry Leader** | **Leader** | Align with the role selector in Target Controller. "Registry" is an internal detail. |
| Badge: **Peer Node** | **Peer** | Same simplification. |
| Column: **Instance** (Connected Peers) | **Target** or **Node** | Align with the Stigix Targets tab vocabulary. |
| **Appliance Start/Stop Options** | **Node Start/Stop Options** | Pick one synonym and stick with it. |

> **Estimated scope**: ~8 UI strings. Zero new concepts.

### Level B — Harmonized (Level A + vocabulary alignment)

Level A plus internal section clarification for a consistent "Target-first" vocabulary.

| Current | Proposed | Rationale |
|:---|:---|:---|
| *All of Level A* | — | — |
| **Mesh Role Mode** | **Node Role** | Simpler. "Mesh" is implicit. The selector is about the role of THIS node. |
| **Connected Peers** | **Registered Targets** | These peers ARE the targets. Using "Targets" connects this table to the Stigix Targets tab. |
| **Central Global Provisioning** | **Fleet Provisioning** | Align with the established "Fleet" term from main nav. |
| **Master Publisher** | **Fleet Publisher** | Same alignment. |
| **Local Appliance Target & Security Service** | **Local Node & Services** | Shorter, clearer. This section manages the local node identity + EICAR service. |
| **Discovered & Remote Target Endpoints** | **Discovered & Static Targets** | Remove redundant "Endpoint". "Static" is already used as the badge label for manual targets. |
| Description: **Target Controller Leader** | **Leader** | Redundant — just say "Leader" when the context is already the Target Controller. |

> **Estimated scope**: ~25 UI strings. Makes the Target-centric model visible everywhere.

### Level C — Full Polish

Everything from Level B, plus strict glossary enforcement across all modules.

| Current | Proposed | Rationale |
|:---|:---|:---|
| *All of Level B* | — | — |
| **Stigix Targets Repository** | **Target Registry** | "Repository" has code/Git connotations. "Registry" matches the internal concept. |
| **Endpoint** (in Security for external URLs) | **External URL** | Reserve "Endpoint" for internal use. External non-Stigix URLs should be called what they are. |
| **Stigix Voice Targets** | **Voice Targets** | Drop the "Stigix" prefix — it's obvious in context. |
| **Stigix Targets** (Failover section) | **Targets** | Same — drop redundant prefix. |
| All remaining **Appliance** references | **Node** | Complete the synonym unification. |
| **Fleet Control Plane** | **Fleet Overview** | "Control Plane" is Kubernetes jargon. "Overview" is what the page actually is. |

> **Estimated scope**: ~40 UI strings. Full consistency.

---

## 5. Detailed Change Matrix

Below is the complete mapping for **Level B** (the recommended level):

### 5.1 `App.tsx` Changes

| Line | Current String | New String |
|:---|:---|:---|
| ~803 | `'Registry Leader'` | `'Leader'` |
| ~803 | `'Peer Node'` | `'Peer'` |

### 5.2 `Settings.tsx` — Target Controller Tab

| Line | Current String | New String |
|:---|:---|:---|
| ~4105 | `Mesh Role Mode` | `Node Role` |
| ~4107 | `Forced Leader` / `Forced Peer` | *(keep as-is)* |
| ~4114 | `master configuration publisher` | `fleet configuration publisher` |
| ~4157 | `Central Global Provisioning` (comment) | `Fleet Provisioning` |
| ~4165 | `Central Global Provisioning` (heading) | `Fleet Provisioning` |
| ~4166 | `Publish shared configuration bundles once to all connected remote branch peers` | `Publish shared configuration bundles to all registered targets` |
| ~4179 | `Master Publisher Active/Disabled` | `Fleet Publisher Active/Disabled` |
| ~4345 | `Connected Peers` | `Registered Targets` |
| ~4346 | `Instances that have registered with this leader` | `Targets registered with this leader` |
| ~4369 | `No peers registered yet` | `No targets registered yet` |
| ~4370 | `Use the onboard command below to add a remote instance` | `Use the onboard command below to add a remote target` |
| ~4376 | Column: `Instance` | `Target` |
| ~4571 | `Central Global Provisioning` (peer view) | `Fleet Provisioning` |

### 5.3 `Settings.tsx` — Stigix Targets Tab

| Line | Current String | New String |
|:---|:---|:---|
| ~4927 | `Local Appliance Target & Security Service` | `Local Node & Services` |
| ~4979 | `across the mesh and Target Controller Leader` | `across the mesh and Leader` |
| ~5058 | `Discovered & Remote Target Endpoints` | `Discovered & Static Targets` |
| ~5061 | `Target nodes learned dynamically from the Target Controller Leader or created manually` | `Target nodes learned dynamically from the Leader or added as static entries` |
| ~5109 | `title="Local Stigix Appliance"` | `title="Local Stigix Node"` |

### 5.4 `CustomApps.tsx` Changes

| Line | Current String | New String |
|:---|:---|:---|
| ~565 | `Global Appliance Controls` (comment) | `Global Node Controls` |
| ~596 | `Appliance Start Options` | `Node Start Options` |
| ~639 | `Stop all running clients and listeners on this appliance` | `Stop all running clients and listeners on this node` |
| ~661 | `Appliance Stop Options` | `Node Stop Options` |

> [!NOTE]
> **"Target Peer" in Custom Apps is NOT renamed.** It is semantically correct:
> a Target Peer is a Stigix peer node targeted for TCP traffic.

### 5.5 No Changes Needed

| File | Reason |
|:---|:---|
| `Voice.tsx` | "Stigix Voice Targets" is clear in context |
| `Failover.tsx` | "Stigix Targets" and "Endpoints" usage is contextually appropriate |
| `Security.tsx` | "Endpoint" for EICAR URLs is acceptable (Level C would change this) |
| `Fleet.tsx` | "Fleet Control Plane" is fine (Level C would simplify to "Fleet Overview") |

### 5.6 Documentation Cross-References

| Document | Terms to Update |
|:---|:---|
| `docs/HYBRID_REGISTRY.md` | "Registry Leader" → "Leader" |
| `docs/GLOBAL_PROVISIONING_AND_PEER_ONBOARDING.md` | "Central Global Provisioning" → "Fleet Provisioning" |
| `docs/TARGET_CAPABILITIES.md` | "Connected Peers" → "Registered Targets" |
| `docs/AUTODISCOVERY_GUIDE.md` | "Registry Leader" → "Leader" |

---

## 6. Unified Glossary

After Level B is applied:

| Term | Definition | Strict Rule |
|:---|:---|:---|
| **Target** | A Stigix peer node running responder services (Voice, Convergence, XFR, EICAR, TCP). Must be a Stigix node. | THE central concept. Use consistently across all screens. |
| **Leader** | The node that discovers targets, manages registration, and provisions configuration. | Use in badges, descriptions, role selectors. Never "Registry Leader". |
| **Peer** | A node in the non-leader role. It registers with the Leader and becomes a Target. | Acceptable in Custom Apps as "Target Peer" (a peer that is targeted). |
| **Node** | A single Stigix machine (physical or virtual). | Replace "Instance" and "Appliance" everywhere. |
| **Fleet** | The collection of all interconnected Stigix nodes. Also: multi-target observability and centralized provisioning. | Use for the nav tab, provisioning features, and publisher toggle. |
| **Node Role** | The topology role of a node: Auto-Detect, Leader, or Peer. | Replace "Mesh Role Mode". |
| **Registered Targets** | The list of peer nodes registered with the Leader. | Replace "Connected Peers" in the Target Controller tab. |
| **Target Registry** | The shared directory of all known targets, reused across all test modules. | Replace "Stigix Targets Repository" (Level C only). |
| **Endpoint** | An external URL (EICAR, API). NOT a Stigix node. | Use only in Security/API contexts for non-Stigix URLs. |

---

## 7. Implementation Checklist

> [!IMPORTANT]
> All changes are purely cosmetic (UI labels, tooltips, descriptions).
> No API routes, backend logic, or data structures are modified.

### Phase 1 — Badge & Column Alignment (Level A)
- [ ] Change `Registry Leader` → `Leader` in `App.tsx:803`
- [ ] Change `Peer Node` → `Peer` in `App.tsx:803`
- [ ] Change `Instance` column → `Target` or `Node` in `Settings.tsx:4376`
- [ ] Change `Appliance Start/Stop Options` → `Node Start/Stop Options` in `CustomApps.tsx`
- [ ] Verify all tooltips and descriptions are consistent

### Phase 2 — Vocabulary Harmonization (Level B)
- [ ] Rename `Mesh Role Mode` → `Node Role` in `Settings.tsx`
- [ ] Rename `Connected Peers` → `Registered Targets` in `Settings.tsx`
- [ ] Rename `Central Global Provisioning` → `Fleet Provisioning` (3 occurrences)
- [ ] Rename `Master Publisher` → `Fleet Publisher`
- [ ] Rename `Local Appliance Target & Security Service` → `Local Node & Services`
- [ ] Rename `Discovered & Remote Target Endpoints` → `Discovered & Static Targets`
- [ ] Simplify `Target Controller Leader` → `Leader` in descriptions

### Phase 3 — Documentation Sync
- [ ] Update `docs/HYBRID_REGISTRY.md`
- [ ] Update `docs/GLOBAL_PROVISIONING_AND_PEER_ONBOARDING.md`
- [ ] Update `docs/TARGET_CAPABILITIES.md`
- [ ] Update `docs/AUTODISCOVERY_GUIDE.md`
- [ ] Update FAQ if terminology is mentioned (`site/faq.html`)

### Phase 4 — Full Polish (Level C, optional)
- [ ] Drop "Stigix" prefix from "Stigix Voice Targets" and "Stigix Targets" in modules
- [ ] Rename `Stigix Targets Repository` → `Target Registry`
- [ ] Rename `Fleet Control Plane` → `Fleet Overview`
- [ ] Replace all remaining `Appliance` → `Node`
- [ ] Replace Security `Endpoint` → `External URL` for non-Stigix URLs

---

## 📜 Revision History

| Date | Stigix Version | Author / Trigger | Summary of Changes |
|---|---|---|---|
| 2026-09-27 | `v2.0.66` | Stigix Core Team | Rev 2 — Rewritten with correct Target semantic model (Target = Stigix peer node with responder services). Revised all proposals accordingly. |
| 2026-09-27 | `v2.0.66` | Stigix Core Team | Initial document creation — terminology audit and consolidation proposals |
