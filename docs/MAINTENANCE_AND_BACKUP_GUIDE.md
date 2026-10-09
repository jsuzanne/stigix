# 🛠️ Comprehensive Guide: Stigix Maintenance, System Updates & Configuration Backup

This guide provides an exhaustive operational reference for all capabilities found in **Settings ➔ Maintenance & Updates** (as well as the quick upgrade banner in **System Info**).

---

## Table of Contents
1. [Overview & Navigation](#1-overview--navigation)
2. [Section 1: System Updates Engine](#2-section-1-system-updates-engine)
   - [« Update To v... » Button](#-update-to-v--button)
   - [« Force Pull » Button](#-force-pull--button)
   - [Real-time « Upgrade Monitor »](#real-time--upgrade-monitor-)
   - [Channel-Aware Upgrades (v2 vs Stable Separation)](#channel-aware-upgrades-v2-vs-stable-separation)
3. [Section 2: System Restarts (Service Restart vs System Redeploy)](#3-section-2-system-restarts-service-restart-vs-system-redeploy)
   - [Option A: Service Restart (Soft Reload)](#option-a-service-restart-soft-reload)
   - [Option B: System Redeploy (Hard Recreate)](#option-b-system-redeploy-hard-recreate)
4. [Section 3: Configuration Backup & Restore](#4-section-3-configuration-backup--restore)
   - [Export Engine State (What is Included vs Excluded)](#export-engine-state-what-is-included-vs-excluded)
   - [Restore State & Pre-Import Safety Snapshot](#restore-state--pre-import-safety-snapshot)
5. [Summary Matrix: Operational Impact & Downtime](#5-summary-matrix-operational-impact--downtime)

---

## 1. Overview & Navigation

The Maintenance & Updates controls can be accessed via:
- **Direct Navigation**: Left sidebar ➔ **Settings (⚙️)** ➔ **Maintenance & Updates (🔄)** tab.
- **Quick Action Banner**: **Settings (⚙️)** ➔ **System Info** tab ➔ Top banner *"Stigix Engine Version"*.

---

## 2. Section 1: System Updates Engine

The upgrade engine automates Docker Hub container pulling, host container recreation, health validation, and UI reconnect with zero manual CLI intervention.

```
[1. USER CLICK] ──> [2. RESILIENT PULL (3x retries)] ──> [3. DETACHED EPHEMERAL UPDATER] ──> [4. AUTO RECONNECT]
```

### « Update To v... » Button
- **Purpose**: Triggers an automated update when a newer container build is detected on Docker Hub for your specific channel.
- **Technical Workflow**:
  1. Spawns a background task running `docker pull` for the designated channel image.
  2. Executes up to **3 automated retry attempts** with 5-second backoffs in case of transient network drops or Docker Hub rate limits.
  3. **Guaranteed Zero-Downtime on Failure**: As long as the pull has not finished with exit code `0`, the current running Stigix container **remains 100% active and is never touched**. If the pull fails after all retries, the operation safely aborts without service disruption.
  4. Once the image is fully validated locally, Stigix generates a dedicated updater script in `/config` and spawns an out-of-process ephemeral helper container (`stigix-updater-<timestamp>`) using `--entrypoint /bin/sh`.
  5. The helper container safely executes `docker compose up -d --force-recreate` on the host, polls `http://localhost:8080/api/health` for up to 60 seconds, writes completion status to `/config/.upgrade_status.json`, and self-terminates (`--rm`).
- **Operational Impact**: Brief **3 to 6 second** service handover while Docker switches containers.
- **Persistence**: 100% of configurations, history, and mounted volume data are preserved.

### « Force Pull » Button
- **Purpose**: Forces an immediate re-pull of the active channel image and recreates the container, **even if the display version appears identical**.
- **Common Use Cases**:
  - A new commit was pushed to branch `v2`, and the Docker Hub CI multi-arch build just completed.
  - Development verification where code updates are pushed under floating tags without incrementing semantic version numbers.
- **Operational Impact**: Identical to the standard Update flow.

### Real-time « Upgrade Monitor »
When an upgrade starts, an interactive dark terminal expands directly below the buttons:
- **PULLING Phase**: Streams Docker layer downloads, extractions, and retry attempts in real time.
- **RESTARTING Phase**: Displays an animated status banner. The web dashboard switches to discrete polling (every 2s) without triggering false network error alerts.
- **COMPLETE Phase**: Automatically detects the new container once healthy, displays a green success confirmation toast, and updates the version badge.

### Channel-Aware Upgrades (v2 vs Stable Separation)
Stigix dynamically inspects the local runtime container:
- **v2 Channel Instances** (e.g. `v2.1.0.dev...` or image tag `jsuzanne/stigix:v2`):
  - Tracks Docker Hub tag `v2`.
  - Compares container creation timestamp against the latest Docker Hub push timestamp (`last_updated`).
  - Pulls and updates exclusively to `jsuzanne/stigix:v2`.
- **Stable Channel Instances** (e.g. image tag `jsuzanne/stigix:stable`):
  - Tracks official stable release tags.
  - **Never prompts for or pulls unstable `v2` development builds**.
  - Ensures production environments remain locked to stable releases.

---

## 3. Section 2: System Restarts (Service Restart vs System Redeploy)

Two distinct restart mechanisms are available depending on the level of reload required:

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ Option A: Service Restart (Soft)     │ Option B: System Redeploy (Hard)                 │
├──────────────────────────────────────┼──────────────────────────────────────────────────┤
│ Restarts internal engines & Node.js  │ Destroys and recreates the Docker container      │
│ Downtime: 1 to 2 seconds             │ Downtime: 5 to 10 seconds                        │
│ Main Docker container stays running  │ Docker container receives full recreation        │
│ Does NOT reload docker-compose.yml   │ Reloads docker-compose.yml and host .env changes │
└──────────────────────────────────────┴──────────────────────────────────────────────────┘
```

### Option A: Service Restart (Soft Reload)
- **Underlying Command**: `supervisorctl restart all` executed **inside** the container.
- **Components Restarted**:
  - Express.js API backend (`web-dashboard`).
  - SD-WAN traffic generator engine (`traffic-generator.sh`).
  - Voice / RTP engine, IoT simulation, Custom TCP apps, and XFR speedtest target.
- **When to Use**:
  - After manual modifications to JSON configuration files.
  - To reclaim memory / cleanup idle Python child processes.
  - To reset simulation test counters without restarting Docker.
- **Operational Impact**: Very low. Active network sockets experience a 1–2 second pause before resuming.

### Option B: System Redeploy (Hard Recreate)
- **Underlying Command**: `docker compose -f docker-compose.yml up -d --force-recreate` delegated via detached ephemeral container.
- **Components Restarted**: The entire Docker container from scratch.
- **When to Use**:
  - After modifying host environment variables in `.env` (e.g. `PRISMA_SDWAN_CLIENT_SECRET`, `PORT`, `JWT_SECRET`).
  - After modifying `docker-compose.yml` (new volume mounts, port bindings, Linux capabilities).
  - Resolving low-level Docker daemon socket or network bridge inconsistencies.
- **Operational Impact**: Complete container downtime of **5 to 10 seconds** during Docker recreation.

---

## 4. Section 3: Configuration Backup & Restore

This section enables exporting the entire logical state of Stigix into a portable JSON bundle, or restoring a prior configuration.

### Export Engine State (« Download Bundle »)

Clicking **Download Bundle** downloads a timestamped file named `stigix-backup-YYYY-MM-DD.json`.

#### ✅ What IS Included in the Backup Bundle:
All logical configuration files located within `/app/config/` (host `./config` volume):
1. **Traffic & Routing Rules**: `applications-config.json`, `connectivity-custom.json`.
2. **Voice & Telephony Simulation**: `voice-config.json` (SIP servers, codecs, jitter, call profiles).
3. **IoT Fleet Emulation**: `iot-devices.json` (sensors, smart meters, cameras, telemetry intervals).
4. **Custom TCP & DEM Apps**: `custom-tcp-applications.json` (listening ports, workload profiles).
5. **VyOS Router Integration**: `vyos-config.json` (router hosts, API keys, monitored interfaces).
6. **SD-WAN Convergence / Failover**: `convergence-config.json`, `convergence-endpoints.json`.
7. **Security Profiles & Vulnerabilities**: `security-profile.json`, `security-config.json`.
8. **Node Identity & Cluster Config**: `identity.json`, `site-detection.json`, `static-leader.json`.
9. **Local User Accounts**: `users.json` (usernames and salted bcrypt password hashes).
10. **Prisma SASE Cloud Credentials**: `prisma-config.json`.
11. **XFR Speedtest History**: `xfr-history.json`.

#### ❌ What is NOT Included in the Bundle (and Why):
| Excluded Item | Technical Rationale | Where is it Stored on Host? |
| :--- | :--- | :--- |
| **PCAP Binary Files** (`pcap-uploads/`, `pcap-profiles/`) | High-capacity traffic recordings (often several GBs). Excluded to keep backup bundles lightweight (< 500 KB). | Host directory `./config/pcap-uploads/`. |
| **Local TLS Certificates** (`certs/`) | Private cryptographic host keys specific to each deployment node. | Host directory `./config/certs/`. |
| **Environment Variables (`.env`)** | System configuration injected by host Docker, not located in `config/`. | Host file `.env`. |
| **Operational Log Files** | Ephemeral debugging logs (`/var/log/sdwan-traffic-gen/`). | Host directory `./logs/`. |
| **AI Copilot Vector DB (`mcp-data/`)** | Local embeddings and LLM context cache. | Host directory `./mcp-data/`. |
| **Ephemeral Working Files** | Temporary files such as `.backup.*`, `.fixed`, and `test-counter.json`. | Transient memory / automatically pruned. |

---

### Restore State & Pre-Import Safety Snapshot

Clicking **Restore Bundle** allows uploading an exported JSON bundle to restore the system state.

#### 🛡️ Automatic Pre-Import Safety Snapshot:
Before overwriting any existing configuration files, Stigix automatically:
1. Creates a timestamped local snapshot directory in `/config`:  
   `./config/.pre-import-backup-<timestamp>/`
2. Backs up a complete byte-for-byte copy of all existing configuration files.
3. If an invalid or incompatible bundle is uploaded, previous configurations can be restored directly from this local backup directory.

#### 🔒 Strict Anti-Path-Traversal Security:
The import handler verifies that every entry in the JSON bundle:
- Strictly ends with `.json` or `.txt`.
- Contains **no path traversal characters** (`/` or `\`) to prevent writing outside the configuration directory.

#### 🔄 Automatic Re-initialization:
Once imported files are written to disk, Stigix gracefully exits its Node process to trigger a clean component reload. The browser interface automatically refreshes after 2 seconds.

---

## 5. Summary Matrix: Operational Impact & Downtime

| Action | Execution Mechanism | Expected Downtime | Traffic Impact | Risk Level |
| :--- | :--- | :--- | :--- | :--- |
| **Update To Latest** | Background `docker pull` ➔ Ephemeral Compose recreate | 3 to 6 seconds | Brief socket pause during handover | **Very Low** (Aborts if pull fails) |
| **Force Pull** | Forced `docker pull` ➔ Ephemeral Compose recreate | 3 to 6 seconds | Brief socket pause during handover | **Very Low** (Preserves active channel) |
| **Service Restart** | Internal `supervisorctl restart all` | 1 to 2 seconds | Micro-pause on traffic generators | **None** (Docker stays up) |
| **System Redeploy** | Out-of-process Compose `--force-recreate` | 5 to 10 seconds | Complete container restart | **Low** (Reloads `.env` and Compose) |
| **Export Bundle** | In-memory JSON aggregation | **0 seconds** (Online) | None | **None** (Read-only) |
| **Restore Bundle** | Config overwrite + server reload | ~2 seconds | Configuration reload | **Medium** (Overwrites state with pre-import backup) |
