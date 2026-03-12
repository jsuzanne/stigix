# Stigix Autodiscovery & Registry Guide

This document explains the technical implementation of the automatic peer discovery mechanism in Stigix.

## 1. The Core Concept

Stigix instances in the same Proof of Concept (PoC) automatically find each other using a central **Registry Worker** (running on Cloudflare). This eliminates the need to manually enter IP addresses for every peer.

## 2. Authentication: The Stateless Hash

To ensure security and isolation between different clients, Stigix uses a **Stateless Hash** mechanism.

### Key Derivation
Every instance calculates a unique `X-PoC-Key` at startup:
- **Input**: Secure Hash derived from Shared Prisma Credentials and an internal salt.
- **Algorithm**: Standard cryptographic hash (transitioning to a stronger variant for production).
- **Benefit**: No local identity file (`identity.json`) is required. If your environment is correctly configured with your Prisma credentials, you are automatically authorized.

### Trust on First Registration
1. The **first** instance that registers for a given `TSG_ID` "claims" that ID with its specific hash.
2. The Worker stores this hash as the reference for that PoC.
3. Any **subsequent** instance trying to join that PoC must provide the **exact same hash**.

---

## 3. Lifecycle & Frequencies

The `RegistryManager` handles the background synchronization with adaptive polling.

| Event | Frequency (Peer Local) | Frequency (Remote) | Description |
| :--- | :--- | :--- | :--- |
| **Heartbeat** | 60 seconds (1m) | 300 seconds (5m) | Updates Private IP and capabilities. Fast on local, slow on Cloudflare to save quota. |
| **Discovery** | 30 seconds | 30 seconds | Fetches the latest list of peers and shared targets. |
| **Failover Check** | Every Hearbeat | N/A | If a local heartbeat fails, the node immediately resets to Cloudflare Bootstrap. |
| **TTL (Expire)** | 300 seconds (5m) | 300 seconds (5m) | Cloudflare automatically prunes inactive peers after 5 minutes of silence. |
| **Leader Lease** | N/A | 900 seconds (15m) | The leadership record lasts 15 minutes unless refreshed by the leader. |

---

## 4. Hybrid Mode & Bootstrap Snapshot (v1.2.1-patch.192+)

To ensure robustness during leader transitions, Stigix uses a **Bootstrap Snapshot** mechanism.

### Layering
- **Bootstrap Layer**: Permanently fixed to the `STIGIX_REGISTRY_URL` provided in `.env` at startup. Used for high-level "political" signals (e.g., announcing a new leader).
- **Service Layer**: Dynamically switches between Local Leader IPs and Cloudflare based on availability.

### How it works
1. **Startup**: The instance "snapshots" the Cloudflare URL from `.env`.
2. **Transition**: If you switch a node to `leader`, it calls Cloudflare securely using its snapshot, even if its local registry configuration was pointed at an old IP.
3. **Healing**: Peers detect the missing old leader, revert to the Cloudflare snapshot, find the new leader, and reconnect.

> [!TIP]
> **Implementation Tutorial**: For a step-by-step guide on how to set up your site and propagate targets from a Leader to all Spokes, see the [Implementation Guide](file:///Users/jsuzanne/Github/stigix/docs/HYBRID_REGISTRY.md#step-by-step-implementation-guide).

---

## 5. Troubleshooting & Verification

### Status Check
Verify the local status via:
```bash
curl http://localhost:5000/api/registry/status
```

### Common Issues
- **403 Forbidden**: Invalid PoC Key (Check Prisma Credentials in `.env`).
- **Isolation/No Leader**: Ensure at least one Hub is set to `STIGIX_REGISTRY_MODE=leader`.
- **Sync Lag**: Total convergence across all sites typically takes **60 to 90 seconds**.
