# Validating Real Network Impairments with Stigix Custom TCP Applications

> **Audience**: Network Engineers, SD-WAN Architects, SASE Validation Engineers, POC Evaluators.  
> **Scope**: Layer 7 application observability during underlay network impairments, packet loss, jitter injection, and link failovers.

---

## 1. Overview & Objective

When evaluating SD-WAN appliances (Prisma SD-WAN, Fortinet, Cisco Catalyst SD-WAN, VMware VeloCloud, Silver Peak) or underlay network topologies, network engineers frequently rely on **Layer 3/4 ICMP ping or raw UDP echo** to observe link performance.

However, **ICMP and UDP cannot reflect real enterprise application behavior**:
- ICMP packets are stateless and small (64 bytes); they do not reflect TCP congestion window (`cwnd`) degradation, window scaling, or TCP head-of-line blocking.
- Real line-of-business applications (**SAP ERP, Core Banking, Database Sync, Point-of-Sale (POS) registers, SCADA**) use **stateful, long-lived TCP sessions** with structured request/reply cadences and compute delays.

**Stigix Custom TCP Applications** provide a faithful digital replica of enterprise applications across your overlay tunnels. This document explains how the module detects, measures, and visualizes **real network impairments introduced in the underlay or intermediate routers (e.g. VyOS, WAN emulators, physical link pull)** between the client and server.

```
┌──────────────────────────────┐                         ┌──────────────────────────────┐
│       STIGIX CLIENT          │                         │       STIGIX SERVER          │
│   (Branch Office / Spoke)    │                         │    (Datacenter / Hub)        │
│                              │                         │                              │
│ • State Machine              │                         │ • TCP Host Listener (:8443)  │
│ • Req/Reply Workload         │                         │ • Echo / Fixed Delay Server  │
│ • Rolling RTT (p50/p95)      │                         │ • Inbound Session Tracker    │
└──────────────┬───────────────┘                         └──────────────▲───────────────┘
               │                                                        │
               ▼                                                        │
     ┌──────────────────┐                                     ┌──────────────────┐
     │  SD-WAN Branch   │                                     │    SD-WAN Hub    │
     │      Router      │                                     │      Router      │
     └─────────┬────────┘                                     └─────────▲────────┘
               │                                                        │
    ═══════════╪════════════════════════════════════════════════════════╪═══════════
               │          UNDERLAY NETWORK IMPAIRMENTS                  │
               │   (VyOS netem / WAN Loss / Jitter / Link Flap)        │
               ├─────────────────────────┬──────────────────────────────┤
               │   WAN-1 (Primary MPLS)  │ [ CUT / PACKET LOSS / DELAY ]│
               │   WAN-2 (Backup 4G/5G)  │ [ SUB-SECOND FAILOVER ]      │
               └─────────────────────────┴──────────────────────────────┘
```

---

## 2. Server vs. Network Impairments: Clear Distinction

It is critical to distinguish between **Server-side Software Simulation** and **Real Underlay Network Perturbations**:

| Aspect | Server Simulation Mode | Underlay Network Impairment (This Guide) |
| :--- | :--- | :--- |
| **Origin** | Inside the Stigix Server software engine (Application Layer). | On the physical wire, intermediate routers, or WAN emulator (VyOS `netem`). |
| **Purpose** | Simulates application processing delays (e.g. SQL query taking 500ms). | Simulates physical line degradation, fiber cuts, or SD-WAN tunnel degradation. |
| **Server Configuration** | Server set to `fixed_delay`, `random_delay`, or `drop_response`. | Server set to **`echo`** or **`fixed_delay (0-10ms)`** as an ideal reference responder. |
| **Observed Effect** | Server intentionally delays or drops frames after receiving them. | Network drops packets, inflates RTT via retransmissions, or breaks TCP sockets. |

---

## 3. Network Impairment Scenarios & Detection Mechanics

### Scenario A: Network Latency & Jitter Injection

**How the network perturbation is applied** (e.g. on intermediate VyOS router):
```bash
# Inject 80ms latency with 15ms jitter on WAN-1
sudo tc qdisc add dev eth1 root netem delay 80ms 15ms
```

**How Stigix Custom TCP detects it**:
1. **Per-Transaction Timestamping**:
   - For every synthetic request sent, the client records an atomic microsecond timestamp `sentTs` in `pendingRequests`.
   - When the server's `RESPONSE` frame is received, the client measures:
     $$\text{RTT} = \text{Date.now()} - \text{pending.sentTs}$$
2. **Rolling Percentile Calculation ($p50$ and $p95$)**:
   - Measurements are fed into a 200-sample sliding window (`RollingRttTracker`).
   - Stigix calculates in real-time:
     - **$\text{RTT}_{\text{avg}}$**: Mean round-trip time across all active sessions.
     - **$p50$ (Median)**: Represents typical steady-state transaction latency.
     - **$p95$ (95th Percentile)**: Instantly reveals jitter bursts and outlier delays caused by network queue buffering.
3. **SLA Health Score Impact**:
   - The Health Score (0–100) automatically penalizes high latency according to defined thresholds:
     - $\text{RTT} < 50\text{ ms}$: Full 15/15 SLA points (`OPTIMAL`).
     - $50 - 150\text{ ms}$: 10/15 points (`HEALTHY`).
     - $150 - 300\text{ ms}$: 5/15 points (`DEGRADED`).
     - $\text{RTT} > 300\text{ ms}$ or $p95 > 2000\text{ ms}$: 0 points and application status switches to **`DEGRADED`**.

---

### Scenario B: Network Packet Loss & Congestion

**How the network perturbation is applied**:
```bash
# Inject 5% random packet loss on WAN-1
sudo tc qdisc add dev eth1 root netem loss 5%
```

**How Stigix Custom TCP detects it**:
1. **TCP Retransmissions & Congestion Window Collapse**:
   - At the Linux TCP kernel stack, lost packets cause TCP Duplicate ACKs and Fast Retransmissions.
   - The effective application RTT spikes due to retransmission timeouts (RTO). This is immediately visible as sharp peaks on the live RTT graph.
2. **Application Transaction Timeouts**:
   - If packet loss is high enough that a response frame fails to return before `requestTimeoutMs` (default: **`5000 ms`**):
     - The per-request timer fires.
     - The `totalTimeouts` counter increments.
     - The request is removed from `pendingRequests` and marked as failed.
3. **Transaction Success Ratio Degradation**:
   - The ratio $\frac{\text{Responses Received}}{\text{Requests Sent}}$ drops below 100%.
   - The Request/Reply Success component (25 pts) in the Health Score degrades in proportion to the loss.
4. **Socket Tear-down on Severe Loss**:
   - If loss causes TCP keepalive failure or connection reset (`ETIMEDOUT` / `ECONNRESET`), the socket closes, and the client transitions to **`RECONNECTING`**.

*Real-time Custom TCP Applications Dashboard with multi-app profiles, client/server status, and live latency percentiles:*
![Custom Apps Dashboard Overview](screenshots/11-Custom-Apps/01-custom-apps-dashboard-overview.png)

---

### Scenario C: Link Cut, Cable Pull & SD-WAN Dynamic Failover

**How the network perturbation is applied**:
- Physical cable unplug on WAN-1 interface, or VyOS interface shutdown:
```bash
# Disable WAN-1 to force SD-WAN path failover to WAN-2
sudo ip link set dev eth1 down
```

**How Stigix Custom TCP detects and handles the Failover**:

```
      T0 (Nominal)               T1 (Link Cut)                     T2 (SD-WAN Shift)              T3 (Recovered)
┌───────────────────────┐   ┌───────────────────────────┐    ┌───────────────────────────┐   ┌───────────────────────┐
│ State: CONNECTED      │   │ State: RECONNECTING       │    │ SD-WAN updates route      │   │ State: CONNECTED      │
│ Traffic: 10 req/s     │──▶│ Sockets: Broken (RST/TO)  │───▶│ Traffic re-routed to      │──▶│ Traffic resumes       │
│ RTT: 12ms (MPLS)      │   │ Timeouts: Accumulating    │    │ Backup Link (4G/LTE)      │   │ RTT: 75ms (4G/LTE)    │
│ Score: 100 [OPTIMAL]  │   │ Score: 25 [CRITICAL]      │    │ Backoff Reconnect fires   │   │ Score: 85 [HEALTHY]   │
└───────────────────────┘   └───────────────────────────┘    └───────────────────────────┘   └───────────────────────┘
```

1. **Immediate Disruption Detection**:
   - **Clean Break (TCP RST / ICMP Unreachable)**: The socket `error` and `close` events trigger within milliseconds.
   - **Silent Blackhole (Traffic dropped without ICMP/RST)**: The `requestTimeoutMs` timer (5s) or TCP Keepalive destroys the socket.
   - The session state indicator immediately switches to **`RECONNECTING`** (amber pulsing dot).
2. **Bounded Exponential Backoff with Jitter**:
   - To prevent connection storms while the SD-WAN establishes the backup tunnel, the client reconnects using bounded exponential backoff with full randomized jitter:
     $$\text{Reconnect Delay} = \min\left(30000\text{ ms}, 1000\text{ ms} \times 1.5^{\text{attempts} - 1}\right) \times \left(0.5 + 0.5 \times \text{random}()\right)$$
3. **Seamless Autonomous Recovery**:
   - The instant the SD-WAN completes tunnel establishment and routing switchover to WAN-2:
     1. The client socket successfully establishes a new TCP connection on the destination host port.
     2. The `CLIENT_HELLO` $\rightarrow$ `SERVER_HELLO` handshake revalidates authentication and application identity.
     3. Active transaction requests resume automatically.
     4. **Zero human intervention or UI reloads are required**.

---

## 4. Key Observability KPIs & Downtime Calculation

When executing failover or impairment tests, monitor these 4 primary metrics on the **Custom Apps** dashboard:

| Dashboard KPI | Metric Key | How to Interpret During a Test |
| :--- | :--- | :--- |
| **Application Downtime** | `Date.now() - lastSuccessAt` | The exact real-world Layer 7 outage duration experienced by the line-of-business application during failover. |
| **Aborted Transactions** | `totalTimeouts` + `totalErrors` | Quantifies the number of business operations that were lost or timed out during the link transition. |
| **Post-Failover SLA Shift** | $p95$ Latency | Compares the latency before vs. after failover (e.g. 12ms on low-latency MPLS vs. 85ms on backup cellular link). |
| **Composite Health Score** | `health.score` (0–100) | Drops to **`CRITICAL`** ($\le 25$) during the cut, then recovers to **`HEALTHY`** (75–89) or **`OPTIMAL`** (90–100) on the backup path. |

### Health Score Formula Breakdown:
$$\text{Health Score} = \text{Listener Active (25)} + \text{Sessions Connected (35)} + \text{Success Ratio (25)} + \text{Latency SLA (15)}$$

*Detailed incoming/outgoing TCP sessions table with live RTT sparklines, p50/p95 percentiles, and site correlation:*
![Custom App Server Client Sessions](screenshots/11-Custom-Apps/02-custom-app-server-client-sessions.png)

*Interactive Server Behaviors and Chaos Configuration Wizard:*
![Custom App Network Impairments & Behavior Wizard](screenshots/11-Custom-Apps/03-custom-app-network-impairments-modal.png)

---

## 5. Step-by-Step Validation Procedure (Lab Recipe)

Follow this step-by-step procedure in your SD-WAN lab to evaluate application resilience:

### Step 1 — Deploy Reference Application
1. On the **Datacenter Node (Leader)**:
   - Create a Custom TCP App named **`ERP-Core-Benchmark`** on TCP port `:8085`.
   - Set Server Behavior to **`echo`** (pure benchmark responder, 0 artificial delay).
   - In Step 3, enable **`Zero-Touch Auto-Start Traffic`**.
   - Publish the bundle via **Central Global Provisioning**.
2. On the **Branch Node (Peer)**:
   - The peer automatically receives `ERP-Core-Benchmark`, connects 2 sessions to the Datacenter on port `:8085`, and begins transmitting 1 request per second.
   - Verify steady state: Health Score **`100 [OPTIMAL]`**, RTT **`10–15ms`**, 0 Timeouts.

### Step 2 — Inject Progressive Network Latency
1. On your WAN emulator / VyOS:
   ```bash
   # Add 100ms latency
   sudo tc qdisc replace dev eth1 root netem delay 100ms 10ms
   ```
2. Observe Stigix Dashboard:
   - The real-time RTT chart jumps from $12\text{ms}$ to $112\text{ms}$.
   - $p50$ and $p95$ percentiles adjust within seconds.
   - Health score moves to **`HEALTHY (80/100)`** due to the latency SLA threshold.

### Step 3 — Trigger Hard Link Failover
1. Disconnect the primary WAN link on your SD-WAN appliance:
   ```bash
   # Simulate primary fiber cut
   sudo ip link set dev eth1 down
   ```
2. Observe Stigix Dashboard:
   - Sessions enter **`RECONNECTING`**.
   - Health score drops to **`CRITICAL`**.
   - Note the timestamp of the last successful transaction.
3. Observe SD-WAN Tunnel Failover:
   - SD-WAN switches traffic to the backup 4G/LTE path.
   - Stigix client automatically reconnects, completes handshake, and resumes traffic.
   - Calculate total L7 failover time: $\Delta t = \text{Reconnected Timestamp} - \text{Failure Timestamp}$.

---

## 6. Summary: Why Layer 7 Network Observability Matters

| Feature | ICMP Ping / Traceroute | Stigix Custom TCP Applications |
| :--- | :---: | :---: |
| **Transport Layer** | Layer 3 (IP) | Layer 7 (Stateful TCP Sessions) |
| **Session Persistence** | None (Stateless) | Long-lived persistent connections with reconnect backoff |
| **Jitter & Congestion Visibility** | Coarse round-trip sample | Rolling $p50 / p95$ percentiles + payload throughput |
| **Transaction Success Tracking** | Packet loss % | Exact count of completed vs. timed-out application requests |
| **Zero-Touch Multi-Site Orchestration** | Manual script execution | Automatic central distribution and continuous background workload |

Stigix Custom TCP Applications bridge the gap between network infrastructure testing and true application experience validation.
