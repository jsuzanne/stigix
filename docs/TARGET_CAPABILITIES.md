# Target Site Capabilities

In Stigix, **every instance is both a Source and a Target.** By default, when you deploy a Stigix node (All-in-One), it automatically starts a suite of responsive services. This means any node can act as a destination for traffic generation, SLA monitoring, and performance validation from any other peer in the network.

---

## 🚀 Available Services (Active by Default)

| Service | Port | Protocol | Purpose |
|---------|------|----------|---------|
| **Voice Echo** | 6100-6101 | UDP | Reflects RTP packets for VoIP MOS scoring |
| **Convergence** | 6200 | UDP | High-precision echo for measuring failover time |
| **Bandwidth (iperf3)** | 5201 | TCP/UDP | Standard `iperf3` server for throughput testing |
| **App Simulation** | 8082 | TCP | HTTP server for SLA and Security testing |
| **XFR Speedtest** | 9000 | TCP/UDP/QUIC | High-performance throughput testing with deterministic ports |

---

## 🌐 HTTP Application Simulation (Port 8082)

The HTTP service provides specific endpoints to validate SD-WAN policies, SLA performance, and security rules. This service is now natively integrated and manageable via the **Stigix Dashboard**.

### 1. Dashboard Control
You can manage the local target service behavior directly from the **Settings > Targets** tab. 
- **Real-time Status**: Monitor if the service is online.
- **Mode Switching**: Toggle modes (Normal, Slow, Random, Looping) with a single click.
- **Persistence**: Configuration is saved to `/app/config/target-config.json` and survives restarts.

### 2. Modes of Operation
| Mode | Behavior |
|------|----------|
| `NORMAL` | Immediate response (< 10ms) |
| `ALWAYS_SLOW` | Always waits `SLOW_DELAY_SECONDS` (default: 5s) |
| `RANDOM_SLOW` | Randomly delays based on probability (default: 50%) |
| `LOOPING_SLOW` | Toggles between Fast/Slow every 60s |

### 3. Key Endpoints
- **Health Check**: `GET /ok` -> Returns `200 OK`.
- **"Slow App" Simulation**: `GET /slow` -> Response delay depends on the active Mode.
- **Security (EICAR)**: `GET /eicar.com.txt` -> Returns the EICAR test string to validate IPS/Threat policies.
- **Status API**: `GET /api/status` -> Returns current mode and parameters in JSON format.

---

## ⚙️ Configuration

While the **Dashboard** is the preferred way to manage the service, it still supports environment variables for initial bootstrapping or headless deployments:

```yaml
services:
  stigix:
    image: jsuzanne/stigix:latest
    environment:
      - DEBUG=True
      # HTTP Service Config
      - TARGET_HTTP_PORT=8082          # Listen port
      - SLOW_DELAY_SECONDS=5           # Latency in slow mode
      - LOOP_SLOW_SECONDS=60           # Duration of slow phase
      - LOOP_NORMAL_SECONDS=60         # Duration of normal phase
      - RANDOM_SLOW_PROBABILITY=0.5    # Chance of slow response
      - TARGET_CONFIG_PATH=/app/config/target-config.json
```

---

## 🧪 Quick Verification

Run these commands from your Traffic Generator (or any client):

```bash
# 1. Check Reachability
curl -v http://<target-ip>:8082/ok

# 2. Baseline Latency (Should be fast)
time curl http://<target-ip>:8082/slow

# 3. Verify via Status API
curl http://<target-ip>:8082/api/status
```
