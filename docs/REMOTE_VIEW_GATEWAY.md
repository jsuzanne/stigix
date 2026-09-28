> **Last Updated:** 2026-09-28 | **Created:** 2026-09-28 (v2.0.67)

# Remote View Gateway — Implementation Reference

## Overview

This document describes the **Remote View Gateway** feature implemented in Stigix v2.0.67 (M3). It is distinct from the long-term [Multi-Instance Control Plane PRD](../PRD/SPECIFICATION_MULTI_INSTANCE_CONTROL_PLANE_REVISED.md), which specifies a future agent-pull job model with durable jobs, ACKs, and fleet orchestration.

The Remote View Gateway is a lightweight, immediate solution that allows an operator on **DC1** to observe the state of a remote peer (e.g. **BR5**) from within the DC1 dashboard, with no agent installed on BR5 and no additional network configuration beyond existing peer-to-peer reachability.

---

## Architecture

### Data Flow

```
DC1 Browser
    │
    ▼  activePeerId = "br5"
gFetch interceptor (PeerContext.tsx)
    │  intercepts all /api/* calls
    ▼
DC1 Express Gateway (/api/gateway/:peerId/*)
    │  HTTP pass-through proxy (node-http-proxy)
    ▼
BR5 Stigix API (direct HTTP, peer-to-peer)
```

### Key Components

| Component | File | Role |
|---|---|---|
| `PeerContextProvider` | `src/PeerContext.tsx` | Provides `gFetch`, `activePeerId`, `setActivePeerId` to all children |
| `gFetch` interceptor | `src/PeerContext.tsx` | Rewrites `/api/*` → `/api/gateway/:peerId/*` when a remote peer is active |
| Gateway proxy | `gateway-routes.ts` | Express route handler that HTTP-proxies requests to the target peer |
| `PeerStatusSync` | `src/App.tsx` | React component running 3 background polling loops for remote peer state |
| `GatewayDropdown` | `src/components/GatewayDropdown.tsx` | UI dropdown to select the active peer; shows UNREACHABLE badge for offline peers |
| `RemoteViewChip` | `src/App.tsx` | Banner displayed when a remote peer is selected |

### PeerStatusSync Polling Loops

`PeerStatusSync` runs inside `PeerContextProvider` and is active only when `activePeerId !== null` (i.e. a remote peer is selected):

| Loop | Interval | Endpoint | Data Delivered |
|---|---|---|---|
| **Fast** | 3s (500ms on failover) | `/api/admin/live-status` | Voice streams, convergence status |
| **Fast** | 3s | `/api/traffic/status` | Traffic running state, active rate, client count |
| **Slow** | 10s | `/api/admin/system/dashboard-data` | System stats, overall status |
| **History** | 60s | `/api/traffic/history?range=1h` | Traffic Volume chart data |

---

## Feature Coverage Matrix

### ✅ Fully Working in Remote View

| Feature | Notes |
|---|---|
| Traffic Generator stats | TRAFFIC RATE, SUCCESS RATE, ACTIVE APPS, TOTAL REQUESTS/ERRORS |
| Traffic Volume chart | Populated via 60s history poll in PeerStatusSync |
| Voice / Live Streams | Live BR5 streams; failover alerts |
| Digital Experience (DX) | DX score, endpoints, latency |
| Failover Monitoring | Live convergence results from BR5 |
| Custom Apps — session list | Incoming/outgoing sessions, RTT, metrics from BR5 |
| Custom Apps — app list | All 11 apps (list + status indicators) from BR5 |
| Security — Posture Score | URL / DNS / Threat scores from BR5 via `useSecurityScores` hook |
| Security — Efficacy | Test results from BR5 |
| IoT — Device list | Devices, IPs (BR5 subnet), packets, scores from BR5 |
| Settings — System tab | Hostname, uptime, container stats from BR5 |

### 🔒 Intentionally Disabled in Remote View (Read-Only M3)

| Feature | Reason |
|---|---|
| Custom Apps Start/Stop All | Write action — M4 scope |
| Custom Apps Listener/Client Start/Stop | Write action — M4 scope |
| Internet Speedtest | Requires BR5 local process attachment; not proxiable |
| Iperf Client | Same as Speedtest |
| Settings — Save changes | Write action — M4 scope |

### ❌ Not Yet Working / Known Limitations

| Feature | Root Cause | Planned Fix |
|---|---|---|
| **IoT Real-time Analysis (log stream)** | Uses SSE/WebSocket — cannot be tunneled through HTTP gateway proxy | M4: replace with REST polling fallback via `gFetch` |
| **Network Status (GW IP, Public IP)** | Fetches from DC1 local system — no peer routing | M4: add dedicated endpoint to PeerStatusSync |
| **Settings data in remote view** | useEffect dependency `[token, activePeerId]` added but write path needs validation | M4: full remote settings read/write with confirmation banner |
| **Traffic history range selector** | History loop fixed to `?range=1h`; other ranges not yet hooked | M4: pass `timeRange` state to PeerStatusSync |

---

## UX Conventions

### Remote View Indicator

When a remote peer is active, a `RemoteViewChip` banner is shown at the top of the dashboard:

```
[ 👁 Remote View: BR5-Ubuntu ]
```

### Unavailable Features

Features that cannot work in remote view must display one of:

- **Disabled button** with tooltip: `"Not available in remote view"` (Speedtest, Iperf)
- **`<RemoteUnavailable>`** inline badge: for panels that would otherwise appear empty without explanation (planned for IoT log stream, Network Status)

### UNREACHABLE Peers

The `GatewayDropdown` shows an `UNREACHABLE` badge (red) for peers that fail the gateway health check. Selecting them is blocked to prevent silent empty states.

---

## Security Model (M3)

> ⚠️ **Current state is permissive.** The gateway proxy on DC1 accepts any request from authenticated DC1 users and forwards it to the target peer using the peer's own credentials (registry token).

| Aspect | M3 Status | M4 Target |
|---|---|---|
| Authentication | DC1 JWT required | Add per-peer HMAC signing |
| Authorization | Any DC1 user can proxy to any peer | Role-based peer access |
| Peer credential exposure | Peer token used internally, not sent to browser | Unchanged |
| Audit log | None | Add gateway access audit trail |

---

## Migration Patterns

### Adding a New Component to Remote View

1. Import `usePeerContext` from `../PeerContext`.
2. Replace `fetch(` calls with `gFetch(`.
3. Add `activePeerId` to any `useEffect` dependency array that loads data on mount.
4. If the feature cannot work remotely, add a visual indicator (disabled state or `<RemoteUnavailable>`).

### Common Pitfall: Promise.all and Chained .then()

`sed 's/await fetch(/await gFetch(/g'` **does not** catch:

```ts
// ❌ missed by sed
const [a, b] = await Promise.all([
  fetch('/api/foo', ...),
  fetch('/api/bar', ...),
]);

// ❌ missed by sed
fetch('/api/baz', ...).then(r => r.json()).then(setData);
```

Always verify with:
```bash
grep -c "fetch('/api\|fetch(\`/api" src/MyComponent.tsx
```

---

## Relationship to PRD Phase 3

The Remote View Gateway is a **pragmatic bootstrap** that satisfies the observability goal of Phase 3 without the full agent-pull job model. It should be seen as a stepping stone:

| Capability | Remote View Gateway (M3) | PRD Phase 3 (planned) |
|---|---|---|
| Read peer state | ✅ Live polling | ✅ Enriched heartbeat telemetry |
| Trigger remote actions | ❌ (M4) | ✅ Durable jobs with ACK lifecycle |
| Offline peer last-known state | ❌ | ✅ Persisted in controller |
| Multi-peer fleet view | ❌ | ✅ Consolidated fleet dashboard |
| Job scheduling | ❌ | ✅ `start_at` synchronized jobs |
| Audit trail | ❌ | ✅ Full job + result history |

The gateway proxy approach may be retired or kept as a low-latency complement to the job model once Phase 3 is fully implemented.

---

## 📜 Revision History

| Date | Stigix Version | Author / Trigger | Summary of Changes |
|---|---|---|---|
| 2026-09-28 | `v2.0.67` | Stigix Core Team / Antigravity | Initial document creation — M3 Remote View Gateway implementation reference |
