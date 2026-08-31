# Changelog - Stigix V2 Development Branch

All notable changes made specifically on the `v2` branch are documented in this file.

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
- **"Add a remote Stigix instance" card in Settings → Target Controller** 🖥️: New UI card visible to leader instances.
  - Editable "Leader URL" field pre-filled with the current browser origin.
  - Live-updating one-line install command.
  - Copy button with visual feedback.
  - Peer count badge ("N peers online").

### Fixed
- **Peer Self-Filtering by IP** 🛡️: `RegistryManager.getPeers()` now filters out self using both `instance_id` and local IP address (`ip_private === this.currentIp`), preventing old ghost names from appearing in learned targets on a node after renaming its site.

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
