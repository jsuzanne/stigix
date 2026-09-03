# 🌐 Underlay Topology — VyOS Physical Infrastructure & WAN Next-Hop Mapping

## Overview

The **Underlay Topology** feature bridges the SD-WAN logical overlay (Prisma SD-WAN) and the underlying physical routing layer (VyOS routers) with direct, interactive visualization on the topology canvas. 

It provides network operators with end-to-end visibility:
1. **Overlay View**: Logical VPN tunnels between Prisma SD-WAN sites traversing provider clouds (Internet / MPLS).
2. **Physical Underlay View**: Real physical port-to-port cable termination between Prisma ION appliances and VyOS backbone router chassis (`ethX` ports), with live link status, full IP CIDR visibility, and transit subnet diagnostics.

All resolutions rely on **strict same-subnet IPv4/CIDR matching** via `ipaddr.js` — zero heuristics, zero name inference, and zero credential exposure.

---

## 🏗️ Architecture & Visualization

```
 ┌────────────────────────────────────────────────────────────────────────┐
 │                      TOP TIER: DATA CENTERS & HUBS                     │
 │          [ DC1 (ION) ]                  [ DC2 (ION) ]                  │
 │      [DC1-INET]  [DC1-MPLS]         [DC2-INET]  [DC2-MPLS]             │
 └──────────┬────────────┬─────────────────────┬────────────┬─────────────┘
            │            │                     │            │
            │ Direct 1:1 │ Port Cable          │ Direct 1:1 │ Port Cable
            ▼            ▼                     ▼            ▼
 ┌────────────────────────────────────────────────────────────────────────┐
 │                      VYOS ROUTER PHYSICAL CHASSIS                      │
 │  ▲ DC & HUB UPLINKS (4)                                                │
 │   ┌───────────────┐ ┌───────────────┐ ┌───────────────┐ ┌───────────┐  │
 │   │ 🟢 eth10  DC1 │ │ 🟢 eth11  DC1 │ │ 🟢 eth12  DC2 │ │ 🟢 eth13DC2 │ │
 │   │ 192.168.221.254│ │ 192.168.191.254│ │ 192.168.222.254│ │ 192.168...│ │
 │   │ DC1-INET-221  │ │ DC1-MPLS-191  │ │ DC2-INET-222  │ │ DC2-MPLS-192││
 │   └───────▲───────┘ └───────▲───────┘ └───────▲───────┘ └─────▲─────┘  │
 │           │                 │                 │               │        │
 │  ════════════════════════════════════════════════════════════════════  │
 │   🖧 [VYOS-CORE-01]   🟢 ONLINE   Mgmt: 192.168.122.254   14 Circuits  │
 │  ════════════════════════════════════════════════════════════════════  │
 │           │                 │                 │               │        │
 │   ┌───────▼───────┐ ┌───────▼───────┐ ┌───────▼───────┐ ┌─────▼─────┐  │
 │   │ 🟢 eth3   BR1 │ │ 🟢 eth1   BR1 │ │ 🟢 eth7   BR2 │ │ 🟢 eth8BR2 │ │
 │   │ 192.168.227.254│ │ 192.168.197.254│ │ 192.168.226.254│ │ 192.168...│ │
 │   │ BR1-INET-227  │ │ BR1-MPLS-197  │ │ BR2-INET-226  │ │ BR2-MPLS-196││
 │   └───────────────┘ └───────────────┘ └───────────────┘ └───────────┘  │
 │  ▼ BRANCH & SPOKE DOWNLINKS (6)                                        │
 └──────────┬────────────┬─────────────────────┬────────────┬─────────────┘
            ▲            ▲                     ▲            ▲
            │ Direct 1:1 │ Port Cable          │ Direct 1:1 │ Port Cable
            │            │                     │            │
 ┌──────────┴────────────┴─────────────────────┴────────────┴─────────────┐
 │       [BR1-INET]  [BR1-MPLS]         [BR2-INET]  [BR2-MPLS]            │
 │          [ BRANCH 1 (ION) ]             [ BRANCH 2 (ION) ]             │
 │                    BOTTOM TIER: BRANCHES & SPOKES                      │
 └────────────────────────────────────────────────────────────────────────┘
```

---

## ⚡ Key Features

### 1. Dedicated Multi-Router Physical Chassis Node (`VyOSRouterNode`)
- **Active Router Filtering**: Only VyOS routers with active, matched WAN circuits are rendered on the canvas. Management-only and LAN-only routers are cleanly filtered out.
- **Top Row (DC & Hub Uplinks)**: Groups ports connected to top-tier Data Center sites.
- **Center Chassis Banner**: Displays the router name, management IP address, online/offline status, and total active circuit counter.
- **Bottom Row (Branch & Spoke Downlinks)**: Groups ports connected to bottom-tier Branch and Spoke sites.
- **Full IP/CIDR Visibility**: Every port chip displays the port identifier (`ethX`), live status LED, connected site badge, full IP CIDR (e.g. `192.168.221.254/24`), and port description.

### 2. Direct 1:1 Port-to-Port Cable Wiring
- Each physical port chip on the VyOS chassis features a dedicated React Flow Handle (`vyos-port:ethX`).
- Cables draw direct, animated amber connections from the individual Prisma SD-WAN WAN interface block down (or up) to the precise physical `ethX` port chip on the VyOS router.

### 3. Anti-Cable-Crossing Spatial Alignment
- To avoid tangled, crossing cables, ports on both the top and bottom rows of the VyOS router are sorted dynamically:
  1. Primary sort: Horizontal X-coordinate of the connected site (left-to-right alignment matching DC1, DC2, BR1, BR2, BR3).
  2. Secondary sort: Interface link type (`INET` before `MPLS`).
- The resulting cable layout runs straight, parallel, and clean across the canvas.

### 4. Interactive Floating Link Trace Inspector
- Clicking any port chip or underlay cable triggers a floating **Link Trace Inspector** drawer with side-by-side verification:
  - **Prisma SD-WAN (ION)**: Element Name, Site, Circuit Label, Link Type, ION IPv4.
  - **Transit Subnet**: Matched same-subnet CIDR network.
  - **VyOS Underlay Router**: Interface Name, Description, Next-Hop IP, Port Status.
- Includes a **Full Inspect** button to open the comprehensive underlay diagnostics side panel.

### 5. Interactive Direct Actions & Chaos Injection
Directly from the floating Link Trace drawer or side panel, operators can control the physical underlay in real time:
- **Shut / No-Shut Port Toggle** 🔴🟢: Disables or enables the physical interface on the VyOS router via write-through API execution. The UI and canvas immediately update the LED status (`🔴 SHUT (DOWN)` vs `🟢 UP`).
- **Inject WAN Impairment (Netem)** 🎛️: Opens a modal with sliders and quick presets for Latency (0–500ms) and Packet Loss (0–50%).
- **Persistent QoS State & Canvas Badges** ⏱️: Configured impairments are stored on the interface and persist across refreshes. The router port chip on the canvas displays an active micro-badge (e.g. `⏱️ +120ms`) and illuminates the **Clear QoS** button.
- **Unified Audit Logging**: Every topology action is logged to VyOS History with a descriptive source tag (e.g., `Topology: DC1 (eth10)`).

### 6. Unmapped & External Circuit Handling
- WAN circuits that do not match a local VyOS router interface are neatly routed to a dedicated `EXTERNAL / UNMAPPED` cloud node.
- The router width is computed dynamically based on interface density, and the External node is positioned with clean spacing on the right.

### 7. Light & Dark Mode Support
- Seamless, high-contrast theme support:
  - **Dark Mode**: Sleek dark slate surfaces, glowing amber accents, and illuminated status indicators.
  - **Light Mode**: Crisp white card surfaces (`bg-card`), soft gray chassis backgrounds (`bg-card-secondary`), warm amber borders, and dark high-contrast typography.

---

## 🔍 Subnet Matching Algorithm

The matching engine in `underlay-topology-manager.ts` inspects every Prisma WAN interface and evaluates candidate VyOS interfaces:

```
Prisma SD-WAN WAN Interface
    IP: 192.168.190.5 (DHCP) or 192.168.190.1/24 (static)
         │
         ▼
  UnderlayTopologyManager.resolveAll()
         │
         ▼  For each enabled VyOS interface with static IPv4:
     "Does the Prisma WAN IP belong to this VyOS subnet?"
     ipaddr.js matchCIDR(hostIp, vyosNetwork)
         │
    ┌────┴─────────────────────────┐
    │                              │
Unique match             0 or 2+ matches
 → 'matched'          → 'no_match' or 'ambiguous'
```

### Resolution Statuses

| Status | Canvas Representation | Meaning |
|--------|-----------------------|---------|
| `matched` | 🟢 Amber animated cable to `ethX` | Unique VyOS interface found in the same subnet |
| `no_match` | ⬜ Dashed cable to External Cloud | No enabled VyOS interface belongs to this subnet |
| `ambiguous` | 🟡 Warning badge | Multiple candidate VyOS interfaces match |
| `wan_ip_unavailable` | ❓ Dashed cable to External Cloud | Prisma WAN has no usable IPv4 address (DHCP lease pending) |
| `vyos_unavailable` | ⚠️ Alert | VyOS configuration file is unavailable or unreadable |

---

## 🔒 Security & Isolation Model

- **Zero Credential Exposure**: `apiKey`, passwords, and authentication tokens are stripped server-side and never sent to the browser.
- **Server-Side Matching**: All CIDR matching is performed inside `UnderlayTopologyManager` before serialization.
- **No Name Heuristics**: MPLS, INET, interface names, and site tags are never used to infer connectivity. Only deterministic IP math is used.

---

## 📊 API Reference

The underlay data is automatically embedded in the standard topology response:

`GET /api/topology`

```json
{
  "sites": [...],
  "underlay": {
    "available": true,
    "vyosConfigAvailable": true,
    "summary": {
      "wanInterfacesSeen": 14,
      "matched": 10,
      "noMatch": 2,
      "ambiguous": 0,
      "wanIpUnavailable": 2
    },
    "routers": [
      {
        "id": "vyos-core-01",
        "name": "VYOS-CORE-01",
        "host": "192.168.122.254",
        "location": "Core Datacenter Backbone",
        "status": "up",
        "interfaces": [
          {
            "name": "eth10",
            "description": "DC1-INET-221",
            "address": ["192.168.221.254/24"],
            "status": "up"
          }
        ]
      }
    ],
    "resolutions": [
      {
        "id": "dc1-ion-wan1",
        "status": "matched",
        "prismaWan": {
          "elementName": "ION-DC1",
          "siteName": "DC1",
          "interfaceName": "DC1-INET",
          "ipCidr": "192.168.221.1/24",
          "linkType": "INET"
        },
        "vyos": {
          "routerId": "vyos-core-01",
          "routerName": "VYOS-CORE-01",
          "interfaceName": "eth10",
          "description": "DC1-INET-221",
          "ipCidr": "192.168.221.254/24",
          "ip": "192.168.221.254",
          "network": "192.168.221.0/24",
          "routerStatus": "up"
        },
        "matchMethod": "same_subnet",
        "matchedNetwork": "192.168.221.0/24"
      }
    ]
  }
}
```

---

## 🧪 Testing & Verification

```bash
# 1. Verify TypeScript types and frontend build
cd web-dashboard
npm run build

# 2. Inspect API underlay payload
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:8080/api/topology | \
  python3 -m json.tool | grep -A 25 '"underlay"'
```
