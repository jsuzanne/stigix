> **Last Updated:** 2026-10-03 | **Created:** 2026-03-17 (v1.2.1-patch.236) | **Initial Stigix Version:** v1.2.1

# Stigix Environment Variables Reference

This document lists all environment variables supported by the Stigix All-in-One container.

## 🔑 Prisma SD-WAN (Cloud Blended)
Required for site auto-detection, flow status, and SaaS data enrichment.

| Variable | Description | Default |
|----------|-------------|---------|
| `PRISMA_SDWAN_REGION` | Regional portal (`us`, `eu`, `de`, `fr`, etc.) | `us` |
| `PRISMA_SDWAN_TSGID` | Your Tenant Service Group ID | - |
| `PRISMA_SDWAN_CLIENT_ID` | Service Account Client ID | - |
| `PRISMA_SDWAN_CLIENT_SECRET` | Service Account Secret | - |
| `PRISMA_SDWAN_SITE_NAME` | Manually override site detection (required for Hubs) | Auto-detected |

## 🛡️ Security & Auth
| Variable | Description | Default |
|----------|-------------|---------|
| `JWT_SECRET` | Secret key for signing dashboard session tokens | `your-secure-secret` |
| `PORT` | Dashboard listening port inside the container | `8080` |
| `DEBUG` | Enable verbose logging for the backend | `false` |

## 🔐 Enterprise PKI & CA Certificates (SSL Decryption)
Variables automatically configured and inherited when a custom Forward Trust CA bundle is installed in Stigix.

| Variable | Description | Default |
|----------|-------------|---------|
| `NODE_EXTRA_CA_CERTS` | Path to custom CA certificate bundle for Node.js runtime | `/app/config/certs/ca-bundle.pem` |
| `REQUESTS_CA_BUNDLE` | Path to custom CA certificate bundle for Python `requests` | `/app/config/certs/ca-bundle.pem` |
| `SSL_CERT_FILE` | Path to custom CA certificate bundle for OpenSSL / Python | `/app/config/certs/ca-bundle.pem` |
| `CURL_CA_BUNDLE` | Path to custom CA certificate bundle for `curl` and shell subprocesses | `/app/config/certs/ca-bundle.pem` |

## 🌐 Stigix Cloud & Registry
| Variable | Description | Default |
|----------|-------------|---------|
| `STIGIX_REGISTRY_ENABLED` | Enable peer discovery via global registry | `true` |
| `STIGIX_REGISTRY_URL` | URL of the Stigix Cloudflare Registry | `https://registry.stigix.io` |
| `STIGIX_TARGET_BASE_URL` | Base URL for Stigix Cloud Probes (EICAR, Download) | `https://target.stigix.io` |
| `STIGIX_TARGET_MASTER_KEY` | Master secret for target worker auth. Derived key sent per request: `SHA256(TSGID:MASTER_KEY)`. Must match `MASTER_SIGNATURE_KEY` on the Cloudflare Worker. Omit for open-access mode. | - |
| `STIGIX_SITE_NAME` | Display name for this instance in the registry | Auto-detected |

## 🚀 Traffic Generator (Synthetic)
| Variable | Description | Default |
|----------|-------------|---------|
| `AUTO_START_TRAFFIC` | Start background traffic immediately when container starts | `true` |
| `SLEEP_BETWEEN_REQUESTS`| Frequency of synthetic SaaS requests (in seconds) | `1` |
| `CLIENT_ID` | Log identifier for this instance's traffic | `client01` |

## 📊 Performance & Logs
| Variable | Description | Default |
|----------|-------------|---------|
| `DASHBOARD_REFRESH_MS` | Polling interval for UI data (milliseconds) | `3000` |
| `LOG_RETENTION_DAYS` | How many days to keep historical connectivity logs | `7` |
| `LOG_MAX_SIZE_MB` | Maximum size of `test-results.jsonl` before rotation | `100` |

---

## 📜 Revision History

| Date | Author | Description |
|---|---|---|
| 2026-10-03 | Stigix Engineering Team | Added Enterprise PKI & CA Certificates environment variables (`NODE_EXTRA_CA_CERTS`, `REQUESTS_CA_BUNDLE`, `SSL_CERT_FILE`, `CURL_CA_BUNDLE`) in v2.0.143. |
| 2026-04-23 | Stigix Engineering Team | Added Stigix Target Cloud authentication variables. |
| 2026-03-17 | Stigix Engineering Team | Initial reference document for Stigix environment variables (v1.2.1). |
