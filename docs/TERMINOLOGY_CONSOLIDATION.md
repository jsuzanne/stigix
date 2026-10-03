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

The Stigix architecture is a **Target-centric, flat model**:

```
     ┌───────────────┐    ┌───────────────┐    ┌───────────────┐    ┌───────────────┐
     │    TARGET      │    │    TARGET      │    │    TARGET      │    │    TARGET      │
     │   DC1 (HUB)    │    │   BR1 (Spoke)  │    │   BR2 (Spoke)  │    │   BR5 (Spoke)  │
     │               │    │               │    │               │    │               │
     │ ☎ Voice  6100 │    │ ☎ Voice  6100 │    │ ☎ Voice  6100 │    │ ☎ Voice  6100 │
     │ ⚡ Conv  6200 │    │ ⚡ Conv  6200 │    │ ⚡ Conv  6200 │    │ ⚡ Conv  6200 │
     │ 📡 XFR   5201 │    │ 📡 XFR   5201 │    │ 📡 XFR   5201 │    │ 📡 XFR   5201 │
     │ 🛡 EICAR 8082 │    │ 🛡 EICAR 8082 │    │ 🛡 EICAR 8082 │    │ 🛡 EICAR 8082 │
     │ 🔌 TCP Apps   │    │ 🔌 TCP Apps   │    │ 🔌 TCP Apps   │    │ 🔌 TCP Apps   │
     │               │    │               │    │               │    │               │
     │ ★ LEADER ROLE │    │               │    │               │    │               │
     │  + Discovery  │    │               │    │               │    │               │
     │  + Registry   │    │               │    │               │    │               │
     │  + Provisioning│   │               │    │               │    │               │
     └───────┬───────┘    └───────┬───────┘    └───────┬───────┘    └───────┬───────┘
             │                    │                    │                    │
             └────────────────────┴────────────────────┴────────────────────┘
                              All nodes are targets.
                    The Leader is a target WITH additional duties.
```

**Key insights**:
- **Every Stigix node is a Target** — it runs the same responder services regardless of its role.
- **The Leader is a Target with additional responsibilities**: discovery, registry, and provisioning. It sits in the central DC or connects out-of-band via management LAN/VLAN. It can send AND receive test traffic like any other target.
- **"Peer" simply means "not the Leader"** — a Peer is a Target that doesn't carry the Leader responsibility.
- The UI already reflects this: the Leader appears in its own Targets list with a green "Local Node" badge (`isSelf` check in `Settings.tsx:5077`).
- The Leader role is an **additional capability**, not a different class of node. It is "first among equals".

### Design Decisions (confirmed)

| Question | Answer | Impact on Terminology |
|:---|:---|:---|
| Custom Apps "Target Peer" — always a Stigix node? | **Yes, always.** The TCP server responder is a Stigix service. | "Target Peer" is correct and should NOT be renamed. |
| Security EICAR — external URLs vs Stigix? | Each Stigix target provides EICAR on port 8082. External URLs (eicar.org) exist as a secondary option. | EICAR is primarily a Target service. External URLs are a convenience. |
| Convergence/Failover endpoints — always Stigix? | **Yes, always.** Convergence uses port 6200 with TX/RX packet loss calculations — requires a Stigix responder. | "Endpoints" in Failover are actually Stigix Targets. |
| Fleet — distinct from Target Controller? | Fleet is **redundant** with the registered targets shown in Target Controller. Kept as a separate view for now, but structurally it shows the same data. | No structural merge yet. Terminology alignment only. |
| Controller vs Leader — which term? | **Either is fine, as long as it's consistent everywhere.** Currently mixed: badge says "Registry Leader", tab says "Target Controller", descriptions say "Target Controller Leader". | THE key decision: pick one and standardize. |

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

### 3.3 🔴 "Controller" vs "Leader" — The Central Decision

This is the **single most important terminology decision**. The same role is currently called three different things:

```
Header badge:     "Registry Leader"           ← "Registry" + "Leader"
Settings tab:     "Target Controller"         ← "Target" + "Controller"
Description text: "Target Controller Leader"  ← "Target" + "Controller" + "Leader" (all three!)
Role selector:    "Leader" / "Peer"           ← bare "Leader"
```

Two viable options:

| Option | Badge | Settings Tab | Descriptions | Pros |
|:---|:---|:---|:---|:---|
| **Go with "Controller"** | `Controller` | `Target Controller` *(keep)* | `the Controller` | Professional, implies active management/provisioning |
| **Go with "Leader"** | `Leader` | `Target Controller` *(keep)* | `the Leader` | Already used in role selector, simpler, SD-WAN natural |

**Recommendation**: Either works. The critical requirement is **consistency** — pick one and use it in every badge, description, and tooltip.

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

### 3.6 ⚠️ "Endpoint" — Overloaded but Mostly Means "Target"

"Endpoint" is used in many places, but with the understanding that almost everything is a Stigix Target:

- **Voice**: IP:port columns → these ARE Stigix Targets
- **Convergence/Failover**: probe addresses → these ARE Stigix Targets (port 6200, requires Stigix responder)
- **Security EICAR**: external URLs (eicar.org) → the only case where a destination is NOT a Stigix node, but each Target also exposes EICAR on port 8082
- **Targets tab**: "Discovered & Remote Target **Endpoints**" → redundant with "Target"

The word "Endpoint" is mostly a synonym for "Target" in the codebase. Consider replacing it with "Target" where the destination is a Stigix node, and keeping "Endpoint" only for the rare external URL cases.

### 3.7 ⚠️ "Central Global Provisioning" / "Master Publisher" → Mesh Provisioning

Now standardized using the **Mesh** vocabulary:

```
Main nav:          "Mesh"               ← selected alternative to Fleet
Provisioning card: "Mesh Provisioning"  ← aligned with Mesh
Toggle button:     "Mesh Publisher"     ← aligned with Mesh
```

### 3.8 ⚠️ Mesh Overview (formerly Fleet View)

The Mesh page (leader-only) provides centralized multi-instance mesh observability and peer metrics. Standardized to "Mesh Overview".

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

### Level B — Harmonized (Level A + Mesh vocabulary alignment)

Level A plus internal section clarification for a consistent "Target-first" and "Mesh" vocabulary.

| Current | Proposed | Rationale |
|:---|:---|:---|
| *All of Level A* | — | — |
| **Fleet** (Nav tab) | **Mesh** | Natural in SD-WAN, matches mesh topology model. |
| **Fleet Control Plane** | **Mesh Overview** | Shorter, cleaner, fits dashboard purpose. |
| **Mesh Role Mode** | **Node Role** | Simpler. "Mesh" is implicit. The selector is about the role of THIS node. |
| **Connected Peers** | **Registered Targets** | These peers ARE the targets. Using "Targets" connects this table to the Stigix Targets tab. |
| **Central Global Provisioning** | **Mesh Provisioning** | Align with the established "Mesh" term from main nav. |
| **Master Publisher** | **Mesh Publisher** | Same alignment. |
| **Local Appliance Target & Security Service** | **Local Node & Services** | Shorter, clearer. This section manages the local node identity + EICAR service. |
| **Discovered & Remote Target Endpoints** | **Discovered & Static Targets** | Remove redundant "Endpoint". "Static" is already used as the badge label for manual targets. |
| Description: **Target Controller Leader** | **Leader** | Redundant — just say "Leader" when the context is already the Target Controller. |

> **Estimated scope**: ~25 UI strings. Makes the Target-centric & Mesh model visible everywhere.

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

---

## 5. Detailed Change Matrix

Below is the complete mapping for **Level B + Mesh** (implemented):

### 5.1 `App.tsx` Changes

| Line | Current String | New String | Status |
|:---|:---|:---|:---|
| ~803 | `'Registry Leader'` | `'Leader'` | ✅ Applied |
| ~803 | `'Peer Node'` | `'Peer'` | ✅ Applied |
| ~1124 | `Fleet` (nav tab) | `Mesh` | ✅ Applied |
| ~1125 | `...fleet observability...` | `...mesh observability...` | ✅ Applied |

### 5.2 `Fleet.tsx` Changes

| Line | Current String | New String | Status |
|:---|:---|:---|:---|
| ~190, 205 | `Fleet Overview / Fleet API` | `Mesh Overview / Mesh API` | ✅ Applied |
| ~247 | `Fleet Control Plane` | `Mesh Overview` | ✅ Applied |
| ~333 | `Fleet Global Exp.` | `Mesh Global Exp.` | ✅ Applied |
| ~400 | `Loading fleet instances...` | `Loading mesh nodes...` | ✅ Applied |

### 5.3 `Settings.tsx` — Target Controller Tab

| Line | Current String | New String | Status |
|:---|:---|:---|:---|
| ~4105 | `Mesh Role Mode` | `Node Role` | ✅ Applied |
| ~4107 | `Forced Leader` / `Forced Peer` | *(keep as-is)* | ✅ Kept |
| ~4114 | `master configuration publisher` | `mesh configuration publisher` | ✅ Applied |
| ~4157 | `Central Global Provisioning` (comment) | `Mesh Provisioning` | ✅ Applied |
| ~4165 | `Central Global Provisioning` (heading) | `Mesh Provisioning` | ✅ Applied |
| ~4166 | `Publish shared configuration bundles once to all connected remote branch peers` | `Publish shared configuration bundles to all registered targets` | ✅ Applied |
| ~4179 | `Master Publisher Active/Disabled` | `Mesh Publisher Active/Disabled` | ✅ Applied |
| ~4345 | `Connected Peers` | `Registered Targets` | ✅ Applied |
| ~4346 | `Instances that have registered with this leader` | `Targets registered with this leader` | ✅ Applied |
| ~4369 | `No peers registered yet` | `No targets registered yet` | ✅ Applied |
| ~4370 | `Use the onboard command below to add a remote instance` | `Use the onboard command below to add a remote target` | ✅ Applied |
| ~4376 | Column: `Instance` | `Target` | ✅ Applied |
| ~4571 | `Central Global Provisioning` (peer view) | `Mesh Provisioning` | ✅ Applied |
| ~4596 | `Global Provisioning: ON/OFF` | `Mesh Provisioning: ON/OFF` | ✅ Applied |

### 5.4 `Settings.tsx` — Stigix Targets Tab

| Line | Current String | New String | Status |
|:---|:---|:---|:---|
| ~4927 | `Local Appliance Target & Security Service` | `Local Node & Services` | ✅ Applied |
| ~4979 | `across the mesh and Target Controller Leader` | `across the mesh and Leader` | ✅ Applied |
| ~5058 | `Discovered & Remote Target Endpoints` | `Discovered & Static Targets` | ✅ Applied |
| ~5061 | `Target nodes learned dynamically from the Target Controller Leader or created manually` | `Target nodes learned dynamically from the Leader or added as static entries` | ✅ Applied |
| ~5109 | `title="Local Stigix Appliance"` | `title="Local Stigix Node"` | ✅ Applied |

### 5.5 `CustomApps.tsx` Changes

| Line | Current String | New String | Status |
|:---|:---|:---|:---|
| ~596 | `Appliance Start Options` | `Node Start Options` | ✅ Applied |
| ~639 | `Stop all running clients and listeners on this appliance` | `Stop all running clients and listeners on this node` | ✅ Applied |
| ~661 | `Appliance Stop Options` | `Node Stop Options` | ✅ Applied |
| ~814 | `Download full fleet bundle` | `Download full mesh bundle` | ✅ Applied |

---

## 6. Unified Glossary

After Level B + Mesh is applied:

| Term | Definition | Strict Rule |
|:---|:---|:---|
| **Target** | A Stigix node running responder services (Voice, Convergence, XFR, EICAR, TCP). Every Stigix node is a Target — including the Leader. | THE central concept. Use consistently across all screens. Never use "Endpoint" as a synonym. |
| **Leader** (or **Controller**) | A Target with additional responsibilities: discovery, registry, and provisioning. Typically sits in the central DC or on management LAN/VLAN. Sends and receives traffic like any other Target. | Use in badges, descriptions, role selectors. Standardize — never mix "Registry Leader" and "Target Controller Leader". |
| **Peer** | A Target that does not carry the Leader responsibility. Registers with the Leader. | Acceptable in Custom Apps as "Target Peer" (a peer that is targeted). |
| **Target Peer** | A peer Stigix node targeted for traffic (Custom TCP Apps). Always a Stigix node. | Correct as-is. Do NOT rename to "Remote Host". |
| **Node** | A single Stigix machine (physical or virtual). | Replace "Instance" and "Appliance" everywhere. |
| **Mesh** | The collection of all interconnected Stigix targets. Also: multi-target observability and centralized provisioning (formerly "Fleet"). | Use for the nav tab, provisioning features, and publisher toggle. |
| **Node Role** | The topology role of a node: Auto-Detect, Leader, or Peer. | Replace "Mesh Role Mode". |
| **Registered Targets** | The list of nodes registered with the Leader. | Replace "Connected Peers" in the Target Controller tab. |
| **Endpoint** | An external URL used only in rare cases (e.g. external EICAR from eicar.org). Almost everything in Stigix is a Target, not an Endpoint. | Avoid using for Stigix nodes. Reserve for genuinely external URLs only. |

---

## 7. Implementation Checklist

> [!IMPORTANT]
> All changes are purely cosmetic (UI labels, tooltips, descriptions).
> No API routes, backend logic, or data structures are modified.

### Phase 1 & 2 — Badge, Mesh & Column Alignment (Applied on v2)
- [x] Change `Registry Leader` → `Leader` in `App.tsx:803`
- [x] Change `Peer Node` → `Peer` in `App.tsx:803`
- [x] Change `Fleet` nav button → `Mesh` in `App.tsx:1124`
- [x] Change `Fleet Control Plane` → `Mesh Overview` in `Fleet.tsx`
- [x] Change `Fleet Global Exp.` → `Mesh Global Exp.` in `Fleet.tsx`
- [x] Change `Mesh Role Mode` → `Node Role` in `Settings.tsx`
- [x] Change `Central Global Provisioning` → `Mesh Provisioning` in `Settings.tsx`
- [x] Change `Master Publisher` → `Mesh Publisher` in `Settings.tsx`
- [x] Change `Connected Peers` → `Registered Targets` in `Settings.tsx`
- [x] Change `Instance` column → `Target` in `Settings.tsx`
- [x] Change `Local Appliance Target & Security Service` → `Local Node & Services` in `Settings.tsx`
- [x] Change `Discovered & Remote Target Endpoints` → `Discovered & Static Targets` in `Settings.tsx`
- [x] Change `Appliance Start/Stop Options` → `Node Start/Stop Options` in `CustomApps.tsx`
- [x] Change `Download full fleet bundle` → `Download full mesh bundle` in `CustomApps.tsx`

---

## 📜 Revision History

| Date | Stigix Version | Author / Trigger | Summary of Changes |
|---|---|---|---|
| 2026-09-27 | `v2.0.66` | Stigix Core Team | Rev 5 — Applied "Mesh" terminology to replace "Fleet", standardized badges (`Leader`/`Peer`), updated Settings & CustomApps labels on `v2`. |
| 2026-09-27 | `v2.0.66` | Stigix Core Team | Rev 4 — Incorporated Q&A findings: everything is Stigix (Custom Apps, Convergence), EICAR external URLs are secondary, Fleet is redundant with Target Controller, Controller vs Leader is THE key decision. |
| 2026-09-27 | `v2.0.66` | Stigix Core Team | Rev 3 — Clarified that the Leader IS also a Target (flat model, "first among equals"). Updated architecture diagram. |
| 2026-09-27 | `v2.0.66` | Stigix Core Team | Rev 2 — Rewritten with correct Target semantic model (Target = Stigix peer node with responder services). Revised all proposals accordingly. |
| 2026-09-27 | `v2.0.66` | Stigix Core Team | Initial document creation — terminology audit and consolidation proposals |
