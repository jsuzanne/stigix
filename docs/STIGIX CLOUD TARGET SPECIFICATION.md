

Here is an exhaustive Markdown-style explanation of all current Stigix Target options, based on your latest Worker code (including MASTER_SIGNATURE_KEY / SHARED_KEY logic and all paths/modes).

***

# Stigix Cloudflare Target – Options \& Examples

This document explains **all options** of the Stigix Cloudflare Target Worker: authentication mechanisms, paths, query parameters, modes, and example usages.

Base URL examples:

- Phase 1 (current): `https://stigix-target.YOUR_SUBDOMAIN.workers.dev`
- Target production: `https://stigix-target.stigix.com`

In the examples below, replace the base URL and keys with your real values.

***

## 1. Authentication \& Keys

The Target supports two authentication models plus an “open lab” mode:

1. **Per‑tenant signed key** (`MASTER_SIGNATURE_KEY` + `tsg` + `key`).
2. **Single shared key** (`SHARED_KEY`).
3. **Open (no auth)** if neither env var is defined.

### 1.1 Environment variables

Configured on the Worker (via `wrangler.toml` or Cloudflare UI):

- `MASTER_SIGNATURE_KEY` (optional):
A secret master key used to derive per‑tenant keys.
- `SHARED_KEY` (optional):
A single shared key used when `MASTER_SIGNATURE_KEY` is not used.

You can set one, both, or none:

- If **`MASTER_SIGNATURE_KEY` is set** and the request includes `tsg` and `key`, the Worker validates a **per‑tenant signature**.
- Else if **`SHARED_KEY` is set**, the Worker falls back to a **simple shared key** check.
- If **neither** is set, **everything is allowed** (lab mode).


### 1.2 Request parameters used for auth

- `tsg` (query param, optional):
Tenant / TSG identifier, e.g. `tsg=acme-lab-1`.
- `key` (query param, optional):
Key value, semantics depend on mode:
    - With `MASTER_SIGNATURE_KEY`: **signature** of `tsg`.
    - With `SHARED_KEY`: shared key itself.
- `X-Stigix-Key` (header, optional):
Alternative way to pass `key` when using simple `SHARED_KEY` mode.


### 1.3 Authorization logic

Pseudocode of your current logic:

1. Compute `isRootInfoOnly`:
    - `pathname === "/" && mode === "info"` → root info request.
2. If **root info** → always authorized (no key required).
3. Else (protected mode):

4. If `masterKey && tsg && providedKey`:
        - Compute `expectedKey = sha256(tsg + ":" + masterKey)`.
        - Authorized if `providedKey === expectedKey`.
5. Else if `sharedKey`:
        - Take `key` from query or `X-Stigix-Key` header.
        - Authorized if `key === sharedKey`.
6. Else if no `masterKey` and no `sharedKey`:
        - Authorized (open lab mode).
1. If not authorized → HTTP `401 Unauthorized`.

Example 401 JSON:

```json
{
  "error": "Unauthorized",
  "tsg": "acme-lab-1",
  "hint": "Provide valid key as ?key= or X-Stigix-Key. For multi-tenant, provide ?tsg="
}
```


### 1.4 Multi-tenant signed key (MASTER_SIGNATURE_KEY)

When `MASTER_SIGNATURE_KEY` is set:

- For each tenant / TSG, you compute:

$$
key = SHA256(tsg + ":" + MASTER\_SIGNATURE\_KEY)
$$
- Requests include both `tsg` and `key`:

```bash
# Example tenant id
TSG_ID="acme-lab-1"

# On your side (Stigix / management script), compute:
# key = sha256("acme-lab-1:MASTER_SIGNATURE_KEY")

curl "https://stigix-target.stigix.com/saas/info?tsg=acme-lab-1&key=<computed_signature>"
```

The Worker recomputes `sha256(tsg:MASTER_SIGNATURE_KEY)` and compares with `key`.

This allows you to:

- Have a **single MASTER_SIGNATURE_KEY** on the Worker.
- Issue different signed keys per lab / tenant (`tsg`).
- Avoid storing the raw master key in Stigix.


### 1.5 Single shared key (SHARED_KEY)

If you don’t use per‑tenant signatures, you can fall back to a classic shared key:

- Worker env: `SHARED_KEY = "YOUR_SECRET_KEY"`
- Request:

```bash
# Via query param
curl "https://stigix-target.stigix.com/saas/info?key=YOUR_SECRET_KEY"

# Or via header
curl "https://stigix-target.stigix.com/saas/info" \
  -H "X-Stigix-Key: YOUR_SECRET_KEY"
```


***

## 2. Common `info` JSON

Most endpoints return (or can return) a standard `info` JSON describing the egress and Cloudflare edge context:

```jsonc
{
  "ip": "2a06:98c0:3600::103",
  "asn": 132892,
  "asOrganization": "Cloudflare, Inc.",
  "country": "US",
  "city": "Portland",
  "continent": "NA",
  "region": "Oregon",
  "regionCode": "OR",
  "postalCode": "97204",
  "latitude": "45.52345",
  "longitude": "-122.67621",
  "timezone": "America/Los_Angeles",
  "colo": "CDG",
  "httpProtocol": "HTTP/1.1",
  "tlsVersion": "TLSv1.2",
  "tlsCipher": "ECDHE-ECDSA-AES128-GCM-SHA256",
  "clientTcpRtt": 1,
  "clientAcceptEncoding": "gzip",
  "method": "GET",
  "url": "https://stigix-target.stigix.com/saas/info?tsg=acme",
  "userAgent": "curl/8.7.1",
  "acceptLanguage": "en-US,en;q=0.9,fr;q=0.8",
  "cfRay": "9db1c0a599487e80",
  "forwardedProto": "https"
}
```

Used for:

- Egress IP \& ASN validation.
- GEO / colo visualization.
- TLS security details.

***

## 3. Paths, Modes \& Options

The Worker uses a **router** on `pathname` to choose a logical `mode` and optional default parameters (`delay`, `size`, `code`). Then it runs a `switch(mode)`.

### 3.1 Overview table

| Path | Requires auth | Mode | Default params | Use case |
| :-- | :-- | :-- | :-- | :-- |
| `/` | No | `info` | `delay=0` | Egress info (quick check) |
| `/saas/info` | Yes | `info` | none | SaaS info for PoCs |
| `/saas/slow` | Yes | `info` | `delay=5000` if not provided | Slow SaaS app simulation |
| `/download/large` | Yes | `large` | `size="10m"` if not provided | Large download (10 MB default) |
| `/security/eicar` | Yes | `eicar` | n/a | Threat Prevention (EICAR) |
| `/saas/error/500` | Yes | `error` | `code=500` | Simulated HTTP 500 |
| `/saas/error/503` | Yes | `error` | `code=503` | Simulated HTTP 503 |
| `/advanced` | Yes | from `mode` query | depends on query | Flexible expert endpoint |

All paths except `/` are **protected endpoints** (auth required according to section 1).

***

## 4. Path Details \& Examples

### 4.1 `/` – Egress Info (Root, Unauthenticated)

- **Path**: `/`
- **Auth**: No key required.
- **Mode**: `info`
- **Behavior**:
    - No artificial delay (`delay = 0` forced).
    - Returns the standard `info` JSON.

**Example:**

```bash
curl https://stigix-target.stigix.com/
```

Output: `info` JSON (see section 2).

***

### 4.2 `/saas/info` – SaaS Info (Authenticated)

- **Path**: `/saas/info`
- **Auth**: Yes (`tsg+key` or `SHARED_KEY`).
- **Mode**: `info`
- **Behavior**:
    - Returns same `info` JSON as `/`.
    - Intended for PoC SaaS tests where you want to enforce auth.

**Example (per-tenant signature):**

```bash
curl "https://stigix-target.stigix.com/saas/info?tsg=acme-lab-1&key=<sha256(acme-lab-1:MASTER_SIGNATURE_KEY)>"
```

**Example (single SHARED_KEY):**

```bash
curl "https://stigix-target.stigix.com/saas/info?key=YOUR_SECRET_KEY"
```


***

### 4.3 `/saas/slow` – Slow SaaS App (Latency)

- **Path**: `/saas/slow`
- **Auth**: Yes.
- **Mode**: `info`
- **Query params**:
    - `delay` (optional, ms):
        - If not provided → default `5000` (5 seconds).
        - Clamped between 0 and 30,000 ms.
- **Behavior**:
    - Applies latency `delay` using `setTimeout`.
    - Then returns the `info` JSON (same structure as `/`).
- **Use case**:
    - Simulate a SaaS app with high RTT / brownout to test SD‑WAN path quality, failover, etc.

**Examples (with shared key):**

```bash
# Default 5 s
time curl "https://stigix-target.stigix.com/saas/slow?key=YOUR_SECRET_KEY"

# Custom 8 s
time curl "https://stigix-target.stigix.com/saas/slow?delay=8000&key=YOUR_SECRET_KEY"
```


***

### 4.4 `/download/large` – Large Download

- **Path**: `/download/large`
- **Auth**: Yes.
- **Mode**: `large`
- **Query params**:
    - `size` (optional):
        - `"Xm"` → `X * 1024 * 1024` bytes.
        - Or a plain integer number of bytes.
        - If not provided → default `"10m"`.
- **Behavior**:
    - Computes `sizeBytes` from `size`.
    - Applies cap `maxBytes = 20 * 1024 * 1024` (20 MB).
    - Builds a body of `finalSize` bytes filled with `"A"` characters.
    - Returns:
        - `Content-Type: application/octet-stream`
        - `Content-Length: <finalSize>`
        - `X-Stigix-Scenario: download-large`

**Example: 10 MB default**

```bash
curl -v "https://stigix-target.stigix.com/download/large?key=YOUR_SECRET_KEY" -o /dev/null
```

**Example: 5 MB**

```bash
curl -v "https://stigix-target.stigix.com/download/large?size=5m&key=YOUR_SECRET_KEY" -o /dev/null
```


***

### 4.5 `/security/eicar` – EICAR Test File

- **Path**: `/security/eicar`
- **Auth**: Yes.
- **Mode**: `eicar`
- **Behavior**:
    - Returns the standard EICAR test string followed by newline:

```
X5O!P%@AP[4\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*
```

    - Headers:
        - `Content-Type: text/plain`
        - `Cache-Control: no-store`
        - `X-Stigix-Scenario: security-eicar`
- **Use case**:
    - Threat Prevention / IPS tests (the download should be blocked by security policies).

**Example:**

```bash
curl "https://stigix-target.stigix.com/security/eicar?key=YOUR_SECRET_KEY"
```


***

### 4.6 `/saas/error/500` and `/saas/error/503` – HTTP Errors

- **Paths**:
    - `/saas/error/500`
    - `/saas/error/503`
- **Auth**: Yes.
- **Mode**: `error`
- **Behavior**:
    - Returns the `info` JSON extended with an `error` field:

```json
{
  ...info,
  "error": "Simulated HTTP 500"
}
```

or

```json
{
  ...info,
  "error": "Simulated HTTP 503"
}
```

    - HTTP status codes: 500 or 503.
    - Headers:
        - `Content-Type: application/json; charset=utf-8`
        - `Cache-Control: no-store`
        - `X-Stigix-Scenario: saas-error`

**Examples:**

```bash
curl -i "https://stigix-target.stigix.com/saas/error/500?key=YOUR_SECRET_KEY"
curl -i "https://stigix-target.stigix.com/saas/error/503?key=YOUR_SECRET_KEY"
```


***

### 4.7 `/advanced` – Flexible Expert Endpoint

- **Path**: `/advanced`
- **Auth**: Yes.
- **Modes** (via `mode` query param):
    - `info` (default if not provided).
    - `eicar`
    - `large`
    - `error`
- **Query params**:
    - `mode` – controls behavior.
    - `delay` – latency in ms (applied before response, clamped 0–30000).
    - `size` – payload size for `mode=large` (same semantics as `/download/large`).
    - `code` – HTTP status code for `mode=error`.

Behavior:

1. Apply auth (same logic).
2. Apply optional delay if `delay > 0`.
3. Switch on `mode`:
    - `info` → return `info` JSON.
    - `eicar` → return EICAR string.
    - `large` → large binary payload (like `/download/large`).
    - `error` → json + HTTP error status.

**Example: info with latency**

```bash
curl "https://stigix-target.stigix.com/advanced?mode=info&delay=2000&key=YOUR_SECRET_KEY"
```

**Example: 5 MB download with 2s latency**

```bash
curl "https://stigix-target.stigix.com/advanced?mode=large&size=5m&delay=2000&key=YOUR_SECRET_KEY" -o /dev/null
```

**Example: simulated HTTP 502**

```bash
curl -i "https://stigix-target.stigix.com/advanced?mode=error&code=502&key=YOUR_SECRET_KEY"
```

This endpoint is ideal for scripting advanced scenarios from Stigix or external tools.

***

## 5. Error Handling

### 5.1 Unauthorized (401)

Returned when protected paths are accessed without valid auth:

- Status: `401 Unauthorized`
- Body (example):

```json
{
  "error": "Unauthorized",
  "tsg": "not provided",
  "hint": "Provide valid key as ?key= or X-Stigix-Key. For multi-tenant, provide ?tsg="
}
```


### 5.2 Not Found (404)

Any unsupported `pathname` returns:

- Status: `404 Not Found`
- Body:

```json
{
  "error": "Not Found",
  "path": "/whatever",
  "hint": "Use /, /saas/info, /saas/slow, /download/large, /security/eicar, /advanced"
}
```


***

This should be enough for an exhaustive Markdown doc for Stigix targets. You can copy/paste and adapt base URLs and example keys to match your final deployment.
<span style="display:none">[^1][^2][^3]</span>

<div align="center">⁂</div>

[^1]: SPECIFICATION.md

[^2]: CHANGELOG.md

[^3]: README.md

