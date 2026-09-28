> **Last Updated:** 2026-09-28 | **Created:** 2026-09-28 (v2.0.73)

# Remote View — Operator Guide

## What Is Remote View?

Remote View allows an operator connected to a **Leader node** (e.g. DC1) to observe and control a remote **peer node** (e.g. BR8) directly from the Leader's dashboard — without opening a second browser tab or logging into BR8 separately.

All dashboard actions (reads and writes) are transparently routed through the Leader's gateway to the selected peer. The experience is equivalent to being directly connected to that peer.

---

## Prerequisites

- Your Stigix node must be in **Leader mode** (`LEADER` badge visible in the header).
- The target peer must be **registered** in the Leader's registry (auto-discovery or manual).
- The target peer must be **network-reachable** from the Leader (direct HTTP on the configured port).

---

## Activating Remote View

1. Click the **peer selector dropdown** in the top-right area of the header (next to the Health badge).
2. Select the peer you want to manage (e.g. `BR8-Ubuntu`).
3. The dashboard immediately switches to Remote View mode.

> **Tip:** Peers shown with a red `UNREACHABLE` badge are offline or blocked by the network. Selecting them is disabled to prevent silent empty states.

---

## Visual Indicators

When Remote View is active, two indicators are shown simultaneously:

| Indicator | Description |
|---|---|
| **Amber chip** (top-right navbar) | Shows the peer IP or name. Click **✕** to exit Remote View. Includes a pulsing globe icon. |
| **Amber inset border** | A subtle 2 px amber frame around the entire viewport. Zero layout shift — no content is displaced. |

Both indicators disappear immediately when you exit Remote View.

---

## What Works in Remote View

All standard dashboard features are fully operational against the remote peer:

| Feature | Read | Write / Action |
|---|---|---|
| **Digital Experience** (DX score, probes, latency) | ✅ | — |
| **Traffic Generator** (stats, volume chart) | ✅ | ✅ Start / Stop |
| **Bandwidth Test (Speedtest)** | ✅ History + live stream | ✅ Run test, delete, purge |
| **Security** (posture, URL/DNS/threat tests) | ✅ | ✅ Run batch tests |
| **IoT** (device list, bad-behavior, settings) | ✅ | ✅ Manage devices |
| **Voice** (config, ingress status) | ✅ | ✅ Start / Stop simulation |
| **Custom TCP Apps** (operational view) | ✅ | ✅ Start/Stop listener & client |
| **Custom TCP Apps** (settings / parameters) | ✅ | ✅ Edit parameters (hot-applied instantly) |
| **Failover Monitoring** | ✅ | — |
| **Topology** | ✅ | — |
| **VyOS Control** | ✅ | ✅ Run sequences |
| **Settings** (config, thresholds) | ✅ (30 s poll) | ✅ Save changes |
| **Settings — System tab** (hostname, uptime) | ✅ | — |

---

## Refresh Behavior

Remote View data is kept current through automatic polling:

| Data type | Refresh rate |
|---|---|
| Convergence / Voice / Traffic status | Every 3 s |
| System dashboard data (stats, status) | Every 10 s |
| Traffic volume history | Every 60 s |
| Settings (config, thresholds, interfaces) | Every 30 s |
| Custom Apps — listener/client state | Every 1.5 s |

Configuration edits you submit are **applied immediately** on the peer — the backend receives and hot-applies the change at once. The Settings UI on the peer's own dashboard will reflect the update within 30 s (its own polling cycle).

---

## Known Limitations

| Feature | Status | Notes |
|---|---|---|
| **IoT Real-time Log Stream** | ⚠️ Not available | SSE stream not yet proxied via gateway. REST polling fallback planned. |
| **Network Status** (GW IP, Public IP) | ⚠️ Shows Leader data | These fields are read from the local system, not the peer. |
| **Traffic history range selector** | ⚠️ Fixed to 1 h | Range changes are not yet forwarded to the PeerStatusSync loop. |

---

## Exiting Remote View

Click the **✕** button on the amber chip in the navbar. The dashboard instantly switches back to the Leader's own data.

---

## 📜 Revision History

| Date | Stigix Version | Author / Trigger | Summary of Changes |
|---|---|---|---|
| 2026-09-28 | `v2.0.73` | Stigix Core Team / Antigravity | Initial document creation — Remote View operator guide |
