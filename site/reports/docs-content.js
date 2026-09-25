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

The cycle above has four stages:

1. **Detection.** For TCP applications, the ION pairs each request leaving the LAN with its response from the WAN: a SYN with its SYN-ACK, or an application request with its acknowledgment. A SYN with no SYN-ACK is an *initiation failure*. A request left unanswered is a *transaction failure*.
2. **Verification.** The ION then probes the same destination prefix and port, on the same path. The path is declared unreachable only if the probe gets no answer and no other client has a successful session to that application and prefix on that path.
3. **Exclusion and failover.** The path is marked unreachable for that application and destination prefix. New flows matching them skip that path, and path selection continues with the remaining candidates, such as the backup data center group.
4. **Recovery.** The ION keeps probing the excluded path. As soon as a probe succeeds, the path is usable again and new sessions return to it.

Two details matter in practice. Reachability is tracked per application, per destination prefix and per path, so one broken service never drags a whole link down. And if no alternate path is available or allowed by policy, the flow stays on its path rather than being dropped.

[Application reachability probes](https://docs.paloaltonetworks.com/prisma-sd-wan/administration/prisma-sd-wan-sites-and-devices/prisma-sd-wan-ports-and-interfaces/configure-application-reachability-probes) are enabled by default on ION devices, except the ION 1000. They are sourced from a LAN interface you designate, or from the controller port. Since release 6.3.2, the same approach also covers UDP DNS traffic.

### Where it fits in path selection

According to Palo Alto's [Dynamic Path Selection](https://docs.paloaltonetworks.com/content/dam/techdocs/en_US/supporting/prisma-sd-wan/Prisma-SD-WAN-Dynamic-Path-Selection.pdf) guide, each new flow goes through a series of filters before a path is chosen:

1. **Policy:** paths allowed by the network and security rules, including active and backup data center groups.
2. **Link status:** physical link, VPN state and Layer 3 reachability, such as BFD and internet checks.
3. **Link quality:** latency, jitter and loss against thresholds (by default 150 ms, 50 ms and 3%, applied to real-time media).
4. **Application performance:** Layer 7 reachability, path affinity and per-application thresholds.
5. **Capacity:** the path with the most available bandwidth wins.

The failure in our test passed steps 1 to 3 unnoticed: links, tunnels, BFD and quality all stayed green. Only step 4, application reachability, caught it. This is the layer that routing-only designs do not have.

Path selection runs again whenever a new flow starts, a path goes up or down, an application becomes unreachable on a path, a threshold is exceeded, or traffic becomes asymmetric.

## The lab scenario

Branch BR8 sends most of its internet traffic directly, and backhauls a few applications to data center DC1 for central breakout. We broke DC1's internet exit and watched how BR8 reacted.

The failure sits one hop behind DC1. BR8's circuits, its tunnels to DC1 and all routes stay up throughout the test. Only the internet exit behind DC1 stops working.

**Topology.** BR8 is internet-only, with two circuits (BR8-INET1 and BR8-INET2) and no MPLS. It builds SD-WAN tunnels to DC1-INET (preferred) and DC2-INET (backup). The path policy sends backhauled applications to DC1, with DC2 as the alternate.

**Backhauled applications observed on BR8:**

| Application | Destinations | Normal path |
| --- | --- | --- |
| Exchange Online (outlook.office365.com) | 52.98.227.162, 52.97.201.34 | BR8-INET2 → DC1-INET |
| Microsoft Entra ID (sign-in) | 40.126.31.0 | BR8-INET2 → DC1-INET |
| Microsoft Teams | 52.123.129.14 | BR8-INET2 → DC1-INET |
| Custom app hosted on Cloudflare | 172.67.212.159, 104.21.53.116 | BR8-INET2 → DC1-INET |

All other internet traffic, such as Google, AWS or GitHub, leaves BR8 directly on its own circuits.

**The two failures injected on vyoslandc1, interface eth3 (DC1 INTERNET EXIT):**

- **Phase A, hard failure:** eth3 administratively shut down.
- **Phase B, silent failure:** 100% packet loss on eth3 egress, interface left up. Routes and link state do not change. This is the case Layer 3 mechanisms cannot see.

## Test results

Both failures were detected and bypassed automatically: backhauled traffic moved to DC2's internet exit, then returned to DC1 once the exit was repaired. All times below are UTC, on 25 September 2026, taken from the Prisma SD-WAN Flow Browser.

|  | Phase A: hard failure | Phase B: silent failure |
| --- | --- | --- |
| Failure injected | eth3 shut down | 100% loss on eth3, interface up |
| First path change | ~60 s, to BR8-INET1 → DC1-INET | ~140 s, to BR8-INET1 → DC1-INET |
| Failover to DC2 internet exit | **~3 min** | **~5 min 20 s** |
| Failback to DC1 after repair | Automatic, probe-driven | Automatic, ~1 min 50 s after repair |
| Impact on direct internet traffic | None | None |

### Phase A: hard failure

| Time | Event |
| --- | --- |
| ~06:51:15 | eth3 shut down on vyoslandc1 |
| 06:51–06:52 | New sessions still sent via BR8-INET2 → DC1-INET; every handshake fails (2 SYN packets, 0 bytes back) |
| 06:52:14.4 | Sessions moved to BR8-INET1 → DC1-INET, still toward DC1, still failing |
| **06:54:15.6** | **DC1 paths excluded; sessions moved to DC2-INET and succeed immediately** |
| 06:54–07:02 | Stable on DC2, load-shared across both BR8 circuits |
| ~07:02 | eth3 restored |
| **07:02:27.1** | **Probes succeed; sessions back on BR8-INET2 → DC1-INET** |

### Phase B: silent failure

| Time | Event |
| --- | --- |
| 07:05:54 | 100% loss applied on eth3; first failing sessions via BR8-INET2 → DC1-INET |
| 07:08:14.5 | Sessions moved to BR8-INET1 → DC1-INET, still toward DC1, still failing |
| **07:11:13.7** | **DC1 paths excluded; sessions moved to DC2-INET; first full responses at 07:11:22.8** |
| 07:11–07:14 | Stable on DC2 |
| before 07:14:31 | 100% loss removed |
| 07:14–07:16 | New sessions stay on DC2; DC2 now shown as the preferred path |
| **07:16:19.8** | **Probes succeed; sessions back on BR8-INET1 → DC1-INET** |

### Reading the results

**Convergence time grows with the number of paths to the failed data center.** Reachability is tracked per path, and BR8 has two paths to DC1, one per internet circuit. Each had to be declared unreachable in turn before DC2 was selected:

|  | Path 1 unreachable (BR8-INET2 → DC1-INET) | Path 2 unreachable (BR8-INET1 → DC1-INET) | Total before DC2 |
| --- | --- | --- | --- |
| Phase A: hard failure | ~60 s | ~2 min later | ~3 min |
| Phase B: silent failure | ~2 min 20 s | ~3 min later | ~5 min 20 s |

A branch with a single internet circuit would have only one path to rule out, so failover should be faster. We did not test that configuration.

**The silent failure took longer to confirm.** A plausible reason: a shut interface produces explicit errors quickly, while a silent drop only produces timeouts. The ION must wait for handshakes to time out before it can conclude. We did not verify this directly.

**Failback is driven by probes, not by routing.** After each repair, the ION's probes on the DC1 path succeeded first, then traffic returned. BR8's tunnels to DC1 stayed up in both phases, so the decision came from session outcomes, not from a tunnel going down.

## Lessons and design recommendations

Session awareness turns an outage that routing cannot see into a bounded, self-healing event of a few minutes. To get the most out of it:

1. **Always give backhauled applications an alternate path.** Unreachability Detection can only fail over if the path policy allows another path. Here, DC2's internet exit was that alternate. Direct internet from the branch is another option for SaaS.
2. **Keep Unreachability Detection on for backhauled TCP applications.** It is enabled by default. Check that application overrides and custom application definitions have not disabled it.
3. **Designate a probe source interface.** On the ION 1000, a LAN port must be configured for application probes. On platforms without a dedicated controller port, such as the ION 1200, 3200, 5200 and 9200, a source interface should be configured.
4. **Set the right expectations.** Tunnel and link failures are detected in seconds. In earlier tests on this lab, a tunnel failure triggered a path decision in under 2 seconds. Failures behind a data center, like a dead breakout, take minutes: about 3 minutes for a hard failure and 5 minutes for a silent one here. Slow, but automatic: in a routing-only design, the same failure has no automatic recovery at all. Expect the delay to grow with the number of branch circuits, since each path to the failed data center is ruled out in turn.
5. **Combine both layers for critical applications.** If minutes are too long, pair session awareness with data-center-side signals, such as a default route withdrawn when the breakout fails. The routing signal gives speed when it fires; session awareness covers the cases where it never does.
6. **Test grey failures, not only cable pulls.** Shutting an interface is the easy case. Packet loss with the interface up is closer to real-world provider failures, and it behaved differently.
7. **Keep test tooling out of the path under test.** In this lab, the router hosting the breakout answered its management traffic through that same breakout. Cutting the exit also cut remote control of the router. Management must use an independent path.

## Methodology and sources

The test ran on a Prisma SD-WAN lab with [Stigix](https://github.com/jsuzanne/stigix) ([github.com/jsuzanne/stigix](https://github.com/jsuzanne/stigix)). Stigix generated continuous application traffic from BR8 and injected failures on the VyOS routers. The Claude AI assistant, connected to Stigix through the Model Context Protocol (MCP), ran the injections, polled the Prisma SD-WAN Flow Browser and rebuilt the timelines. Jean-Louis SUZANNE supervised the test and performed the repair steps on the router console.
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

**VyOS routers (failure injection).** The lab's WAN and data center networks are emulated with VyOS routers that Stigix can drive:

| Router | What it emulates | Interfaces used in the tests |
| --- | --- | --- |
| vyosrouter | The underlay: every site's internet and MPLS circuits | eth10, DC1-INET-221 (DC1's internet circuit, carrying the SD-WAN tunnels) |
| vyoslandc1 | DC1's LAN and central internet breakout | eth3, DC1 INTERNET EXIT (the breakout behind DC1) |

The distinction matters. Cutting eth10 on vyosrouter kills the *tunnels* to DC1, which the SD-WAN sees within seconds. Cutting eth3 on vyoslandc1 kills only the *breakout behind* DC1, which no tunnel or route reveals. The white paper is about the second case.

**Prisma SD-WAN integration.** Stigix queries the Prisma SD-WAN Flow Browser through the Prisma SASE API. For every flow, it returns the chosen path, the preferred path, the path decision history, and packet and byte counters. This turned the SD-WAN's own decisions into test evidence.

## The Stigix toolbox used in the tests

Each Stigix capability answered a different question. Together, they gave a complete picture of every failure.

| Stigix capability | What it did | What it proved |
| --- | --- | --- |
| Application traffic generator | Continuous simulated SaaS traffic from BR8 (Microsoft 365, Google, Salesforce, Dropbox and more), each request logged with its HTTP code and timing | Backhauled apps failing (timeouts) during the outage, and recovering after failover |
| Convergence probes | A UDP flow at 50 packets per second from BR8 to DC1, echoed back | Maximum blackout, loss per direction (in % and ms), verdict |
| Voice simulation | 30-second G.711 calls from BR8 to DC1, BR1 and BR2 | Loss, jitter and MOS per call, e.g. MOS 1.48 for a call caught by the outage |
| Custom TCP applications | Persistent TCP sessions from BR8 to DC1, BR2 and BR5 | Sessions to DC1 break on failover but survive failback; control sessions untouched |
| Speed tests | TCP and UDP throughput tests, upstream and downstream | Link capacity baseline, up to about 200 Mbit/s upstream |
| VyOS control | Interface shutdown and restore, latency and loss injection, cleanup, with exact commit timestamps | Failure start and end times, to the millisecond |
| Prisma SD-WAN Flow Browser queries | Flows filtered by address, port and protocol, with each flow's path decisions | Which path the SD-WAN chose, and exactly when it changed |
| Test history and UI | The Failover Lab view, with each test's failover path sequence | Shareable evidence, including exportable PoC cards |

The last two rows are what make Stigix more than a traffic generator. The traffic shows *what users felt*; the Flow Browser data shows *what the SD-WAN decided*. Lining them up on one timeline is what turns an observation into an explanation.

## Step by step: the internet breakout test

This is how the test in the white paper actually ran, with the Stigix function behind each step:

| Step | Stigix function | Purpose |
| --- | --- | --- |
| 1. Check application health | \`get_traffic_logs\` on BR8 | Confirm every simulated app answers before the test |
| 2. Find the backhauled apps | \`get_prisma_flows\` on site BR8, TCP port 443 | See which apps go through the tunnel to DC1 and which go direct |
| 3. Record the router baseline | \`get_vyos_router_state\` on vyoslandc1 | Know exactly what to restore afterwards |
| 4. Phase A: hard failure | \`vyos_execute_action\` \`interface-down\` on eth3 | Kill DC1's breakout |
| 5. Phase B: silent failure | \`vyos_execute_action\` \`set-impairment\`, 100% loss on eth3 | Kill the breakout while the interface stays up |
| 6. Follow the failover | \`get_prisma_flows\` filtered on one app's destination, with the aggregated path timeline | Date every path change |
| 7. Confirm the user impact | \`get_traffic_logs\` on BR8 | See apps fail, then recover |
| 8. Verify the restore | \`get_vyos_router_state\` on vyoslandc1 | Compare with the baseline |

### Finding what to watch

Step 2 was the key preparation. One query on BR8's HTTPS flows showed that four applications went through BR8-INET2 → DC1-INET: Exchange Online, Microsoft Entra ID, Microsoft Teams and a custom app hosted on Cloudflare. Everything else left BR8 directly. Without this, we would not have known which traffic the failure would hit.

### Reading a failure in the Flow Browser

During the outage, a failing session is easy to spot in Stigix's flow data: 2 packets sent, 120 bytes, 0 bytes back. Those are the SYN and its retransmission, never answered. When the path changes, the same query shows new sessions with full responses on the DC2 tunnels. That contrast gave the exact failover time, to the millisecond: **06:54:15.6 UTC** in Phase A, **07:11:13.7 UTC** in Phase B.

### What the injection looks like on the router

For Phase B, Stigix translated \`set-impairment\` into this VyOS configuration on vyoslandc1:

\`\`\`
set qos policy network-emulator LAB_COMBINED_eth3 loss '100'
set qos interface eth3 egress 'LAB_COMBINED_eth3'
\`\`\`

The interface stays up and the routing table does not change. Only the packets disappear, which is exactly the grey failure we wanted.

## The earlier campaign: when the tunnel itself fails

Before the breakout test, we ran eight failovers of a different kind: cutting DC1's internet circuit (eth10 on vyosrouter), which takes the SD-WAN tunnels down with it. This campaign set the reference point the white paper compares against.

Each run followed the same Stigix recipe: start voice calls, start a convergence probe from BR8 to DC1, cut eth10, restore it, stop the probe, then read the results.

| Measurement | Stigix source | Result |
| --- | --- | --- |
| Maximum blackout | Convergence probe | 7.7 to 9.3 s over eight runs, 8.6 s on average |
| First path decision after the cut | VyOS commit timestamp + Flow Browser | 0.9 to 1.8 s (two runs with exact timestamps) |
| Loss per direction | Convergence probe (echo) | ~3 s upstream, ~5 s downstream |
| +200 ms latency, no cut | VyOS impairment + Flow Browser | No path change, in every run where it was applied |
| Voice call caught by the cut | Voice simulation | 26% loss, MOS 1.48 |
| Voice call during the outage, via DC2 | Voice simulation | No loss, MOS 4.4 |
| TCP sessions to DC1 | Custom TCP apps | Dropped at the cut, reconnected in ~3 s via DC2; kept on failback |
| TCP sessions to BR2 and BR5 | Custom TCP apps | Untouched |

Two Stigix features made this campaign much more precise than a manual test:

- **The echo in the convergence probe** separates upstream from downstream loss. That is how we found that replies from DC1 take about 2 seconds longer to recover than traffic toward it.
- **Exact VyOS commit timestamps** separate the SD-WAN's *decision* (under 2 s) from the *actual recovery* of traffic (about 8 s). Without them, both blur into one number.

The voice and TCP results also changed the story told to customers: the real impact of a failover is not the path change itself, but the reconnection of the applications that were running at that moment.

## Measurement tricks and pitfalls

Most of the rigor in these tests came from lessons learned the hard way. They apply to anyone testing SD-WAN failover with Stigix, or with any other tool.

**Find the test flow by its source port.** Each Stigix convergence probe uses a fixed source port derived from its test number: CONV-0250 uses port 30250. Stigix exposes it in the test history, so you can ask the Flow Browser for that exact flow instead of searching through hundreds.

**The Flow Browser runs about one minute behind.** A query made during the outage often shows the flow as it was before the failure. Keep polling, or read again after the test.

**On a long-lived flow, the path history can be overwritten.** When the link came back while a probe was still running, the failback decision replaced the earlier failover in the flow's record. The failover then vanished from the history, in Stigix and in Prisma SD-WAN's own interface. Two workarounds: stop the probe before restoring the link, or poll repeatedly during the test and keep every decision you see. We reported this behavior to Palo Alto Networks.

**Check the path policy first.** At the start, the test flow showed a preferred path of “N/A”, and failovers were not recorded on it. The policy referenced paths that BR8 does not have. Once it listed only BR8's real paths, the failover sequence appeared as expected.

**Beware the traffic generator's backoff.** When an application fails, the generator pauses it for 5 minutes to avoid flooding. During an outage, the failing apps therefore disappear from the flow data. We used the Cloudflare-hosted app, which kept a steady rate of new sessions, as the reference for all timings.

**Single-packet flows are noise, and a free sampler.** Stigix's dashboard sends reachability probes to port 6200 every few seconds. They clutter queries on that port, so Stigix filters them out by default. But since each probe is a new flow with its own path decision, they also show which path new traffic would take at any moment.

**An HTTP error is not a network error.** Microsoft 365 answered the generator with codes like 401 or 417 because requests are not authenticated. That still proves the network path works. A real failure shows as code 000: no answer at all.

**Never trust a single speed test.** On the same path, BR8-to-DC1 throughput swung between about 10 and 200 Mbit/s from one run to the next. UDP tests also hit a ceiling of about 85 Mbit/s set by the sending host, not by the network. Repeat, and compare directions.

## Stigix's MCP interface

Beyond the web interface, Stigix exposes its full capability set through a [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server. MCP is an open standard that lets AI assistants connect to external tools and call them in context. Stigix implements more than 80 MCP tools, covering every function used in these tests.

The MCP interface makes Stigix **orchestratable in natural language**. An engineer describes a scenario — "start a convergence probe from BR8 to DC1, then inject 100% loss on DC1's internet exit and track the failover" — and an AI assistant, such as Claude, chains the exact Stigix calls, reads the results, and builds the timeline. The assistant has no knowledge of the network beyond what Stigix returns: every decision, every timestamp and every path comes from a real Stigix query on the live lab.

**What the MCP tools covered in these tests:**

| MCP tool | What it does |
| --- | --- |
| \`run_test\` | Start a convergence probe, speed test or voice call |
| \`stop_test\` | Stop the probe and collect final metrics |
| \`get_test_status\` | Read live metrics during the test |
| \`get_convergence_history\` | Read the failover path sequence after the test |
| \`get_voice_stats\` | MOS, loss and jitter per simulated call |
| \`get_traffic_logs\` | Application-level results from the traffic generator |
| \`get_prisma_flows\` | Query the SD-WAN Flow Browser, filter by address, port or source port |
| \`get_vyos_router_state\` | Record the router's baseline before and after each test |
| \`vyos_execute_action\` | Inject failures: \`interface-down\`, \`set-impairment\`, \`clear-qos\` |
| \`list_custom_tcp_apps\`, \`get_tcp_app_sessions\` | Track persistent TCP sessions through the failover |
| \`set_voice_status\` | Start or stop the voice simulation on a node |
| \`get_health_matrix\` | Check node CPU, bitrate and overall health |

The key value of the MCP layer is **traceability**. Every call returns structured data, so the assistant can cross-reference the router's commit timestamp (from \`vyos_execute_action\`) against the first failing session (from \`get_prisma_flows\`) and produce a timeline accurate to the millisecond, without any manual copy-pasting.

The MCP server also enforces its own guardrails. Disruptive tools such as \`interface-down\` include explicit warnings that prompt the engineer for confirmation before the call proceeds. If any tool call fails, the assistant stops the sequence and reports the state of the lab.

## Reproduce it yourself

Stigix is available at [github.com/jsuzanne/stigix](https://github.com/jsuzanne/stigix). Here is a checklist to run the same tests on your own lab:

**Lab prerequisites:**
- [x] A Prisma SD-WAN branch and two data centers, with the backup DC in the application path policy.
- [x] A Stigix node at the branch and in each data center.
- [x] VyOS routers emulating the underlay and the data center breakout, registered in Stigix.
- [x] Prisma SASE API access configured in Stigix, for Flow Browser queries.

**Before the test:**
- [x] Check that the path policy only lists paths the branch really has (no “N/A” preferred path on test flows).
- [x] Make sure router management does not depend on the interface you will cut.
- [x] Identify the backhauled applications from the branch's flows, and pick one with steady traffic as your reference.
- [x] Record the routers' state as a baseline.

**During the test:**
- [x] Start voice calls and a convergence probe, then inject the failure.
- [x] Poll the Flow Browser every 30 to 60 seconds, and keep every path decision you see.
- [x] To keep the failover in the flow's history, stop the probe before restoring the link.
- [x] Restore, then wait for the probes to bring traffic back.

**After the test:**
- [x] Compare the routers with the baseline, including empty QoS containers left by cleanup.
- [x] Read the test history about a minute after stopping, once the path sequence is filled in.
- [x] Export the PoC card from the Stigix interface to share the results.
`,

  "SDWAN_Failover_Executive_Report.docx.md": `> **Last Updated:** 2026-09-24 | **Created:** 2026-09-24 (v2.0.63)

# SD-WAN Failover Validation — Executive Summary Report
*BR8 (Branch) ↔ DC1 / DC2 — Site Resilience Test Series | September 22, 2026*

## 1. Executive Summary

This report summarizes a series of three controlled failover tests performed against the BR8 branch site's connectivity to the primary datacenter (DC1), including a full simulated site-level outage with automatic reroute to the secondary datacenter (DC2). The tests validate that the SD-WAN fabric correctly detects link and site failures and reroutes traffic to a healthy path, and they quantify the real-world impact such an event would have on live customer traffic (voice, video, and application sessions).

Across all three scenarios, failover consistently completed within 7.3 to 8.1 seconds. Traffic was successfully rerouted in every test, including full recovery via the DC2 datacenter interconnect when both direct DC1 circuits (internet and MPLS) were taken down simultaneously to simulate a complete central-site outage.

**Key takeaway:** a 7-8 second convergence time, while the platform performed as designed, exceeds the tolerance of live real-time sessions such as voice and video calls. Any customer on an active call during a failure of this kind would very likely experience a dropped call, not just a quality dip.

## 2. Test Methodology

Each test generated live synthetic voice traffic and a continuous convergence probe (50 packets/second) from BR8 toward DC1, then deliberately impaired or removed BR8's WAN connectivity to DC1 to observe how the SD-WAN fabric responded. All interfaces were restored and verified healthy at the end of each test; no other network paths were modified.

* **Test 1 — Single circuit failure:** the DC1 internet circuit was degraded (+200ms latency) then taken fully down, while the DC1 MPLS circuit remained available.
* **Test 2 — Total site failure (hard):** both DC1 circuits (internet and MPLS) were taken down simultaneously with no prior warning, simulating an abrupt total loss of the central site.
* **Test 3 — Total site failure (progressive):** both DC1 circuits were first degraded, then cut in sequence roughly 90 seconds later — a more realistic representation of a failing site rather than an instantaneous one.

## 3. Results Summary

| Scenario | Overall loss | Max blackout | Avg RTT | Verdict |
| :--- | :--- | :--- | :--- | :--- |
| **Test 1 — Single link cut (DC1 internet only)** | 3.2% | 7.78 s | 35.7 ms | BAD |
| **Test 2 — Dual link cut (total DC1 outage)** | 2.9% | 8.12 s | 6.9 ms | BAD |
| **Test 3 — Degrade then dual cut (total DC1 outage)** | 2.7% | 7.31 s | 68.0 ms | BAD |

## 4. Convergence Time — The Key Metric

Convergence time is the interval between the onset of a failure and traffic being fully restored on an alternate path — effectively, how long the customer's session is unusable. Across the three tests, this held steady regardless of failure type (7.3 to 8.1 seconds).

## 5. Customer Impact by Test

### Test 1 — Single Link Failure (DC1 Internet)
* **Path before failure:** BR8-INET2 → DC1-INET
* **Path after failure:** BR8-INET1 → DC1-INET (alternate WAN member, same site)
* **Blackout duration:** 7.78 seconds | **Packet loss:** 3.2% overall (1.4% uplink / 1.9% downlink)
* **Customer impact:** A WAN-member-level failover — traffic stayed within DC1's direct paths. An active call would still very likely drop during the 7.78s blackout.

### Test 2 — Total DC1 Outage (Hard Cut)
* **Path before failure:** BR8-INET1 → DC1-INET
* **Path during failure:** BR8-INET1 → DC2-INET (rerouted via the DC1↔DC2 interconnect)
* **Path after recovery:** BR8-INET1 → DC1-INET
* **Blackout duration:** 8.12 seconds | **Packet loss:** 2.9% overall (1.1% uplink / 1.8% downlink)
* **Customer impact:** A genuine site-level failover to the backup datacenter. Confirms DC2 correctly serves as a transit path when DC1 is fully unreachable, at the cost of an 8-second interruption.

### Test 3 — Total DC1 Outage (Degrade, then Hard Cut)
* **Degradation phase:** ~90 seconds at +200ms latency on both DC1 circuits, 5-7% packet loss
* **Path during failure:** BR8-INET1 → DC2-INET (rerouted via the DC1↔DC2 interconnect)
* **Path after recovery:** BR8-INET1 → DC1-INET, restored cleanly with a negligible blip
* **Blackout duration:** 7.31 seconds | **Packet loss:** 2.7% overall (1.1% uplink / 1.6% downlink)
* **Customer impact:** The degradation phase alone would be noticeable to end users on calls even before the outage. The subsequent hard cut still produced a full 7.3s blackout.

## 6. Recommendations

* Review the SD-WAN health-probe / BFD dead-timer configuration on BR8's paths to DC1. If sub-2-second failover is required for voice/video SLAs, the detection interval likely needs to be tightened.
* Communicate the current ~7-8 second failover window to stakeholders who depend on real-time traffic so expectations are set accurately.
* The DC2 reroute path performed reliably in both total-outage tests — no further remediation needed there; it is a valid backup transit for DC1 traffic.
`,

  "Microsoft Probe analysis Report Report (EN).md": `> **Last Updated:** 2026-09-24 | **Created:** 2026-09-24 (v2.0.63)

# Microsoft 365 Probe Performance Analysis – BR5 & BR8
*Sep 23, 2026 · Jean-Louis SUZANNE*

## Executive summary

Microsoft 365 services are 100% reachable from both sites, but the experience is clearly degraded at BR5, where response times are 6 to 16 times higher than at BR8.

- **BR8: good experience.** Services that respond normally (Entra ID, Teams, Graph, M365 portal) load in 150 to 350 ms median. The only concern is SharePoint, which failed 3 times out of 5 (5 s timeout).
- **BR5: degraded experience.** The same services take 1.6 to 2.8 s median. The issue is not Microsoft-specific: a ping to 1.1.1.1 takes 150 ms from BR5 versus 4 ms from BR8. BR5's Internet access adds about 145 ms to every round trip.
- **Scores need context.** Exchange Online, SharePoint and Azure Portal return 401, 403 or 417 codes because the probes query the pages without authentication. These codes drop the score to 20 on both sites without indicating an outage.

Priority action: identify the cause of the extra 145 ms on BR5's Internet path.

## Scope and methodology

Seven identical HTTPS probes, created on 23/09/2026 at around 16:57 UTC, measure the main Microsoft services from the Stigix nodes at BR5 (192.168.217.5) and BR8 (192.168.219.1).

| Probe | Target |
| :--- | :--- |
| MS - Entra ID | https://login.microsoftonline.com |
| MS - Exchange Online | https://outlook.office365.com |
| MS - Teams | https://teams.microsoft.com |
| MS - M365 Portal | https://www.office.com |
| MS - SharePoint | https://microsoft.sharepoint.com |
| MS - Graph API | https://graph.microsoft.com |
| MS - Azure Portal | https://portal.azure.com |

Each probe breaks the request down into DNS resolution, TCP connection, TLS handshake, time to first byte (TTFB) and total time, with a 5 s timeout.

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
`
};
