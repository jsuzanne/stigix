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

The `RegistryManager` handles the background synchronization.

| Event | Frequency | Description |
| :--- | :--- | :--- |
| **Heartbeat** | Every 5 minutes (300s) | The instance sends its current Private IP and capabilities (Voice, Security, etc.) to the registry. |
| **Discovery** | Every 2 minutes (120s) | The instance fetches the list of *other* nodes registered for the same PoC. |
| **TTL (Expire)** | 600 seconds (10m) | If an instance stops sending heartbeats, it is automatically removed from the registry after 10 minutes. |

---

## 4. Hybrid Mode (v1.2.1-patch.166+)

To optimize for Cloudflare Free tier limits, Stigix supports a **Hybrid Registry** model. 

### Roles
- **Leader**: One node (typically a central Hub) acts as the local registry server. It announces its local IP to Cloudflare (the "Bootstrap Signal").
- **Peer**: All other nodes discover the Leader's IP via Cloudflare once, then switch all subsequent heartbeat/discovery traffic to the Leader's local IP.

### Configuration
Set the following variable in your `.env`:
```bash
# On the Hub/Leader node
STIGIX_REGISTRY_MODE=leader

# On all other nodes (default)
STIGIX_REGISTRY_MODE=peer
```

---

## 5. Troubleshooting & Verification

### Redeploying the Bootstrap
If you manage your own Cloudflare Worker, you **must** redeploy it to support the new `/leader` endpoints:
```bash
cd stigix-registry
npx wrangler deploy
```

### Checking Status
Verify the local status via:
```bash
curl http://localhost:5000/api/registry/status
```

### Logs to Watch
- **Leader**: `[REGISTRY] Starting in LEADER mode`, `🏠 Local Registry Server mounted`
- **Peer**: `[REGISTRY] Switched to Local Leader: http://<leader-ip>:5000/api/registry`

### Common Issues
- **403 Forbidden**: Invalid PoC Key.
- **No Leader Found**: No node has been configured or started with `STIGIX_REGISTRY_MODE=leader`.
- **Worker Redirection**: If a Peer cannot find a Leader, it will fallback to Cloudflare for 5 minutes before retrying.
