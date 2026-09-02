# Prompt Google Antigravity — Stigix Underlay Details

You are working in the Stigix repository: `jsuzanne/stigix`.

Your task is to design and implement a safe, progressive **Underlay Details** drill-down for the existing Prisma SD-WAN Topology page.

## Important context

- The existing topology UI is a React / TypeScript React Flow visualization in `web-dashboard/src/Topology.tsx`.
- The backend is Node.js / TypeScript.
- Prisma SD-WAN topology data is collected by `engines/getflow.py`.
- The existing topology command is `getflow.py --build-topology --json`.
- `getflow.py` already queries Prisma SD-WAN elements and VPN link status.
- The current global topology is visually dense: sites, ION devices, WAN circuits, Internet and MPLS providers, plus overlay paths.
- Do **not** permanently add all VyOS routers, interfaces, and underlay links to the global map. It would overload the graph.

## Product goal

Add a progressive-disclosure UX that lets an operator inspect the physical/underlay next hop of a Prisma ION WAN circuit only on demand.

The operator should be able to:

1. Click an ION WAN circuit card, such as `BR1-INET`, `BR1-MPLS`, `DC1-INET`, or `DC1-MPLS`.
2. Or click a new **Underlay** action available from the selected site / selected ION.
3. Enter an **Underlay Details** mode.
4. Automatically zoom and pan to a focused local topology view.
5. See the Prisma WAN interface, its IP/CIDR, the matched VyOS router, the VyOS interface, its IP/CIDR, and its interface description.
6. Return cleanly to the normal global overlay topology.

## Matching rule

A Prisma WAN interface may be linked to a VyOS interface only when the Prisma WAN IPv4 and exactly one active VyOS interface IPv4 belong to the same IPv4 subnet.

Example:

- Prisma ION WAN: `192.168.190.1/24`
- VyOS interface: `vyosrouter / eth0 / 192.168.190.254/24`
- VyOS description: `MPLS190`
- Result: a confirmed underlay match on `192.168.190.0/24`.

## Strict safety rules

- Never infer a relationship from interface names alone.
- Never infer a relationship from labels such as MPLS, INET, WAN, Internet, or site names.
- Never use string-prefix matching for IP addresses.
- Use proper CIDR/IP parsing.
- Draw an underlay edge only for an exact single-candidate same-subnet match.
- If no match exists, display **No VyOS next-hop discovered**.
- If multiple VyOS interfaces match, display **Ambiguous VyOS mapping**; do not draw an edge.
- If Prisma does not expose a usable WAN IPv4/CIDR, display **WAN address unavailable**; do not draw an edge.
- If VyOS configuration is absent, unreadable, disabled, or contains no eligible interfaces, do not alter the normal topology.
- Never send VyOS apiKey, Prisma secrets, credentials, raw config secrets, or sensitive fields to the browser.
- Underlay enrichment must be read-only and must not affect Prisma overlay discovery.

## VyOS configuration

VyOS router configuration already exists in a JSON configuration file with this logical shape:

```json
{
  "routers": [
    {
      "id": "vyosrouter",
      "name": "vyosrouter",
      "host": "192.168.122.254",
      "location": "Vyosrouter underlay",
      "enabled": true,
      "status": "online",
      "interfaces": [
        {
          "name": "eth0",
          "description": "MPLS190",
          "address": ["192.168.190.254/24"]
        }
      ]
    }
  ]
}
```

The real config may also contain:

- interfaces without addresses;
- null descriptions;
- `dhcp` addresses;
- management interfaces;
- disabled routers;
- multiple IPv4 addresses on one interface;
- IPv6 addresses.

For the first version:

- consider only valid static IPv4 CIDR addresses;
- skip `dhcp`, empty, malformed, and IPv6 values;
- include only enabled VyOS routers;
- support multiple valid IPv4 CIDRs per VyOS interface;
- preserve description, router name, router ID, router location, interface name, and interface IP/CIDR;
- never expose apiKey or host management credentials.

## Implementation approach

### 1. Inspect first

Before editing code:

- inspect `web-dashboard/src/Topology.tsx`;
- inspect the backend route/service currently used by Topology;
- inspect `engines/getflow.py` and its `--build-topology` JSON response;
- inspect how VyOS configuration is loaded elsewhere in the app;
- inspect relevant existing TypeScript types and graph node/edge patterns;
- preserve existing visual conventions, themes, icons, state management, and API behavior.

### 2. Prisma WAN data

Extend `getflow.py --build-topology --json` only as needed so that it can return normalized Prisma WAN interface data when available.

Target normalized shape:

```json
{
  "wan_interfaces": [
    {
      "element_id": "prisma-element-id",
      "element_name": "BR1",
      "site_id": "prisma-site-id",
      "site_name": "BR1",
      "interface_id": "wan-interface-id",
      "interface_name": "BR1-MPLS",
      "wan_ip_cidr": "192.168.190.1/24",
      "wan_ip": "192.168.190.1",
      "wan_network": "192.168.190.0/24",
      "used_for": "wan",
      "link_type": "MPLS"
    }
  ]
}
```

Requirements:

- Do not break the existing topology JSON contract.
- Add fields additively.
- If an address is DHCP, unavailable, or unsupported, return `null` / omit the CIDR but preserve the interface identity if possible.
- Keep raw API data out of the browser payload.
- Keep `getflow.py` focused on Prisma collection and normalization.

### 3. Underlay resolver

Create a dedicated backend resolver, for example `web-dashboard/underlay-topology-manager.ts`.

Responsibilities:

- safely load the VyOS configuration;
- build an in-memory inventory of eligible VyOS IPv4 interfaces;
- consume normalized Prisma WAN interfaces;
- calculate same-subnet relationships;
- return matched, unmatched, unavailable, and ambiguous results;
- never throw a fatal error that breaks the normal topology endpoint.

Suggested public types:

```ts
type UnderlayResolutionStatus =
  | 'matched'
  | 'no_match'
  | 'ambiguous'
  | 'wan_ip_unavailable'
  | 'vyos_unavailable';

type PrismaWanEndpoint = {
  elementId: string;
  elementName?: string;
  siteId?: string;
  siteName?: string;
  interfaceId?: string;
  interfaceName?: string;
  ipCidr?: string | null;
  ip?: string | null;
  network?: string | null;
  linkType?: string | null;
};

type VyosInterfaceEndpoint = {
  routerId: string;
  routerName: string;
  location?: string | null;
  interfaceName: string;
  description?: string | null;
  ipCidr: string;
  ip: string;
  network: string;
  routerStatus?: string | null;
};

type UnderlayResolution = {
  id: string;
  status: UnderlayResolutionStatus;
  prismaWan: PrismaWanEndpoint;
  vyos?: VyosInterfaceEndpoint;
  candidates?: VyosInterfaceEndpoint[];
  matchMethod?: 'same_subnet';
  matchedNetwork?: string;
  diagnostic?: string;
};
```

Matching requirements:

- Use a robust IP/CIDR package already present in the project if available.
- If no suitable package exists, add a small, well-maintained dependency such as `ipaddr.js` or `netmask`, and use it only server-side.
- Never compare networks with string operations.
- A match means the Prisma WAN IP belongs to the VyOS interface network and the result is unique.
- If Prisma WAN IP/CIDR is missing, return `wan_ip_unavailable`.
- If VyOS inventory is unavailable, return `vyos_unavailable`.
- If no candidate exists, return `no_match`.
- If more than one candidate exists, return `ambiguous` and include sanitized candidates for diagnostics.
- For v1, do not try to resolve ambiguity using descriptions, site names, labels, metrics, next-hop values, or any heuristic.

### 4. Backend API

Extend the existing topology endpoint additively.

Suggested payload:

```json
{
  "topology": {
    "...": "existing topology payload remains unchanged"
  },
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
    "resolutions": []
  }
}
```

Requirements:

- Existing frontend behavior must keep working if underlay is absent.
- Underlay errors must be isolated, logged server-side, and return a safe degraded response.
- Cache the VyOS inventory reasonably if the existing topology endpoint already has caching.
- Do not add expensive per-node API calls from the browser.
- Resolve the full underlay dataset server-side together with topology retrieval, then filter it client-side for selected elements.

### 5. UX: progressive disclosure

The global topology must remain the default and must remain visually clean.

Add a button/toggle in the Topology toolbar:

- Label: `Underlay`
- Icon: use an existing relevant icon set already used by the project, preferably Network, Router, Cable, or Layers.
- Disabled or hidden when no VyOS configuration is available.
- Include a compact badge when data is available, for example: `8/12`.

Do **not** make this toolbar action immediately render every VyOS element in the global graph.

The toolbar action should reveal a small choice:

- Inspect selected circuit
- Inspect selected site
- Show resolved circuits
- Exit underlay mode

If there is no selected circuit/site, show a clear empty state:

> Select a WAN circuit or ION to inspect its underlay next hop.

### 6. UX: circuit selection

Make existing Prisma WAN circuit cards/selectable circuit labels clickable, without disrupting current click behavior.

When a user selects a circuit:

- visually highlight the selected WAN circuit;
- show a compact detail panel or contextual action: `Inspect Underlay`;
- use the associated Prisma WAN interface identity to find the matching underlay resolution.

When a user selects an ION/site:

- make `Inspect Underlay` available;
- if several WAN circuits exist, present a compact list of circuits and their resolution states:
  - green: Resolved;
  - gray: No VyOS match;
  - amber: Ambiguous;
  - muted: WAN IP unavailable.

### 7. UX: Underlay Details mode

When the user clicks `Inspect Underlay`:

#### A. Enter a focused local view

- Keep the normal global topology state in memory.
- Do not navigate away from the page.
- Do not reload topology data unless explicitly refreshed.
- Pan and zoom smoothly to the selected circuit.
- Fit the focused local group in view with padding.
- Use animation if existing React Flow usage supports it.
- The zoom must make labels clearly readable on laptop displays.

#### B. Render only the local relationship

Show a focused graph containing:

- selected Prisma site context;
- selected Prisma ION;
- selected WAN circuit;
- provider cloud / Internet / MPLS node if already represented in the existing graph;
- matched VyOS router;
- matched VyOS interface endpoint;
- the underlay relationship.

Use this conceptual structure:

```text
[Prisma Site]
    |
[ION: BR1]
    |
[WAN: BR1-MPLS]
IP: 192.168.190.1/24
    |
    | UNDERLAY — same subnet: 192.168.190.0/24
    v
[VyOS: vyosrouter]
Interface: eth0
IP: 192.168.190.254/24
Description: MPLS190
```

#### C. Visual semantics

- Existing Prisma overlay/VPN edges: leave their visual language unchanged.
- Underlay edge:
  - dashed line;
  - visibly different from VPN tunnel edges;
  - neutral blue/gray or appropriately subtle color;
  - label: `Underlay / 192.168.190.0/24`;
  - tooltip: `Resolved by unique same-subnet IPv4 match`.
- VyOS router node:
  - visually distinct from Prisma ION nodes;
  - contains router name and optional location;
  - uses a router/server icon consistent with current theme.
- VyOS interface area:
  - contains interface name;
  - description;
  - IP/CIDR;
  - never contains secret configuration values.
- Add a visible chip: `CONFIRMED SAME-SUBNET MATCH` only for matched relationships.

#### D. Zoom behavior

- Upon opening Underlay Details, call React Flow `fitView` or equivalent against the local node IDs.
- Set enough padding for labels and edge labels.
- Use a suitable min/max zoom configuration for detail inspection.
- If the user manually pans/zooms, preserve that interaction until they exit the mode.
- Add a `Fit Detail` control.
- Add an `Exit Underlay` control.
- On exit, restore the prior global map viewport: previous pan position and zoom level, not merely a generic `fitView`.

### 8. Non-match states

Underlay Details mode must also provide value when no safe match exists.

For `no_match`:

- show the selected Prisma site, ION, and WAN circuit;
- show WAN IP/CIDR;
- show a clear side panel:
  - `No VyOS next-hop discovered`
  - `No enabled VyOS interface belongs to 192.168.190.0/24.`
- do not show any artificial VyOS node or edge.

For `ambiguous`:

- show selected Prisma site, ION, and WAN circuit;
- show:
  - `Ambiguous VyOS mapping`
  - `More than one enabled VyOS interface matches 192.168.190.0/24. No underlay link is displayed.`
- optionally list sanitized candidate names, interface names, descriptions, and CIDRs in a diagnostic panel;
- do not visually connect to a candidate.

For `wan_ip_unavailable`:

- show:
  - `WAN address unavailable from Prisma SD-WAN`
  - `Stigix cannot safely resolve the underlay next hop.`
- do not show a VyOS link.

For `vyos_unavailable`:

- show:
  - `VyOS configuration unavailable`
  - `The Prisma overlay topology remains available.`

### 9. Show resolved circuits mode

As a secondary option, support `Show resolved circuits` from the Underlay toolbar.

This is still not a full global physical topology:

- retain the global graph;
- highlight only circuits with confirmed matches;
- show a small underlay indicator/badge on eligible Prisma WAN circuit cards;
- do not render all VyOS nodes and all underlay edges at once;
- clicking a highlighted circuit enters the focused Underlay Details mode.

Suggested badge:

- icon: small router/link icon;
- tooltip: `VyOS next hop resolved: vyosrouter / eth0 / MPLS190`;
- do not expose the full IP unless the user opens detail mode.

### 10. Accessibility and responsiveness

- All new controls must have accessible labels and keyboard support.
- Tooltips must not be the only place where critical state appears.
- Maintain the existing dark visual design.
- Ensure labels remain readable after automatic zoom.
- On smaller screens, show Underlay Details information in a collapsible bottom sheet or side panel rather than letting cards overlap.
- Preserve the current topology’s existing controls and interactions.

### 11. Observability

Add safe backend logging with an `UNDERLAY` or `TOPOLOGY` namespace:

- VyOS config loaded/unavailable;
- number of Prisma WAN interfaces found;
- number of eligible VyOS interfaces;
- number of matched/no-match/ambiguous/unavailable results;
- resolver errors without secrets.

Do not log:

- apiKey;
- service account secrets;
- full raw Prisma API responses;
- full VyOS config content.

### 12. Tests

Add meaningful tests.

Resolver unit tests:

- one unique same-subnet match;
- no matching VyOS subnet;
- two matching VyOS interfaces -> ambiguous and no edge;
- DHCP VyOS address ignored;
- invalid VyOS address ignored;
- IPv6 address ignored in v1;
- disabled VyOS router ignored;
- missing Prisma WAN CIDR -> `wan_ip_unavailable`;
- VyOS config unavailable -> `vyos_unavailable`;
- `/30`, `/31`, and `/24` network examples;
- multiple addresses on one VyOS interface.

UI tests where the project’s existing test stack supports them:

- default global topology does not show underlay nodes;
- selecting a resolved circuit enables Inspect Underlay;
- entering detail mode calls focused viewport behavior;
- Exit Underlay restores normal mode;
- no-match and ambiguous states do not create underlay edges;
- badge/tooltip uses sanitized data only.

### 13. Documentation

Update or add a concise document, for example `docs/UNDERLAY_TOPOLOGY.md`.

Document:

- feature purpose;
- exact confidence rule: unique same-subnet IPv4 match only;
- user workflow;
- limitations;
- states: matched, no match, ambiguous, WAN IP unavailable, VyOS unavailable;
- security/data-exposure behavior;
- one configuration example;
- testing instructions.

## Deliverables

Provide:

1. A concise implementation summary.
2. The list of modified and newly created files.
3. The exact data contract added to `getflow.py` / backend API.
4. A description of the UI behavior and state transitions.
5. Tests added and how to run them.
6. Any Prisma API data limitations discovered.
7. No code changes that require secrets to be committed.

## Definition of done

- The current topology retains its existing normal global behavior.
- Underlay information is opt-in and does not clutter the global map.
- A resolved Prisma WAN circuit opens a readable, zoomed local detail view.
- The detail view names the VyOS router, interface, IP/CIDR, and interface description.
- A link is displayed only for one exact same-subnet IPv4 match.
- No-match, ambiguous, unavailable, and missing-data states are explicit and safe.
- Exiting returns the user to their previous global viewport.
- No credentials or secrets are exposed in browser responses, logs, source code, or documentation.
