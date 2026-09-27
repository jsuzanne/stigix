> **Last Updated:** 2026-09-27 | **Created:** 2026-09-27 (v2.0.66)

# Stigix Terminology Consolidation Guide

> [!NOTE]
> This document is a **reference proposal** for consolidating Stigix UI terminology.
> It does NOT change any functionality — only UI labels, tooltips, and documentation wording.
> Review at your own pace, then decide which level of consolidation to apply.

## Table of Contents

1. [Current Terminology Map](#1-current-terminology-map)
2. [Identified Collisions](#2-identified-collisions)
3. [Proposed Consolidation — 3 Levels](#3-proposed-consolidation--3-levels)
4. [Detailed Change Matrix](#4-detailed-change-matrix)
5. [Unified Glossary](#5-unified-glossary)
6. [Implementation Checklist](#6-implementation-checklist)

---

## 1. Current Terminology Map

### 1.1 Infrastructure & Topology Terms

| Current UI Term | Location | Actual Meaning |
|:---|:---|:---|
| **Registry Leader** | Header badge (`App.tsx`) | Role badge when this node is the mesh leader |
| **Peer Node** | Header badge (`App.tsx`) | Role badge when this node is a managed peer |
| **Target Controller** | Settings tab label | The clustering/mesh configuration screen |
| **Mesh Role Mode** | Selector inside Target Controller | Auto-Detect / Leader / Peer role switcher |
| **Connected Peers** | Table inside Target Controller | List of Stigix instances registered with the leader |
| **Instance** | Column header in Connected Peers table | Name of a Stigix machine (e.g. BR1-Ubuntu) |
| **Central Global Provisioning** | Card inside Target Controller (leader view) | Config push system from leader to all peers |
| **Master Publisher** | Toggle button inside provisioning card | Enables/disables centralized config distribution |
| **Fleet** | Main navigation tab | Multi-instance observability view (leader only) |
| **Fleet Control Plane** | Page title inside Fleet | Same view, full title |
| **Appliance** | Custom Apps controls, Settings/Targets tab | Synonym for "this local Stigix machine" |

### 1.2 Test Destination Terms

| Current UI Term | Location | Actual Meaning |
|:---|:---|:---|
| **Stigix Targets** | Settings tab label | The IP/hostname target directory screen |
| **Stigix Targets Repository** | Title inside the Targets tab | The shared registry of test destinations |
| **Discovered & Remote Target Endpoints** | Section header inside Targets | Targets learned from leader or added manually |
| **Target Controller Leader** | Description text inside Targets tab | Cross-reference to the clustering leader (same term as the other tab!) |
| **Stigix Voice Targets** | Voice module | Voice-specific test destinations |
| **Target Peer** | Custom TCP Apps | Remote IP:port for a custom TCP application |
| **Endpoint** | Voice, Security, Failover modules | Used for test URLs, EICAR URLs, and IP:port columns |
| **Local Appliance Target & Security Service** | Section inside Targets tab | Local EICAR server identity + site name config |

---

## 2. Identified Collisions

The core problem is not vocabulary size — it is that **the same words mean different things** depending on context:

### 2.1 "Target" Collision

```
"Target" in Settings navigation:
  ├── "Stigix Targets"      → IP/hostname destinations for testing
  └── "Target Controller"   → Mesh clustering configuration
          └── References "Target Controller Leader" inside the Targets tab
```

**Impact**: A user seeing these two tabs side-by-side cannot tell that one manages network topology and the other manages test addresses.

### 2.2 "Peer" Collision

```
"Peer" in the codebase:
  ├── Mesh Peer          → A Stigix node in the cluster (Fleet/Registry context)
  └── Target Peer        → A remote TCP host:port (Custom Apps context)
```

**Impact**: "Add Target Peer" in Custom Apps sounds like adding a cluster node, but it actually adds a remote server address.

### 2.3 "Endpoint" Ambiguity

```
"Endpoint" usage:
  ├── Voice           → IP:port column in stream tables
  ├── Security        → EICAR test URLs
  ├── Failover        → Monitored convergence addresses
  └── Targets tab     → "Discovered & Remote Target Endpoints"
```

**Impact**: Minor — contextually understandable, but contributes to the feeling of inconsistency.

### 2.4 "Instance" vs "Node" vs "Appliance"

```
Terms for "a Stigix machine":
  ├── Instance      → Connected Peers table column
  ├── Node          → Used in descriptions ("this node", "spoke nodes")
  └── Appliance     → Custom Apps ("Appliance Start Options"), Targets tab
```

**Impact**: Three synonyms for the same concept across different screens.

---

## 3. Proposed Consolidation — 3 Levels

### Level A — Surgical (5 changes, minimal disruption)

The absolute minimum to eliminate the two critical collisions (Target and Peer).

| Current | Proposed | Rationale |
|:---|:---|:---|
| Tab: **Target Controller** | **Mesh Controller** | Removes collision with "Targets" tab. "Mesh" already used in "Mesh Role Mode". |
| Badge: **Registry Leader** | **Mesh Leader** | Consistent with renamed tab. "Registry" is an internal technical detail. |
| Badge: **Peer Node** | **Mesh Peer** | Same logic. |
| Description: **Target Controller Leader** | **Mesh Leader** | Follows the rename in cross-references. |
| Custom Apps: **Target Peer** | **Remote Host** | Removes collision with cluster "Peer". A "Remote Host" is just an IP:port. |

**Estimated scope**: ~15 UI strings. No new concepts introduced.

### Level B — Structured (Level A + section harmonization)

Everything from Level A, plus internal section clarification and consistent terminology.

| Current | Proposed | Rationale |
|:---|:---|:---|
| *All of Level A* | — | — |
| **Mesh Role Mode** | **Cluster Role** | More direct. "Mesh Role Mode" is verbose. |
| **Connected Peers** | **Cluster Nodes** | The table shows *nodes*, not just peers. |
| Column: **Instance** | **Node** | Consistent with "Cluster Nodes". |
| **Central Global Provisioning** | **Fleet Provisioning** | "Central Global" is redundant. "Fleet" is already established in the main nav. |
| **Master Publisher** | **Fleet Publisher** | Same logic. |
| **Stigix Targets Repository** | **Target Directory** | "Repository" has Git/code connotations. "Directory" = address book. |
| **Discovered & Remote Target Endpoints** | **Discovered & Manual Targets** | Removes the "Target Endpoints" redundancy. |
| **Local Appliance Target & Security Service** | **Local Node Identity & Services** | This block manages site name + EICAR server. "Appliance Target" is confusing. |

**Estimated scope**: ~30 UI strings. Introduces a clean 3-domain separation: Mesh / Fleet / Targets.

### Level C — Full Unified Glossary

The complete vision where every word has exactly one meaning across the entire product.

```
┌──────────────────────────────────────────────────────────────────┐
│                            STIGIX                                │
├───────────────────┬───────────────────┬──────────────────────────┤
│   MESH            │   FLEET           │   TARGETS                │
│   (Topology)      │   (Observability) │   (Test Destinations)    │
├───────────────────┼───────────────────┼──────────────────────────┤
│ • Cluster Role    │ • Fleet Overview  │ • Target Directory       │
│   - Leader        │ • Fleet           │   - Voice Targets        │
│   - Peer          │   Provisioning    │   - Discovered Targets   │
│   - Auto-Detect   │ • Fleet Publisher │   - Manual Targets       │
│ • Cluster Nodes   │                   │                          │
│ • Mesh Leader     │                   │ • Remote Hosts           │
│   (badge)         │                   │   (Custom TCP Apps)      │
│ • Mesh Peer       │                   │                          │
│   (badge)         │                   │ • Endpoints              │
│ • Node            │                   │   (Security EICAR URLs   │
│   (a machine)     │                   │    only)                 │
└───────────────────┴───────────────────┴──────────────────────────┘
```

**Strict rules for Level C:**
- **Node** = a Stigix machine (never "Instance", "Appliance", or bare "Peer")
- **Peer** = only the mesh role opposite to "Leader" (never a remote TCP host)
- **Target** = a test destination IP/hostname (never used for topology)
- **Endpoint** = reserved for API/Security/EICAR URLs (not for general test targets)
- **Fleet** = anything multi-instance / observability / centralized provisioning

---

## 4. Detailed Change Matrix

Below is the complete mapping of every UI string change for **Level B** (the recommended level):

### 4.1 `App.tsx` Changes

| Line | Current String | New String |
|:---|:---|:---|
| ~803 | `'Registry Leader'` | `'Mesh Leader'` |
| ~803 | `'Peer Node'` | `'Mesh Peer'` |

### 4.2 `Settings.tsx` Changes

| Line | Current String | New String |
|:---|:---|:---|
| ~1826 | `label: 'Target Controller'` | `label: 'Mesh Controller'` |
| ~4105 | `Mesh Role Mode` | `Cluster Role` |
| ~4107 | `Forced Leader` / `Forced Peer` | `Forced Leader` / `Forced Peer` *(keep)* |
| ~4114 | `master configuration publisher` | `fleet configuration publisher` |
| ~4157 | `Central Global Provisioning` | `Fleet Provisioning` |
| ~4165 | `Central Global Provisioning` | `Fleet Provisioning` |
| ~4179 | `Master Publisher Active/Disabled` | `Fleet Publisher Active/Disabled` |
| ~4345 | `Connected Peers` | `Cluster Nodes` |
| ~4346 | `Instances that have registered with this leader` | `Nodes registered with this leader` |
| ~4376 | Column: `Instance` | `Node` |
| ~4571 | `Central Global Provisioning` | `Fleet Provisioning` |
| ~4733 | `Stigix Targets Repository` | `Target Directory` |
| ~4927 | `Local Appliance Target & Security Service` | `Local Node Identity & Services` |
| ~4979 | `across the mesh and Target Controller Leader` | `across the mesh and Mesh Leader` |
| ~5058 | `Discovered & Remote Target Endpoints` | `Discovered & Manual Targets` |
| ~5061 | `Target Controller Leader` | `Mesh Leader` |

### 4.3 `CustomApps.tsx` Changes

| Line | Current String | New String |
|:---|:---|:---|
| ~352 | `No target peers configured` | `No remote hosts configured` |
| ~596 | `Appliance Start Options` | `Node Start Options` *(or keep "Appliance")* |
| ~615 | `configured target peers` | `configured remote hosts` |
| ~661 | `Appliance Stop Options` | `Node Stop Options` |
| ~880 | `Target Peer(s)` | `Remote Host(s)` |
| ~1288 | `No remote target peers configured` | `No remote hosts configured` |
| ~1296 | `Add Target Peer` | `Add Remote Host` |
| ~1311 | Column: `Target Peer` | `Remote Host` |

### 4.4 `Voice.tsx` — No changes needed

"Stigix Voice Targets" is clear and correct in context.

### 4.5 `Failover.tsx` — No changes needed

"Endpoints" usage is internal and contextually clear.

### 4.6 Documentation Cross-References

The following docs should be updated to match the new terminology:

| Document | Terms to Update |
|:---|:---|
| `docs/HYBRID_REGISTRY.md` | "Target Controller" → "Mesh Controller" |
| `docs/GLOBAL_PROVISIONING_AND_PEER_ONBOARDING.md` | "Central Global Provisioning" → "Fleet Provisioning", "Target Controller" → "Mesh Controller" |
| `docs/TARGET_CAPABILITIES.md` | "Stigix Targets Repository" → "Target Directory" |
| `docs/AUTODISCOVERY_GUIDE.md` | "Registry Leader" → "Mesh Leader" |

---

## 5. Unified Glossary

Once Level B is applied, this is the definitive glossary:

| Term | Definition | Where It Appears |
|:---|:---|:---|
| **Node** | A single Stigix machine (physical or virtual). | Cluster Nodes table, descriptions, tooltips |
| **Leader** | The node that hosts the central registry and distributes configuration. | Mesh Leader badge, Cluster Role selector |
| **Peer** | A node that connects to a Leader for registration and config sync. | Mesh Peer badge, Cluster Role selector |
| **Fleet** | The collection of all interconnected Stigix nodes. Also: the observability dashboard for multi-node monitoring. | Fleet tab, Fleet Provisioning, Fleet Publisher |
| **Cluster Role** | The topology role of a node: Auto-Detect, Leader, or Peer. | Mesh Controller settings tab |
| **Mesh Controller** | The settings screen for configuring cluster topology, roles, and provisioning. | Settings tab |
| **Target** | A test destination: an IP address, hostname, or URL used by test modules. | Target Directory, Voice Targets, discovered targets |
| **Target Directory** | The shared registry of all test destinations, reused across Speedtest, Voice, Security, and Failover. | Settings → Target Directory tab |
| **Remote Host** | A specific IP:port destination for Custom TCP Applications. | Custom Apps peer configuration |
| **Endpoint** | A URL used for Security testing (EICAR) or API calls. Reserved for URL-type destinations. | Security module, EICAR service |

---

## 6. Implementation Checklist

> [!IMPORTANT]
> All changes are purely cosmetic (UI labels, tooltips, descriptions).
> No API routes, backend logic, or data structures are modified.

### Phase 1 — Core Renames (Level A)
- [ ] Rename `Target Controller` tab → `Mesh Controller` in `Settings.tsx`
- [ ] Rename `Registry Leader` / `Peer Node` badges → `Mesh Leader` / `Mesh Peer` in `App.tsx`
- [ ] Rename `Target Peer` → `Remote Host` throughout `CustomApps.tsx`
- [ ] Update `Target Controller Leader` cross-references → `Mesh Leader` in `Settings.tsx`
- [ ] Verify all tooltips and descriptions are consistent

### Phase 2 — Section Harmonization (Level B additions)
- [ ] Rename `Mesh Role Mode` → `Cluster Role` in `Settings.tsx`
- [ ] Rename `Connected Peers` → `Cluster Nodes` in `Settings.tsx`
- [ ] Rename `Instance` column → `Node` in Connected Peers table
- [ ] Rename `Central Global Provisioning` → `Fleet Provisioning` (3 occurrences)
- [ ] Rename `Master Publisher` → `Fleet Publisher`
- [ ] Rename `Stigix Targets Repository` → `Target Directory`
- [ ] Rename `Discovered & Remote Target Endpoints` → `Discovered & Manual Targets`
- [ ] Rename `Local Appliance Target & Security Service` → `Local Node Identity & Services`
- [ ] Update `Appliance Start/Stop Options` → `Node Start/Stop Options` in `CustomApps.tsx`

### Phase 3 — Documentation Sync
- [ ] Update `docs/HYBRID_REGISTRY.md`
- [ ] Update `docs/GLOBAL_PROVISIONING_AND_PEER_ONBOARDING.md`
- [ ] Update `docs/TARGET_CAPABILITIES.md`
- [ ] Update `docs/AUTODISCOVERY_GUIDE.md`
- [ ] Update FAQ if terminology is mentioned (`site/faq.html`)

---

## 📜 Revision History

| Date | Stigix Version | Author / Trigger | Summary of Changes |
|---|---|---|---|
| 2026-09-27 | `v2.0.66` | Stigix Core Team | Initial document creation — terminology audit and consolidation proposals |
