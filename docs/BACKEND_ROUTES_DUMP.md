# Stigix Backend API - Full Route Dump

Ce document liste de manière exhaustive toutes les routes API exposées par le backend `server.ts` (Target/Agent Stigix).

## /ADMIN

- **`/api/admin/config/export`** `[GET]`
- **`/api/admin/config/import`** `[POST]`
- **`/api/admin/maintenance/restart`** `[POST]`
- **`/api/admin/maintenance/status`** `[GET]`
- **`/api/admin/maintenance/upgrade`** `[POST]`
- **`/api/admin/maintenance/version`** `[GET]`
- **`/api/admin/system/dashboard-data`** `[GET]`
- **`/api/admin/system/info`** `[GET]`

## /AUTH

- **`/api/auth/change-password`** `[POST]`
- **`/api/auth/login`** `[POST]`
- **`/api/auth/users`** `[POST]`

## /CONFIG

- **`/api/config/applications/export`** `[GET]`
- **`/api/config/applications/import`** `[POST]`
- **`/api/config/apps`** `[GET, POST]`
- **`/api/config/apps-bulk`** `[POST]`
- **`/api/config/category`** `[POST]`
- **`/api/config/convergence`** `[GET, POST]`
- **`/api/config/interfaces`** `[GET, POST]`
- **`/api/config/ui`** `[GET]`

## /CONNECTIVITY

- **`/api/connectivity/active-probes`** `[GET]`
- **`/api/connectivity/custom`** `[GET, POST]`
- **`/api/connectivity/custom/export`** `[GET]`
- **`/api/connectivity/custom/import`** `[POST]`
- **`/api/connectivity/docker-stats`** `[GET]`
- **`/api/connectivity/iperf/client`** `[POST]`
- **`/api/connectivity/iperf/server`** `[GET]`
- **`/api/connectivity/public-ip`** `[GET]`
- **`/api/connectivity/results`** `[GET]`
- **`/api/connectivity/speedtest`** `[GET]`
- **`/api/connectivity/stats`** `[GET]`
- **`/api/connectivity/test`** `[GET]`

## /CONVERGENCE

- **`/api/convergence/counter`** `[DELETE]`
- **`/api/convergence/endpoints`** `[GET, POST]`
- **`/api/convergence/endpoints/:id`** `[DELETE]`
- **`/api/convergence/history`** `[GET]`
- **`/api/convergence/start`** `[POST]`
- **`/api/convergence/status`** `[GET]`
- **`/api/convergence/stop`** `[POST]`

## /FEATURES

- **`/api/features`** `[GET]`

## /ICONS

- **`/api/icons`** `[GET]`

## /IOT

- **`/api/iot/config/export`** `[GET]`
- **`/api/iot/config/import`** `[POST]`
- **`/api/iot/devices`** `[GET, POST]`
- **`/api/iot/devices/:id`** `[DELETE]`
- **`/api/iot/start-batch`** `[POST]`
- **`/api/iot/start/:id`** `[POST]`
- **`/api/iot/stats`** `[GET]`
- **`/api/iot/stop-batch`** `[POST]`
- **`/api/iot/stop/:id`** `[POST]`

## /LOGS

- **`/api/logs`** `[GET]`

## /PROBES

- **`/api/probes/discovery/sync`** `[POST]`

## /REGISTRY

- **`/api/registry/static-leader`** `[POST]`
- **`/api/registry/status`** `[GET]`
- **`/api/registry/test-connectivity`** `[POST]`

## /SECURITY

- **`/api/security/config`** `[GET, POST]`
- **`/api/security/dns-test`** `[POST]`
- **`/api/security/dns-test-batch`** `[POST]`
- **`/api/security/edl-config`** `[GET, POST]`
- **`/api/security/edl-sync`** `[POST]`
- **`/api/security/edl-test`** `[POST]`
- **`/api/security/edl-upload`** `[POST]`
- **`/api/security/results`** `[GET, DELETE]`
- **`/api/security/results/:id`** `[GET]`
- **`/api/security/results/stats`** `[GET]`
- **`/api/security/statistics`** `[DELETE]`
- **`/api/security/threat-test`** `[POST]`
- **`/api/security/url-test`** `[POST]`
- **`/api/security/url-test-batch`** `[POST]`

## /SITEINFO

- **`/api/siteinfo`** `[GET]`
- **`/api/siteinfo/refresh`** `[POST]`

## /STATS

- **`/api/stats`** `[GET, DELETE]`

## /STATUS

- **`/api/status`** `[GET]`

## /SYSTEM

- **`/api/system/auto-detect-interface`** `[POST]`
- **`/api/system/default-interface`** `[GET]`
- **`/api/system/gateway-ip`** `[GET]`
- **`/api/system/health`** `[GET]`
- **`/api/system/interfaces`** `[GET]`

## /TARGET

- **`/api/target/config`** `[GET]`
- **`/api/target/proxy/{*path}`** `[GET]`
- **`/api/target/scenarios`** `[GET]`

## /TARGETS

- **`/api/targets`** `[GET, POST]`
- **`/api/targets/:id`** `[PUT, DELETE]`

## /TESTS

- **`/api/tests/xfr`** `[POST, GET]`
- **`/api/tests/xfr/:id`** `[GET]`
- **`/api/tests/xfr/:id/stream`** `[GET]`

## /TOPOLOGY

- **`/api/topology`** `[GET]`

## /TRAFFIC

- **`/api/traffic/history`** `[GET]`
- **`/api/traffic/settings`** `[POST]`
- **`/api/traffic/start`** `[POST]`
- **`/api/traffic/status`** `[GET]`
- **`/api/traffic/stop`** `[POST]`

## /VERSION

- **`/api/version`** `[GET]`

## /VOICE

- **`/api/voice/config`** `[GET, POST]`
- **`/api/voice/config/export`** `[GET]`
- **`/api/voice/config/import`** `[POST]`
- **`/api/voice/control`** `[POST]`
- **`/api/voice/counter`** `[DELETE]`
- **`/api/voice/stats`** `[GET, DELETE]`
- **`/api/voice/status`** `[GET]`

## /VYOS

- **`/api/vyos/config/export`** `[GET]`
- **`/api/vyos/config/import`** `[POST]`
- **`/api/vyos/config/reset`** `[POST]`
- **`/api/vyos/history`** `[GET]`
- **`/api/vyos/routers`** `[GET, POST]`
- **`/api/vyos/routers/:id`** `[POST, DELETE]`
- **`/api/vyos/routers/discover`** `[POST]`
- **`/api/vyos/routers/refresh/:id`** `[POST]`
- **`/api/vyos/routers/test/:id`** `[POST]`
- **`/api/vyos/sequences`** `[GET, POST]`
- **`/api/vyos/sequences/:id`** `[DELETE]`
- **`/api/vyos/sequences/pause/:id`** `[POST]`
- **`/api/vyos/sequences/resume/:id`** `[POST]`
- **`/api/vyos/sequences/run/:id`** `[POST]`
- **`/api/vyos/sequences/step/:id`** `[POST]`
- **`/api/vyos/sequences/stop/:id`** `[POST]`

