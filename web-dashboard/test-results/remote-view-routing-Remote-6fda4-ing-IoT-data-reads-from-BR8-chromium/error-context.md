# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: remote-view-routing.spec.ts >> Remote-View — Read + Write Routing (DC1→BR8 Live) >> READ — gateway data loading >> IoT: data reads from BR8
- Location: tests/remote-view-routing.spec.ts:190:9

# Error details

```
Error: Expected gateway READ: GET /api/iot/devices via →BR8
(not captured at all)
```

# Page snapshot

```yaml
- generic [ref=e1]:
  - generic [ref=e3]:
    - banner [ref=e4]:
      - generic [ref=e6]:
        - heading [level=1] [ref=e7]:
          - text: St
          - generic [ref=e8]: i
          - text: g
          - generic [ref=e12]: i
          - text: x
        - paragraph [ref=e16]:
          - text: The Engine for SASE Validation
          - generic [ref=e17]: • v2.0.67.dev1950
          - generic [ref=e18]: Leader
      - generic [ref=e20]:
        - generic [ref=e21]:
          - generic [ref=e25]: 192.168.219.1
          - button "Exit remote view — return to local Leader" [ref=e26]
        - button "⚡ BR8-Ubuntu" [ref=e31]
        - button "100% HEALTH" [ref=e40] [cursor=pointer]
        - generic [ref=e46]: admin
        - button "Switch to Light Mode" [ref=e47]
        - button "Add User" [ref=e54]
        - button "Change Password" [ref=e58]
        - button "Sign Out" [ref=e63]
    - generic [ref=e67]:
      - button "Traffic Generator Generate multi-app SaaS traffic load and monitor live APM telemetry" [ref=e68]:
        - text: Traffic Generator
        - generic: Generate multi-app SaaS traffic load and monitor live APM telemetry
      - button "Digital Experience Monitor synthetic probes, path SLAs and user experience (DEM)" [ref=e74]:
        - text: Digital Experience
        - generic: Monitor synthetic probes, path SLAs and user experience (DEM)
      - button "Bandwidth Test High-performance throughput & latency validation (XFR / iPerf)" [ref=e78]:
        - text: Bandwidth Test
        - generic: High-performance throughput & latency validation (XFR / iPerf)
      - button "Security Validate SASE & NGFW security policy enforcement (URL, DNS, Threats, C2)" [ref=e81]:
        - text: Security
        - generic: Validate SASE & NGFW security policy enforcement (URL, DNS, Threats, C2)
      - button "IoT Emulate physical IoT devices & security attack profiles (Real-on-Wire)" [active] [ref=e84]:
        - text: IoT
        - generic: Emulate physical IoT devices & security attack profiles (Real-on-Wire)
      - button "Voice Simulate RTP voice calls and measure MOS / jitter quality" [ref=e88]:
        - text: Voice
        - generic: Simulate RTP voice calls and measure MOS / jitter quality
      - button "Custom Apps New Simulate Custom TCP & HTTP Applications across SD-WAN overlays and direct breakouts" [ref=e91]:
        - text: Custom Apps
        - generic [ref=e96]: New
        - generic: Simulate Custom TCP & HTTP Applications across SD-WAN overlays and direct breakouts
      - button "Failover Monitoring Track millisecond blackout and packet loss during failover" [ref=e97]:
        - text: Failover Monitoring
        - generic: Track millisecond blackout and packet loss during failover
      - button "Topology Visualize physical VyOS underlay, SD-WAN tunnels & live paths" [ref=e100]:
        - text: Topology
        - generic: Visualize physical VyOS underlay, SD-WAN tunnels & live paths
      - button "VyOS Control Inject WAN impairments (latency, loss) & orchestrate VyOS routers" [ref=e106]:
        - text: VyOS Control
        - generic: Inject WAN impairments (latency, loss) & orchestrate VyOS routers
      - button "Live Events Stream live real-time network and security events" [ref=e109]:
        - text: Live Events
        - generic: Stream live real-time network and security events
      - button "Mesh Leader Centralized multi-instance mesh observability & peer metrics" [ref=e112]:
        - text: Mesh
        - generic [ref=e116]: Leader
        - generic: Centralized multi-instance mesh observability & peer metrics
      - button "Settings Manage Global Provisioning, Synthetic Probes & cluster config" [ref=e117]:
        - text: Settings
        - generic: Manage Global Provisioning, Synthetic Probes & cluster config
    - generic [ref=e121]:
      - generic [ref=e123]:
        - generic [ref=e124]: IoT
        - generic [ref=e130]:
          - generic [ref=e131]: "Max:"
          - slider [ref=e132] [cursor=pointer]: "30"
          - generic [ref=e133]: "30"
        - generic [ref=e135]:
          - generic [ref=e136]: "Active: 30"
          - generic [ref=e139]: "Queued: 34"
          - generic [ref=e142]: "Idle: 36"
      - generic [ref=e145]:
        - generic [ref=e151]:
          - heading "IoT Device Simulation" [level=2] [ref=e152]
          - generic [ref=e153]:
            - paragraph [ref=e154]: Scale your branch with realistic IoT traffic patterns per vendor.
            - generic [ref=e155]: "|"
            - link "Download Sample" [ref=e156] [cursor=pointer]:
              - /url: https://raw.githubusercontent.com/jsuzanne/stigix/main/sample%20config/iot-devices.json
            - generic [ref=e161]: "|"
            - link "Python Generator" [ref=e162] [cursor=pointer]:
              - /url: https://github.com/jsuzanne/stigix/blob/main/docs/IOT_DEVICE_GENERATOR.md
            - generic [ref=e167]: "|"
            - link "Llm Guide" [ref=e168] [cursor=pointer]:
              - /url: https://github.com/jsuzanne/stigix/blob/main/docs/IOT_LLM_GENERATION.md
        - generic [ref=e173]:
          - button "Export Json" [ref=e174]
          - button "Import" [ref=e179]
          - button "Add Device" [ref=e186]
      - generic [ref=e188]:
        - generic [ref=e189]:
          - textbox "Filter by Name, Vendor, ID, MAC..." [ref=e194]
          - generic [ref=e195]:
            - button "💀 Attacks ON" [ref=e196]:
              - generic [ref=e197]: 💀
              - generic [ref=e198]: Attacks ON
            - button "Select All" [ref=e199]
            - generic [ref=e202]:
              - button [ref=e203]
              - button [ref=e209]
        - generic [ref=e211]:
          - button "All (0)" [ref=e212]:
            - text: All
            - generic [ref=e213]: (0)
          - button "Active (0)" [ref=e214]:
            - text: Active
            - generic [ref=e216]: (0)
          - button "Queued (0)" [ref=e217]:
            - text: Queued
            - generic [ref=e219]: (0)
          - button "Idle (0)" [ref=e220]:
            - text: Idle
            - generic [ref=e222]: (0)
          - button "Stopped (0)" [ref=e223]:
            - text: Stopped
            - generic [ref=e225]: (0)
      - paragraph [ref=e232]: Provisioning simulation environment...
  - generic [aria-hidden] [ref=e233]: "0"
```

# Test source

```ts
  1   | import { test, expect, Page, Route } from '@playwright/test';
  2   | 
  3   | /**
  4   |  * remote-view-routing.spec.ts  —  LIVE INFRA · Complete Read + Write Validation
  5   |  * ──────────────────────────────────────────────────────────────────────────────
  6   |  * Validates that ALL data reads (GETs) AND write actions (POSTs/DELETEs) in
  7   |  * remote-view mode are correctly routed via /api/gateway/:peerId/* and never
  8   |  * hit DC1 locally.
  9   |  *
  10  |  * DC1 : http://192.168.122.51:8080  (admin/admin)
  11  |  * BR8 : "BR8-Ubuntu" — selected via UI peer switcher
  12  |  *
  13  |  * 504 responses = routing OK, BR8 backend timeout (not a routing bug).
  14  |  * LOCAL POST /api/auth/login = expected (auth is always DC1-local).
  15  |  */
  16  | 
  17  | // ─── Config ────────────────────────────────────────────────────────────────────
  18  | const DC1_URL    = process.env.STIGIX_URL  || 'http://192.168.122.51:8080';
  19  | const USERNAME   = process.env.STIGIX_USER || 'admin';
  20  | const PASSWORD   = process.env.STIGIX_PASS || 'admin';
  21  | const PEER_LABEL = process.env.STIGIX_PEER || 'BR8';
  22  | 
  23  | // ─── Request Capture ───────────────────────────────────────────────────────────
  24  | interface Req { method: string; path: string; status: number; peerId: string; isGateway: boolean; }
  25  | let allReqs: Req[] = [];
  26  | 
  27  | async function installInterceptor(page: Page) {
  28  |     allReqs = [];
  29  |     await page.route('**/api/**', async (route: Route) => {
  30  |         const url    = route.request().url();
  31  |         const method = route.request().method();
  32  |         if (url.includes('/api/gateway/')) {
  33  |             const m      = url.match(/\/api\/gateway\/([^/?#]+)(\/[^?#]*)/);
  34  |             const peerId = m?.[1] ?? '?';
  35  |             const path   = m?.[2] ?? url;
  36  |             try {
  37  |                 const resp = await route.fetch();
  38  |                 allReqs.push({ method, path, status: resp.status(), peerId, isGateway: true });
  39  |                 await route.fulfill({ response: resp });
  40  |             } catch {
  41  |                 allReqs.push({ method, path, status: 0, peerId, isGateway: true });
  42  |                 await route.abort();
  43  |             }
  44  |         } else {
  45  |             const pathMatch = url.match(/\/api\/(.*?)(\?|$)/);
  46  |             const path      = '/api/' + (pathMatch?.[1] ?? '?');
  47  |             if (method !== 'GET') console.log(`  ⚠️  LOCAL: ${method} ${path}`);
  48  |             try {
  49  |                 const resp = await route.fetch();
  50  |                 allReqs.push({ method, path, status: resp.status(), peerId: 'LOCAL', isGateway: false });
  51  |                 await route.fulfill({ response: resp });
  52  |             } catch {
  53  |                 allReqs.push({ method, path, status: 0, peerId: 'LOCAL', isGateway: false });
  54  |                 await route.abort();
  55  |             }
  56  |         }
  57  |     });
  58  | }
  59  | 
  60  | const gwReqs = () => allReqs.filter(r => r.isGateway);
  61  | 
  62  | /** Assert a GET was served from BR8 gateway (status can be anything — routing is what matters) */
  63  | function assertGWRead(apiPath: string): void {
  64  |     const hit = gwReqs().find(r =>
  65  |         r.method === 'GET' &&
  66  |         r.path.includes(apiPath) &&
  67  |         r.peerId.toUpperCase().includes(PEER_LABEL.toUpperCase())
  68  |     );
  69  |     if (!hit) {
  70  |         const local = allReqs
  71  |             .filter(r => !r.isGateway && r.path.includes(apiPath))
  72  |             .map(r => `  LOCAL GET ${r.path} [${r.status}]`)
  73  |             .join('\n');
> 74  |         throw new Error(
      |               ^ Error: Expected gateway READ: GET /api/iot/devices via →BR8
  75  |             `Expected gateway READ: GET ${apiPath} via →${PEER_LABEL}\n` +
  76  |             (local ? `Found LOCAL instead:\n${local}` : '(not captured at all)')
  77  |         );
  78  |     }
  79  |     const ok = hit.status > 0 && hit.status < 500 || hit.status === 504;
  80  |     console.log(`  ${ok ? '✅' : `⚠️  [${hit.status}]`} GW GET ${hit.path}`);
  81  | }
  82  | 
  83  | /** Assert a write (POST/DELETE/PUT) was routed via BR8 gateway */
  84  | function assertGWWrite(method: string, apiPath: string): Req {
  85  |     const hit = gwReqs().find(r =>
  86  |         r.method === method &&
  87  |         r.path.includes(apiPath) &&
  88  |         r.peerId.toUpperCase().includes(PEER_LABEL.toUpperCase())
  89  |     );
  90  |     if (!hit) {
  91  |         const gw    = gwReqs().filter(r => r.method !== 'GET').map(r => `  [${r.status}] ${r.method} ${r.path}`).join('\n') || '  (none)';
  92  |         const local = allReqs.filter(r => !r.isGateway && r.method !== 'GET').map(r => `  LOCAL ${r.method} ${r.path}`).join('\n') || '  (none)';
  93  |         throw new Error(`Expected gateway WRITE: ${method} ${apiPath} via →${PEER_LABEL}\nGW writes:\n${gw}\nLocal writes:\n${local}`);
  94  |     }
  95  |     console.log(`  ✅ [${hit.status}] GW ${hit.method} ${hit.path}`);
  96  |     return hit;
  97  | }
  98  | 
  99  | // ─── Helpers ───────────────────────────────────────────────────────────────────
  100 | async function login(page: Page) {
  101 |     await page.goto(DC1_URL, { waitUntil: 'domcontentloaded', timeout: 20_000 });
  102 |     await page.waitForTimeout(1_000);
  103 |     if (await page.locator('#peer-context-switcher').isVisible({ timeout: 2_000 }).catch(() => false)) return;
  104 |     await page.fill('input[placeholder*="username"]', USERNAME);
  105 |     await page.fill('input[type="password"]', PASSWORD);
  106 |     await page.click('button[type="submit"]');
  107 |     await page.waitForSelector('#peer-context-switcher', { timeout: 20_000 });
  108 | }
  109 | 
  110 | async function selectPeer(page: Page) {
  111 |     await page.click('#peer-context-switcher');
  112 |     await page.locator('#peer-context-dropdown').waitFor({ state: 'visible', timeout: 5_000 });
  113 |     await page.click(`#peer-context-dropdown button:has-text("${PEER_LABEL}")`);
  114 |     await page.waitForTimeout(2_000);
  115 |     const txt = await page.locator('#peer-context-switcher').textContent();
  116 |     console.log(`  ✅ Peer: "${txt?.trim()}"`);
  117 | }
  118 | 
  119 | async function goToTab(page: Page, tabText: string) {
  120 |     await page.locator('button').filter({ hasText: tabText }).first().click();
  121 |     await page.waitForTimeout(600);
  122 | }
  123 | 
  124 | async function waitNoLoading(page: Page, text = 'Loading', timeout = 12_000) {
  125 |     await page.waitForFunction(
  126 |         (t: string) => !document.body.innerText.includes(t),
  127 |         text, { timeout }
  128 |     ).catch(() => {});
  129 |     await page.waitForTimeout(400);
  130 | }
  131 | 
  132 | // ─── Suite ─────────────────────────────────────────────────────────────────────
  133 | test.describe('Remote-View — Read + Write Routing (DC1→BR8 Live)', () => {
  134 | 
  135 |     test.beforeAll(async ({ browser }) => {
  136 |         const page = await browser.newPage();
  137 |         const res  = await page.goto(DC1_URL, { timeout: 15_000 });
  138 |         await page.close();
  139 |         expect(res?.status()).toBeLessThan(400);
  140 |         console.log(`✅ DC1 reachable (HTTP ${res?.status()})`);
  141 |     });
  142 | 
  143 |     test.beforeEach(async ({ page }) => {
  144 |         await installInterceptor(page);
  145 |         await login(page);
  146 |         await selectPeer(page);
  147 |     });
  148 | 
  149 |     // ═══════════════════════════════════════════════════════════════
  150 |     //  READ — data loaded from BR8 gateway
  151 |     // ═══════════════════════════════════════════════════════════════
  152 | 
  153 |     test.describe('READ — gateway data loading', () => {
  154 | 
  155 |         test('Traffic Generator: data reads from BR8', async ({ page }) => {
  156 |             await goToTab(page, 'Traffic Generator');
  157 |             await waitNoLoading(page, 'Loading');
  158 |             await page.waitForTimeout(2_000);
  159 |             assertGWRead('/api/traffic/status');
  160 |             assertGWRead('/api/traffic/history');
  161 |             assertGWRead('/api/config/traffic-thresholds');
  162 |         });
  163 | 
  164 |         test('Digital Experience: data reads from BR8', async ({ page }) => {
  165 |             await goToTab(page, 'Digital Experience');
  166 |             await waitNoLoading(page, 'Loading');
  167 |             await page.waitForTimeout(2_000);
  168 |             assertGWRead('/api/connectivity/active-probes');
  169 |             assertGWRead('/api/connectivity/custom');
  170 |         });
  171 | 
  172 |         test('Security: data reads from BR8', async ({ page }) => {
  173 |             await goToTab(page, 'Security');
  174 |             await waitNoLoading(page, 'Loading security configuration');
```