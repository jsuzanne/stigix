# Microsoft 365 Probe Performance Analysis – BR5 & BR8

Sep 23, 2026 · @Someone

## Executive summary

Microsoft 365 services are 100% reachable from both sites, but the experience is clearly degraded at BR5, where response times are 6 to 16 times higher than at BR8.

- **BR8: good experience.** Services that respond normally (Entra ID, Teams, Graph, M365 portal) load in 150 to 350 ms median. The only concern is SharePoint, which failed 3 times out of 5 (5 s timeout).
- **BR5: degraded experience.** The same services take 1.6 to 2.8 s median. The issue is not Microsoft-specific: a ping to 1.1.1.1 takes 150 ms from BR5 versus 4 ms from BR8. BR5's Internet access adds about 145 ms to every round trip.
- **Scores need context.** Exchange Online, SharePoint and Azure Portal return 401, 403 or 417 codes because the probes query the pages without authentication. These codes drop the score to 20 on both sites without indicating an outage.

Priority action: identify the cause of the extra 145 ms on BR5's Internet path.

## Scope and methodology

Seven identical HTTPS probes, created on 23/09/2026 at around 16:57 UTC, measure the main Microsoft services from the Stigix nodes at BR5 (192.168.217.5) and BR8 (192.168.219.1).

| Probe | Target |
| --- | --- |
| MS - Entra ID | https://login.microsoftonline.com |
| MS - Exchange Online | https://outlook.office365.com |
| MS - Teams | https://teams.microsoft.com |
| MS - M365 Portal | https://www.office.com |
| MS - SharePoint | https://microsoft.sharepoint.com |
| MS - Graph API | https://graph.microsoft.com |
| MS - Azure Portal | https://portal.azure.com |

Each probe breaks the request down into DNS resolution, TCP connection, TLS handshake, time to first byte (TTFB) and total time, with a 5 s timeout. The analysis window runs from 16:57 to 17:05 UTC: 5 measurements per probe at BR8 and 7 to 8 at BR5. Non-Microsoft probes (ICMP to 1.1.1.1 and 8.8.8.8, Google, Salesforce) serve as a baseline to tell an application issue from a network issue.

## BR5 results

All services respond (100% availability), but none goes below 700 ms. The node's overall health score is 49/100.

| Probe | HTTP code | Success | Median total (ms) | Max (ms) | TCP (ms) | TLS (ms) | TTFB (ms) | Avg score |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| MS - Entra ID | 200 | 8/8 | 2,788 | 2,962 | 296 | 1,314 | 915 | 13 |
| MS - Graph API | 200 | 7/7 | 2,387 | 2,620 | 298 | 983 | 776 | 18 |
| MS - M365 Portal | 200 | 7/7 | 2,208 | 2,497 | 296 | 1,014 | 346 | 35 |
| MS - Teams | 200 | 8/8 | 1,578 | 4,417 | 149 | 855 | 670 | 35 |
| MS - SharePoint | 401 | 7/7 | 902 | 1,029 | 149 | 476 | 278 | 20 |
| MS - Exchange Online | 417 | 8/8 | 878 | 1,512 | 151 | 435 | 365 | 20 |
| MS - Azure Portal | 403 | 7/7 | 775 | 846 | 150 | 446 | 153 | 20 |

TCP connection setup takes 150 ms, and up to 300 ms for Entra ID, Graph and the M365 portal. The TLS handshake, which requires several round trips, then climbs to 1 s or more. Teams also shows an isolated 4.4 s spike.

## BR8 results

Six of the seven services respond quickly and consistently; SharePoint is the only weak spot. The node's overall health score is 70/100.

| Probe | HTTP code | Success | Median total (ms) | Max (ms) | TCP (ms) | TLS (ms) | TTFB (ms) | Avg score |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| MS - Entra ID | 200 | 5/5 | 318 | 460 | 40 | 111 | 142 | 86 |
| MS - M365 Portal | 200 / 301 | 5/5 | 261 | 5,079 | 27 | 119 | 31 | 82 |
| MS - Teams | 200 | 5/5 | 254 | 382 | 13 | 39 | 162 | 89 |
| MS - Graph API | 200 | 5/5 | 149 | 247 | 13 | 63 | 52 | 94 |
| MS - Exchange Online | 417 | 5/5 | 88 | 159 | 11 | 50 | 29 | 20 |
| MS - Azure Portal | 403 | 5/5 | 59 | 104 | 7 | 32 | 3 | 20 |
| MS - SharePoint | 401 / failed | 2/5 | 5,001 | 5,002 | – | – | 117 | 38 |

SharePoint hit the 5 s timeout at 16:57, 17:03 and 17:04 UTC without establishing any connection; the two successful attempts responded in 300 to 480 ms. The 5.1 s spike on the M365 portal was the very first measurement (a 301 redirect) and did not recur; subsequent measurements ranged from 171 to 385 ms.

## BR5 vs BR8 comparison

The gap comes from BR5's network, not from Microsoft: every Internet destination suffers the same overhead of about 145 ms per round trip.

In median total time, BR5 is 6 times slower than BR8 on Teams, 9 times on Entra ID and the M365 portal, 10 times on Exchange, 13 times on Azure Portal and 16 times on Graph API. The baseline probes confirm that this overhead affects all of BR5's Internet traffic:

| Baseline | BR8 | BR5 |
| --- | --- | --- |
| Ping 1.1.1.1 (ms) | 4 | 150 |
| Ping 8.8.8.8 (ms) | 6 | 150 |
| Ping Hetzner server (ms) | 32 | 29 |
| Google Search, TCP connection (ms) | 7 | 149 |
| Salesforce, TCP connection (ms) | 6 | 152 |

A fixed 150 ms towards anycast services normally a few milliseconds away points to an abnormal Internet egress path at BR5: latency added on the link, egress through a remote site, or traffic going through a relay. The Hetzner server, however, is reached at the same speed from both sites, which shows BR5 has a healthy path to at least that destination. On the BR8 side, SaaS traffic breaks out directly to the Internet (DirectInternet via BR8-INET2), with egress observed in Paris.

## Findings and recommendations

The priority is to remove the 145 ms added on BR5's Internet access; once fixed, BR5 should perform close to BR8.

1. **Diagnose BR5's Internet path.** Check the site's SD-WAN egress policy (local breakout or backhaul to a DC), the state of the Internet links, and whether a simulated impairment (injected latency) was left active. The BR5 egress IP lookup failed during the window and should be rerun to locate the breakout point.
2. **Monitor SharePoint from BR8.** Three connection failures out of five warrant monitoring over a longer period, plus a check of DNS resolution and the path to microsoft.sharepoint.com.
3. **Make probe scores reliable.** For Exchange Online, SharePoint and Azure Portal, declare 401, 403 and 417 as valid responses, or target URLs that return 200 without authentication. Scores will then reflect actual performance rather than the absence of a user login.
4. **Extend the observation period.** Rerun the analysis over 24 hours, including business hours, to confirm trends and measure variability.

## Appendix: analysis limitations

The conclusions rest on about 8 minutes of measurements taken right after the probes were created; they describe a snapshot, not a trend.

- **Small sample.** 5 measurements per probe at BR8 and 7 to 8 at BR5. Averages are therefore sensitive to outliers, which is why this report uses medians.
- **Scores tied to HTTP codes.** The Stigix score penalises any code other than 200, which skews the reading for services that require authentication.
- **Root cause not confirmed.** The origin of the 145 ms at BR5 is inferred from the baseline probes and must be validated on the site's SD-WAN device.
- **Test context.** Failover tests on the DC1 links took place the same day. They do not affect these measurements, as BR8's SaaS traffic breaks out directly to the Internet without going through DC1.
