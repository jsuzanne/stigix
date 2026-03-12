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

The HTTP service (v1.2.1+) provides specific endpoints to validate SD-WAN policies, SLA performance, and security rules.

### 1. Health Check
**Endpoint:** `GET /ok`
- **Response:** `200 OK`
- **Use Case:** Verify basic connectivity and path availability.

```bash
curl http://<target-ip>:8082/ok
```

### 2. "Slow App" Simulation
**Endpoint:** `GET /slow`
- **Behavior:** Returns immediately OR waits X seconds based on the active **Mode**.
- **Use Case:** Test SD-WAN "Path Quality" policies. For example, switch the target to "Slow Mode" to trigger a brownout (high latency), causing the SD-WAN edge to steer traffic to a backup link.

**Configuration Modes:**
| Mode | Behavior |
|------|----------|
| `NORMAL` | Immediate response (< 10ms) |
| `ALWAYS_SLOW` | Always waits `SLOW_DELAY_SECONDS` (default: 5s) |
| `RANDOM_SLOW` | Randomly delays based on probability (default: 50%) |
| `LOOPING_SLOW` | Toggles between Fast/Slow every 60s |

**Control API:**
Change the mode dynamically without restarting the container:
```bash
# Set to Slow Mode (Trigger failover)
curl "http://<target-ip>:8082/set-mode?mode=ALWAYS_SLOW"

# Set back to Normal (Trigger failback)
curl "http://<target-ip>:8082/set-mode?mode=NORMAL"
```

### 3. Security (EICAR)
**Endpoint:** `GET /eicar.com.txt`
- **Response:** Standard EICAR test string with correct headers.
- **Use Case:** Validate **Threat Prevention / IPS** policies. Downloading this file should be BLOCKED by your firewall/SD-WAN edge.

```bash
# Should be blocked
curl http://<target-ip>:8082/eicar.com.txt
```

---

## ⚙️ Configuration

Configure the service via environment variables in your `docker-compose.yml`:

```yaml
services:
  # Voice Echo, Convergence, iperf3, HTTP
  voice-echo:
    image: jsuzanne/sdwan-voice-echo:latest
    environment:
      - DEBUG=True
      # HTTP Service Config
      - TARGET_HTTP_PORT=8082          # Listen port
      - SLOW_DELAY_SECONDS=5           # Latency in slow mode
      - LOOP_SLOW_SECONDS=60           # Duration of slow phase
      - LOOP_NORMAL_SECONDS=60         # Duration of normal phase
      - RANDOM_SLOW_PROBABILITY=0.5    # Chance of slow response

  # XFR Speedtest Target
  xfr-target:
    image: jsuzanne/xfr-target:latest
    container_name: xfr-target
    network_mode: "host"
    restart: unless-stopped
    environment:
      - XFR_PORT=9000
      - XFR_MAX_DURATION=60
      - XFR_RATE_LIMIT=2
      - XFR_ALLOW_CIDR=0.0.0.0/0
```

> See [XFR_TESTING.md](XFR_TESTING.md) for complete XFR configuration reference.

---

## 🧪 Quick Verification

Run these commands from your Traffic Generator (or any client):

```bash
# 1. Check Reachability
curl -v http://<target-ip>:8082/ok

# 2. Baseline Latency (Should be fast)
time curl http://<target-ip>:8082/slow

# 3. Simulate Degradation
curl "http://<target-ip>:8082/set-mode?mode=ALWAYS_SLOW"

# 4. Verify Latency (Should be ~5s)
time curl http://<target-ip>:8082/slow
```
