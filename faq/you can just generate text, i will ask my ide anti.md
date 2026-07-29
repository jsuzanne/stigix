<img src="https://r2cdn.perplexity.ai/pplx-full-logo-primary-dark%402x.png" style="height:64px;margin-right:32px"/>

# you can just generate text, i will ask my ide antigravity to build a FAQ in existing site, is it ok for you ?

Yes, that’s perfectly fine. I can generate clean source text for your IDE/Antigravity to integrate into the existing site, and that is probably the most efficient path.[^1]

## Recommended format

The best structure is one FAQ block per use case, with a short intro, then 6–10 practical questions ordered from “What is it?” to “How do I troubleshoot it?”.[^2][^1]
That fits how Stigix itself is organized across Traffic Generator, Security Testing, Connectivity, IoT, Voice, Convergence, and Operations.[^2][^1]

## Source text

Below is a ready-to-use draft you can paste into your site builder.

### Traffic Generation FAQ

**What is the Traffic Generator?**
The Traffic Generator creates continuous background HTTP/HTTPS traffic to simulate realistic enterprise user activity across many SaaS applications such as Microsoft 365, Google Workspace, Zoom, and Salesforce.[^3][^2]

**How is Traffic Generation different from Security Testing?**
Traffic Generation is meant to simulate user demand and application mix, while Security Testing is meant to validate whether security policies block or allow known test destinations.[^4][^3]

**How do application weights work?**
Each application has a weight that defines its relative probability of being selected during traffic generation, so a higher-weight app appears more often over time.[^3][^2]

**How do I create a realistic business profile?**
Start with core productivity and collaboration apps such as Outlook, Teams, Google Workspace, Zoom, Slack, and Salesforce, then tune weights so business-critical apps dominate while secondary apps still appear naturally.[^2][^3]

**Can I simulate non-business traffic like streaming or gaming?**
Yes. The Traffic Generator guide includes examples for consumer-style profiles with social media, streaming, and gaming applications using heavier weights for those categories.[^3]

**How do I add internal applications or IP-based services?**
You can define targets by domain name or IP address, and if you need plain HTTP instead of HTTPS you can specify the protocol explicitly in the application definition.[^3]

**How do I verify that the generator is really working?**
Use the dashboard statistics, `traffic.log`, and `stats.json` to compare the configured weights with the observed request distribution and success rates.[^2][^3]

**Why is no traffic being generated?**
The first checks are whether traffic generation is enabled, whether the correct network interface is configured, and whether the traffic generator container is running without errors.[^4][^1]

**Where does this fit in a demo?**
Traffic Generation is ideal when you want to show realistic SaaS behavior, SD-WAN path steering, application visibility, and policy decisions under user-like load rather than just one-off probes.[^5][^2]

***

### Digital Experience FAQ

**What are connectivity probes?**
Connectivity probes are lightweight tests that continuously check service reachability and responsiveness using methods such as HTTP, ICMP, DNS, and related synthetic checks.[^5][^2]

**What is the goal of Digital Experience monitoring?**
The goal is to show whether critical services are actually healthy and responsive from the branch point of view, not just whether a path is technically up.[^6][^2]

**Which targets can I monitor?**
You can monitor internal applications, SaaS services, collaboration platforms, DNS resolution targets, and other endpoints defined in the connectivity configuration.[^7][^6][^2]

**How is this different from Traffic Generation?**
Traffic Generation creates ongoing application load, while Digital Experience monitoring measures health, reachability, and responsiveness of selected services.[^2][^3]

**Why is this useful in customer demos?**
It helps explain that “reachable” does not always mean “usable,” especially when latency, instability, or intermittent degradation affects user experience.[^6][^2]

**Can it detect unstable or flaky behavior?**
Yes. Because the probes run continuously, they can expose intermittent problems and inconsistent service behavior that a single manual test may miss.[^6][^2]

**How should I choose endpoints for a demo?**
Pick a small set of business-relevant services, usually one or two SaaS apps, one internal dependency, and one generic internet target for comparison.[^7][^6]

**What if the probes always look healthy?**
That usually means the chosen targets are too simple or too stable, so it is often better to include at least one app or service that is meaningful to the customer’s real workflow.[^6][^2]

***

### Security Testing FAQ

**What does Security Testing validate?**
Security Testing validates URL filtering, DNS security, threat prevention behavior, and related policy enforcement using known test destinations and files.[^8][^2]

**How does the system decide whether a result is Allowed or Blocked?**
For URL tests it evaluates HTTP outcomes, for DNS tests it checks whether malicious domains resolve or return NXDOMAIN, and for threat tests it checks whether EICAR-style downloads succeed or fail.[^8][^5]

**Why are all my tests showing Allowed?**
This usually means the test traffic is not passing through Prisma Access or the required security policies are not configured in the active path.[^8]

**Do I need to click Run All Enabled if scheduled execution is active?**
No. Scheduled tests run automatically in the background after the configured interval, while Run All Enabled is only for manual on-demand execution.[^8]

**How often should I schedule security tests?**
The FAQ guidance suggests manual execution for demos, 30–60 minute intervals for PoCs, and 60–120 minute intervals for lighter continuous monitoring.[^8]

**How do I know if the policies are working correctly?**
Look for Blocked results in the results table and confirm that the statistics dashboard reflects enforcement over time.[^8]

**Where can I see scheduled versus manual results?**
The test results table shows individual executions, while the statistics dashboard shows aggregated counts across runs.[^8]

**What if scheduled tests are not running?**
Check that scheduling is enabled, the interval is valid, at least one test type is selected, and then inspect backend logs if the UI looks correct.[^8]

**Where does this fit in a demo?**
Security Testing is best when you want a clear proof point that policy enforcement is happening, especially for URL filtering, DNS security, and Threat Prevention validation.[^2][^8]

***

### IoT Simulation FAQ

**What is IoT Simulation in Stigix?**
IoT Simulation creates realistic device behavior on the wire using Scapy, including DHCP, ARP, and device-specific traffic patterns, so simulated devices look more like real endpoints to the network.[^9][^2]

**Why use IoT Simulation instead of only app traffic?**
It is useful when the demo needs device visibility, segmentation, identification, or OT/IoT-specific behavior rather than only browser or SaaS application flows.[^9][^2]

**What kinds of devices can be simulated?**
The documentation describes support for multiple device families such as cameras, sensors, smart plugs, smart lighting, printers, HVAC-related devices, and industrial or medical profiles depending on the configuration.[^10][^9]

**What is the role of DHCP fingerprints?**
DHCP fingerprints make the simulated devices more believable and help with identification workflows, including Palo Alto IoT Security classification scenarios.[^11][^9]

**Should I use the Python generator or the LLM-based method?**
Use the Python generator for fast, deterministic, offline output, and use the LLM-based method when you want a customer-specific or industry-specific device set for a tailored demo.[^10][^11][^9]

**Can I build vertical demos like hospital, factory, or smart building?**
Yes. The LLM generation guide already includes example prompts for healthcare, manufacturing, utilities, retail, and smart office environments.[^11]

**Does IoT Simulation work the same on Linux, macOS, and Windows?**
No. Full host-mode IoT simulation with DHCP and ARP behavior is documented as Linux-only, while macOS, Windows, and WSL2 run with reduced bridge-mode capabilities.[^9]

**Can simulated devices generate malicious behavior for validation?**
Yes. The IoT engine supports bad-behavior modes such as beaconing, DNS flood, port scan, data exfiltration, and Palo Alto test domain generation for security validation use cases.[^9]

***

### Voice and Convergence FAQ

**What is Voice Testing used for?**
Voice Testing generates RTP-style traffic and measures metrics such as jitter, loss, latency, R-value, and MOS to assess voice quality under network conditions.[^5][^2]

**What is the Convergence Lab used for?**
The Convergence Lab is used to measure failover behavior precisely, including blackout windows and directional loss during path changes or impairments.[^12][^2]

**Why is Convergence different from basic failover observation?**
It is designed as a measurement tool, not just a visual indicator, so it can quantify how long failover actually impacts traffic and how recovery behaves in each direction.[^12][^2]

**Why does directional loss matter?**
Because failover impact is not always symmetric, and one direction may recover differently from the other, which is especially relevant for voice and real-time traffic.[^12][^2]

**When should I use Voice Testing in a demo?**
Use it when you want to show the practical user impact of latency, jitter, and packet loss rather than only bandwidth or reachability.[^5][^2]

**When should I use the Convergence Lab in a demo?**
Use it when the customer wants proof of failover quality, precise recovery timing, or visibility into how path changes affect application continuity.[^12][^2]

***

### Operations FAQ

**Which deployment model should I use?**
The README recommends the all-in-one Stigix image as the default deployment model, while legacy separated images remain available for advanced scenarios.[^1]

**What are the first checks if the dashboard is unreachable?**
Check whether Docker is running, whether containers are up, whether port 8080 is available, and whether the web UI logs show startup or connectivity errors.[^4][^1]

**What are the first checks if traffic is not generating?**
Verify that interfaces are configured correctly, confirm traffic generation is active in the dashboard, and inspect the traffic generator logs.[^1][^4]

**How do I update safely?**
Use the documented maintenance flow, preserve configuration, pull the latest images, and restart cleanly so that settings and logs are not lost unnecessarily.[^13][^4]

**What should be included in a production-readiness checklist?**
A strong JWT secret, changed admin credentials, HTTPS through a reverse proxy, firewall restrictions, resource limits, and log retention settings are all recommended controls.[^4][^1]

**Where can I find the main logs and stats?**
The platform uses shared configuration and log volumes, including traffic logs, test results, and rolling statistics files that are read by the dashboard and backend.[^4][^2]

## Good next step

A strong next iteration would be to split this into separate markdown blocks for `traffic-generation`, `digital-experience`, `security-testing`, `iot-simulation`, `voice-convergence`, and `operations`, so your IDE can inject each block directly into the existing site navigation.[^1][^2]

Would you like me to do the next pass in strict Markdown with H2/H3 only, ready for copy/paste into the Stigix docs site?

<div align="center">⁂</div>

[^1]: README.md

[^2]: SPECIFICATION.md

[^3]: TRAFFIC_GENERATOR.md

[^4]: README.md

[^5]: TRAFFIC_FLOW_GUIDE.md

[^6]: CONNECTIVITY_ENDPOINTS.md

[^7]: connectivity-custom.json

[^8]: SECURITY_TESTING_FAQ.md

[^9]: IOT_SIMULATION.md

[^10]: IOT_DEVICE_GENERATOR.md

[^11]: IOT_LLM_GENERATION.md

[^12]: CONVERGENCE_LAB.md

[^13]: MAINTENANCE.md

