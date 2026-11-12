---
name: stigix-ux-standards
description: >
  Ergonomic, visual hierarchy, and diagnostic UX standards for the Stigix Web Dashboard (web-dashboard/src/*.tsx).
  Defines the 4 Gold Standard UI Archetypes (PacketCapture, Voice/CustomApps, Topology, Fleet/Settings) and the
  5 Universal Cross-Module Rules (13-inch MacBook Air single-line tables, progressive disclosure, non-speculative
  diagnostics, role-specific badges, and zero button repetition). Read this skill whenever designing, creating, or
  polishing any Stigix UI module or diagnostic view.
---

# Stigix UX & Ergonomic Standards

> [!IMPORTANT]
> **User Override Priority**: These standards serve as the default baseline to accelerate first-pass UI and diagnostic implementation. **Any explicit instruction or preference expressed by the user in the conversation always overrides the rules in this skill.** If the user asks to change a pattern globally, update this `SKILL.md` file accordingly.

---

## 1. The 4 Gold Standard UI Archetypes in Stigix

Whenever building a new feature or refactoring an existing tab, identify which of the 4 Stigix archetypes it belongs to and mirror its reference implementation:

### Archetype A — Interactive Diagnostic & Trace Composer
- **Gold Standard Reference**: [`web-dashboard/src/PacketCapture.tsx`](../../web-dashboard/src/PacketCapture.tsx) (*E2E Flow & Path Trace*)
- **When to use**: On-demand network/security diagnostics, CLI inspectors, path tracers, policy evaluators, speedtests (**VyOS Live Inspector**, **Packet Capture**, **ChangeGuard**, **Speedtest**, **Connectivity Performance**).
- **Structural Pattern**:
  1. **Sober Module Header**: Icon + Module Title + Mode Switcher (`Local | E2E Trace`) + at most 1 discrete global history button (`Captures`). Never mix execution parameters or file export buttons into the top title bar.
  2. **Linear Action Composer (`FROM → TO → TEST → RUN`)**:
     - Left-to-right reading order: `Source / Device` $\rightarrow$ `Target / Filter` $\rightarrow$ `Protocol / Parameters` $\rightarrow$ `Short Primary Action Button` (e.g., `Run trace`, `Inspect`).
     - Protocol-aware inputs: if `ICMP` or a parameterless mode is selected, display `Not applicable` in irrelevant fields (like `Port`) instead of `0`, while preserving the previous TCP/UDP port in React state when switching back.
  3. **Secondary Bar (Compact Favorites + Collapsible `Advanced options ▸`)**:
     - **Favorites**: Short 1–2 word pills (`DC1 App`, `OnPrem App`, `O365 via DC2`) with full details in `title` hover tooltips, highlighted **only** while the current form inputs match that favorite.
     - **`Advanced options ▸` Drawer**: Hide secondary knobs (collection mode, optional source IP, custom timeouts) by default behind a toggle button, paired with an always-visible summary pill on the right (`Probe + PCAP · Source IP: Auto`). Auto-expand if the user selects a mode that requires an advanced field.
  4. **3-Level Synthesis Banner**:
     - **Level 1 (Primary Outcome)**: High-contrast verdict badge (`REPLY RECEIVED`, `NO RESPONSE`, `BLOCKED BY ZBFW`) + bold 1-line factual headline.
     - **Level 2 (Observed Path / State Summary)**: Concise sentence naming the exact equipment and paths where evidence was observed.
     - **Level 3 (Scope / Boundary Callout)**: Single-line muted pill in normal cases (`Reply verified at source · No destination capture`), or an amber callout box when an anomaly or partial visibility occurs.
  5. **Continuous Master-Detail Progression (`●──────●──────●──────●`)**:
     - Use a geometrically continuous horizontal progression track (`-mx-1.5` inside `gap-3` grids) where a connector segment is solid green **only** when both endpoints of that segment are confirmed.
     - Pair the lightweight selectable node cards with a **single Selected Point Detail panel** below rather than displaying 4 dense metric cards simultaneously.
  6. **Tabbed Evidence Workspace + Contextual Artifact Actions**:
     - Never stack multiple large tables vertically. Group raw evidence into tabs (`Captured Packets` | `vION Flow Records` | `Collection & Limits`) and attach file/artifact actions (`Download`, `Replay`, `Export`) directly to the right side of the evidence tab bar.

---

### Archetype B — Live Traffic Generator & Single-Line Telemetry Matrix
- **Gold Standard Reference**: [`web-dashboard/src/Voice.tsx`](../../web-dashboard/src/Voice.tsx) & [`web-dashboard/src/CustomApps.tsx`](../../web-dashboard/src/CustomApps.tsx)
- **When to use**: Continuous traffic generators, real-time stream monitors, target matrices (**Voice RTP**, **Custom Apps**, **Multicast**, **SaaS Traffic**, **IoT**, **Security Threat Suite**).
- **Structural Pattern**:
  1. **Ultra-Compact Global Telemetry Ribbon**: Top summary ribbon showing aggregate active streams, TX/RX rates, and health score without taking vertical screen real estate.
  2. **Single Section-Header Batch Action**: Place batch actions (e.g., `Inspect Paths` / `Refresh Paths`, `Start All`) **once** in the section header rather than repeating action buttons inside every stream card or table row.
  3. **Clean Live Stream Cards**: Show real-time metrics (MOS, RTT, Jitter, Loss) and a full-width resolved path badge at the bottom of the card without button clutter.

---

### Archetype C — Multi-Layer Interactive Canvas & Spotlight Drawer
- **Gold Standard Reference**: [`web-dashboard/src/Topology.tsx`](../../web-dashboard/src/Topology.tsx)
- **When to use**: Network graphs, overlay/underlay visualizations, SASE PoP maps.
- **Structural Pattern**:
  1. **Floating View Switcher Dock**: Clean mode tabs (`WAN Transport`, `SD-WAN Mesh`, `SASE Fabric`, `VyOS Ports`).
  2. **Zero-Jump Edge/Node Spotlighting**: Clicking a node, carrier, or circuit dims unselected background elements in place (0ms canvas displacement) and opens a contextual right-side telemetry drawer.
  3. **13-Inch Laptop Viewport Auto-Fit**: Support `minZoom` down to `0.12`, auto-fit on resize, and a 1-click Auto-Fit toolbar button.

---

### Archetype D — Fleet & Asynchronous Job Orchestration
- **Gold Standard Reference**: [`web-dashboard/src/Fleet.tsx`](../../web-dashboard/src/Fleet.tsx) & [`web-dashboard/src/Settings.tsx`](../../web-dashboard/src/Settings.tsx)
- **When to use**: Multi-node management, remote upgrades, config bundle synchronization.
- **Structural Pattern**:
  1. **Transparent Control-Plane Badges**: Display explicit WebSocket directionality (`↘️ INBOUND WS` / `↗️ OUTBOUND WS`), color-coded live RTT (`⚡ 12ms`), and human sync timestamps (`HH:mm:ss · Xm ago`).
  2. **Parallel Fleet Action + Multi-Stage Progress Modal**: Provide a single header action (`⚡ Upgrade All Remote Nodes`) with a 4-stage visual progress tracker (`Pulling → Recreating → Healthcheck → Ready`), live log console, and automatic reconnect radar.

---

## 2. The 5 Universal Cross-Module Ergonomic Rules

Apply these 5 rules across **all** Stigix screens and components:

### Rule 1 — MacBook Air 13-Inch (`1280px`) Single-Line Table Discipline
- Every data table must fit cleanly on a 13-inch laptop screen (`~1280px` viewport minus navigation rail) **without mid-cell line wrapping**:
  - Always apply `whitespace-nowrap` on tables (`<table className="w-full text-left border-collapse whitespace-nowrap">`).
  - Keep column count to **$\le 9$ columns** by merging closely related fields:
    - Combine `Path Policy` and `QoS Policy` into **`Path / QoS Policy`** (if both have the same value, e.g. `enterprise-default`, render it once: `netPol === qosPol ? netPol : `${netPol} / ${qosPol}``; show full breakdown in `title`).
    - Combine `Security Action` (`ALLOW`/`DENY` badge) and `Security Rule Name` into a single **`ZBFW Security`** cell.
  - Abbreviate long machine identifiers inline (e.g., `WANPATH …022645` instead of a 19-digit integer, or `Inherited (Ingress)` instead of `unknown (Ingress Enforced)`) and place the full string in the `title` tooltip.

### Rule 2 — Epistemic Honesty in Diagnostics (Evidence-Based Verdicts Only)
- Never display speculative root-cause assertions (`DROP AFTER HUB`, `RETURN PATH FAILURE`, `DESTINATION UNREACHABLE`) when only an absence of reply is observed.
- Always distinguish:
  1. **What was observed** (`Packets captured (8 TX / 0 RX)`, `Matching flow found on BR8 and DC1-R1`).
  2. **Where visibility stops** (`Last confirmed flow observation: DC1-R1. Failure location not determined`).
  3. **Suggested checks** (`Suggested checks: hub egress, downstream firewall, or return routing` — phrased strictly as troubleshooting hypotheses, never as established facts).
- Only attach known service labels (e.g., `Microsoft 365`, `OnPrem App 8085`) when **both** the target IP/domain **and** the protocol/port match.

### Rule 3 — Role-Specific & Protocol-Aware Status Badges
- Avoid repeating a generic `OBSERVED` badge on every hop or component. Use the verb that matches the instrument's role:
  - Source Probe / Packet Capture: **`CAPTURED`** (or **`PASSIVE`**)
  - Router / ION Flow Table: **`FLOW MATCHED`** (or **`NO MATCH`**)
  - Direct Internet Breakout: **`LOCAL BREAKOUT`**
  - IPsec / ServiceLink Tunnel: **`TUNNEL UP`**
  - Remote Destination: **`REPLY RECEIVED`** (when return traffic is verified) or **`NO RESPONSE`**
- Make correlation badges protocol-accurate (`EXACT FLOW MATCH (5-TUPLE)` for TCP/UDP vs `EXACT FLOW MATCH (ICMP)` for ICMP, with a `title` tooltip explaining the exact matched fields).

### Rule 4 — Progressive Disclosure & Visual Breathing Room
- Keep only the 3–4 primary controls visible by default; tuck secondary or expert options into a collapsible drawer (`Advanced options ▸`) with a persistent 1-line summary pill.
- Avoid micro-text overload: limit any summary card to **3 information levels** (Role/Status, Equipment/Target Name, 1-line State Summary + discrete footer). Push raw counters, CLI commands, and technical flags into the detail panel or hover tooltips.

### Rule 5 — Strict Stigix Design System Reuse
- Always reuse `StigixSelect` (`web-dashboard/src/components/common/StigixSelect.tsx`) — never introduce native `<select>` elements.
- Use semantic theme variables (`bg-card`, `bg-card-secondary`, `border-border`, `text-text-primary`, `text-text-secondary`, `text-text-muted`) and the standard status palette (`emerald` = verified/allow, `cyan` = path/telemetry, `indigo`/`purple` = primary action/App-ID, `amber` = no response/partial visibility, `rose` = blocked/error).
