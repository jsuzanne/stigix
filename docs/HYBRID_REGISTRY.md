# Stigix Hybrid Registry: Architecture & Logic

The Stigix Hybrid Registry is a discovery system designed to allow Stigix instances to find each other and establish peer-to-peer connections with minimal configuration and zero cost (using Cloudflare Free Tier).

## Core Concepts

### 1. Hybrid Backend Layering
The system operates on two distinct layers:
- **Remote Bootstrap (Cloudflare Snapshot)**: Used for initial discovery and as a permanent failover "signal". At startup, the client takes a snapshot of your `STIGIX_REGISTRY_URL`. This snapshot is used for leadership elections and finding new leaders, ensuring the node is never isolated even if heartbeats are currently pointed at a stale local IP.
- **Local Leader (Self-Hosted)**: One node (typically a Hub) hosts a local registry service on port `8080`. Peers switch to this local service for high-frequency updates, bypassing Cloudflare quotas and enabling sub-minute failover detection.

### 2. Auto-Election & Bootstrap Signal
When `STIGIX_REGISTRY_MODE` is set to `auto` (default):
- **Candidate Detection**: Instances auto-detect if they are a **HUB** or a **Branch Gateway**. If so, they promote themselves to **LEADER**.
- **The Bootstrap Announcement**: The Leader calls `announceLeader` directly to the Cloudflare Snapshot URL. This updates the global record so anyone in the PoC can find the site's entry point.
- **Peer Behavior**: Other instances query Cloudflare once to find the Leader's IP, then "bind" to it.

### 3. Failover & Convergence (Transition)
The system is self-healing for leader transitions:
1.  **Detection (Max 60s)**: Peers heartbeat to the local leader every 60 seconds. If a heartbeat fails, the Peer resets its configuration and reverts to the **Remote Bootstrap** (Cloudflare).
2.  **Rediscovery (Max 30s)**: While on Cloudflare, the Peer polls `findLeader` every 30 seconds.
3.  **Convergence**: Total convergence for the site is typically **30s to 90s**.

### 4. Automatic Cleanup (TTL & Leases)
The Cloudflare Registry Worker manages data lifecycle automatically to prevent "ghost" nodes:
- **Peers TTL (5 min)**: Each node has a 300s TTL. If a node is powered off or disconnected, it is automatically pruned from the registry after 5 minutes.
- **Leader Lease (15 min)**: The leadership record has a longer 900s TTL. This prevents "Electoral Chaos" during brief network jitters while ensuring that if a leader truly disappears, the site can eventually elect a new one if configured in `auto` mode.

### 5. Adaptive Polling
- **Local Mode (On-Prem)**: Heartbeats every **60 seconds** (fast detection, zero Cloudflare cost).
- **Cloudflare Fallback**: Heartbeats every **300 seconds** (saves Cloudflare KV write quotas).
- **Discovery**: Always every **30 seconds** (Cloudflare reads are cheap/free).

## 🚀 Step-by-Step Implementation Guide

Follow this order to set up your site for optimal target propagation:

### 1. Establish the "Anchor" (The Leader)
Choose one instance that is accessible to all other nodes in the site (typically a central Hub or Gateway).
- **Configuration**: In its `.env`, set `STIGIX_REGISTRY_MODE=leader`.
- **Action**: Run `docker compose up -d`.
- **Result**: This node launches the Local Registry service and announces its IP to Cloudflare. 

### 2. Connect the "Peers" (The Spokes)
All other instances on the site should use the default configuration.
- **Configuration**: `STIGIX_REGISTRY_MODE=auto` or `peer`.
- **Result**: They will automatically discover the Leader via Cloudflare and switch their communication to the local Hub IP within 60-90 seconds.

### 3. Centralized Target Provisioning
Instead of configuring every node, go to the **Settings** menu of the **Leader** node.
- **Action**: Add your manual targets (Generic ICMP/HTTP/TCP endpoints).
- **Propagation**: Every 30 seconds, all connected Peers will fetch this list. These targets will appear in their dashboards marked with an **Auto** badge and a `Leader Provided` tooltip.
- **Zero-Config**: Your Spokes are now fully provisioned without touching their individual `.env` or local files.

### 4. Persistence & Customization (The "Static" Promotion)
If a Peer starts using a "Leader-provided" target in a test (e.g., Failover) or edits its properties:
- **Badge**: The target will now show both **Auto** (synced from leader) and **Static** (saved locally) badges.
- **Independence**: This ensures that even if the Leader node is offline, the Peer retains its critical test targets in its own local configuration.

### 5. Auto-Discovery (Zero-Touch)
When a new Stigix instance joins the site:
1. It is detected by its Prisma credentials.
2. It registers itself to the Leader.
3. It immediately receives the full list of shared targets from the Leader.
4. Total "Zero-Touch" deployment is achieved.

## Troubleshooting
- **Local Leader Unreachable**: If a Peer shows "Falling back to Cloudflare", it means it found a Leader IP but could not reach port `8080` (check Firewalls/Security Groups on the Hub).
- **Manual Forced Role**: Force a role in `.env` via `STIGIX_REGISTRY_MODE=leader` or `peer`.
- **Domain Changes**: You can safely change the registry domain in `.env`. The Dashboard snapshots it at boot, ensuring transitions use the updated domain immediately.
