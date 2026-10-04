# Changelog - Stigix V2 Development Branch

All notable changes made specifically on the `v2` branch are documented in this file.

## [v2.0.149] - 2026-10-04 — Fix: PCAP Profile Compilation Flow Selection & Archive Password Input
- **fix(pcap-parser)**: Fixed indentation bug in `compile_stx_profile()` (`engines/pcap_parser.py`) where passing `--flow-id` skipped appending to `flows_to_include`, triggering fatal `ValueError: No flows selected or available for replay profile` (code 1) during profile compilation. Validated with 100% success rate on 33 captures in `New samples` including `145.pcap`.
- **fix(pcap-routes)**: Preserved temporary upload file upon compilation errors in `web-dashboard/custom-tcp-apps/pcap-routes.ts` instead of unlinking immediately, eliminating premature `"Temporary capture file expired or not found"` errors. Surfaced raw JSON parser errors directly to frontend toasts.
- **feat(pcap-zip)**: Added configurable **Archive Password (Optional)** input field in `PcapReplayModal.tsx` for encrypted ZIP archives. Forwarded password through inspect and compile endpoints to `pcap_parser.py --password`. Added expanded security research dictionary (`infected666p`, `infected666`, `infected666c`, and auto-detected date formats `infected_YYYYMMDD`).

## [v2.0.148] - 2026-10-04 — Feature: PCAP Flow Filtering, Profile Editing, Continuous Replay Loops & Cumulative Byte Telemetry

- **feat(pcap-parser)**: Added intelligent packet and flow classification in `engines/pcap_parser.py`. Automatically identifies and tags network background noise (`DHCPv6 Solicit/Reply`, `LLMNR`, `mDNS`, `NetBIOS`, IPv4/IPv6 subnet broadcasts) as `is_noise: True`. Clean unicast flows are automatically sorted first in inspect tables and the profile compiler excludes noise flows by default if unicast flows exist.
- **feat(pcap-ui)**: Enhanced PCAP Import & Inspect modal (`PcapReplayModal.tsx`) with fast bulk filter controls: `Select All`, `Deselect All`, `Unicast Only` (auto-deselects noisy broadcast/multicast packets), `+ TCP`, `- TCP`, `+ UDP`, and `- UDP`. Added packet breakdown badges (`IPv4`, `IPv6`, `ARP / Other`).
- **fix(pcap-profile-edit)**: Fixed "Edit Replay Profile" save button visibility in `PcapReplay.tsx`. Replaced invalid Tailwind class `bg-primary text-black` with vibrant indigo styling (`bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg cursor-pointer`), allowing operators to edit scenario names, category tags, default server ports, and descriptions without confusion.
- **feat(pcap-runtime)**: Added full looping and interval support to UDP client replay (`run_udp_client()` in `engines/pcap_replay_runtime.py`). Emits `loop_cycle_completed` telemetry events with iteration index and cumulative bytes.
- **feat(pcap-telemetry)**: Integrated cumulative total byte counting (`cumulative_tx_bytes`, `cumulative_rx_bytes`, and total exchanged volume) in `PcapReplay.tsx`. The SASE Telemetry Hub displays continuous live throughput and cumulative payload volume across loop iterations alongside a `Loop #X` badge.
- **feat(pcap-ui)**: Added active scenario awareness to Server and Client control buttons (`START SERVER LISTENER: [Scenario] (PORT [Port])`, `STOP SERVER: [Scenario] (PID [pid])`, `LAUNCH CLIENT: [Scenario] ➔ [Target IP]`). Added real-time pulsating badges in the Profiles Catalogue card indicating running Server/Client processes, and a persistent notification banner when inspecting a scenario other than the actively running one.
- **feat(pcap-benchmark)**: Implemented automated batch extractor benchmark and security validator script in `engines/benchmark_pcap_zip.py`. Seamlessly discovers, unpacks, and benchmarks nested malware/exploit PCAPs (e.g. `EXPLOIT KITS and MALWARE.zip`, `CRIME.zip`, `GENERAL.zip`) without writing uncompressed PCAPs or binaries to disk (`Memory Guard`). Features automatic archive password trials (`infected`, `virus`, `malware`), payload threat heuristic detection (PE/MZ binaries, shellcode sleds, exploit kit JS, HTTP dropper requests), compression ratio metrics, and profile compilation validation.
- **feat(pcap-zip)**: Added native ZIP archive upload and unpacking support to both the PCAP parser engine (`unpack_pcap_from_zip` in `engines/pcap_parser.py`) and the Web Dashboard modal (`PcapReplayModal.tsx`). Operators can now directly drag-and-drop or select `.zip` archives containing captures (including nested `.pcap.zip` archives with malware password recovery). The engine streams and extracts the capture into an ephemeral buffer with automatic cleanup, displays source archive metadata (`archive_source`), and auto-suggests clean scenario names.

## [v2.0.147] - 2026-10-04 — Fix: PCAP Parser Regex Scrubbing & UI Large Flow Pagination

- **fix(pcap-parser)**: Fixed fatal `IndexError: no such group` in `scan_and_scrub_payload` (`engines/pcap_parser.py`). The email regex had a single capture group while the scrubbing routine hardcoded `match.group(2)`. Replaced with `SENSITIVE_DEFINITIONS` and regex substitution functions (`_scrub_two_groups` and `_scrub_email`) ensuring seamless sanitization of captures containing email addresses (such as `2013-11-06_capture-win8.pcap`).
- **fix(pcap-parser)**: Hardened packet ingestion loop in `inspect_pcap` (`engines/pcap_parser.py`) with safe packet-by-packet reading, gracefully catching `EOFError`, `StopIteration`, and malformed packets without aborting the entire PCAP inspection.
- **feat(pcap-ui)**: Added pagination and progressive loading (`turnDisplayLimit`, `Load +250 turns`, `Load All`) in `PcapReplay.tsx` for large flows (e.g. captures with 5,000–10,000+ turns), preventing browser DOM freezing and maintaining smooth UI responsiveness.

## [v2.0.146] - 2026-10-04 — Feature: Fleet-Wide PCAP Replay Profile Auto-Sync & Conflict-Free Port Resolution

- **fix(pcap-target)**: Eliminated `127.0.0.1` loopback reset bug. Removed conflicting background `useEffect` that continuously forced loopback IP whenever `serverNodeId === 'local'`. Added persistent `localStorage` storage for chosen destination IP (`stigix_replay_target_ip`) and target server node (`stigix_replay_server_node`). Added multi-field Leader auto-discovery fallback on spoke nodes (`leader_info`, `leader_tunnel_info`, `remoteLeaderIp`, `controller_url`, `static_leader_url`). Opening or switching profiles no longer resets the selected target IP.
- **feat(pcap-turns)**: Overhauled Conversation Sequence widget into an intuitive protocol intelligence storyboard. Fixed critical turn direction evaluation bug where `turn.direction === 'client_to_server'` previously failed on parsed profiles, causing all turns to be uniformly mislabeled as `SERVER`. Direction badges now accurately contrast `⬆️ Client ➔ Server` (bright blue) vs `⬇️ Server ➔ Client` (purple). Added direction filter pills (`[ All | ⬆️ Client | ⬇️ Server ]`), real-time turn search, automatic protocol signature recognition (`SIP Signaling`, `RTP Voice`, `TLS Handshake`, `HTTP REST`, `DNS Datagram`, `Binary L7`), and human-readable payload snippets for every row.
- **feat(pcap-inspector)**: Integrated professional Wireshark-style 16-byte Hex Dump & Clean ASCII payload inspector with byte offset counters, ASCII representation column, and 1-click clipboard copy actions.
- **feat(pcap-live)**: Replaced repetitive raw UDP terminal dump with a rich **SASE Telemetry Hub**. Features a prominent Hero SASE Security Verdict Card detailing firewall policy enforcement (`Bypass / Allowed`, `Blocked via TCP RST`, `Silent Drop / Timeout`), 4 real-time KPI tiles (Turns Completed with progress gauge, Data Volume TX/RX, Elapsed Duration & Latency per turn, Overlay Target), and a 3-mode Console (`Timeline` milestone view, `Stream Log`, `Raw JSON`).
- **refactor(pcap-ui)**: Re-architected PCAP Replay layout into a balanced 3-column workspace (`lg:col-span-3`, `lg:col-span-4`, `lg:col-span-5`) with an integrated Stateful Replay Control Ribbon directly inside the top banner. Completely eliminates vertical stacking issues where the Live Console was hidden below the fold in Server mode. Narrowed Profiles Catalogue to 25% width, dedicated 33% to Conversation Turns Sequence & Payload Inspector, and allocated 42% to the Live Activity Console & SASE Verdict.
- **fix(spoke-peers)**: Enabled Leader peer auto-discovery on spoke nodes in `PeerContext.tsx` via `/api/registry/status`. When a spoke node like BR8 loads the dashboard, it automatically discovers and selects the Leader (`DC1-Ubuntu` at `192.168.203.100`), eliminating the default `127.0.0.1` loopback confusion.
- **feat(pcap-engine)**: Added native UDP datagram telemetry and verdict calculation in `pcap_replay_runtime.py` and `PcapReplay.tsx`. Decodes UDP packet streams (`⬆️ UDP ➔ DC1:port` and `⬇️ UDP  Client:port`) in the Live Activity Console with byte counters, turn sequences, and final `Bypass` session metrics.
- **fix(pcap-modal)**: Added automatic state reset when opening `PcapReplayModal.tsx`, ensuring reopening the modal always lands on the initial upload step instead of remaining on the previous inspection screen.
- **feat(provisioning)**: Added `pcap-profiles` bundle type to Stigix Global Mesh Provisioning (`provisioning-manager.ts` and `server.ts`). Compiling or uploading `.stx-replay` profiles on the mesh Leader automatically broadcasts and synchronizes the profiles across all remote spoke nodes (DC1, BR1, BR2, BR5, BR8) over WebSocket tunnels, completely eliminating manual export/import steps.
- **feat(pcap-replay)**: Added **Profile Editing Modal** and `PUT /api/pcap/profiles/:filename` endpoint in `custom-tcp-apps/pcap-routes.ts`, allowing operators to customize scenario names, category tags, default server ports, and security context descriptions directly from the catalogue with automatic gzip repackaging and fleet-wide mesh re-sync.
- **feat(pcap-replay)**: Implemented intelligent remote peer target auto-selection when entering Client Mode (`PcapReplay.tsx`). Prevents loopback `127.0.0.1` self-traffic confusion and `[Errno 111] Connection refused` errors by automatically selecting the remote peer's private IP (e.g., DC1) and displaying real-time traffic path telemetry badges (`Loopback Mode` vs `SD-WAN Replay Path`).
- **feat(pcap-replay)**: Upgraded Real-Time Replay Socket Console with a human-readable **Live Activity** mode that decodes incoming/outgoing directional packet turns (`⬆️ CLIENT ➔ SERVER` vs `⬇️ SERVER ➔ CLIENT`), byte counters, turn latencies, server listener states, and color-coded security verdicts (`Bypass`, `Reset`, `Drop`). Added toggle between formatted and raw JSON views, log clearing, and live `DONE` / pulsing `LIVE` turn indicators in the Conversation Turns timeline.
- **feat(pcap-engine)**: Added intelligent conflict avoidance in `engines/pcap_parser.py`. If captured flows use ports conflicting with Stigix web daemons or core services (ports `8443`, `8080..8090`, `80`, `443`), the profile compiler automatically remaps the replay target port (`10000 + port` e.g., `18443`), preserving the original captured port metadata while guaranteeing conflict-free execution.
- **feat(ui)**: Enhanced `PcapReplayModal.tsx` with customizable target replay port input, real-time conflict warning banner, automatic peer server listener discovery polling, 1-click profile deletion across the mesh, and a dedicated `"Auto-sync Fleet"` status badge.
- **feat(api)**: Added `DELETE /api/pcap/profiles/:filename` endpoint and enhanced `POST /api/pcap/profiles/upload` with automatic file destination routing and provisioning sync callbacks.
- **feat(pcap-replay)**: Promoted PCAP Replay to a top-level dedicated tab in the Stigix navigation bar (`App.tsx`). Implemented comprehensive `PcapReplay.tsx` dashboard featuring Zero-Config Profile Catalogue with live payload and turn sequence inspector, multi-node mesh peer orchestration selector, real-time SASE security verdict telemetry banner (`Bypass`, `RST`, `Drop`, `Block Page`), and live socket streaming console.
- **feat(pcap-replay)**: Added dual **Server Mode (Listen)** and **Client Mode (Play)** role switcher to `PcapReplay.tsx`, allowing operators to seamlessly bind background listener sockets on DC1 and execute client replay runs from branch spoke nodes (BR8) without manual CLI intervention.
- **feat(pcap-replay)**: Enhanced Conversation turns inspector with automated binary/TLS protocol detection (`TLS Handshake`, `HTTP Application`, `Binary Stream`, `Plaintext`) and an interactive **Hex Dump** viewer that formats raw binary byte sequences into clean, aligned 16-byte offset blocks.
- **refactor(pcap-ui)**: Compacted vertical footprint across the PCAP Replay dashboard (`PcapReplay.tsx`). Compressed scenario cards in the catalogue from 3 rows into 2 sleek inline rows (title, category badge, turns, port, size) with tooltip-backed raw filenames and hover actions, cutting scenario item height by 50%. Enforced viewport-bounded column heights (`h-[calc(100vh-175px)]`) with independent internal widget scrolling across the profiles catalogue, turns timeline, and socket console, eliminating whole-page vertical scrolling.
- **refactor(pcap-import)**: Streamlined PCAP capture import workflow in `PcapReplayModal.tsx` to automatically compile, publish across the mesh, close the modal, and select the generated profile directly in the dashboard catalogue.
- **feat(api)**: Added `GET /api/pcap/profiles/details/:filename` endpoint in `custom-tcp-apps/pcap-routes.ts` to transparently decompress and deliver full flow and turn metadata for instant zero-config profile inspection.
- **fix(topology)**: Extracted Topology header and Logical Overlay View widget into a dedicated Top Bar outside of the ReactFlow drawing canvas in `Topology.tsx`. Completely eliminates node overlap and truncation for top-tier Datacenter/Hub sites during canvas zooming, panning, and site focus mode.

## [v2.0.145] - 2026-10-03 — Fix: Multi-Platform Docker Builds for Release Tags (AMD64 + ARM64) & Security UI Refactor

- **feat(pcap-engine)**: Implemented Milestone 2 (M2) Stateful Replay Runtime in `engines/pcap_replay_runtime.py` and backend process orchestration in `web-dashboard/custom-tcp-apps/pcap-routes.ts`. Executes byte-accurate TCP and UDP application turn replays between Stigix nodes with synchronous socket state machine, loop interval controls, and automated security verdict calculation (`Bypass`, `Enforced (Reset)`, `Enforced (Drop)`, `Enforced (Block Page)`, and `Inconclusive`).
- **feat(ui)**: Implemented Milestone 3 (M3) PCAP Replay UI with `PcapReplayModal.tsx` in `web-dashboard/src/CustomApps.tsx`. Features drag-and-drop capture upload, streaming flow discovery table with security credential warnings, automated scrubbing toggles, profile compilation, and live execution telemetry with real-time turn and verdict progression.
- **feat(pcap-engine)**: Implemented Milestone 1 (M1) of the PCAP Stateful Replay Engine. Added streaming PCAP/PCAPNG packet parser in `engines/pcap_parser.py` with TCP segment reassembly, flow detection, de-duplication, directional application turn compilation, UDP datagram support, sensitive credential scanning, and optional automated scrubbing into gzip-compressed `.stx-replay` profiles. Added `ENABLE_PCAP_REPLAY` feature flag and API endpoints in `web-dashboard/custom-tcp-apps/pcap-routes.ts`.
- **docs**: Published Product Requirement Document for PCAP Stateful Replay Engine in [docs/PRD_PCAP_REPLAY_ENGINE.md](file:///Users/jsuzanne/Github/stigix/docs/PRD_PCAP_REPLAY_ENGINE.md), detailing the two-phased roadmap (Phase 1: L7 Socket Replay with conversation turn extraction, Phase 2: Raw Line-Rate L2/L3 tcpreplay hook) and payload storage optimization.
- **docs**: Restructured project README with 30-Second Quick Start placed immediately at the top, elevated 5 Core Functional Pillars (Traffic & DEM, SASE & Security, SD-WAN Chaos & VyOS, IoT & Voice, AI FastMCP & Mesh), and optimized clarity for engineers, partners, and enterprise clients.
- **refactor(custom-tcp)**: Streamlined Custom Applications toolbar and metric cards in `web-dashboard/src/CustomApps.tsx`. Removed redundant port/peer/mode labels and duplicate bottom status row from the active application banner, integrating health score and ZTP badges into the title header.
- **feat(ui)**: Refactored the header and action bars across all 5 Security test sections in [Security.tsx](file:///Users/jsuzanne/Github/stigix/web-dashboard/src/Security.tsx) (*URL Filtering*, *DNS Security*, *Threat Prevention / EICAR*, *C2 Scenarios*, *AI Security*). Moved Schedule controls, Next Run timestamps, and HTTP/HTTPS protocol toggles directly into the top collapsible headers inline, keeping inner section toolbars exclusively focused on `Select All` and `Run Selected Tests`.
- **fix(ci/cd)**: Enabled multi-platform Docker builds (`linux/amd64,linux/arm64`) on all Git release tags (`refs/tags/*`) in `.github/workflows/build-stigix-allinone.yml`. Previously, only direct pushes to `main` triggered multi-arch builds, leaving tags on `linux/amd64` only. Now Apple Silicon (M1/M2/M3/M4) and ARM64 hosts pull native arm64 containers without emulation warnings.

## [v2.0.144] - 2026-10-03 — Feature: Stigix V2 Login Console Redesign & URL Filtering HTTPS Toggle

- **feat(ui)**: Redesigned the entire Login screen (`Login.tsx`) with a state-of-the-art Stigix V2 dark glassmorphism aesthetic, cyber grid radial background, ambient neon orbs, animated Activity logo, and updated tagline `"The Engine for SASE Validation"`.
- **feat(security)**: Added instant `[ 🌐 HTTP | 🔒 HTTPS ]` toggle to URL Filtering with dynamic URL transformation to easily demonstrate and validate SSL Forward Proxy Decryption with Prisma Access.
- **fix(install)**: Enhanced `install.sh` and `install-autodocker.sh` with multi-tier Magic Join token decoding (Python3 / Node / POSIX grep+sed) and unconditional `config/site-name.json` persistence, ensuring `Local Site Name` is instantly and automatically configured on newly deployed nodes.

## [v2.0.143] - 2026-10-03 — Feature: Prisma Access SSL Decryption & 1-Click CA Certificate Import

- **feat(security)**: Added native support for Palo Alto Prisma Access **Forward Trust CA** and custom enterprise Root CA certificates in `certificate-manager.ts`.
- **feat(security)**: Implemented **1-Click Auto-Import** from Prisma SASE / SSE API (`/sse/config/v1/certificates`), automatically extracting `Forward-Trust-CA` (RSA & ECDSA) and `Root CA` into `config/certs/ca-bundle.pem`.
- **feat(security)**: Automated runtime injection across Node.js (`NODE_EXTRA_CA_CERTS`, `https.globalAgent`) and Python engines (`REQUESTS_CA_BUNDLE`, `SSL_CERT_FILE`), enabling seamless HTTPS threat testing (EICAR, URL Filtering, DLP) through Prisma Access SSL decryption without TLS errors.
- **feat(provisioning)**: Added `ca-certificates` to Stigix Mesh Provisioning. Importing the CA certificate on the Leader automatically propagates and activates the certificate bundle across all remote spoke nodes (DC1, BR1, BR2, BR5, BR8).
- **feat(ui)**: Added SSL Decryption & Enterprise CA Certificates management card in **Settings ➔ Prisma SASE API**, featuring 1-Click import, manual file upload/PEM paste modal, certificate metadata cards (Common Name, Issuer, Validity, SHA-256), bundle download, and raw PEM viewer.

## [v2.0.142] - 2026-10-02 — Feature: Real-Time Progress Bar & Spinners for VyOS Topology Actions

- **feat(topology)**: Added animated spinners (`Loader2`), laser sweep progress bars, and execution state labels across all 3 VyOS underlay buttons (`SHUT PORT` / `NO SHUT`, `INJECT QOS`, `CLEAR QOS`).
- **feat(topology)**: Added live execution progress indicator with estimated duration (~3-4s) in both the underlay link details drawer and the Netem Impairment modal while VyOS SSH scripts run.
- **feat(topology)**: Prevented redundant clicks and provided immediate visual feedback with loading states during interface shut, no-shut, latency/loss injection, and QoS clearing.

- **fix(theme)**: Added `@custom-variant dark (&:where(.dark, [data-theme="dark"], .dark *, [data-theme="dark"] *));` to `index.css`. Resolves a critical bug where Tailwind v4 defaulted to `@media (prefers-color-scheme: dark)`, causing `dark:*` styles to always override light-mode styles on macOS/browsers configured with system dark mode.

- **fix(ui)**: Replaced harsh dark-grey diagonal cells (`—`) with soft neutral backgrounds (`bg-slate-50/70`) and subtle text (`text-slate-400`) in light mode.
- **fix(ui)**: Enforced deep saturated foreground text across light-mode grid cells: `text-emerald-950` (Optimal), `text-amber-950` (Degraded), `text-sky-950` (One-Way), and `text-red-950` (Critical) with bold weight (`font-black`).
- **fix(ui)**: Refined status badges inside cells with solid pastel containers (`bg-emerald-100`, `bg-amber-100`, `bg-red-100`, `bg-sky-100`) and crisp dark typography.
- **fix(ui)**: Strengthened `Fwd:` and `Rev:` prefix labels to `text-slate-600` with high-contrast icons (`text-blue-700` and `text-purple-700`).

## [v2.0.118] - 2026-10-01 — Refactor: Neutral Dynamic Endpoint Selector in Magic Join

- **refactor(magic-join)**: Removed any hardcoded subnet assumptions from `MagicJoinModal.tsx`. The operator has full control to select or deselect any detected IP address with 1 click before generating the token.

## [v2.0.117] - 2026-10-01 — Feature: Interactive Leader Endpoint Selector & OOB Mgmt Isolation

- **feat(magic-join)**: Added interactive toggle pills in `MagicJoinModal.tsx` allowing operators to selectively include/exclude candidate IPs (e.g. exclude `192.168.122.x` OOB management and retain only `192.168.203.x` SD-WAN data plane).
- **feat(api)**: Updated `GET /api/fleet/join-token` in `server.ts` to accept selective `endpoints` parameter and return all `detected_endpoints`.
- **fix(ui)**: Disabled browser password autofill overlays on modal inputs (`autoComplete="off"`).

## [v2.0.116] - 2026-10-01 — Refactor: Wildcard Dockerfile Source Sync (`COPY *.ts`)

- **refactor(docker)**: Replaced static listing of 19 individual TypeScript service files with `COPY web-dashboard/*.ts ./` across both `stigix-all-in-one/Dockerfile` and `web-dashboard/Dockerfile`. Automatically includes all future root `.ts` modules without risk of manual omission.

## [v2.0.115] - 2026-10-01 — Fix: Dockerfile Source Sync for Magic Join Manager

- **fix(docker)**: Added `COPY web-dashboard/magic-join-manager.ts ./` to both `stigix-all-in-one/Dockerfile` and `web-dashboard/Dockerfile` to fix runtime `ERR_MODULE_NOT_FOUND` during container startup.

## [v2.0.114] - 2026-10-01 — Feature: Stigix « Magic Join » Universal Zero-Touch Onboarding

- **feat(magic-join)**: Implemented cryptographic single-use token architecture (`STX-...` HMAC-SHA256) with automatic endpoint detection, 1-hour TTL, and persistent token inventory in `magic-join-manager.ts`.
- **feat(api)**: Mounted `/api/fleet/join-token`, `/api/fleet/join-tokens`, and `/api/fleet/join-redeem` endpoints on the Leader backend in `server.ts`.
- **feat(ui)**: Added top-navbar `[ 🔗 Add Node ]` action button and `MagicJoinModal.tsx` on Leader nodes with 1-click copy onboarding command, TTL selector, token history table, and instant token revocation.
- **feat(cli)**: Added `stigix-cli join` command suite in `Scripts/stigix-cli.py` (`join token generate`, `join token list`, `join token revoke`, and client-side `join --token <STX-...>` cluster attachment).
- **feat(mcp)**: Added FastMCP AI Copilot tools `generate_magic_join_token`, `list_magic_join_tokens`, `revoke_magic_join_token`, and `join_cluster_via_token` in `mcp-server/src/server.py` and `orchestrator.py`.
- **feat(installer)**: Updated `install.sh` and `install-autodocker.sh` with seamless Magic Join token decoding, parallel LAN/WAN endpoint probing, and automatic redemption.
- **docs(prd)**: Updated PRD v2.4 in `PRD_MAGIC_JOIN_UNIVERSAL_ONBOARDING.md` covering single-use token lifecycle, inventory hygiene, actionable error taxonomy, CLI commands, and FastMCP integration.

## [v2.0.113] - 2026-10-01 — Fix: Peer Cache Grace Period & Reachability Matrix Stability

- **fix(registry)**: `performDiscovery()` in `registry-manager.ts` now gracefully merges newly discovered peers into `peerCache` instead of destructively replacing the map on transient poll gaps. Expired instances are evicted only after a 15-minute grace period.
- **fix(registry)**: Prevented peer instances with `staticLeaderUrl` from resetting to remote Cloudflare bootstrap (`resetToRemote()`) on transient heartbeat hiccups, eliminating the rapid connection flapping loop (`fetch failed`).
- **fix(matrix)**: Decoupled `fetchMatrix` from direct `data` state dependency using `dataRef` in `ReachabilityMatrix.tsx` to ensure stable 10s intervals and prevent transient 1-node fallback responses from wiping active multi-node grid views.
- **fix(matrix)**: `ReachabilityMatrix.tsx` now preserves and displays existing matrix data during temporary background fetch errors instead of replacing the entire UI with an intrusive error screen.
- **fix(matrix)**: Extended Spoke-to-Leader matrix proxy cache TTL in `server.ts` to 10 minutes to eliminate transient `1x1` grid collapses during leader reconnection periods.
- **fix(perf)**: Configured `NODE_OPTIONS="--max-old-space-size=384"` for `web-ui` in `supervisord.conf` to cap V8 heap growth and protect low-memory (1GB/2GB) VM instances from Linux OOM killer invocations.

## [v2.0.112] - 2026-09-30 — UX: Light Mode Full Pass, Skeleton Shimmer & SSE Tunnel Stream

### Fixed
- **Light Mode (index.css)**: Replaced quasi-white `#f8fafc` background with cool blue-gray `#eef2f7`; strengthened border token `#c5d2de` for better card separation.
- **Light Mode (Fleet.tsx)**: Bulk refactor of hardcoded `bg-neutral-800/900` → `bg-card-secondary`; `text-neutral-300/400` → `text-text-secondary/muted`; amber text colors now use `dark:` variants (`text-amber-600 dark:text-amber-400`) for proper contrast on light backgrounds.
- **Light Mode (ConnectivityPerformance.tsx)**: Flaky/down probe cards changed from `bg-red-500/5` (pink on white) to `bg-card-secondary` neutral base with colored border.
- **Light Mode (App.tsx)**: Remote View inset frame now uses `3px / 75% amber-600` in light mode vs `2px / 40%` in dark — clearly visible on the new light background.
- **Light Mode (Topology.tsx)**: Canvas wrapper and ReactFlow background use `dark:` prefix; dots overridden via CSS to `#b0c4d8` in light mode.

### Added
- **feat(tunnel)**: Real-time chunked SSE stream pump over Fleet WebSocket tunnels — enables streaming endpoints through NAT/CGNAT.
- **feat(ui)**: Unified `PageLoader` skeleton component across DEM, Security, Settings, VyOS, Voice, Failover, Fleet, CustomApps.
- **feat(ui)**: Replaced all full-page spinners with Skeleton Shimmer + Top Laser loading bar.

## [v2.0.111] - 2026-09-30 — Fleet: Bidirectional Provisioning Sync over Tunnels

### Added
- **feat(fleet)**: Bidirectional provisioning sync over fleet WebSocket tunnels; Settings test mode; topology guide updates.

## [v2.0.110] - 2026-09-29 — Fix: Leader Reverse Dial Persistent Connection Retention

### Fixed
- **fix(fleet)**: Leader reverse dial now retains persistent connections for cloud peers across reconnects.
- **docs**: Updated README, Remote View operator guide, and stigix.io FAQ with M5/M6 WebSocket Reverse Tunnel and Leader Reverse Dialing details.

## [v2.0.109] - 2026-09-29 — Fix: Peer Dedup, Spoke Dial Exclusion & Tunnel Keepalive

### Fixed
- **fix(fleet)**: Peer deduplication on reconnect; spoke nodes excluded from leader outbound dialing; dialed tunnel keepalive telemetry.

## [v2.0.108] - 2026-09-29 — Fleet: Leader Outbound Reverse Dialing (M6)

### Added
- **feat(fleet)**: Leader Outbound Reverse Dialing for Cloud/Manual Peers (Milestone 6) — leader initiates outbound WS tunnel to reach NAT-isolated cloud instances.
- **docs**: Updated Remote View Gateway roadmap with M4, M5, M6 milestones.

## [v2.0.107] - 2026-09-29 — Fleet: WebSocket Reverse Tunnel for NAT/CGNAT Traversal (M5)

### Added
- **feat(fleet)**: WebSocket reverse tunnel for NAT/CGNAT traversal — branch nodes connect outbound to the leader.
- **feat(ui)**: WS Tunnel indicator moved to Fleet table status column; dropdown cleaned up.
- **fix(docker)**: Include `fleet-tunnel.ts` in stigix-all-in-one Dockerfile.
- **ci**: Restrict multi-arch builds to `main` branch; `v2` builds AMD64 only.

## [v2.0.106] - 2026-09-29 — Perf: SD-WAN Matrix Instant Render & Spoke Caching

### Performance
- **perf(matrix)**: Instant 0ms render with spoke caching; silent background refresh on interval.

## [v2.0.105] - 2026-09-29 — Failover: Auto-Hide Unused Targets During Test

### Added
- **feat(failover)**: Targets not selected for a test are automatically hidden from the test view to reduce visual noise.

## [v2.0.104] - 2026-09-29 — UX: Precision Hub Wiring & DC1 Leader Badge Fix

### Fixed
- **Hub WAN Circuit & LAN Wiring Geometry (`Topology.tsx`)**:
  - Calibrated Hub WAN bottom wiring paths to land directly on the top edge of Circuit Blocks (`Y=350 -> Y=420`).
  - Aligned Hub LAN top distribution bus from router Port 3 up into the shared LAN subnets (`Y=95 -> Y=110`).
  - Enabled primary LAN subnet matching on multi-subnet Hubs so `DC1` displays the high-tech Blue `⚡ 192.168.201.0/24 [LEADER]` badge.

## [v2.0.103] - 2026-09-29 — UX: Hub WAN & LAN SVG Math Alignment

### Fixed
- **Hub WAN Circuit & LAN Wiring Coordinates (`Topology.tsx`)**:
  - Corrected SVG path geometry for Hub nodes where WAN ports at the bottom of the router card (`Y=338`) connect directly to Circuit Blocks (`Y=380`) below the Hub container.
  - Aligned Hub LAN top wiring from the shared LAN subnets (`Y=70`) to router Port 3 (`Y=98`).

## [v2.0.102] - 2026-09-29 — UX: Refined LAN Wiring Bus & Port Label Layout

### Fixed
- **LAN Interface Label & Pill Overlap (`Topology.tsx`)**:
  - Inverted bottom LAN port IP labels (`labelPosition="top"`) so they sit cleanly tucked inside the router block, eliminating overlap with the top border of LAN subnet pills.
  - Re-engineered dual-router Spoke and Hub internal SVG LAN wiring with an elevated horizontal bus bar (`strokeDasharray="4 4"`, `z-0`) and single central drop, preventing green dashed lines from slicing through the middle of the LAN subnet pills.
  - Increased router-to-LAN vertical margin to `mb-8` and elevated the subnet pill container to `z-20` for crisp visual hierarchy.

## [v2.0.101] - 2026-09-29 — UX: Direct Stigix Subnet Integration & Exact Site Matching

### Added
- **Integrated Stigix LAN Subnet Highlight (`Topology.tsx`)**:
  - Eliminated standalone Stigix badge box next to LAN subnets; now directly highlights the specific LAN subnet hosting the Stigix node in high-tech Blue/Cyan (`bg-blue-600/20 border-2 border-blue-400 text-blue-200`) with an active status beacon, `Zap` icon, and role chip (`[LEADER]` / `[PEER]`).
  - Standard LAN subnets not hosting a Stigix agent remain clean in traditional green pills.
  - Subnet matching powered by precise IPv4 CIDR bitwise calculation (`isIpInSubnet`).

### Fixed
- **DC2 False Leader Status Resolution (`Topology.tsx` & `server.ts`)**:
  - Replaced loose substring normalization with strict site token normalization (`isExactSiteMatch`) preventing `DC 2` from erroneously matching `DC1-Ubuntu`.
  - Enforced Leader status validation via matrix payload `is_leader` flags and explicit DC1 leader checks.

## [v2.0.100] - 2026-09-29 — UX: Dynamic Site Autoscale, Compact Stigix Badges & Clean Overlay Layout

### Fixed
- **Site Block Overlapping on Topology Canvas (`Topology.tsx`)**:
  - Replaced rigid width estimations in `getSiteWidth` with dynamic multi-factor autoscale calculating required dimensions across devices, WAN circuits, LAN subnets, and Stigix anchor badges.
  - Enforced strict bounding-box horizontal gap spacing (`HORIZONTAL_GAP_PX = 100`) preventing any overlap between Branch or Data Center blocks regardless of subnet count.

### Changed
- **Sleek & Compact Site Elements (`Topology.tsx`)**:
  - Redesigned LAN subnets into compact, modern pills (`h-[30px]`, `px-3 py-1`) with refined typography.
  - Streamlined the Stigix anchor badge into a sleek status pill (`⚡ Stigix: <IP> [ROLE]`) embedded directly in site LAN sections without layout expansion.
  - Removed cluttered cross-canvas Stigix mesh overlay lines, keeping the focus cleanly on SD-WAN overlay and VyOS underlay paths.

### Fixed
- **Probe Deletion & Mesh Provisioning Pending Loop (`server.ts` & `provisioning-manager.ts`)**:
  - Prevented Leader from resurrecting deleted local probes from old global bundles in `getFullEffectiveConnectivityProbes()`.
  - Unified `buildConnectivityProbesPayload()` across `GET /api/provisioning/config` and `POST /api/provisioning/publish`, eliminating the perpetual `⚠️ PENDING` provisioning loop.
  - Sanitized non-array types in `hasUnpublishedChanges` ensuring identical checksum calculation before and after publishing.
- **Prisma SD-WAN Interface Discovery Prioritization (`discovery-manager.ts`)**:
  - Implemented scoring heuristics prioritizing physical Ethernet LAN interfaces (`1/1`, `eth*`, `vlan*`, `lan`, gateway descriptions) and heavily penalizing loopback /32 interfaces so the primary SD-WAN gateway is selected.

### Changed
- **Reachability Matrix Status Precision (`ReachabilityMatrix.tsx` & `server.ts`)**:
  - Reclassified unidirectional active paths where return telemetry is pending/unconfigured as **`PARTIAL` / `One-Way`** (neutral sky-blue badge) instead of false `OPTIMAL` green, preserving `OPTIMAL` strictly for validated bidirectional symmetry.
  - Added `One-Way` status filter chip showing pairs with partial telemetry.
  - Clarified grid headers and detail modal with explicit labels: `Node: <IP>` (Stigix management container IP) vs. `SD-WAN Target: <IP>` (actual probed destination target).

## [v2-dev] - 2026-09-29 — Feature: Bidirectional Cross-Instance SD-WAN Reachability Matrix

### Added
- **Fleet Bidirectional Reachability Matrix (`ReachabilityMatrix.tsx` & `ConnectivityPerformance.tsx`)**:
  - Implemented full-mesh $N \times N$ cross-instance reachability matrix correlating forward egress path ($A \to B$) with return ingress telemetry ($B \to A$).
  - Added dedicated view mode switcher in Digital Experience (DEM) / Performance: `[ Probes Catalog | Full-Mesh Reachability Matrix ]`.
  - Color-coded cell matrix: Green (Symmetric & Healthy), Amber (Asymmetric latency delta $\ge 15\text{ms}$ or packet loss skew), Red (One-way blocked / Half-open outage).
  - Interactive cell inspection modal displaying side-by-side Forward vs. Return latency, jitter, loss, and DEM scores with automated root-cause explanations.
- **Backend Matrix Aggregator & Telemetry Extension (`server.ts` & `stigix-registry-client.ts`)**:
  - Extended `registryManager.setTelemetryProvider` with `peer_probes` array to bundle latest probe results into node heartbeats.
  - Implemented `GET /api/fleet/matrix` endpoint supporting filtering by probe type (`ALL`, `PRISMA SDWAN`, `PING`, `HTTP`, `TCP`), site filter, and `asymmetry_only=true`.
  - Auto-discovery of remote target sites from synthetic probes when running in standalone mode.
- **PRD Documentation (`PRD/PRD_BIDIRECTIONAL_SDWAN_MATRIX.md`)**:
  - Full architectural specifications, data model, and roadmap for bidirectional cross-instance SD-WAN reachability validation.

---

## [v2.0.82] - 2026-09-28 — UX: Clean target selection cards in Speedtest

### Changed
- **Bandwidth Test Target Cards (`Speedtest.tsx`)**:
  - Removed redundant checkbox icons on the left side of target cards (both Quick Targets and Shared Targets).
  - Eliminates multi-selection ambiguity (Speedtest is strictly 1-to-1 point-to-point) and provides clean visual alignment directly with the pulsing reachability status dot.

---

## [v2.0.81] - 2026-09-28 — Feature: Fleet Mesh context switcher direct connect

### Added
- **Fleet View Direct Context Switcher (`Fleet.tsx`)**:
  - Replaced the generic `Open UI` external link in the Mesh Overview table with an interactive **`[ ⚡ Connect ]`** context switcher button for each remote peer (BR1, BR2, BR5, BR8).
  - Clicking **`[ ⚡ Connect ]`** immediately sets `activePeerId` and navigates the operator to the active view in Remote View mode without opening a separate browser window or needing direct reachability to the branch IP.
  - For the Leader node (DC1-Ubuntu), displays `Local Leader` (or a `[ ⚡ Return Local ]` button if currently in a remote peer context).
  - Added a **`[ ⚡ Connect via Remote View ]`** button inside the Peer Details Drawer / Modal alongside the direct URL button.

---

## [v2.0.80] - 2026-09-28 — UX: Remote peer name in navbar + peer switcher cleanup

### Added
- **Remote Peer Name in Navigation Header** (`App.tsx`):
  - When in remote view mode, the top-left subtitle now shows the active remote peer's
    site name (or `instance_id` as fallback) in **amber** instead of the local
    `detected_site_name`. Returns to blue local name when switching back to the Leader.
  - Zero additional API calls — the label is read directly from the in-memory peer list
    via an extended `onActivePeerChange(peerId, peerLabel)` callback.

### Changed
- **Peer Switcher Dropdown** (`PeerContext.tsx`):
  - Removed the redundant `ACTIVE` text badge from both the Local Controller row and
    Remote Sites rows. Active state is already communicated by highlighted background
    (amber/blue) and bold typography — the badge was visual noise and was shifting IP
    addresses off-screen.
  - `setActivePeerId` useCallback now includes `peers` in its dependency array to
    prevent a stale closure when resolving the peer label on switch.

### Technical
- `onActivePeerChange` callback signature extended: `(peerId, peerLabel)` — backwards-
  compatible addition (second arg ignored by callers that don't need it).

---

## [v2.0.79] - 2026-09-28 — Hotfix: TypeScript build error in Security.tsx

### Fixed
- **TS2345 Build Failure**: `setSecurityProfile(null)` rejected by TypeScript compiler — the
  state type does not include `null`. Replaced with an explicit reset to the local catalogue
  defaults (`URL_CATEGORIES`, `DNS_TEST_DOMAINS`, `C2_SCENARIOS`, `AI_SECURITY_SCENARIOS`).
  Functionally equivalent: the Security page now shows the default catalogue between peer
  switches while the new peer's data is being fetched.

---

## [v2.0.78] - 2026-09-28 — Fix: Security & VyOS pages don't refresh on peer switch

### Fixed
- **VyOS Control Page (Vyos.tsx)**:
  - Main `useEffect` had an empty `[]` dependency array — the page was mount-only and never
    re-fetched when switching remote peers via the peer selector.
  - Added `activePeerId` to deps so `fetchData()` fires on every peer switch.
  - State (`routers`, `sequences`, `history`) is now cleared before re-fetching to avoid
    showing the previous peer's data during the network round-trip.
- **Security Page (Security.tsx)**:
  - Main `useEffect` already included `activePeerId` in deps, but stale state remained
    visible during the re-fetch interval.
  - Added explicit resets for `config`, `testResults`, `securityProfile`, `securityTargets`,
    `cloudEicarUrl`, and the `eicarInitialized` ref at the top of the effect so the UI
    clears immediately on peer switch before new data arrives.

---

## [v2.0.77] - 2026-09-28 — EICAR Client-Side Detection

### Added
- **EICAR Not-Blocked Indicator** (Custom TCP Apps — Outgoing Sessions card):
  - The `tcp-client-runtime` now inspects every HTTP response for the
    `X-Stigix-Security-Test: EICAR` header injected by the server in EICAR Response mode.
  - If the EICAR payload reaches the client (meaning the SASE/NGFW did **not** block it),
    `eicarReceivedCount` is incremented in `OutgoingSessionState`.
  - A **🛡️ EICAR not blocked × N** warning badge (red/rose) appears in the Outgoing
    Sessions card — visible only when a security gap is detected, completely hidden
    otherwise (zero noise in normal/blocked conditions).
- **`OutgoingSessionState`**: New `eicarReceivedCount: number` field added to `types.ts`.

---

## [v2-dev] - 2026-09-26 — Tech-Support Diagnostics Bundle, Reports & Telemetry Enrichment

### Added
- **Tech-Support Diagnostic Bundle Generator** 📦:
  - **1-Click Web UI Download**: Added « Download Tech-Support Bundle » in Settings → System Information.
  - **CLI Automation**: Added `tech-support [--output <path>]` command in `stigix-cli.py` with autocomplete.
  - **REST API Endpoint**: Protected route `GET /api/system/tech-support` generating structured `.tar.gz` archive.
  - **Zero-Leak Sanitization**: Recursive secret scrubber replacing tokens, passwords, private keys, client secrets, and JWTs with `***REDACTED***`.
  - **Comprehensive Diagnostics**:
    - `metadata.json`: Node version, git commit, platform hardware specs, and timestamp.
    - `config/`: All active `.json` configurations (sanitized).
    - `system/`: Live network and OS state (`ip addr`, `ip route`, `iptables`, `/proc/net/dev`, `df`, `free`, `ps aux`, `docker ps`, `supervisorctl status`).
    - `telemetry/`: Mesh status, fleet peers, 1h/24h connectivity SLA stats, probes catalog, and services health.
    - `logs/`: Tail of last 1,000 lines from all core engine and supervisor logs.
  - **Documentation**: Created [`docs/TECH_SUPPORT_DIAGNOSTICS.md`](file:///Users/jsuzanne/Github/stigix/docs/TECH_SUPPORT_DIAGNOSTICS.md) and updated [`docs/STIGIX_CLI.md`](file:///Users/jsuzanne/Github/stigix/docs/STIGIX_CLI.md).
- **Research Papers & Whitepapers Published**:
  - Published Application vs Network white paper and BR8/DC1 technical report to `site/reports/` and `stigix.io/reports.html`.

### Fixed
- **Fleet Telemetry Scope Bug**: Fixed a `ReferenceError: failingProbes is not defined` in `registryManager.setTelemetryProvider` where `failingProbes` was scoped inside the `try` block, preventing heartbeat telemetry summaries from being generated on upgraded nodes (`DC1`, `BR2`, `BR5`, `BR8`).
- **Fleet Traffic Direction Display**: Cleaned up double arrow display in Fleet peer table (`▲ TX · ▼ RX`).
- **Fleet Detail View Traffic Wrapping**: Prevented awkward multi-line break of `▶ Active (X Mbps)` in the peer detail modal by setting `whitespace-nowrap`, allocating proportional column widths, and expanding the modal to `max-w-3xl`.


## [v2-dev] - 2026-09-25 — Fleet Control Plane: Telemetry Enriched Heartbeat & Fleet Observability (Phase 3A)

### Added
- **Fleet Control Plane Observability (Phase 3A)** 🏢:
  - **Enriched Heartbeat Telemetry**: Extended peer heartbeats (30s) to include an aggregated `summary` object:
    - `probes_global_health`: Real-time Global Experience score (0–100) computed from synthetic probes.
    - `probes_total` & `probes_passing`: Count of active vs healthy DEM probes.
    - `traffic_state` & `traffic_rate_mbps`: Live SaaS traffic generation state and combined throughput.
    - `voice_active` & `voice_mos`: Active voice simulation status and average MOS quality.
    - `convergence_active` & `xfr_active`: Millisecond failover testing and high-bandwidth validation activity flags.
    - `uptime_seconds`: Node container uptime.
  - **Leader Fleet Aggregator API (`/api/fleet/overview`)**:
    - Clean separation between node connectivity status (strictly 🟢 `online` / 🔴 `offline`) and network performance (Global Experience score).
    - Leader pinned at the top with `👑 Leader (This Node)` badge and 30s local heartbeat interval.
    - Stale heartbeat detection (>90s) and fleet-wide average Global Experience score.
    - Protected route accessible exclusively when the current node is acting as Leader.
  - **Refined Fleet UI Dashboard (`Fleet.tsx`)**:
    - **Pure Node Status**: Clear distinction between node liveness (🟢 Online / 🔴 Offline) and DEM quality badges (Optimal ≥80, Good 65–79, Degraded 50–64, Critical <50).
    - **Dual Timestamps**: Displays both relative duration (e.g. `30s ago`) and exact time of last update (`22:50:02`).
    - **1-Click IP Copy & Management URL**: Fast clipboard copy for traffic IPs (`📋`) and support for dedicated management URLs (`STIGIX_MANAGEMENT_URL` / `STIGIX_MANAGEMENT_IP`).
    - **Provisioning Revision Fix**: Corrected number parsing to eliminate `rNaN` badges.
    - **Legacy Node Support**: Displays `— N/A` for online legacy peers without telemetry instead of confusing `— Stale`.
    - **Conditional Leader-Only Menu**: The "Fleet" navigation button is strictly rendered on the Leader instance; invisible on peers/spokes.
    - **Auto-Refresh**: 15-second background polling with pause toggle and instant manual refresh.

## [v2-dev] - 2026-09-23 — MCP Automated Test Harness (Phase 2)

### Added
- **mcp-server/tests/**: Full Phase 2 test harness — nominal, regression, and invalid_args suites driven by `tools_manifest.yaml`
- **tests/tools_manifest.yaml**: Ground-truth YAML describing all 81 MCP tools (args, expected_keys, timeout class, size budget, skip flags)
- **tests/mock_stigix_node.py**: FastAPI mock Stigix node (nominal + canary) with schema-compliant responses for all endpoints
- **tests/test_mcp_nominal.py**: Happy-path contract tests — 79 passed, 2 skipped (state-dependent tools)
- **tests/report_generator.py**: JSON scorecard + per-tool HTML report generated after each run
- **skip_nominal / skip_reason**: Manifest flags to gracefully skip state-dependent tools (visible as SKIPPED in pytest output)
- **docs/MCP_SERVER.md**: New 'Automated Test Harness' section documenting architecture, usage, and manifest field reference

### Fixed
- **server.py get_vyos_interfaces**: Iteration bug — loop was iterating over dict keys of the orchestrator's {'routers': [...]} wrapper instead of the router list, causing AttributeError

## [v2-dev] - 2026-09-20 — In-App AI Copilot (BYOK Anthropic Claude) & Claude Sonnet 4.5 Integration

### Added
- **In-App AI Copilot with BYOK Architecture (Bring Your Own Key)** 🤖:
  - **Dedicated AI Copilot Tab & Conversation Drawer**: Multi-session conversational interface with instant session creation, auto-titling, starter prompts, and persistent local storage (`config/ai-sessions.json`).
  - **Zero-Log & Local Secure Key Storage**: User API key stored securely in `config/ai-config.json` (mode `0600`) with in-UI masking (`sk-ant-api••••••••••••xxxx`).
  - **Direct Anthropic Messages API Streaming (SSE)**: Server-Sent Events endpoint (`POST /api/copilot/chat`) streaming incremental responses directly to the frontend.
  - **Full MCP Parity & Tool Execution Engine**: AI Agent capabilities executing local diagnostics and configuration changes in complete parity with the MCP Server: `list_endpoints`, `get_mesh_status`, `get_traffic_stats`, `get_security_posture`, `get_digital_experience`, `add_dem_probe`, `remove_dem_probe`, `add_fabric_target`, `remove_fabric_target`, `vyos_chaos`, `run_security_url_test`, `run_security_dns_test`, `run_security_threat_test`, and `get_recent_logs`.
  - **Frontier Model Support**: Integrated Anthropic active models catalog with **Claude Sonnet 4.5** (`claude-sonnet-4-5-20250929`), **Claude Haiku 4.5** (`claude-haiku-4-5-20251001`), **Claude Sonnet 4.6**, **Claude Sonnet 5**, and **Claude Opus 4.5**.
  - **Settings Integration & Conditional UI Masking**: Dedicated **AI & Copilot** tab in Settings with 1-click API key validation test against Anthropic `/v1/models` and default model selector. When no key is configured, Copilot tabs, drawer trigger, and floating buttons are cleanly hidden from the UI until a key is added.

---

### Fixed
- **Voice Echo Ingress Session Export (`engines/echo_server.py`)** 🛡️:
  - Eliminated duplicate `maintenance` background thread colliding with main thread periodic file rotation.
  - Switched temporary export file to PID-unique path (`/tmp/ingress-voice-sessions.json.<pid>.tmp`) to prevent `[Errno 2] No such file or directory` race conditions during high-concurrency multi-branch voice session bursts.

---

## [v2-dev] - 2026-09-13 — Live API Log Inspector & Interactive API Studio

### Added
- **Live API Log Inspector & Interactive API Studio** 🚀:
  - **Real-Time API Observability**: In-memory ring buffer (500 events) and Server-Sent Events (`GET /api/logs/stream`) capturing Node.js, Python SDK (`getflow.py`, `prisma_custom_apps.py`), and VyOS calls.
  - **Interactive API Playground**: Visual request composer with preset catalog for Prisma SD-WAN, SCM/SLS, VyOS, and Stigix.
  - **Auto-Authentication Proxy**: Server-side proxy (`POST /api/playground/execute`) with automatic Prisma SASE OAuth token and VyOS API key injection.
  - **1-Click Replay & Code Generator**: Instant cloning from log inspector and code export to cURL, Python (`prisma_sase`/`requests`), and Node.js (`fetch`).

---

## [v2-dev] - 2026-09-09 — Real-Time Application Telemetry (RUM/APM), 1-Click DEM Promotion & Cloud Probes Provisioning

### Added
- **Real-Time Application Telemetry & RUM** ⚡:
  - **Native curl Timing Extraction**: Captured client timing metrics on every live background request (`time_namelookup`, `time_connect`, `time_appconnect`, `time_starttransfer`, and `time_total`) with zero network overhead and zero remote server impact.
  - **Rolling EMA Telemetry**: Computed Exponential Moving Average (EMA) in `traffic-generator.sh` per application: `rtt_ms`, `ttfb_ms`, `dns_ms`, `tcp_ms`, and `tls_ms` persisted in `stats-${CLIENTID}.json`.
  - **Enriched Applications Table**: Added **Avg Latency (RTT)** with status pills (🟢 `<50ms`, 🟡 `<150ms`, 🔴 `≥150ms`) and **TTFB (Server Time)** columns.
  - **Interactive Hover Breakdown**: Glassmorphism tooltip breaking down `DNS`, `TCP`, `TLS`, and `TTFB` layer timings with HTTP status code.
- **1-Click DEM Promotion (`+ DEM`)** 🎯:
  - Added 1-click action button on application rows to instantly promote any business app into continuous 1-minute synthetic monitoring probes with SLA tracking (`POST /api/probes/promote-app`).
- **Global Provisioning `cloud-config` Bundle (9th Bundle)** 🌐:
  - Integrated `cloud-config` (`cloud-config.json`) into Central Global Provisioning with revisioning, checksums, and audit logs.
  - Automatic broadcast to all connected branch peers on saving credentials in Settings, with instant Zero-Touch hot reload via `targetManager.reload()`.
- **Dedicated Synthetic Probes Settings Tab** ☁️:
  - Extracted Cloudflare Worker credentials, Master Key, and POP diagnostic tests out of Target Controller into a clean, dedicated **Synthetic Probes** tab.

---

## [v2-dev] - 2026-09-08 — Appliance Target Simplification, Unified Targets Dashboard & Live Sessions Alignment

### Added
- **Global Appliance-Level Custom App Controls** 🎛️:
  - **Start All / Stop All**: One-click global actions to start or stop all configured TCP application listeners and outbound client workloads simultaneously on the local Stigix appliance.
  - **REST Endpoints**: Added `/api/custom-tcp-apps/actions/start-all` and `/api/custom-tcp-apps/actions/stop-all` for programmatic fleet automation.
- **Dedicated EICAR Anti-Virus / Security Target Endpoint (Port 8082)** 🛡️:
  - Streamlined `engines/http_server.py` to a lightweight, dedicated EICAR security endpoint (`http://<ip>:8082/eicar.com.txt`) specifically designed for NGFW, SASE, and AV/IPS automated test suites.
  - Cleaned up legacy HTTP delay simulation modes (`NORMAL`, `ALWAYS_SLOW`, `RANDOM_SLOW`, `LOOPING_SLOW`) since latency, jitter, and brownouts are now natively modeled with greater precision in Custom TCP Apps.
  - Added 1-click EICAR URL clipboard copying and direct browser test links in the Settings interface.
- **SCM Traffic Log Viewer & Palo Alto SASE Security Analysis** 🔒:
  - Integrated full SSL Decryption rule evaluation, dynamically resolving HTTPS threat bypasses (`Allowed (No SSL Decryption)`).
  - Enhanced DNS security evaluation across Allowed, Sinkholed, and Blocked dispositions with dynamic rule correlation.
  - URL Access Profile single-active evaluation preventing false blocks on allowed categories.
  - CLI search shortcuts (`--dst`, `--threat-id`) and instant modal rendering with zero latency.

### Changed & Improved
- **Targets Dashboard Simplification & Visual Density** 🎯:
  - **Single Unified Origin Badge**: Cleaned up conflicting and redundant badges (`REMOTE PEER`, `STATIC`, `LEARNED`). Every target now displays exactly one authoritative origin tag: `🟢 LOCAL NODE`, `⚡ Learned · <time>`, or `📌 Static`.
  - **Compact Service Indicator (Mini-Dots + Tooltips)**: Replaced bulky 6-box text pills with 6 color-coded status indicator dots and an `All Services (6)` / `X/6 Services` badge, reducing card height by 50%.
  - **Inlined IP & Telemetry**: Host IP, reachability status (`🟢`/`🔴`), and RTT telemetry (`1.2ms • v2.0`) are consolidated onto a single compact line.
- **Custom TCP Apps Live Telemetry Alignment** 📐:
  - **Strict Table Layout (`table-fixed`)**: Column widths locked to 30% / 24% / 46% across `Incoming Sessions` and `Outgoing Sessions` tables, eliminating layout shifting when reconnect badges appear.
  - **Sparkline Header Synchronization**: RTT Trend header positioned directly above the micro-sparkline, with tabular latency numbers (`avg / p50 / p95`) and jitter metrics aligned to the right.
  - Streamlined live status badges and removed extraneous UUID clutter from header bars.

---

## [v2-dev] - 2026-09-03 — Prisma SD-WAN Custom Appdefs Flow Browser Integration

### Added
- **Prisma SD-WAN Custom Application Integration (Flow Browser Ready)** ☁️:
  - **Automated AppDef Provisioning**: 1-click registration of Stigix custom TCP applications directly into Prisma SD-WAN tenants as `STX_<AppName>` with exact L3/L4 port ranges (`server_port: {start, end}`).
  - **Flow Browser & Policy Visibility**: Ensures all synthetic inter-site TCP flows between Stigix branch and datacenter instances are immediately recognized, named, and classified in Flow Browser, Bandwidth Analytics, and QoS/Path Steering policies.
  - **Delta Synchronization**: Single-pass synchronization detects existing definitions on the tenant, applies deltas preserving `_etag`, and skips unchanged configurations without redundant API calls.
  - **Clean All & Teardown**: Safe bulk teardown of all `STX_`-prefixed and `stigix`-tagged custom applications.
  - **Dashboard Modal (`PrismaAppSyncModal.tsx`)**: Dedicated interactive sync center with live tenant connection check, per-application status pills (`SYNCED` vs `NOT SYNCED`), inline single-app action buttons, batch actions, and error boundary isolation.
  - **Python Engine (`engines/prisma_custom_apps.py`)**: Official `prisma_sase` SDK engine with CLI support (`--list`, `--create`, `--delete`, `--sync-all`, `--clean-all`).
  - **REST API Endpoints**: 5 new endpoints under `/api/custom-tcp-apps/prisma/*`.

### Fixed
- **React Error Boundary & Safe Property Access**: Prevented React unmounting crashes by guarding against uninitialized/null application fields from tenant responses.
- **Controller Schema Conformance**: Strictly aligned request payloads with Palo Alto Networks Prisma SD-WAN v2.6 OpenAPI schema requirements.

---

## [v2-dev] - 2026-09-02 — Custom TCP Inter-Site Applications & Underlay Topology
 
### Added
- **Stigix Custom TCP Inter-Site Applications** 🔄:
  - **Dual Server / Client Architecture**: Multi-application engine supporting simultaneous host TCP listeners and outbound client workload generation.
  - **4-Byte Length-Prefixed Stream Protocol**: Robust `UInt32BE` framing with 5s handshake timeout and optional pre-shared token validation.
  - **Rich Simulation Behaviors**: 8 server modes (`echo`, `acknowledge`, `fixed_delay`, `random_delay`, `looping_delay`, `drop_response`, `close_connection`, `error_response`) and 5 client workload modes.
  - **Dedicated UI View & Wizard**: Top-level "Custom Apps" dashboard view, live metrics, incoming/outgoing session inspectors, and a 4-step wizard with non-destructive host port testing.
  - **Central Global Provisioning (8th Bundle `custom-tcp-apps`)**: Seamless distribution of applications from the Leader to branch peers with hot reload of TCP listeners and workload generator.
  - **Settings & CLI**: Settings profile manager tab, Global Provisioning Master Publisher card, and full `stigix-cli` suite (`tcp-app` / `custom-app` / `app`, `provision publish custom-tcp-apps`).
  - **Technical Documentation**: Comprehensive guide in [`docs/CUSTOM_TCP_APPS.md`](file:///Users/jsuzanne/Github/stigix/docs/CUSTOM_TCP_APPS.md).

- **Underlay Topology & Multi-Router Physical Chassis** 🖧:
  - **`VyOSRouterNode` Canvas Component**: Renders active VyOS backbone routers on the topology canvas with top-row DC/Hub uplinks, bottom-row Branch/Spoke downlinks, and center management banner (hostname, management IP, live online status, and circuit count).
  - **Direct 1:1 Port Cable Wiring** 🔌: React Flow handles on individual port chips (`vyos-port:ethX`) connect directly to Prisma SD-WAN WAN circuit blocks with animated amber edges.
  - **Anti-Cable-Crossing Spatial Alignment** 📐: Automatic left-to-right sorting of router ports matching the horizontal X coordinates of connected sites (DC1, DC2, BR1, BR2, BR3) and link types (INET before MPLS), ensuring clean, untangled parallel cables.
  - **Full IP/CIDR Visibility** 🏷️: Every VyOS port chip displays its complete IPv4 CIDR alongside the port identifier (`ethX`), status LED, connected site badge, and description.
  - **Interactive Floating Link Trace Inspector** 🔍: Clicking any port chip or underlay cable triggers a floating comparison drawer showing Prisma ION circuit parameters, transit CIDR subnet, and VyOS next-hop IP with a one-click button to open the full diagnostics side panel.
  - **Light & Dark Theme Harmonization** 🌓: Seamless contrast across all underlay widgets, port chips, and inspector drawers adapting cleanly to both light and dark modes.
  - **External Cloud Spacing** ☁️: Dynamic router width calculation ensures `cloud:EXTERNAL` is positioned safely without overlapping chassis elements.
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
  - [`docs/UNDERLAY_TOPOLOGY.md`](file:///Users/jsuzanne/Github/stigix/docs/UNDERLAY_TOPOLOGY.md): Comprehensive guide to VyOS chassis architecture, direct port wiring, and link trace inspection.
  - [`docs/STIGIX_CLI.md`](file:///Users/jsuzanne/Github/stigix/docs/STIGIX_CLI.md): Added reference sections for `controller` and `provision` commands.
  - [`README.md`](file:///Users/jsuzanne/Github/stigix/README.md): Added Underlay Topology highlights to Features and What's New.

---

## [v2-dev] - 2026-08-31 — Direct Controller Peer Installation MVP

### Added
- **Direct Controller Mode** 🔗: New `STIGIX_CONTROLLER_URL` environment variable that, when set, activates a `direct` registry mode that bypasses all Cloudflare discovery logic and registers the peer directly with an explicit leader.
  - Registry mode reported as `direct` in `/api/registry/status`.
  - New `controller_url` and `direct_mode` fields in registry status (backward-compatible).
  - All heartbeat and peer discovery traffic goes to the explicit controller — Cloudflare is never contacted.
- **`--controller` flag in `install.sh`** 📦: The installation script now accepts `--controller <URL>` to register a peer during first installation.
  - Validates the URL (must start with `http://` or `https://`).
  - Automatically writes `STIGIX_CONTROLLER_URL` and `STIGIX_REGISTRY_ENABLED=true` to `.env`.
  - Sets `STIGIX_SITE_NAME` from local hostname if not already configured.
  - Idempotent: does not overwrite an existing site name.
  - Works fully non-interactively (compatible with `curl | bash`, cloud-init, Ansible).
  - Example: `curl -fsSL https://raw.githubusercontent.com/jsuzanne/stigix/main/install.sh | sudo bash -s -- --controller https://stigix-central.example.net`
- **Peer self-filtering & Leader dynamic targets synthesis** 🎯:
  - Added `localRegistryServer` reference to `RegistryManager` on Leader nodes so `getPeers()` directly reads active registered instances (`BR1`, `BR2`, `BR5`, etc.) in real time.
  - Dynamically learned peers now immediately synthesize into active target definitions on the Leader's "Stigix Targets Repository" UI.
  - Self-filtering by local IP in `getPeers()` prevents ghost targets or self-targeting after site renames.

### Fixed
- **Peer Self-Filtering & Instant Ghost Target Purge on Rename** 🛡️:
  - `LocalRegistryServer`: Automatically purges old instance registrations sharing the same IP when a node registers under a new `instance_id` (e.g. after a site rename), eliminating ghost entries instantly on the Leader instead of waiting 10 minutes. Also supports wildcard `local-leader` / `direct:` instance listing so all local peers are served.
  - `RegistryManager`: Replaces `peerCache` on each discovery refresh cycle, adds fallback `pocId = 'local-leader'` on Leaders so Leaders also discover registered peers and synthesize target cards for them, and filters out self by both `instance_id` and `ip_private === this.currentIp`.
  - `Direct Mode Resilience`: Direct mode peers now preserve their `STIGIX_CONTROLLER_URL` and do not revert to Cloudflare if a heartbeat fails while the Leader is restarting. Peers re-register automatically within 60 seconds of the Leader coming back online.

### Changed
- **`docker-compose.yml` + `docker-compose.bridge.yml`** ⚙️: Added `STIGIX_CONTROLLER_URL` passthrough to the container environment.
- **`.env.example`** 📄: Documented `STIGIX_CONTROLLER_URL` with explanation and example.
- **`install.sh` REPO_URL** 🔀: Script now points to the `v2` branch by default for consistency with this development branch.

---

## [v2-dev] - 2026-08-31

### Added
- **System Uptime UI** ⏱️: Added a new **System Uptime** card in the System Info settings tab.
  - Displays **Instance Uptime** (process running time) and **Host Uptime** (physical machine running time) side-by-side.
- **Dynamic Container Versioning** 🐳: Docker builds now dynamically write the build version/tag (e.g. `v2-332ac37`) to the internal `/app/VERSION` file using `ARG VERSION`. This allows the exact build tag to show up in both the Web UI and CLI.
- **Dedicated Changelog** 📝: Added `CHANGELOG_V2.md` to track V2 development progress and prevent merge conflicts with V1 `main`.

### Changed
- **CI Docker Pipeline** ⚡: Modified `.github/workflows/build-stigix-allinone.yml` to trigger on push to any branch matching `v*` (such as `v2`).
- **Flexible Branch Tagging** 🏷️: Non-main branch builds now build and publish tags in the format `<branch>` and `<branch>-<short-sha>`.
- **System Info Layout** 📊: Expanded the Network I/O card to full-width (`md:col-span-2`) for better grid layout balance.
