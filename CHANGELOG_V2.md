# Changelog - Stigix V2 Development Branch

All notable changes made specifically on the `v2` branch are documented in this file.

---

## [v2-dev] - 2026-09-02 — Custom TCP Inter-Site Applications & Underlay Topology
 
### Added
- **Stigix Custom TCP Inter-Site Applications** 🔄:
  - **Dual Server / Client Architecture**: Multi-application engine supporting simultaneous host TCP listeners and outbound client workload generation.
  - **4-Byte Length-Prefixed Stream Protocol**: Robust `UInt32BE` framing with 5s handshake timeout and optional pre-shared token validation.
  - **Rich Simulation Behaviors**: 8 server modes (`echo`, `acknowledge`, `fixed_delay`, `random_delay`, `looping_delay`, `drop_response`, `close_connection`, `error_response`) and 5 client workload modes.
  - **Dedicated UI View & Wizard**: Top-level "Custom Apps" dashboard view, live metrics, incoming/outgoing session inspectors, and a 4-step wizard with non-destructive host port testing.
  - **Settings & CLI**: Settings profile manager tab and full `stigix-cli` suite (`tcp-app` / `custom-app` / `app`).
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
  - Example: `curl -fsSL https://raw.githubusercontent.com/jsuzanne/stigix/v2/install.sh | sudo bash -s -- --controller https://stigix-central.example.net`
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
