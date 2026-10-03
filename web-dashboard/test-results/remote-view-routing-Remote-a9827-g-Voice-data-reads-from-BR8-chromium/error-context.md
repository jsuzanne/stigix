# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: remote-view-routing.spec.ts >> Remote-View — Read + Write Routing (DC1→BR8 Live) >> READ — gateway data loading >> Voice: data reads from BR8
- Location: tests/remote-view-routing.spec.ts:182:9

# Error details

```
Error: Expected gateway READ: GET /api/voice/ingress via →BR8
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
      - button "IoT Emulate physical IoT devices & security attack profiles (Real-on-Wire)" [ref=e84]:
        - text: IoT
        - generic: Emulate physical IoT devices & security attack profiles (Real-on-Wire)
      - button "Voice Simulate RTP voice calls and measure MOS / jitter quality" [active] [ref=e88]:
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
      - generic [ref=e122]:
        - generic [ref=e123]:
          - generic [ref=e124]:
            - generic [ref=e129]:
              - generic [ref=e130]:
                - heading "VoIP Simulation" [level=2] [ref=e131]
                - generic [ref=e132]: Active
              - paragraph [ref=e133]: Real-time RTP Stream Emulation • 3 Concurrent Streams
            - generic [ref=e134]:
              - generic [ref=e135]:
                - generic [ref=e136]: Max Calls
                - spinbutton [ref=e139]: "3"
              - generic [ref=e141]:
                - generic [ref=e142]: Inter-Call (s)
                - spinbutton [ref=e146]: "1"
              - generic [ref=e148]:
                - generic [ref=e149]: Egress Interface
                - textbox "eth0, bond0…" [ref=e154]: enp2s0
              - generic [ref=e156]:
                - generic [ref=e157]: Source Ports
                - combobox [ref=e161] [cursor=pointer]:
                  - option "🎯 Call ID Based (30000+N)" [selected]
                  - option "🎲 Ephemeral Ports"
          - generic [ref=e162]:
            - generic [ref=e163]:
              - generic [ref=e164] [cursor=pointer]: Import
              - button "Export" [ref=e168]
            - button "Stop Voice Simulation" [ref=e172]
        - generic [ref=e176]:
          - generic [ref=e177]:
            - generic [ref=e178]: Total Calls
            - generic [ref=e182]: "5"
          - generic [ref=e183]:
            - generic [ref=e184]: Avg Loss
            - generic [ref=e190]: 0.7%
          - generic [ref=e191]:
            - generic [ref=e192]: Avg Latency
            - generic [ref=e197]: 13.9ms
          - generic [ref=e198]:
            - generic [ref=e199]: Avg MOS
            - generic [ref=e203]: "4.36"
          - generic [ref=e204]:
            - generic [ref=e205]: RTT Variance
            - generic [ref=e208]: 9.9 / 23.6ms
          - generic [ref=e209]:
            - generic [ref=e210]: Avg Jitter
            - generic [ref=e214]: 10.0ms
      - generic [ref=e215]:
        - generic [ref=e216]:
          - generic [ref=e217]:
            - heading "Live Streams" [level=3] [ref=e218]
            - generic [ref=e221]: 3 UP
          - generic [ref=e222]:
            - generic [ref=e223]:
              - generic [ref=e224]:
                - generic [ref=e225]:
                  - 'generic "Source Port: 30054" [ref=e226]': "#CALL-0054"
                  - generic [ref=e227]: 192.168.203.100:6100
                - generic [ref=e228]: G.711-ulaw • 30s
                - generic [ref=e230]:
                  - generic [ref=e231]: Progress
                  - generic [ref=e235]: 29 sec
              - generic [ref=e238]: Live
            - generic [ref=e241]:
              - generic [ref=e242]:
                - generic [ref=e243]:
                  - 'generic "Source Port: 30053" [ref=e244]': "#CALL-0053"
                  - generic [ref=e245]: 192.168.206.10:6100
                - generic [ref=e246]: G.711-ulaw • 30s
                - generic [ref=e248]:
                  - generic [ref=e249]: Progress
                  - generic [ref=e253]: 29 sec
              - generic [ref=e256]: Live
            - generic [ref=e259]:
              - generic [ref=e260]:
                - generic [ref=e261]:
                  - 'generic "Source Port: 30052" [ref=e262]': "#CALL-0052"
                  - generic [ref=e263]: 192.168.206.10:6100
                - generic [ref=e264]: G.711-ulaw • 30s
                - generic [ref=e266]:
                  - generic [ref=e267]: Progress
                  - generic [ref=e271]: 29 sec
              - generic [ref=e274]: Live
        - generic [ref=e277]:
          - generic [ref=e279]:
            - heading "Stigix Voice Targets" [level=3] [ref=e280]
            - paragraph [ref=e283]: 0 targets selected for simulation
          - table [ref=e285]:
            - rowgroup [ref=e286]:
              - row [ref=e287]:
                - columnheader [ref=e288]
                - columnheader "Site" [ref=e289]
                - 'columnheader "Host : Port" [ref=e290]'
                - columnheader "Codec" [ref=e291]
                - columnheader "Duration (s)" [ref=e292]
                - columnheader "Weight (%)" [ref=e293]
                - columnheader [ref=e294]
            - rowgroup [ref=e295]:
              - row [ref=e296]:
                - cell "No voice-capable Stigix targets — add one below or configure targets in Settings" [ref=e297]
              - row [ref=e298]:
                - cell [ref=e299]
                - cell "Manual" [ref=e301]
                - 'cell ": 6100" [ref=e302]':
                  - generic [ref=e303]:
                    - textbox "IP / FQDN" [ref=e304]
                    - generic [ref=e305]: ":"
                    - textbox "6100" [ref=e306]
                - cell "G.711-ulaw" [ref=e307]:
                  - combobox [ref=e308]:
                    - option "G.711-ulaw" [selected]
                    - option "G.711-alaw"
                    - option "G.729"
                    - option "OPUS"
                - cell [ref=e309]:
                  - spinbutton [ref=e310]: "30"
                - cell [ref=e311]:
                  - spinbutton [ref=e312]: "50"
                - cell [ref=e313]:
                  - button "Add custom target" [disabled] [ref=e314]
      - generic [ref=e316]:
        - heading "Per-Target QoS Statistics" [level=3] [ref=e320]
        - table [ref=e322]:
          - rowgroup [ref=e323]:
            - row [ref=e324]:
              - columnheader "Site / Endpoint" [ref=e325]
              - columnheader "Calls" [ref=e326]
              - columnheader "Avg Loss" [ref=e327]
              - columnheader "Avg RTT" [ref=e328]
              - columnheader "Avg MOS" [ref=e329]
              - columnheader "Avg Jitter" [ref=e330]
              - columnheader "Quality" [ref=e331]
          - rowgroup [ref=e332]:
            - row [ref=e333] [cursor=pointer]:
              - cell "192.168.203.100:6100" [ref=e334]
              - cell "3" [ref=e336]
              - cell "0.5%" [ref=e337]
              - cell "10.1ms" [ref=e339]
              - cell "4.37" [ref=e340]
              - cell "7.8ms" [ref=e341]
              - cell "excellent" [ref=e342]
            - row [ref=e346] [cursor=pointer]:
              - cell "192.168.206.10:6100" [ref=e347]
              - cell "1" [ref=e349]
              - cell "0.1%" [ref=e350]
              - cell "15.4ms" [ref=e352]
              - cell "4.40" [ref=e353]
              - cell "15.3ms" [ref=e354]
              - cell "excellent" [ref=e355]
            - row [ref=e359] [cursor=pointer]:
              - cell "192.168.207.10:6100" [ref=e360]
              - cell "1" [ref=e362]
              - cell "1.8%" [ref=e363]
              - cell "23.6ms" [ref=e365]
              - cell "4.29" [ref=e366]
              - cell "11.4ms" [ref=e367]
              - cell "fair" [ref=e368]
      - generic [ref=e372]:
        - generic [ref=e373]:
          - generic [ref=e377]:
            - generic [ref=e378]:
              - button "Outbound (Caller)" [ref=e379]
              - button "Inbound (Receiver)" [ref=e385]
            - paragraph [ref=e391]: 3 streams live
          - generic [ref=e393]:
            - textbox "Search traces…" [ref=e398]
            - combobox [ref=e399]:
              - option "Any Quality" [selected]
              - option "Excellent"
              - option "Fair"
              - option "Poor"
          - generic [ref=e400]:
            - button "Reset ID" [ref=e401]
            - button "Purge" [ref=e405]
        - table [ref=e410]:
          - rowgroup [ref=e411]:
            - row [ref=e412]:
              - columnheader "Timeline" [ref=e413] [cursor=pointer]
              - columnheader "Disposition" [ref=e417] [cursor=pointer]
              - columnheader "Site" [ref=e419] [cursor=pointer]
              - columnheader "Endpoint" [ref=e421] [cursor=pointer]
              - columnheader "Src Port" [ref=e423] [cursor=pointer]
              - columnheader "Loss / MOS" [ref=e425] [cursor=pointer]
              - columnheader "RTT / Jitter" [ref=e427] [cursor=pointer]
          - rowgroup [ref=e429]:
            - row [ref=e430]:
              - cell "02:26:00 PM" [ref=e431]
              - cell "#CALL-0054" [ref=e432]:
                - 'generic "Source Port: 30054" [ref=e434]': "#CALL-0054"
              - cell "Manual" [ref=e437]
              - cell "192.168.203.100:6100" [ref=e438]
              - cell [ref=e439]:
                - button "30054" [ref=e440]
              - cell "—" [ref=e441]
              - cell "—" [ref=e442]
            - row [ref=e443]:
              - cell "02:26:00 PM" [ref=e444]
              - cell "#CALL-0051" [ref=e445]:
                - 'generic "Source Port: 30051" [ref=e447]': "#CALL-0051"
              - cell "Manual" [ref=e452]
              - cell "192.168.203.100:6100" [ref=e453]
              - cell [ref=e454]:
                - button "30051" [ref=e455]
              - 'cell "0% loss MOS: 4.4" [ref=e456]':
                - generic [ref=e457]:
                  - generic [ref=e458]: 0% loss
                  - generic [ref=e461]: "MOS: 4.4"
              - 'cell "10.12ms Jitter: 4.28ms" [ref=e462]':
                - generic [ref=e463]:
                  - generic [ref=e464]: 10.12ms
                  - generic [ref=e465]: "Jitter: 4.28ms"
            - row [ref=e466]:
              - cell "02:25:59 PM" [ref=e467]
              - cell "#CALL-0053" [ref=e468]:
                - 'generic "Source Port: 30053" [ref=e470]': "#CALL-0053"
              - cell "Manual" [ref=e473]
              - cell "192.168.206.10:6100" [ref=e474]
              - cell [ref=e475]:
                - button "30053" [ref=e476]
              - cell "—" [ref=e477]
              - cell "—" [ref=e478]
            - row [ref=e479]:
              - cell "02:25:59 PM" [ref=e480]
              - cell "#CALL-0050" [ref=e481]:
                - 'generic "Source Port: 30050" [ref=e483]': "#CALL-0050"
              - cell "Manual" [ref=e488]
              - cell "192.168.203.100:6100" [ref=e489]
              - cell [ref=e490]:
                - button "30050" [ref=e491]
              - 'cell "0% loss MOS: 4.4" [ref=e492]':
                - generic [ref=e493]:
                  - generic [ref=e494]: 0% loss
                  - generic [ref=e497]: "MOS: 4.4"
              - 'cell "10.37ms Jitter: 7.08ms" [ref=e498]':
                - generic [ref=e499]:
                  - generic [ref=e500]: 10.37ms
                  - generic [ref=e501]: "Jitter: 7.08ms"
            - row [ref=e502]:
              - cell "02:25:56 PM" [ref=e503]
              - cell "#CALL-0052" [ref=e504]:
                - 'generic "Source Port: 30052" [ref=e506]': "#CALL-0052"
              - cell "Manual" [ref=e509]
              - cell "192.168.206.10:6100" [ref=e510]
              - cell [ref=e511]:
                - button "30052" [ref=e512]
              - cell "—" [ref=e513]
              - cell "—" [ref=e514]
            - row [ref=e515]:
              - cell "02:25:56 PM" [ref=e516]
              - cell "#CALL-0049" [ref=e517]:
                - 'generic "Source Port: 30049" [ref=e519]': "#CALL-0049"
              - cell "Manual" [ref=e524]
              - cell "192.168.206.10:6100" [ref=e525]
              - cell [ref=e526]:
                - button "30049" [ref=e527]
              - 'cell "0.1% loss MOS: 4.4" [ref=e528]':
                - generic [ref=e529]:
                  - generic [ref=e530]: 0.1% loss
                  - generic [ref=e533]: "MOS: 4.4"
              - 'cell "15.43ms Jitter: 15.34ms" [ref=e534]':
                - generic [ref=e535]:
                  - generic [ref=e536]: 15.43ms
                  - generic [ref=e537]: "Jitter: 15.34ms"
            - row [ref=e538]:
              - cell "02:25:27 PM" [ref=e539]
              - cell "#CALL-0051" [ref=e540]:
                - 'generic "Source Port: 30051" [ref=e542]': "#CALL-0051"
              - cell "Manual" [ref=e545]
              - cell "192.168.203.100:6100" [ref=e546]
              - cell [ref=e547]:
                - button "30051" [ref=e548]
              - cell "—" [ref=e549]
              - cell "—" [ref=e550]
            - row [ref=e551]:
              - cell "02:25:27 PM" [ref=e552]
              - cell "#CALL-0048" [ref=e553]:
                - 'generic "Source Port: 30048" [ref=e555]': "#CALL-0048"
              - cell "Manual" [ref=e560]
              - cell "192.168.207.10:6100" [ref=e561]
              - cell [ref=e562]:
                - button "30048" [ref=e563]
              - 'cell "1.8% loss MOS: 4.29" [ref=e564]':
                - generic [ref=e565]:
                  - generic [ref=e566]: 1.8% loss
                  - generic [ref=e569]: "MOS: 4.29"
              - 'cell "23.6ms Jitter: 11.44ms" [ref=e570]':
                - generic [ref=e571]:
                  - generic [ref=e572]: 23.6ms
                  - generic [ref=e573]: "Jitter: 11.44ms"
            - row [ref=e574]:
              - cell "02:25:26 PM" [ref=e575]
              - cell "#CALL-0050" [ref=e576]:
                - 'generic "Source Port: 30050" [ref=e578]': "#CALL-0050"
              - cell "Manual" [ref=e581]
              - cell "192.168.203.100:6100" [ref=e582]
              - cell [ref=e583]:
                - button "30050" [ref=e584]
              - cell "—" [ref=e585]
              - cell "—" [ref=e586]
            - row [ref=e587]:
              - cell "02:25:26 PM" [ref=e588]
              - cell "#CALL-0047" [ref=e589]:
                - 'generic "Source Port: 30047" [ref=e591]': "#CALL-0047"
              - cell "Manual" [ref=e596]
              - cell "192.168.203.100:6100" [ref=e597]
              - cell [ref=e598]:
                - button "30047" [ref=e599]
              - 'cell "1.6% loss MOS: 4.32" [ref=e600]':
                - generic [ref=e601]:
                  - generic [ref=e602]: 1.6% loss
                  - generic [ref=e605]: "MOS: 4.32"
              - 'cell "9.87ms Jitter: 12.03ms" [ref=e606]':
                - generic [ref=e607]:
                  - generic [ref=e608]: 9.87ms
                  - generic [ref=e609]: "Jitter: 12.03ms"
            - row [ref=e610]:
              - cell "02:25:22 PM" [ref=e611]
              - cell "#CALL-0049" [ref=e612]:
                - 'generic "Source Port: 30049" [ref=e614]': "#CALL-0049"
              - cell "Manual" [ref=e617]
              - cell "192.168.206.10:6100" [ref=e618]
              - cell [ref=e619]:
                - button "30049" [ref=e620]
              - cell "—" [ref=e621]
              - cell "—" [ref=e622]
  - generic [aria-hidden] [ref=e623]: "0"
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
      |               ^ Error: Expected gateway READ: GET /api/voice/ingress via →BR8
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