# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: remote-view-routing.spec.ts >> Remote-View — Read + Write Routing (DC1→BR8 Live) >> WRITE — actions routed via gateway >> Voice: control (start/stop) via BR8 gateway
- Location: tests/remote-view-routing.spec.ts:260:9

# Error details

```
Error: Expected gateway WRITE: POST /api/voice/control via →BR8
GW writes:
  (none)
Local writes:
  LOCAL POST /api/auth/login
```

# Page snapshot

```yaml
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
          - button "Terminating…" [disabled] [ref=e172]
      - generic [ref=e175]:
        - generic [ref=e176]:
          - generic [ref=e177]: Total Calls
          - generic [ref=e181]: "5"
        - generic [ref=e182]:
          - generic [ref=e183]: Avg Loss
          - generic [ref=e189]: 0.0%
        - generic [ref=e190]:
          - generic [ref=e191]: Avg Latency
          - generic [ref=e196]: 26.5ms
        - generic [ref=e197]:
          - generic [ref=e198]: Avg MOS
          - generic [ref=e202]: "4.38"
        - generic [ref=e203]:
          - generic [ref=e204]: RTT Variance
          - generic [ref=e207]: 12.3 / 40.7ms
        - generic [ref=e208]:
          - generic [ref=e209]: Avg Jitter
          - generic [ref=e213]: 21.2ms
    - generic [ref=e214]:
      - generic [ref=e215]:
        - generic [ref=e216]:
          - heading "Live Streams" [level=3] [ref=e217]
          - generic [ref=e220]: 3 UP
        - generic [ref=e221]:
          - generic [ref=e222]:
            - generic [ref=e223]:
              - generic [ref=e224]:
                - 'generic "Source Port: 30060" [ref=e225]': "#CALL-0060"
                - generic [ref=e226]: DC1
              - generic [ref=e227]: 192.168.203.100:6100
              - generic [ref=e228]: G.711-ulaw • 30s
              - generic [ref=e230]:
                - generic [ref=e231]: Progress
                - generic [ref=e235]: 30 sec
            - generic [ref=e237]: Live
          - generic [ref=e240]:
            - generic [ref=e241]:
              - generic [ref=e242]:
                - 'generic "Source Port: 30059" [ref=e243]': "#CALL-0059"
                - generic [ref=e244]: BR2-Ubuntu
              - generic [ref=e245]: 192.168.206.10:6100
              - generic [ref=e246]: G.711-ulaw • 30s
              - generic [ref=e248]:
                - generic [ref=e249]: Progress
                - generic [ref=e253]: 30 sec
            - generic [ref=e255]: Live
          - generic [ref=e258]:
            - generic [ref=e259]:
              - generic [ref=e260]:
                - 'generic "Source Port: 30058" [ref=e261]': "#CALL-0058"
                - generic [ref=e262]: DC1
              - generic [ref=e263]: 192.168.203.100:6100
              - generic [ref=e264]: G.711-ulaw • 30s
              - generic [ref=e266]:
                - generic [ref=e267]: Progress
                - generic [ref=e271]: 30 sec
            - generic [ref=e273]: Live
      - generic [ref=e276]:
        - generic [ref=e278]:
          - heading "Stigix Voice Targets" [level=3] [ref=e279]
          - paragraph [ref=e282]: 3 targets selected for simulation
        - table [ref=e284]:
          - rowgroup [ref=e285]:
            - row [ref=e286]:
              - columnheader [ref=e287]
              - columnheader "Site" [ref=e288]
              - 'columnheader "Host : Port" [ref=e289]'
              - columnheader "Codec" [ref=e290]
              - columnheader "Duration (s)" [ref=e291]
              - columnheader "Weight (%)" [ref=e292]
              - columnheader [ref=e293]
          - rowgroup [ref=e294]:
            - row [ref=e295]:
              - cell [ref=e296]:
                - button [ref=e297] [cursor=pointer]
              - cell "Checking reachability... DC1" [ref=e301] [cursor=pointer]:
                - generic [ref=e302]:
                  - generic "Checking reachability..." [ref=e303]
                  - generic [ref=e304]: DC1
              - cell "192.168.203.100:6100" [ref=e305]
              - cell "G.711-ulaw" [ref=e307]:
                - combobox [ref=e308] [cursor=pointer]:
                  - option "G.711-ulaw" [selected]
                  - option "G.711-alaw"
                  - option "G.729"
                  - option "OPUS"
              - cell [ref=e309]:
                - spinbutton [ref=e310]: "30"
              - cell [ref=e311]:
                - spinbutton [ref=e312]: "50"
              - cell [ref=e313]
            - row [ref=e314]:
              - cell [ref=e315]:
                - button [ref=e316] [cursor=pointer]
              - cell "Checking reachability... BR2-Ubuntu" [ref=e320] [cursor=pointer]:
                - generic [ref=e321]:
                  - generic "Checking reachability..." [ref=e322]
                  - generic [ref=e323]: BR2-Ubuntu
              - cell "192.168.206.10:6100" [ref=e324]
              - cell "G.711-ulaw" [ref=e326]:
                - combobox [ref=e327] [cursor=pointer]:
                  - option "G.711-ulaw" [selected]
                  - option "G.711-alaw"
                  - option "G.729"
                  - option "OPUS"
              - cell [ref=e328]:
                - spinbutton [ref=e329]: "30"
              - cell [ref=e330]:
                - spinbutton [ref=e331]: "50"
              - cell [ref=e332]
            - row [ref=e333]:
              - cell [ref=e334]:
                - button [ref=e335] [cursor=pointer]
              - cell "Checking reachability... BR1-Ubuntu" [ref=e339] [cursor=pointer]:
                - generic [ref=e340]:
                  - generic "Checking reachability..." [ref=e341]
                  - generic [ref=e342]: BR1-Ubuntu
              - cell "192.168.207.10:6100" [ref=e343]
              - cell "G.711-ulaw" [ref=e345]:
                - combobox [ref=e346] [cursor=pointer]:
                  - option "G.711-ulaw" [selected]
                  - option "G.711-alaw"
                  - option "G.729"
                  - option "OPUS"
              - cell [ref=e347]:
                - spinbutton [ref=e348]: "30"
              - cell [ref=e349]:
                - spinbutton [ref=e350]: "50"
              - cell [ref=e351]
            - row [ref=e352]:
              - cell [ref=e353]:
                - button [ref=e354] [cursor=pointer]
              - cell "Checking reachability... RaspBerry120" [ref=e355] [cursor=pointer]:
                - generic [ref=e356]:
                  - generic "Checking reachability..." [ref=e357]
                  - generic [ref=e358]: RaspBerry120
              - cell "192.168.1.120:6100" [ref=e359]
              - cell "G.711-ulaw" [ref=e361]:
                - combobox [ref=e362] [cursor=pointer]:
                  - option "G.711-ulaw" [selected]
                  - option "G.711-alaw"
                  - option "G.729"
                  - option "OPUS"
              - cell [ref=e363]:
                - spinbutton [ref=e364]: "30"
              - cell [ref=e365]:
                - spinbutton [ref=e366]: "50"
              - cell [ref=e367]
            - row [ref=e368]:
              - cell [ref=e369]:
                - button [ref=e370] [cursor=pointer]
              - cell "Checking reachability... BR8-Ubuntu" [ref=e371] [cursor=pointer]:
                - generic [ref=e372]:
                  - generic "Checking reachability..." [ref=e373]
                  - generic [ref=e374]: BR8-Ubuntu
              - cell "192.168.219.1:6100" [ref=e375]
              - cell "G.711-ulaw" [ref=e377]:
                - combobox [ref=e378] [cursor=pointer]:
                  - option "G.711-ulaw" [selected]
                  - option "G.711-alaw"
                  - option "G.729"
                  - option "OPUS"
              - cell [ref=e379]:
                - spinbutton [ref=e380]: "30"
              - cell [ref=e381]:
                - spinbutton [ref=e382]: "50"
              - cell [ref=e383]
            - row [ref=e384]:
              - cell [ref=e385]:
                - button [ref=e386] [cursor=pointer]
              - cell "Checking reachability... Hetznerv2" [ref=e387] [cursor=pointer]:
                - generic [ref=e388]:
                  - generic "Checking reachability..." [ref=e389]
                  - generic [ref=e390]: Hetznerv2
              - cell "142.132.193.157:6100" [ref=e391]
              - cell "G.711-ulaw" [ref=e393]:
                - combobox [ref=e394] [cursor=pointer]:
                  - option "G.711-ulaw" [selected]
                  - option "G.711-alaw"
                  - option "G.729"
                  - option "OPUS"
              - cell [ref=e395]:
                - spinbutton [ref=e396]: "30"
              - cell [ref=e397]:
                - spinbutton [ref=e398]: "50"
              - cell [ref=e399]
            - row [ref=e400]:
              - cell [ref=e401]:
                - button [ref=e402] [cursor=pointer]
              - cell "Checking reachability... Nucvillers-DC" [ref=e403] [cursor=pointer]:
                - generic [ref=e404]:
                  - generic "Checking reachability..." [ref=e405]
                  - generic [ref=e406]: Nucvillers-DC
              - cell "192.168.10.210:6100" [ref=e407]
              - cell "G.711-ulaw" [ref=e409]:
                - combobox [ref=e410] [cursor=pointer]:
                  - option "G.711-ulaw" [selected]
                  - option "G.711-alaw"
                  - option "G.729"
                  - option "OPUS"
              - cell [ref=e411]:
                - spinbutton [ref=e412]: "30"
              - cell [ref=e413]:
                - spinbutton [ref=e414]: "50"
              - cell [ref=e415]
            - row [ref=e416]:
              - cell [ref=e417]:
                - button [ref=e418] [cursor=pointer]
              - cell "Checking reachability... BR5-Ubuntu" [ref=e419] [cursor=pointer]:
                - generic [ref=e420]:
                  - generic "Checking reachability..." [ref=e421]
                  - generic [ref=e422]: BR5-Ubuntu
              - cell "192.168.217.5:6100" [ref=e423]
              - cell "G.711-ulaw" [ref=e425]:
                - combobox [ref=e426] [cursor=pointer]:
                  - option "G.711-ulaw" [selected]
                  - option "G.711-alaw"
                  - option "G.729"
                  - option "OPUS"
              - cell [ref=e427]:
                - spinbutton [ref=e428]: "30"
              - cell [ref=e429]:
                - spinbutton [ref=e430]: "50"
              - cell [ref=e431]
            - row [ref=e432]:
              - cell [ref=e433]
              - cell "Manual" [ref=e435]
              - 'cell ": 6100" [ref=e436]':
                - generic [ref=e437]:
                  - textbox "IP / FQDN" [ref=e438]
                  - generic [ref=e439]: ":"
                  - textbox "6100" [ref=e440]
              - cell "G.711-ulaw" [ref=e441]:
                - combobox [ref=e442]:
                  - option "G.711-ulaw" [selected]
                  - option "G.711-alaw"
                  - option "G.729"
                  - option "OPUS"
              - cell [ref=e443]:
                - spinbutton [ref=e444]: "30"
              - cell [ref=e445]:
                - spinbutton [ref=e446]: "50"
              - cell [ref=e447]:
                - button "Add custom target" [disabled] [ref=e448]
    - generic [ref=e450]:
      - heading "Per-Target QoS Statistics" [level=3] [ref=e454]
      - table [ref=e456]:
        - rowgroup [ref=e457]:
          - row [ref=e458]:
            - columnheader "Site / Endpoint" [ref=e459]
            - columnheader "Calls" [ref=e460]
            - columnheader "Avg Loss" [ref=e461]
            - columnheader "Avg RTT" [ref=e462]
            - columnheader "Avg MOS" [ref=e463]
            - columnheader "Avg Jitter" [ref=e464]
            - columnheader "Quality" [ref=e465]
        - rowgroup [ref=e466]:
          - row [ref=e467] [cursor=pointer]:
            - cell "DC1 192.168.203.100:6100" [ref=e468]:
              - generic [ref=e469]: DC1
              - generic [ref=e470]: 192.168.203.100:6100
            - cell "2" [ref=e471]
            - cell "0.0%" [ref=e472]
            - cell "14.4ms" [ref=e474]
            - cell "4.40" [ref=e475]
            - cell "8.7ms" [ref=e476]
            - cell "excellent" [ref=e477]
          - row [ref=e481] [cursor=pointer]:
            - cell "BR1-Ubuntu 192.168.207.10:6100" [ref=e482]:
              - generic [ref=e483]: BR1-Ubuntu
              - generic [ref=e484]: 192.168.207.10:6100
            - cell "2" [ref=e485]
            - cell "0.0%" [ref=e486]
            - cell "38.8ms" [ref=e488]
            - cell "4.37" [ref=e489]
            - cell "36.9ms" [ref=e490]
            - cell "excellent" [ref=e491]
          - row [ref=e495] [cursor=pointer]:
            - cell "BR2-Ubuntu 192.168.206.10:6100" [ref=e496]:
              - generic [ref=e497]: BR2-Ubuntu
              - generic [ref=e498]: 192.168.206.10:6100
            - cell "1" [ref=e499]
            - cell "0.1%" [ref=e500]
            - cell "25.9ms" [ref=e502]
            - cell "4.39" [ref=e503]
            - cell "15.1ms" [ref=e504]
            - cell "excellent" [ref=e505]
    - generic [ref=e509]:
      - generic [ref=e510]:
        - generic [ref=e514]:
          - generic [ref=e515]:
            - button "Outbound (Caller)" [ref=e516]
            - button "Inbound (Receiver) 1" [ref=e522]:
              - generic [ref=e527]: Inbound (Receiver)
              - generic [ref=e528]: "1"
          - paragraph [ref=e529]: 3 streams live
        - generic [ref=e531]:
          - textbox "Search traces…" [ref=e536]
          - combobox [ref=e537]:
            - option "Any Quality" [selected]
            - option "Excellent"
            - option "Fair"
            - option "Poor"
        - generic [ref=e538]:
          - button "Reset ID" [ref=e539]
          - button "Purge" [ref=e543]
      - table [ref=e548]:
        - rowgroup [ref=e549]:
          - row [ref=e550]:
            - columnheader "Timeline" [ref=e551] [cursor=pointer]
            - columnheader "Disposition" [ref=e555] [cursor=pointer]
            - columnheader "Site" [ref=e557] [cursor=pointer]
            - columnheader "Endpoint" [ref=e559] [cursor=pointer]
            - columnheader "Src Port" [ref=e561] [cursor=pointer]
            - columnheader "Loss / MOS" [ref=e563] [cursor=pointer]
            - columnheader "RTT / Jitter" [ref=e565] [cursor=pointer]
        - rowgroup [ref=e567]:
          - row [ref=e568]:
            - cell "02:27:08 PM" [ref=e569]
            - cell "#CALL-0060" [ref=e570]:
              - 'generic "Source Port: 30060" [ref=e572]': "#CALL-0060"
            - cell "DC1" [ref=e575]
            - cell "192.168.203.100:6100" [ref=e576]
            - cell [ref=e577]:
              - button "30060" [ref=e578]
            - cell "—" [ref=e579]
            - cell "—" [ref=e580]
          - row [ref=e581]:
            - cell "02:27:08 PM" [ref=e582]
            - cell "#CALL-0057" [ref=e583]:
              - 'generic "Source Port: 30057" [ref=e585]': "#CALL-0057"
            - cell "DC1" [ref=e590]
            - cell "192.168.203.100:6100" [ref=e591]
            - cell [ref=e592]:
              - button "30057" [ref=e593]
            - 'cell "0% loss MOS: 4.4" [ref=e594]':
              - generic [ref=e595]:
                - generic [ref=e596]: 0% loss
                - generic [ref=e599]: "MOS: 4.4"
            - 'cell "12.28ms Jitter: 12.33ms" [ref=e600]':
              - generic [ref=e601]:
                - generic [ref=e602]: 12.28ms
                - generic [ref=e603]: "Jitter: 12.33ms"
          - row [ref=e604]:
            - cell "02:27:07 PM" [ref=e605]
            - cell "#CALL-0059" [ref=e606]:
              - 'generic "Source Port: 30059" [ref=e608]': "#CALL-0059"
            - cell "BR2-Ubuntu" [ref=e611]
            - cell "192.168.206.10:6100" [ref=e612]
            - cell [ref=e613]:
              - button "30059" [ref=e614]
            - cell "—" [ref=e615]
            - cell "—" [ref=e616]
          - row [ref=e617]:
            - cell "02:27:07 PM" [ref=e618]
            - cell "#CALL-0056" [ref=e619]:
              - 'generic "Source Port: 30056" [ref=e621]': "#CALL-0056"
            - cell "BR1-Ubuntu" [ref=e626]
            - cell "192.168.207.10:6100" [ref=e627]
            - cell [ref=e628]:
              - button "30056" [ref=e629]
            - 'cell "0% loss MOS: 4.37" [ref=e630]':
              - generic [ref=e631]:
                - generic [ref=e632]: 0% loss
                - generic [ref=e635]: "MOS: 4.37"
            - 'cell "40.73ms Jitter: 31.44ms" [ref=e636]':
              - generic [ref=e637]:
                - generic [ref=e638]: 40.73ms
                - generic [ref=e639]: "Jitter: 31.44ms"
          - row [ref=e640]:
            - cell "02:27:04 PM" [ref=e641]
            - cell "#CALL-0058" [ref=e642]:
              - 'generic "Source Port: 30058" [ref=e644]': "#CALL-0058"
            - cell "DC1" [ref=e647]
            - cell "192.168.203.100:6100" [ref=e648]
            - cell [ref=e649]:
              - button "30058" [ref=e650]
            - cell "—" [ref=e651]
            - cell "—" [ref=e652]
          - row [ref=e653]:
            - cell "02:27:04 PM" [ref=e654]
            - cell "#CALL-0055" [ref=e655]:
              - 'generic "Source Port: 30055" [ref=e657]': "#CALL-0055"
            - cell "BR1-Ubuntu" [ref=e662]
            - cell "192.168.207.10:6100" [ref=e663]
            - cell [ref=e664]:
              - button "30055" [ref=e665]
            - 'cell "0% loss MOS: 4.36" [ref=e666]':
              - generic [ref=e667]:
                - generic [ref=e668]: 0% loss
                - generic [ref=e671]: "MOS: 4.36"
            - 'cell "36.89ms Jitter: 42.3ms" [ref=e672]':
              - generic [ref=e673]:
                - generic [ref=e674]: 36.89ms
                - generic [ref=e675]: "Jitter: 42.3ms"
          - row [ref=e676]:
            - cell "02:26:33 PM" [ref=e677]
            - cell "#CALL-0057" [ref=e678]:
              - 'generic "Source Port: 30057" [ref=e680]': "#CALL-0057"
            - cell "DC1" [ref=e683]
            - cell "192.168.203.100:6100" [ref=e684]
            - cell [ref=e685]:
              - button "30057" [ref=e686]
            - cell "—" [ref=e687]
            - cell "—" [ref=e688]
          - row [ref=e689]:
            - cell "02:26:33 PM" [ref=e690]
            - cell "#CALL-0054" [ref=e691]:
              - 'generic "Source Port: 30054" [ref=e693]': "#CALL-0054"
            - cell "DC1" [ref=e698]
            - cell "192.168.203.100:6100" [ref=e699]
            - cell [ref=e700]:
              - button "30054" [ref=e701]
            - 'cell "0% loss MOS: 4.4" [ref=e702]':
              - generic [ref=e703]:
                - generic [ref=e704]: 0% loss
                - generic [ref=e707]: "MOS: 4.4"
            - 'cell "16.52ms Jitter: 5.05ms" [ref=e708]':
              - generic [ref=e709]:
                - generic [ref=e710]: 16.52ms
                - generic [ref=e711]: "Jitter: 5.05ms"
          - row [ref=e712]:
            - cell "02:26:32 PM" [ref=e713]
            - cell "#CALL-0056" [ref=e714]:
              - 'generic "Source Port: 30056" [ref=e716]': "#CALL-0056"
            - cell "BR1-Ubuntu" [ref=e719]
            - cell "192.168.207.10:6100" [ref=e720]
            - cell [ref=e721]:
              - button "30056" [ref=e722]
            - cell "—" [ref=e723]
            - cell "—" [ref=e724]
          - row [ref=e725]:
            - cell "02:26:32 PM" [ref=e726]
            - cell "#CALL-0053" [ref=e727]:
              - 'generic "Source Port: 30053" [ref=e729]': "#CALL-0053"
            - cell "BR2-Ubuntu" [ref=e734]
            - cell "192.168.206.10:6100" [ref=e735]
            - cell [ref=e736]:
              - button "30053" [ref=e737]
            - 'cell "0.1% loss MOS: 4.39" [ref=e738]':
              - generic [ref=e739]:
                - generic [ref=e740]: 0.1% loss
                - generic [ref=e743]: "MOS: 4.39"
            - 'cell "25.91ms Jitter: 15.12ms" [ref=e744]':
              - generic [ref=e745]:
                - generic [ref=e746]: 25.91ms
                - generic [ref=e747]: "Jitter: 15.12ms"
          - row [ref=e748]:
            - cell "02:26:29 PM" [ref=e749]
            - cell "#CALL-0055" [ref=e750]:
              - 'generic "Source Port: 30055" [ref=e752]': "#CALL-0055"
            - cell "BR1-Ubuntu" [ref=e755]
            - cell "192.168.207.10:6100" [ref=e756]
            - cell [ref=e757]:
              - button "30055" [ref=e758]
            - cell "—" [ref=e759]
            - cell "—" [ref=e760]
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
  74  |         throw new Error(
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
> 93  |         throw new Error(`Expected gateway WRITE: ${method} ${apiPath} via →${PEER_LABEL}\nGW writes:\n${gw}\nLocal writes:\n${local}`);
      |               ^ Error: Expected gateway WRITE: POST /api/voice/control via →BR8
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
  175 |             assertGWRead('/api/security/config');
  176 |             assertGWRead('/api/security/profile');
  177 |             // Scores dashboard loads async — wait for it before asserting
  178 |             await waitNoLoading(page, 'Loading Score Dashboard', 15_000);
  179 |             assertGWRead('/api/security/scores');
  180 |         });
  181 | 
  182 |         test('Voice: data reads from BR8', async ({ page }) => {
  183 |             await goToTab(page, 'Voice');
  184 |             await waitNoLoading(page, 'Loading');
  185 |             await page.waitForTimeout(1_500);
  186 |             assertGWRead('/api/voice/config');
  187 |             assertGWRead('/api/voice/ingress');
  188 |         });
  189 | 
  190 |         test('IoT: data reads from BR8', async ({ page }) => {
  191 |             await goToTab(page, 'IoT');
  192 |             await waitNoLoading(page, 'Loading');
  193 |             await page.waitForTimeout(2_000);
```