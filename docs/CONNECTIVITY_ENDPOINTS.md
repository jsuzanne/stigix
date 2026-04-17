# Connectivity Probes: Digital Experience Monitoring (DEM)

The **Connectivity Probes** (formerly Synthetic Endpoints) provide real-time visibility into the health and performance of critical application targets by simulating user traffic patterns.

---

## 📡 Available Probe Types

The platform supports three primary probe types, each measuring different aspects of the digital experience:

### 1. HTTP (Digital Experience)
- **Mechanism**: Performs a standard HTTP/HTTPS `GET` request to the target.
- **Metrics**: 
  - **Latency (ms)**: Time to first byte.
  - **Status**: Success (2xx/3xx) or Failure (4xx/5xx/Timeout).
- **Scoring**: Weighted calculation: `100 - (30% Latency + 35% TTFB + 25% TLS)`. Penalized heavily if Latency > 2s, TTFB > 1s, or TLS Handshake > 800ms.

### 2. PING (Network Reachability)
- **Mechanism**: Sends standard ICMP Echo Requests.
- **Metrics**: 
  - **RTT (ms)**: Round-trip time.
- **Scoring**: Good if < 100ms (Score 100). Reaches 0 at 500ms.

### 3. DNS (Resolution Speed)
- **Mechanism**: Queries the target domain.
- **Metrics**:
  - **Resolution Time (ms)**: Real-world mapping speed.
- **Scoring**: Good if < 80ms (Score 100). Reaches 0 at 400ms.

### 4. UDP (Voice/Real-time Quality)
- **Mechanism**: UDP reachability probe.
- **Scoring**: `100 - (Loss % * 10) - Jitter penalty`. Jitter over 30ms reduces the score (max -50). 10% packet loss results in a score of **0**.

## 🏆 Scoring Methodology

All probes return a score from **0 to 100**.

| Score | Rating | Meaning |
| :--- | :--- | :--- |
| **80 - 100** | **Excellent** | Optimal performance, no user impact. |
| **50 - 79** | **Fair** | Noticeable latency or jitter; potential for degraded experience. |
| **1 - 49** | **Poor** | Severe degradation; high probability of user complaints. |
| **0** | **Critical** | Resource unreachable or returning server error (HTTP 5xx). |

---

## ⚙️ How it Works

### 1. Background Execution
Probes are managed by the **Background Monitor** inside the Node.js backend (`server.ts`).
- **Orchestration Engine**: Since `v1.2.2-patch.41`, the backend operates an asynchronous concurrent ticker loop checking state every 10 seconds. This ensures probes don't block one another if they timeout.
- **Interval (Frequency)**: Can be strictly tuned per-probe natively in the UI dashboard (Min: `30s`, Max: `3600s`). Defaults to **60 seconds**.
- **Lifecycle**: The monitor independently checks each endpoint timestamp against its configured frequency threshold and fires off the specialized connectivity probe autonomously.

### 2. Flaky Detection
The platform tracks "Flakiness" to distinguish between a temporary blip and a hard outage:
- An endpoint is marked as **FLAKY** if it fails a probe but recently succeeded.
- It is marked as **DOWN** if it fails multiple consecutive probes.

### 3. Automatic Updates
The UI (`Dashboard.tsx`) receives these updates in real-time via the `/api/status` endpoint. The labels and status colors (Green = UP, Yellow = FLAKY, Red = DOWN) are adjusted dynamically.

---

## 🛠️ Configuration

You can add custom probes via the **Connectivity Settings** UI (Advanced Diagnostics > Add Custom Probe):
- **Probe Name**: A short, uppercase tracking label (e.g., "HQ-GATEWAY", "OFFICE365-UDP").
- **Protocol**: Select from HTTP, HTTPS, ICMP (Ping), TCP, DNS, UDP Stream, or Stigix Cloud.
- **Timeout (ms)**: Max execution ceiling before the probe is marked failed. Tunable between `1000ms` (1s) and `60000ms` (60s). Default is typically `5000` (or `2000` for ping).
- **Freq (s)**: The polling cycle loop time for the background engine. Tunable between `30s` and `3600s`.
- **Target**: The FQDN (google.com), socket (1.1.1.1:53), or IP address.

> [!TIP]
> Use the **HTTP (Scoring)** type for public SaaS applications to get a realistic measure of application-level latency.
---

## ☁️ Stigix Cloud (Shared Probes)

Shared probes are hosted on the **Stigix Cloudflare infrastructure**. They provide a set of pre-configured scenarios that are accessible to all PoCs and tenants without manual configuration.

### 📋 Available Scenarios

| Scenario | Target Path | Description | Evaluation / Scoring |
| :--- | :--- | :--- | :--- |
| **Info / Egress** | `/saas/info` | Identifies your public IP, Country, and POP. | Success = **100** |
| **Slow SaaS** | `/saas/slow` | Simulates a 5s backend delay. | **Score 100** if < 200ms; reaches **0** at 5s. |
| **Large Download** | `/download/large` | 10MB payload download. | **Score 100** if < 1s; reaches **0** at 10s. |
| **Security (EICAR)** | `/security/eicar` | Downloads the EICAR test string. | Success Reachable = **100** |
| **Error (500/503)** | `/saas/error/*` | Simulates server-side failures (5xx). | Failure = **0** |

### 🛠️ Configuration
The Cloud base URL is automatically derived from your **Stigix Registry** domain (e.g., `stigix-target.stigix.io`).

You can override this in your `.env` file if needed:
```bash
# Example override for custom staging environment
STIGIX_TARGET_BASE_URL=https://stigix-staging.workers.dev
```

> [!NOTE]
> Probes requiring authentication (Shared Key) are automatically signed by the backend using your `STIGIX_TARGET_SHARED_KEY`.
