# Stigix Hybrid Registry: Architecture & Logic

The Stigix Hybrid Registry is a discovery system designed to allow Stigix instances to find each other and establish peer-to-peer connections with minimal configuration and zero cost (using Cloudflare Free Tier).

## Core Concepts

### 1. Hybrid Backend
The system operates on two layers:
- **Remote Bootstrap (Cloudflare Workers + KV)**: Used for initial discovery and as a failover. Since it has strict write quotas (1k/day), it is used sparingly.
- **Local Leader (Self-Hosted)**: Once a "Leader" is elected or manually assigned, it hosts a local registry service on port `8080`. Peers then switch to this local service for high-frequency updates, bypassing Cloudflare quotas.

### 2. Auto-Election Logic
When `STIGIX_REGISTRY_MODE` is set to `auto` (default):
- **Condition**: If an instance is a **HUB** (Data Center) or a **Branch Gateway**, it promotes itself as a **LEADER candidate**.
- **Announcement**: It registers its internal IP on Cloudflare.
- **Peer Behavior**: Other instances (Spokes/Peers) query Cloudflare to find the Leader's IP. 

### 3. IP Discovery (The "ens9" logic)
To ensure Peers can actually reach the Leader, the system must announce a routable IP:
1. **Priority**: It checks `config/interfaces.txt`. If it contains an interface (e.g., `ens9`), it uses the IP of that interface.
2. **Heuristic**: If no file is found, it scans for private IP ranges (192.168.x.x, 10.x.x.x) while ignoring virtual bridges (`docker0`, `virbr0`).
3. **Override**: Can be forced via `STIGIX_PRIVATE_IP` in `.env`.

### 4. Connection Flow & Adaptive Polling
1.  **Startup**: All instances check Cloudflare.
2.  **Leader**: Starts local registry service and heartbeats to Cloudflare every **5 minutes**.
3.  **Peer**:
    - Discovers Leader IP via Cloudflare.
    - **TCP Check**: Performs a lightweight TCP probe on port `8080` of the Leader.
    - **Transition**: If reachable, it switches its `registryUrl` to the Leader.
    - **Adaptive Discovery**: Polls for new peers every **30 seconds** (Cloudflare reads are cheap).
    - **Adaptive Heartbeat**: 
        - **Local Mode**: Heartbeats every **60 seconds** (for fast failure detection).
        - **Cloudflare Fallback**: Heartbeats every **300 seconds** (to save write quota).

### 5. Target Retention (Grace Period)
Nodes in the dashboard do not disappear instantly if a heartbeat is missed. A **15-minute grace period** is applied, keeping "stale" nodes visible to handle temporary network flaps or convergence times.

## Troubleshooting
- **Cloudflare Fallback Warning**: If a Peer shows this warning, it means it found a Leader IP but could not reach port `8080` (likely a firewall or routing issue).
- **Manual Mode**: You can force a role by setting `STIGIX_REGISTRY_MODE=leader` or `peer`.
