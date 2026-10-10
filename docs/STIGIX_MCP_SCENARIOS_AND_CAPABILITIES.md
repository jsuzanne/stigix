# Stigix MCP — Scenarios & Capabilities

**Oct 10, 2026 · Jean-Louis SUZANNE, Technical Sales Manager, Palo Alto Networks**

This document covers concrete use cases enabled by the Stigix SD-WAN Model Context Protocol (FastMCP) integration with Claude. Each scenario is self-contained, reproducible, and can be triggered in plain language — no CLI access required.

---

### 1. Automated Failover Drill
* **What it does:** Launches a real-time UDP convergence test, injects sequential faults (QoS latency, MPLS shutdown, Internet shutdown), monitors path-by-path metrics, performs surgical cleanup, and produces a customer-ready PDF report — fully autonomous.
* **Tools:** `run_test` · `stop_test` · `get_convergence_report` · `get_prisma_flows` · `vyos_execute_action` · `get_vyos_router_state`
* **Output:** PDF report with verdict, timeline, per-phase metrics, findings and recommendations.
* **Live example:** CONV-0305 BR8→DC1 — 13,169 packets, 0% loss, 15.4 ms avg RTT, verdict PERFECT.

---

### 2. Customer DEM Onboarding
* **What it does:** From a customer name and their app stack (Google Workspace, Microsoft 365, Salesforce…), automatically generates and deploys a full set of DEM probes covering every critical service.
* **Tools:** `list_dem_probes` · `add_dem_probe` · `get_dem_summary`
* **Live example:** *"My customer uses Google Workspace"* → 7 probes deployed in 30 seconds: Gmail, Drive, Meet, Calendar, Public DNS, APIs, Accounts.

---

### 3. SaaS Morning Report
* **What it does:** Scheduled task every morning at 7am — runs DEM probes, collects scores, flags overnight degradations, and sends a summary to the team or customer.
* **Tools:** `run_dem_probes_now` · `get_dem_probe_stats` · `get_dem_summary`
* **Output:** *"Your SaaS health this morning"* report — degraded apps flagged in red, scores, and recommended actions.

---

### 4. DEM / SD-WAN Path Correlation
* **What it does:** When a DEM score drops (e.g. Gmail falls to 30%), automatically cross-references Prisma flows to identify whether the SD-WAN path changed and explains the root cause in plain language.
* **Tools:** `get_dem_probe_stats` · `get_prisma_flows` · `get_vyos_timeline`
* **Value:** Goes from *"my app is slow"* to *"the path switched to the DC2 relay at 09:43 following Internet overlay degradation"* — in 10 seconds.

---

### 5. On-Demand Security Audit
* **What it does:** Tests URL and DNS filtering from a branch site, verifies file protection (EICAR), and produces a pass/fail report per domain or category — no physical site access needed.
* **Tools:** `run_security_probe` · `run_full_security_audit` · `run_eicar_test` · `run_security_dns_batch` · `run_security_url_batch`
* **Example:** *"Check that my branch properly blocks these 20 phishing domains"* → instant report with per-domain status.

---

### 6. Live QoS & Traffic Engineering Demo
* **What it does:** Gradually ramps up load (10 → 50 → 100 simulated clients), monitors impact on application metrics, and demonstrates critical app prioritization in real time.
* **Tools:** `set_traffic_status` · `set_traffic_rate` · `set_traffic_client_count` · `get_traffic_stats` · `vyos_execute_action`
* **Customer scenario:** Simulating *"Monday morning"* — 50 users connect simultaneously, measuring Zoom vs web browsing experience under load.

---

### 7. Multi-Destination Path Trace
* **What it does:** Traces paths to multiple destinations (DC1, DC2, public cloud) and explains SD-WAN routing decisions in plain language — which path, why, with what metrics.
* **Tools:** `run_path_trace` · `get_prisma_flows` · `get_node_status`
* **Educational value:** Perfect for explaining to a customer how the SD-WAN selects paths, without showing any CLI.

---

### 8. Assisted Incident Response
* **What it does:** When a network incident occurs, runs a multi-layer automated diagnosis: VyOS interface state, change timeline, active flow correlation, root cause identification.
* **Tools:** `run_system_diagnostics` · `get_health_matrix` · `get_vyos_timeline` · `get_diagnostics` · `get_prisma_flows`
* **Output:** In 2 minutes — *"Interface eth10 went down at 09:38, SD-WAN rerouted to DC2 relay, 0% application packet loss"* — with full timeline.

---

### 9. Before / After Benchmark
* **What it does:** Takes a full DEM baseline before a network change (new circuit, QoS tuning, path change), applies the change, then re-runs the same probes and produces a side-by-side comparison report.
* **Tools:** `get_dem_probe_stats` · `get_dem_summary` · `get_app_score` · `list_apps`
* **Customer scenario:** Justifying an MPLS upgrade — measuring latency to critical apps before and after activation, with a PDF report to present to management.

---

### 10. Voice Quality Monitoring
* **What it does:** Activates voice traffic simulation (BR8 → DC1), monitors MOS, jitter, packet loss in real time, detects degradation, and triggers SD-WAN path remediation automatically.
* **Tools:** `get_voice_stats` · `get_voice_ingress_calls` · `set_voice_status` · `get_prisma_flows`
* **Customer scenario:** A call center with 200 agents — detecting voice quality drops before users complain, with automatic rerouting and a post-incident report.

---

### 11. Zero-Touch Provisioning & Onboarding
* **What it does:** Generates a magic-join token, produces the onboarding command for a new site, monitors provisioning in real time, validates the DEM baseline once joined, and generates the welcome report.
* **Tools:** `get_provisioning_status` · `set_provisioning_mode` · `generate_magic_join_token` · `list_controller_peers` · `get_controller_status`
* **Customer scenario:** Opening a new branch — the local technician plugs in the box, runs a single command, and 10 minutes later the NOC receives an auto-generated report confirming the site is operational.

---

### 12. Multi-Site Comparison & Anomaly Detection
* **What it does:** Pulls DEM scores and health matrices from all fabric nodes, identifies underperforming sites, highlights statistical anomalies (e.g. BR8 has 3× higher latency to DC2 vs. other branches), and suggests targeted actions.
* **Tools:** `run_test` (multi-agents) · `get_convergence_report` · `get_health_matrix`
* **Customer scenario:** Weekly NOC review — a single prompt gives a ranked list of sites requiring attention, with root-cause hypotheses and recommended remediation steps.

---

> **Note:** This document is a living reference, updated with each new scenario validated on the Stigix lab fabric. All scenarios are executable today via Claude FastMCP on BR8 — no CLI, no scripts, no manual steps.
