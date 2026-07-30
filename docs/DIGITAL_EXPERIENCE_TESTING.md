# Digital Experience Testing (DEM)

The **Digital Experience Monitoring (DEM)** (formerly Synthetic Endpoints / Connectivity Probes) provides real-time visibility into the health and performance of critical application targets by simulating user traffic patterns.

*Main DEM dashboard showing real-time health scores for all monitored applications:*
![Digital Experience Dashboard](screenshots/04-Performance/01-digital-experience-dashboard.png)


---

## 📡 Available Probe Types

The platform supports various probe types, each measuring different aspects of the digital experience:

### 📋 Probe Specifications & Default Parameters

| Probe Type | Protocol | Default Polling Frequency | Default Timeout | Max Retries | Retry Delay (Dynamic) | Description |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **HTTP** | HTTP/HTTPS | **300 seconds** | 5,000 ms | 2 (3 attempts total) | 1s to 5s (`timeout / 10`) | Web application response & metrics (`curl`) |
| **HTTPS** | HTTPS | **300 seconds** | 5,000 ms | 2 (3 attempts total) | 1s to 5s (`timeout / 10`) | Secure web application response & TLS metrics (`curl`) |
| **PING** | ICMP Echo | 60 seconds | 2,000 ms | 2 (3 attempts total) | 1s to 5s (`timeout / 10`) | Network reachability & RTT (`ping`) |
| **DNS** | DNS Query | 60 seconds | 3,000 ms | 2 (3 attempts total) | 1s to 5s (`timeout / 10`) | Domain resolution speed (`dig` to server) |
| **TCP** | TCP Handshake | 60 seconds | 3,000 ms | 2 (3 attempts total) | 1s to 5s (`timeout / 10`) | Port reachability & handshake (`nc`) |
| **UDP** | UDP Traffic | 60 seconds | 3,000 ms | 2 (3 attempts total) | 1s to 5s (`timeout / 10`) | Voice/real-time quality (`iperf3` client) |
| **CLOUD** | HTTP/HTTPS | **300 seconds** | 15,000 ms | 2 (3 attempts total) | 1s to 5s (`timeout / 10`) | Cloudflare POP egress & SaaS emulation (`curl`) |

> [!NOTE]
> **Dynamic Retry Delay**: The delay between retries is automatically scaled according to the probe's timeout setting:
> $$\text{Retry Delay} = \max(1000\text{ ms}, \min(5000\text{ ms}, \lfloor\text{Timeout} / 10\rfloor))$$
> This guarantees that probes with longer timeouts wait longer between attempts to avoid spamming the target resource, while probes with shorter timeouts retry quickly to minimize detection lag.

### 1. HTTP/HTTPS (Digital Experience)
- **Mechanism**: Orchestrates a native OS `curl` subprocess to perform HTTP/HTTPS `GET` queries.
- **Primary Benefit**: `curl` provides military-grade precision for extracting intricate low-level execution timings out-of-the-box, allowing us to perfectly isolate DNS lookup delays, TCP Handshake times, and TLS Handshake overhead from the raw Time-To-First-Byte (TTFB).
- **Metrics**: 
  - **Latency (ms)**: Total Time to first byte breakdown.
  - **Status**: Success (2xx/3xx) or Failure (4xx/5xx/Timeout).
- **Scoring**: Weighted calculation: `100 - (30% Latency + 35% TTFB + 25% TLS)`. Penalized heavily if Latency > 2s, TTFB > 1s, or TLS Handshake > 800ms.

### 2. PING (Network Reachability)
- **Mechanism**: Executes the native OS `ping` binary to dispatch ICMP Echo Requests.
- **Primary Benefit**: Using the host's native `ping` utility intelligently avoids the strict capability/root privileges required to open raw ICMP sockets programmatically, ensuring secure, unprivileged execution environments (like Docker containers) map reachability flawlessly.
- **Metrics**: 
  - **RTT (ms)**: Round-trip time.
- **Scoring**: Good if < 100ms (Score 100). Reaches 0 at 500ms.

### 3. DNS (Resolution Speed)
- **Mechanism**: Queries the target domain leveraging the `dig` system utility.
- **Primary Benefit**: `dig` bypasses systemic OS-level caching interfaces, providing the exact unadulterated response time of the raw nameserver for highly faithful resolution mapping.
- **Metrics**:
  - **Resolution Time (ms)**: Real-world mapping speed.
- **Scoring**: Good if < 80ms (Score 100). Reaches 0 at 400ms.

### 4. UDP (Voice/Real-time Quality)
- **Mechanism**: Triggers an `iperf3` client process (`-u` mode) aimed at the target port.
- **Primary Benefit**: `iperf3` is the undisputed industry standard for UDP throughput mapping. It intrinsically calculates complex networking permutations including packet loss percentages and millisecond Jitter natively without requiring manual script math.
- **Scoring**: `100 - (Loss % * 10) - Jitter penalty`. Jitter over 30ms reduces the score (max -50). 10% packet loss results in a score of **0**.

### 5. TCP (Port Reachability)
- **Mechanism**: Executes `nc` (Netcat) to simulate a standard TCP socket connection.
- **Primary Benefit**: Netcat securely tests port exposure and firewall routing viability without risking incomplete handshakes that some specialized application daemons reject.

## 🏆 Scoring Methodology

All probes return a score from **0 to 100**. The system stores the **Minimum**, **Maximum**, and **Average** score of each probe over time to facilitate long-term performance tracking and future alerting capabilities.

*Detailed status table highlighting endpoint reliability and score distribution:*
![Endpoints Status and Reliability](screenshots/04-Performance/02-endpoints-status-table.png)


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
- **Interval (Frequency)**: Tunable per-probe in the UI (Min: `30s`, Max: `3600s`). Default values are **type-aware**:
  - **HTTP / HTTPS / CLOUD**: default **300 seconds** (5 min). HTTP/HTTPS probes execute up to 2 sequential `curl` calls (metrics + optional content match body), so a longer default avoids queue congestion when many probes are active.
  - **PING / TCP / UDP / DNS**: default **60 seconds**. These probes are lightweight and benefit from higher polling frequency.
- **Lifecycle**: The monitor independently checks each endpoint timestamp against its configured frequency threshold and fires off the specialized connectivity probe autonomously.

### 2. Flaky Detection
The platform tracks "Flakiness" to distinguish between a temporary blip and a hard outage:
- An endpoint is marked as **FLAKY** if it fails a probe but recently succeeded.
- It is marked as **DOWN** if it fails multiple consecutive probes.

### 3. Automatic Updates
The UI (`Dashboard.tsx`) receives these updates in real-time via the `/api/status` endpoint. The labels and status colors (Green = UP, Yellow = FLAKY, Red = DOWN) are adjusted dynamically.

---

## 🛠️ Configuration

You can manage monitoring probes via the **Settings > Synthetic Probes** UI:

*Centralized configuration menu for managing synthetic probe protocols and intervals:*
![Synthetic Probes Configuration](screenshots/01-Configuration/01-synthetic-probes-settings.png)


### Adding a Custom Probe
1. Navigate to **Advanced Diagnostics > Add Custom Probe**.
2. Fill in the probe details in the configuration modal.
3. Click **Save Configuration**.

*Configuration modal for adding custom HTTP, PING, or UDP targets:*
![Add New Probe Modal](screenshots/01-Configuration/03-add-probe-modal.png)


**Fields:**
- **Probe Name**: A short, uppercase tracking label (e.g., "HQ-GATEWAY", "OFFICE365-UDP").
- **Protocol**: Select from HTTP, HTTPS, ICMP (Ping), TCP, DNS, UDP Stream, or Stigix Cloud.
- **Timeout (ms)**: Max execution ceiling before the probe is marked failed. Tunable between `1000ms` (1s) and `60000ms` (60s). Default is `5000ms` for HTTP/HTTPS, `2000ms` for PING.
- **Freq (s)**: The polling cycle loop time for the background engine. Tunable between `30s` and `3600s`. Defaults: **HTTP/HTTPS/CLOUD = 300s**, PING/TCP/UDP/DNS = 60s.
- **Target**: The FQDN (google.com), socket (1.1.1.1:53), or IP address.
- **Enable Content Matching** *(HTTP/HTTPS only)*: Optional body verification — see [Content Matching](#-content-matching-httphttps-only) below.

*Real-time view of active monitoring probes and their current polling status:*
![Active Monitoring Probes List](screenshots/01-Configuration/02-active-monitoring-probes.png)


> [!TIP]
> Use the **HTTP (Scoring)** type for public SaaS applications to get a realistic measure of application-level latency.

---

## 🔍 Content Matching (HTTP/HTTPS only)

Since `v1.4.1-patch.34`, HTTP and HTTPS probes support optional **response body verification**.

When enabled, after the normal timing measurement (DNS/TCP/TLS/TTFB), a second bounded body fetch (capped at **10 KB**, **3 s timeout**) checks whether the response body contains or does not contain a specified text string.

> [!IMPORTANT]
> The normal timing metrics (DNS, TCP, TLS, TTFB) are **never affected** by content matching — they come from the first curl call. The body fetch only adds overhead for probes that have content matching explicitly enabled.

### Configuration

| Field | Description |
|---|---|
| **Match mode** | `contains` — pass only if text found. `not_contains` — pass only if text absent. |
| **Expected text** | Plain text, max 80 characters. |
| **Case sensitive** | Optional. Default: off. |

### Result Fields

Each probe capture with content matching enabled includes:

```
content_match_enabled  true / false
content_match_mode     contains | not_contains
content_match_value    expected text (max 80 chars)
content_match_result   "matched" | "text not found" | "text unexpectedly found"
                       | "body empty" | "fetch error"
content_match_ok       true | false
```

When `content_match_ok` is `false`, the probe **score is forced to 0** — regardless of HTTP status code. The probe detail modal shows:
- A color-coded banner (🟢 green = matched, 🔴 red = failed, 🟣 violet = waiting for first result)
- A `match ok` / `match fail` annotation below the HTTP Code in Recent Captures

### Recommended Frequency

HTTP/HTTPS probes with content matching enabled should use a polling frequency of **≥ 300s** (the default). Content matching adds a second sequential curl call which, combined with other probes in the queue, can extend effective poll intervals if frequency is set too low.

### CLI

When adding an HTTP/HTTPS probe interactively with `stigix-cli.py probes add`, the CLI will prompt:
```
Enable content matching? [y/N]: y
Match mode — (1) contains / (2) not_contains [1]: 1
Expected text (max 80 chars): Welcome
Case sensitive? [y/N]: N
```

Or pass directly via the probe JSON config.

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

### 📊 Deep Telemetry & Metrics
Since `v1.2.2-patch.132`, all Cloud Probes leverage a robust native `curl` execution backend instead of the simplistic Node.js fetch interface.

*Stacked area chart decomposing application latency into DNS, TCP, TLS, and TTFB layers:*
![Timing Analysis Stacked Chart](screenshots/04-Performance/03-timing-analysis-modal.png)


- This unlocks **Military-grade timing metrics** for Cloud Probes: DNS Resolution, TCP Handshake, TLS Handshake, and TTFB.
- The UI features a dedicated **Timing Analysis Stacked Area Chart** inside the Probe detail modal, explicitly mapping these 4 timing layers over time for rapid bottleneck identification.

#### Timing Breakdown Examples:
*Performance baseline for Salesforce showing stable resolution and handshake timings:*
![Salesforce Performance](screenshots/04-Performance/04-timing-analysis-salesforce.png)

*Analysis of a slow application identifying high TTFB as the primary bottleneck:*
![Slow Application Analysis](screenshots/04-Performance/06-timing-analysis-slow-app.png)

*Synthetic wave pattern used for validating alerting and threshold sensitivity:*
![Wave (Sine) Pattern](screenshots/04-Performance/05-timing-analysis-wave.png)


### 🛠️ Configuration
The Cloud base URL is automatically derived from your **Stigix Registry** domain (e.g., `stigix-target.stigix.io`).

You can override this in your `.env` file if needed:
```bash
# Example override for custom staging environment
STIGIX_TARGET_BASE_URL=https://stigix-staging.workers.dev
```

> [!NOTE]
> Probes requiring authentication (Shared Key) are automatically signed by the backend using your `STIGIX_TARGET_SHARED_KEY`.
