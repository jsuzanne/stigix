# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.3] - 2026-09-02

### Added / Changed
- **Zero-Touch Provisioning (ZTP) Client Auto-Start** ⚡: Added an automated `startup.startClientWorkload` toggle in the Custom Application Wizard (Step 3 & 4). When enabled on the central Leader, remote peer branches immediately start generating synthetic client traffic against configured datacenter servers upon syncing or booting without requiring any manual intervention.
- **Target Capability `custom_app`** 🏷️: Added official `custom_app` capability to Stigix node heartbeat advertisements, merged target synthesis, and Target cards, allowing automatic tagging of nodes capable of hosting and answering Custom TCP workloads.
- **Interactive On-Demand Target Connection Test** 📡: Added a quick diagnostic test action (`Activity` button) on all target cards in Settings, running real-time multi-protocol diagnostics (ICMP Ping RTT, HTTP Stigix Node detection & site info, and active service reachability) with instant visual badges and notifications.
- **Documentation & Website Portal Refresh** 🌐: Updated `stigix.io` FAQ and `CUSTOM_TCP_APPS.md` with Zero-Touch Auto-Start architecture, orchestration guidelines, and automated workflow recipes.

---

## [2.0.2] - 2026-09-02

### Added / Changed
- **Custom TCP Apps Smart Merge** 🔄: Pulling global provisioning bundles from the Leader now automatically preserves local peer targets, local application profiles, and instance identities configured on the peer node without overwriting them.
- **Global Provisioning Resilient Checksums** 🛡️: Implemented multi-algorithm backward-compatible checksum validation (modern sanitized, legacy sorted-key, and raw payload hashes) resolving sync checksum mismatches on legacy published revisions.
- **Navigation & Settings Refinement** 🧭: Renamed "IoT Simulation" to "IoT", repositioned "Custom Apps" directly after "Voice" in the main navigation bar, and ordered tabs in Settings (`Synthetic Probes` ➔ `Custom TCP Apps` ➔ `Failover`).
- **Workload & Server Behaviors Reference** 📚: Added comprehensive reference tables and deep-dive documentation for all 5 client traffic patterns and 8 server simulation behaviors in [`docs/CUSTOM_TCP_APPS.md`](./docs/CUSTOM_TCP_APPS.md).

---

## [2.0.1] - 2026-09-02

### Fixed
- **Onboarding & Install URLs** 🔗: Updated all remote peer onboarding commands and quickstart script references across the UI dashboard (`Settings.tsx`), CLI (`stigix-cli.py`), installer (`install.sh`), and website documentation to pull from the official `main` branch instead of `v2`.

---

## [2.0.0] - 2026-09-02 — Stigix V2 Official Release

### Summary of Major V2 Capabilities
* **Custom TCP Inter-Site Applications** 🔄: Multi-application East-West simulation engine, binary length-prefixed protocol, 8 server simulation modes, 5 client workload patterns with exponential backoff & jitter, live session inspectors, and rolling RTT percentiles ($p50/p95$).
* **Central Global Provisioning & Config Bundles** 🌐: Leader-to-peer distribution of 8 configuration bundles (Custom Apps, Applications, Probes, SLA Thresholds, Security Schedules, Voice, IoT, Prisma SASE Credentials) with fine-grained diff tracking, instant hot-reload, and CLI management.
* **Direct Controller Peer Onboarding** 🔗: Single-command Linux onboarding (`--controller <URL>`) bypassing third-party discovery, dynamic target synthesis on Leader nodes, and robust heartbeat resilience.
* **Physical Underlay & Multi-Router VyOS Chassis** 🖧: High-density chassis canvas component, direct 1:1 port cable wiring, anti-crossing spatial interface alignment, and floating link trace inspector drawer.
* **stigix-cli V2 Management Suite** 🎛️: Added interactive `tcp-app`, `provision`, and `controller` command suites with full tab completion.
* **Refreshed Global Showcase & FAQ Portal** 🌍: Modernized [stigix.io](https://stigix.io) with V2 architecture, enterprise use cases, onboarding quickstart, and comprehensive FAQ documentation.

---

## [v1.4.1-patch.43] - 2026-09-02
### Added / Changed
- **Stigix Custom TCP Inter-Site Applications** 🔄:
  - **Dual Server / Client Architecture**: Every Stigix instance can run multiple custom TCP application workloads simultaneously, acting both as a host TCP listener and an outbound client workload generator.
  - **4-Byte Length-Prefixed Streaming Protocol**: Binary `UInt32BE` length framing parsing frames reliably through stream fragmentation, buffer splitting, and concatenation.
  - **Server Chaos & Behavior Simulation**: Implemented 8 rich server simulation modes (`echo`, `acknowledge`, `fixed_delay`, `random_delay`, `looping_delay`, `drop_response`, `close_connection`, `error_response`).
  - **Client Workload Modes**: 5 workload generation modes (`persistent_request_reply`, `transactional`, `heartbeat`, `bulk_burst`, `continuous_stream`) with bounded exponential backoff & full jitter (1s–30s).
  - **Security & Access Control**: IPv4 CIDR allowlisting (`allowCidrs`), mandatory 5s handshake timeout (`CLIENT_HELLO` $\rightarrow$ `SERVER_HELLO`), and pre-shared token authentication.
  - **Dedicated "Custom Apps" Navigation View & Operational Control Center**: Real-time traffic overview cards, rolling RTT percentile metrics ($p50, p95, \text{min}, \text{avg}, \text{max}$), live incoming client sessions table (Declared Site ID vs Socket Remote IP), and outgoing workload monitor.
  - **4-Step Application Creation & Edition Wizard**: Interactive modal wizard covering Identity & Listener, Server Simulation, Client Workload & Peers, and Review with non-destructive live host port availability test.
  - **Central Global Provisioning Integration (8th Bundle `custom-tcp-apps`)** 🌐: Create and edit custom applications once on the Leader, publish changes with fine-grained diff tracking, and automatically distribute and hot-reload listeners and peer workloads across all connected branch nodes (`provision publish custom-tcp-apps`).
  - **Settings Configuration Tab**: Added Custom TCP Apps tab under Settings for full application profile lifecycle management (CRUD, duplicate, JSON export/import).
  - **stigix-cli Support (`tcp-app` / `custom-app` / `app`)**: Comprehensive CLI commands for `list`, `status`, `start-listener`, `stop-listener`, `start-client`, `stop-client`, `test`, `sessions`, and `reset-metrics`.
  - **Complete Technical Documentation**: Added [`docs/CUSTOM_TCP_APPS.md`](file:///Users/jsuzanne/Github/stigix/docs/CUSTOM_TCP_APPS.md).

## [v1.4.1-patch.42] - 2026-09-02
### Added / Changed
- **Underlay Topology & Multi-Router Physical Chassis** 🖧:
  - **`VyOSRouterNode` Component**: Multi-tier chassis layout on topology canvas with DC/Hub uplinks on top row, Branch/Spoke downlinks on bottom row, and management banner (hostname, management IP, live status, circuit count).
  - **Direct 1:1 Port Cable Wiring** 🔌: React Flow handles on individual port chips (`vyos-port:ethX`) connect directly to Prisma SD-WAN WAN circuits with animated amber edges.
  - **Anti-Cable-Crossing Spatial Routing** 📐: Interfaces sorted dynamically by connected site X-coordinates (left-to-right matching DC1, DC2, BR1, BR2, BR3) and link types (INET before MPLS) for straight, parallel cables.
  - **Full IP CIDR Visibility** 🏷️: Port chips show complete IP CIDR alongside interface name, status LED, site badge, and description.
  - **Interactive Floating Link Trace Drawer** 🔍: Side-by-side verification comparing Prisma ION circuit parameters, transit CIDR subnet, and VyOS next-hop IP with a one-click button to open the full diagnostics side panel.
  - **Theme Support** 🌓: Full light and dark mode styling across all chassis cards, port chips, and inspector drawers.
  - **Dynamic External Cloud Spacing** ☁️: Dynamic router width calculation ensures `cloud:EXTERNAL` is positioned safely without overlapping chassis elements.
- **stigix-cli Central Global Provisioning (`provision` / `provisioning` / `prov`)** 🌐:
  - `provision on / off / enable / disable`: Turn Global Provisioning pull mode on or off.
  - `provision status`: View Global Provisioning state and a table of all 7 configuration bundles (Applications, Probes, SLA, Security Policies, Voice, IoT, Prisma SASE) with published revisions, locally applied revisions, item counts, and pending diffs.
  - `provision publish [type|all]`: Publish local configurations to all registered peers with change summaries (`+added -removed ~modified`).
  - `provision rollback <type> <revision>`: Rollback a bundle to an earlier revision and redistribute.
  - `provision history` & `provision pending`: Audit trail of distributions and list of unpublished local changes.
- **stigix-cli Target Controller & Leader Registry (`controller` / `registry` / `leader`)** 🎛️:
  - `controller status`: View node role (👑 Hybrid Leader vs 🔗 Remote Peer), site name, detected IP, discovery mode, active Leader, and registered peer count.
  - `controller peers`: List all connected remote branch nodes with IP, capabilities, last heartbeat, and status.
  - `controller set-leader <ip|url>`: Point node to a central Leader with automatic HTTP handshake testing.
  - `controller autodiscover`: Revert to Cloudflare dynamic peer autodiscovery.
  - `controller test <url>`: Test connectivity and latency to a remote Leader.
  - `controller site-name [name]`: View or update local node site name in the registry.
  - `controller onboard-command`: Output ready-to-run curl one-liner to onboard remote Linux peer nodes.
- **stigix-cli Status Enhancement** 📊:
  - Integrated Controller role and Global Provisioning state directly into the `status` overview card.
  - Full tab auto-completion support for all new commands and sub-verbs.
- **Documentation Updates** 📖:
  - [`docs/UNDERLAY_TOPOLOGY.md`](file:///Users/jsuzanne/Github/stigix/docs/UNDERLAY_TOPOLOGY.md), [`docs/STIGIX_CLI.md`](file:///Users/jsuzanne/Github/stigix/docs/STIGIX_CLI.md), and [`README.md`](file:///Users/jsuzanne/Github/stigix/README.md) updated.

## [v1.4.1-patch.41] - 2026-08-05
### Added / Changed
- **Security.tsx** 🛡️ **Inline EICAR Verdict Badges**: Added `getEicarResult` helper and inline status badges (`✓ Blocked` / `⊗ Allowed` / `⚠ Unreachable`) directly inside each EICAR target card row and custom URL section.
- **Security.tsx** ⚡ Clicking the Play `▶` button on an individual EICAR target now immediately updates and displays its verdict badge in the widget (matching URL Filtering and DNS Security UI).

## [v1.4.1-patch.40] - 2026-07-30
### Added / Changed
- **ConnectivityPerformance.tsx** 🎨 Replaced Pause/Play action button with a **Pencil Edit** button (`<Pencil size={16} />`) on each probe row in the Digital Experience list.
- **ConnectivityPerformance.tsx** ✨ **In-place Probe Edit Modal**: Clicking the pencil icon opens a modal directly from the Digital Experience view to edit probe parameters (Name, Protocol, Target URL/IP, Timeout, Frequency, and Content Matching options).
- **ConnectivityPerformance.tsx** 💡 Clicking anywhere else on the probe row continues to open the telemetry details modal.

## [v1.4.1-patch.39] - 2026-07-30
### Added
- **ConnectivityPerformance.tsx** ✨ **Option A — Ghost pending probes**: probes added in Settings appear immediately in the Digital Experience list with a `⏳ PENDING` badge and a slow-spinning icon. They show `—` for Score/Latency/Reliability until the first result arrives, then automatically transition to a normal row.
- **server.ts** ✨ **Option B — Immediate first check**: after `POST /api/connectivity/custom`, newly added probes (not previously in the config) are checked immediately in a non-blocking `setImmediate` async loop. `lastRunMap` is pre-set to prevent double execution on the next 10s tick. First result should be available in ~5-10s after save.
- **ConnectivityPerformance.tsx** 🔧 Empty-state text updated to reflect type-aware default frequencies.

### Fixed / Cosmetic
- **ConnectivityPerformance.tsx** 🎨 Merged HTTP Code and Match columns into a single inline column.
  - Header: `HTTP Code` when no content_match, `HTTP · Match` when enabled.
  - Cell: `200 ✓ matched` / `200 ✗ text not found` on a **single line** using `flex items-center gap-1.5 flex-nowrap`.
  - Removed the separate Match column that caused horizontal overflow and cut-off text.
  - HTTP Code badge uses `shrink-0` to never compress; match text uses `whitespace-nowrap shrink-0`.
  - Header is now `whitespace-nowrap` so "HTTP · Match" never wraps to 2 lines.

## [v1.4.1-patch.37] - 2026-07-30
### Fixed
- **ConnectivityPerformance.tsx** 🐛 **Root cause fix**: `content_match` from probe config was never added to the `endpoint` object built by the `useMemo`. As a result `selectedEndpoint.content_match` was always `undefined`, making the banner, Match column and HTTP Code annotation invisible. Fixed by adding `content_match: config?.content_match` to the endpoint object. No new data fetching required — `endpointConfigs` already loaded full probe config including `content_match`.
- **Settings.tsx** 🐛 2 remaining `setNewProbe({ frequency: 60 })` occurrences corrected to `frequency: 300` (patch.36 only fixed the `useState` initial value but missed the reset-after-save and the "Add New" card click handlers).

## [v1.4.1-patch.36] - 2026-07-30
### Fixed / Changed
- **Settings.tsx** 🔧: Changed default probe frequency from 60s to **300s** (5 min) to match the realistic effective polling interval. Added "default 300" label hint in the form. Fallbacks in onChange also updated.
- **server.ts** ⚡: Reduced content_match body curl timeouts (`--max-time 5 → 3`, `--connect-timeout 5 → 3`, `getTimeoutCmd(8) → 4`, `--max-filesize 51200 → 10240`). Reduces per-probe content-match overhead from up to 13s to up to 7s, improving sequential queue throughput.
- **stigix-cli.py** 🔧: `probes add` now defaults to `frequency: 300`. Added `--freq` / `--frequency` flags. Confirmation message includes `--freq` value.

## [v1.4.1-patch.35] - 2026-07-30
### Fixed / Improved
- **Digital Experience / Content Match visibility** 🎨 `ConnectivityPerformance.tsx`: Added a prominent info banner below the probe modal header showing mode, expected text, case sensitivity, and last match result (✓/✗ + reason). Banner color: green when matched, red when failed, violet when waiting for first result.
- **Digital Experience / HTTP Code disambiguation** 🎨 `ConnectivityPerformance.tsx`: HTTP Code column now shows `match ok` / `match fail` annotation below the HTTP code when content matching is active — makes it unambiguous that `200 / match fail` means HTTP succeeded but content check failed (score forced to 0).
- **CLI / probes add** ✨ `stigix-cli.py`: Added interactive content_match prompts for HTTP/HTTPS probes: "Enable content matching?", mode (contains/not_contains), expected text, case sensitive. Stored in probe JSON.
- **CLI / probes list** 👁 `stigix-cli.py`: Added "Content Match" column showing mode + expected text (truncated) when content_match is enabled.
- **CLI / probes stats** 👁 `stigix-cli.py`: Added "Content Match" column with last result (✓ matched / ✗ reason / ? no data) per probe.
- **connectivity-logger.ts** 🔧: Added `content_match_enabled`, `content_match_mode`, `content_match_value`, `content_match_result`, `content_match_ok` to `ConnectivityResult` interface so these fields are properly persisted and returned in results history. This was the root cause of the Match column not appearing in Recent Captures.

## [v1.4.1-patch.34] - 2026-07-30
### Added
- **Digital Experience / Synthetic Probes** ✨ `server.ts` + `Settings.tsx` + `ConnectivityPerformance.tsx`: Added optional **HTTP/HTTPS content matching** feature. When enabled on a probe, a bounded body fetch (50 KB cap, 5 s timeout) verifies the response contains or does not contain a specified text string. Timing metrics (DNS/TCP/TLS/TTFB) are completely unaffected — the body fetch uses a separate curl call. Score is forced to 0 on match failure. New observability fields: `content_match_enabled`, `content_match_mode`, `content_match_value`, `content_match_result`, `content_match_ok`. Backward-compatible — probes without `content_match` block are unchanged. 🔍
- **Digital Experience UI** 🎨 Probe detail modal now shows a **✦ Content Match** badge next to the probe type badge when matching is active. Recent Captures table gains a **Match** column (✓/✗ + reason) for content-match probes.
- **FAQ** 📖 `site/faq.html`: Added Digital Experience content matching Q&A covering setup steps, modes, observability fields, backward compatibility, and typical use cases.
- **FAQ** 📖 `site/faq.html`: Added 3 new Digital Experience Q&As: dashboard panels overview (Global Experience / Score Trend / Flaky Probes), DNS/TCP/TLS/TTFB timing breakdown with SASE-specific interpretation tips, and Prisma SD-WAN probe auto-discovery.
- **FAQ** 📖 Fixed 3 UI label mismatches across Settings tabs: `Download Config → Export`, `Settings → Network → Settings → System Info → Network Interfaces`, `Add Target → Add Stigix Target`.

## [v1.4.1-patch.33] - 2026-07-29
### Fixed
- **CLI & Security API** 🐛 `stigix-cli.py` & `server.ts`: Fixed HTTP 400 error in `security eicar` CLI command. Updated `/api/security/threat-test` to accept both `endpoint` and `endpoints` parameters, and aligned CLI payload key. 🛡️

## [v1.4.1-patch.32] - 2026-07-29
### Fixed
- **web-dashboard** 🎨 `Security.tsx`: Fixed unselected EICAR row title color — changed from `text-text-primary` (white) to `text-text-secondary` (grayed) to match URL Filtering and DNS Security unselected row styling.

## [v1.4.1-patch.31] - 2026-07-29
### Fixed
- **web-dashboard** ✅ `Security.tsx`: Fixed EICAR checkbox appearance — replaced `CheckCircle` icon (rendered as a circle) with `Check` icon (`strokeWidth={3}`) to match the standard checkbox checkmark used in URL Filtering and DNS Security sections. Added `Check` to lucide-react imports.

## [v1.4.1-patch.30] - 2026-07-29
### Changed
- **web-dashboard** 🎨 `Security.tsx`: Redesigned EICAR section for visual consistency with URL Filtering and DNS Security sections — replaced red background (`bg-red-500/10`) with neutral `bg-card-secondary`, changed checkboxes from red to blue, removed red tint on selected row titles. Warning icon updated to amber (like other alert icons). Selection state now uses a subtle blue highlight matching the rest of the UI.

## [v1.4.1-patch.29] - 2026-07-29
### Fixed
- **web-dashboard** 🔧 `Security.tsx`: Fixed EICAR target row buttons not being visible — removed `opacity-0 group-hover:opacity-100` and made Copy 📋 and Play ▶ buttons always visible, consistent with the URL Filtering section. Also moved the status dot before the action buttons and added a per-row Copy button to copy the `curl` EICAR command for each target.

## [v1.4.1-patch.28] - 2026-07-29
### Added
- **web-dashboard** ▶️ `Security.tsx`: Added an individual **play button** on each EICAR target row (Stigix Cloud Worker and dynamic targets). The button appears on hover and launches the EICAR test for that single target without affecting the multi-target selection. A spinner replaces the play icon while the test is running, and all other play buttons are disabled during a run to prevent concurrent tests.

## [v1.4.1-patch.27] - 2026-07-28
### Fixed
- **web-dashboard** 🛡️ Awaited asynchronous `addTestResult` calls in security test loops and endpoints (URL, DNS, and Threat tests) to resolve a race condition that caused `generateRunScore` to calculate scores before the results were fully saved. This fixes the "NO DNS DATA" display issue.

## [v1.4.1-patch.26] - 2026-07-08
### Changed
- **web-dashboard** 🖱️ `Speedtest.tsx`: Made each row in the Bandwidth Test History table fully clickable to open the Test Details modal — `onClick` moved to the `<tr>` element with `cursor-pointer`. The `ExternalLink` icon column is now a visual indicator (passive `div`) that highlights on row hover, reinforcing the clickable affordance without requiring a precise click on the button.

## [v1.4.1-patch.25] - 2026-07-08
### Changed
- **web-dashboard** 🎨 `Speedtest.tsx`: Redesigned Test Details modal for a more compact, information-dense layout. Reduced modal width (`max-w-2xl` → `max-w-lg`), replaced isolated large-text cards with a compact 3×2 inline param grid (Protocol / Duration / Streams / DSCP / Src Port / Jitter|Congestion), refactored Data Transfer and Loss Analysis sections into smaller `text-sm` column grids with section headers and dividers. Integrated close button directly into the header bar instead of absolute positioning. Removed verbose `text-3xl font-black` values that were visually overscaled relative to the modal content.

### Documentation
- **docs** 📖 `docs/VYOS_CONTROL.md`: Added `🔍 Troubleshooting VyOS HTTP-API` section documenting the `service https api unavailable at this proxy address` error — context, symptoms, probable cause (unstable internal state after uptime or partial config change), 5-step resolution (verify config → clean API keys → `sudo systemctl restart vyos-http-api.service` → check logs → retry from Stigix), and lab best practices.

## [v1.4.1-patch.24] - 2026-06-16
### Fixed
- **web-dashboard** 🎨: Added `whitespace-nowrap` class to the Time column in the probe captures table inside Connectivity Performance view to prevent dates/times from wrapping to two lines.

## [v1.4.1-patch.23] - 2026-06-16
### Changed
- **web-dashboard** 🚀: Updated the "Target / Params" column in the Speedtest history table to display additional test parameters (bitrate, duration, parallel streams, and client source port) if set.

## [v1.4.1-patch.22] - 2026-06-16
### Fixed
- **MCP / VyOS** 🤖: Fixed Claude picking wrong Stigix node as VyOS controller. Removed hardcoded `Raspi4-Ubuntu` example from `list_vyos_routers` docstring that caused Claude to default to that node. Removed misleading `BR1-Ubuntu` example from `list_vyos_scenarios`. Added a `CONTROLLER DISCOVERY` section to `get_vyos_interfaces` explaining the central-controller topology (one Stigix node manages the underlay VyOS router with all-branch WAN interfaces) and the step-by-step discovery workflow Claude must follow before acting.
- **MCP / VyOS** 🤖: Updated correct workflow in `get_vyos_interfaces` to require controller identification before calling the tool, with clear precedence rules (user-stated > session-established > auto-discover via `list_vyos_routers` on candidates > ask user).

### Added
- **Testing** 🧪: New targeted test plan `mcp-server/Exemple/VyOS_Controller_Discovery_Test.md` with 10 specific test cases validating the VyOS controller discovery fix and regression coverage.

## [v1.4.1-patch.21] - 2026-06-15
### Changed
- **web-dashboard** 🎨: Made the "Distribution Overview" panel collapsible in the Traffic Distribution tab of Settings to save vertical space.
- **web-dashboard** 🎨: Removed the "Probe Icons Legend" widget from the Probes tab in Settings to declutter the dashboard.

## [v1.4.1-patch.20] - 2026-06-15
### Refactored
- **web-dashboard** 🎨: Simplified the Connectivity Performance UI by removing "Show Deleted" and "Show Inactive" filters.
- **web-dashboard** 🔄: Moved the "Sync Prisma SD-WAN" trigger from Connectivity Performance view to the Probes tab in Settings next to EXPORT and IMPORT.

## [v1.4.1-patch.19] - 2026-06-15
### Changed
- **web-dashboard** 🌐: Improved Public IP detection in the top Network Status bar by prioritizing the Cloudflare Stigix Target worker (`egress-info` probe) for better reliability and zero rate-limiting.
- **web-dashboard** 🌐: Implemented a robust fallback to `ipapi.co` when Cloudflare is unconfigured, unreachable, or missing authentication credentials.

## [v1.4.1-patch.18] - 2026-06-15
### Added
- **web-dashboard** ✨: Added a new "Registry Role Override" UI in the Target Controller Dashboard to force a node's discovery role without needing to restart containers or edit `.env`.
### Documentation
- **docs** 📖 `HYBRID_REGISTRY.md`: Updated step-by-step implementation guide to reflect the new UI-driven approach for configuring registry roles.

## [v1.4.1-patch.17] - 2026-06-15
### Changed
- **web-dashboard** 🎨: Added a top margin to the Score Trend chart section in the modal for better visual spacing.

## [v1.4.1-patch.16] - 2026-06-15
### Changed
- **web-dashboard** 🎨: Updated Prisma SASE Integration settings to reflect SD-WAN capabilities and removed the Global Security Context block.

## [v1.4.1-patch.15] - 2026-06-14
### Changed
- **web-dashboard** 🎨: Renamed the PRISMA filter label to PRISMA SDWAN in the Connectivity Performance view.

## [v1.4.1-patch.14] - 2026-06-14
### Changed
- **web-dashboard** 🎨: Standardized top row dashboard headers to be visually aligned and identical in styling.

## [v1.4.1-patch.13] - 2026-06-14
### Changed
- **web-dashboard** 🎨: Unified Global Experience, Score Trend, and Flaky Probes into a single cohesive UI top panel to improve dashboard aesthetics.

## [v1.4.1-patch.12] - 2026-06-14
### Changed
- **web-dashboard** 🎨: Adjusted Connectivity Performance layout by increasing chart height, replacing "Endpoint" terminologies with "Probe", and updating modal component titles. Removed discovery parameters view from Prisma SD-WAN probes.

## [v1.4.1-patch.11] - 2026-06-14
### Changed
- **web-dashboard** 🎨: Compacted the Connectivity Performance layout: merged Global Score and Trend into a single card, removed HTTP coverage widget, moved Flaky endpoints to the right, and placed Performance Trends in a single line.

## [v1.4.1-patch.10] - 2026-06-14
### Changed
- **web-dashboard** 🎨: Replaced visual occurrences of `CLOUD` with `STIGIX CLOUD` and `Stigix Cloud Target` with `Stigix Cloud` in the Connectivity Performance and Settings views.

## [v1.4.1-patch.9] - 2026-06-14
### Security
- **server.ts** 🔒 Added `authenticateToken` middleware to 8 previously unauthenticated API routes (proactive fix following responsible disclosure report):
  - `GET /api/config/cloud` — exposed masterKey and registry baseUrl
  - `POST /api/traffic/start` and `POST /api/traffic/stop` — traffic control without auth
  - `GET /api/config/applications/export` and `POST /api/config/applications/import` — config read/write
  - `GET /api/config/interfaces` and `POST /api/config/interfaces` — network interface config
  - `GET /api/logs` — raw traffic log access
  - No functional impact: CLI (`stigix-cli.py`) and MCP server (`agent_client.py`) already send JWT Bearer tokens on all requests.

## [v1.4.1-patch.8] - 2026-06-12
### Changed
- **web-dashboard** 🧹 `Settings.tsx` Prisma SASE API tab: Removed the "Region" select dropdown from the UI. Default value `'americas'` is preserved in the saved JSON; backend falls back to PRD (Americas) when absent.

## [v1.4.1-patch.7] - 2026-06-12
### Changed
- **web-dashboard** 🧹 `Settings.tsx` Prisma SASE API tab: (1) Removed the standalone "Service Status" block — toggle now integrated inline in the section header (smaller, less intrusive); (2) Removed the "Auto-Enrich" dropdown (unused by backend); (3) Removed the "Sync from System" button from the UI (API endpoint preserved server-side).

## [v1.4.1-patch.6] - 2026-06-12
### Changed
- **web-dashboard** ✨ `App.tsx`: Traffic Control panel visual polish — (1) pill groups (Speed + Density) now centered horizontally (`justify-center`); (2) active pill has a subtle glow ring (blue for speed, purple for density); (3) Stop Traffic button shows an animated pulsing ring when traffic is running; (4) delay label uses ms for sub-second values (e.g. "100ms" instead of "0.1s").

## [v1.4.1-patch.5] - 2026-06-12
### Changed
- **web-dashboard** 🎛️ `App.tsx`: Replaced the two range sliders (Traffic Speed + Traffic Density) in the Traffic Control panel with compact pill button groups. Speed: Turbo (0.1s) / Fast (0.5s) / Normal (2s) / Slow (10s). Density: 1 / 2 / 3 / 5 / 10 clients. Active selection highlighted in blue (Speed) and purple (Density). Removes all slider chrome, side emojis, and redundant labels. Sub-text still shows current raw values (e.g. "0.5s delay", "x3 parallel").

## [v1.4.1-patch.4] - 2026-06-11
### Changed
- **web-dashboard** ⚙️ `Settings.tsx`: Renamed tab/menu label "Targets" to "Stigix Targets".

## [v1.4.1-patch.3] - 2026-06-05
### Added
- **web-dashboard** 🕸️ `Voice.tsx`: QoS Spider Chart modal on the Per-Target QoS Statistics table. Clicking any site row opens a centered modal with a recharts RadarChart showing 4 normalized axes (Loss, RTT, MOS, Jitter, each scored 0–100). Radar color matches quality level (blue=excellent, orange=fair, red=poor). Raw metric values displayed below the chart in a 4-column card grid. Click outside or press × to dismiss. Table unchanged.

## [v1.4.1-patch.2] - 2026-06-05
### Changed
- **web-dashboard** 🎨 `ConnectivityPerformance.tsx`: Visual polish on B2-inline probe table. Sub-stats (avg/min/max) now use `text-text-secondary` at `opacity-70` for better contrast in both light and dark mode. Latency values no longer show decimals (`1319ms` instead of `1319.0ms` — values are already integer-rounded in the memo). DonutRing stroke thinned from `4` to `2.5` and size increased from `28px` to `32px` for a more elegant ring appearance.

## [v1.4.1-patch.1] - 2026-06-05
### Changed
- **web-dashboard** ✨ `ConnectivityPerformance.tsx`: Redesigned DEM probe table columns (Score, Latency, Reliability) with the B2-inline visual treatment. Score and Latency columns now each feature an inline SVG sparkline (showing recent trend) alongside a colored pill badge (current value), plus whisper-quiet AVG·MIN·MAX sub-stats on the same row. Reliability replaced by a compact 28px SVG donut ring. Row height unchanged vs previous version. No new dependencies — sparkline and donut are pure inline SVG components. Added `minLatency` and `scoreHistory`/`latencyHistory` arrays to the endpoint aggregation memo.

## [v1.4.1] - 2026-06-05
### Changed
- **Release** 🚀 Promoted `v1.4.0-patch.156` to stable release `v1.4.1`. Triggers multi-platform Docker image build (AMD64 + ARM64) for Raspberry Pi compatibility. Includes all fixes and improvements from the `v1.4.0` patch series.

## [v1.4.0-patch.156] - 2026-06-05
### Fixed
- **web-dashboard** 🐛 `Security.tsx`: Fixed visibility of schedule toggle switches in light mode by using `bg-card-hover` instead of `bg-card` when disabled. This ensures the toggle track has proper contrast against the light container background, preventing the switch and its knob from blending in and appearing invisible. 🎨

## [v1.4.0-patch.155] - 2026-06-05
### Fixed
- **web-dashboard** 🐛 `server.ts`: Regression fix — restored missing `iface` and `ifaceFlag` variable declarations in the HTTP/HTTPS probe block (accidentally dropped in v1.4.0-patch.154 when adding retry logic). Without these, the curl command contained an undefined `${ifaceFlag}` template literal causing the HTTP/HTTPS probes to fail on non-default network interfaces.

## [v1.4.0-patch.154] - 2026-06-05
### Added
- **web-dashboard** 🌐 `server.ts` & `target-manager.ts`: Implemented dynamic retry delays and command execution timeouts for all DEM probes (HTTP, HTTPS, PING, TCP, DNS, UDP, CLOUD). Timeout wrapper limits now scale with configured endpoint timeouts, and retry delays adjust automatically (e.g. from 1s up to 5s for 60s timeouts). Also added native curl retries to HTTP/HTTPS probes. ⏱️
- **documentation** 📚 `docs/DIGITAL_EXPERIENCE_TESTING.md`: Renamed `docs/CONNECTIVITY_ENDPOINTS.md` to `docs/DIGITAL_EXPERIENCE_TESTING.md`, updated all internal links (including in `README.md`), and added a comprehensive parameters table detailing default polling frequencies, timeouts, retries, and dynamic retry delay logic. 📖

## [v1.4.0-patch.153] - 2026-06-05
### Added
- **web-dashboard** 🌐 `Vyos.tsx`: Added VyOS interface descriptions to the interface names inside both the History table logs (grouped/flat) and the Sequence list table. Also adjusted the CSS grid column width of the sequence list interface column from `90px` to `120px` to prevent text truncation. 🏷️

## [v1.4.0-patch.152] - 2026-06-05
### Fixed
- **ci/cd** ⚙️ `.github/workflows/build-stigix-allinone.yml`: Upgraded `docker/build-push-action` from `v5` to `v6` to resolve Docker buildx layer blob exporting errors (`error writing layer blob: not_found`) when writing to the GitHub Actions cache. 🔄

## [v1.4.0-patch.151] - 2026-06-04
### Changed
- **web-dashboard** 🌐 `Vyos.tsx`: Replaced fixed column width table layout (`table-fixed`) with an auto-adjusting table layout (`table-auto`) and appropriate `min-w-` classes. Added horizontal scrolling (`overflow-x-auto`) to the container. This fixes overlapping parameter and result values, allowing columns to adjust automatically to content. 📐
- **web-dashboard** 🌐 `Vyos.tsx`: Fixed colSpan of the empty history message from `5` to `6` to correctly span all columns. 🛠️

## [v1.4.0-patch.150] - 2026-06-04
### Added
- **web-dashboard** 🔁 `server.ts`: Added retry resilience to all DEM probe types (HTTP, HTTPS, PING, TCP, DNS, UDP). A new `retryProbe()` helper retries failed probes up to 2 times (3 total attempts) with a 1-second delay. Score is reduced by 20 points per retry used to distinguish transient micro-failures from true outages. 🛡️
- **web-dashboard** 🔁 `target-manager.ts`: Added native curl retries (`--retry 2 --retry-delay 1 --connect-timeout 5`) to CLOUD probe execution. Uses `-f -sS` flags to capture retry counts from stderr and apply the same scoring penalty logic. 🌐

## [v1.4.0-patch.149] - 2026-06-03

### Changed
- **web-dashboard** 🌐 `Vyos.tsx`: Increased the Sequence column width in the VyOS History table by an additional 20% (now `360px`) to prevent truncation of descriptive sequence names. 📐

## [v1.4.0-patch.148] - 2026-06-03
### Changed
- **web-dashboard** 🌐 `Vyos.tsx`: Replaced relative "Today" and "Yesterday" date labels with standardized `DD/MM` format in History table. ⏱️
- **web-dashboard** 🌐 `Vyos.tsx`: Increased horizontal width of the Sequence column in the History table to reduce truncation of long sequence names. 📐

## [v1.4.0-patch.147] - 2026-06-03
### Added
- **web-dashboard** 🌐 `server.ts`: Write a trace of VyOS RAZ (cleanup) events to `vyos-history.jsonl` so they are fully traceable. 🧹
- **web-dashboard** 🌐 `Vyos.tsx`: Redesigned History table to fit single-line entries. Split action column into distinct Command and Parameter columns, added relative time format with full timestamp tooltips, and truncated long sequence names. ⏱️

### Fixed
- **web-dashboard** 🌐 `vyos-scheduler.ts`: Fixed `pauseSequence` to actually clear/cancel active timers (instead of just deleting references), and `resumeSequence` to restart timers cleanly. ⏱️

## [v1.4.0-patch.146] - 2026-06-03
### Fixed
- **web-dashboard** 🌐 `server.ts` & `target-manager.ts`: Pass configured timeout (`endpoint.timeout`) to CLOUD target probes instead of using the hardcoded 15-second timeout. ⏱️

## [v1.4.0-patch.145] - 2026-06-01
### Added
- **stigix-cli** 🚦 `Scripts/stigix-cli.py`: Added the `SD-WAN FLOWS` section and `flows query` command to the main help / description screen.

## [v1.4.0-patch.144] - 2026-06-01
### Fixed
- **stigix-cli** 🚦 `Scripts/stigix-cli.py`: Increased the API request timeout for `flows query` to 60 seconds (up from default 10 seconds) to accommodate slow queries when calling Prisma SD-WAN Flow Browser APIs.

## [v1.4.0-patch.143] - 2026-06-01
### Added
- **stigix-cli** 🚦 `Scripts/stigix-cli.py`: Added interactive prompting to `flows query` when run without parameters. Features auto-detection of local site name and local IP as defaults, optional port prompts, and prints the equivalent full CLI command at the end for easy copy-paste.

## [v1.4.0-patch.142] - 2026-06-01
### Added
- **web-dashboard** 🌐 `server.ts`: Added `/api/prisma/flows` POST API endpoint to run `getflow.py` and query flow browser records dynamically using stored Prisma credentials.
- **stigix-cli** 🚦 `Scripts/stigix-cli.py`: Integrated `flows query` command with formatted table reporting total bytes, packets, path IDs, and friendly timestamps.
- **mcp-server** 🤖 Exposed `get_prisma_flows` MCP tool to allow querying Prisma Flow Browser via Claude.

## [v1.4.0-patch.141] - 2026-06-01
### Added
- **getflow** 🆕 `/app/engines/getflow.py` and `Scripts/getflow.py`: Added support for `--tcp-src-port` and `--tcp-dst-port` parameters to allow filtering flow queries by TCP ports (maps protocol automatically to 6).

## [v1.4.0-patch.140] - 2026-06-01
### Added
- **getflow** 🆕 `/app/engines/getflow.py` and `Scripts/getflow.py`: Added support for `--udp-dst-port` parameter to allow filtering flow browser queries by UDP destination port.

## [v1.4.0-patch.139] - 2026-06-01
### Fixed
- **getflow** 🐛 `/app/engines/getflow.py` and `Scripts/getflow.py`: Fixed silent authentication failures. Raised ValueError if `sdk.interactive.login_secret` returns `False` to prevent execution from proceeding with uninitialized token objects and crashing on missing `'jwt_expires_at'` attribute.

## [v1.4.0-patch.138] - 2026-06-01
### Added
- **docs** 📖 `docs/GETFLOW_ENGINE.md`: Added comprehensive user documentation for the `getflow.py` integration engine (roles in Stigix, command-line arguments, standalone usage examples, and troubleshooting).
- **web-dashboard** 🔍 `Settings.tsx`: Added an interactive search probe input field in the Synthetic Probes tab to filter custom probes by name or target with case-insensitive pattern matching.

## [v1.4.0-patch.137] - 2026-05-31
### Fixed
- **mcp-server** 🏷️ `orchestrator.py`: Implemented a centralized exception helper `_handle_exception` and updated `get_node_status`, `get_traffic_stats`, and `get_traffic_logs` to ensure all remote agent connection failures consistently output descriptive exception details instead of returning empty error strings.

## [v1.4.0-patch.136] - 2026-05-31
### Fixed
- **mcp-server** 🏷️ `orchestrator.py`: Prevent blank error responses when remote nodes are unreachable during DEM summary or details requests. Added a fallback to type-specific error details (e.g. `Connection failed: ConnectError`) when the exception's string representation is empty.

## [v1.4.0-patch.135] - 2026-05-31
### Fixed
- **mcp-server** 🔄 `bridge.py`: Added robust background reconnection and self-healing logic to the Claude local Python bridge. The bridge now keeps the STDIO session with Claude Desktop alive during remote node reboots, automatically trying to re-establish the remote SSE connection on subsequent requests instead of crashing the bridge process.

## [v1.4.0-patch.134] - 2026-05-31
### Fixed
- **mcp-server** 🐛 `orchestrator.py`: Fixed `get_dem_summary` and `get_probe_performance` returning empty stats. Updated their backend targets to query the independent `/api/connectivity/stats` endpoint instead of `/api/admin/system/dashboard-data` (where DEM data was previously removed to optimize performance).

## [v1.4.0-patch.133] - 2026-05-31
### Fixed
- **web-dashboard** 🐛 `server.ts`: Fixed HTTP 500 error in the `/api/traffic/settings` endpoint (called by `set_traffic_rate` MCP tool). Refactored internal route aliasing to use a shared helper function instead of `app._router.handle`, preventing TypeError crashes in token authentication middleware.

## [v1.4.0-patch.132] - 2026-05-31
### Fixed
- **mcp-server** 🏷️ `orchestrator.py`: Convergence tests launched via MCP now auto-derive a label from the target's registry name (`meta.site_name`) when the caller does not provide one — eliminates the "Unknown" label in the Failover dashboard history and live view.

## [v1.4.0-patch.131] - 2026-05-31
### Documentation
- **docs** 📖 `docs/MCP_SERVER.md`: Enriched MCP server documentation with comprehensive usage examples covering all major tool categories (node status, convergence, security, VyOS chaos, DEM probes).

## [v1.4.0-patch.130] - 2026-05-31
### Changed
- **mcp-server** 📄 `Exemple/MCP_Claude_Desktop_Test_BR8.md`: Translated MCP test plan to English, added Table of Contents, enforced stigix-lang skill for repo-facing content.

## [v1.4.0-patch.129] - 2026-05-31
### Added
- **mcp-server** 🔁 `clone_node_config` MCP tool: copies traffic app config, DEM probes, and fabric targets from one Stigix node to another in one command. Useful for bootstrapping new branches from a reference site.

## [v1.4.0-patch.128] - 2026-05-31
### Fixed
- **mcp-server** 🐛 `run_test` silent failure: when the backend returned a non-2xx response, the orchestrator swallowed the error and returned an empty result. Now raises and surfaces the HTTP error to Claude.
- **docs** 📋 Updated MCP test plan with corrected `run_test` parameter examples.

## [v1.4.0-patch.127] - 2026-05-31
### Fixed
- **web-dashboard** 🔴 `Failover.tsx`: Live active test card and history table now correctly handle tests launched from a remote MCP source agent (target IP lookup against local endpoint list). Badge and label display improvements.
- **mcp-server** 🏷️ `orchestrator.py`: EICAR MCP badge (`mcp_source: "mcp"`) correctly propagated through the convergence result payload.

## [v1.4.0-patch.126] - 2026-05-31
### Fixed
- **mcp-server** 🎯 `orchestrator.py` EICAR target resolution: now mirrors `Security.tsx` logic exactly — resolves cloud EICAR URL from `/api/security/cloud-eicar-url` and uses fabric target IPs from the registry for physical targets.

## [v1.4.0-patch.125] - 2026-05-31
### Fixed
- **mcp-server** 🏷️ `orchestrator.py`: EICAR targets are now mapped to fabric target names (e.g. `DC1-Ubuntu`) instead of raw IPs when displaying test labels in the Security dashboard.

## [v1.4.0-patch.124] - 2026-05-30
### Fixed
- **mcp-server** 🔴 `server.py`: `get_security_test_options` était entièrement statique (5 URLs Palo Alto hardcodées). Remplacé par un appel dynamique à `get_security_profile_dynamic` — retourne maintenant les vraies catégories configurées sur le node (toutes les catégories URL + tous les domaines DNS du profil Stigix). Requiert maintenant `agent_id` en paramètre.
- **mcp-server** 🔴 `orchestrator.py`: `get_security_profile_dynamic` avait un mapping de clés incorrect (`dns`/`url` au lieu de `dns_security.items`/`url_filtering.items`). Les listes retournées étaient vides — corrigé pour lire la vraie structure de l'API.
- **mcp-server** 🔴 `orchestrator.py`: Pour `probe_type=threat`, retourne maintenant l'URL cloud réelle depuis `/api/security/cloud-eicar-url` au lieu d'une liste vide.
- **mcp-server** 🔵 `orchestrator.py`: `mcp_source: "mcp"` maintenant inclus dans le payload envoyé au serveur (url-test et dns-test) — stocké dans le JSONL, permet l'affichage du badge MCP dans Security.tsx.
- **web-dashboard** 🔵 `server.ts`: `url-test` et `dns-test` lisent `mcp_source` depuis le body et l'incluent dans tous les objets result stockés (succès, erreur curl, DNS error).

## [v1.4.0-patch.123] - 2026-05-30
### Fixed
- **mcp-server** 🏷️ `orchestrator.py`: Tous les tests via MCP utilisent désormais un **nom identique au format UI** (ex: `EICAR Test (https://...)`, `Phishing`, `DNS C2 Infiltration`) — plus de suffixe `(MCP)` dans le nom.
- **mcp-server** 🏷️ `orchestrator.py`: Pour les scénarios EICAR Cloud (STIGIX-*), l'URL réelle est résolue via `/api/security/cloud-eicar-url` et affichée dans le nom (`EICAR Test (https://...)`).
- **mcp-server** 🔵 `orchestrator.py`: Ajout de `mcp_source: "mcp"` dans le résultat pour permettre la détection MCP côté UI.
- **web-dashboard** 🔵 `Security.tsx`: Ajout d'un badge violet `MCP` dans la colonne nom pour les tests déclenchés via MCP — distinct et non intégré au nom du test.
- **web-dashboard** `test-logger.ts`: Ajout des champs `mcp_source` et `mcp_target` dans l'interface `TestResult.details`.

## [v1.4.0-patch.122] - 2026-05-31
### Fixed
- **mcp-server** 🐛 `registry.py`: Fixed JWT_SECRET default mismatch — MCP was signing tokens with `"stigix-default-secret-2026"` while Stigix nodes use `"your-secure-secret-here"` (docker-compose default). This caused `403 Forbidden` on all remote nodes (e.g. BR5) when `JWT_SECRET` env var was not explicitly set. Defaults now aligned. Added a startup warning log when the insecure default is in use.
- **mcp-server** 🔍 `registry.py`: Improved `get_endpoint()` with 4-pass fuzzy matching. Natural language node references like `"BR5"` now resolve to `"ubuntubr5"`, `"BR8"` to `"BR8-Ubuntu"`, etc. — without requiring Claude to call `list_endpoints()` first. Match priority: exact → case-insensitive exact → partial substring → reverse partial.
- **mcp-server** 🔖 `orchestrator.py`: MCP security probes now resolve the **friendly category/test name** from the security profile (e.g., `Phishing (MCP)` au lieu de l'URL brute). Ajout des helpers `_get_url_category_name` et `_get_dns_test_name`.
- **mcp-server** 🔖 `orchestrator.py`: Les tests EICAR via MCP sont désormais labellisés `EICAR Test (MCP)` au lieu de `EICAR Test (Cloud: STIGIX-EICAR-01)`.
- **mcp-server** 🔢 `orchestrator.py`: Le `test_id` séquentiel est maintenant exposé dans la réponse MCP (`data["test_id"]`) pour permettre à Claude de référencer le numéro exact du test.
- **web-dashboard** 🔄 `Security.tsx`: L'auto-refresh inclut désormais `fetchResults()` dans le poll de 30s — les tests lancés via MCP ou planifiés apparaissent automatiquement.
- **web-dashboard** 🏷️ `server.ts`: L'endpoint `threat-test` accepte un champ `testName` optionnel pour stocker un label lisible sur les tests EICAR MCP.


## [v1.4.0-patch.121] - 2026-05-30
### Added
- **web-dashboard** 📈 Enhanced the "Global Experience Over Time" chart:
  - Enabled data point dots for better visibility of individual samples, particularly on the 6H and 24H intervals.
  - Added visual threshold regions and dotted reference lines for Warning (80) and Critical (50) status.
  - Added dynamic indicators to display the Min and Max scores achieved in the current view.

## [v1.4.0-patch.120] - 2026-05-30
### Removed
- **Repository cleanup** 🧹 Removed 15 files that were no longer needed:
  - `engines/rtp_enhanced.py`, `engines/srt_orchestrator.py`, `engines/srt_responder.py` — no references in codebase (SRT feature inactive, rtp_enhanced superseded)
  - `engines/rtp.py.scapy_backup` — manual backup, no longer needed
  - `web-dashboard/Dockerfile`, `build-and-push.sh` — old multi-container build system, replaced by `stigix-all-in-one/Dockerfile`
  - `test_probe.js`, `test_resolve.py`, `scratch/tag_tracer.py` — ad-hoc dev scripts
  - `web-dashboard/.txt`, `web-dashboard/test-route.js`, `stigix-registry/test/x` — test artifacts
  - `engines/.echo_server.py.swp`, `engines/.!35649!.echo_server.py.swp` — vim swap files (should never have been committed)
  - `sample config/.DS_Store` — macOS metadata file
- **`.gitignore`** 🛡️ Added `*.swp`, `*.swo`, `*/.DS_Store` patterns to prevent future accidental commits of swap and macOS metadata files.
- **Rollback**: Any deleted file can be restored with `git checkout v1.4.0-patch.119 -- <path>`.

## [v1.4.0-patch.119] - 2026-05-30
### Fixed
- **mcp-server** ⚡ `setup-bridge.sh`: Upgraded Python detection to dynamically search for Python 3.10+ executables (e.g. `python3.11` installed via Homebrew) even if the default system `python3` command refers to an older version (like Apple's 3.9.6).

## [v1.4.0-patch.118] - 2026-05-30
### Fixed
- **mcp-server** 🐛 `setup-bridge.sh`: Added Python 3.10+ version check and detailed installation instructions to prevent installation failures due to older Python versions (like Python 3.9).
- **docs** 📖 `docs/MCP_SERVER.md`: Updated documentation to specify Python 3.10+ requirement for Option B (Python Bridge Method).

## [v1.4.0-patch.117] - 2026-05-30
### Fixed
- **web-dashboard** 🐛 `Vyos.tsx`: Fixed React compilation build error by nesting the RAZ confirmation modal correctly inside the `Vyos` component scope.

## [v1.4.0-patch.116] - 2026-05-30
### Added
- **web-dashboard** 🎨 `Vyos.tsx`: Added an 👁️ Eye button (state panel per router card) and a 🧹 Eraser button (RAZ modal).
- **web-dashboard** 🌐 `POST /api/vyos/routers/:id/reset`: Added authenticated endpoint for router state reset.

## [v1.4.0-patch.115] - 2026-05-30
### Added
- **vyos** 🆕 `op_get_state()` in `vyos_sdwan_ctl.py`: new read-only function and `get-state` CLI subcommand. Single `api_retrieve()` call returns full router state: per-interface `admin_state` (up/down), `qos_active` params (delay_ms, loss_pct, rate, corruption), and all blackhole IP blocks (tag-999). Auto-detects VyOS 1.4 (`traffic-policy/`) and 1.5 (`qos/`) policy namespaces. Zero regression risk — no existing function modified.
- **web-dashboard** 🔌 `VyosManager.getState(routerId)`: new method spawning `vyos_sdwan_ctl.py get-state`. Pattern mirrors existing `getBlocks()`.
- **web-dashboard** 🌐 `GET /api/vyos/routers/:id/state`: new authenticated route returning live VyOS router state from HTTP API.
- **mcp-server** 🤖 `get_vyos_router_state` MCP tool: live state audit — Claude displays 🟢/🔴 per interface, QoS params, IP blocks. Use on *"What is the current VyOS state?"*.
- **mcp-server** ⚡ `vyos_bulk_reset` MCP tool: scope-based bulk reset (`all-qos`, `all-blocks`, `unshut-all`, `full-reset`). Queries state first, presents plan, waits for confirmation, then executes via existing `vyos_execute_adhoc` calls.
- **mcp-server** 🔗 `orchestrator.get_vyos_state(agent_id, router_id)`: calls `GET /api/vyos/routers/{id}/state` on the Stigix agent.

## [v1.4.0-patch.114] - 2026-05-30
### Added
- **mcp-server** 🟢 `get_vyos_interfaces` now includes `status: 'up'|'down'|'unknown'` for each interface in the MCP response. Data was already stored in `vyos-config.json` (set by `vyos_sdwan_ctl.py get-info` from the `disable` flag) — just not forwarded to Claude.
- **web-dashboard** 🔧 `VyosRouterInterface` TypeScript type: added `status?: 'up' | 'down' | 'unknown'` field.
- **mcp-server** 📝 `get_vyos_interfaces` docstring: updated disambiguation workflow to display 🟢/🔴 per interface and warn before acting on a `down` interface.

## [v1.4.0-patch.113] - 2026-05-30
### Fixed
- **web-dashboard** 🎨 `Vyos.tsx` History table — **Time column**: date now stacked under time (`flex-col`) instead of inline, eliminating overlap with the Sequence column.
- **web-dashboard** 🎨 `Vyos.tsx` History table — **Sequence column**: when `sequence_name` is `"Unknown"`, falls back to displaying `sequence_id` in muted monospace instead of the confusing "Unknown" label.
- **mcp-server** ⏱️ `orchestrator.py vyos_execute_adhoc`: added `asyncio.sleep(0.4)` after running the adhoc sequence and before fetching history. Prevents race condition where the temp sequence was deleted before the server finished writing the history entry with the correct `sequence_name` → caused "Unknown" in history.
### Documentation
- **docs** 📖 `VYOS_CONTROL.md`: added "MCP Session — Validated Behaviors (30/05/2026)" section with full topology diagram, confirmed interaction table (9 scenarios), key behaviors, and prompt best practices.

## [v1.4.0-patch.112] - 2026-05-30
### Fixed
- **mcp-server** 🧭 `get_vyos_interfaces` docstring: added **CRITICAL SITE NAME RESOLUTION** rule — Claude must never claim a VyOS node is missing if a site name like `"BR1"` or `"DC1"` matches an interface description. Must always scan descriptions first before concluding a node doesn't exist.
### Added
- **mcp-server** 📋 `mcp-server/Exemple/MCP_VyOS_Test_Exhaustif.md`: comprehensive test guide mapping site names (BR1/BR2/DC1) to physical router interfaces (`vyosrouter eth1`, `vyoslandc1`) with full test scenarios and cleanup steps.

## [v1.4.0-patch.111] - 2026-05-30
### Fixed
- **mcp-server** 🔀 `orchestrator.py`: unified `set-impairment` → `set-qos` command mapping. `set-impairment` is now the canonical MCP command name; the orchestrator maps it (and legacy `set-latency`, `set-loss`, `set-rate`, `set-corruption`) to `set-qos` which handles combined latency+loss+rate in a single VyOS policy.
- **web-dashboard** 🎨 `Vyos.tsx` History table column widths: adjusted `table-fixed` column proportions to reduce Time/Sequence overlap on smaller screens.

## [v1.4.0-patch.110] - 2026-05-30
### Fixed
- **mcp-server** 🐛 `get_security_results_stats`: removed `raw_counters` from the MCP response payload. Raw counters were causing Claude to compute incorrect enforcement percentages (e.g. 49%) instead of using the real weighted posture scores (URL 35.1, DNS 97.6, Threat 100.0). Claude now always leads with `posture_scores`.

## [v1.4.0-patch.109] - 2026-05-30
### Fixed
- **mcp-server** 🐛 `get_security_results_stats`: was returning raw counters only — Claude was computing wrong enforcement % (49%) instead of real weighted scores (URL 35.1, DNS 97.6, Threat 100.0).
### Added
- **mcp-server** 📊 `get_security_results_stats` now fetches 3 sources in parallel: `posture_scores` (real weighted 0–100 scores matching dashboard), `raw_counters` (volume context), `score_trend` (last 24 runs, url/dns/threat per entry for trend reporting).
- **mcp-server** 📝 Explicit docstring instructions: Claude must lead with `posture_scores`, never compute a ratio from `raw_counters` and call it a score.

## [v1.4.0-patch.108] - 2026-05-30
### Changed
- **mcp-server** 🎯 `get_vyos_interfaces`: interfaces without a description are now **silently excluded** from what Claude sees — they are management interfaces, not chaos targets. Claude only receives chaos-eligible interfaces (those with a configured description).
- **mcp-server** 📝 Per-router `_note` added when a router has zero chaos-eligible interfaces, with the exact VyOS CLI command to add descriptions. A `_global_warning` is surfaced when no interface at all is eligible across the entire node.
- **mcp-server** 📝 Updated `vyos_execute_action` and `get_vyos_interfaces` docstrings: explicit disambiguation workflow (propose→confirm), offline router handling, case where no interface matches.

## [v1.4.0-patch.107] - 2026-05-30
### Added
- **mcp-server** 📊 MCP interaction logger: monkey-patches all public async orchestrator methods at startup to transparently log every Claude tool call to `mcp-history.jsonl` (tool name, target agent, duration ms, status ok/error). Zero impact on Claude / MCP protocol — purely Stigix-side.
- **web-dashboard** 🔴 `GET /api/admin/mcp/history` route reads `mcp-history.jsonl` and returns the last N entries with computed stats (total calls, avg duration, error count).
- **web-dashboard** ✨ Settings → MCP Server tab: replaced static "Architecture Mesh" placeholder with a live, color-coded interaction feed — tool category icons (purple=VyOS, red=security, cyan=traffic, blue=DEM...), duration mini-bar (green<300ms, amber<800ms, red≥800ms), node badge, relative timestamps, LIVE pulse indicator, and header stats. Refreshes every 3 seconds.

## [v1.4.0-patch.106] - 2026-05-30
### Added
- **mcp-server** 🤖 2 new VyOS ad-hoc MCP tools for natural language network control:
  - `get_vyos_interfaces`: List VyOS router interfaces with descriptions, IPs, and status. Detects missing descriptions and guides the user to configure them. Required first step before any ad-hoc action.
  - `vyos_execute_action`: Execute any VyOS network action directly via Claude Desktop — shutdown/enable interface, add latency/loss/corruption/rate-limiting (netem), block/unblock IPs (firewall). No pre-built sequence needed: creates a temp sequence, runs it, deletes it.
- **docs** 📖 Added "Interface Naming Best Practices" section to `VYOS_CONTROL.md` — explains how to format VyOS interface descriptions for Claude MCP natural language targeting (e.g., `MPLS-Link-DC1`, `WAN-Internet-Bouygues`).

## [v1.4.0-patch.105] - 2026-05-29
### Fixed
- **mcp-server** 🐛 Fixed `run_eicar_test` returning HTTP 400 — payload was sending `{endpoints: [url]}` (array) but backend expects `{endpoint: url}` (string).

## [v1.4.0-patch.104] - 2026-05-29
### Fixed
- **web-dashboard** 🐳 Fixed `stigix-upgrader` container not cleaning up after upgrade — helper container was left running after upgrade completion, blocking future upgrade attempts.

## [v1.4.0-patch.103] - 2026-05-29
### Fixed
- **web-dashboard** 🐛 Code review: 3 bug fixes (details in commit `5fcadae`).

## [v1.4.0-patch.102] - 2026-05-29
### Fixed
- **mcp-server** 🐛 Fixed `generate_report` crashing with `AttributeError: 'StigixEndpoint' has no attribute 'agent_id'` when called without arguments. Now correctly uses `meta.get("site_name") or id` matching the `get_endpoint()` lookup pattern.

## [v1.4.0-patch.101] - 2026-05-29
### Added
- **mcp-server** 🚀 Phase 4 MCP tool expansion — 4 new compound/analytical tools completing the full feature set:
  - `get_convergence_history`: Past failover test results with max blackout (ms) and verdict (PERFECT/GOOD/DEGRADED/BAD/CRITICAL)
  - `list_security_results`: Last N individual security test results across all types (URL, DNS, Threat)
  - `compare_nodes`: Side-by-side comparison of two nodes — health, version, traffic, DEM health, security %, peer count, with auto-diff
  - `generate_report`: Fabric-wide report across all (or specified) nodes fetched in parallel, with global summary
- **mcp-server** 🔧 Added `asyncio` top-level import to `orchestrator.py` for parallel `asyncio.gather()` in compound methods
- **mcp-server** 🔧 Added `_fetch_node_snapshot` internal helper for efficient parallel node data collection
- **agent** 📋 Created `stigix-mcp-sync` skill — automated workflow to detect CLI→MCP gaps after CLI changes, with living CLI-to-MCP registry at `.agent/skills/stigix-mcp-sync/references/cli_to_mcp_map.md`
- **mcp-server** 📊 MCP server now has **48 tools** total (was 18 before Phase 1), achieving full CLI feature parity

## [v1.4.0-patch.100] - 2026-05-29
### Added
- **mcp-server** 🚀 Phase 3 MCP tool expansion — 6 new tools completing the CLI feature parity:
  - `run_full_security_audit`: Complete security suite (URL batch + DNS batch + EICAR) in one command with global summary — mirrors CLI `security suite`
  - `run_eicar_test`: Standalone EICAR threat prevention test with optional custom URL; auto-fetches cloud EICAR URL from node
  - `get_public_ip`: Fetch the WAN exit IP of a node to verify SD-WAN routing/VPN path
  - `list_apps`: List all apps configured in the traffic simulation profile
  - `export_app_config`: Export full app config as JSON for backup or cross-node cloning
  - `import_app_config`: Import app config JSON to a node (overwrites current config)
- **mcp-server** 🔧 Added 6 corresponding orchestrator methods; `run_full_security_audit` reuses Phase 2 batch methods internally for consistency
- **mcp-server** 📊 MCP server now has **44 tools** total (was 18 before Phase 1), covering ~95% of stigix-cli capabilities

## [v1.4.0-patch.99] - 2026-05-29
### Added
- **mcp-server** 🚀 Phase 2 MCP tool expansion — 8 new tools for batch security audits, DEM probe management, fabric target management, and traffic density control:
  - `run_security_url_batch`: Full URL filtering audit — auto-reads enabled categories from node config, tests all at once, returns blocked/allowed/unknown summary
  - `run_security_dns_batch`: Full DNS security audit — same approach for DNS test domains (up to 180s timeout)
  - `add_dem_probe`: Add a DEM experience probe (HTTP/HTTPS/PING/TCP/UDP/DNS) to a node, preserving existing probes
  - `remove_dem_probe`: Remove a DEM probe by name (case-insensitive match)
  - `add_fabric_target`: Register a new Stigix peer/branch into the mesh with full capability flags
  - `remove_fabric_target`: Remove a fabric target by name, host, or ID prefix
  - `set_fabric_target_enabled`: Enable or disable a fabric target without removing it
  - `set_traffic_client_count`: Set parallel traffic worker count (1–20) for density control
- **mcp-server** 🔧 Added 8 corresponding orchestrator methods in `lib/orchestrator.py`; batch methods auto-resolve config+profile before calling batch endpoints

## [v1.4.0-patch.98] - 2026-05-29
### Added
- **mcp-server** 🚀 Phase 1 MCP tool expansion — 12 new tools aligned with stigix-cli capabilities:
  - `get_node_status`: Aggregated health, version, traffic, site info, and convergence state in one call
  - `get_traffic_stats`: Live per-app request counts, error rates, and client count
  - `get_traffic_logs`: Recent traffic generation logs (with configurable limit)
  - `get_security_results_stats`: Security test scorecard (DNS/URL/Threat pass/fail summary)
  - `get_security_config`: Security policy module config + full dynamic test target profile
  - `get_security_test_options_dynamic`: Live security test options fetched from node profile (replaces hardcoded list)
  - `list_dem_probes`: List all configured DEM experience probes on a node
  - `run_dem_probes_now`: Trigger an immediate DEM probe run and return results
  - `get_dem_probe_stats`: Historical DEM stats — global health score, per-probe latency, reliability (1h window)
  - `list_fabric_targets`: List manually-managed Stigix peer targets with capabilities
  - `list_speedtest_history`: XFR speedtest history with throughput, RTT, and status
- **mcp-server** 🔧 Added 11 corresponding orchestrator methods in `lib/orchestrator.py` following the existing async/httpx pattern

## [v1.4.0-patch.97] - 2026-05-29
### Fixed
- **web-dashboard** 🔄 Fixed `system upgrade` and `redeploy` container recreation failing to start the new container. It now spawns the `docker compose up -d` command in a detached background helper container (`stigix-upgrader`) via the Docker socket, preventing the compose process from being killed when the Stigix container shuts down.

## [v1.4.0-patch.96] - 2026-05-29
### Removed
- **stigix-cli** 🗑️ Removed idle timeout feature (`--idle-timeout`) — was not cross-platform compatible (used `signal.SIGALRM` unavailable on Windows, and `prompt_toolkit` `timeout=` kwarg unavailable in older versions). REPL is back to a simple clean loop.

## [v1.4.0-patch.95] - 2026-05-29
### Added
- **stigix-cli** 📋 `history dump` command: prints all unique commands (persistent file + current session) clean to stdout — one command per line, ready to copy-paste into a script. Reads prompt_toolkit `.stigix-cli.history` and strips the `+` format markers automatically.
- **docker-compose** 💾 Added `.stigix-cli.history` and `.stigix-cli.json` volume mounts to all 4 compose files — CLI history and session token now survive container upgrades/recreations.
- **install.sh / install-latest-beta.sh** 🏗️ `touch` pre-creates `.stigix-cli.history` and `.stigix-cli.json` before container start so Docker mounts them as files (not directories).
### Fixed
- **stigix-cli** 🔄 `system upgrade` monitoring timeout now shows a clear message when the container stops before finishing restart, with exact command to run: `cd stigix && docker compose up -d`.

## [v1.4.0-patch.94] - 2026-05-29
### Added
- **stigix-cli** ⏰ Idle timeout: CLI automatically exits after N seconds of inactivity. Default: **300s** (5 min). Set `--idle-timeout 0` to disable entirely.
  - prompt_toolkit path: uses `session.prompt(timeout=N)`, catches `TimeoutError`
  - Fallback plain-input path: uses `signal.SIGALRM` (Unix only)
  - Startup banner shows active timeout value
  - `--idle-timeout SECONDS` CLI argument added (e.g. `stigix-cli --idle-timeout 600`)

## [v1.4.0-patch.93] - 2026-05-29
### Fixed
- **stigix-cli** ⏱️ `security url-batch` and `security dns-batch` were timing out at 10s when running 66 URL + 24 DNS tests. Timeout raised to **180s** per batch call.
- **stigix-cli** 🔧 `security suite` EICAR step was triggering an interactive endpoint prompt (blocking in headless/exec mode) and could return a 400 error. Suite now auto-selects the Cloud EICAR URL without user interaction.
### Added
- **stigix-cli** ⠹ Live spinner with elapsed-time counter shown during long-running batch security tests (`url-batch`, `dns-batch`): `⠙ Testing 66 URL categories  [12s]` — updates every 100ms and shows total elapsed on completion.

## [v1.4.0-patch.92] - 2026-05-29
### Fixed
- **stigix-cli** 🔧 Fixed status card table alignment — ANSI escape codes in label column were inflating visible width, causing right border to overflow. Now uses correct visible-length calculation for padding.
### Added
- **stigix-cli** 📂 `status` command now shows the history file path (`~/.stigix-cli.history`) below the status card so users know where prompt history is stored.
- **stigix-cli** 📂 `history` command now shows the history file path in the list footer and when the session is empty.
- **install.sh** 📦 Installed Docker image version is now displayed at the end of the install output (`📦 Installed version: vX.Y.Z-patch.N`).
- **install-latest-beta.sh** 📦 Same version display added, with `(beta/latest)` suffix.
- **install.sh / install-latest-beta.sh** 🧹 Removed interactive mode selection prompt — all Stigix deployments are always Source+Target (both), simplifying the install output.

## [v1.4.0-patch.91] - 2026-05-29
### Added
- **cli** 💻 Introduced the `--autocomplete` flag to programmatically query and output autocompletion suggestions from the command line, enabling external shell integrations.

## [v1.4.0-patch.90] - 2026-05-29
### Added
- **cli** 💻 Added in-memory command logging/recording (`history` suite) to save interactive session inputs to script files for easy replay.

## [v1.4.0-patch.89] - 2026-05-29
### Added
- **cli** 💻 Added dynamic auto-completion suggestions for saved profile names when using the `connect` and `connect forget` commands.

## [v1.4.0-patch.88] - 2026-05-29
### Refactored / Fixed
- **cli** 💻 Revamped the CLI status overview screen (`status` command) into a clean, card-based aligned panel layout.
- **cli** 💻 Added real uptime calculations fetched directly from the backend API health check.
- **cli** 💻 Corrected double `v` version prefix bug in startup header.
- **cli** 💻 Restructured and compacted console stats grids (traffic and digital experience dashboard cards) to fit perfectly within 64-column widths, avoiding line wraps on smaller terminals.

## [v1.4.0-patch.87] - 2026-05-29
### Added
- **install** ⚙️ Added `docker exec -it stigix stigix-cli` hint to installer success message to guide users operating in headless environments or preferring terminal-based control.

## [v1.4.0-patch.86] - 2026-05-29
### Added
- **install** ⚙️ Added note in installer success message instructing the user how to modify the Web UI port later (editing `PORT` in `stigix/.env` and restarting via `docker compose up -d`).

## [v1.4.0-patch.85] - 2026-05-29
### Added
- **install** ⚙️ Added interactive confirmation prompt when port `8080` is in use, letting the user choose whether to proceed with the alternative port or cancel the installation.
- **install** ⚙️ Implemented `dump_process_on_port` helper function to print the PID, process name, and details of the program occupying port `8080` when a conflict is encountered.

## [v1.4.0-patch.84] - 2026-05-29
### Fixed
- **install** ⚙️ Refactored the `find_free_port` function in both installers (`install.sh` and `install-latest-beta.sh`) to execute all port checks sequentially (rather than in an if-elif block). This ensures that if a tool (like `lsof` run without root privileges) fails to find the conflict, fallback checks like `ss`, `netstat`, or dynamic `/dev/tcp` socket opening will still correctly flag the port as busy.

## [v1.4.0-patch.83] - 2026-05-29
### Added
- **install** ⚙️ Added an interactive, real-time CLI progress bar during the post-deployment Web Dashboard connectivity check loop (using `\r` carriage return to draw visual blocks on a single line).

## [v1.4.0-patch.82] - 2026-05-29
### Added
- **install** ⚙️ Implemented dynamic port auto-selection in `install.sh` and `install-latest-beta.sh` (scanning the `8080-8090` range if `8080` is in use) and writing the chosen port to the generated `.env` file.
- **install** ⚙️ Added automated post-deployment diagnostic connectivity assessment checks to confirm container state and HTTP responsiveness of the dashboard at the end of the installation.

## [v1.4.0-patch.81] - 2026-05-28
### Fixed
- **web-dashboard** ⚙️ Implemented robust fallbacks (by querying container name `stigix` or scanning running images) in the host project directory detection module to support Docker hosts configured with `network_mode: host` (where `os.hostname()` returns the host's hostname rather than the container ID).

## [v1.4.0-patch.80] - 2026-05-28
### Fixed
- **stigix-cli** ⚙️ Suppressed display of HTTP 500 error messages when the public IP address cannot be retrieved (e.g. in offline environments).

## [v1.4.0-patch.79] - 2026-05-28
### Fixed
- **web-dashboard** ⚙️ Resolved Docker-in-Docker relative path resolution issues during upgrade/redeploy by auto-detecting host project directory and passing it via the `--project-directory` flag in Docker Compose commands.

## [v1.4.0-patch.78] - 2026-05-28
### Added
- **install** ⚙️ Added `BETA` feature flag variable default mapping to all docker compose files and configured installers (`install.sh` and `install-latest-beta.sh`) to output `BETA=false/true` by default in `.env` to enable the System Maintenance menu visibility for beta releases.

## [v1.4.0-patch.77] - 2026-05-28
### Added
- **stigix-cli** ⚙️ Enriched `status` command output to display Local IP (with default interface), Default Gateway IP, configured Traffic Interfaces, and fixed the Prisma SASE site name key checking.

## [v1.4.0-patch.76] - 2026-05-28
### Added
- **install** ⚙️ Added commented-out `TAG` environment variable template to generated `.env` file during installation as self-documenting guidance to easily switch and lock update tags.

## [v1.4.0-patch.75] - 2026-05-28
### Fixed
- **install** ⚙️ Aligned downloaded compose file's internal volume mount name dynamically in `install.sh` and `install-latest-beta.sh` using `sed` to match its final destination name on the host.

## [v1.4.0-patch.74] - 2026-05-28
### Added
- **stigix-cli** ⚙️ Added interactive tag/version selector to `system upgrade` command that displays local vs remote version.
- **stigix-cli** ⚙️ Supported direct tag argument passing in `system upgrade <tag>` to skip prompt.
### Changed
- **web-dashboard** ⚙️ Aligned backend upgrade fallback default pull target tag from `stable` to `latest` when version is not specified.

## [v1.4.0-patch.73] - 2026-05-28
### Added
- **stigix-cli** ⚙️ Added `autocomplete <on|off|status>` (and `autocompletion` alias) command to configure tab completion preferences, which persist in the session config file.
### Fixed
- **stigix-cli** ⚙️ Fixed nesting key mismatch for CPU/memory/disk stats in `system info` output.
- **stigix-cli** ⚙️ Fixed key mismatch in logs subcommands (`traffic logs`, `system logs`) to properly print streaming backend logs.
- **stigix-cli** ⚙️ Added dedicated help handling (`--help`, `-h`, `help` subcommands) for all remaining CLI commands (`connect`, `auth`, `status`).
- **stigix-cli** ⚙️ Removed the deprecated `traffic watch` command.

## [v1.4.0-patch.72] - 2026-05-28
### Added
- **stigix-cli** ⚙️ Implemented real-time upgrade log output streaming and status monitoring for the `system upgrade` command, handling connection drop and automatic recovery when containers restart.

## [v1.4.0-patch.71] - 2026-05-28
### Fixed
- **web-dashboard** 📞 Improved Voice target checklist checkbox visibility and interaction by removing inherited row opacity, enhancing checkbox border/hover colors, and making the entire Site cell clickable.

## [v1.4.0-patch.70] - 2026-05-28
### Added
- **stigix-cli** ⚙️ Added `traffic speed [val]` and `traffic density [val]` subcommands to dynamically adjust traffic delay/rate and parallel client counts.
- **stigix-cli** 📊 Updated `traffic status` to display current traffic speed (with visual preset badges matching the dashboard UI) and density parallel client count.
- **stigix-cli** 🧠 Enhanced CLI auto-completer (`StigixCompleter`) to suggest non-flag subkeys at level 3+ of the tree.
- **docs** 📘 Documented the new traffic commands in `docs/STIGIX_CLI.md` and updated `STIGIX_CLI.pdf`.

## [v1.4.0-patch.69] - 2026-05-28
### Fixed
- **stigix-cli** ⚙️ Fixed the VyOS sequence run command execution issues by adding command redirection for `vyos sequences run/stop` and implementing client-side prefix matching to resolve truncated sequence IDs to full unique IDs before calling the backend.
- **stigix-cli** 📊 Increased the displayed ID limit in the `vyos sequences` table to 24 characters to make sure unique suffixes are visible.

## [v1.4.0-patch.68] - 2026-05-28
### Added
- **maintenance** 🐳 Improved container upgrade flow by adding automatic docker system pruning (`docker system prune -a -f`) to purge unused image layers.
- **maintenance** 📊 Added real-time step-by-step progress logging of prune, pull, and recreate processes into the upgrade status view.
- **maintenance** ⚙️ Implemented dynamic recreate using `--force-recreate` with graceful fallback logic if the option is not supported.
- **maintenance** 🔌 Consolidated docker compose executable command detection into a shared utility to handle both `docker compose` and `docker-compose` layouts consistently.

## [v1.4.0-patch.67] - 2026-05-28
### Fixed
- **maintenance** 🐳 Fixed the system container upgrade workflow by dynamically interpolating the version tag (`TAG=${version}`) when pulling and recreating the Docker container.
- **docker-compose** 📦 Updated the beta compose configurations (`docker-compose-latest-beta.yml` and `docker-compose-latest-beta.bridge.yml`) to use dynamic image tagging (`jsuzanne/stigix:${TAG:-latest}`) to support upgrade tag injection.

## [v1.4.0-patch.66] - 2026-05-28
### Added
- **stigix-cli** 🏷️ Renamed CLI command `peer` to `target` to match the Stigix Targets UI dashboard. A backward-compatible `peer` alias is preserved.
- **stigix-cli** 📡 Renamed CLI command `experience` (and its previous alias `target`) to `probes` (with `probe` and `experience` preserved as aliases) to match the Synthetic Probes UI dashboard.
- **docs** 📘 Updated `docs/STIGIX_CLI.md` with latest command definitions and documented new VyOS/IoT config import/export capabilities.
### Fixed
- **stigix-cli** ⚙️ Fixed `iot start` and `iot stop` batch commands (run without argument) by dynamically querying active device IDs and sending them in the POST body to resolve the `IDs array required` backend error.

## [v1.4.0-patch.65] - 2026-05-28
### Added
- **stigix-cli** 📥 Added `vyos import <file>` subcommand to import VyOS routers and sequences unified configuration from a local JSON file.
- **stigix-cli** 📤 Added `vyos export [file]` subcommand to export configured VyOS routers and sequences to a local JSON file (defaults to `vyos-config.json`).
- **stigix-cli** 🧠 Enabled autocomplete file suggestions for local `.json` files when using `vyos import` and `vyos export` commands.

## [v1.4.0-patch.64] - 2026-05-28
### Added
- **stigix-cli** 🔍 Added an interactive search-based category lookup for `security url` and `security dns` commands. Allows typing a search term to dynamically filter predefined categories instead of showing only the top 10.
### Fixed
- **stigix-cli** 📊 Resolved a key mapping mismatch in `security results` command. The Type and Name columns now display the correct output instead of displaying `?`.

## [v1.4.0-patch.63] - 2026-05-28
### Fixed
- **stigix-cli** 🔑 Fixed a session token restoring bug when switching profiles or connecting directly by URL. Prevents falling back to the wrong active token from a different instance/URL.

## [v1.4.0-patch.62] - 2026-05-28
### Added
- **stigix-cli** ⚙️ Added `iot import` subcommand supporting JSON configs, Prisma IoT Security Assets Inventory CSV reports, and Palo Alto CVE/Vulnerability Report CSV exports.
- **stigix-cli** 📥 Added `iot export` subcommand to export simulated IoT device profiles into standard JSON configurations.
- **stigix-cli** 🧠 Enabled autocomplete file suggestions of `.csv` files alongside `.json` files when writing path inputs for the `import` commands.

## [v1.4.0-patch.61] - 2026-05-28
### Added
- **stigix-cli** 🛡️ Added `select-all` subcommand to toggle enabling/disabling all URL filtering categories or DNS tests at once.
- **stigix-cli** ⏰ Added `schedule` subcommand to configure scheduled execution for URL filtering, DNS, and Threat tests with custom/predefined intervals.
- **stigix-cli** 💬 Enabled interactive selection menus and name-to-IP/peer mapping for `url`, `dns`, and `eicar` commands when executed without arguments.
- **stigix-cli** 📊 Rewrote the `status` command to align with the backend `LogStats` schema and display accurate Verdict counters.
### Fixed
- **web-dashboard** 🐛 Swapped route registration order in Express backend (`/api/security/results/stats` before `/:id`) to resolve route shadowing and fix the security status 404 error.
- **stigix-cli** 🐛 Corrected configuration key parsing (`url_filtering`, `dns_security`, `threat_prevention`) in `url-batch`, `dns-batch`, and `eicar` subcommands to match the backend JSON structure.

## [v1.4.0-patch.60] - 2026-05-28
### Fixed
- **stigix-cli** 🔌 Implemented connection pooling via a global `requests.Session()` with HTTP keepalive to speed up toolbar updates, reduce socket overhead, and prevent connection drops.
- **stigix-cli** 🛡️ Wrapped the bottom toolbar rendering logic in a robust exception-handler to prevent UI freezes or lockups in prompt_toolkit during network instability or host sleep states.

## [v1.4.0-patch.59] - 2026-05-28
### Fixed
- **stigix-cli** 🎨 Fixed box alignment overflow in the Traffic Dashboard (`traffic stats` / `traffic watch`) to prevent border duplication and trailing vertical separator glitches.

## [v1.4.0-patch.58] - 2026-05-28
### Added
- **stigix-cli** 🧠 Added `stats` subcommand to autocompletion options under `experience` and `target` commands.
- **stigix-cli** 📁 Added local `.json` file suggestions to the autocompletion menu for `import` and `export` file path inputs.
- **stigix-cli** ⚠️ Added interactive safety overwrite warnings to all `import` subcommands (`traffic`, `experience`, `peer`) to prevent accidental remote config deletion or overrides.

## [v1.4.0-patch.57] - 2026-05-28
### Added
- **stigix-cli** 🔌 Added support for a custom `timeout` parameter in API request helpers (`api_get`, `api_post`, `api_put`, and `api_delete`).
- **stigix-cli** 🧠 Enabled dynamic version loading in the interactive CLI start header, automatically reading from `/app/VERSION` or the root `VERSION` file, with a fallback default.
### Changed
- **stigix-cli** ⏳ Increased the `experience probe` timeout limit to 90 seconds to handle sequential testing of multiple synthetic endpoints without timing out.

## [v1.4.0-patch.56] - 2026-05-28
### Added
- **stigix-cli** 📈 Implemented the `experience stats` command to display digital experience connectivity performance statistics. Draws a global experience summary banner and outputs a detailed table listing synthetic probe name, target URL/IP, type, last score (along with historical average), average latency, and reliability (uptime %).

## [v1.4.0-patch.55] - 2026-05-28
### Added
- **stigix-cli** 📊 Implemented a premium terminal-based Traffic Dashboard for `traffic stats` and `traffic watch` commands. Displays running status, success rate, active apps count, total requests, total errors, real-time traffic rate (req/min & pps), and a detailed table of per-application stats (sorted by volume, resolving category group names from the backend configuration). Added a `--all` option to display the full list of active applications.

## [v1.4.0-patch.54] - 2026-05-28
### Added
- **stigix-cli** 🔑 Upgraded session persistence to support multi-instance token storage. The CLI now stores tokens in a URL-indexed mapping (`instance_tokens` in `~/.stigix-cli.json`), automatically restoring and preserving credentials when connecting to or switching between multiple Stigix instances.

## [v1.4.0-patch.53] - 2026-05-28
### Added
- **stigix-cli** 📁 Improved CLI import/export features (`experience`, `peer`, `traffic`) by supporting standard input (passing `-` as filepath) and automatically falling back to / routing relative paths to the host-mounted `config/` directory. Added a clear instructions note about Docker environment limitations on file not found.

## [v1.4.0-patch.52] - 2026-05-28
### Fixed
- **stigix-cli** 🔌 Wrapped script module-level imports and the main execution entrypoint in a try-except block to cleanly intercept `KeyboardInterrupt` (Ctrl+C) and exit with a message, preventing tracebacks.

## [v1.4.0-patch.51] - 2026-05-28
### Added
- **stigix-cli** 🔌 Enhanced `experience add` to support guided interactive prompting, with type-specific target/timeout defaults, and displaying the equivalent CLI command.
- **stigix-cli** 🎛️ Switched `experience list` to friendly 1-based index numbers and correctly mapped the probe targets.
- **stigix-cli** ❌ Upgraded `experience remove` to support deleting probes by index or by name.
- **stigix-cli** 💬 Integrated `shlex.split` for command tokenization to parse quoted strings correctly (e.g. `--name "My Custom Name"`).
### Fixed
- **stigix-cli** 🐛 Corrected the POST endpoint payload schema for custom connectivity targets.

## [v1.4.0-patch.50] - 2026-05-28
### Added
- **stigix-cli** 🔌 Implemented `peer export [file]` and `peer import <file>` commands to import/export peer targets from/to JSON files.
- **stigix-cli** 🧪 Implemented `experience export [file]` and `experience import <file>` commands to import/export custom digital experience probes from/to JSON files.
- **stigix-cli** ⚡ Implemented `traffic export [file]` and `traffic import <file>` commands to import/export traffic applications/distribution configuration from/to JSON files.
- **stigix-cli** 🧠 Added tab autocomplete completions and help screen definitions for the new configuration import/export commands.

## [v1.4.0-patch.49] - 2026-05-28
### Refactored
- **stigix-cli** 🔀 Renamed the `convergence` command group to `failover` to align with the UX, while maintaining `convergence` as a backward-compatible alias.
- **stigix-cli** 🔌 Mapped the `"convergence"` peer capability to `"failover"` in the `peer list` command output, and supported both `--failover` and `--convergence` flags in `peer add`.
- **web-dashboard** 🎨 Updated the "Convergence Lab" and other user-facing UI labels, headers, and descriptions to use the "Failover" terminology.
- **docker-compose** 🐳 Updated comments mapping UDP port 6200 and describing the failover features to say "Failover probes".
### Fixed
- **stigix-cli** 🐛 Fixed list-type status crash in `cmd_status` and updated the status string format.

## [v1.4.0-patch.48] - 2026-05-28
### Fixed
- **stigix-cli** 🐛 Fixed a bug in `convergence history` where Blackout and Verdict columns printed `?` for tests with 0ms max blackout due to python's falsy behavior on `0`.

## [v1.4.0-patch.47] - 2026-05-28
### Fixed
- **stigix-cli** 🐛 Fixed a crash in `convergence status` and `convergence watch` commands caused by trying to call `.get()` on a list object returned by the backend status API. It now correctly iterates over the active test status list.

## [v1.4.0-patch.46] - 2026-05-28
### Added
- **stigix-cli** 🔀 Enhanced `convergence start` command to query and present available Stigix targets with the `convergence` capability in a selection menu (similar to voice start and speedtest run), allowing manual IP/Host input or target name resolution (e.g. `DC1`).

## [v1.4.0-patch.45] - 2026-05-28
### Added
- **stigix-cli** ⚙️ Implemented comprehensive parameter validation and interactive prompting for speedtest options (`port`, `protocol`, `direction`, `duration`, `bitrate`, `streams`, `psk`), proposing default choices in square brackets for each option.
- **stigix-cli** 🐛 Fixed a bug in `speedtest list` where target hosts were incorrectly displayed as `?` due to an incorrect key lookup path in the job params schema.

## [v1.4.0-patch.44] - 2026-05-28
### Added
- **stigix-cli** ⚡ Enhanced `speedtest run` command to propose a list of available Stigix targets with the `xfr` capability (similar to the voice simulation target selector) or allow entering a manual IP/Host.
- **stigix-cli** 🔌 Added support for resolving friendly target names (e.g. `DC1`) specified in `speedtest run` commands to their configured host IPs.

## [v1.4.0-patch.43] - 2026-05-28
### Added
- **stigix-cli** 🎙️ Enhanced `voice stats` command to output a beautiful metrics dashboard consisting of an Overall QoS Summary, a Per-Target QoS Statistics table (with site mapping and quality ratings), and a detailed Call History table of recent events.
- **stigix-cli** 🎨 Refactored the `table()` utility function to be ANSI escape-aware, ensuring perfect column alignments when using color badges in table rows.

## [v1.4.0-patch.42] - 2026-05-28
### Added
- **stigix-cli** 🧪 Added `(Beta)` notice to interactive console start and help banners.
- **stigix-cli** 🎙️ Implemented interactive target selection/proposals and configuration auto-sync on `voice start`.
- **stigix-cli** 🔍 Added target name, host IP, and prefix matching for `peer remove/enable/disable` commands, and added an interactive deletion confirmation prompt.
- **README.md** 📊 Enhanced the post-installation verification guide with step-by-step checks including checking containers, querying system health, monitoring logs, and utilizing the CLI.
### Fixed
- **stigix-cli** 🎙️ Corrected `voice start` and `voice stop` to send `enabled: true/false` payload, fixing a bug where they inadvertently disabled the voice orchestrator.

## [v1.4.0-patch.41] - 2026-05-27
### Fixed
- **install.sh** 🐛 macOS and Windows installs were silently using `docker-compose.yml` (host networking) instead of bridge mode, despite the correct platform detection message being displayed. All three OS branches previously pointed to the same file. Fixed: macOS and WSL/Windows now correctly download `docker-compose.bridge.yml`.
- **docker-compose.bridge.yml** ✨ New dedicated bridge-mode compose file for macOS/Windows with explicit port mappings for all services (8080, 8082, 9000, 5201 TCP/UDP, 6100/6101 UDP, 6200 UDP, 3100).

## [v1.4.0-patch.40] - 2026-05-27
### Added
- **stigix-cli** 🖥️ New interactive local CLI (`Scripts/stigix-cli.py`) — full-featured terminal console for Stigix instances without browser access. Features: live bottom toolbar (auth/traffic/version status), JWT session persistence (`~/.stigix-cli.json`), named instance profiles (`connect save lab1` / `connect lab1`) for quick multi-instance switching, Tab autocompletion, command history, F1/F5/Ctrl+L shortcuts, and `traffic watch` / `convergence watch` live monitoring. Also supports `--exec` (headless single command) and `--script` (batch file) modes.
- **stigix-cli in Docker** 🐳 `stigix-cli` is now available directly inside the container — run `docker exec -it stigix stigix-cli` for zero-install local access. `prompt_toolkit` added to Python dependencies; wrapper script installed at `/usr/local/bin/stigix-cli`.
- **install-cli.sh** 📦 Improved host-side installer: auto-detects root vs user prefix (`/usr/local/bin` or `~/.local/bin`), verifies Python 3, installs deps, checks PATH, supports `--uninstall` flag.

## [v1.4.0-patch.39] - 2026-05-22
### Changed
- **VyOS Sequences**: Implemented clickable columns for sorting in the sequence list. Columns (Name, Router, Command, Last) can now be toggled between ascending and descending order.

## [v1.4.0-patch.38] - 2026-05-22
### Fixed
- **VyOS Sequences**: Fixed an issue where the sequence execution state could get permanently "stuck" in the frontend after an action finishes (especially in loop scenarios), preventing the user from running any other sequences manually without refreshing the page. 🔄
- **VyOS Sequences**: Added an automatic 15-second retry mechanism for any sequence action that fails due to a `500 Internal Server Error` or a timeout, drastically improving reliability for intermittent connection drops. ⏳

## [v1.4.0-patch.37] - 2026-05-21
### Changed
- **VyOS Sequence & History UI**: Swapped the "Router" and "Command" columns in the Sequence list so "Router" appears first, making it consistent with the History view. Compacted the column widths in the History tab to reduce empty space and improve readability. 🔄

## [v1.4.0-patch.36] - 2026-05-21
### Changed
- **IoT Edit Modal**: Further widened the Edit Device modal from `max-w-2xl` to `max-w-3xl` (768px) to guarantee that all Attack Types and Protocols fit comfortably on a single line without any visual truncation or scrolling, even with the longest badge labels. 📱

## [v1.4.0-patch.35] - 2026-05-21
### Changed
- **IoT Edit Modal**: Widened the Edit Device modal from `max-w-xl` to `max-w-2xl` and reduced badge sizing (`px-2 py-1`, `text-[10px]`, tighter gap) so Attack Types and Protocol chips fit on a single visible line without needing to scroll. 📱

## [v1.4.0-patch.34] - 2026-05-21
### Fixed
- **IoT Edit Modal**: Applied `w-full` constraint to the horizontal scrolling containers for "Attack Types" and "Protocols" to prevent them from expanding past the form boundaries and clipping at the card border. 📱

## [v1.4.0-patch.33] - 2026-05-21
### Changed
- **VyOS Sequence Edit**: Shortened the IP address/FQDN parameter input placeholder from `"e.g. 8.8.8.8/32 or google.com"` to `"8.8.8.8/32 or FQDN"` to prevent truncation and make it fully readable in the edit dialog columns. 🔧

## [v1.4.0-patch.32] - 2026-05-21
### Added
- **Widget Search Bars**: Integrated local search bars into the four security widgets (URL Filtering, DNS Security, C2 Scenarios, and AI Security Tests) in the `Security.tsx` header blocks. Typing in the search input automatically filters matching items, restricts the "Select All" checkbox toggle action to only visible items, displays elegant empty states when no items match, and automatically expands the accordions. Implemented harmonized focus outlines per widget type (red for URL, blue for DNS, purple for C2, cyan for AI) and stopped event propagation to prevent the inputs from collapsing or expanding the accordion panels. 🔍

## [v1.4.0-patch.31] - 2026-05-21
### Added
- **Security Search Bar**: Added a dynamic autocomplete search bar at the top of the Security page (`web-dashboard/src/Security.tsx`) to search and select/enable categories and tests across URL Filtering, DNS Security, C2 Scenarios, and AI Security tests. Selecting a suggestion auto-expands the relevant accordion, enables the test, scrolls it into view, and displays a temporary glowing visual highlight. 🔍

## [v1.4.0-patch.30] - 2026-05-21
### Changed
- **IoT Edit Modal**: Redesigned the "Attack Types" and "Protocols" selections in the device configuration modal to display as single-line horizontal lists. Items do not wrap or shrink, and are scrollable with a custom-styled thin scrollbar matching the dark theme. 📱

## [v1.4.0-patch.29] - 2026-05-21
### Fixed
- **VyOS Sequence Validation**: Blocked saving a VyOS sequence in the UI if it contains a block action with an FQDN and the targeted router is running VyOS 1.4. 🛡️

## [v1.4.0-patch.28] - 2026-05-21
### Documentation
- **Changelog**: Backfilled and updated changelog entries for VyOS FQDN and description patches. 📝

## [v1.4.0-patch.27] - 2026-05-21
### Added
- **VyOS Sequence FQDN Restrictions**: Added explicit validation to strictly block FQDN usage on VyOS 1.4 routers (returns an error if attempted). FQDN blocking is now officially only supported on VyOS 1.5+.
- **VyOS Sequence Descriptions**: Restored the `description` attribute tracking (e.g., `block google.com 8.8.8.8/32`) on static blackhole routes, but specifically gated it to only execute on VyOS 1.5 routers since VyOS 1.4 does not support the description attribute on static routes.

## [v1.4.0-patch.26] - 2026-05-21
### Fixed
- **VyOS Backend**: Removed the `description` attribute from `simple-block` static routes to resolve a severe `400 BAD REQUEST` error on VyOS 1.4. VyOS 1.4 does not support descriptions on `protocols static route <prefix>`.

## [v1.4.0-patch.25] - 2026-05-21
### Fixed
- **VyOS UI**: Updated the "VyOS CLI Equivalent" text generator in the frontend. It now explicitly adds a comment noting that FQDNs (like `google.com`) are dynamically resolved into IPs by the Stigix backend, preventing user confusion when they see the FQDN directly embedded in the UI's simulated CLI output.

## [v1.4.0-patch.24] - 2026-05-21
### Added
- **VyOS Sequence FQDN Support**: The `simple-block` action now accepts FQDNs (e.g., `google.com`) in addition to IP addresses. The backend resolves the FQDN to all associated IPv4 addresses and creates blackhole routes using the route description field to store the relationship (`block google.com <IP>`). The `simple-unblock` action intelligently cleans up by matching this description rather than relying on a secondary, potentially shifted DNS resolution.
- **VyOS UI**: Updated the IP input placeholder for block/unblock actions to specify `e.g. 8.8.8.8/32 or google.com`.

## [v1.4.0-patch.23] - 2026-05-21
### Changed
- **VyOS Sequences List** (`Vyos.tsx`): Moved the "+ New Sequence" button from the global header down to the Sequences toolbar (next to Search and Sort controls). This improves ergonomics significantly on ultra-wide screens, where the centered table and right-aligned header previously created a large visual disconnect.

## [v1.4.0-patch.22] - 2026-05-21
### Fixed
- **VyOS Edit Modal** (`Vyos.tsx`): Completely replaced the custom `ActionSelector` dropdown (for selecting `Shut`, `Deny Traffic`, etc.) with a native HTML `<select>` element. The previous custom dropdown used absolute positioning which became trapped inside the modal's `overflow-y-auto` boundary, making it "impossible to scroll" or view all actions without scrolling the entire modal body. The native `<select>` effortlessly breaks out of CSS overflow constraints, providing a perfect OS-native experience.

## [v1.4.0-patch.21] - 2026-05-21

### Fixed
- **VyOS Edit Modal** (`Vyos.tsx`): Further refined modal scrolling behavior. Added `min-h-0` to the scrolling body container to ensure the flex child is allowed to shrink below its intrinsic content height (standard CSS Flexbox fix for nested scrolling).

## [v1.4.0-patch.20] - 2026-05-21

### Fixed
- **VyOS Sequences List** (`Vyos.tsx`): Centered the main sequences table and constrained its maximum width (`max-w-6xl mx-auto`) to prevent it from stretching uncomfortably wide on large screens.
- **VyOS Edit Modal** (`Vyos.tsx`): Fixed the modal container height constraints. Restored `overflow-hidden` and `max-h-[85vh]` on the modal wrapper, and added `min-h-0` to the scrollable `flex-1` body. This ensures the modal shrinks appropriately when it only contains one action (avoiding unnecessary empty vertical space), while correctly enabling vertical scrolling when actions exceed the screen height.

## [v1.4.0-patch.19] - 2026-05-21

### Fixed
- **VyOS Edit Modal** (`Vyos.tsx`): Fixed scroll in actions list when adding actions to a new or existing sequence. Root cause: modal container had `max-h-[90vh]` but no explicit height, so `flex-1` inside had no real parent height to fill — replaced with `h-[82vh]` fixed height so `overflow-y-auto` on the body div works correctly.
- **VyOS Edit Modal** (`Vyos.tsx`): Narrowed modal to `max-w-3xl` (centered, less horizontal dead space). Reduced body padding (`p-5 → px-4 py-3`) and footer padding. Cancel/Save buttons more compact (`py-3 → py-2`).

## [v1.4.0-patch.18] - 2026-05-21

### Refactored
- **VyOS Sequences table** (`Vyos.tsx`): Removed accordion — all data now on a single flat line per sequence. Layout: Run button · Name+badge · Command · Router · Interface · Params · Enable toggle · Last run · Clone/Delete. Color-coded left border per command type. Clicking anywhere on the row opens the edit modal.
- **VyOS Edit Modal** (`Vyos.tsx`): Wider (`max-w-4xl`). Header bar collapsed into one horizontal strip: icon · label · Name input (flex-1) · Mode select · Duration select · Close. Removed stacked grid form in favor of the compact single-line header. Consistent `text-[12px]` font size throughout.

## [v1.4.0-patch.17] - 2026-05-21

### Refactored
- **VyOS Sequences** (`Vyos.tsx`): Replaced 3-column card grid with a compact table layout (one row per sequence). Clicking a row expands an inline accordion showing all actions (T+min, command, router, interface, params) with left-border color coding by command type. Controls (Run/Edit/Clone/Delete) use `stopPropagation` so they operate independently of the accordion toggle.
- **VyOS Sequence Edit Modal** (`Vyos.tsx`): Replaced stacked vertical action cards with a horizontal grid table (one action per row). Columns: T+min · Command · Router · Interface · Params · Delete. The Interface column is hidden (shows —) for commands that don't need it (deny-traffic, allow-traffic, clear-all-blocks, show-denied). QoS params (latency/loss/rate) display as three inline mini-inputs.

## [v1.4.0-patch.16] - 2026-05-21

### Added
- **IoT Dashboard** (`Iot.tsx`): Enabled the pencil/edit action on IoT device items in list (compact) mode, matching the edit capability of grid cards.
### Changed
- **Connectivity Performance** (`ConnectivityPerformance.tsx`): Streamlined the probes list view by removing the redundant "View Details" (BarChart3) button on the right, relying entirely on row click to show the detailed modal.

## [v1.4.0-patch.15] - 2026-05-20
### Fixed
- **IoT Advanced Debug Monitor** (`Settings.tsx`, `server.ts`): Moved the historical data collection (last 6 hours / 720 points) from the frontend state to the backend memory. The UI now reliably loads the actual history of system/IoT metrics as soon as you open it, instead of starting from an empty graph and only tracking data while the tab is open.

## [v1.4.0-patch.14] - 2026-05-20
### Fixed
- **Security Modal** (`Security.tsx`): Add "Threat Prevention — Allowed" verdict panel for IPS/EICAR tests that passed. Displays target URL, HTTP response code with label, execution output (bytes downloaded), conclusion and recommended next step. Previously the modal was empty when a threat test was allowed.
- **Security Backend** (`server.ts`): Enrich scheduled EICAR test results with `url`, `command`, `http_code`, `output` and `reason` fields in both allowed and blocked cases. Previously only `{ success, status, endpoint }` was stored, leaving the modal with no data to display.

## [v1.4.0-patch.13] - 2026-05-19
### Fixed
- **IoT Import** (`server.ts`): Call `iotManager.stopAll()` before writing the new device config when importing from a Prisma CSV or Vulnerability Report CSV (non-merge mode). Previously, old devices kept running alongside new ones — when both imports used the same DHCP pool, the new devices could not obtain IP addresses. Cleanup now happens automatically at import time.

## [v1.4.0-patch.12] - 2026-05-19
### Fixed
- **IoT Daemon**: Detect duplicate MAC addresses when starting devices — auto-generate a fresh locally-administered MAC (LAA) if a collision is found, preventing `_sniff_dhcp()` race conditions that caused Vulnerability Report imported devices to never receive a DHCP OFFER when the same MACs were already active from a Device Security Asset import running concurrently.
- **IoT Daemon**: Reduce per-device stagger delay from 2 s/slot to 1 s/slot — 30 devices now boot in ~30 s instead of ~60 s.

## [v1.4.0-patch.0-docs] - 2026-05-12
### Documentation
- **IoT Simulation** 📖 Added complete documentation for `import_prisma_devices.py` in both `IOT_SIMULATION.md` (new Method 3 in device generation section) and `IOT_DEVICE_GENERATOR.md` (full dedicated section with CLI reference, bad behavior logic table, protocol mapping, DHCP fingerprint table, output format, workflow diagram, and updated 3-way comparison table).
- **IoT Simulation** 📸 Added real-world example output (163 devices CSV → 100 by risk → 64 bad-behavior) to illustrate the importer's practical value in customer demo contexts.

## [v1.4.0-patch.11] - 2026-05-19
### Fixed
- **IoT Import Modals** 📱 Wider, scrollable import dialogs for both Device Security Assets and Vulnerability Report importers:
  - `max-w-lg` → `max-w-2xl` (672px) — prevents overflow of long Prisma export filenames (e.g. `cloudsasedemo_vulnerability_detail_..._report.csv`)
  - `flex-col + max-h-[90vh]` on modal container — modal never overflows the screen
  - Content area: `overflow-y-auto` — options scroll independently of header/footer
  - Footer (Cancel / Import button): `shrink-0 + border-t` — always visible, visually separated
  - Filename: `truncate + title={file.name}` — ellipsis on long names, full name on hover

## [v1.4.0-patch.10] - 2026-05-19
### Fixed
- **IoT Import** 🏷️ MAC-address device names now resolved to human-readable profile-based names in both `import_vuln_csv.py` and `import_prisma_devices.py`:
  - `is_mac_like()`: detects `xx:xx:xx:xx:xx:xx` pattern in Device Name field
  - `resolve_device_name()` / updated `make_name()`: fallback chain Profile → Vendor+Model → Vendor+"Device" → "IoT Device"
  - Shared `name_counters` dict per import run: same base name auto-increments (`Raspberry Pi Device #1`, `#2`, `#3`...)
  - Real non-MAC names pass through unchanged

## [v1.4.0-patch.9] - 2026-05-19
### Added
- **IoT Device Cards** 🔍 Description and vulnerability threat intel now displayed on each device card (non-compact mode):
  - **Vuln-imported devices** (`_vuln_meta`): orange threat intel panel with Danger Score badge, CVE count, severity breakdown (Critical/High), Max CVSS, APT group count, ICS-CERT warning, top CVE pills (mono font), APT group names list, OS + Site info
  - **Other devices**: description field shown as inline chip-tags (split by ` | `) or plain italic text
- **Docs** 📖 Updated `IOT_SIMULATION.md`:
  - Added Method 4 — Vulnerability Report Import with full CLI reference, Danger Score formula, expected CSV format, and UI walkthrough
  - New `behavior_type` reference table with cycle/burst/protocol details per attack type (post patch.7 tuning)
  - New Bad Behavior import modes comparison table (Auto vs All vs Percentage vs None) for both importers
  - Auto mode APT/ICS-CERT → behavior_type mapping table
  - Updated all bad behavior timing docs (beacon 10s→45s, dns_flood 15s→60s, etc.)
  - Added Example 7: Full Threat Profile (beacon + port_scan + pan_test_domains)

## [v1.4.0-patch.8] - 2026-05-19
### Added
- **IoT Simulation** 🧨 New **Vulnerability Report** import (Import → Vulnerability Report in IoT toolbar):
  - New script `iot/import_vuln_csv.py` handles Palo Alto CVE/Vulnerability CSV format (one row per CVE per device)
  - Aggregates rows by device (Device Name + IP + MAC), computes a composite **Danger Score** = Risk Score + Critical CVEs×15 + High CVEs×8 + Medium×3 + APT groups×5 + ICS-CERT×10 + Max CVSS×2
  - Selects top N devices by danger score (30 / 50 / 100 / All)
  - APT group associations drive `beacon` behavior; ICS-CERT flag drives `port_scan`; Critical/High CVEs drive `pan_test_domains`
  - Stores CVE metadata in `_vuln_meta` per device (top CVEs, APT groups, ICS flag, danger score)
  - New `POST /api/iot/import-vuln-csv` endpoint in `server.ts`
  - Orange-themed import modal with danger score formula explanation, ICS-CERT count in success banner

## [v1.4.0-patch.7] - 2026-05-19
### Performance
- **IoT Bad Behavior** ⚡ Option B — reduced Scapy raw socket load across all attack handlers to prevent D-state process accumulation under concurrent device load:
  - `dns_flood`: burst 10→**3** queries, sleep 0.5s→1s between, cycle 15s→**60s**
  - `port_scan`: sleep 0.1s→**0.5s** between ports, cycle 30s→**120s**
  - `beacon`: inter-packet 1s→2s, cycle 10s→**45s**
  - `data_exfil`: burst 5→**2** packets, sleep 0.5s→1s between, cycle 20s→**90s**
  - `pan_test_domains`: burst 5→**2** DNS queries, 3→**1** URL targets per cycle, inter-packet 1→2s, cycle 20s→**90s**
  - `random` mix: cycle 5–15s→**20–60s**

## [v1.4.0-patch.6] - 2026-05-19
### Fixed
- **IoT Simulation** 🔢 Device cards are now always sorted by their original sequence index (#1, #2, … #N) regardless of the active state filter (ALL / ACTIVE / QUEUED / IDLE / STOPPED). Previously, the display order was non-deterministic depending on which devices matched the filter.

## [v1.4.0-patch.5] - 2026-05-19
### Added
- **Settings › System** 🔍 New collapsible **IoT Advanced Debug Monitor** section, placed above the Live Docker stats. Polls every **30s** (low-overhead) and stores up to 720 data points in memory (6h coverage). Features 4 time-series charts: Device States (Active/Queued/Idle stacked area), System Health (CPU% · D-state · UDP errors), Traffic Rate (pps · ppm), and Global Experience Score + Voice MOS. Time window selector: **15m / 1h / 6h**. Purple reference lines mark `MaxConcurrent` config changes. Attack Mode (bad behavior) status shown in the toolbar. Designed to capture slow Scapy-induced degradation (D-state process blocking) correlated with concurrency settings.

## [v1.4.0-patch.4] - 2026-05-19
### Fixed
- **IoT Simulation** 🐛 Fixed a critical concurrency starvation bug where devices at the end of the list would never leave the QUEUED state. A proper FIFO queue replaces the map iteration for fairer rotation.
### Added
- **IoT Simulation** 🏷️ Added a persistent absolute device number (e.g., #12) next to each device's name in the UI to easily track devices across filters and states.

## [v1.4.0-patch.3] - 2026-05-19
### Added
- **IoT Simulation** ⏱️ Added cumulative tracking for IoT traffic and state time (Active/Queued/Idle). A beautiful segmented progress bar at the bottom of device cards replaces the old running indicator.

## [v1.4.0-patch.2] - 2026-05-19
### Changed
- **Settings** 🔧 UX: renamed Convergence to Failover in Settings menu for consistency.

## [v1.4.0-patch.1] - 2026-05-18
### Added
- **UI** 📈 Feat: synchronized crosshair + connecting line between Timing & Score charts.

## [v1.4.0] - 2026-05-17
### Changed
- **Release** 🚀 Stable release 1.4.0

## [v1.3.0-patch.106] - 2026-05-17
### Changed
- **IoT** 📱 UX: compact IoT control panel + clickable state filter pills.

## [v1.3.0-patch.105] - 2026-05-17
### Added
- **IoT** 📊 Feat: IoT traffic rate (pps/ppm) in System Health panel.

## [v1.3.0-patch.104] - 2026-05-17
### Performance
- **RTP** ⚡ Perf: replace Scapy with raw UDP socket in rtp.py.

## [v1.3.0-patch.103] - 2026-05-17
### Fixed
- **RTP** 🐛 Fix: revert rtp.py audio to 30ms/33pps (was 20ms/50pps).

## [v1.3.0-patch.102] - 2026-05-17
### Added
- **Voice** 🐶 Feat: watchdog for rtp.py processes in voice_orchestrator.

## [v1.3.0-patch.101] - 2026-05-17
### Fixed
- **IoT** 🐛 Fix: use cached DHCP lease if server unreachable.

## [v1.3.0-patch.100] - 2026-05-17
### Documentation
- **IoT** 📖 Docs: refresh IOT_SIMULATION.md.

## [v1.3.0-patch.99] - 2026-05-17
### Fixed
- **IoT** 🐛 Fix: Shut and Dequeue buttons had no effect.

## [v1.3.0-patch.98] - 2026-05-16
### Fixed
- **IoT** 🐛 Fix: CRITICAL — devices stuck in IDLE/QUEUED, 0 ACTIVE.

## [v1.3.0-patch.97] - 2026-05-16
### Added
- **IoT** ⏱️ Feat: per-device timing info in IoT cards.

## [v1.3.0-patch.96] - 2026-05-16
### Fixed
- **IoT** 🐛 Fix: remove confusing 'Cancel' button on IDLE devices.

## [v1.3.0-patch.95] - 2026-05-16
### Fixed
- **IoT** 🐛 Fix: IoT QUEUED devices never rotating (cycle timers).

## [v1.3.0-patch.94] - 2026-05-16
### Fixed
- **IoT** 🐛 Fix: 3 bugs — MAC normalization, bad behavior none, Clean Mode.

## [v1.3.0-patch.93] - 2026-05-16
### Fixed
- **IoT** 🐛 Fix: IoT UI — QUEUED/IDLE devices no longer show Stopped.

## [v1.3.0-patch.92] - 2026-05-16
### Fixed
- **IoT** 🐛 Fix: IoT semaphore race condition on batch start.

## [v1.3.0-patch.91] - 2026-05-16
### Added
- **IoT** 🚦 Feat: IoT concurrency throttle + live system health.

## [v1.3.0-patch.90] - 2026-05-16
### Added
- **Registry** 🔄 Feat: Registry hot-reload after cloud test / Prisma config save.

## [v1.3.0-patch.89] - 2026-05-16
### Fixed
- **Cloud Target Security — Master Key TEST bug** : Après navigation (ex. Settings → Targets → retour), le champ Master Key se vidait (`cloudMasterKey = ''`). Le bouton TEST envoyait alors `masterKey: ""` au backend au lieu de `undefined`, ce qui empêchait le fallback sur la clé sauvée sur disque → HTTP 401. Fix : `cloudMasterKey.trim() || undefined` pour laisser le backend utiliser `cloud-config.json` quand le champ est vide.
- Ajout de `autoComplete="new-password"` sur l'input pour empêcher l'autofill du navigateur d'injecter une valeur incorrecte dans le champ password vide.
- Placeholder changé en "Leave empty to keep saved key" pour indiquer clairement le comportement attendu.

## [v1.3.0-patch.88] - 2026-05-16
### Added
- **Global Experience Score — sélection des types de probes** : Le score global n'était calculé que sur HTTP/HTTPS et ignorait PING, DNS, UDP, TCP et CLOUD (y compris les probes Stigix Cloud). Désormais, par défaut **tous les types sont inclus**. Un nouveau bloc "Global Experience Score — Probe Types" dans Settings > Probes permet d'activer/désactiver chaque type via des boutons colorés, avec un avertissement orange si des types sont exclus.
- **`connectivity-logger.ts`** : `getStats()` accepte maintenant `globalScoreTypes[]` et filtre dynamiquement les résultats en conséquence. Le compteur HTTP Coverage reste toujours basé sur HTTP/HTTPS uniquement.
- **`server.ts`** : L'API `/api/config/ui` GET et POST supporte maintenant `globalScoreTypes`. Le endpoint `/api/connectivity/stats` lit les types depuis `ui-config.json` et les passe à `getStats()`.

## [v1.3.0-patch.87] - 2026-05-16
### Added
- **Settings.tsx** ⚠️ Validation non-bloquante (Option B) : un badge orange "Not tested" apparaît dans le header Cloud Target Security et un avertissement sous "Save Configuration" de Prisma SASE dès qu'un champ est modifié sans avoir cliqué "Test". Le badge disparaît automatiquement après un test réussi. La sauvegarde reste toujours possible.

## [v1.3.0-patch.86] - 2026-05-16
### Fixed
- **server.ts** 🔗 Normalisation automatique de l'URL du Cloudflare Worker : `https://` est ajouté si absent (ex: `target.stigix.io` → `https://target.stigix.io`), évitant l'erreur "Invalid URL" lors du test de connexion.

## [v1.3.0-patch.85] - 2026-05-16
### Fixed
- **server.ts** 🔧 Les endpoints de test `/api/config/cloud/test` et `/api/security/config/test` lisent maintenant les credentials sauvegardés sur disque (`cloud-config.json`, `prisma-config.json`) comme fallback, résolvant le "Network error" quand aucun champ n'est modifié dans l'UI.
- **server.ts** 🐛 Ajout d'un timeout explicite (`AbortSignal.timeout(10000)`) sur le test Cloudflare Worker. Amélioration du parsing d'erreur Prisma (recherche dans stdout + stderr, détection `ModuleNotFoundError`).

## [v1.3.0-patch.84] - 2026-05-16
### Added
- **Settings.tsx & server.ts** 🔐 Ajout de la validation des "Stigix Master Key" et identifiants "Prisma SASE".
- **Settings.tsx** 🚀 Intégration de boutons "Test" pour vérifier la validité de la clé maître auprès du worker Cloudflare et l'authentification Prisma SASE via `getflow.py`.

## [v1.3.0-patch.83] - 2026-05-16
### Fixed
- **ConnectivityPerformance.tsx** 🎯 Alignement horizontal des graphes Score Over Time et Timing Analysis : les deux axes Y gauches ont maintenant width=50 identique, les zones de dessin démarrent au même pixel.

## [v1.3.0-patch.82] - 2026-05-16
### Added
- **ConnectivityPerformance.tsx** 📈 Global Experience Over Time : carte full-width avec tabs 15m/1H/6H/24H/7D, AreaChart du score global buckété par période, placée entre les KPI et Performance Trends. Le sélecteur de période est partagé avec le reste de la vue.
- **ConnectivityPerformance.tsx** 📊 Per-probe Score Over Time : dans le modal de détail, nouveau graphe LineChart dual-axe (Score couleur type + Latency orange dashed), avec tabs 1H/6H/24H indépendants, placé avant Recent Captures.

## [v1.3.0-patch.81] - 2026-05-16
### Documentation
- **README.md** Version badge mis à jour v1.3.0-patch.80. Ajout de State Persistence dans Features et What's New highlights.
- **docs/IOT_SIMULATION.md** Nouvelle section "State Persistence" : table start/stop → enabled flag → effect at boot.
- **docs/VOICE_SIMULATION.md** Mise à jour "Clean Slate Architecture" → conditionnel selon le toggle State Persistence. Nouvelle section State Persistence.

## [v1.3.0-patch.80] - 2026-05-16
### Improved
- **Settings.tsx** 🏷️ Renomme "Startup Behaviour / Auto-restart" en "State Persistence / Preserve service state across reboots". Les descriptions de chaque toggle reflètent la vraie sémantique : les services reprennent leur état d'avant le reboot, ils ne démarrent pas tous automatiquement.

## [v1.3.0-patch.79] - 2026-05-16
### Fixed
- **server.ts** 🔄 IoT auto-restart on boot now respects the last running state. Start/stop routes (single + batch) now persist `enabled: true/false` in `iot-devices.json`. The boot hook only restarts devices that were actually running (enabled:true) before the shutdown, consistent with Voice behavior.

## [v1.3.0-patch.78] - 2026-05-16
### Improved
- **Settings.tsx** 🔧 4 toggles Startup Behaviour (Traffic, Probes, IoT, Voice) en grille 2x2. Traffic et Probes actifs par defaut (retrocompat). Redesign dark mode : card sobre avec border-border, textes text-text-primary/secondary, lisibles en dark et light mode.
- **Settings.tsx** 🐛 Fix check validite Voice : l'API retourne servers comme une string brute (et non un tableau). Le toggle Voice se debloque maintenant correctement si des serveurs sont configures.
- **server.ts** 🔒 auto_restart_traffic (defaut: true) et auto_restart_probes (defaut: true) dans system-settings.json. Gate startConnectivityMonitor() et traffic force-disable au boot selon les flags.

## [v1.3.0-patch.77] - 2026-05-16
### Improved
- **Settings.tsx** 🔒 Les toggles "Startup Behaviour" (IoT + Voice) sont désormais désactivés avec un message explicatif si aucune configuration valide n'existe (aucun device IoT activé, aucun serveur Voice configuré). Le toggle reste cliquable uniquement si la config est présente et valide. Pendant le chargement, le toggle est en état "pulse" (loading).

## [v1.3.0-patch.76] - 2026-05-16
### Added
- **system-settings.json** 🆕 Nouveau fichier de settings système dédié (`config/system-settings.json`), rétrocompatible (si absent → defaults false = comportement actuel).
- **Settings.tsx** ⚡ Section "Startup Behaviour" proéminente dans l'onglet System Info : 2 toggles pour activer l'auto-restart IoT et Voice au boot.
- **server.ts** 🔄 Hook de démarrage : si `auto_restart_iot=true`, démarre automatiquement les devices IoT activés 15s après le boot du container.
- **voice_orchestrator.py** 🔄 Respect du flag `auto_restart_voice` : ne force plus `enabled=false` au boot si le paramètre est actif, permettant la reprise des appels voix.
- **server.ts** 🛣️ Nouvelles routes `GET/POST /api/config/system-settings`.

## [v1.3.0-patch.75] - 2026-05-16
### Added
- **iot_emulator.py** 📋 Persistance des baux DHCP (RFC 2131 INIT-REBOOT) : chaque IP obtenue par DHCP est sauvegardée dans `/app/config/dhcp_leases.json` (volume persistant Docker).
- **iot_emulator.py** 🔄 Au redémarrage du container, le device tente de reclaimer la même IP via un REQUEST direct (sans DISCOVER) — si le serveur DHCP accepte, même IP garantie.
- **iot_emulator.py** 🛡️ Si le serveur NAK ou ne répond pas (IP hors subnet), fallback automatique sur le DISCOVER classique.
- **iot_emulator.py** 🔒 Si le device n'avait jamais eu d'IP, aucune lease n'est sauvée : comportement inchangé.

## [v1.3.0-patch.74] - 2026-05-16
### Fixed
- **ConnectivityPerformance.tsx** 🐛 Le filtre TimeRange fonctionne maintenant réellement : la limite API est désormais dynamique selon la plage (15m=300, 1h=1500, 6h=5000, 24h=12000, 7d=30000).
- **ConnectivityPerformance.tsx** 🗑️ Suppression des boutons graphTimeRange morts (jamais connectés aux données).
- **connectivity-logger.ts** 🐛 Ajout du case manquant '15m' dans getResults() (existait dans getStats mais pas dans getResults).
- **ConnectivityPerformance.tsx** ⚡ Plage par défaut changée de '24h' à '1h' pour un chargement initial plus rapide.

## [v1.3.0-patch.73] - 2026-05-15
### Changed
- **Iot.tsx** 🗑️ Suppression du widget "Scale & Monitoring" — bruit visuel inutile.
- **Iot.tsx** 📐 Correction de l'alignement du header (min-w-0, flex-shrink, whitespace-nowrap sur les liens).

## [v1.3.0-patch.72] - 2026-05-15
### Fixed
- **Iot.tsx** 🎯 Correction de l'alignement de la barre de sélection dans l'en-tête (flex-shrink-0 + whitespace-nowrap).
- **Iot.tsx** 🔵 Agrandissement du bouton Start/Shut sur les cartes d'appareils (py-3.5, text-sm, Power size=18).

## [v1.3.0-patch.71] - 2026-05-15
### Fixed
- **voice_orchestrator.py** ⏱️ Correction du calcul de `num_packets` pour utiliser l'intervalle de 20ms (0.02s) — les appels durent maintenant exactement la durée configurée.
- **voice_orchestrator.py** 🔧 Passage du paramètre `--stream-type` à `rtp.py` depuis la configuration serveur.

## [v1.3.0-patch.70] - 2026-05-15
### Fixed
- **rtp.py** 🐛 Correction de l'erreur `AttributeError: ssrc` (Scapy utilise le nom de paramètre `sourcesync` au lieu de `ssrc`).

## [v1.3.0-patch.69] - 2026-05-15
### Fixed
- **rtp.py** 🛠️ Correction critique de la gestion des timestamps RTP (incrément de 160 pour l'audio, 900 pour la vidéo) pour la conformité App-ID.
- **rtp.py** 🎲 Randomisation du SSRC pour simuler un véritable équipement de téléphonie/vidéo.

## [v1.3.0-patch.68] - 2026-05-15
### Improved
- **rtp.py** 🎙️ Optimisation du flux audio par défaut (20ms / 160 octets) pour une meilleure reconnaissance App-ID (rtp-audio).
- **rtp.py** 📹 Ajout du support expérimental pour la simulation de flux vidéo (--stream-type video).
- **rtp.py** ⚙️ Calcul dynamique des longueurs d'en-tête IP/UDP pour une conformité protocolaire parfaite.

## [v1.3.0-patch.67] - 2026-05-15
### Documentation
- **IoT Simulation** 📚 Mise à jour de la documentation avec les nouvelles captures d'écran de l'interface d'import.
- **IoT Simulation** 📖 Amélioration du guide d'importation des actifs Device Security.

## [v1.3.0-patch.66] - 2026-05-15
### Changed
- **IoT Simulation** 🤖 Refonte de l'interface d'importation : regroupement des actions dans un menu déroulant unique.
- **IoT Simulation** 📄 Clarification de l'import CSV (Palo Alto Device Security) avec des descriptions détaillées pour guider l'utilisateur.
- **UI/UX** ✨ Amélioration des animations et de la structure visuelle de la barre d'outils IoT.

## [v1.3.0-patch.65] - 2026-05-15
### Fixed
- **rtp.py** 📞 Correction d'un bug d'affichage dans les logs : le port source affichait `31000+N` alors que le code utilisait bien `30000+N`.
- **rtp.py** 🧹 Nettoyage du code source (suppression des blocs commentés obsolètes) et ajout de logs de debug pour la dérivation du port source via le CALL-ID.

## [v1.3.0-patch.64] - 2026-05-13
### Fixed
- **ConnectivityPerformance** 📊 Le graphe de décomposition de latence dans le modal de détail d'un probe utilisait `slice(0, 30)` en dur — remplacé par `slice(0, maxCaptures)` pour respecter le paramètre "Number of Recent Captures" configuré dans Settings
- **Settings** 📝 Texte de la section "History Display Settings" clarifié : précise maintenant que le slider contrôle la table ET le graphe du modal, et que la fréquence des probes (1 min) est fixée côté serveur et ne peut pas être changée depuis l'UI

## [v1.3.0-patch.63] - 2026-05-13
### Added
- **Security History** 🏷️ Dropdown filter renommé : options désormais `URL Filtering`, `DNS Security`, `Threat Prevention`, `C2 Scenario`, `AI Security` et `All Types` (plus clair que `URL Lists` etc.)
- **Security History** 📊 Colonne `Change` renommée en `Delta` — reflète mieux le contenu (variation de statut entre deux runs)
- **URL Test Modal** 🔍 Panel verdict enrichi pour les URL filtering tests :
  - **Allowed** : confirme le code HTTP, indique si la vraie page PANDB Palo Alto a été servie, message rassurant
  - **Blocked** : code HTTP reçu, mécanisme de blocage (in-band block page vs policy drop), catégorie concernée, Next Step vers les logs NGFW

## [v1.3.0-patch.62] - 2026-05-13
### Fixed
- **VyOS History CLI** 🐛 Correction du CLI généré pour `deny-traffic` / `allow-traffic` / `clear-all-blocks` : le mécanisme réel utilise des **routes blackhole statiques avec tag 999** (et non des règles firewall). Les commandes affichées sont maintenant :
  - Block : `set protocols static route <prefix> blackhole tag 999`
  - Unblock : `delete protocols static route <prefix>`
  - Clear all : `delete protocols static route <prefix>` (une par route)

## [v1.3.0-patch.61] - 2026-05-13
### Added
- **VyOS History** 🖥️ CLI accordion expand: click any row in the History table to reveal a dark terminal panel with the exact VyOS CLI commands pushed. Works in both flat and grouped views.
  - New entries store `cli_equivalent` directly in `vyos-history.jsonl` (backend fix in `vyos-scheduler.ts`).
  - Legacy entries (pre-patch.61) fall back to client-side CLI generation from `command + interface + parameters` via `generateCliEquivalent()`.
  - Subtle `>_` indicator on each row lights up cyan when the terminal is open.
  - COPY button clips the commands to clipboard without closing the accordion.

## [v1.3.0-patch.60] - 2026-05-13
### Changed
- **Settings** 📊 Traffic Distribution Overview: redesigned as **dual-zone bar**. Left zone (w-24, fixed) = blue gradient gauge normalized to the heaviest category — preserves visual comparison between groups. Right zone (flex-1) = always 100% filled with app icons/names — zero wasted gray space. The % label moves inside the gauge. Header hint "◀ weight · apps ▶" explains the two zones.

## [v1.3.0-patch.59] - 2026-05-13
### Changed
- **Docs** 🖼️ Reduced screenshot sizes in `docs/IOT_SIMULATION.md` for better readability.

## [v1.3.0-patch.58] - 2026-05-13
### Changed
- **Settings** 📐 Traffic Distribution Overview: reverted 2-column grid in favour of **maximised single-column bars** — label column narrowed `w-56` → `w-32` (128px) giving bars ~80% more horizontal room. Bar height raised `h-5` → `h-7`. App label threshold lowered (icon+text visible at >12% instead of >18%, icon-only at >3% instead of >6%) so more apps show their favicon and name directly in the bar.

## [v1.3.0-patch.57] - 2026-05-13
### Changed
- **Settings** 📐 Traffic Distribution Overview: switched from single-column list to **2-column grid** layout. Reduces vertical space by ~50% (from 17 full-width rows to 9 rows × 2 columns). Label column narrowed from `w-56` → `w-40`, bar height `h-6` → `h-5`, row gap tightened.

## [v1.3.0-patch.56] - 2026-05-13
### Changed
- **IoT** 🏷️ Renamed "Import Prisma CSV" button to **"IoT Security CSV"** — clearer reference to the actual Palo Alto product (Prisma Access → Device Security → IoT Security). Updated button label, modal title, and doc.

## [v1.3.0-patch.55] - 2026-05-13
### Added
- **IoT** 🧬 Prisma CSV import — three enrichment improvements to `import_prisma_devices.py`:
  1. **OS-aware DHCP fingerprinting**: added `OS_DHCP_FINGERPRINTS` dict (Windows → `MSFT 5.0`, iOS → `dhcpcd-9.4.1`, Linux/Embedded → `udhcp`, Enea OSE, FortiOS, macOS). OS fingerprint overrides vendor-based default when `os group` or `OS` column is populated.
  2. **Fix protocol column**: switched from `display_apps` (always empty in real exports) to `Applications` → `display_apps` → `display_protos` fallback chain. Devices now get much richer protocol sets.
  3. **Asset Criticality as secondary bad-behavior signal**: when `ml_risk_level` is missing, `Asset Criticality = Critical|High` triggers bad behavior.
  4. **Enriched description**: now includes OS, risk level, criticality, wire/wireless, and VLAN info.
### Changed
- **Docs** 📖 Updated `docs/IOT_SIMULATION.md` Prisma CSV Import section to document OS-aware DHCP, UI import button, enriched description, and correct CLI examples.

## [v1.3.0-patch.54] - 2026-05-13
### Fixed
- **IoT** 🔤 Prisma CSV import: fixed vendor name duplication in generated device names ("HP HP Computer" → "HP Computer", "Atlas Atlas Copco" → "Atlas Copco Torque Controller"). Added `make_name()` helper that checks if the model string already starts with the vendor first-word (case-insensitive, ignoring punctuation like commas) before prepending it.

## [v1.3.0-patch.53] - 2026-05-13
### Fixed
- **IoT** 🐛 Prisma CSV import: script path now uses `PROJECT_ROOT` (same mechanism as other Python scripts) instead of `__dirname`-relative path. Fixes `No such file or directory` error in Docker where `__dirname = /app` and `../iot/` resolved to `/iot/` instead of `/app/iot/`.

## [v1.3.0-patch.52] - 2026-05-13
### Added
- **IoT** 📥 New **Import Prisma CSV** button in the IoT Simulation header. Uploads a Prisma Access / IoT Security device export CSV, runs `import_prisma_devices.py` server-side, and imports the resulting devices directly — no manual CLI steps required. Options: max devices (30/50/100/All), IoT-only filter, bad behavior mode (Auto from risk level / All / Percentage / None), and Merge vs Replace. Includes client-side CSV header validation to detect invalid or wrong file format before the backend is called.

## [v1.3.0-patch.51] - 2026-05-13
### Fixed
- **Targets** 🐛 Fixed infinite re-appear cycle when deleting a target that was also present in `convergence-endpoints.json` or `voice-config.json`. `deleteTarget()` now removes the host directly from those source files instead of relying on a "promote + disable" workaround that users could break by deleting the disabled entry. The promote+disable path is preserved only for registry (`reg-*`) and env-var-derived targets that cannot be edited locally.

## [v1.3.0-patch.50] - 2026-05-13
### Fixed
- **IoT** 📐 Device cards in the grid view now maintain consistent height whether or not bad behavior badges are shown. The behavior badge container always renders with `min-h-[22px]`, preventing the Start button from shifting down on cards with active attack types.

## [v1.3.0-patch.49] - 2026-05-13
### Fixed
- **Registry** 🛡️ Defense-in-depth self-exclusion in `getPeers()` — node now explicitly skips its own `instance_id` from the peer cache, regardless of whether the registry (local or Cloudflare) filtered it out. Prevents inflated `peer_count`, loopback XFR/Voice/Convergence tests, and self-loops in the topology view.

## [v1.3.0-patch.48] - 2026-05-13
### Changed
- **Traffic Control** 🌐 Renamed `Speedtest` button to `Internet Speedtest` and replaced the `Gauge` icon with `Globe` to clearly distinguish it from the XFR/iperf internal bandwidth test.

## [v1.3.0-patch.47] - 2026-05-13
### Added
- **Traffic Control** ⚡ Added a `Configure Distribution` shortcut button below the Traffic Generation status line. Clicking it deep-links directly to Settings → Traffic Distribution — same mechanism as the "Manage Probes" button.

## [v1.3.0-patch.46] - 2026-05-13
### Fixed
- **Traffic Distribution** 📐 Distribution Overview panel now wrapped in `max-w-7xl mx-auto` to align with the slider blocks below it. Group name column widened from `w-40` (160px) to `w-56` (224px) to prevent truncation of long category names.

## [v1.3.0-patch.45] - 2026-05-13
### Added
- **Traffic Distribution** 🗂️ Category groups are now collapsible — click the header to fold/unfold. App count badge visible in header even when collapsed. Chevron rotates on state change.
### Fixed
- **Traffic Distribution** 🔓 Removed the artificial 4-app limit per group. All apps now render with individual sliders regardless of group size.

## [v1.3.0-patch.44] - 2026-05-13
### Fixed
- **Build** 🐛 Docker build failure: `Cannot find name 'BarChart3'` — added missing `BarChart3` import from `lucide-react` in `Settings.tsx`.

## [v1.3.0-patch.43] - 2026-05-13
### Added
- **Traffic Distribution** 📊 New **Distribution Overview** panel above the sliders — one compact row per category showing a stacked horizontal bar. Each segment is proportional to the app's global traffic weight, displays the app favicon + domain name (adaptive to segment width), and shows a tooltip with exact % on hover.

## [v1.3.0-patch.42] - 2026-05-13
### Fixed
- **Navigation UX** 🧭 The "Manage Probes" button in Digital Experience now correctly selects the **Synthetic Probes** sub-menu when navigating to Settings, instead of defaulting to Traffic Distribution.

## [v1.3.0-patch.41] - 2026-05-13
### Changed
- **Security Dashboard** 🏷️ Unified all test verdict labels under a single vocabulary: `Blocked` / `Allowed` / `Inconclusive` — applies to URL Filtering, DNS Security, EICAR, C2 Scenarios, and AI Security tests.
  - `Enforced` (C2/AI) → displayed as **Blocked** (red)
  - `Bypass` (C2/AI) → displayed as **Allowed** (green)
  - `Inconclusive` and `Completed` added as proper states in the unified `getStatusBadge` component
  - Removed `getAIVerdictBadge` / `getC2VerdictBadge` — all test types now use a single `getStatusBadge`
  - Fixed "Bypass" label in EICAR statistics card and Cloud probe summary → now reads "Allowed"
  - Toast notifications for C2/AI results updated accordingly
- **docs/SECURITY_TESTING.md** 📖 Updated all verdict tables and descriptions to reflect the new Blocked/Allowed vocabulary.

## [v1.3.0-patch.40] - 2026-05-13
### Fixed
- **URL Filtering Tests** 🔍 Added `preDnsCheck` pre-resolution step before every curl URL test. A fast `nslookup -timeout=4` now runs first; if the hostname is unresolvable (NXDOMAIN or DNS timeout), the test immediately returns `dns_error` without launching curl. This eliminates the "first test = misleading 10s CONNECTION_TIMEOUT, second test = correct DNS_RESOLUTION_FAILURE" artifact caused by slow first-query DNS proxy resolution in the container.

## [v1.3.0-patch.39] - 2026-05-12
### Added
- **Security Dashboard** 🔗 The "Requires STIGIX_TARGET_MASTER_KEY" warning on the Stigix Cloud EICAR target is now a clickable link. Clicking it navigates directly to Settings → Cloud Target Security and auto-scrolls to the key configuration panel, eliminating the need for manual navigation.

## [v1.3.0-patch.38] - 2026-05-12
### Changed
- **UI Readability** 🎨 Proportional font scale: bumped base `font-size` from `16px` to `17px` so all rem-based Tailwind sizes (text-xs, text-sm, text-base, KPI numbers) scale ~6% together. Added CSS overrides for hardcoded pixel sizes (`text-[9px]` → 10px, `text-[10px]` → 11px, `text-[11px]` → 12px) to preserve visual hierarchy across widget labels.

## [v1.3.0-patch.37] - 2026-05-12
### Changed
- **UI Readability** 🎨 Dark-mode contrast improvements: brightened `--text-muted` CSS token (from `#64748b` to `#7c8fa8`) for improved legibility of secondary labels. Updated font stack to use native system fonts (SF Pro on macOS, Segoe UI on Windows) for sharper text rendering. Navigation tabs bumped from `text-xs` (12px) to `text-sm` (14px). Accent pills and active tab colors updated to `blue-300`/`purple-300` variants for better contrast on dark backgrounds.

## [v1.3.0-patch.36] - 2026-05-12
### Changed
- **Security Dashboard** 🏷️ Renamed test history table headers for better semantic clarity: "Test #" → "Type" (showing URL/DNS/EICAR/C2/AI badge), "Disposition" → "Result" for more intuitive reading of test outcomes.

## [v1.3.0-patch.35] - 2026-05-12
### Fixed
- **Deploy** 🐛 Corrected `COMPOSE_URL` override in `install-latest-beta.sh` to point to the correct beta compose file instead of the production stable one.

## [v1.3.0-patch.34] - 2026-05-12
### Added
- **Deploy** 🧪 New `install-latest-beta.sh` script for testing pre-release deployments. Uses the `latest` Docker image tag and a dedicated beta compose file to allow safe testing of new features before stable promotion.
### Fixed
- **Deploy** 🔑 Applied `JWT_SECRET` auto-generation fix to `install.sh` to prevent fresh installs from using an empty or default secret.

## [v1.3.0-patch.33] - 2026-05-12
### Fixed
- **Security** 🛡️ Resolved a false-positive "offline" status for EICAR targets. Reachability checks now use the UDP convergence port instead of a generic HTTP probe, eliminating incorrect offline classification for EICAR cloud targets.

## [v1.3.0-patch.32] - 2026-05-11
### Documentation
- **Changelog** 📝 Backfilled CHANGELOG with all patches since `patch.16`, bringing the release history up to date.

## [v1.3.0-patch.31] - 2026-05-11
### Changed
- **IoT Simulation** 🔧 Replaced dynamic local sample generation with a direct download link to a clean, centralized `iot-devices.json` configuration file hosted on GitHub.

## [v1.3.0-patch.30] - 2026-05-11
### Fixed
- **IoT Simulation** 🧹 Sanitized IoT device persistence logic: runtime states (`running` flags and raw execution logs) are now automatically stripped before saving or exporting configurations, preventing config file bloat and import issues.

## [v1.3.0-patch.29] - 2026-05-11
### Refactored
- **IoT Simulation** 🔄 Replaced dynamic local sample generation with a direct GitHub download link for the sample `iot-devices.json`. Renamed the uploaded sample config for clarity.

## [v1.3.0-patch.28] - 2026-05-11
### Added
- **Security Dashboard** ⚠️ Added visual warnings and disabled Cloud EICAR targets when the `STIGIX_TARGET_MASTER_KEY` environment variable is missing, preventing silent execution failures.

## [v1.3.0-patch.27] - 2026-05-10
### Fixed
- **System** 🐛 Resolved a critical Temporal Dead Zone (TDZ) startup crash on fresh installations caused by uninitialized path references in the `fs.writeFileSync` interceptor.

## [v1.3.0-patch.26] - 2026-05-10
### Fixed
- **Security Dashboard** 🎨 Cleaned up test detail modal typography: consistent `curl` command display formatting and removed excessive uppercase styling from modal content.

## [v1.3.0-patch.25] - 2026-05-10
### Fixed
- **Security Dashboard** 🧹 Removed duplicate "Disposition Reasoning" block that appeared twice in the Security Test Details modal.

## [v1.3.0-patch.24] - 2026-05-10
### Fixed
- **Security Dashboard** 🔡 Removed `text-transform: uppercase` from modal content in Security test details for improved readability of long URLs and hostnames.

## [v1.3.0-patch.23] - 2026-05-10
### Fixed
- **Security Dashboard** 🔧 Enriched URL test diagnostic views with explicit `curl` error classification (connection refused, timeout, SSL error, HTTP code) and consistent curl command string display in the execution log.

## [v1.3.0-patch.22] - 2026-05-10
### Added
- **Security Dashboard** 📤 Introduced full Import and Export capabilities for Security Profiles, enabling backup and transfer of custom testing catalogs between Stigix instances.

## [v1.3.0-patch.21] - 2026-05-10
### Fixed
- **Security Framework** 🛡️ Used `EMBEDDED_SECURITY_PROFILE` as fallback in `getSecurityProfile()` when the JSON file is missing or corrupted, preventing a blank security profile on upgrade.

## [v1.3.0-patch.20] - 2026-05-10
### Fixed
- **Security Framework** 🔄 Force-overwrite `security-profile.json` if the file exists but is empty or malformed (e.g. after a failed upgrade), ensuring a valid catalog is always present.

## [v1.3.0-patch.19] - 2026-05-10
### Fixed
- **Security Framework** 🐛 Fixed a `TDZ ReferenceError` (`Cannot access 'X' before initialization`) in `ensureSecurityProfile()` caused by a circular import ordering issue on Node.js startup.

## [v1.3.0-patch.18] - 2026-05-10
### Fixed
- **Security Framework** 🔁 Added automatic `security-profile.json` generation on container upgrade: if the file is absent (first install or upgrade from older version), it is bootstrapped from the embedded catalog without requiring a manual reset.

## [v1.3.0-patch.17] - 2026-05-10
### Added
- **Security Framework** ⚙️ Phase 1 — Externalized the previously hardcoded security test catalog into a standalone `security-profile.json` file. Enables per-instance customization of test targets, categories, and expected verdicts without rebuilding the image.
### Documentation
- **Documentation** 📖 Added a comprehensive Azure deployment guide (`AZURE_INSTALL.md`) covering VM sizing, NSG rules, Docker setup, and one-liner install.

## [v1.3.0-patch.16] - 2026-05-10
### Added
- **Documentation Overhaul** 📖 Massive visual update across all core modules:
    - **Convergence Lab**: Added 5 high-fidelity screenshots documenting live failover monitoring and historical timeline deep-dives.
    - **IoT Simulation**: Added 4 screenshots covering the new device gallery, bad behavior configuration, and real-time Scapy logs.
    - **VoIP Simulation**: Added 4 screenshots illustrating the deterministic source port mapping (31000+) and per-target QoS statistics.
    - **VyOS Control**: Added 6 screenshots showcasing automated impairment missions, sequence editing, and live mission timelines.
- **Documentation Style** 🎨 Harmonized all visual assets with descriptive, premium-style captions for improved technical clarity.
- **README** 📊 Updated Statistics and VoIP counts in the main project gallery to reflect the new documentation depth.

## [v1.3.0-patch.15] - 2026-05-10
### Added
- **Network Status** 🌍 Added a country flag emoji next to the Public IP address in the Network Status widget, derived from a geo-IP lookup, for instant visual identification of the egress region.

## [v1.3.0-patch.14] - 2026-05-10
### Fixed
- **Connectivity Dashboard** 🎨 Fixed vertical alignment of `TYPE` and `STATUS` badge elements in the Connectivity probes table so they align consistently across all row heights.

## [v1.3.0-patch.13] - 2026-05-10
### Fixed
- **Connectivity Dashboard** 📐 Fixed text alignment of metrics values (Avg/Min/Max scores) displayed in the Last Score column to ensure consistent right-alignment and prevent visual misalignment on varying screen widths.

## [v1.3.0-patch.12] - 2026-05-10
### Changed
- **Connectivity Dashboard** 📈 Displayed the `Avg`, `Min`, and `Max` scores directly under the `Last Score` column in the main probes table for immediate visibility.


## [v1.3.0-patch.11] - 2026-05-10
### Changed
- **Connectivity Dashboard** 🎨 Improved the Probe detail modal:
  - Hidden HTTP-specific timing columns (DNS, TCP, TLS, TTFB, HTTP Code) for non-HTTP/CLOUD probes (e.g., PING, UDP) for a cleaner UI.
  - Added a distinct probe type badge directly in the modal title.
  - The entire row in the main dashboard table is now clickable to open probe details.
  - Renamed "Manage Endpoints" button to "Manage Probes".
- **Connectivity Dashboard** 📊 Added underlying data model tracking for minimum and maximum probe scores to support future notification triggers.

## [v1.3.0-patch.10] - 2026-05-09
### Fixed
- **VyOS Engine** 🛡️ Added a fallback mechanism for `deny-traffic` (simple-block) to automatically support mixed fleets of VyOS devices. If a router rejects the modern VyOS 1.4/1.5 syntax (tag as a child of blackhole), the engine will seamlessly catch the 400 error and retry with the legacy syntax (tag as a sibling of blackhole).

## [v1.3.0-patch.9] - 2026-05-09
### Fixed
- **VyOS Engine** 🐛 Fixed an issue where `deny-traffic` (simple-block) failed on newer VyOS versions (1.4/1.5) with a `400 Bad Request`. The API payload now correctly places the `tag` node as a child of the `blackhole` node instead of a sibling, aligning with the updated VyOS CLI syntax.

## [v1.3.0-patch.8] - 2026-05-09
### Changed
- **Security Dashboard** 🎨 Added a "BETA" badge to the **C2 Attack Scenarios** and **AI Security Tests** panels to indicate their new status.
- **Security Dashboard** 📏 Fixed header alignment in the AI Security Tests and C2 Attack Scenarios panels for better visual consistency.

## [v1.3.0-patch.7] - 2026-05-09
### Changed
- **Security Dashboard** 🎨 Refined the detailed test result modal:
    - Renamed **Telemetry Diagnostic** to **Security Test Details** for better clarity.
    - Renamed **Detailed Observation Log** to **Detailed Execution Log**.
    - Renamed **Diagnostic Error Signature** to **Test Error Signature**.
    - Renamed **Cloud Diagnostic** to **Cloud Execution Context**.
    - Renamed the footer button to **Close Details**.
- **Security Dashboard** 🧹 Cleaned up typography and spacing in the detail modal headers.

## [v1.3.0-patch.6] - 2026-05-08
### Added
- **AI Security Tests** 🤖 New dedicated **AI Security** panel in the Security dashboard mirroring the Palo Alto AISA PowerShell simulation script. Includes 5 scenarios: DLP Credit Card extraction, Prompt Injection/Jailbreak, Misfortune Cookie (CVE-2014-9222), EICAR Malware Upload to AI apps, and Volume Traffic Generator (24 AI apps across 6 categories). 🚀
- **AI Security Backend** `POST /api/security/ai-test` and `POST /api/security/ai-test-batch` routes — each scenario runs `curl` against live AI app endpoints (ChatGPT, Grok, Gemini, Perplexity) and aggregates verdicts across all targets.
- **AI Security Scheduler** ⏰ Configurable periodic scheduler for AI Security scenarios — identical to DNS/URL/C2 scheduler controls. Config key: `scheduled_execution.ai`.
- **Verdict System** `Enforced` (green) / `Bypass` (red) / `Completed` (cyan, volume test only) / `Inconclusive` (orange) — inverted logic consistent with C2 module.
- **Security Log** 🏷️ `AIS` badge type (cyan) in the Security Test Log; `AI Security` filter option in the history dropdown.
- **shared/security-categories.ts** `AI_SECURITY_SCENARIOS`, `AI_PRIORITY_APPS`, `AI_VOLUME_APPS` exports with `AISecurityScenario` interface.
- **test-logger.ts** Extended `TestResult` to support `type:'ai'` and status `'completed'`; updated `LogStats` stats counters.
### Documentation
- **docs/SECURITY_TESTING.md** (v3.1) Comprehensive **AI Security Tests** section documenting all 5 scenarios with exact execution sequences, PowerShell script equivalents, verdict rules, troubleshooting guides, and SSL Inspection requirements. 📖

## [v1.3.0-patch.5] - 2026-05-08
### Fixed
- **Build** 🐛 Docker build failed with `TS2304: Cannot find name 'SchedulerControl'` — renamed to the correct `SchedulerSettings` component and widened its `type` prop union to include `'c2'`. Previously the C2 scheduler panel referenced a non-existent component name.
- **Security.tsx** Widened `updateSchedule` function type from `'url' | 'dns' | 'threat'` to `'url' | 'dns' | 'threat' | 'c2'` to resolve implicit `any` TypeScript errors on C2 scheduler callbacks.

## [v1.3.0-patch.4] - 2026-05-08
### Fixed
- **Security Log** 🐛 C2 entries now show badge `C2S` (was incorrectly showing `THREAT`) — root cause: `TestLogger` was receiving `type:'threat'` instead of `type:'c2'` for all c2_scenario entries
- **Security Log** 🐛 C2 disposition now shows `Enforced` / `Bypass` / `Inconclusive` (was showing `Unknown`) — root cause: `TestResult.status` type union didn't include C2 verdict values, and `result` object wasn't reconstructed with full details from logger
- **Test Logger** Extended `TestResult` interface to support `type:'c2'` and status values `'enforced' | 'bypass' | 'inconclusive'`; updated `LogStats` accordingly

### Added
- **C2 Panel** ⏰ C2 Scheduler — configurable interval (5/10/15/30/45/60m) + enable toggle + next run time display, identical to DNS and URL scheduler controls
- **Backend** Scheduled C2 runner (`runScheduledC2Tests`) fires all 7 scenarios sequentially on the configured interval; integrated into `startSchedulers()` with 800ms inter-test delay
- **Backend** `scheduled_execution.c2` added to `DEFAULT_SECURITY_CONFIG` and auto-migration guard for existing configs

## [v1.3.0-patch.3] - 2026-05-08
### Added
- **Security Dashboard** 📋 C2 scenario cards now show the last verdict badge inline (Enforced/Bypass/Inconclusive) — same behavior as DNS and URL cards in the screenshot.
- **Backend** 🔍 Each C2 scenario now produces a detailed step-by-step sequence log in `details.output`, visible in the Telemetry Diagnostic modal. Includes exact command, intent, engine, raw output, and verdict decision per step.
- **Documentation** 📖 New comprehensive `C2 Attack Scenarios` section in `docs/SECURITY_TESTING.md` (v3.0): exact test sequence, PowerShell equivalents, verdict rules tables, per-scenario firewall engine requirements, and full troubleshooting guide for each of the 7 scenarios.

## [v1.3.0-patch.2] - 2026-05-08
### Added
- **Security Dashboard** 🎯 New **C2 Attack Scenarios** panel in the Security page, reproducing the exact 7-step Prisma Access security simulation script (SQL Injection, DNS C2 Infiltration, Greyware DNS, Compromised DNS, Sliver C2 Emulation, EICAR over HTTPS, DNS Tunneling Burst).
- **Backend** 🔌 Two new API routes: `POST /api/security/c2-test` (individual scenario) and `POST /api/security/c2-test-batch` (batch). Each scenario mirrors the PowerShell reference script: `nslookup ... 8.8.8.8` for DNS scenarios, `curl` for HTTP/HTTPS ones.
- **Verdict System** 🚦 Inverted verdict logic for C2 tests: `Enforced` (green) = threat was blocked/sinkholed, `Bypass` (red) = policy gap detected, `Inconclusive` = timeout/error.
- **Security Test Log** 📋 New `C2S` badge type in the log table, dedicated filter option "C2 Scenarios" in the dropdown, and correct "C2 Simulation" label in the Telemetry Diagnostic modal.
- **shared/security-categories.ts** 📦 New `C2_SCENARIOS` export with `C2Scenario` interface including CLI hint commands for each scenario.

## [v1.3.0-patch.1] - 2026-05-05
### Fixed
- **Web Dashboard**: 🐛 Fixed an issue where the `PORT` environment variable specified in `docker-compose.yml` was ignored. The dashboard port is no longer hardcoded to `8080` in `supervisord.conf`, allowing custom port bindings like `- PORT=8085` to work correctly.


## [v1.3.0] - 2026-05-04
### Changed
- **Version Bump**: 🚀 Milestone release bumping the version to 1.3.0. This release consolidates all recent feature additions, VyOS orchestration integrations, and UI enhancements into a stable minor version.

## [v1.2.2-patch.172] - 2026-05-04
### Fixed
- **Web Dashboard**: 🐛 Fixed an issue in the Failover Monitoring (Convergence Lab) view where the stop button for an individual target in the "Stigix Targets" list remained greyed out and unclickable while a test was actively running.

## [v1.2.2-patch.171] - 2026-05-04
### Fixed
- **VyOS Engine**: 🐛 Fixed a bug where `allow-traffic` (simple-unblock) failed with "not blocked (tag 999 not found)" because the REST API parser was incorrectly looking for the `tag` attribute nested inside the `blackhole` presence node instead of as a sibling route attribute.
- **Web Dashboard**: 🧹 Fixed visual clutter in the Sequence Timeline where impairment parameters (latency, loss, rate) were incorrectly rendered for non-QoS actions like `deny-traffic`.
- **Web Dashboard**: 🧹 Fixed the Sequence Editor so that switching an action command (e.g. from `set-qos` to `deny-traffic`) automatically scrubs incompatible parameters from the configuration payload.

## [v1.2.2-patch.170] - 2026-04-30
### Changed
- **Web Dashboard**: 🔎 Enhanced history search. The sequence history search bar now comprehensively filters through human-readable router names, executed commands, target interfaces, parameters, and execution results (errors & status) simultaneously.

## [v1.2.2-patch.169] - 2026-04-30
### Added
- **Web Dashboard**: 🔍 Introduced a dynamic search bar in the VyOS sequence manager to instantly filter sequences by name, router focus, or underlying actions.
- **Web Dashboard**: 🔀 Added intelligent sorting to group sequences by target router, action command type, alphabetical name, or most recently executed.
- **Web Dashboard**: 🔄 Implemented "Clone to Reverse" functionality to automatically generate inverse automation sequences (e.g., swapping `interface-down` for `interface-up`, `set-qos` for `clear-qos`) with a single click.

## [v1.2.2-patch.168] - 2026-04-28
### Added
- **IoT DHCP**: In-kernel **BPF filter** (`udp src port 67 dst port 68`) replaces slow Python `lfilter` for DHCP packet capture — runs in the kernel before Python, no more missed ACKs under load. `stop_filter` terminates sniff immediately on XID match. ⚡
- **IoT DHCP**: **OFFER-without-ACK fallback** — 3-level hierarchy:
  1. ✅ Full ACK received → IP confirmed from DHCP server (best)
  2. 🟡 OFFER received but ACK timed out (unicast ACK dropped by kernel, DHCP snooping, etc.) → uses offered IP + detects host gateway from `ip route show default` → sends gratuitous ARP
  3. ❌ No OFFER at all → device stays silent until renewal loop retries
- **IoT DHCP**: `_get_host_gateway()` helper reads the host routing table as gateway fallback when no DHCP ACK is available. 🌐
- **IoT DHCP**: `_sniff_dhcp()` reusable helper shared by OFFER and ACK capture steps.
- **IoT DHCP**: `_dhcp_attempt()` now returns `'ack_ok' | 'offer_no_ack' | 'no_offer' | 'error'` instead of `bool` for full fallback context. 🔄

## [v1.2.2-patch.167] - 2026-04-28
### Fixed
- **IoT DHCP**: `self.ip` was assigned at REQUEST time (from the OFFER) before ACK confirmation. If ACK timed out, the stale offered IP leaked into `self.ip` — `_boot_sequence()` saw a non-null IP and started protocol threads with a ghost IP and no gateway (`HTTP SYN to None:80`). 🐛
  - Fix: removed premature `self.ip = dhcp_offered_ip` from REQUEST block.
  - `self.ip` is now exclusively set at line `msg_type == 5` (ACK confirmed).
  - `do_dhcp_sequence()` explicitly resets `self.ip = None` and `self.gateway = None` after all retries exhaust without success.

## [v1.2.2-patch.166] - 2026-04-28
### Fixed
- **IoT Daemon**: `SyntaxError: name 'ENABLE_BAD_BEHAVIOR' is assigned to before global declaration` crashing the daemon on Python 3.12. 🔥
  - Root cause: two `global ENABLE_BAD_BEHAVIOR` declarations in different `elif` branches of the same `daemon_loop()` function.
  - Fix: moved the single `global ENABLE_BAD_BEHAVIOR` declaration to the very top of `daemon_loop()`, removing the per-branch declarations.

## [v1.2.2-patch.165] - 2026-04-28
### Fixed
- **IoT Bad Behavior**: Added early exit guard inside inner loops for all remaining behavior types — Clean Mode now stops ALL attack traffic within < 0.5s of clicking the button. 🛑
  - **C2 Beacon**: between DNS send and HTTP send (was waiting 1s)
  - **Data Exfil**: inside the 5-packet upload burst (was waiting 0.5s per packet)
  - **PAN Test DNS**: inside the 5-query burst (was waiting 1s per query)
  - **PAN Test URL**: inside the 3-URL burst (was waiting 2s per URL)

## [v1.2.2-patch.164] - 2026-04-28
### Fixed
- **IoT Bad Behavior**: `disable_bad_behavior` daemon command was missing `global ENABLE_BAD_BEHAVIOR` declaration → Python created a local variable that disappeared immediately, leaving the global flag `True`. Clean Mode appeared to activate in the UI but had zero effect — devices stopped then restarted would still launch attacks. 🐛
- **IoT DNS Flood**: Added early exit inside the 10-query burst loop — thread stops within 0.5s of clean mode toggle instead of finishing the full burst. ⚡
- **IoT Port Scan**: Same early exit inside the 10-port scan loop — stops within 0.1s. ⚡

## [v1.2.2-patch.163] - 2026-04-28
### Performance
- **IoT Daemon**: Staggered device boot — each new device waits `(index × 2s + 0–1s jitter)` before calling `start()`. 30 devices spread over ~62 seconds instead of simultaneously → eliminates DHCP Discover storm on the router. ⏳
### Fixed
- **IoT Boot Sequence**: Refactored `start()` into a `_boot_sequence()` inner function:
  1. DHCP runs **blocking** (no more `time.sleep(2)` hack)
  2. If no IP after DHCP → abort silently, protocol threads and bad behavior **do NOT start**
  3. Protocol threads start only after IP is confirmed
  4. Bad behavior starts only after IP is confirmed — eliminates `💀 RANDOM MIX started` with no IP or gateway

## [v1.2.2-patch.162] - 2026-04-28
### Added
- **IoT**: Global **Bad Behavior toggle** button (`🗡️ Clean Mode` / `💀 Attack ON`) in the IoT filter bar — enables or disables attack mode across all configured devices in one click without restarting. 🔴
- **IoT Filter**: Search field now matches **MAC addresses** — type any OUI prefix or full MAC to filter devices. 🔍
### Fixed
- **DHCP**: Retry logic upgraded to **3 full attempts** with exponential backoff (2s, 4s between retries). Each attempt re-runs the full Discover→Offer→Request→ACK cycle. Timeout per phase raised to 4s. Eliminates fallback to hardcoded `192.168.207.x`. 🔄
- **DHCP**: Bad behavior threads now respect the global `ENABLE_BAD_BEHAVIOR` flag — toggling clean mode stops attack traffic on the next loop iteration without device restart. ✅

## [v1.2.2-patch.161] - 2026-04-28
### Performance
- **IoT Architecture**: Migrated from **N processes (1 per device)** to a single persistent Python daemon managing all devices as internal threads. 🚀
  - RAM: ~600MB (30 devices) → ~50MB. CPU overhead dramatically reduced.
  - Practical device limit: ~15–20 → **100+ devices** on the same container.
  - Single process reads JSON commands from stdin: `start`, `stop`, `stop_all`, `status`, `enable_bad_behavior`, `disable_bad_behavior`.
  - All UI events (`device:log`, `device:stats`, `device:started`, `device:stopped`) unchanged — fully transparent to the frontend.
- **IoT Daemon**: Exponential backoff restart strategy in `iot-manager.ts` — 5 max retries (2s→4s→8s→16s→30s), re-sends start commands for all tracked devices on recovery. 🔁
- **IoT UI**: Persistent red banner displayed when daemon gives up after 5 crash-restart cycles. 🔴

## [v1.2.2-patch.160] - 2026-04-28
### Added
- **IoT DHCP**: `BOOTP` broadcast flag (`0x8000`), explicit `htype=1` / `hlen=6`, DHCP Option 57 (`max_dhcp_size=1500`) for realistic network stack fingerprinting. 📡
- **IoT ARP**: Gratuitous ARP (`is-at`) sent immediately after DHCP ACK — critical MAC↔IP binding signal for Prisma IoT Security classification. 📣
- **IoT DHCP**: ARP thread now waits for valid IP+gateway from DHCP before initiating requests. ⏳
### Fixed
- **IoT Bad Behavior**: Bad behavior threads skip gateway-targeted actions when gateway has not been learned yet (no more spurious traffic to unrelated IPs). 🛡️

## [v1.2.2-patch.159] - 2026-04-28
### Fixed
- **IoT UI**: Replaced vendor `<select>` dropdown with a free-text `<input>` field — vendor names from imported JSON (e.g., "Apple Inc.", "VMware, Inc.") are now preserved instead of defaulting to "Generic". ✅
- **IoT Emulator**: Default gateway changed from hardcoded `192.168.207.1` to `None` — emulator now waits for the gateway address from the DHCP ACK dynamically. 🌐

## [v1.2.2-patch.158] - 2026-04-28
### Changed
- **IoT Import**: Removed `ip_start` field from `import_prisma_devices.py` JSON export — devices now use the site DHCP server exclusively, no subnet assignment. 🔄

## [v1.2.2-patch.157] - 2026-04-28
### Added
- **IoT Import**: `--max-devices N` option on `import_prisma_devices.py` — limits generated output to the top N highest-risk devices (default 30, sorted by risk score descending). 📋
### Documentation
- Updated `generate_iot_devices.md` with `--max-devices` option reference. 📚

## [v1.2.2-patch.156] - 2026-04-28
### Fixed
- **API**: Increased `express.json()` body limit to `10mb` to support large IoT configuration file imports. 🛠️

## [v1.2.2-patch.155] - 2026-04-27
### Added
- **Cloudflare Worker**: Integrated advanced latency scenario controls from the Cloudflare Worker into the Stigix dashboard — selectable patterns (flap, wave, random) directly from the UI. ☁️⏱️

## [v1.2.2-patch.154] - 2026-04-27
### Added
- **Voice/RTP**: Full legacy behavior emulation in RTP debug mode — `tos=0`, randomized source port for DPI bypass during media classification testing. 🎙️

## [v1.2.2-patch.153] - 2026-04-27
### Fixed
- **Voice/RTP**: Debug logs from `rtp.py` forwarded to `stderr` to prevent orchestrator `stdout` capture from mixing log and data streams. 🛠️

## [v1.2.2-patch.152] - 2026-04-27
### Added
- **Voice/RTP**: DEBUG mode in `rtp.py` — strips CID prefix from RTP payload to support DPI media classification by Prisma Access. 🔬

## [v1.2.2-patch.151] - 2026-04-27
### Fixed
- **VyOS Control**: Improved unblock error handling when IP is part of a larger subnet — displays actionable error message instead of silent failure. 🛡️

## [v1.2.2-patch.150] - 2026-04-27
### Added
- **VyOS Control**: Detailed error messages from the VyOS API are now surfaced directly in the history view for faster troubleshooting. 📋

## [v1.2.2-patch.140] - 2026-04-27
### Fixed
- **Target Manager**: Resolved resource leak where temp files were not deleted when `curl` threw an exception during probe execution. 🧹

## [v1.2.2-patch.139] - 2026-04-27
### Added
- **System**: Automated rolling backups for all configuration files — prevents data loss on container restart or corruption. 💾
- **DevOps**: Added Docker logging limits to prevent unbounded log file growth. 🐳

## [v1.2.2-patch.138] - 2026-04-26
### Changed
- **System**: Increased JSONL log retention to **10,000 lines** per file for better historical coverage. 📋

## [v1.2.2-patch.137] - 2026-04-26
### Added
- **System**: Automated log rotation — growing log files are pruned automatically to prevent disk exhaustion. 🗂️
### Fixed
- **System**: Corrupted counter parsing in log rotation logic. 🛠️

## [v1.2.2-patch.136] - 2026-04-26
### Fixed
- **Cloud Probes**: Validation now blocks saving Cloud Probe configuration if Master Key or TSG ID is missing — prevents silent misconfiguration. 🔐

## [v1.2.2-patch.135] - 2026-04-26
### Added
- **Connectivity UI**: Timing Analysis area chart now available for **CLOUD probes** (DNS, TCP, TLS, TTFB breakdown). 📊

## [v1.2.2-patch.134] - 2026-04-26
### Added
- **Connectivity UI**: DNS, TCP, TLS, and TTFB columns added to the **Recent Captures** table for detailed timing visibility. 📋

## [v1.2.2-patch.133] - 2026-04-26
### Fixed
- **Connectivity UI**: IP Address and HTTP status code now correctly mapped and displayed for CLOUD probes in the Recent Captures table. 🛠️

## [v1.2.2-patch.132] - 2026-04-26
### Changed
- **Cloud Probes**: Replaced `fetch()` with `curl` for CLOUD probe execution — exposes granular DNS/TCP/TLS/TTFB timing metrics unavailable via the Fetch API. ⚡

## [v1.2.2-patch.131] - 2026-04-26
### Added
- **Probe Configuration**: TCP/UDP placeholder text and helper hints added to the Probe Configuration modal for better user guidance. ℹ️

## [v1.2.2-patch.130] - 2026-04-26
### Added
- **Cloud Targets**: Subdomains added to Cloudflare Target URLs to support granular SD-WAN application steering and traffic classification. 🌐

## [v1.2.2-patch.129] - 2026-04-26
### Added
- **Reachability**: Concurrent processing and a **3-retry mechanism** added to all target reachability checks for improved accuracy. ⚡

## [v1.2.2-patch.128] - 2026-04-26
### Added
- **Targets UI**: Search bar and scrollable container added to the targets list — supports large numbers of targets without overflow. 🔍

## [v1.2.2-patch.127] - 2026-04-26
### Changed
- **Failover UI**: Rearranged failover header layout; improved Play/Stop visual states for clearer mission control UX. ✨

## [v1.2.2-patch.126] - 2026-04-26
### Fixed
- **Security Score**: Fixed a React Hook conditional rendering violation in `ScoreDetails` causing a UI crash on mount. 🛠️

## [v1.2.2-patch.125] - 2026-04-26
### Fixed
- **Security Score**: Resolved TypeScript and import errors introduced during the UI refactor. 🛠️

## [v1.2.2-patch.124] - 2026-04-26
### Changed
- **Security Score**: Reorganized `ScoreDashboard` layout — Gap Analysis integrated directly into Security panels for a unified view. 📊

## [v1.2.2-patch.123] - 2026-04-26
### Changed
- **UI**: Refinements for Speedtest and Failover modules — improved visual hierarchy and interactive states. ✨

## [v1.2.2-patch.122] - 2026-04-26
### Changed
- **Failover & Security UI**: UX refinements for target management and operational state display. ✨

## [v1.2.2-patch.121] - 2026-04-25
### Added
- **Security Score**: **Threat Prevention Score** widget — tracks EICAR test outcomes alongside URL and DNS scores in the Score Dashboard. 🛡️

## [v1.2.2-patch.120] - 2026-04-25
### Added
- **Security Score**: **Latest Changes** timestamps now include full date context for cross-day comparisons. 📅

## [v1.2.2-patch.119] - 2026-04-25
### Added
- **Failover & Voice**: Individual **Play buttons** on each target card for direct single-target test launch. ▶️

## [v1.2.2-patch.118] - 2026-04-25
### Fixed
- **Security**: Scheduled EICAR tests now correctly save and execute against multiple configured targets. 🛠️

## [v1.2.2-patch.117] - 2026-04-25
### Added
- **Security**: Multi-target EICAR testing UI — select multiple Stigix targets for simultaneous threat prevention validation. 🎯

## [v1.2.2-patch.116] - 2026-04-25
### Added
- **Targets**: **Export and Import** functionality for the Targets Registry — back up and restore all configured targets as JSON. 📤📥

## [v1.2.2-patch.115] - 2026-04-25
### Added
- **Speedtest**: Quick launch **Play button** on Speedtest target cards for instant single-click test execution. ▶️

## [v1.2.2-patch.114] - 2026-04-25
### Changed
- **Speedtest UI**: Unified target selection with **radar ping animations** — active reachability state displayed per target. 📡

## [v1.2.2-patch.113] - 2026-04-25
### Changed
- **Targets UI**: Improved reachability indicator visibility — clearer color coding and animation for online/offline/checking states. ✨

## [v1.2.2-patch.112] - 2026-04-25
### Fixed
- **Targets**: Fixed reachability ping payload key mismatch causing incorrect reachability states. 🛠️

## [v1.2.2-patch.111] - 2026-04-25
### Added
- **Targets**: Global **target reachability monitoring** — all targets are continuously pinged and status is displayed in real-time across all modules. 📡

## [v1.2.2-patch.110] - 2026-04-25
### Fixed
- **CI/CD**: Retried build after GitHub transient 502 error. 🔄

## [v1.2.2-patch.109] - 2026-04-25
### Fixed
- **Failover**: Resolved TypeScript syntax error introduced during failover refactor. 🛠️

## [v1.2.2-patch.108] - 2026-04-25
### Added
- **Failover**: Auto-populate targets from the Targets Registry; live reachability checks before test execution. 🎯⚡

## [v1.2.2-patch.107] - 2026-04-25
### Fixed
- **Speedtest**: Clarified Stigix target host field and documented `xfr` binary dependency in the UI. 📋

## [v1.2.2-patch.106] - 2026-04-25
### Added
- **Topology**: Toggle branch gateway nodes between **Hub** and **Branch** roles directly in the topology overlay. 🗺️

## [v1.2.2-patch.105] - 2026-04-25
### Changed
- **Registry**: Updated base URLs for registry and target services to `stigix.io` domain. 🌐

## [v1.2.2-patch.104] - 2026-04-25
### Fixed
- **Traffic History**: Fixed spike artifacts in traffic history chart; corrected time range filter logic. 📈🛠️

## [v1.2.2-patch.103] - 2026-04-24
### Added
- **Security Score**: Score Trend chart **time range selector** (1h / 6h / 24h) + dynamic dot sizing based on data density. 📊

## [v1.2.2-patch.102] - 2026-04-24
### Added
- **Security Score**: **Δ CHG toggle** on Score Trend chart — highlights score delta from the previous data point directly on the chart. 📈

## [v1.2.2-patch.101] - 2026-04-24
### Added
- **Security Score**: Score Trend chart with configurable time range and improved dot rendering for dense data sets. 📊

## [v1.2.2-patch.100] - 2026-04-22
### Refactored
- **Target Worker Auth**: Removed `SHARED_KEY` / `STIGIX_TARGET_SHARED_KEY` — `MASTER_SIGNATURE_KEY` is now the only supported authentication method. Derived key per request: `SHA256(TSGID:MASTER_KEY)`. Worker falls through to open-access if no master key is configured. 🔐
- **target-manager.ts**: Removed `STIGIX_TARGET_SHARED_KEY` env fallback and the PoC derived key (`SHA256(tsg:clientId:stigix-v1)`). Clear warnings logged when key is missing. 🧹
### Changed
- **docker-compose.yml**: Removed `STIGIX_TARGET_SHARED_KEY` env variable. 🐳
- **install.sh**: Removed `STIGIX_TARGET_SHARED_KEY` from generated `.env` template.
- **docs**: Updated `ENVIRONMENT_VARIABLES.md` and `.env.example` to reflect single-key auth model. 📚

## [v1.2.2-patch.99] - 2026-04-22
### Performance
- **Traffic Generator**: Added `--ipv4` flag to all `curl` calls. Host has no IPv6 route — without this, curl tried all AAAA addresses first (each failing with "Network is unreachable") before falling back to A records, wasting 1–2s per request on dual-stack destinations. ⚡

## [v1.2.2-patch.98] - 2026-04-22
### Fixed
- **Traffic Rate Card**: `currentRpm` was never persisted — Traffic Rate always showed `0` on browser refresh. Now seeded from the last history entry on init and written to `localStorage` as `stigix_rpm_cache` on every update. 📊
- **History Writer**: The 60s snapshot collector (`traffic-history.jsonl`) was reading `stats.json` directly (the old single-client file) instead of calling `aggregateStats()`. With multi-client traffic, this recorded ~1/N of actual traffic, causing chart totals to diverge from stat cards and seeding wrong RPM on refresh. Fixed to use `aggregateStats()` consistently. 🛠️
- **Rotation**: Replaced `exec(wc -l / tail)` in history rotation with pure `fs` to avoid exec buffer limit issues.

## [v1.2.2-patch.97] - 2026-04-22
### Added
- **Dashboard Persistence**: Stats and chart history now survive browser refresh via `localStorage` caching. 💾
  - `stats` initialized from `stigix_stats_cache` on load — no flash to zero on refresh.
  - History cached per time-range key (`stigix_history_1h/6h/24h`, last 300 points).
  - `fetchHistory()` and live `processStats()` both write to localStorage on every update.
  - Switching time ranges immediately shows the cached history while the API loads.

## [v1.2.2-patch.96] - 2026-04-22
### Fixed
- **Traffic Control Dashboard**: Switching to another tab caused the entire Traffic Control view (including `LineChart`) to unmount. On return, recharts re-animated the line from zero. Fixed by keeping the dashboard always mounted in the DOM with CSS `hidden` class — component never unmounts. 🔒
- **Chart**: Added `isAnimationActive={false}` on the `Line` component as a safety net against edge-case remounts.

## [v1.2.2-patch.95] - 2026-04-22
### Fixed
- **Polling Intervals**: Tab switching triggered a full teardown and restart of all polling intervals because `view` was in the main `useEffect` dependency array. Split into two separate effects — initialization (runs once on login) and view-specific polling — preventing interval churn on navigation. ⏱️

## [v1.2.2-patch.94] - 2026-04-22
### Fixed
- **Chart Axes**: Y/X axis labels were invisible in light mode. SVG elements inside recharts cannot inherit CSS custom properties. Replaced dynamic `var(--color-text-muted)` with concrete `#64748b` (neutral slate). 🎨
- **Stats Aggregation**: Implemented 3-minute recency filter in `aggregateStats()` — only stats files modified within the last 3 minutes are included, preventing stale files from previous container runs or crashed workers from polluting totals. 🧹
- **Density Default**: Stop API endpoint now explicitly resets `client_count` to `1` on disk, ensuring the UI slider correctly reflects the state on fresh startups. 🎛️

## [v1.2.2-patch.93] - 2026-04-22
### Fixed
- **Dashboard API**: `/api/admin/system/dashboard-data` was reading `stats.json` (legacy single-client file) directly instead of calling `aggregateStats()`. Multi-client stats were never reflected in the stat cards. 🛠️

## [v1.2.2-patch.92] - 2026-04-22
### Fixed
- **Traffic Generator**: `STATS_FILE` variable was assigned before `CLIENTID` was set — all workers wrote to `stats-.json` (empty suffix) instead of their own `stats-client-XX-YYY.json` file. Fixed initialization order. 🐛

## [v1.2.2-patch.91] - 2026-04-22
### Fixed
- **Traffic Generator**: `getWeightedApp()` was called inside a `$(...)` subshell for process detection — the app cache array built inside never persisted to the parent shell, so `jq` ran on every single request. Refactored to use an internal PID registry and moved cache initialization to the parent scope. ⚡
- **Backend**: Fixed `maxBuffer` crash in `exec()` calls when log output exceeded the Node.js default buffer limit. 🛠️

## [v1.2.2-patch.90] - 2026-04-22
### Fixed
- **Traffic Generator**: Replaced `pgrep` (unreliable for detecting worker processes by name) with an internal PID registry array in the master loop, ensuring accurate worker count tracking and scale-up/scale-down decisions. 🔄

## [v1.2.2-patch.89] - 2026-04-22
### Performance
- **Traffic Generator**: Three targeted optimizations for density scaling: pre-cached application list, reduced sleep granularity for faster ramp-up, and improved worker lifecycle management. ⚡

## [v1.2.2-patch.88] - 2026-04-22
### Fixed
- **Traffic Generator**: Stabilized multi-client scaling logic and fixed stats aggregation across parallel worker processes. 🛠️

## [v1.2.2-patch.87] - 2026-04-22
### Added
- **Traffic Generator**: Multi-client scaling — the master process dynamically spawns/terminates worker instances based on the configured `client_count` density slider. Each worker writes its own `stats-client-XX-YYY.json` file. Workers are identified by a shared session suffix. 📈
- **Dashboard**: Traffic Density slider (1–10 parallel clients) and Traffic Speed slider exposed in the Traffic Control panel. 🎛️

## [v1.2.2-patch.82] - 2026-04-22
### Added
- **Security Score**: Min/max score display on gauge cards. 📊
- **Security Score**: "Change" column in test result tables showing delta vs. previous run.
- **Security Score**: "Changes Only" filter to focus the result list on categories that shifted status.
- **Security Score**: 24h score trend visualization. 📈

## [v1.2.2-patch.75] - 2026-04-21
### Changed
- **Security Score**: Added score description subtitles on each gauge card — URL Score explains "Weighted % of malicious URL categories correctly blocked by firewall", DNS Score explains "Weighted % of malicious DNS domains correctly blocked or sinkholed". 📝
- **Security Score**: Added `ⓘ` tooltip on the BASELINE label explaining the purpose of pinning a reference run and how gap alerting works. 💡

## [v1.2.2-patch.74] - 2026-04-21
### Added
- **Security Score**: Added **Latest Changes** panel — client-side diff between the two most recent consecutive runs per type (URL/DNS). Shows exactly which categories changed status with `↓ GAP` / `↑ FIXED` / `CHG` badges and a time range. No baseline required. 🔍
- **Security Score**: Chart dot decimation — dots now only appear every 5-minute window to prevent clutter when tests run every minute. The score line itself still renders all data points. ⚡

## [v1.2.2-patch.73] - 2026-04-21
### Added
- **Security Score**: Run markers on the Score Trend chart — colored dots (🟣 URL, 🔵 DNS) appear at each actual test execution. Scheduled runs display an additional outer ring to distinguish them from manual runs. 📍
- **Security Score**: Rich custom chart tooltip showing exact date/time, trigger type (▶ Manual / 🕐 Scheduled), and both URL+DNS scores on hover. 🎯
- **Security Score**: Legend in chart header: `● URL  ● DNS  ○ Scheduled`. 📊

## [v1.2.2-patch.72] - 2026-04-21
### Fixed
- **Security Score**: Fixed `ScoreDashboard` not showing any data — all 5 `fetch()` calls were missing `Authorization: Bearer <token>` headers, causing silent 401 responses. Added `token` prop to `ScoreDashboard`, passed from `Security.tsx` parent. 🔐

## [v1.2.2-patch.71] - 2026-04-21
### Fixed
- **Security Score**: Fixed `runId` missing from `TestResult` interface in `test-logger.ts`. TypeScript was silently dropping the `runId` field on every logged entry, making score grouping impossible — `generateRunScore()` always found 0 results and returned early. 🛠️

## [v1.2.2-patch.42] - 2026-04-17
### Changed
- **Settings UI**: Restructured the Custom Probe Configuration form layout. Upgraded from a cramped 4-column layout into a spacious 2-column grid layout spanning two rows to completely eliminate tight text wrapping. 📐

## [v1.2.2-patch.41] - 2026-04-17
### Added
- **Probes**: Implemented dynamically configurable probe frequencies natively within the Settings UI (tunable from `30s` to `3600s`). ⏱️
- **Backend Engine**: Demolished the legacy 60-second blocking scheduler and deployed a non-blocking asynchronous multiplexer. Probes now execute simultaneously relying on their precise individual intervals without overlapping or blocking! 🚀

## [v1.2.2-patch.40] - 2026-04-17
### Added
- **Speedtest**: Enforced a dynamic 10s minimum and 300s maximum duration constraint on the UI, coupled with clear visual indicator text `MIN 10 — MAX 300` right above the input field to perfectly align user expectations. ⏱️

## [v1.2.2-patch.39] - 2026-04-17
### Added
- **Settings UI**: Re-styled the Probe form, injecting an explicit `MIN 1000 — MAX 60000` helper text directly opposite the Timeout label for superior transparency. ✨

## [v1.2.2-patch.38] - 2026-04-17
### Added
- **Probes**: Introduced an editable `Timeout (ms)` property natively into the Synthetic Probes UI builder, giving users maximum tuning control over execution limits. ⚙️
- **Probes**: Injected a bulletproof `1000ms` safe-minimum limit to protect the backend bash-level tools from zero-timeout infinite execution traps. 🛡️

## [v1.2.2-patch.37] - 2026-04-17
### Added
- **Convergence Dashboard**: Added Live Packet Loss tracking chart to the convergence timeline display. 📉
### Changed
- **Convergence Dashboard**: Compressed the left outage stats panel to dynamically increase the horizontal charting space for better timeline analysis. ✨

## [v1.2.2-patch.36] - 2026-04-17
### Fixed
- **Speedtest**: Fixed an issue where the speedtest graph X-axis would stall after 60 seconds by modifying the sliding window array logic and dynamically expanding it up to 300 seconds (5 minutes). 📈

## [v1.2.2-patch.35] - 2026-04-16
### Added
- **Probes**: Enriched custom connectivity export (`connectivity-custom.json`) with an `effectiveUrl` field for CLOUD probes, providing administrators with the exact signed URLs and credentials used by the engine. 🔍

## [v1.2.2-patch.31] - 2026-04-16
### Added
- **Cloud Targets**: Implemented dynamic subdomain routing for custom SaaS applications (e.g., `slow-saas`). 🌩️

## [v1.2.2-patch.30] - 2026-04-16
### Added
- **Cloud Targets**: Introduced Cloud Target Security UI directly into the Target Controller tab. 🛡️

## [v1.2.2-patch.29] - 2026-04-16
### Added
- **Cloud Targets**: Exposed a global, configurable delay override parameter allowing custom synthetic simulation of long-polling and sluggish applications across all cloud scenarios. ⏱️

## [v1.2.2-patch.28] - 2026-04-15
### Added
- **Probes**: Injected highly detailed diagnostics and connectivity probe logging for advanced troubleshooting. 📝

## [v1.2.2-patch.27] - 2026-04-15
### Fixed
- **UI**: Modified probe management lists so that action buttons are permanently visible, eliminating browser compatibility issues with CSS hover states. 🖱️

## [v1.2.2-patch.26] - 2026-04-15
### Fixed
- **DevOps**: Restored accurate `stigix` container renaming schemes and fixed security CLI command executions. 🐳

## [v1.2.2-patch.25] - 2026-04-15
### Added
- **Probes**: Enhanced frontend visibility of Synthetic probe execution URLs. 🌐

## [v1.2.2-patch.24] - 2026-04-14
### Fixed
- **SLS Integration**: Temporarily isolated and disabled the SLS/Prisma API enrichment check due to connectivity stabilization. 🛡️

## [v1.2.2-patch.23] - 2026-04-14
### Fixed
- **Build**: Resolved `TS6133` TypeScript build failures by eliminating unused `onVersionUpdate` property bindings. 🛠️

## [v1.2.2-patch.22] - 2026-04-12
### Changed
- **Performance Dashboard**: Harmonized background probe execution frequencies and introduced a user-configurable history timeline display for cleaner analysis. ⏱️

## [v1.2.2-patch.21] - 2026-04-10
### Added
- **Website**: Launched the official product website at `stigix.io` with a full SEO pass, including meta tags, Open Graph cards, and JSON-LD structured data. 🌐✨
- **Website**: Integrated automated sitemap and robots.txt for search engine discovery.
- **Probes**: Implemented advanced payload parsing for custom test configurations and forced full URL display for all probe types. 🔗
### Fixed
- **Website**: Resolved Cloudflare Pages infinite loop caused by incorrect `_redirects` rules and updated all canonical URLs to the `.io` domain. 🛠️

## [v1.2.2-patch.19] - 2026-04-09
### Added
- **Probes**: Introduced the **Advanced Stigix Probes UI Builder**, enabling granular configuration of custom test hooks and advanced network parameters. 🛠️
### Fixed
- **Settings**: Resolved a critical TypeScript build error in `Settings.tsx` caused by redundant unused variables.

## [v1.2.2-patch.15] - 2026-04-08
### Added
- **Probes**: Implemented advanced filtering for Synthetic Probes and integrated **SD-WAN Auto-Sync** for discovered endpoints. 📡🔄
### Changed
- **UI**: Enhanced protocol-specific advanced layout for the Detail Modal and implemented **Dynamic TCP/UDP Context Widget Mapping** for protocol-specific telemetry. 📊
- **UI**: Reduced typography weight of Advanced Test Parameter modals for improved visual balance.

## [v1.2.2-patch.10] - 2026-04-08
### Fixed
- **API**: Restored missing telemetry binding for `ActiveJob` and ensured Custom Advanced UI Flags are correctly forwarded to the XFR Job Engine. 🛠️
- **Logging**: Elevated cloud probe debug logs to info level and reverted target manager noise to debug for cleaner terminal output.

## [v1.2.2-patch.9] - 2026-04-08
### Added
- **Speedtest**: Introduced dynamic strict format `<datalist>` validation for DSCP / TOS input fields to automatically prevent execution of malformed network QoS class identifiers.
- **Speedtest**: Enhanced the Test Details modal view by injecting granular telemetry for executed TCP Congestion configurations, source protocol ports, and injected QoS markings.
### Changed
- **UI**: Rebranded the label 'Diagnostic History' to 'Bandwidth Test History' to enforce consistency. Modals formerly classified as diagnostics are now correctly rendered as 'Test Details'.

## [v1.2.2-patch.7] - 2026-04-08
### Added
- **Speedtest**: Introduced advanced `DSCP / TOS` markings inside the Custom mode (supporting classes like `EF`, `AF11`, or raw bytes).
- **Speedtest**: Implemented a dynamic Flow Source Port (`--cport`) tracker interface utilizing `30000 + N` mapping logic to enhance granular router metric inspection. Supported on both TCP and UDP methodologies.
- **Speedtest**: Added a selective dropdown to enforce explicitly constrained TCP Congestion mechanisms (`Cubic` or `Reno`).
### Changed
- **UI**: Rebranded the label 'Speedtest Config' to 'Bandwidth Test' for better clarity.

## [v1.2.2-patch.6] - 2026-04-04
### Fixed
- **Speedtest**: Removed the `RTT (ms)` trace overlay from live charts during UDP tests, as UDP avoids latency instrumentation at the transport level.
- **Speedtest**: Injected explicit units (`Bandwidth (Mbps)` and `RTT (ms) / Rxmt`) as vertically aligned left and right Y-Axis chart labels to improve graphical readability without expanding the legend footprint.

## [v1.2.2-patch.5] - 2026-04-04
### Added
- **Speedtest**: Integrated a dynamically scaled `RTT (ms)` trace into the live Bandwidth visualization chart to track the correlation between latency and throughput under congestion. 📈
- **Speedtest**: Added live `RTT (ms)` monitoring to the interactive chart tooltip.
- **Speedtest**: Renamed final metrics modal to `Test Details` and implemented a payload reconstruction engine to calculate and display Total Data Transferred, Total Data Uploaded, and Total Data Downloaded (including Bidirectional test payload ratios). 💽

## [v1.2.2-patch.4] - 2026-04-04
### Added
- **UI**: Implemented modern, dark-themed custom CSS tooltips for navigational elements. ✨
- **UI**: Overhauled navigation sidebar labels with concise titles (e.g., `System & Settings` -> `Settings`) and rich explanatory hover tooltips. 

## [v1.2.2-patch.3] - 2026-04-04
### Fixed
- **Speedtest**: Fixed an issue where `tcp_info.cwnd` and `tcp_info.retransmits` metrics were dropped during backend JSON mapping, preventing them from propagating to the UI.
- **Speedtest**: Normalised `cwnd` metrics for Linux platforms to display dynamically as Bytes/KB by converting the default OS MSS packet measurements natively inside the backend.
- **Speedtest**: Implemented a workaround for an `xfr` edge case where the final snapshot summary zeroes out TCP retransmissions, properly recovering the max counter from earlier intervals.

## [v1.2.2-patch.2] - 2026-04-04
### Added
- **Speedtest**: Integrated robust UDP packet loss calculation (`lost` and `loss_percent`) into the real-time UI during Live Tests. 📉🛡️
- **Speedtest**: Introduced real-time tracking and visual tooltips for TCP Congestion Window (`cwnd`) size (in KB). Added dedicated TCP Windows Size block in Job Analysis. 🚀
### Fixed
- **Speedtest**: Resolved macOS-specific latency tracking bug where Apple's `tcpi_rtt` kernel metrics were misreported as microseconds instead of milliseconds, leading to artificially low `0.2 ms` readings.
- **Speedtest**: Automatically fallback `Packet Loss` live tracking to `N/A` for UDP interval streams, avoiding inaccurate `0.00%` UI states during mid-flight generation.

## [v1.2.1-patch.250] - 2026-03-19
### Fixed
- **Maintenance**: Fixed "System Maintenance" menu functionality. 🛠️🔄
    - Added **Docker CLI** and **Docker Compose** to the All-in-One image.
    - Implemented **Soft Service Restart** using `supervisorctl` for instant internal reloads.
    - Added mandatory **Docker Socket mount** in `docker-compose.yml` to support full upgrades and redeployments from the UI.
    - Corrected upgrade logic to target the unified `stigix` container instead of legacy images.

## [v1.2.1-patch.249] - 2026-03-19
### Fixed
- **Topology**: Resolved overlay tunnel misalignment where lines terminated outside branch circuit boxes when a Hub was selected. 🛠️📍

## [v1.2.1-patch.248] - 2026-03-19
### Added
- **Deployment**: Consolidated all Stigix components into a single **All-in-One** container managed by `supervisord`. 🐳📦
- **Installation**: Unified installation experience with the new `install.sh` script (renamed from `install-stigix.sh`). 🚀
- **UX**: Refined **Targets Repository** with a balanced 50/50 layout and enhanced "Local Target Service" controls. ✨
- **UX**: Implemented **Segmented Control** for mode switching and high-visibility **Status Chips** (READY/IMPAIRED/OFFLINE). 📊
- **UX**: Added **Recently Added** quick-list and **Demo Tips** to the New Remote Target card to optimize space. 💡
- **UX**: Renamed **XFR** to **Speedtest** for better clarity and alignment with user expectations. 📊
### Removed
- **Beta**: Officially removed "Beta" flags for **Bandwidth Test** and **Vyos Control**, marking them as stable platform features. ✅

## [v1.2.1-patch.245] - 2026-03-19
### Added
- **Targets**: Integrated **Local Target Service Control** widget into Settings. 🌐⚡
- **Persistence**: Target service mode now survives restarts via `target-config.json` persistence. 💾
- **Documentation**: Refreshed `docs/TARGET_CAPABILITIES.md` to reflect integrated services and dashboard control. 📚
### Refactored
- **UI**: Redesigned the **Targets** tab with a responsive grid layout for better organization. ✨

## [v1.2.1-patch.244] - 2026-03-18
### Added
- **Connectivity**: Added **PRISMA** filter to Connectivity Performance view to isolate auto-discovered probes. 🛡️🔍
### Fixed
- **Dashboard**: Improved **Docker stats** error reporting. Displays specific connectivity errors (e.g., daemon unreachable on Mac) instead of an empty table. 🐳🩺

## [v1.2.1-patch.243] - 2026-03-18
### Added
- **Dashboard**: Integrated **Live Docker Container Stats** (CPU %, Mem Usage/%, Net/Block I/O, PIDs) into System Info. 📊🐳
- **Settings**: Renamed "Strata Logging" to **Prisma SASE API**. 🛡️
- **Settings**: Implemented UI-based Prisma credential management with local persistence in `prisma-config.json`. ⚙️
- **Connectivity**: Standardized probe icons (🌐 Cloud, 🛡️ Prisma, ⚡ Manual) across all views for visual consistency. ✨🌐

## [v1.2.1-patch.239] - 2026-03-17
### Added
- **Build Optimization**: Implemented **Fast Patch Builds**. Patch versions now default to `linux/amd64` only, significantly reducing CI turnaround time. ⚡
- **Dashboard**: Added **Cloud Egress Context** card in System Info, showing real-time IP, Geo, and ASN data from Stigix Cloud. 🌍
- **UX**: Automatic scrolling to probe form in Settings when editing. 🖱️
- **UX**: New "Update Mode" visual feedback for probes (orange button, cancel option). ✨
### Fixed
- **MCP Server**: Fixed Docker healthcheck (switched from `/health` to `/sse`) and corrected build paths in `Dockerfile`. 🩺
- **MCP Server**: Updated Claude config to support remote **Ubuntu-BR5** instance connectivity. 🔌

## [v1.2.1-patch.236] - 2026-03-17
### Added
- **Documentation**: New `docs/ENVIRONMENT_VARIABLES.md` providing a comprehensive reference for all Stigix settings. 📚
- **DevOps**: Enhanced `docker-compose.yml` with descriptive inline comments and refreshed `.env.example`. 🐳

## [v1.2.1-patch.235] - 2026-03-17
### Added
- **Security**: Implemented **Multi-Tenant Master Signature** security for Cloud Probes. Uses SHA-256 HMAC of TSG and Master Key for stateless verification. 🔐🛡️

## [v1.2.1-patch.234] - 2026-03-17
### Added
- **Security**: Introduced dynamic key derivation for Cloud Probes (MD5 hash of TSG, ClientID, and salt). 🔑
### Performance
- **Dashboard**: Optimized data fetching by reducing polling frequency to 3s and streamlining `/api/admin/system/dashboard-data`. 🚀

## [v1.2.1-patch.231] - 2026-03-16
### Fixed
- **SLS**: Fixed authentication endpoint and scope in `SLSClient`. Added support for `PRISMA_SDWAN_TSG_ID` env var. 🛠️🛡️

## [v1.2.1-patch.229] - 2026-03-16
### Added
- **SLS**: Automatic credential population from system environment. 🩺
### Fixed
- **SLS**: Resolved configuration page "loading forever" issue. 🛠️

## [v1.2.1-patch.213] - 2026-03-17
### Fixed
- **Connectivity**: Enabled robust URL parsing for cloud probes to handle complex scenarios and query strings. 🌐🛠️

## [v1.2.1-patch.210] - 2026-03-17
### Added
- **Cloud Connectivity**: Integrated Stigix Cloud shared probes directly into the Performance dashboard. 📡✨

## [v1.2.1-patch.208] - 2026-03-17
### Added
- **MCP Server**: Implemented "Absolute Silent Mode" and improved `bridge.py` robustness for long-running orchestration. 🔇🤝

## [v1.2.1-patch.207] - 2026-03-17
### Added
- **MCP Server**: Support for `STIGIX_CONTROLLER_URL` environment variable for remote orchestration workflows. 🌐
### Fixed
- **SSE**: Suppressed redundant log noise for clean terminal output. 📝

## [v1.2.1-patch.205] - 2026-03-16
### Added
- **MCP Server**: Added target validation and profile compatibility documentation to the `run_test` natural language tool. 📚🛡️

## [v1.2.1-patch.204] - 2026-03-16
### Changed
- **MCP Server**: Enabled **Distributed Orchestration**. Removed the `check_leader()` safety check, allowing any node (Leader or Peer) to host the Claude Desktop entry point. 🌐✨
- **DevOps**: Enforced `MCP_PORT=3100` via environment variables for reliable external access. 🔌

## [v1.2.1-patch.203] - 2026-03-16
### Added
- **MCP Server**: Production-ready deployment via `docker-compose.yml`. Supports SSE transport on port 3100. 🐳
- **Dashboard**: New MCP Server settings tab with real-time health and Claude config generator. 🚀
- **Orchestration**: New `set_traffic_rate` tool to adjust global generation speed (0.1s - 10.0s). 🚦

## [v1.2.1-patch.192] - 2026-03-12
### Added
- **Registry**: Implemented flexible registry bootstrap snapshot for faster cold starts. 📡🚀

## [v1.2.1-patch.182] - 2026-03-12
### Added
- **Cloud Probes**: Integrated Stigix Cloud performance probes. 📡✨
### Fixed
- **Express**: Resolved critical wildcard route crash in Express 5 by migrating to path-to-regexp v8 compatible syntax. 🛠️🔥

## [v1.2.1-patch.181] - 2026-03-12
### Performance
- **Registry**: Moved leader recovery to the discovery loop (30s retry) for better failover resilience. 🚀

## [v1.2.1-patch.179] - 2026-03-12
### Changed
- **Registry**: Implemented **Adaptive Heartbeats** (60s local / 300s remote) and faster discovery cycles (30s). ⏲️📡

## [v1.2.1-patch.169] - 2026-03-11
### Added
- **Registry**: Implemented automatic **Leader Election** with quota protection to prevent split-brain scenarios. 👑🛡️
- **Registry**: New hybrid UI for monitoring Peer and Leader health status. 📊

## [v1.2.1-patch.163] - 2026-03-11
### Added
- **Autodiscovery**: Initial release of specialized `stigix-registry-debug` Skill. 📚
- **Documentation**: Finalized troubleshooting and autodiscovery guides. 📖

## [v1.2.1-patch.162] - 2026-03-11
### Changed
- **DevOps**: Added optional `STIGIX_REGISTRY_ENABLED`, `STIGIX_SITE_NAME`, and `STIGIX_INSTANCE_ID` overrides to `docker-compose.stigix.yml` for easier configuration discovery. 🐳

## [v1.2.1-patch.161] - 2026-03-11
### Added
- **Registry**: Implemented **Auto-Enable** logic. Registry discovery is now active by default if `PRISMA_SDWAN_TSGID` and `PRISMA_SDWAN_CLIENT_ID` are present in the environment. 🎯✨

## [v1.2.1-patch.160] - 2026-03-11
### Added
- **Identity**: Implemented **Smart Identity**. The system now automatically falls back to the local **hostname** if `STIGIX_INSTANCE_ID` or `STIGIX_SITE_NAME` are not provided. 🆔

## [v1.2.1-patch.159] - 2026-03-11
### Fixed
- **Deployment**: Resolved a critical `ERR_MODULE_NOT_FOUND` error by including the missing `registry-manager.ts` and `stigix-registry-client.ts` in the production Docker image. 🛠️🐳

## [v1.2.1-patch.158] - 2026-03-11
### Added
- **Registry**: Introduced **Stateless Autodiscovery** via Stigix Registry (Cloudflare Worker). 📡🌐
  - **Security**: Implemented a stateless hashing mechanism (`X-PoC-Key`) derived from Prisma credentials, eliminating local identity persistence.
  - **Discovery**: Automated peer-to-peer target discovery with background heartbeats (60s) and discovery sweeps (30s).
  - **UI**: Added "Auto" badge in Settings > Targets to distinguish discovered peers. 🏷️
  - **Tooling**: Created `docs/AUTODISCOVERY_GUIDE.md` and a specialized `stigix-registry-debug` Skill. 📚

## [v1.2.1-patch.151] - 2026-03-05
### Added
- **Convergence Thresholds**: Implemented dynamic, configurable thresholds (Good, Degraded, Bad, Critical) via a new "Convergence" settings tab. ⚡
- **Failover Logic**: Refined failover status logic to support a 4-zone classification (Good/Degraded/Bad/Critical) with dynamic polling and instant UI updates. 📊
- **UX**: Refined VyOS router edit modal with premium purple theme, descriptive labels, and simplified impairment targeting language. 🎨
- **Infrastructure**: Added backend persistence for convergence thresholds using dedicated `convergence-config.json` management. 🏗️

## [v1.2.1-patch.150] - 2026-03-05
### Added
- **Topology Overlay**: Implemented **Bidirectional Hub Tunnels**. Selecting a Hub or DC in Logical Overlay now displays all incoming tunnels from all branches, providing a complete "Hub-Spoke" visibility. 🛣️
- **Infrastructure**: Unified version synchronization across all root and sub-component `VERSION` files, `package.json`, and security documentation. 🏗️
### Fixed
- **Topology Performance**: Resolved infinite re-render loops and viewport centering issues. Transitioned to `ReactFlowProvider` with a debounced imperative `fitView` for perfect mathematical centering on every load. 📐
- **Layout**: Optimized vertical spacing (`HUB_Y: -700`, `SPOKE_Y: 700`) and centered all node origins for a cleaner, balanced aesthetic. ✨
- **UX**: Moved search/filter widget to a compact, vertical middle-left panel to prevent overlap with Hub nodes. ⚙️

## [v1.2.1-patch.140] - 2026-03-04
### Added
- **Prisma Access (SSE) View**: Initial release of the "PRISMA ACCESS" logical overlay. 📡
  - **Logic**: Dynamic "POP" cloud node generation based on real-time Prisma service endpoints.
  - **Visuals**: Status-aware bespoke edges (Green/Solid for Up, Blue/Dotted for Standby, Red for Down) connecting sites directly to Prisma POPs.
  - **UI**: Added "[SITE] OVERLAY" button in site details for on-demand SD-WAN logical tunnel inspection. 🔍
### Fixed
- **Backend**: Implemented robust fallback for `prisma_sase` SDK missing `servicelinks` methods using raw `rest_call` logic. 🛡️

## [v1.2.1-patch.130] - 2026-03-02
### Fixed
- **Voice UI**: Disabled "Start Voice Simulation" button when no target probes are defined, preventing engine start with empty configuration. 🛡️
- **Voice UI**: Added "No Targets Defined" status indicator for better UX when the simulation is unavailable. ✨

## [v1.2.1-patch.129] - 2026-03-02
### Performance
- **Digital Experience Dashboard**: Resolved 4.35s loading bottleneck on `stats?range=24h` endpoint. 🚀
  - **Backend**: Extended `ConnectivityLogger` stats cache from 5s to 5 minutes (aligned with probe interval). Cache is now invalidated on each `logResult()` write, guaranteeing fresh data without expensive recalculation on every page load.
  - **Backend**: Improved `readAllResults()` early-exit logic with a stale-streak counter to stop scanning log files sooner when matching time-bound data.
  - **Frontend**: Split data fetching into 2 non-blocking phases — fast probes config (active-probes + custom, < 200ms) loads first, then heavy stats + results load asynchronously without blocking the UI.
  - **Frontend**: Added skeleton loading animations on KPI cards (Global Experience, HTTP Coverage, Flaky Endpoints) during phase 2 loading.
  - **Frontend**: Added `useMemo` on detail modal results filter to avoid redundant re-computation on every parent render.

## [v1.2.1-patch.126] - 2026-03-01
### Added
- **VyOS UI Enhancements**: Implemented a custom premium `ActionSelector` component utilizing Lucide icons and intelligent backdrop blur for a high-end mission control experience. 💎
- **Visual Feedback**: Integrated action-specific icons (Shut, No Shut, Traffic Control) across the sequence timeline, manual trigger buttons, and sequence card views. 🎨
- **Layout Optimization**: Redesigned the sequence detailed view with a more compact layout and fixed timeline alignment issues for variable card heights. 🛠️

## [v1.2.1-patch.125] - 2026-03-01
### Added
- **Favicon Discovery**: Implemented an automated favicon discovery and caching system for SaaS applications, utilizing `cheerio` for intelligent HTML parsing and persistent JSON caching. 🌐✨
- **UI**: Created a reusable `Favicon` component with intelligent fallbacks (deterministic colored circles with `Mail` or `Globe` icons) for when a domain-specific icon cannot be found. 🎨
- **Configuration**: Added high-resolution manual `icon_url` overrides for major SaaS applications including Outlook, Teams, Gmail, Slack, Zoom, Salesforce, and GitHub. 🚀
### Fixed
- **Favicon System**: Improved error handling for image load failures and ensured manual configuration overrides are prioritized over automatic discovery. 🛠️

## [v1.2.1-patch.122] - 2026-02-28
### Changed
- **System Info UI**: Enhanced Network I/O metrics to actively compute and display real-time throughput in **Mb/s** (megabits per second) instead of static bytes, improving monitoring visibility over the 5-second polling interval. 🚀

## [v1.2.1-patch.121] - 2026-02-28
### Added
- **UI**: Added a comprehensive System Information tab to Settings displaying active Host/Bridge execution context, Memory, Network I/O, and Disk capacity metrics. 🖥️
### Fixed
- **Backend API**: Abstracted Network I/O reads to dynamically find the correct host/container interface instead of hardcoding `eth0`, fixing compatibility for Ubuntu Host deployments. 🛠️

## [v1.2.1-patch.120] - 2026-02-28
### Added
- **IoT Simulation**: Interactive visual badges ("Pills") on device cards dynamically indicating active attack modes (C2 Beacon, DNS Flood, etc). 💀
### Changed
- **Settings UI**: Re-labelled "Initialize" button to "Add Probe" on the Connectivity configuration page for clarity. ✨

## [v1.2.1-patch.112] - 2026-02-28
### Added
- **Branding**: Comprehensive rebrand across the dashboard migrating all headers, assets, and typography from the generic "SD-WAN Traffic Generator" to "Stigix - Engine for SASE Validation". 🚀
- **Branding**: Implemented a pixel-perfect font-based SVG wordmark with customized "glow" and tracking for the primary header. ✨
### Changed
- **UI Softening**: Aggressively removed fully capitalized labels across all modals, configuration sheets, and sidebar navigation to adopt a premium, softened Title Case design aesthetic. 🎨
- **Theme**: Finalized the Traffic Generation and Maintenance System interface modules to seamlessly align with the dark glassmorphism standards.

## [v1.2.1-patch.111] - 2026-02-21
### Added
- **Documentation**: Significant rewrites to `SPECIFICATION.md`, `XFR_TESTING.md`, and `TARGET_CAPABILITIES.md` outlining the latest API and Prisma metrics capabilities. 📚
### Fixed
- **Convergence Engine**: Eliminated false blackouts for 0% packet loss metrics. Implemented intelligent rate-aware gap thresholds. 📉

## [v1.2.1-patch.109] - 2026-02-21
### Added
- **XFR Target**: Re-established native macOS (Colima/Orbstack) documentation and Docker instructions. 🍎
- **Speedtest**: Automatic pre-flight ICMP connectivity check preventing frozen tests before initiating the XFR bandwidth engine. 🩺
## [v1.2.1-patch.103] - 2026-02-20
### Added
- **Convergence Lab**: Automatic async enrichment of convergence test results with SD-WAN egress path data using Prisma Flow Browser (`getflow.py`). 🛣️🔍
  - After each test, a 60s fire-and-forget timer queries flow data using the deterministic source port (`30000 + testNum`).
  - Results are atomically merged into `convergence-history.jsonl` with an `egress_path` field.
  - Fully silent on failures (no credentials, no flow found, script missing). 🛡️
- **UI**: New **EGRESS PATH** widget (5th position) in the Convergence History card, showing path, `⏳ fetching...` for recent tests, or `—` for older records. 🎯✨

## [v1.2.1-patch.102] - 2026-02-20
### Fixed
- **Speedtest (XFR)**: Pivot to a modern pill-based layout for Quick Targets selection, replacing the problematic dropdown for better reliability and UX. 💊✨

## [v1.2.1-patch.101] - 2026-02-19
### Changed
- **Speedtest (XFR)**: Attempted dropdown UI refinements and auto-close logic (superseded by .102). 🛠️
- **Speedtest (XFR)**: Refined Quick Targets UI and improved auto-close behavior. ✨

## [v1.2.1-patch.100] - 2026-02-19
### Fixed
- **Backend**: Definitive removal of `FEATURE_FLAG_XFR` references in `server.ts` to resolve `ReferenceError` crashes. 🛠️
- **Frontend**: Removed the "Beta" tag from the Speedtest menu item. ✅

## [v1.2.1-patch.99] - 2026-02-19
### Fixed
- **XFR Phase 2 Cleanup**: Definitive removal of `FEATURE_FLAG_XFR` and "Beta" UI tags. ✅🛠️

## [v1.2.1-patch.98] - 2026-02-19
### Changed
- **DevOps**: Updated default XFR port to 9000 for consistency across environments. 🔢

## [v1.2.1-patch.97] - 2026-02-19
### Added
- **Speedtest (XFR)**: Support for `XFR_QUICK_TARGETS` environment variable to pre-populate targets. 🎯
- **Speedtest (XFR)**: XFR is now fully integrated and enabled by default (removed experimental feature flag). ✅
- **DevOps**: Switched `voice-echo` and `xfr-target` to `network_mode: host` in Docker Compose for improved performance and measurement accuracy. 🏗️
- **Documentation**: New [XFR Testing Guide](docs/XFR_TESTING.md) with configuration details. 📚

## [v1.2.1-patch.96] - 2026-02-19
### Fixed
- **DevOps**: Implemented dynamic XFR binary download in `xfr-target` Dockerfile to support multi-arch (AMD64/ARM64) builds. 🐳🏗️

## [v1.2.1-patch.95] - 2026-02-19
### Fixed
- **CI/CD**: Aligned GitHub Actions workflow secrets with existing repository settings for automated deployments. 🚀

## [v1.2.1-patch.94] - 2026-02-19
### Fixed
- **Connectivity**: Restricted `cport` protocol and automated `xfr-target` build process. 🛠️

## [v1.2.1-patch.93] - 2026-02-19
### Added
- **Speedtest (XFR)**: Enhanced custom options and implemented deterministic source port mapping. 🚀

## [v1.2.1-patch.92] - 2026-02-19
### Fixed
- **Speedtest (XFR)**: Refined XFR refinements including `target_ip` defaults, chart fixes, and enhanced logging. 📈📝

## [v1.2.1-patch.91] - 2026-02-19
### Added
- **DevOps**: Added multi-arch (AMD64/ARM64) build support for the `xfr-target` component. 🏗️

## [v1.2.1-patch.90] - 2026-02-19
### Added
- **Speedtest (XFR)**: Enhanced UI with searchable history widget and detailed results modal. 🔍📋
- **Backend**: Implemented SSE buffering fix (`X-Accel-Buffering`) for more reliable real-time telemetry. 📡

## [v1.2.1-patch.89] - 2026-02-19
### Added
- **Speedtest (XFR)**: Persistent results history storage (`xfr-history.json`) and RTT tracking. 📈💾
- **Backend**: Added robust authentication support via query string tokens for SSE metrics. 🛡️

## [v1.2.1-patch.88] - 2026-02-19
### Fixed
- **System Maintenance**: Further improved restart reliability by explicitly installing `docker-compose` in the container and adding robust binary detection (checking both standalone and plugin versions). 🛡️
- **System Maintenance**: Increased reliability of GitHub version detection by adding retries and a 10s timeout to the API fetch. 📡

## [v1.2.1-patch.78] - 2026-02-19
### Fixed
- **System Maintenance**: Improved version detection logic by switching to GitHub Tags API. 🔍
- **System Maintenance**: Fixed service restart and reload failures (exit code 125) by mounting `docker-compose.yml` into the dashboard container and implementing command fallback logic. 🛠️🔄

## [v1.2.1-patch.77] - 2026-02-19
### Changed
- **Documentation**: Updated README.md with detailed macOS installation output example and platform-specific bridge mode notices. 🍎📦

## [v1.2.1-patch.75] - 2026-02-18
### Added
- **VyOS Control**: Implemented manual "Refresh Info" for routers, enabling real-time detection of interface changes, hostname updates, and version changes. 🔄📡
- **VyOS Control**: Added safety dependency checks to prevent deleting routers that are still referenced by mission sequences. 🛡️🚫

## [v1.2.1-patch.74] - 2026-02-18
### Added
- **VyOS Control**: Implemented "Step-by-Step" sequence mode, allowing manual advancement of actions via "Next", "Rewind", and "Restart" controls in the timeline. ⏯️🪜
- **UI**: Added conditional Mission Parameters and interactive manual control bar for sequential demonstrations. 📊🕹️

## [v1.2.1-patch.73] - 2026-02-18
### Changed
- **Logs**: Enhanced server-side debug logging for Voice and VyOS import/export workflows to facilitate troubleshooting in production environments. 📝🔍

## [v1.2.1-patch.72] - 2026-02-18
### Fixed
- **Voice & VyOS**: Fixed configuration import processes by switching to JSON payloads and implementing real-time scheduler reloads in the backend. 📥🔄

## [v1.2.1-patch.71] - 2026-02-18
### Fixed
- **Dashboard**: Fixed weight persistence for object-based configurations in `server.ts`, ensuring UI changes are correctly saved and applied to traffic generation. ⚖️💾

## [v1.2.1-patch.70] - 2026-02-18
### Changed
- **Import/Export**: Modernized application configuration export/import to use structured JSON format by default, replacing legacy text formats. 📥📤

## [v1.2.1-patch.69] - 2026-02-18
### Added
- **Configuration**: Implemented robust migration logic for application configurations and standardized object-based defaults for new installations. 📦⚙️

## [v1.2.1-patch.68] - 2026-02-18
### Fixed
- **Traffic Engine**: Fixed `jq` parsing for legacy string formats in `traffic-generator.sh` to prevent script crashes. 🛠️🐚

## [v1.2.1-patch.67] - 2026-02-18
### Changed
- **Maintenance**: General stability updates and version alignment across all engine components. 🔢

## [v1.2.1-patch.66] - 2026-02-18
### Fixed
- **Traffic Engine**: Resolved parsing issues in the traffic generator and forced categorical migration for application configurations. 🚦⚙️
### Changed
- **UI**: General cleanup and refinement of dashboard components for better visual consistency. ✨

## [v1.2.1-patch.65] - 2026-02-18
### Fixed
- **Migration**: Refined categorized configuration migration logic and performed UI styling updates in the dashboard. 🛠️🎨

## [v1.2.1-patch.64] - 2026-02-18
### Changed
- **VyOS**: Unified VyOS configuration management and improved UI component interaction for sequences and routers. 🛡️⚙️

## [v1.2.1-patch.63] - 2026-02-18
### Fixed
- **Traffic Generator**: Fixed `jq` raw output handling in `traffic-generator.sh` to ensure correct application matching. 🛠️🐚

## [v1.2.1-patch.62] - 2026-02-18
### Added
- **Traffic Generator**: Added support for reading `applications-config.json` directly in the shell-based traffic generator. 🚦📦

## [v1.2.1-patch.61] - 2026-02-18
### Changed
- **Healthcheck**: Synchronized healthcheck syntax with user preferences and standard system requirements. 🩺🔄

## [v1.2.1-patch.60] - 2026-02-18
### Fixed
- **Healthcheck**: Improved healthcheck resilience during configuration migrations to prevent false positives. 🩺🛡️

## [v1.2.1-patch.59] - 2026-02-18
### Fixed
- **Deployment**: Fixed Docker healthcheck configuration and synchronized version strings across all service components. 🐳🔢

## [v1.2.1-patch.58] - 2026-02-18
### Fixed
- **Orchestrator**: Resolved `interfacesFile` ReferenceError and updated IoT device types for better simulation accuracy. 🛠️🤖

## [v1.2.1-patch.57] - 2026-02-18
### Added
- **Convergence & VyOS**: Implemented convergence testing fixes, configuration consolidation, and VyOS pre-flight connectivity checks. 📉🛡️

## [v1.2.1-patch.56] - 2026-02-17
### Fixed
- **Backend**: Resolved critical `TransformError` (variable redeclaration) causing container startup failure. 🛠️🔥
- **UI Versioning**: Fixed stale version reporting in the dashboard by updating API fallbacks and synchronizing `VERSION` files across all directories. 🔢🔄

## [v1.2.1-patch.55] - 2026-02-17
### Added
- **Voice UI**: Added specialized **Import/Export** buttons for Voice configuration bundles. 📥📤
### Changed
- **Voice Architecture**: Finalized configuration consolidation by moving the call counter from a standalone file into the unified `voice-config.json`. 🎙️⚙️
- **Version Sync**: Synchronized versioning across all components (`engines`, `web-dashboard`, root).

## [v1.2.1-patch.54] - 2026-02-17
### Fixed
- **Voice Control**: Fixed state synchronization issue where UI toggles were not persisting to the unified configuration file. 🎙️🔄
- **Backend**: Removed obsolete legacy configuration files (`voice-control.json`, `voice-servers.txt`) and updated all API endpoints to use `voice-config.json`.

## [v1.2.1-patch.53] - 2026-02-17
### Fixed
- **Voice Orchestrator**: Fixed a critical Python syntax error (indentation) introduced in the voice consolidation refactor. 🛠️🐛

## [v1.2.1-patch.52] - 2026-02-17
### Added
- **Voice Configuration Consolidation**: Merged `voice-control.json` and `voice-servers.txt` into a single `voice-config.json` for easier management. 🎙️📦
- **Security History Refactor**: Moved security test results to a dedicated line-delimited JSON log file (`security-history.jsonl`) for better persistence and observability. 🛡️📋
### Changed
- **Backend Architecture**: Optimized configuration handlers to support unified data structures and automated migration for legacy files. 🚀
- **Performance**: Improved security statistics tracking with dedicated counters and historical trend logging.

## [v1.2.1-patch.51] - 2026-02-17
### Fixed
- **IoT Device Launch**: Corrected argument passing to `iot_emulator.py`. 🛠️
  - Fixed `--behavior-type` error (replaced with `--security` JSON structure).
  - Restored missing `--fingerprint` argument for proper DHCP identification.
  - Ensured `--enable-bad-behavior` flag is passed when security is active.
- **Documentation**: Updated `README.md` with latest feature list and version info. 📚

## [v1.2.1-patch.50] - 2026-02-17
### Added
- **IoT Lab Generation**: Updated `generate_iot_devices.py` with new security options. 🔐
  - Added `--enable-security` to force enable attack mode on all devices.
  - Added `--security-percentage` to randomize security configuration in large labs.
- **Security Protocols**: Added official PAN-test-domains to IoT attack profiles for guaranteed detection. 🛡️

## [v1.2.1-patch.49] - 2026-02-17
### Changed
- **IoT Engine**: Included the latest version of the Scapy emulator script in the core package. 🚀
- **Version Alignment**: Standardized versioning across all engines and documentation.

## [v1.2.1-patch.48] - 2026-02-17
### Added
- **IoT Security Testing**: Initial release of "Bad Behavior" mode for IoT devices. 💀
  - New attack profiles: DNS Flood, C2 Beacon, Port Scan, Data Exfiltration.
  - Interactive UI with security toggles in device settings.
  - "ATTACK MODE" visual badges for real-time threat identification on cards.

## [v1.2.1-patch.47] - 2026-02-17
### Fixed
- **Rollback to Stable**: Reverted to `v1.2.1-patch.43` logic for Convergence Lab. 🛡️
  - Reverted recent stop sequence optimizations (patch.44, .45, .46) due to history reporting regressions.
  - Restored stable baseline for further investigation.

## [v1.2.1-patch.46] - 2026-02-17
### Fixed
- **Convergence History**: Restored history persistence that was broken in recent optimizations. 📋
- **Performance**: Optimized PPS (Packets Per Second) limit handling for more reliable high-load testing. ⚡

## [v1.2.1-patch.45] - 2026-02-17
### Fixed
- **Convergence Lab**: Finalized stop sequence logic and corrected packet counter discrepancies. 🔢
- **Regression Fix**: Resolved a critical regression that prevented correct RX loss calculation.

## [v1.2.1-patch.44] - 2026-02-16
### Changed
- **UX Optimization**: Improved the Convergence Lab stop sequence for a smoother user experience. ✨

## [v1.2.1-patch.43] - 2026-02-16
### Added
- **Traffic Volume History**: Persisted real-time stats to `traffic-history.jsonl` on the backend. 📈
  - New API endpoint `GET /api/traffic/history` with time range support.
  - Snapshot collector saves traffic metricsEvery 60 seconds.
- **Improved Dashboard UI**:
  - Added time range selector (1h, 6h, 24h) for traffic visualization.
  - Upgraded "Traffic Volume" chart with monotone area gradients and smooth curves.
  - Added glassmorphism effects and loading states for historical data synchronization.

## [v1.2.1-patch.42] - 2026-02-16
### Added
- **DC Cluster Discovery**: Enabled discovery of multiple IPs for Data Center (DC) sites. 🏢🏢
  - DC sites now generate distinct probes for every discovered IP/interface.
  - New naming convention for DC probes: `Site Name (IP Address)`.
  - Unique `discoveryKey` per IP to independently track enabled/disabled status in clusters.
  - Maintained single-probe logic for Branch sites.

## [v1.2.1-patch.41] - 2026-02-16
### Changed
- **Site Discovery UI Tuning**: Renamed "Sync Discovery" back to "Sync Prisma SD-WAN" for better clarity. ⚡
- **Discovery Metadata**: Added support for `interface_label` (e.g., "1 (Users VLAN)") in Site Discovery probes.
  - Updated `DiscoveryManager` to capture and persist the new `interface_label` field.
  - Enhanced detailed modal in Connectivity dashboard to display discovery parameters (Site ID, Interface, Network).
  - Config view now displays interface labels next to IP targets for discovered probes.

## [v1.2.1-patch.40] - 2026-02-16
### Fixed
- **Docker Build**: Fixed `ERR_MODULE_NOT_FOUND` by adding `discovery-manager.ts` to the Dockerfile runtime stage. 🐳

## [v1.2.1-patch.39] - 2026-02-16
### Added
- **Site Discovery Probes (DEM)**: Automatic discovery of Prisma SD-WAN sites. 🌐
  - New `DiscoveryManager` to fetch LAN interfaces via `getflow.py`.
  - Deterministic selection of one ICMP probe per site (Interface '1' preference).
  - Separate persistence in `connectivity-discovered.json` with user overrides support.
  - "Sync Discovery (ICMP)" action in the Connectivity dashboard with real-time status reporting.
  - "DISCOVERED" and "STALE" badges in performance and configuration views.

## [v1.2.1-patch.38] - 2026-02-15
### Fixed
- **Endpoint Status Display**: Fixed critical bug where disabled endpoints showed as "Active". 🐛
  - Corrected endpoint ID mapping to use name-based format matching backend (server.ts:1499)
  - Disabled endpoints now properly display "Inactive" status badge
- **UI Cosmetics**: Fixed horizontal shift and icon spacing issues. ✨
  - Added permanent scrollbar to prevent page shift when toggling inactive filter
  - Improved trash icon spacing in probe cards with better right padding

### Changed
- **Navigation Menu**: Improved menu organization and removed beta flags. 🎯
  - Removed "BETA" badge from IoT menu item
  - Reordered menu: Performance now appears before Security
  - New order: Dashboard → Statistics → Configuration → Performance → Security → IoT → Voice → Failover → NTOP → System

## [v1.2.1-patch.30] - 2026-02-15
### Fixed
- **Connectivity Performance**: Endpoint status now correctly displays Active/Inactive based on enabled field. 🐛
  - Fixed endpoint ID mapping to use name-based format matching backend
  - Disabled endpoints now properly show "Inactive" status badge

### Changed
- **Config Page UX**: Improved form layout and labels. ✨
  - Renamed "Profile Name" → "Probe Name"
  - Renamed "Protocol Type" → "Protocol"
  - Replaced Save icon with Edit (pen) icon
  - Widened "Target URI/IP" field (2 columns)
  - Renamed "Commit Update" → "Update"
  - Better vertical alignment of form fields
- **Performance Metrics**: Reduced font sizes for better visual balance. 📊
  - Global Experience: text-5xl → text-4xl
  - HTTP Coverage: text-4xl → text-3xl
- **Widget Layout**: Separated "Recent Performance Trends" from "Flaky Endpoints" widget. 🎨

## [v1.2.1-patch.29] - 2026-02-15
### Added
- **Connectivity Endpoints**: Enable/disable functionality for proactive monitoring control. 🔌
  - Power toggle in Config page and bulk "Enable/Disable All" actions.
  - "Show/Hide Inactive" filter and reduced opacity for disabled items.
- **IoT Emulator**: Added `--fingerprint` CLI support for manual device simulation. 🔐
### Changed
- **Config UX**: Improved form layout with better labels, wider fields, and edit icons. ✨
### Fixed
- **UI Styling**: Balanced font sizes in performance cards and fixed IoT markdown formatting. 📊

### Added
- **Convergence Lab**: Sync loss detection for long outages (>60s). 🕵️
- **UI**: Conditional display hiding directional ms metrics if server sync is lost, ensuring data reliability. 🛡️

## [v1.2.1-patch.24] - 2026-02-14
### Fixed
- **Convergence Tracking**: Improved tracking for long outages (>60s) with sync loss safety hooks. ⏱️
- **Echo Server**: Increased maintenance timeout and implemented cumulative counter logic. 🛡️
- **UI**: Refined metric casing ("ms") and polished directional loss labels. ✨

## [v1.2.1-patch.23] - 2026-02-14
### Fixed
- **Session Tracking**: Echo server now uses Test ID to maintain counters during failovers. 🔄
- **Safety**: Added safeguards to prevent artificial TX loss reporting on invalid counters. 🛡️

## [v1.2.1-patch.22] - 2026-02-14
### Added
- **Enriched Metrics**: Added directional loss duration (ms) and packet loss counters to history. ⏱️
### Changed
- **UI**: Refined Convergence History layout with dedicated source port columns. ✨

## [v1.2.1-patch.21] - 2026-02-14
### Fixed
- **Server**: Resolved `ReferenceError: require is not defined` in API endpoints (full migration to ESM for child_process calls). 🚀

## [v1.2.1-patch.20] - 2026-02-14
### Fixed
- **Orchestrator**: Restored missing `server_received` counter in stats output (fixes "Echo: -" display). 🛠️
- **UI**: Improved clarity in Convergence Lab history by renaming "TX" and "RX" to "TX Loss" and "RX Loss". 🔢

## [v1.2.1-patch.19] - 2026-02-14
### Fixed
- **UI**: Removed enforced uppercase styling from input fields in Login and Configuration pages (Profile Name, Target URI, Interface) to allow mixed-case entry. 🔡

## [v1.2.1-patch.18] - 2026-02-14
### Added
- **Convergence History**: Enhanced UI with detailed packet loss statistics and visual indicators. 🔢
- **UI Build**: Fixed missing Globe icon import preventing build in patch.17. 🌐


## [1.2.1-patch.17] - 2026-02-14
### Added
- **Networking**: Added Public IP detection and display in the main dashboard 🌍
- **Maintenance**: Added "Power & Restart" controls (Restart Services / Full System Reload) 🔌
### Fixed
- **UI**: Fixed version display format (removed duplicate 'v') 🔢
### Changed
- **UX**: Removed "Export" button from Connectivity Performance component 🗑️

## [1.2.1-patch.16] - 2026-02-14
### Added
- **Voice**: Added "Reset ID" button to reset CALL-ID counter to 0000 🔄
- **Failover**: Added "RESET ID" button to reset CONV-ID counter to 0000 🔄
## [1.2.1-patch.15] - 2026-02-08
### Fixed
- **System Maintenance**: Fixed version detection to use GitHub Releases API instead of Tags API for correct chronological ordering (was showing v1.2.1 instead of latest patch version) 🔧

## [1.2.1-patch.14] - 2026-02-08
### Fixed
- **CRITICAL**: Restored `/iot` directory and IoT emulator that was accidentally deleted in patch.9 🚨
- **Dockerfile**: Re-added IoT directory COPY and pip install commands
- **IoT Manager**: Reverted unnecessary safety check (script is now present)

## [1.2.1-patch.13] - 2026-02-08
### Fixed
- **IoT Manager**: Added safety check to prevent attempting to spawn missing Python emulator script (gracefully handles IoT feature removal) 🛡️

## [1.2.1-patch.12] - 2026-02-08
### Fixed
- **Docker Build**: Removed `/iot` directory references from Dockerfile (directory was deleted in patch.9 causing build failures since patch.8) 🔧

## [1.2.1-patch.11] - 2026-02-08
### Changed
- **VyOS Control**: New mission sequences now default to "Manual Trigger Only" instead of "60 Minute Cycle" for better UX 🎯

## [1.2.1-patch.10] - 2026-02-08
### Fixed
- **VyOS Controller**: Made discovery timeout configurable via `VYOS_DISCOVERY_TIMEOUT_MS` env var (default 30s, was hardcoded 15s with incorrect error message) 🔧
- **Web UI Container**: Added `vim-tiny` editor for easier debugging and troubleshooting inside the container 📝

## [1.2.1-patch.9] - 2026-02-08
### Changed
- **Documentation**: Comprehensive README.md improvements with table of contents, organized screenshot gallery (9 categories), What's New section, and reorganized documentation by user journey 📚

## [1.2.1-patch.8] - 2026-02-08
### Changed
- **Voice Dashboard**: Renamed "Diagnostic Monitoring" to "Call Monitoring" and "Commit Configuration" to "Save" for better clarity 📝

## [1.2.1-patch.7] - 2026-02-08
### Fixed
- **Docker Build**: Fixed syntax error in `ConnectivityPerformance.tsx` that caused build failure in v1.2.1-patch.6 🏗️

## [1.2.1-patch.6] - 2026-02-08
### Fixed
- **Security Dashboard**: Added "Allowed" statistics column to the DNS dashboard to visualize allowed DNS queries 🛡️
- **Connectivity Performance**: Fixed "Flaky Endpoints" widget to correctly filter out deleted endpoints unless "Show Deleted" is enabled 🐛

## [1.2.1-patch.5] - 2026-02-08
### Added
- **Synthetic Probes Import/Export**: Added full JSON configuration export and import for Synthetic Probes (DEM) in the Configuration tab. 📤📥
- **Voice MOS Score**: Real-time **Average MOS Score** display in the Voice Dashboard QoS summary. 🎙️📊
- **Green Favicon**: Implemented a new Green Digital Globe favicon for the Target App (`engines/http_server.py`). 🌍💚
### Fixed
- **Version Synchronization**: Aligned version numbers across all components (`engines`, `web-dashboard`, documentation) to `v1.2.1-patch.5`. 🔄✅

## [1.2.1-patch.4] - 2026-02-08
### Fixed
- **Security Configuration**: Resolved EICAR config overwrite issue preventing proper threat prevention test execution. 🛡️
- **Help Integration**: Added help link button to Security tab for quick access to documentation. 📚

## [1.2.1-patch.3] - 2026-02-08
### Added
- **HTTP Target Service**: Introduced dedicated HTTP echo service for application testing scenarios. 🎯
- **Target Server Improvements**: Enhanced target infrastructure for more realistic testing patterns.

## [1.2.1-patch.2] - 2026-02-08
### Fixed
- **Version Rollback**: Rolled back to stable v1.2.0-patch.5 due to instability detected in v1.2.1. ⏪
- **Stability Priority**: Ensured production reliability by reverting breaking changes.

## [1.2.1-patch.1] - 2026-02-08
### Fixed
- **DEM Status Badge**: Corrected status badge logic for synthetic probe endpoints with no history. 🏷️
- **UI Consistency**: Improved display of monitoring status across all probe types.

## [1.2.1] - 2026-02-08
### Added
- **Enhanced DEM Scoring**: Implemented improved Digital Experience Monitoring (DEM) scoring algorithm. 📊
- **Advanced Metrics**: Enhanced synthetic probe analytics with more granular scoring methodology.

## [1.2.0-patch.5] - 2026-02-08
### Fixed
- **Convergence Engine**: Disabled debug mode by default to reduce log verbosity in production environments. 🔇

## [1.2.0-patch.4] - 2026-02-08
### Added
- **Failover Display**: Enhanced failover visualization with improved status indicators. 📡
### Fixed
- **Flaky Endpoints**: Improved detection and handling of intermittently unreachable endpoints. 🔍

## [1.2.0-patch.3] - 2026-02-08
### Added
- **Convergence Debug Mode**: Added debug mode toggle for convergence testing with detailed packet logging. 🐛
- **Signal Handling**: Improved graceful shutdown and signal handling for long-running tests.

## [1.2.0-patch.2] - 2026-02-08
### Fixed
- **Packet Loss Accuracy**: Improved packet loss count accuracy in convergence test results. 📈

## [1.2.0-patch.1] - 2026-02-08
### Fixed
- **UI Consistency**: Standardized BETA badge colors to blue across all beta features. 🎨

## [1.1.2-patch.33.104] - 2026-02-08
### Changed
- **Performance Limit**: Increased global PPS (Packets Per Second) limit from 500 to 1000 for high-throughput failover testing. ⚡

## [1.1.2-patch.33.103] - 2026-02-08
### Fixed
- **VyOS UI**: Hidden parameters display for `clear-blocks` and `get-blocks` commands (no parameters required). 🔧

## [1.1.2-patch.33.102] - 2026-02-08
### Added
- **VyOS UI Polish**: Added BETA badge to VyOS features and improved interface display with enhanced labeling. ✨

## [1.1.2-patch.33.101] - 2026-02-08
### Fixed
- **VyOS Parameters**: Removed parameters from `clear-blocks` and `get-blocks` commands (not required by API). 🛠️

## [1.1.2-patch.33.100] - 2026-02-08
### Fixed
- **CRITICAL VyOS Fix**: Stopped sending `--iface` parameter for block/unblock commands (causes command failures). 🚨

## [1.1.2-patch.33.99] - 2026-02-07
### Added
- **VyOS Save Tooltip**: Added tooltip to save button showing requirements (at least one router configured). 💡

## [1.1.2-patch.33.98] - 2026-02-07
### Fixed
- **VyOS Interface Handling**: Improved default interface selection for newly created VyOS actions. 🔧

## [1.1.2-patch.33.97] - 2026-02-07
### Changed
- **VyOS Script Update**: Replaced control script with updated version supporting global blackhole routes. 🚀

## [1.1.2-patch.33.96] - 2026-02-07
### Fixed
- **VyOS Block Actions**: Hidden interface field for block/unblock actions (uses global routing). 🔒
- **Enhanced Logging**: Added detailed execution logging for troubleshooting.

## [1.1.2-patch.33.95] - 2026-02-07
### Added
- **Global Blackhole Routes**: Simplified VyOS block/unblock with system-wide blackhole routing instead of per-interface rules. 🌐

## [1.1.2-patch.33.94] - 2026-02-07
### Fixed
- **Voice Icons**: Added missing imports for voice call status icons (call active, completed, failed). 📞

## [1.1.2-patch.33.93] - 2026-02-07
### Changed
- **Route Validation**: Removed unreliable route validation log that caused false positive warnings. 🗑️

## [1.1.2-patch.33.92] - 2026-02-07
### Added
- **Voice Call Status**: Refined voice call status symbols with intuitive icons. 🎙️
### Fixed
- **IoT Log Viewer**: Fixed theme inconsistency in IoT device log viewer. 🎨

## [1.1.2-patch.33.91] - 2026-02-07
### Fixed
- **Convergence Metadata**: Properly populated convergence test metadata in stats JSON output. 📝

## [1.1.2-patch.33.90] - 2026-02-07
### Added
- **Failover Display v3**: Further refined failover status display with improved visual hierarchy. 📊
### Changed
- **Modal Ports**: Disabled modal port configuration (moved to advanced settings).

## [1.1.2-patch.33.89] - 2026-02-07
### Fixed
- **Failover Layout**: Rolled back experimental failover layout and added descriptive details text. ⏪

## [1.1.2-patch.33.88] - 2026-02-07
### Added
- **Failover Redundancy**: Refined failover redundancy visualization. 🔄
- **Voice Alignment**: Improved voice metrics alignment in dashboard.

## [1.1.2-patch.33.87] - 2026-02-07
### Changed
- **Voice History Layout**: Refined voice call history table layout for better readability. 📋

## [1.1.2-patch.33.86] - 2026-02-07
### Changed
- **VyOS Sequence Display**: Refined command display in VyOS sequence timeline. 📅

## [1.1.2-patch.33.85] - 2026-02-07
### Fixed
- **Voice Call ID Display**: Display full voice call ID without truncation in web dashboard. 🔍

## [1.1.2-patch.33.84] - 2026-02-07
### Added
- **MCP with SSE Transport**: Implemented Server-Sent Events (SSE) transport for MCP server using FastMCP. 🌐
### Documentation
- **LLM Prompt Section**: Added LLM prompt guidance to IoT simulation documentation. 🤖

## [1.1.2-patch.33.83] - 2026-02-06
### Fixed
- **MCP Container**: Changed Dockerfile CMD to keep MCP server container running continuously. 🐳

## [1.1.2-patch.33.82] - 2026-02-06
### Changed
- **MCP Configuration**: Configured MCP server to use pre-built Docker images from registry. 📦

## [1.1.2-patch.33.81] - 2026-02-06
### Added
- **MCP Server**: Added Model Context Protocol (MCP) server for multi-agent orchestration via Claude Desktop. 🤝

## [1.1.2-patch.33.80] - 2026-02-06
### Changed
- **Auto-Start Traffic**: Enabled automatic traffic generation on startup by default. 🚀

## [1.1.2-patch.33.79] - 2026-02-06
### Added
- **Live Streaming Logs**: Improved background contrast for Live Streaming Logs in light mode. ☀️
- **VyOS Sequence Display**: Enhanced sequence timeline with smart command labels and filtering capabilities. 🎯

## [1.1.2-patch.33.78] - 2026-02-05
### Removed
- **UI Cleanup**: Removed redundant Environment Discovery block from Configuration page. 🗑️

## [1.1.2-patch.33.77] - 2026-02-05
### Added
- **Compact Sequences UI**: Implemented compact VyOS sequences interface for better space utilization. 📐
- **Professional Terminology**: Finalized professional naming conventions across VyOS features. 📖
- **IoT Documentation**: Updated IoT generator documentation and tooling. 📚

## [1.1.2-patch.33.76] - 2026-02-04
### Fixed
- **VyOS Control**: Fixed a bug in `vyos_sdwan_ctl.py` where clearing combined QoS policies could fail due to incorrect argument handling. 🛠️🐛
- **Version Display**: Removed redundant 'v' prefix in version display across all modules. 🔢
### Changed
- **Script Refactoring**: Refactored `vyos_sdwan_ctl.py` for better CLI ergonomics, streamlined argument descriptions, and improved auto-detection logic for router versions. 🚀📝
- **VyOS Beta Warning**: Added a caution regarding VyOS Firewall automation. Still in **Beta** due to significant CLI disparities between legacy (1.4 2021/2022) and modern (1.5) releases. 🛡️⚠️
### Documentation
- **Version Backfill**: Added missing version entries to CHANGELOG and documentation updates.


## Earlier Versions

_For versions 1.1.2-patch.33.75 and earlier, please refer to the existing CHANGELOG.md file._

_Full version history continues with entries for v1.1.2-patch.33.75, v1.1.2-patch.33.71-74, v1.1.2-patch.33.65-70, and all earlier releases down to v1.0.0._
