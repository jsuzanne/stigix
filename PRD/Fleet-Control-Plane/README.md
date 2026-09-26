# 🚀 Stigix Fleet & Multi-Instance Control Plane — Executive Summary

**Last Updated:** 2026-09-26  
**Creation Date:** 2026-09-26  
**Author:** jsuzanne  
**Status:** Living Architecture & Specification Hub  
**Target Release:** Stigix v2.1 – v2.2  

---

## 1. Executive Overview

### The Problem
In multi-branch SD-WAN / SASE validation labs, operators run multiple Stigix instances (e.g. `DC1`, `DC2`, `BR1`, `BR2`, `BR5`, `BR8`). Until now:
* Every node operated as a completely isolated silo with its own IP and port.
* Correlating a failover test required opening **8 browser tabs**, logging into each independently, and manually triggering tests.
* Remote branches behind carrier NAT, branch routers, or 4G/5G connections could not be reached inbound.

### The Solution: Stigix Fleet Control Plane
**Fleet** transforms Stigix into a unified distributed validation platform managed from a single central **Leader** instance (e.g., `DC1`), while preserving **100% autonomy** for every remote node:
1. **Single Pane of Glass (Phase 3A):** View health, live TX/RX traffic balance, VoIP MOS scores, connectivity probes, and config revisions for all nodes in one central table.
2. **Synchronized Remote Action Engine (Phase 3B):** Trigger tests across multiple peers with zero-drift synchronization (`start_at`), guaranteed delivery via a **3-Tier ACK Pull-mode**, and fast failure detection (`STALLED`).
3. **Dedicated Performance & Security Suites (Phase 3C):** Multi-stream **XFR speedtests on Port 9000** with Receiver-First orchestration, and modular security test suites (URL Filtering, DNS Security, EICAR AV) with SASE correlation IDs.
4. **Peer Context Switching & Reverse WebSocket Gateway (Phase 3D):** Switch active dashboard context to any remote spoke **without changing browser URL**, using an authenticated Leader reverse-proxy and universal outbound WebSocket tunnels.

---

## 2. Master Roadmap & Phasing

```text
 ┌────────────────────────────────────────────────────────────────────────────────────────┐
 │ PHASE 1: Direct Controller & Local Registry                                           │
 │ • Stable Node Identity & Heartbeat   • Local DB Registry (No Cloudflare dependency)   │
 └────────────────────────────────────────┬───────────────────────────────────────────────┘
                                          │
 ┌────────────────────────────────────────▼───────────────────────────────────────────────┐
 │ PHASE 2: Global Configuration Provisioning                                            │
 │ • Leader-published config bundles    • Peer pull distribution & local overrides surviving│
 └────────────────────────────────────────┬───────────────────────────────────────────────┘
                                          │
 ┌────────────────────────────────────────▼───────────────────────────────────────────────┐
 │ PHASE 3A: Fleet Inventory & Observability (Read-Only)                                 │
 │ • Enriched Heartbeat Telemetry       • Live Bidirectional Traffic Balance (▲ TX / ▼ RX)│
 │ • Consolidated VoIP MOS & Probes     • Offline Node Last-Known-State Tracking         │
 └────────────────────────────────────────┬───────────────────────────────────────────────┘
                                          │
 ┌────────────────────────────────────────▼───────────────────────────────────────────────┐
 │ PHASE 3B: Asynchronous Remote Action Orchestration (Pull-Mode)                        │
 │ • 3-Tier ACK Architecture            • Synchronized "start_at" Multi-Node Scheduling  │
 │ • Adaptive Fast-Polling (3s-5s)      • Fast Failure Sentinel (STALLED in 15s)         │
 └────────────────────────────────────────┬───────────────────────────────────────────────┘
                                          │
 ┌────────────────────────────────────────▼───────────────────────────────────────────────┐
 │ PHASE 3C: Advanced Performance & Security Campaigns                                   │
 │ • Native XFR on Port 9000 (Receiver-First) • Modular Security Suites (SWG/DNS/EICAR)   │
 │ • SASE Log Correlation IDs (UUID)    • Path-Aware Telemetry Schemas                   │
 └────────────────────────────────────────┬───────────────────────────────────────────────┘
                                          │
 ┌────────────────────────────────────────▼───────────────────────────────────────────────┐
 │ PHASE 3D: Fleet Management Gateway & Peer Context Switching                           │
 │ • Navbar Site Switcher (?context=BR8) • Leader BFF Authenticated Reverse Proxy        │
 │ • Zero-Port-Forward Universal Reverse WebSocket Tunnels for NAT/4G Branches           │
 └────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Core Architectural Contracts

1. **Pull-Over-Push Invariant:**
   Remote branches are located behind stateful corporate firewalls, NAT, and SD-WAN CPEs. Inbound HTTPS connections from the controller are fundamentally unreliable across disparate topologies. Therefore, **the peer always contacts the controller in outbound HTTPS**, pulling jobs and pushing sanitized telemetry.
2. **Local Peer Autonomy:**
   If the Leader controller becomes unreachable or is taken down for maintenance, every spoke node continues to run its traffic generators, execute local probes, record historical telemetry, and maintain its active configurations undisturbed.
3. **Off-Path Controller Posture:**
   The control plane instance is purely a management plane entity. It does not need to sit in the data path, carry customer payloads, or be directly reachable by test traffic.
4. **Idempotency & Guardrails:**
   Every dispatched job carries a unique idempotency key. A repeated delivery returns the cached execution result rather than re-running tests. High-impact operations (stopping traffic across multiple nodes, executing network-changing sequences) strictly require interactive operator confirmation.

---

## 4. Job State Machine & 3-Tier ACK Lifecycle

```text
  Leader Controller (DC1)                                    Remote Spoke (BR8)
         │                                                            │
  [Create Job: PENDING]                                               │
  (start_at = now + 45s)                                              │
         │                                                            │
         │◄────────────── Periodic Polling (every 30s) ───────────────│
         │─────────────── Transmits Job Manifest ────────────────────►│
         │                                                            │
         │   [TIER 1 ACK: CLAIM & READINESS VALIDATION]               │
         │◄── POST /api/fleet/peer-jobs/:id/ack ──────────────────────│
         │    status: "CLAIMED", ntp_synced: true, clock_offset_ms: 3 │ (Checks port 9000,
  [State: CLAIMED / SCHEDULED]                                        │  binaries, NTP drift)
  (UI: ⏳ Scheduled for T0)                                           │
         │                                                            │
         │                                               [Local clock reaches start_at]
         │                                               [Process launches]
         │                                               [Peer switches to Fast-Polling 3-5s]
         │                                                            │
         │   [TIER 2 ACK: PROGRESS HEARTBEATS]                        │
         │◄── POST /api/fleet/peer-jobs/:id/progress ─────────────────│
  [State: RUNNING]   status: "RUNNING", progress_pct: 45              │
  (UI: ▶ Active + live metrics streaming)                             │
         │                                                            │
         │ *IF NO HEARTBEAT FOR > 15s*                                │
         │ → UI flags: ⚠️ STALLED (instant drop alert)               │
         │                                                            │
         │                                               [Process completes]
         │   [TIER 3 ACK: SANITIZED FINAL OUTCOME]                    │
         │◄── POST /api/fleet/peer-jobs/:id/result ───────────────────│
         │    status: "COMPLETED", exit_code: 0, metrics payload      │
  [State: COMPLETED]                                                  │ [Peer returns to 30s poll]
  (UI: ✅ Detailed Telemetry Modal Available)                          │
```

---

## 5. Specification Directory Navigation

All detailed engineering specifications, wireframes, and architectural audits for the Fleet project are organized within this repository:

| Document | Description |
|---|---|
| 📄 **[01_PHASE_1_DIRECT_CONTROLLER_PEER_INSTALLATION.md](01_PHASE_1_DIRECT_CONTROLLER_PEER_INSTALLATION.md)** | Phase 1: One-line direct installation, local registry, presence model without Cloudflare. |
| 📄 **[02_PHASE_2_GLOBAL_CONFIGURATION_PROVISIONING.md](02_PHASE_2_GLOBAL_CONFIGURATION_PROVISIONING.md)** | Phase 2: Configuration bundles, leader publishing, peer pulling, local override protection. |
| 📄 **[03_PHASE_3_CONTROL_PLANE_SPECIFICATION.md](03_PHASE_3_CONTROL_PLANE_SPECIFICATION.md)** | **Main Specification (v0.5):** Complete architecture for Phases 3A, 3B, 3C with 3-tier ACK, STALLED detection, port 9000 XFR, and telemetry return schemas. |
| 📄 **[04_PHASE_3_VISUAL_GUIDE.md](04_PHASE_3_VISUAL_GUIDE.md)** | Wireframes and visual guide: Fleet Overview (TX/RX), Action confirmation, countdown timer, and Job Result modal. |
| 📄 **[05_PHASE_3D_FLEET_GATEWAY_CONTEXT_SWITCHING.md](05_PHASE_3D_FLEET_GATEWAY_CONTEXT_SWITCHING.md)** | Phase 3D: Peer Context Switcher in navbar (`?context=BR8`), BFF reverse-proxy, and outbound WebSocket Reverse Tunnel. |
| 📄 **[06_ARCHITECTURAL_REVIEW.md](06_ARCHITECTURAL_REVIEW.md)** | Independent Staff Architect review: failure modes, NTP drift, failover resiliency, and prioritized mitigations. |
| 📄 **[07_ROADMAP_PA_ENGINEERING.md](07_ROADMAP_PA_ENGINEERING.md)** | Multi-Instance engineering roadmap and high-level milestones. |

---

## 6. Implementation Readiness Checklist

- [x] Phase 1 (Direct Controller & Registry) — Implemented and validated in Lab.
- [x] Phase 2 (Global Provisioning) — Implemented and active.
- [x] Phase 3A (Fleet Observability UI & Backend) — Implemented on `v2` (Overview table, capability dots, metrics).
- [ ] Phase 3B (Remote Action Store & Peer Job Polling) — Spec v0.5 ready for development.
- [ ] Phase 3C (XFR Port 9000 & Security Test Suites) — Spec v0.5 ready.
- [ ] Phase 3D (Fleet Gateway & Reverse WebSocket Tunnel) — Spec v0.1 ready.
