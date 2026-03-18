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

## 🌐 Stigix Cloud & Registry
| Variable | Description | Default |
|----------|-------------|---------|
| `STIGIX_REGISTRY_ENABLED` | Enable peer discovery via global registry | `true` |
| `STIGIX_REGISTRY_URL` | URL of the Stigix Cloudflare Registry | `https://stigix-registry.jlsuzanne.workers.dev` |
| `STIGIX_TARGET_BASE_URL` | Base URL for Stigix Cloud Probes (EICAR, Download) | `https://stigix-target.jlsuzanne.workers.dev` |
| `STIGIX_TARGET_MASTER_KEY`| Global secret used with `PRISMA_SDWAN_TSGID` to generate dynamic per-tenant signatures (Production/Multi-tenant) | - |
| `STIGIX_TARGET_SHARED_KEY`| Explicit static key for signing (Legacy/Debug/Standalone) | - |
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
> [!TIP]
> Use `.env` file to manage these variables easily without cluttering your `docker-compose.yml`.
