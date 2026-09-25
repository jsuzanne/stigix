// ── Embedded Markdown Documents for 100% Offline & Local file:// Support ──
window.EMBEDDED_DOCS_CONTENT = {
  "When Routing Can't See the Failure Application-Aware Failover with Prisma SD-WAN.md": `# When Routing Can't See the Failure: Application-Aware Failover with Prisma SD-WAN

Sep 25, 2026 · Jean-Louis SUZANNE, Technical Sales Manager, Palo Alto Networks

## Executive summary

Prisma SD-WAN rerouted a branch's backhauled internet traffic to a backup data center in about 3 minutes, in a failure where every route, link and tunnel stayed up. A network relying only on Layer 3 signals would have kept sending that traffic into a black hole until someone intervened.

Three minutes is not fast, and this paper says so plainly. But the alternative is not a faster failover: it is no failover at all. Without session awareness, the branch keeps sending these applications to a dead exit until an engineer diagnoses the problem and changes the configuration, which typically takes far longer.

The failure tested here is common and hard to catch: a data center's internet breakout stops working while the data center itself remains reachable. Routing protocols, BFD and link state only verify the next hop. None of them checks whether an application session actually gets established end to end.

Prisma SD-WAN does. Its **Application Unreachability Detection** watches TCP session establishment per application and per destination prefix. When sessions keep failing on a path, that path is excluded for the application, new sessions move to an alternate path, and reachability probes bring traffic back once the original path works again.

| Scenario | Failover to backup DC | Failback after repair |
| --- | --- | --- |
| Hard failure: DC1 internet interface shut down | ~3 min | Automatic, driven by probes |
| Silent failure: 100% packet loss, interface up | ~5 min 20 s | Automatic, ~2 min after repair |

In both cases, direct internet traffic from the branch was never affected. Only the applications backhauled through DC1 were impacted, and only until the automatic failover.

All tests were run and measured with [Stigix](https://github.com/jsuzanne/stigix), a network test platform for SD-WAN labs.

## The problem: a failure behind a healthy next hop

Many enterprises backhaul part of their branch internet traffic to a data center. It goes through a central security stack and a central internet breakout. Microsoft 365 authentication and mail, or sensitive SaaS applications, are typical examples.

In this design, the branch sees the data center as the next hop. The data center then forwards the traffic to its own internet exit. If that exit fails, the branch has no direct way to notice:

- The branch's WAN circuits are up.
- The SD-WAN tunnels to the data center are up and pass keepalives.
- The routes toward the data center, including any default route learned from it, are still valid.

From the branch, everything looks healthy. Yet every new connection to a backhauled application fails. This is a "grey failure": the network is up, but the service is down.

## Why Layer 3 mechanisms are blind to it

Traditional failover mechanisms answer one question: is my next hop reachable? None of them asks whether the application session behind that next hop succeeds.

| Mechanism | What it verifies | Detects a dead breakout behind DC1? |
| --- | --- | --- |
| Interface / link state | The local physical or logical link is up | No: the branch links are up |
| BFD | The neighbor answers, in milliseconds | No: DC1 answers normally |
| Routing protocol (BGP, OSPF) | The route is still advertised | No, unless the DC withdraws its default route on failure |
| SD-WAN tunnel keepalives | The tunnel to DC1 is up | No: the tunnel stays up |
| Prisma SD-WAN Application Unreachability Detection | TCP sessions for this app and prefix complete on this path | **Yes**: sessions stop completing |

A routed design can partly cover this case with extra engineering: conditional default-route advertisement, or IP SLA tracking toward a few internet targets. These still test a handful of probe destinations, not the applications themselves. They also require careful design and testing at each data center.

The silent-failure test in this paper is exactly the case where these routing signals never fire. The interface stays up, routes stay in place, and only the applications fail.

## How Prisma SD-WAN handles it: Application Unreachability Detection

Prisma SD-WAN judges a path by whether application sessions succeed on it, not only by whether the path is up. This capability is called [Application Unreachability Detection](https://docs.paloaltonetworks.com/prisma-sd-wan/administration/prisma-sd-wan-stacked-policies/prisma-sd-wan-applications/configure-system-application-overrides), and it is enabled by default for TCP applications.

The cycle has four stages:

1. **Detection.** For TCP applications, the ION pairs each request leaving the LAN with its response from the WAN: a SYN with its SYN-ACK, or an application request with its acknowledgment. A SYN with no SYN-ACK is an *initiation failure*. A request left unanswered is a *transaction failure*.
2. **Verification.** The ION then probes the same destination prefix and port, on the same path. The path is declared unreachable only if the probe gets no answer and no other client has a successful session to that application and prefix on that path.
3. **Exclusion and failover.** The path is marked unreachable for that application and destination prefix. New flows matching them skip that path, and path selection continues with the remaining candidates, such as the backup data center group.
4. **Recovery.** The ION keeps probing the excluded path. As soon as a probe succeeds, the path is usable again and new sessions return to it.

Two details matter in practice: Reachability is tracked per application, per destination prefix and per path, so one broken service never drags a whole link down. And if no alternate path is available or allowed by policy, the flow stays on its path rather than being dropped.

## Test results

Both failures were detected and bypassed automatically: backhauled traffic moved to DC2's internet exit, then returned to DC1 once the exit was repaired. All times below are UTC, on 25 September 2026, taken from the Prisma SD-WAN Flow Browser.

| Metrics | Phase A: hard failure | Phase B: silent failure |
| --- | --- | --- |
| Failure injected | eth3 shut down | 100% loss on eth3, interface up |
| First path change | ~60 s, to BR8-INET1 → DC1-INET | ~140 s, to BR8-INET1 → DC1-INET |
| Failover to DC2 internet exit | **~3 min** | **~5 min 20 s** |
| Failback to DC1 after repair | Automatic, probe-driven | Automatic, ~1 min 50 s after repair |
| Impact on direct internet traffic | None | None |

### Phase A: hard failure breakdown

| Time | Event |
| --- | --- |
| ~06:51:15 | eth3 shut down on vyoslandc1 |
| 06:51–06:52 | New sessions still sent via BR8-INET2 → DC1-INET; every handshake fails (2 SYN packets, 0 bytes back) |
| 06:52:14.4 | Sessions moved to BR8-INET1 → DC1-INET, still toward DC1, still failing |
| **06:54:15.6** | **DC1 paths excluded; sessions moved to DC2-INET and succeed immediately** |
| 06:54–07:02 | Stable on DC2, load-shared across both BR8 circuits |
| ~07:02 | eth3 restored |
| **07:02:27.1** | **Probes succeed; sessions back on BR8-INET2 → DC1-INET** |

### Phase B: silent failure breakdown

| Time | Event |
| --- | --- |
| 07:05:54 | 100% loss applied on eth3; first failing sessions via BR8-INET2 → DC1-INET |
| 07:08:14.5 | Sessions moved to BR8-INET1 → DC1-INET, still toward DC1, still failing |
| **07:11:13.7** | **DC1 paths excluded; sessions moved to DC2-INET; first full responses at 07:11:22.8** |
| 07:11–07:14 | Stable on DC2 |
| before 07:14:31 | 100% loss removed |
| 07:14–07:16 | New sessions stay on DC2; DC2 now shown as the preferred path |
| **07:16:19.8** | **Probes succeed; sessions back on BR8-INET1 → DC1-INET** |

## Lessons and design recommendations

1. **Always give backhauled applications an alternate path.** Unreachability Detection can only fail over if the path policy allows another path.
2. **Keep Unreachability Detection on for backhauled TCP applications.** It is enabled by default.
3. **Designate a probe source interface.** On the ION 1000, a LAN port must be configured for application probes.
4. **Set the right expectations.** Tunnel failures take seconds (< 2s). Failures behind a data center take 3 to 5 minutes.
5. **Combine both layers for critical applications.** Pair session awareness with data-center-side signals.
6. **Test grey failures, not only cable pulls.** Packet loss with the interface up behaves differently.
`,

  "SDWAN_Failover_Executive_Report.docx.md": `> **Last Updated:** 2026-09-24 | **Created:** 2026-09-24 (v2.0.63)

# SD-WAN Failover Validation — Executive Summary Report
*BR8 (Branch) ↔ DC1 / DC2 — Site Resilience Test Series | September 22, 2026*

## 1. Executive Summary

This report summarizes a series of three controlled failover tests performed against the BR8 branch site's connectivity to the primary datacenter (DC1), including a full simulated site-level outage with automatic reroute to the secondary datacenter (DC2).

Across all three scenarios, failover consistently completed within 7.3 to 8.1 seconds. Traffic was successfully rerouted in every test, including full recovery via the DC2 datacenter interconnect when both direct DC1 circuits were taken down simultaneously.

**Key takeaway:** a 7-8 second convergence time exceeds the tolerance of live real-time sessions (voice/video calls), which would drop during the transition.

## 2. Test Methodology

Each test generated live synthetic voice traffic and a continuous convergence probe (50 packets/second) from BR8 toward DC1, then deliberately impaired or removed BR8's WAN connectivity to DC1.

* **Test 1 — Single circuit failure:** the DC1 internet circuit was degraded (+200ms latency) then taken fully down.
* **Test 2 — Total site failure (hard):** both DC1 circuits were taken down simultaneously with no prior warning.
* **Test 3 — Total site failure (progressive):** both DC1 circuits were first degraded, then cut in sequence roughly 90 seconds later.

## 3. Results Summary

| Scenario | Overall loss | Max blackout | Avg RTT | Verdict |
| :--- | :--- | :--- | :--- | :--- |
| **Test 1 — Single link cut (DC1 internet only)** | 3.2% | 7.78 s | 35.7 ms | BAD |
| **Test 2 — Dual link cut (total DC1 outage)** | 2.9% | 8.12 s | 6.9 ms | BAD |
| **Test 3 — Degrade then dual cut (total DC1 outage)** | 2.7% | 7.31 s | 68.0 ms | BAD |

## 4. Customer Impact by Test

### Test 1 — Single Link Failure (DC1 Internet)
* **Path before failure:** BR8-INET2 → DC1-INET
* **Path after failure:** BR8-INET1 → DC1-INET (alternate WAN member, same site)
* **Blackout duration:** 7.78 seconds | **Packet loss:** 3.2% overall (1.4% uplink / 1.9% downlink)

### Test 2 — Total DC1 Outage (Hard Cut)
* **Path before failure:** BR8-INET1 → DC1-INET
* **Path during failure:** BR8-INET1 → DC2-INET (rerouted via DC1↔DC2 interconnect)
* **Blackout duration:** 8.12 seconds | **Packet loss:** 2.9% overall

### Test 3 — Total DC1 Outage (Degrade, then Hard Cut)
* **Degradation phase:** ~90 seconds at +200ms latency on both DC1 circuits
* **Blackout duration:** 7.31 seconds | **Packet loss:** 2.7% overall

## 5. Recommendations
* Review the SD-WAN health-probe / BFD dead-timer configuration on BR8's paths to DC1 if sub-2-second failover is required.
* Communicate the current ~7-8 second failover window to stakeholders who depend on real-time traffic.
`,

  "Microsoft Probe analysis Report Report (EN).md": `> **Last Updated:** 2026-09-24 | **Created:** 2026-09-24 (v2.0.63)

# Microsoft 365 Probe Performance Analysis – BR5 & BR8
*Sep 23, 2026 · Jean-Louis SUZANNE*

## Executive summary

Microsoft 365 services are 100% reachable from both sites, but the experience is clearly degraded at BR5, where response times are 6 to 16 times higher than at BR8.

- **BR8: good experience.** Services that respond normally (Entra ID, Teams, Graph, M365 portal) load in 150 to 350 ms median.
- **BR5: degraded experience.** The same services take 1.6 to 2.8 s median. The issue is not Microsoft-specific: a ping to 1.1.1.1 takes 150 ms from BR5 versus 4 ms from BR8. BR5's Internet access adds about 145 ms to every round trip.
- **Scores need context.** Exchange Online, SharePoint and Azure Portal return 401, 403 or 417 codes because the probes query the pages without authentication.

## BR5 results

All services respond (100% availability), but none goes below 700 ms. The node's overall health score is 49/100.

| Probe | HTTP code | Success | Median total (ms) | Max (ms) | TCP (ms) | TLS (ms) | TTFB (ms) | Avg score |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| MS - Entra ID | 200 | 8/8 | 2,788 | 2,962 | 296 | 1,314 | 915 | 13 |
| MS - Graph API | 200 | 7/7 | 2,387 | 2,620 | 298 | 983 | 776 | 18 |
| MS - M365 Portal | 200 | 7/7 | 2,208 | 2,497 | 296 | 1,014 | 346 | 35 |
| MS - Teams | 200 | 8/8 | 1,578 | 4,417 | 149 | 855 | 670 | 35 |
| MS - SharePoint | 401 | 7/7 | 902 | 1,029 | 149 | 476 | 278 | 20 |
| MS - Exchange Online | 417 | 8/8 | 878 | 1,512 | 151 | 435 | 365 | 20 |
| MS - Azure Portal | 403 | 7/7 | 775 | 846 | 150 | 446 | 153 | 20 |

## BR8 results

Six of the seven services respond quickly and consistently; SharePoint is the only weak spot. The node's overall health score is 70/100.

| Probe | HTTP code | Success | Median total (ms) | Max (ms) | TCP (ms) | TLS (ms) | TTFB (ms) | Avg score |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| MS - Entra ID | 200 | 5/5 | 318 | 460 | 40 | 111 | 142 | 86 |
| MS - M365 Portal | 200 / 301 | 5/5 | 261 | 5,079 | 27 | 119 | 31 | 82 |
| MS - Teams | 200 | 5/5 | 254 | 382 | 13 | 39 | 162 | 89 |
| MS - Graph API | 200 | 5/5 | 149 | 247 | 13 | 63 | 52 | 94 |
| MS - Exchange Online | 417 | 5/5 | 88 | 159 | 11 | 50 | 29 | 20 |
| MS - Azure Portal | 403 | 5/5 | 59 | 104 | 7 | 32 | 3 | 20 |
| MS - SharePoint | 401 / failed | 2/5 | 5,001 | 5,002 | – | – | 117 | 38 |

## Comparison Summary

| Baseline Probe | BR8 | BR5 |
| :--- | :--- | :--- |
| Ping 1.1.1.1 (ms) | 4 | 150 |
| Ping 8.8.8.8 (ms) | 6 | 150 |
| Ping Hetzner server (ms) | 32 | 29 |
| Google Search, TCP connection (ms) | 7 | 149 |
| Salesforce, TCP connection (ms) | 6 | 152 |
`,

  "Making-of How Stigix Powered the Prisma SD-WAN Failover Tests.md": `# Making-of: How Stigix Powered the Prisma SD-WAN Failover Tests

Sep 25, 2026 · Jean-Louis SUZANNE, Technical Sales Manager, Palo Alto Networks

## Why a test platform

The white paper *When Routing Can't See the Failure* shows that Prisma SD-WAN fails over when a data center's internet breakout dies, even though every route and tunnel stays up. This making-of explains how those results were produced, and what [Stigix](https://github.com/jsuzanne/stigix) did at each step.

Failover testing is easy to do badly. Pull a cable, refresh a web page, and you learn almost nothing: not when the failure started, not which path the traffic took, not what users actually felt. A useful test needs four things:

- **Realistic traffic** running before, during and after the failure, so there is something to fail over.
- **Controlled, repeatable failures**, injected at a known point and a known time.
- **Measurements from several angles**: packets, application sessions, voice quality, and the SD-WAN's own path decisions.
- **A timeline** that ties all of these together to the second.

Stigix provided all four from one place. And because it exposes its functions through the Model Context Protocol (MCP), the whole campaign could be driven by an AI assistant, Claude, under an engineer's supervision.

## The lab as Stigix sees it

Stigix runs as a small agent on a Linux host at each site. The agents form a mesh, with DC1's node acting as leader, and each can generate traffic toward the others. On top of the SD-WAN itself, three Stigix integrations did the heavy lifting.

**Stigix nodes (traffic endpoints):**

| Node | Address | Role in the tests |
| --- | --- | --- |
| BR8-Ubuntu | 192.168.219.1 | Test source: all traffic, probes and measurements start here |
| DC1-Ubuntu | 192.168.203.100 | Target in DC1 for convergence probes, speed tests and TCP apps; mesh leader |
| BR1, BR2, BR5 nodes | 192.168.207.10, 192.168.206.10, 192.168.217.5 | Control targets: voice calls and TCP sessions that should not be affected |

**VyOS routers (failure injection):**

| Router | What it emulates | Interfaces used in the tests |
| --- | --- | --- |
| vyosrouter | The underlay: every site's internet and MPLS circuits | eth10, DC1-INET-221 (DC1's internet circuit, carrying the SD-WAN tunnels) |
| vyoslandc1 | DC1's LAN and central internet breakout | eth3, DC1 INTERNET EXIT (the breakout behind DC1) |

## The Stigix toolbox used in the tests

| Stigix capability | What it did | What it proved |
| --- | --- | --- |
| Application traffic generator | Continuous simulated SaaS traffic from BR8 (Microsoft 365, Google, Salesforce, Dropbox), logged with HTTP codes | Backhauled apps failing during outage, recovering after failover |
| Convergence probes | A UDP flow at 50 pps from BR8 to DC1, echoed back | Maximum blackout, loss per direction (in % and ms), verdict |
| Voice simulation | 30-second G.711 calls from BR8 to DC1, BR1 and BR2 | Loss, jitter and MOS per call (e.g. MOS 1.48 during cut) |
| Custom TCP applications | Persistent TCP sessions from BR8 to DC1, BR2 and BR5 | Sessions to DC1 break on failover, survive failback |
| Speed tests | TCP and UDP throughput tests, upstream and downstream | Link capacity baseline, up to ~200 Mbit/s upstream |
| VyOS control | Interface shutdown/restore, latency/loss injection | Failure start and end times, to the millisecond |
| Prisma SD-WAN Flow Browser | Flows filtered by address/port with path decisions | Which path the SD-WAN chose, and exactly when it changed |

## The earlier campaign: when the tunnel itself fails

| Measurement | Stigix source | Result |
| --- | --- | --- |
| Maximum blackout | Convergence probe | 7.7 to 9.3 s over eight runs, 8.6 s on average |
| First path decision after cut | VyOS commit timestamp + Flow Browser | 0.9 to 1.8 s (two runs with exact timestamps) |
| Loss per direction | Convergence probe (echo) | ~3 s upstream, ~5 s downstream |
| Voice call caught by cut | Voice simulation | 26% loss, MOS 1.48 |
| Voice call during outage via DC2 | Voice simulation | No loss, MOS 4.4 |
| TCP sessions to DC1 | Custom TCP apps | Dropped at cut, reconnected in ~3 s via DC2 |

## Stigix MCP interface

Stigix exposes more than 80 MCP tools, covering every function used in these tests. The MCP interface makes Stigix **orchestratable in natural language**. An engineer describes a scenario and an AI assistant chains the exact Stigix calls, reads results, and builds the timeline.
`
};
