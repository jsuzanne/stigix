# Underlay Topology — VyOS WAN Next-Hop Inspection

## Purpose

The **Underlay Details** feature enables operators to inspect which VyOS router interface serves as the WAN next-hop for each Prisma SD-WAN circuit. It bridges the overlay (Prisma SD-WAN) and underlay (VyOS) layers via strict IPv4/CIDR matching — no name inference, no heuristics.

---

## How It Works

```
Prisma SD-WAN WAN Interface
    IP: 192.168.190.5 (DHCP) or 192.168.190.1/24 (static)
         │
         ▼
  UnderlayTopologyManager.resolveAll()
         │
         ▼  For each VyOS interface with a static IPv4 address:
     "Does the Prisma WAN IP belong to this VyOS network?"
     ipaddr.js matchCIDR(hostIp, vyosNetwork)
         │
    ┌────┴─────────────────────────┐
    │                              │
Unique match             0 or 2+ matches
 → 'matched'          → 'no_match' or 'ambiguous'
```

### Matching Rule (v1 — Unique Same-Subnet)

A resolution is `matched` **only if** exactly one enabled VyOS interface has a network containing the Prisma WAN IP. All IP operations use `ipaddr.js` — never string operations.

### DHCP Support

- **Prisma static**: `wan_network_cidr = "192.168.190.0/24"` → full CIDR matching
- **Prisma DHCP (with CIDR from operational status)**: `getflow.py` now preserves the prefix when the Prisma API returns `"192.168.190.5/24"` → treated as static
- **Prisma DHCP (IP only)**: `wan_ip_only = "192.168.190.5"` without prefix → resolver checks if that IP belongs to any VyOS network → the VyOS CIDR acts as the reference

---

## Resolution Statuses

| Status | Meaning |
|--------|---------|
| `matched` | Unique VyOS interface found in the same subnet |
| `no_match` | No enabled VyOS interface is in the same subnet |
| `ambiguous` | More than one VyOS interface matches (no link drawn) |
| `wan_ip_unavailable` | Prisma WAN has no usable IPv4 (DHCP pending, PPPoE pending) |
| `vyos_unavailable` | VyOS config not found or unreadable |

---

## Security Model

- `apiKey` and `host` fields are **never** included in the `/api/topology` response
- `UnderlayTopologyManager` reads and sanitizes `vyos-config.json` internally
- All matching is server-side; the browser only receives resolved IP/CIDR pairs
- No name-based inference: MPLS, INET, site names, or interface descriptions are never used for matching

---

## UI Usage

1. Open the **Topology** page
2. If VyOS routers are configured, the **Underlay** button appears in the top-right toolbar (Layers icon)
3. The button shows `matched/total` count (e.g. `8/12`)
4. Click the button → menu with:
   - **Show underlay badges** — colored circles on each WAN circuit card
   - **Exit underlay mode** — return to normal view
5. **Click any circuit badge** → Underlay Details panel slides in from the right:
   - ✅ `CONFIRMED SAME-SUBNET MATCH` chip (green) for matched circuits
   - ⚠️ Ambiguous list of candidates
   - ❓ Diagnostic message for no-match/unavailable

### Badge Colors

| Color | Meaning |
|-------|---------|
| 🟢 Green | Matched — unique VyOS next-hop identified |
| 🟡 Amber | Ambiguous — multiple candidates |
| ⬜ Slate | No match or IP unavailable |

---

## Data Flow

```
getflow.py --build-topology --json
    → adds wan_ip_cidr, wan_ip_only, wan_network_cidr, wan_ip_type (additive)
    → server.ts: JSON.parse → UnderlayTopologyManager.resolveAll(data)
    → enrichedData = { ...data, underlay: UnderlayPayload }
    → topologyCache stores enrichedData
    → Topology.tsx: data.underlay → setUnderlayData
    → filteredNodes enriches site nodes with underlayResolutionMap
    → SiteNode reads underlayResolutionMap → circuit badges
```

---

## Files

| File | Role |
|------|------|
| `engines/getflow.py` | Adds WAN CIDR normalization + DHCP prefix preservation |
| `web-dashboard/underlay-topology-manager.ts` | Core resolver — ipaddr.js matching, VyOS inventory |
| `web-dashboard/server.ts` | Integrates resolver into `/api/topology` endpoint |
| `web-dashboard/src/Topology.tsx` | Underlay UI — button, badges, detail panel |

---

## Testing

### Unit Tests (when Vitest is set up)
```bash
cd web-dashboard
npx vitest run underlay-topology-manager.test.ts
```

### Manual Verification
```bash
# 1. Check TypeScript
cd web-dashboard && npx tsc --noEmit

# 2. Check build
npm run build

# 3. Check API response (replace TOKEN)
curl -H "Authorization: Bearer $TOKEN" http://localhost:3001/api/topology | \
  python3 -m json.tool | grep -A 20 '"underlay"'
```

### Expected API Response Structure
```json
{
  "sites": [...],
  "underlay": {
    "available": true,
    "vyosConfigAvailable": true,
    "summary": {
      "wanInterfacesSeen": 12,
      "matched": 8,
      "noMatch": 2,
      "ambiguous": 1,
      "wanIpUnavailable": 1
    },
    "resolutions": [
      {
        "id": "site-id-elem-id-wan-id",
        "status": "matched",
        "prismaWan": {
          "elementId": "...",
          "siteName": "DC1",
          "interfaceName": "wan1",
          "ipCidr": "192.168.190.1/24",
          "linkType": "INET-1"
        },
        "vyos": {
          "routerName": "vyos-dc1",
          "interfaceName": "eth1",
          "ipCidr": "192.168.190.254/24",
          "network": "192.168.190.0/24",
          "description": "WAN uplink to ISP"
        },
        "matchMethod": "same_subnet",
        "matchedNetwork": "192.168.190.0/24"
      }
    ]
  }
}
```

---

## Limitations (v1)

- Matching is **single-hop only** (direct same-subnet)
- IPv6 WAN interfaces on VyOS are skipped
- DHCP-assigned VyOS interfaces are not considered (static only on VyOS side)
- No link drawn on the React Flow canvas in v1 (only side panel)
