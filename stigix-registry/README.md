# Stigix Registry Cloudflare Worker

The Stigix Registry is a centralized service for instance registration and discovery. It allows Stigix nodes to announce their existence and find other nodes within the same PoC (Proof of Concept) / Unified SASE tenant.

## 🚀 Quick Deployment

1. **Setup Wrangler**:
   ```bash
   npx wrangler login
   ```

2. **Create KV Namespace**:
   ```bash
   npx wrangler kv namespace create STIGIX_REGISTRY
   ```
   Copy the `id` from the output.

3. **Configure**: 
   Paste the ID into `wrangler.toml`:
   ```toml
   [[kv_namespaces]]
   binding = "STIGIX_REGISTRY"
   id = "your-namespace-id"
   ```

4. **Deploy**:
   ```bash
   npm install
   npm run deploy
   ```

---

## 🔒 Security Model

The registry uses a two-tier authentication system:

### 1. Global Gateway (Master Key)
- Controlled via the `REGISTRY_API_KEY` Cloudflare secret.
- If set, every request must include the header `X-Api-Key: <your-key>`.
- **To set it**: `npx wrangler secret put REGISTRY_API_KEY`

### 2. PoC Isolation (Auto-Enrollment)
- When an instance registers for a PoC for the first time, the Worker generates a unique `poc_key`.
- This key is returned in the JSON response of the first `/register`.
- All future discovery calls (`GET /instances`) for that specific PoC **require** this key in the header `X-PoC-Key`.

---

## 📡 API Reference

### POST `/register`
Used for heartbeat and discovery enrollment.

**Request Body:**
```json
{
  "poc_id": "123456",
  "instance_id": "node-paris-01",
  "type": "docker",
  "ip_private": "10.0.0.5",
  "capabilities": { "voice": true, "speedtest": true },
  "meta": { "site": "PARIS-DC", "version": "1.2.1" }
}
```

**Response:**
```json
{
  "status": "ok",
  "poc_key": "uuid-to-save-locally",
  "detected": {
    "ip_public": "x.x.x.x",
    "location": { "country": "FR", "city": "Paris" }
  }
}
```

### GET `/instances`
Lists active instances in a PoC.

**Query Parameters:**
- `poc_id`: (Required for standard users) The TSGID of the PoC.
- `scope`: (Optional) `all` or `others` (to exclude self).
- `self_instance_id`: (Required if `scope=others`).

**Headers:**
- `X-PoC-Key`: The key received during registration.
- **OR** `X-Api-Key`: If browsing as an administrator.

---

## 🧪 Testing

Use the included `seed_registry.sh` script to quickly populate the registry with 15 mock instances across 3 PoCs:

```bash
bash seed_registry.sh
```

Then check the results:
```bash
# Get all (if no global key is set or using admin key)
curl https://stigix-registry.jlsuzanne.workers.dev/instances
```

---

## ⚙️ Configuration

- **TTL**: Entries expire after 300 seconds (5 minutes) of inactivity.
- **Custom Domain**: Once whitelisted, update the `routes` or `triggers` in `wrangler.toml`.
