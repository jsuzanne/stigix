# STIGIX – SD-WAN & SASE Use Cases

## Use Case 1 – SaaS Traffic Generation

Generate and monitor realistic background traffic to popular SaaS applications with weighted distribution and live dashboards.

```mermaid
flowchart LR
    subgraph Branch["Branch Site"]
        TG["STIGIX Traffic Generator<br/>(sdwan-traffic-gen)"]
        UI["Web UI<br/>(stigix)"]
    end

    subgraph WAN["SD-WAN / SASE Fabric"]
        SDWAN["SD-WAN Edge / SASE"]
    end

    subgraph Cloud["SaaS Cloud Apps"]
        M365["Microsoft 365"]
        GWS["Google Workspace"]
        SFDC["Salesforce"]
        OtherSaaS["Other SaaS Apps"]
    end

    UI -->|"App weights, start/stop"| TG
    TG -->|"HTTPS, weighted per app"| SDWAN
    SDWAN -->|"Optimized paths, security inspection"| Cloud
    SDWAN <-->|"Return traffic"| TG
```

## Use Case 2 – Digital Experience Monitoring (DEM)

Measure DNS, TCP, TLS, and TTFB for configured targets and compute a synthetic experience score.

```mermaid
sequenceDiagram
    participant User as Engineer
    participant UI as STIGIX UI
    participant Probe as DEM Engine
    participant DNS as DNS Server
    participant App as Target App/API
    participant SASE as SASE / SD-WAN

    User->>UI: Configure targets (ICMP/TCP/HTTP/HTTPS)
    UI->>Probe: Save probe config
    loop Continuous Probing
        Probe->>DNS: DNS query
        DNS-->>Probe: Response + latency
        Probe->>SASE: TCP/TLS handshake to App
        SASE->>App: Forward request
        App-->>SASE: First Byte (TTFB)
        SASE-->>Probe: Response
        Probe-->>UI: DNS/TCP/TLS/TTFB metrics + Score
    end
```

## Use Case 3 – SD-WAN Overlay Availability

Continuously ping remote Branch and DC LAN IPs to validate overlay health and keep history.

```mermaid
flowchart LR
    subgraph Branch["Branch Site"]
        TG["STIGIX Probe Engine"]
        Edge["SD-WAN Edge"]
    end

    subgraph Core["Core / DC"]
        DC1["DC LAN IPs"]
        DC2["Hub LAN IPs"]
    end

    TG -->|"ICMP ping probes"| Edge
    Edge -->|"Overlay tunnels"| DC1
    Edge -->|"Overlay tunnels"| DC2

    TG <-->|"Latency, loss, up/down history"| Edge
```

## Use Case 4 – Inter-Site Bandwidth Speedtest

Run TCP/UDP/QUIC bandwidth tests between instances (Branch↔DC, Branch↔Branch) with live throughput.

```mermaid
sequenceDiagram
    participant UI as STIGIX UI
    participant TG as Branch STIGIX
    participant SDWAN as SD-WAN Fabric
    participant Target as XFR Target / Remote STIGIX

    UI->>TG: Start XFR test (TCP/UDP/QUIC, bitrate, duration)
    TG->>Target: Data streams (N parallel flows)
    activate TG
    loop During Test
        TG->>SDWAN: Probe flows across overlay paths
        Target-->>TG: Throughput + loss behavior
        TG-->>UI: Live Mbps, RTT, loss graphs
    end
    deactivate TG
    TG-->>UI: Final report per direction / protocol
```

## Use Case 5 – Security Testing (URL / DNS / Threat / EDL)

Validate URL filtering, DNS security, Threat Prevention, and EDLs with scheduled tests and history.

```mermaid
flowchart TB
    subgraph Branch["Branch / Lab Site"]
        UI["STIGIX Security UI"]
        Engine["Security Test Engine"]
        Edge["NGFW / SASE Edge"]
    end

    subgraph Internet["Internet / Test Targets"]
        URLSet["66 URL Categories"]
        DNSSet["24 DNS Test Domains"]
        EICAR["EICAR Test File Endpoint"]
        EDLHost["EDL Source URLs"]
    end

    UI -->|"Schedules, policies"| Engine
    Engine -->|"HTTP(S) URL tests"| Edge
    Engine -->|"DNS queries"| Edge
    Engine -->|"EICAR download attempt"| Edge
    Engine -->|"EDL sync / lookups"| Edge

    Edge -->|"Allow/Block/Sinkhole decisions"| Internet
    Edge -->> Engine: Logs, verdicts
    Engine -->> UI: History, scores, export
```

## Use Case 6 – IoT Simulation

Simulate cameras, sensors, and smart plugs with real DHCP/ARP/L2 behavior to test segmentation, security, and failover.

```mermaid
flowchart LR
    subgraph Branch["Branch LAN"]
        TG["STIGIX IoT Engine"]
        DHCP["Real DHCP Server<br/>(Router/Core Switch)"]
        Edge["SD-WAN / NGFW"]
        Cam["Simulated Camera"]
        Sensor["Simulated Sensor"]
        Plug["Simulated Smart Plug"]
    end

    TG -->|"Scapy L2/L3 packets"| Cam
    TG -->|"Scapy L2/L3 packets"| Sensor
    TG -->|"Scapy L2/L3 packets"| Plug

    Cam -->|"DHCP Discover/Request"| DHCP
    DHCP -->|"IP Lease"| Cam
    Cam -->|"ARP replies, cloud traffic"| Edge
    Sensor -->|"Telemetry to cloud"| Edge
    Plug -->|"Control / heartbeat"| Edge

    Edge -->|"Policies, segmentation (IoT VRF/Guest VLAN)"| Internet
```

## Use Case 7 – VoIP Simulation

Generate RTP calls (G.711/G.729) against a voice echo target to measure MOS, jitter, loss, and latency.

```mermaid
sequenceDiagram
    participant User as Engineer
    participant UI as STIGIX UI
    participant Voice as VoIP Engine
    participant SDWAN as SD-WAN Edge
    participant Echo as Voice Echo Target (6100/6101)

    User->>UI: Configure codec profile (G.711/G.729), calls, duration
    UI->>Voice: Start voice session(s)
    loop Call Duration
        Voice->>SDWAN: RTP streams to Echo
        SDWAN->>Echo: Forward RTP
        Echo-->>SDWAN: Echoed RTP
        SDWAN-->>Voice: Return RTP
        Voice-->>UI: MOS, R-value, jitter, loss, latency
    end
    UI-->>User: Voice quality report per path
```

## Use Case 8 – Convergence & VyOS Impairment

Measure sub‑second failover with Convergence Lab and orchestrate controlled impairments on VyOS.

### 8.1 Convergence Lab

```mermaid
sequenceDiagram
    participant UI as STIGIX UI
    participant Conv as Convergence Engine
    participant Echo as Target Site (UDP 6200)
    participant SDWAN as SD-WAN / Prisma SD-WAN

    UI->>Conv: Start test (CONV-0042, 50 pps)
    loop Probing
        Conv->>Echo: UDP probe (src 30042, dst 6200)
        Echo-->>Conv: Echo reply
    end
    note over SDWAN: Path failover / tunnel switch occurs
    Conv-->>UI: Blackout window, loss, latency, verdict
```

### 8.2 VyOS Control

```mermaid
flowchart LR
    subgraph Controller["STIGIX Controller"]
        UI["VyOS Control UI"]
        VyEngine["VyOS Orchestrator"]
    end

    subgraph WAN["SD-WAN Under Test"]
        Vy1["VyOS Router 1"]
        Vy2["VyOS Router 2"]
    end

    UI -->|"Sequences (latency, loss, rate-limit, blocks)"| VyEngine
    VyEngine -->|"API / SSH commands"| Vy1
    VyEngine -->|"API / SSH commands"| Vy2

    Vy1 -->|"Apply netem, interface up/down"| WAN
    Vy2 -->|"Apply netem, interface up/down"| WAN

    WAN -->|"Impaired paths"| ConvergenceLab["Convergence / Voice / XFR Tests"]
    ConvergenceLab -->|"KPIs vs impairment timeline"| UI
```
