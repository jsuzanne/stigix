# Stigix — Specification: Fleet Management Gateway & Peer Context Switching

**Last Updated:** 2026-09-26  
**Creation Date:** 2026-09-26  
**Initial Stigix Version:** v2.2 (planned)  
**Status:** Proposal (Phase 3D Roadmap)  
**Version:** 0.1  
**Author:** jsuzanne  
**Language:** English for implementation clarity

## Revision History

| Version | Date | Author | Changes |
|---|---|---|---|
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

1. **Milestone 1 — Gateway Middleware (`server.ts`):**
   - Implement `/api/gateway/:peerId/*` proxy route.
   - Registry IP resolution with caching and connection timeout guards (5s timeout, 504 on unreachable).
2. **Milestone 2 — Frontend Context State (`web-dashboard`):**
   - Add `PeerContextContext.tsx` React context to store active peer ID.
   - Add Topbar Dropdown component in navigation bar.
   - Add Remote View Banner when context is non-local.
3. **Milestone 3 — API Interceptor:**
   - Update API client utilities to route calls through `/api/gateway/:peerId/` when in remote context.
4. **Milestone 4 — Security Delegation & Safe Mode:**
   - Add HMAC signature verification between Leader and Peers.
   - Enforce Read-Only mode toggle.

---

## 7. Relationship to Other PRD Specifications

- **Phase 1 (`STIGIX_DIRECT_CONTROLLER_PEER_INSTALLATION_SPEC.md`):** Provides the local Registry on the Leader containing peer presence and management IP metadata.
- **Phase 2 (`STIGIX_GLOBAL_CONFIGURATION_PROVISIONING_SPEC.md`):** Governs configuration replication; Context Switching does not replace Phase 2 publishing.
- **Phase 3B (`SPECIFICATION_MULTI_INSTANCE_CONTROL_PLANE_REVISED.md`):** Governs automated asynchronous batch jobs (pull-mode with 3-tier ACK); Context Switching provides synchronous interactive inspection.
