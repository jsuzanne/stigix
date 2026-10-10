> **Last Updated:** 2026-10-10 | **Created:** 2026-10-10 (v2.2.8)

# PRD — Stigix Cloud Relay & Zero-Inbound Remote Access

## 1. Executive Summary & Vision

Modern network engineers, SASE architects, and demo engineers frequently deploy **Stigix** within air-gapped on-premises laboratories, private VMware/Proxmox clusters, or behind strict enterprise network firewalls (e.g., Palo Alto Networks, Fortinet, Cisco). In these environments:
- **Inbound ports are strictly forbidden** by corporate security policy.
- Public IPv4 addresses and NAT port-forwarding are unavailable.
- Sharing a live Stigix instance with a customer, colleague, or remote stakeholder currently requires complex corporate VPN setup, third-party agents, or exposing raw compute instances to the public Internet.

**Stigix Cloud Relay** introduces a native, enterprise-grade **Zero-Inbound Remote Access Architecture**. By establishing an encrypted, persistent outbound WebSocket connection (`WSS:443`) from the private on-premises Leader to an intermediate public relay (hosted on Hetzner or any cloud VPS behind Cloudflare), Stigix instances can be accessed securely from anywhere on Earth via clean custom domains (e.g., `https://share.stigix.io` or `https://my-lab.stigix.io`).

This architecture delivers two complementary capabilities:
1. **On-Demand Ephemeral Sharing ("Magic Links")**: Generate 1-click temporary access URLs with time-to-live (TTL), read-only demo sandboxing, optional PIN protection, and instant revocation.
2. **Permanent Outbound Remote Access**: Run the primary Stigix Leader entirely on-premise while maintaining permanent, authenticated 24/7 web management from the public Internet with zero inbound firewall rules.

---

## 2. End-to-End System Architecture

The solution operates entirely through an outbound-initiated reverse proxy tunnel, shielding both the private on-premise laboratory and the cloud relay VPS from direct Internet exposure.

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ PUBLIC INTERNET & CLIENT VIEW                                                          │
│                                                                                        │
│   [ Remote Visitor / Customer / Admin Browser ]                                        │
│          │                                                                             │
│          │ HTTPS (https://share.stigix.io/s/demo-7f8a)                                 │
│          ▼                                                                             │
│   ┌─────────────────────────────────────────────────────────────────┐                  │
│   │ CLOUDFLARE EDGE (WAF, DDoS Protection, Free Global SSL)         │                  │
│   │ - Caches static UI assets (Vite JS/CSS/SVGs) at edge            │                  │
│   │ - Passes dynamic API calls and WebSocket streams to Tunnel      │                  │
│   └────────────────────────────────┬────────────────────────────────┘                  │
└────────────────────────────────────┼───────────────────────────────────────────────────┘
                                     │ Encrypted Cloudflare Tunnel (cloudflared)
                                     │ (Zero open inbound ports on Hetzner!)
                                     ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ CLOUD RELAY NODE (e.g., Hetzner Cloud VPS)                                            │
│                                                                                        │
│   ┌─────────────────────────────────────────────────────────────────┐                  │
│   │ Stigix Relay Service (Container or Process listening on 8090)   │                  │
│   │ - HTTP / WebSocket multiplexer & virtual router                 │                  │
│   │ - Ephemeral session registry & token authenticator              │                  │
│   │ - Read-Only inspection filter (blocks mutating POST/PUT/DELETE) │                  │
│   └────────────────────────────────▲────────────────────────────────┘                  │
└────────────────────────────────────┼───────────────────────────────────────────────────┘
                                     │
                                     │ Outbound Persistent WSS Tunnel (Port 443)
                                     │ Initiated from Lab via Cloudflare Edge
                                     │ Heartbeat Ping/Pong every 30s
                                     │
┌────────────────────────────────────┼───────────────────────────────────────────────────┐
│ PRIVATE ON-PREMISES LAB / DATACENTER (DC1 / Home Lab / VMware)                         │
│                                                                                        │
│   [ Strict Corporate Firewall / NAT Gateway (0 Inbound Ports Open) ]                   │
│          │                                                                             │
│          ▼                                                                             │
│   ┌─────────────────────────────────────────────────────────────────┐                  │
│   │ Stigix Leader Node (DC1-Ubuntu:8080)                            │                  │
│   │ - Executes traffic generation, mesh orchestration, and telemetry│                  │
│   │ - Outbound Tunnel Client establishes reverse WebSocket          │                  │
│   │ - Internal Express server serves local requests over WS pipe    │                  │
│   └─────────────────────────────────────────────────────────────────┘                  │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

### Key Architectural Tenets
- **Zero Inbound Ports Anywhere**: Neither the On-Premises Leader nor the Hetzner Cloud server exposes public ports directly to the Internet. Hetzner connects via an outbound `cloudflared` daemon; the private Leader connects via an outbound `wss://` connection through Cloudflare.
- **Hidden Infrastructure IP**: Attackers scanning IPv4 ranges can never discover the IP address of the Hetzner relay or the on-premise Stigix server.
- **Enterprise Firewall Transparency**: The outbound connection uses standard TLS port 443 with standard HTTP `Upgrade: websocket` headers, passing transparently through Deep Packet Inspection (DPI) proxies.
- **Zero Cloud Cost Surcharge**: Runs entirely over the existing free Cloudflare Tunnel and existing Hetzner compute, avoiding costly Cloudflare Worker Durable Object request fees.

---

## 3. Core Functional Modes

### 3.1 Mode 1: Ephemeral "Magic Share" Links (On-Demand)

Designed for sales engineers, security analysts, and consultants conducting live customer demonstrations or proof-of-concept (POC) walkthroughs.

1. **1-Click Generation**: Inside the Stigix Dashboard header or Settings, the user clicks **`🔗 Share Live Demo`**.
2. **Session Configuration**:
   - **Lifespan**: `1 hour`, `4 hours`, `24 hours`, or `Custom`.
   - **Access Level**:
     - *Full Admin*: Full interactive control.
     - *Read-Only Demo Mode*: The cloud relay automatically filters out all state-mutating HTTP methods (`POST`, `PUT`, `DELETE`, `PATCH`), preventing guests from resetting configs, rebooting nodes, or stopping traffic tests while still allowing full exploration of the topology, metrics, and logs.
   - **Protection**: Optional 6-digit PIN or passphrase required before access.
3. **Session Lifecycle**:
   - A unique URL is generated: `https://share.stigix.io/s/demo-7f8a9b`.
   - The private Leader connects to the relay with the generated session ID.
   - A floating status bar on the private Leader displays active viewers, session timer, and an instant **`Disconnect Now`** button.
   - When revoked or expired, the WebSocket is immediately closed, and visitors receive a polished dark-mode landing screen: *"This Stigix demo session has ended."*

### 3.2 Mode 2: Permanent Zero-Inbound Remote Management

Designed for remote engineers who want 24/7 web access to their primary on-premises laboratory without VPNs, dynamic DNS, or port forwarding.

1. **Persistent Daemon Mode**: The Leader is configured with persistent relay credentials via environment variables (`STIGIX_RELAY_URL` and `STIGIX_RELAY_KEY`).
2. **Dedicated Subdomain Routing**: The relay maps a dedicated hostname (e.g., `https://sdwan-lab.stigix.io`) directly to the private Leader.
3. **Auto-Reconnection & Self-Healing**: If the laboratory network disconnects (ISP blip, router reload), the outbound client uses exponential backoff to re-establish the tunnel within 5 seconds of network restoration.
4. **Native Authentication**: Visitors encounter the standard Stigix authentication screen (JWT/Session). All authentication tokens are verified by the on-premise node; the cloud relay never stores user passwords or private keys.

---

## 4. Technical Implementation Specification

### 4.1 Multiplexed HTTP-over-WebSocket Protocol (`StigixTunnel`)

Because a single TCP/WebSocket connection transports dozens of simultaneous browser requests (HTML, JS chunks, API calls, and nested telemetry WebSockets), the tunnel protocol implements a lightweight binary/JSON multiplexing frame format.

#### Frame Types
- `REQ` (Client -> Leader): Represents an incoming HTTP request from the visitor.
- `RES_HEAD` (Leader -> Relay): Contains HTTP status code and response headers.
- `RES_BODY` (Leader -> Relay): Data chunk for the response payload (streamed).
- `RES_END` (Leader -> Relay): Signals completion of the response stream.
- `PING` / `PONG` (Bidirectional): Keepalive frame exchanged every 30 seconds to bypass Cloudflare's 100-second idle connection timeout.

#### Message Payload Format
```typescript
interface TunnelRequestFrame {
    type: 'REQ';
    id: string; // Unique UUID per HTTP transaction
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
    path: string; // e.g., /api/targets/status
    headers: Record<string, string>;
    body?: string; // Base64-encoded or raw UTF-8 string
}

interface TunnelResponseHeadFrame {
    type: 'RES_HEAD';
    id: string;
    status: number;
    headers: Record<string, string>;
}

interface TunnelResponseBodyFrame {
    type: 'RES_BODY';
    id: string;
    chunk: string; // Base64-encoded binary chunk or string
}

interface TunnelResponseEndFrame {
    type: 'RES_END';
    id: string;
}
```

### 4.2 Edge Optimization & Caching Strategy

To ensure lightning-fast dashboard loading over potentially constrained laboratory WAN links:
1. **Edge Cache for Static Assets**: Vite build assets (`/assets/*.js`, `/assets/*.css`, images, fonts) are served with `Cache-Control: public, max-age=31536000, immutable`. Cloudflare caches these at the nearest edge PoP. The visitor loads 95% of the page weight directly from Cloudflare's Edge; only dynamic API calls (`/api/*`) transit the private laboratory tunnel.
2. **Gzip / Brotli Compression**: The Stigix Leader compresses payloads prior to framing over the WebSocket, minimizing tunnel bandwidth utilization.
3. **Streaming Backpressure**: If a visitor downloads a large PCAP trace (`/api/pcap/download`), the tunnel implements windowed backpressure to prevent buffer bloat in memory.

---

## 5. Security & Governance Architecture

| Security Threat | Mitigation Strategy |
|---|---|
| **Man-in-the-Middle (MitM)** | End-to-end TLS encryption enforced across both legs (Visitor -> Cloudflare -> Hetzner, and Leader -> Cloudflare -> Hetzner). |
| **Relay Impersonation / Hijacking** | Mutual authentication using pre-shared cryptographically secure pairing keys (`STIGIX_RELAY_KEY` / HMAC signature). Unauthorized instances cannot bind to public slugs. |
| **Data / Credential Leakage** | The Relay node functions as a pure stream forwarder in RAM. No databases, PCAP traces, Prisma SASE tokens, or local credentials are saved to disk on Hetzner. |
| **Malicious Modification in Demos** | Enforced **Read-Only Mode** at the Relay proxy layer: Any mutating request (`POST /api/settings`, `DELETE /api/targets`) is rejected immediately at the relay with `403 Forbidden` before reaching the private lab. |
| **DDoS / Brute Force** | Cloudflare WAF and Rate Limiting front the public URL, neutralizing volumetric attacks before they reach Hetzner or the on-premise laboratory. |

---

## 6. Configuration & Deployment Blueprint

### 6.1 Relay Node Configuration (Hetzner Cloud)

The relay capability can be built directly into the standard Stigix container using a lightweight mode flag:

```yaml
# docker-compose.yml on Hetzner
services:
  stigix-relay:
    image: jsuzanne/stigix:latest
    container_name: stigix-relay
    restart: unless-stopped
    environment:
      - STIGIX_ROLE=relay
      - STIGIX_RELAY_PORT=8090
      - STIGIX_RELAY_SECRET=your-secure-master-relay-secret
      - STIGIX_RELAY_DOMAIN=share.stigix.io
    ports:
      - "127.0.0.1:8090:8090" # Exposed only to localhost for cloudflared
```

### 6.2 Cloudflare Tunnel (`cloudflared`) Routing (Hetzner)

Add a public hostname route in Cloudflare Zero Trust:
- **Public Hostname**: `share.stigix.io`
- **Service Type**: `HTTP`
- **URL**: `localhost:8090`
- **WebSocket**: Enabled

### 6.3 Private Leader Configuration (On-Premises Lab)

```yaml
# docker-compose.yml on DC1-Ubuntu
services:
  stigix:
    image: jsuzanne/stigix:latest
    container_name: stigix
    restart: unless-stopped
    environment:
      - STIGIX_REGISTRY_MODE=leader
      # Optional: Enable permanent relay remote access on startup
      - STIGIX_RELAY_ENABLED=true
      - STIGIX_RELAY_URL=wss://share.stigix.io/tunnel
      - STIGIX_RELAY_SECRET=your-secure-master-relay-secret
      - STIGIX_RELAY_SLUG=dc1-lab # Optional custom persistent alias
```

---

## 7. Advanced Innovation Concepts (Future Roadmap)

### 7.1 Concept A: Real-Time Collaborative Canvas ("Figma-Style Demo Mode")
When sharing a live demo with customers:
- Multiple remote visitors can view the Topology canvas simultaneously.
- The presenter's mouse cursor and active selections (e.g., highlighting the MPLS circuit or inspecting BR8) can be broadcast in real-time to all connected viewers.
- Gives sales engineers a seamless virtual presentation experience without screen-sharing lag or compression artifacts.

### 7.2 Concept B: AI Copilot Guest Sandbox
- Remote viewers on a demo link can interact with the embedded **Stigix AI Copilot** in guest mode.
- Guests can ask: *"Show me the current packet loss on Branch 8"* or *"Explain the failover convergence time"*.
- The AI Copilot operates within strict read-only constraints, answering architectural and telemetry questions using live data while safeguarding administrative controls.

### 7.3 Concept C: Audit Logging & Replay for Security Demos
- When running live threat simulations (e.g., EICAR, DNS tunneling, C2 beacons), the relay can optionally log an immutable timeline of tests triggered during the session.
- Allows participants to download a comprehensive PDF report immediately following the demo session.

---

## 8. Development Phases & Milestones

| Phase | Milestone | Deliverables |
|---|---|---|
| **Phase 1** | **Core Relay Engine** | Build `StigixRelayServer` (Hetzner) and `StigixTunnelClient` (Leader) with multiplexed HTTP-over-WebSocket framing and heartbeat ping/pong. |
| **Phase 2** | **Ephemeral Magic Links UI** | Add `Share Session` modal in `Settings.tsx` with customizable TTL, Read-Only demo toggle, PIN generator, and 1-click revocation. |
| **Phase 3** | **Read-Only Inspection Filter** | Implement middleware on the relay to intercept and enforce safe GET-only access when in Demo mode. |
| **Phase 4** | **Permanent Daemon Access** | Add persistent auto-reconnecting remote access daemon with custom subdomain/slug routing. |
| **Phase 5** | **Edge Caching & Polish** | Configure Cloudflare Edge cache headers for Vite assets and integrate collaborative visitor counter in header. |

---

## 📜 Revision History

| Date | Stigix Version | Author / Trigger | Summary of Changes |
|---|---|---|---|
| 2026-10-10 | `v2.2.8` | Stigix Engineering Team | Initial document creation: Zero-inbound outbound reverse relay architecture, Cloudflare tunnel integration, ephemeral magic share links, and read-only demo sandboxing. |
