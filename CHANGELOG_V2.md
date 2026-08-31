# Changelog - Stigix V2 Development Branch

All notable changes made specifically on the `v2` branch are documented in this file.

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
