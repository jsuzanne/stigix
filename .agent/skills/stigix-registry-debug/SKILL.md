---
name: stigix-registry-debug
description: Troubleshoot synchronization issues with the Stigix Registry (Cloudflare Worker). Use this when autodiscovery is failing or peers are not appearing in the dashboard.
---

# Stigix Registry Debug Skill

Use this skill to diagnose why instances are not discovering each other.

## 1 — Check Registry Status API

Run this command on the local instance:
```bash
curl -s http://localhost:5000/api/registry/status | jq .
```
Verify:
- `is_registered`: must be `true`.
- `poc_id`: must match the `PRISMA_SDWAN_TSGID`.
- `poc_key`: verify if the hash is present.

## 2 — Test Worker Connectivity

Verify if the agent can reach the Cloudflare Worker:
```bash
STIGIX_URL=$(grep STIGIX_REGISTRY_URL .env | cut -d'=' -f2)
curl -I $STIGIX_URL/instances
```
A `403 Forbidden` is expected without headers, but a `521` or `404` indicates a connectivity or URL issue.

## 3 — Inspect Cloudflare Logs

If you have access to the Cloudflare dashboard:
1. Go to **Workers & Pages**.
2. Select **stigix-registry**.
3. Go to the **Logs** tab and click **Begin stream**.
4. Look for:
   - `[AUTH] Refused heartbeat`: Invalid PoC Key (Hash mismatch).
   - `[AUTH] Refused registration`: Invalid Global API Key.

## 4 — Common Fixes

- **Mismatching Hash**: If a PoC was registered with a wrong `CLIENT_ID`, you must wait for the 48h expiration or manually flush the KV key `auth:poc:<TSG_ID>`.
- **Environment Incomplete**: Ensure `STIGIX_REGISTRY_ENABLED=true` is set.
- **Port 5000**: Ensure the backend is running and listening for discovery updates.
