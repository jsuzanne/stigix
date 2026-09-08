# Target Site Capabilities

In Stigix, **every instance is both a Source and a Target.** By default, when you deploy a Stigix node (All-in-One), it automatically starts a suite of responsive services. This means any node can act as a destination for traffic generation, SLA monitoring, and performance validation from any other peer in the network.

---

## 🚀 Available Services (Active by Default)

| Service | Port | Protocol | Purpose |
|---------|------|----------|---------|
| **Voice Echo** | 6100-6101 | UDP | Reflects RTP packets for VoIP MOS scoring |
| **Convergence** | 6200 | UDP | High-precision UDP echo for measuring SD-WAN failover time |
| **Custom TCP Apps** | 8083, 8443... | TCP | East-West stateful line-of-business apps with configurable latency, jitter & chaos |
| **Bandwidth (iperf3)** | 5201 | TCP/UDP | Standard `iperf3` server for throughput testing |
| **Security Target (EICAR)** | 8082 | TCP | Dedicated HTTP server serving standardized EICAR anti-virus test strings |
| **XFR Speedtest** | 9000 | TCP/UDP/QUIC | High-performance throughput testing with deterministic ports |

---

## 🛡️ EICAR Security Target Service (Port 8082)

The local HTTP service on port 8082 provides a lightweight, dedicated endpoint serving the standardized EICAR anti-virus file for automated NGFW, SASE, IPS, and Threat Prevention verification.

### 1. Key Endpoints
- **Security (EICAR)**: `GET /eicar.com.txt` -> Returns the standardized EICAR test string (`X5O!P%@AP[4\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*`) to validate IPS, Antivirus, and Threat Prevention enforcement.
- **Health Check & Status**: `GET /api/status` or `GET /health` -> Returns service health in JSON format (`{ "status": "ready", "service": "eicar_security_target", "port": 8082 }`).
- **Dashboard Landing Card**: `GET /` -> Dark-mode status card with direct links and endpoint verification.

### 2. Dashboard Integration
In **Settings > Targets**, the **Local Appliance Target & Security Service** card displays:
- **Local Site Name Editor**: Edit and save the appliance site name with instant heartbeat broadcast.
- **EICAR Test Service (AV / IPS Target)**: Direct URL (`http://<inband_ip>:8082/eicar.com.txt`), 1-click clipboard copy button, and direct browser test link.

> 💡 **Note on Latency & Brownout Simulation**:  
> In Stigix V2, WAN brownouts, fixed/random delay, packet drops, and degraded server behaviors are handled natively and with higher precision in the **Custom TCP Apps** engine (`/custom-apps`).

---

## 🎯 Discovered & Remote Targets Repository

Stigix automatically discovers and aggregates all available targets across your SD-WAN mesh in the **Settings > Targets** tab:

### 1. Unified Target Origin Badges
Each target card displays exactly one clear origin badge:
- **`🟢 LOCAL NODE`**: The local Stigix appliance.
- **`⚡ Learned · <time>`**: Targets discovered dynamically via the Target Controller Leader and mesh heartbeats.
- **`📌 Static`**: Targets configured statically in local configuration files or added manually.

### 2. Supported Capabilities Indicator
Target cards feature a compact inline service indicator showing supported capabilities with hover tooltips:
- 🔵 **Voice** (Port 6100)
- 🟣 **Failover / Convergence** (Port 6200)
- 🟢 **Custom TCP Apps** (Active listeners)
- 🔷 **Speedtest / XFR** (Port 9000 / 5201)
- 🔴 **Security / EICAR** (Port 8082)
- 🟢 **Connectivity** (ICMP / HTTP Ping)

---

## 🧪 Quick Verification

Run these commands from your traffic generator (or any remote peer):

```bash
# 1. Download EICAR test file to verify Threat Prevention / Antivirus policy
curl -v http://<target-ip>:8082/eicar.com.txt

# 2. Check Security Target Health
curl -s http://<target-ip>:8082/api/status
```
