> **Last Updated:** 2026-10-11 | **Created:** 2026-10-11 (v2.2.9)

# Product Requirement Document (PRD): Stigix Navigation Architecture & Functional Taxonomy

**Status:** Approved direction — Icon Rail + Flyout Sidebar (Strata Cloud Manager model)
**Owner:** Stigix Core Team

> [!IMPORTANT]
> **Scope: navigation shell only.** This PRD changes *how users reach* each module (sidebar, routing, favorites). The **content, layout, and behavior of every existing module page remain unchanged** — including the internal sub-tabs of `Settings` and `VyOS Control`.

---

## 1. Executive Summary & Problem Statement

### 1.1 Context — The "Horizontal Sprawl" Problem
From v1 to v2.2.x, Stigix grew from a SaaS traffic generator into an end-to-end SD-WAN / SASE validation platform. The top navigation bar in `App.tsx` currently exposes **16 flat entries**:

| View ID | Module | Primary Objective |
|---|---|---|
| `dashboard` | Traffic Generator / Home | Multi-app SaaS background traffic and global status |
| `performance` | Digital Experience (DEM) | Synthetic path probes and SLA telemetry |
| `speedtest` | Bandwidth Test (XFR / iPerf) | Throughput, latency, and packet loss validation |
| `security` | Security Validation | SASE / NGFW inspection (URL, DNS, EICAR, Threats) |
| `iot` | IoT Emulation | Real-on-wire IoT device and vulnerability simulation |
| `voice` | Voice Simulation | RTP VoIP MOS, jitter, and codec testing |
| `custom_apps` | Custom TCP/HTTP Apps | Enterprise custom application emulator |
| `pcap_replay` | PCAP Replay | Stateful L7 PCAP replay engine |
| `packet_capture` | Packet Capture | BPF sniffer & 3-pane web inspector |
| `convergence` | Failover Monitoring | Sub-second blackout and convergence monitoring |
| `topology` | Topology | Underlay, SD-WAN overlay, and SASE tunnel visualization |
| `vyos` | VyOS Control | WAN impairment injection & router orchestration |
| `events` | Live Events | Real-time event streaming and logging |
| `copilot` | AI Copilot | Conversational troubleshooting and orchestration |
| `fleet` | Fleet | Multi-node cluster management (**Leader node only**) |
| `settings` | Settings | Targets, controller, provisioning, maintenance |

Planned addition: **Use Cases** (multi-module scenarios).

### 1.2 User Experience Pain Points
On common laptop resolutions (1366×768, 1440×900, 1080p), the flat bar wraps onto 2–3 lines:
1. **Vertical real-estate waste** — 120–160 px consumed by navigation pushes packet lists, topology canvases, and graphs below the fold. On 16:9 / 16:10 screens, **height is the scarcest resource**; width is abundant.
2. **Cognitive overload** — 16 unstructured buttons violate Hick's Law.
3. **No room for the roadmap** — Use Cases and future modules cannot be added without breaking the layout further.
4. **Hidden background activity** — Traffic, Voice, IoT, captures, and failover tests run in the background, with no consistent "running" indicator in the navigation.

---

## 2. Options Considered

### Option A — Vertical Sidebar (Icon Rail + Flyout) ✅ SELECTED
*Industry references: Palo Alto **Strata Cloud Manager**, Grafana, Datadog, AWS Console.*

### Option B — Hierarchical Domain Ribbons (top bar + permanent sub-ribbon) ❌ REJECTED
Initially recommended in the first draft of this PRD; rejected after review for the following reasons:

| Concern | Detail |
|---|---|
| **Contradicts the space argument** | Two permanent horizontal bars consume ~90 px of the scarcest dimension (height), while a collapsed rail costs only ~56 px of the most abundant one (width). |
| **Three stacked tab levels** | `Settings` and `VyOS Control` already have internal sub-tabs. Ribbons would produce *Domain → Module → Module sub-tabs* — three horizontal tab bars stacked on top of each other. |
| **Hidden running state** | Modules hidden behind domains cannot show individual "running" indicators. |
| **Effort not lower** | The real cost (taxonomy config, URL routing, state preservation) is identical for both options. |

### Comparison Matrix

| Criteria | Option A: Rail + Flyout | Option B: Domain Ribbons |
|---|---|---|
| Content width (Topology / PCAP) | 🟢 ~97% (56 px rail; flyout overlays content) | 🟢 100% |
| Content height (tables / logs / graphs) | 🟢 **Optimal** | 🔴 −90 px permanently |
| Interaction with existing sub-tabs | 🟢 Sub-tabs remain the only horizontal tabs | 🔴 3 stacked tab levels |
| Running-job visibility | 🟢 Per-module badges | 🟡 Aggregated per domain only |
| Scalability (30+ items) | 🟢 Very high | 🟡 Limited per ribbon width |
| Familiarity for target audience | 🟢 Identical to Strata Cloud Manager | 🟡 Medium |
| Implementation effort | 🟡 ~2–3 days | 🟡 ~2 days |

---

## 3. Selected Design — Strata Cloud Manager-Style Navigation

Stigix users are SASE / SD-WAN engineers who already use Palo Alto **Strata Cloud Manager (SCM)** daily. Reusing its navigation model gives them zero learning curve and keeps a consistent "Palo Alto ecosystem" feel.

### 3.1 Anatomy

```text
┌────┬──────────────────────┬──────────────────────────────────────────────┐
│ ◆  │                      │  Page Header:  Security Validation   [☆]     │
│ 🔍 │  ┌────────────────┐  │  Sub-tabs (module-internal, if any)          │
│────│  │ VALIDATE    ⊼  │  │                                              │
│ 🏠 │  │                │  │                                              │
│ 🎬 │  │ Security    ●  │  │   Content area                               │
│ ⚡ │  │ Speedtest      │  │   (flyout OVERLAYS content, never pushes it) │
│ ✅›│◄─┤ DEM         ●  │  │                                              │
│ 🔍 │  │ Failover       │  │                                              │
│ 🌐 │  └────────────────┘  │                                              │
│    │                      │                                              │
│────│                      │                                              │
│ ✨ │  AI Copilot          │                                              │
│ ☆ ›│  Favorites           │                                              │
│ 🔔 │  Notifications       │                                              │
│ ⚙️ │  Settings            │                                              │
│ 👤 │  User / Logout       │                                              │
│ »  │  Pin / Expand        │                                              │
└────┴──────────────────────┴──────────────────────────────────────────────┘
```

### 3.2 Behavior Modes

| Mode | Width | Behavior |
|---|---|---|
| **Rail (default)** | 56 px | Icons only. Hover/click on a domain icon opens a **flyout panel** (~240 px) that **overlays** the content (no layout shift). Single-item entries (Home, Use Cases) navigate directly with a tooltip. |
| **Pinned / Expanded** | 240 px | Toggled via the `»` button at the bottom. Shows section headers and all module labels inline (collapsible groups like SCM's `⌄ Security`). Content area shrinks accordingly. |
| **Auto-collapse** | 56 px | When entering `topology` or `packet_capture`, an expanded sidebar temporarily collapses to the rail (restored on leave). |

- Mode preference persisted in `localStorage` (`stigix.nav.mode`).
- Flyout closes on: item click, `Esc`, click outside, or mouse leave (with ~250 ms grace delay to avoid accidental closes).
- Rail icons show a `›` chevron when they open a flyout (as in SCM).

### 3.3 Rail Sections (top → bottom)

| Zone | Items |
|---|---|
| **Top** | Stigix logo (→ Home) · 🔍 **Search / Command Palette** (`Ctrl+K` / `⌘K`) |
| **Main** | Domain icons (see §4) |
| **Bottom (global utilities)** | ✨ AI Copilot (side panel, not a page) · ☆ Favorites (flyout) · 🔔 Notifications / Live Events badge · ⚙️ Settings · 👤 User · `»` Pin toggle |

---

## 4. Functional Taxonomy (Corrected)

Grouping is based on **user intent**: *"I want to generate load"* vs *"I want a verdict"* vs *"I want to see what's happening"* vs *"I want to act on the network"*.

```text
🏠  HOME                       (direct link)
    └── Dashboard               Global overview + running jobs summary

🎬  USE CASES                  (direct link — NEW)
    └── Scenarios               Multi-module orchestrated test scenarios

⚡  GENERATE                   (flyout)  — "produce realistic load"
    ├── SaaS Traffic            Multi-app background load
    ├── Custom Apps             Enterprise private TCP/HTTP apps
    ├── Voice                   RTP call load & MOS
    ├── IoT Devices             Real-on-wire device profiles
    └── PCAP Replay             Stateful L7 replay

✅  VALIDATE                   (flyout)  — "get a verdict"
    ├── Security                URL, DNS, EICAR, threat tests
    ├── Speedtest               XFR / iPerf3 throughput
    ├── Digital Experience      Synthetic probes & SLA
    └── Failover                Blackout & path switch timing

🔍  OBSERVE                    (flyout)  — "see what happens"
    ├── Packet Capture          BPF sniffer & 3-pane inspector
    └── Live Events             Real-time telemetry stream

🌐  NETWORK                    (flyout)  — "act on the infrastructure"
    ├── Topology                Underlay / overlay / SASE map
    ├── VyOS Control            Impairments & routing
    └── Fleet                   Cluster nodes & upgrades (Leader only)

⚙️  SETTINGS                   (flyout, grouped) — "configure Stigix"
    ── Module Configuration
    ├── Traffic Distribution
    ├── Synthetic Probes
    ├── Custom TCP Apps
    ├── Failover
    ── Cluster & Targets
    ├── Stigix Targets
    ├── Target Controller
    ── Integrations
    ├── Prisma SASE API
    ├── API Studio
    ├── AI & Copilot            (feature-flagged)
    ── System
    ├── System Info
    └── Maintenance & Updates

── Global utilities (bottom of rail) ──
✨  AI Copilot                 Slide-over panel, available from any page
☆   Favorites                  User-pinned pages
🔔  Notifications              Alerts & Live Events badge
⚙️  Settings  → promoted to a full domain (see above)
👤  User
```

**Notes**
- **Voice** stays in *Generate*: its primary use is call load generation; MOS is a by-product shown on its own page.
- **Copilot** is no longer a "domain": it is a global utility (slide-over panel), always one click away.
- **Settings is a first-class domain**: it is heavily used, so it sits in the main rail with its own flyout. Each flyout entry deep-links to the **existing** Settings tab (`#/settings/target-controller`); the Settings page and its tab bar are unchanged. This makes every Settings tab reachable in 1 click from anywhere and favoritable.
- **Feature flags**: items whose feature is disabled (e.g. Copilot without API key) are hidden, not greyed out.
- **Role-based visibility**: `Fleet` is only rendered when the node is the cluster **Leader** (`registryStatus.isLeader`). On Peer / standalone nodes the *Network* flyout shows only Topology and VyOS Control.

---

## 5. Key Features

### 5.1 Favorites ☆
- A **☆ star button** in every page header toggles the current page as a favorite.
- Favorites can target a **module** (`Security`) or a **module sub-tab** (`VyOS › Impairments`, `Settings › Target Controller`).
- The ☆ rail icon opens a flyout listing favorites (drag-to-reorder, remove with ✕).
- In expanded mode, favorites appear as a pinned section at the top of the sidebar.
- **Storage**: phase 1 in `localStorage` (`stigix.nav.favorites`); phase 2 persisted per user server-side (`users.json`) so favorites follow the user across browsers.

### 5.2 Deep-Linking (URL Routing)
- Hash-based routes, one per page and sub-tab:
  - `#/generate/saas`, `#/validate/security`, `#/network/vyos/impairments`, `#/settings/target-controller`
- Browser **Back / Forward** works across modules.
- Links are bookmarkable and shareable (e.g. in a lab runbook or Slack).
- The legacy `view` state is mapped 1:1 to routes to keep all existing `setView('...')` calls working during migration.

### 5.3 Running-Job Indicators ●
- Each module entry shows a small **pulsing green dot** when it has an active job (traffic running, voice calls, IoT devices up, capture in progress, failover test running).
- Domain icons in the rail show an **aggregated dot** if any child is active.
- Source: existing status endpoints / WebSocket events already used by each module (no new backend required for phase 1).

### 5.4 Command Palette 🔍 (`Ctrl+K` / `⌘K`)
- Fuzzy search across all modules, sub-tabs, and favorites.
- Quick actions (phase 2): "Start traffic", "Run security test", "Open capture on eth1".

### 5.5 Preserved State
- Switching pages never stops running jobs (unchanged behavior).
- Each module keeps its internal tab/filter state when navigating away and back.

---

## 6. Implementation Specifications

### 6.1 Single Source of Truth — `navigationConfig.ts`
```ts
export interface NavItem {
  id: string;             // legacy view id, e.g. 'security'
  label: string;
  icon: LucideIcon;
  route: string;          // e.g. '/validate/security'
  featureFlag?: string;   // hide when disabled
  leaderOnly?: boolean;   // render only on the cluster Leader (e.g. Fleet)
  runningKey?: string;    // key in the running-jobs store
  subTabs?: { id: string; label: string; route: string }[];
}

export interface NavDomain {
  id: 'home' | 'usecases' | 'generate' | 'validate' | 'observe' | 'network';
  label: string;
  icon: LucideIcon;
  items: NavItem[];       // 1 item = direct link, >1 = flyout
}
```
Rendering (rail, flyout, expanded, palette, favorites) is derived entirely from this config.

### 6.2 Components
| Component | Responsibility |
|---|---|
| `SidebarRail.tsx` | 56 px rail, domain icons, bottom utilities, tooltips |
| `SidebarFlyout.tsx` | Overlay panel with domain title and items (SCM style) |
| `SidebarExpanded.tsx` | Pinned 240 px mode with collapsible groups |
| `FavoriteStar.tsx` | Star toggle for page headers |
| `CommandPalette.tsx` | `Ctrl+K` fuzzy search |
| `useNavRouter.ts` | Hash routing ↔ legacy `view` state bridge |
| `useRunningJobs.ts` | Aggregates module activity for badges |

### 6.3 Design Tokens
- **Rail**: `w-14`, dark surface (`bg-neutral-950` / theme `bg-card`), `border-r border-border`.
- **Active item**: rounded square highlight (`bg-blue-600/20 text-blue-400`) + 2 px left accent bar.
- **Flyout**: `w-60`, `bg-card/95 backdrop-blur-md shadow-2xl rounded-r-xl`, domain title in bold, items `text-sm`, active item highlighted.
- **Running dot**: `w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse`.
- **Tooltips**: shown on rail hover after 300 ms.
- **Light & dark theme** support via existing theme tokens.

### 6.4 Top Header (simplified)
The top bar keeps only contextual information: page title, ☆ favorite toggle, instance/site name, cluster/health badges. All navigation moves to the rail.

### 6.5 Responsive
- `< 768 px`: rail hidden, hamburger opens the expanded sidebar as a drawer.
- `≥ 768 px`: rail visible by default.

---

## 7. Migration & Rollout Plan

| Phase | Scope | Estimate |
|---|---|---|
| **1. Taxonomy & routing** | `navigationConfig.ts`, `useNavRouter.ts` (hash routes mapped to existing views) | ~0.5 day |
| **2. Rail + Flyout** | Replace the flat top bar in `App.tsx`; bottom utilities; tooltips; auto-collapse | ~1 day |
| **3. Expanded mode** | Pin toggle, collapsible groups, persisted preference | ~0.5 day |
| **4. Favorites & running badges** | ☆ in page headers, favorites flyout, activity dots | ~0.5 day |
| **5. Command palette** | `Ctrl+K` navigation search | ~0.5 day |
| **6. Phase 2 (later)** | Server-side favorites, palette quick actions, Use Cases entry | — |

**Acceptance criteria**
- No navigation wrapping at 1280 px width.
- Every module and sub-tab reachable by URL; Back/Forward works.
- Flyout never shifts content layout.
- Running jobs visible from any page.
- All existing `setView(...)` call sites keep working.

---

## 📜 Revision History

| Date | Stigix Version | Author / Trigger | Summary of Changes |
|---|---|---|---|
| 2026-10-11 | `v2.2.12` | Stigix Core Team (review) | Clarified scope (navigation shell only, module content unchanged); removed Flow Browser (not existing); Fleet entry rendered on Leader only; Settings promoted to a first-class domain with a grouped flyout deep-linking its 11 existing tabs. |
| 2026-10-11 | `v2.2.12` | Stigix Core Team (design review) | Switched recommendation to a Strata Cloud Manager-style icon rail with overlay flyouts; rejected domain ribbons (height cost, 3 stacked tab levels); corrected taxonomy (added Home, Use Cases, Fleet; Copilot & Settings as global utilities; Flow Browser marked future); added Favorites, hash deep-linking, running-job indicators, and command palette specs. |
| 2026-10-11 | `v2.2.9` | Stigix Architecture Team | Initial PRD: Navigation architecture study, comparison of Horizontal Domain Ribbons vs Vertical Sidebar, and definition of the 5-pillar functional taxonomy. |
