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
| **Heartbeat** | Every 60 seconds | The instance sends its current Private IP and capabilities (Voice, Security, etc.) to the registry. |
| **Discovery** | Every 30 seconds | The instance fetches the list of *other* nodes registered for the same PoC. |
| **TTL (Expire)** | 300 seconds (5m) | If an instance stops sending heartbeats, it is automatically removed from the registry after 5 minutes. |

---

## 4. Troubleshooting & Verification

### Visualization of the Key
You can verify the current PoC Key (hash) by querying the local agent API:
```bash
curl http://localhost:5000/api/registry/status
```
Look for the `"poc_key"` field in the JSON response.

### Checking Peer Discovery
You can see which peers have been discovered by checking the same API or looking for instances with the **Auto** badge in the **Settings > Targets** dashboard.

### Common Issues
- **403 Forbidden**: Usually means the `CLIENT_ID` or `TSG_ID` does not match the one used by the first node that registered the PoC.
- **No Peers Found**: Ensure `STIGIX_REGISTRY_ENABLED=true` is set in the `.env` of all nodes.
