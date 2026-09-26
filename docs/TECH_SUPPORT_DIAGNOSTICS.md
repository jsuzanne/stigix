> **Last Updated:** 2026-09-26 | **Created:** 2026-09-26 (v2.0.66)

# Stigix Tech-Support Diagnostic Bundle

The **Tech-Support Diagnostic Bundle** is an enterprise-grade diagnostic archive (`.tar.gz`) generated on demand from any Stigix node. It aggregates sanitized configurations, active system and process snapshots, live telemetry metrics, and the latest execution logs into a single structured package to streamline troubleshooting and remote support.

---

## 🎯 Key Objectives

* **Zero-Leak Guarantee**: Automatically scrubs all passwords, client secrets, JWT bearer tokens, private keys, and master keys (`***REDACTED***`).
* **1-Click Generation**: Downloadable instantly from the Stigix Web Dashboard (Settings → System Information).
* **CLI & API Automation**: Available via CLI (`stigix tech-support`) and REST API (`GET /api/system/tech-support`).
* **Complete Context**: Contains full system state (interfaces, routing table, iptables, process list, supervisord status) and tail logs without overwhelming archive sizes.

---

## 📦 Bundle Architecture & Contents

The generated archive uses the standard naming convention:
`stigix-techsupport-<site_name>-<YYYYMMDD-HHMMSS>.tar.gz`

```
stigix-techsupport-<site_name>-<timestamp>/
├── metadata.json                 # Node version, git commit, platform specs, timestamp
├── config/                       # Sanitized application configurations
│   ├── applications.json         # Traffic profiles & bandwidth limits (secrets scrubbed)
│   ├── ui_config.json            # Dashboard layout and score weights
│   ├── voice.json                # Voice generator & codec profiles
│   └── ...                       # All JSON files from /app/config
├── system/                       # Live host & container runtime snapshots
│   ├── ip_addr.txt               # ip -br addr (interfaces and IPs)
│   ├── ip_route.txt              # ip route (routing table & next-hops)
│   ├── iptables.txt              # iptables -L -n -v (firewall rules & packet counters)
│   ├── net_dev.txt               # /proc/net/dev (raw network byte & packet counters)
│   ├── system_resources.txt      # uname, df -h, free -m, ps aux
│   ├── docker_ps.txt             # Active docker containers
│   └── supervisor_status.txt     # supervisord service statuses (daemons health)
├── telemetry/                    # Real-time state & metric exports
│   ├── local_telemetry.json      # Health score, active/failing probes, live bitrates, MOS
│   ├── registry_status.json      # Control Plane state (Leader/Peer mode, sync heartbeats)
│   ├── fleet_peers.json          # Mesh peer list and discovered nodes
│   ├── connectivity_stats_1h.json# 1-hour rolling network SLA metrics
│   ├── connectivity_stats_24h.json# 24-hour historical latency/loss SLA
│   ├── probes_catalog.json       # Configured & auto-discovered probe definitions
│   └── services_status.json      # Operational state of traffic, voice, XFR engines
└── logs/                         # Execution logs (tail of last 1,000 lines per file)
    ├── sdwan-traffic-gen_app.log # Traffic generator core engine log
    ├── sdwan-traffic-gen_voice.log # Voice SIP/RTP orchestrator log
    ├── sdwan-traffic-gen_iperf3.log# Bandwidth stress test logs
    ├── supervisor_web-ui.log     # Web UI & Express backend logs
    └── supervisor_mcp-server.log # FastMCP AI server logs
```

---

## 🚀 How to Generate a Bundle

### 1. Via the Web Dashboard (GUI)
1. Navigate to **Settings** in the left sidebar.
2. Scroll down to the **System Information** section.
3. Click the green button **« Download Tech-Support Bundle »**.
4. The `.tar.gz` file will be generated and downloaded directly in your browser.

![Download Tech-Support Bundle in Settings](assets/techsupport-download-button.png)

### 2. Via the Stigix CLI
From inside the container or host CLI:

```bash
# Interactive REPL
stigix-cli> tech-support

# Headless execution with custom output path
docker exec stigix stigix-cli --exec "tech-support --output /tmp/my-node-support.tar.gz"
```

### 3. Via REST API
```bash
# Obtain Bearer token
TOKEN=$(curl -s -X POST http://<stigix-ip>:8080/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"your-password"}' | jq -r .token)

# Download bundle
curl -H "Authorization: Bearer $TOKEN" \
  http://<stigix-ip>:8080/api/system/tech-support \
  -o stigix-techsupport.tar.gz
```

---

## 🛡️ Security & Redaction Rules

Before writing any configuration file to the archive, the recursive sanitizer inspects all keys and strings:

* **Keys redacted**: Any key containing `secret`, `password`, `token`, `master_key`, `credential`, `private_key`, `auth_key`, or `api_key` is replaced with `"***REDACTED***"`.
* **JWT Tokens**: Strings matching JWT format (`eyJ...`) are replaced with `"***REDACTED_JWT***"`.
* **Sensitive Files**: `.env`, TLS private keys (`*.key`, `*.pem`), and password databases are never exported.

---

## 📜 Revision History

| Date | Stigix Version | Author / Trigger | Summary of Changes |
|---|---|---|---|
| 2026-09-26 | `v2.0.66` | Stigix Core Team | Initial creation of Tech-Support Diagnostic Bundle specification and user guide |
