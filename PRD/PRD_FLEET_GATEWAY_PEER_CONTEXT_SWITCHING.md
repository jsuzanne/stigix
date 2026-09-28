# Stigix — Specification: Fleet Management Gateway & Peer Context Switching

**Last Updated:** 2026-09-28
**Creation Date:** 2026-09-26
**Initial Stigix Version:** v2.0.67 (implemented M3)
**Status:** Milestones 1–3 Implemented (v2.0.67–v2.0.80) — M4 Pending — M5 Specified
**Version:** 0.3
**Author:** jsuzanne
**Language:** English for implementation clarity

## Revision History

| Version | Date | Author | Changes |
|---|---|---|---|
| 0.3 | 2026-09-28 | jsuzanne / Antigravity | M3 closed (v2.0.67–v2.0.80). Added M5 milestone: outbound WebSocket reverse tunnel for NAT traversal (§9). Updated feature coverage and phasing table. |
| 0.2 | 2026-09-28 | jsuzanne / Antigravity | Implementation update: Milestones 1–3 shipped in v2.0.67. Added §8 Implementation Status, actual file references, deviations, and M4 scope. |
| 0.1 | 2026-09-26 | jsuzanne | Initial proposal: Navbar Context Switcher, Leader BFF Gateway Reverse-Proxy, X-Peer-Context headers, SSO/Token delegation, and Remote View banner |

---

## 1. Executive Summary

Today, managing multiple Stigix nodes requires opening a separate browser tab for each instance (e.g., `http://192.168.122.51:8080` for DC1, `http://192.168.122.56:8080` for BR2, `http://192.168.122.57:8080` for BR1). Operators must log into each node independently, keep track of dozens of IP addresses, and constantly switch between tabs to correlate observations.

The **Fleet Management Gateway & Peer Context Switcher** eliminates this friction. From a single Leader URL, the operator can switch the active UI context between any registered peer in the fleet using a top-bar dropdown. The URL in the browser remains stable, authentication is single sign-on (SSO), and the entire dashboard (Traffic, Probes, Voice, Flow Browser, Settings) seamlessly reflects the selected remote node's live data.

---

## 2. User Experience & UI Wireframes

### 2.1 Navbar Context Selector

A persistent dropdown widget is placed in the top navigation bar, adjacent to the Stigix logo:

```text
┌────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ [STIGIX]  Context: [ 🏢 DC1 (Leader - Local) ▾ ]   Dashboard  Traffic  Probes  Voice  Failover  Fleet  │
└────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

Clicking the dropdown displays an interactive list of all registered peers grouped by status:

```text
┌──────────────────────────────────────────────────┐
│  📍 SWITCH ACTIVE SITE                           │
├──────────────────────────────────────────────────┤
│  LOCAL CONTROLLER                                │
│  🏢 DC1 — Primary Datacenter (192.168.122.51)  ✓ │
├──────────────────────────────────────────────────┤
│  REMOTE SPOKES & BRANCHES                        │
│  🟢 BR1 — Branch Paris 1     (192.168.122.57)    │
│  🟢 BR2 — Branch Paris 2     (192.168.122.56)    │
│  🟡 BR5 — Branch Paris 5     (192.168.123.101)   │
│  🟢 BR8 — Branch Paris 8     (192.168.123.102)   │
├──────────────────────────────────────────────────┤
│  🔴 Lab — Offline Node       (192.168.1.99) [!]  │
└──────────────────────────────────────────────────┘
```

### 2.2 Active Remote Context Banner

When a remote peer (e.g. `BR8`) is selected:
1. The browser URL does not change hosts or ports (stays on `http://192.168.122.51:8080/index.html` or updates with an anchor hash `#peer=BR8`).
2. A distinctive high-visibility banner appears beneath the primary navbar to prevent operator disorientation:

```text
┌────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ 👁️ REMOTE VIEW: BR8 (Branch Paris 8 — 192.168.123.102) | Connected via Leader Gateway | [ ⤺ Exit to DC1 ]│
├────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                                        │
│   Dashboard shows BR8's real-time metrics, probes, active flows, and VoIP MOS                          │
│                                                                                                        │
└────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

3. All standard navigation tabs (Dashboard, Traffic, Connectivity Probes, Failover, Voice, Flow Browser) transparently query the remote peer's APIs through the Leader Gateway.
4. Clicking `[ ⤺ Exit to DC1 ]` restores local Leader context immediately.

---

## 3. Technical Architecture

### 3.1 Backend-For-Frontend (BFF) Gateway Reverse-Proxy

The Leader's Node.js server (`server.ts`) acts as an authenticated API Gateway and Reverse Proxy. The client browser communicates exclusively with the Leader.

```text
  Client Browser                            Leader Controller (DC1)                  Remote Peer (BR8)
  (192.168.1.154)                              (192.168.122.51)                      (192.168.123.102)
        │                                             │                                      │
        │ 1. GET /api/gateway/BR8/probes/summary      │                                      │
        │    Authorization: Bearer <Leader_JWT>       │                                      │
        ├────────────────────────────────────────────►│                                      │
        │                                             │ 2. Lookup BR8 in Local Registry:     │
        │                                             │    Target = 192.168.123.102:8080     │
        │                                             │ 3. Sign Inter-Node Gateway Request:  │
        │                                             │    X-Gateway-Auth: <HMAC_SIG>        │
        │                                             │ 4. Forward HTTP GET:                 │
        │                                             │    http://192.168.123.102:8080/api/probes/summary
        │                                             ├─────────────────────────────────────►│
        │                                             │                                      │ 5. Validate Gateway Sig
        │                                             │                                      │ 6. Process locally
        │                                             │ 7. Return JSON response              │
        │                                             │◄─────────────────────────────────────┤
        │ 8. Forward sanitized response to browser    │                                      │
        │◄────────────────────────────────────────────┤                                      │
```

### 3.2 Dynamic API Routing Options

Two routing conventions are supported for maximum developer ergonomics:

#### Method A: URL Prefix (Recommended for Static Assets & WebSocket)
```http
GET /api/gateway/:peerId/probes/summary
POST /api/gateway/:peerId/traffic/start
```
The Leader express server captures `:peerId`, resolves the management IP from the local Registry database, strips the `/api/gateway/:peerId` prefix, and proxies the remainder of the path directly to the target peer.

#### Method B: Context Header (Transparent Client Wrappers)
```http
GET /api/probes/summary
X-Stigix-Peer-Context: BR8
```
A lightweight Axios / Fetch interceptor in the frontend automatically attaches `X-Stigix-Peer-Context` whenever `activeContext !== 'local'`. The backend gateway middleware detects the header and reroutes the call.

---

## 4. Security & Access Control

### 4.1 Single Sign-On (SSO) & Trust Delegation
- The operator never stores credentials or tokens for individual spokes.
- The operator logs in once to the Leader using standard credentials or Master Key.
- The Leader backend signs inter-node proxy requests using an HMAC token derived from the shared cluster registry key:
  ```text
  HMAC_SHA256(peerId + timestamp + path, cluster_secret)
  ```
- The remote peer validates the timestamp (rejecting drift > 30s) and signature. No passwords or user sessions need to be replicated to spoke nodes.

### 4.2 Guardrails & Read-Only Safety Mode
When switching to a remote peer context, the Leader UI provides an optional **Safe Mode (Read-Only)** toggle:
- `Read-Only Context (Default)`: GET requests are allowed (inspecting dashboards, logs, traces, probes). Mutating POST/PUT/DELETE requests are blocked at the Gateway with `403 Forbidden ("Remote peer mutation disabled in Safe Mode")`.
- `Control Mode`: Allows triggering tests, adjusting traffic rates, and running remote diagnostics, subject to explicit operator confirmation.

---

## 5. Network Reachability & Edge Topologies

### 5.1 Direct Management Reachability (Lab / Corporate LAN / SD-WAN Underlay)
In environments where the Leader has IP routing to the peer's management interface (e.g. `192.168.122.x` / `192.168.123.x` in our lab):
- Gateway forwards requests via standard Node.js `http.request` / `node-http-proxy`.
- Latency overhead is negligible (< 2 ms).

### 5.2 NAT Traversal & Inbound-Restricted Branches (Reverse Tunneling)
In topologies where a branch peer is behind strict CGNAT or dynamic public 4G/5G connections where the Leader cannot initiate inbound TCP connections:
- The remote peer initiates and maintains an outbound persistent WebSocket or HTTP/2 tunnel to the Leader:
  `WSS /api/fleet/tunnel`
- When the Leader Gateway receives a request for that peer, it multiplexes the HTTP request over the existing reverse tunnel.
- Zero firewall pinholes or port forwards required on the branch.

---

## 6. Implementation Phasing

| # | Milestone | Status | Shipped |
|---|---|---|---|
| 1 | Gateway Middleware (`gateway-routes.ts`) | ✅ Complete | v2.0.67 |
| 2 | Frontend Context State + Dropdown + Banner | ✅ Complete | v2.0.67 |
| 3 | API Interceptor (`gFetch`) — all views + UX polish | ✅ Complete | v2.0.67–v2.0.80 |
| 4 | HMAC Security Delegation + Safe Mode toggle + IoT polling + Network Status | ❌ Pending | M4 |
| 5 | Outbound WebSocket Reverse Tunnel (NAT Traversal) | ❌ Pending | M5 |

---

## 7. Relationship to Other PRD Specifications

- **Phase 1 (`STIGIX_DIRECT_CONTROLLER_PEER_INSTALLATION_SPEC.md`):** Provides the local Registry on the Leader containing peer presence and management IP metadata.
- **Phase 2 (`STIGIX_GLOBAL_CONFIGURATION_PROVISIONING_SPEC.md`):** Governs configuration replication; Context Switching does not replace Phase 2 publishing.
- **Phase 3B (`SPECIFICATION_MULTI_INSTANCE_CONTROL_PLANE_REVISED.md`):** Governs automated asynchronous batch jobs (pull-mode with 3-tier ACK); Context Switching provides synchronous interactive inspection.

---

## 8. Implementation Status (v2.0.67 — M3)

### 8.1 Actual Files

| Component | File |
|---|---|
| Gateway proxy route | `web-dashboard/gateway-routes.ts` |
| Peer context + gFetch interceptor | `web-dashboard/src/PeerContext.tsx` |
| Peer status polling | `web-dashboard/src/App.tsx` → `PeerStatusSync` |
| Context dropdown (§2.1) | `web-dashboard/src/components/GatewayDropdown.tsx` |
| Remote View banner (§2.2) | `web-dashboard/src/App.tsx` → `RemoteViewChip` |
| Implementation reference doc | `docs/REMOTE_VIEW_GATEWAY.md` |

### 8.2 Routing — Method A Implemented (§3.2)

URL prefix routing (`/api/gateway/:peerId/*`) was implemented as specified. Method B (X-Stigix-Peer-Context header) was not implemented — the `gFetch` interceptor approach covers the same use case at the client level without requiring backend middleware changes.

### 8.3 Feature Coverage

| Feature | Remote View Status |
|---|---|
| Traffic Generator (stats + chart) | ✅ Live |
| Voice / Live Streams | ✅ Live |
| Digital Experience (DX) | ✅ Live |
| Failover Monitoring | ✅ Live |
| Custom Apps (sessions + RTT) | ✅ Live |
| Security Posture Score | ✅ Live — refreshes on peer switch (v2.0.78) |
| VyOS Control | ✅ Live — refreshes on peer switch (v2.0.78) |
| IoT Device list | ✅ Live |
| Settings config read | ✅ Live (re-fetches on peer switch) |
| Peer name in top-left navbar | ✅ Live — amber label on remote view (v2.0.80) |
| Settings config write | 🔒 Read-only (M4) |
| Speedtest / Iperf | 🔒 Disabled — not proxiable |
| IoT Real-time log stream (SSE) | ❌ SSE not tunnelable via HTTP proxy — M4 polling fallback |
| Network Status (GW/Public IP) | ❌ Still DC1 local — M4 |
| NAT-traversal reachability | ❌ Requires outbound WS tunnel — M5 |

### 8.4 Deviations from Spec

| Spec Item | Actual Implementation |
|---|---|
| §4.1 HMAC inter-node signing | **Not yet implemented** — gateway forwards using peer registry token. Planned M4. |
| §4.2 Safe Mode (Read-Only toggle) | Partially implemented — write actions disabled via `isRemoteView` guards. No explicit toggle in UI yet. |
| §5.2 Reverse tunnel (WSS) | Not implemented — lab topology has direct reachability; deferred to a future milestone. |
| PeerStatusSync polling | Not in original spec — added to handle live stats (voice, traffic) that cannot be pulled on-demand per API call. |

### 8.5 M4 Scope

1. **HMAC inter-node authentication** — `HMAC_SHA256(peerId + timestamp + path, cluster_secret)` as specified in §4.1.
2. **Safe Mode toggle in UI** — explicit Read-Only / Control Mode button in Remote View banner.
3. **Write actions enabled** — lift `isRemoteView` guards in CustomApps, Settings with confirmation dialog.
4. **IoT log stream** — replace SSE with `gFetch` REST polling fallback.
5. **Network Status** — fetch GW/Public IP from remote peer via PeerStatusSync.
6. **Traffic history range** — pass `timeRange` state into PeerStatusSync history loop.

---

## 9. Milestone 5 — Outbound WebSocket Reverse Tunnel (NAT Traversal)

### 9.1 Problem Statement

The M3 gateway architecture assumes the Leader can initiate outbound TCP connections to each peer's management port (`peer_ip:8080`). This is valid in:
- **Lab OOB** environments (flat management LAN, all nodes directly reachable).
- **Corporate SD-WAN** topologies where management traffic rides the overlay.

It **fails** in:
- **Real Network In-band** deployments where branch nodes are behind CGNAT, 4G/5G dynamic IPs, or strict enterprise firewalls that block inbound connections.
- Any topology where the branch peer IP registered in the Registry is a private address not routable from the Leader.

### 9.2 Solution: Peer-Initiated Outbound WebSocket Tunnel

Each peer initiates and maintains a persistent outbound WebSocket connection to the Leader at startup:

```text
  Branch Peer (BR5)                           Leader (DC1)
  behind CGNAT / NAT                          public / reachable

  1. Boot: ws.connect(STIGIX_LEADER_URL/api/fleet/tunnel)
            ──── WSS handshake + JWT auth ────►
            ◄─── 101 Switching Protocols ─────
            ◄──── peerId registered in WS session table ────

  2. Operator selects BR5 in Leader UI
     Leader Gateway receives:
       GET /api/gateway/BR5/api/traffic/stats

  3. Leader resolves BR5 → WS channel (not direct HTTP)
     Encapsulates HTTP request in JSON frame:
       { id: "req-42", method: "GET", path: "/api/traffic/stats", headers: {...} }
     ──── WS frame → BR5 ────────────────────►

  4. BR5 processes request locally, responds:
       { id: "req-42", status: 200, body: { ... } }
     ◄─── WS frame ──────────────────────────

  5. Leader reconstructs HTTP response → browser
```

### 9.3 Transport Protocol

#### Leader side — `server.ts`

```typescript
// New endpoint: ws://leader:8080/api/fleet/tunnel
// Registered peers connect here on boot
app.ws('/api/fleet/tunnel', (ws, req) => {
    const peerId = authenticate(req); // JWT validation
    tunnelRegistry.register(peerId, ws);
    ws.on('message', (frame) => tunnelRegistry.dispatch(frame));
    ws.on('close', () => tunnelRegistry.unregister(peerId));
});

// Gateway proxy — updated routing logic
function proxyToPeer(peerId, req, res) {
    const channel = tunnelRegistry.get(peerId);
    if (channel) {
        // WS tunnel path (NAT scenario)
        return forwardOverTunnel(channel, req, res);
    }
    // Fallback: direct HTTP (Lab/OOB scenario)
    return forwardHTTP(peerIp, req, res);
}
```

#### Peer side — `server.ts` (all instances)

```typescript
// On startup, if STIGIX_LEADER_URL is configured and this node is NOT the leader
if (leaderUrl && !isLeader) {
    const ws = new WebSocket(`${leaderUrl}/api/fleet/tunnel`, {
        headers: { Authorization: `Bearer ${gatewayToken}` }
    });
    ws.on('message', (frame) => {
        const req = JSON.parse(frame);
        // Process locally and send response back
        const response = await handleLocalRequest(req);
        ws.send(JSON.stringify({ id: req.id, ...response }));
    });
    // Reconnect with exponential backoff on disconnect
    ws.on('close', () => scheduleReconnect());
}
```

### 9.4 Request Multiplexing

Since WebSocket is full-duplex but not natively request/response, requests are tagged with a unique `id` (UUID). The Leader maintains a `Map<id, {resolve, reject, timer}>` for in-flight requests:

```typescript
async function forwardOverTunnel(ws, req, res) {
    const id = crypto.randomUUID();
    const timeout = setTimeout(() => inflight.get(id)?.reject('timeout'), 10_000);
    const response = await new Promise((resolve, reject) => {
        inflight.set(id, { resolve, reject, timeout });
        ws.send(JSON.stringify({ id, method: req.method, path: req.path, body: req.body }));
    });
    clearTimeout(timeout);
    res.status(response.status).json(response.body);
}
```

### 9.5 Automatic Fallback Strategy

| Gateway Resolution Logic | Transport Used |
|---|---|
| Peer has active WS tunnel in `tunnelRegistry` | WS reverse tunnel (M5) |
| Peer has routable IP in Registry (direct reachable) | Direct HTTP `http.request` (M3) |
| Neither | `503 Peer Unreachable` |

This ensures **zero behavioral change** for Lab/OOB topologies where direct HTTP works fine.

### 9.6 Configuration

| Variable | Set on | Description |
|---|---|---|
| `STIGIX_LEADER_URL` | **Peer** | Full WS URL of the Leader (e.g. `ws://192.168.122.51:8080`). If absent, peer does not attempt tunnel. |
| `STIGIX_TUNNEL_RECONNECT_MS` | Peer | Base reconnect interval (default `5000` ms, exponential backoff ×2, cap `60s`). |
| `STIGIX_TUNNEL_TIMEOUT_MS` | Leader | Per-request timeout over the tunnel (default `10000` ms). |

### 9.7 Security

- The peer authenticates to the Leader using the same `gatewayToken` (JWT, shared cluster secret) used for M3 direct HTTP.
- M4 HMAC signing is reused for WS frame authentication once implemented.
- The Leader only accepts WS tunnel connections from peers already registered in the Fleet Registry.
- All tunnel traffic rides the existing TLS layer if `STIGIX_HTTPS=true`.

### 9.8 Rollout Plan

1. **Leader** — add `ws` handler at `/api/fleet/tunnel`, implement `TunnelRegistry` and `forwardOverTunnel`.
2. **Peer** — add startup WS client in `server.ts` (triggered by `STIGIX_LEADER_URL` env var).
3. **Gateway Proxy** — update routing to prefer tunnel over direct HTTP.
4. **Fleet UI** — add tunnel status indicator per peer in `GatewayDropdown` (🔌 vs 🌐).
5. **Testing** — validate with a lab VM behind iptables NAT to simulate CGNAT.
