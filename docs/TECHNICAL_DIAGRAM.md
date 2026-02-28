# Technical Communication Flow

This diagram illustrates the flows between the various containers and external targets.

```mermaid
graph TD
    subgraph "Branch Site (Source)"
        UI["sdwan-web-ui<br/>(Dashboard & API :8080)"]
        HTTP_GEN["sdwan-traffic-gen<br/>(HTTP Generator)"]
        VOICE_GEN["sdwan-voice-gen<br/>(RTP Generator)"]
        IOT_GEN["IOT_SIM<br/>(Scapy-based Engine)"]
    end

    subgraph "SD-WAN Fabric (Underlay/Overlay)"
        Tunnel["Encrypted Tunnels<br/>(IPsec / GRE / SD-WAN)"]
        Gateway["Local Gateway<br/>(DHCP / ARP Target)"]
    end

    subgraph "Target Site / Data Center"
        ECHO["sdwan-voice-echo<br/>(UDP Echo Server :6200)"]
        IPERF["iperf3 Server<br/>(:5201)"]
    end

    subgraph "Public Internet"
        CLOUD["SaaS / Cloud Apps<br/>(Google, AWS, etc.)"]
    end

    %% Flow Definitions
    UI -- "1. Monitor / Control" --> HTTP_GEN
    UI -- "1. Monitor / Control" --> VOICE_GEN
    UI -- "1. Monitor / Control" --> IOT_GEN
    
    HTTP_GEN -- "HTTP/S Traffic" --> Tunnel
    VOICE_GEN -- "RTP (UDP/6200)" --> Tunnel
    UI -- "iperf3 Client / Speedtest" --> Tunnel
    
    IOT_GEN -- "DHCP / ARP / L2" --> Gateway
    IOT_GEN -- "SaaS Traffic" --> Tunnel
    
    Tunnel -- "Relayed Packets" --> ECHO
    Tunnel -- "Bandwidth Tests" --> IPERF
    Tunnel -- "SaaS Simulation" --> CLOUD

    ECHO -- "RTP Loopback" --> Tunnel
    Tunnel -- "Echo Result" --> VOICE_GEN
```

## Protocol & Port Table

| Flow Type | Protocol | Port(s) | Source | Target |
|-----------|----------|---------|--------|--------|
| **Dashboard UI** | TCP | 8080 | User Browser | `sdwan-web-ui` |
| **Background HTTP**| TCP | 80, 443 | `sdwan-traffic-gen` | Internet / Cloud |
| **Convergence/Voice**| UDP | 6200 | `sdwan-voice-gen` | `sdwan-voice-echo` |
| **IoT L2 (DHCP)** | UDP | 67, 68 | `sdwan-web-ui/IOT` | Gateway |
| **IoT Discovery** | UDP | 1900, 5353 | `sdwan-web-ui/IOT` | Local Subnet |
| **Iperf3 Test** | TCP/UDP | 5201 | `sdwan-web-ui` | `iperf3 server` |
| **Speedtest** | TCP | 80, 443 | `sdwan-web-ui` | Public Ookla Servers |
| **API Control** | TCP | 8080 | Dashboard | Orchestrator Engine |

