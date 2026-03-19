# SD-WAN Traffic Generator - Installation Guide

**Version:** 1.2.1-patch.246  
**Last Updated:** 2026-03-19

## 🚀 One-Liner Quick Start ⭐

The fastest way to deploy Stigix is using our interactive installation script. It automatically detects your operating system and configures the environment.

```bash
curl -sSL https://raw.githubusercontent.com/jsuzanne/stigix/main/install.sh | bash
```

### What the script does:
1.  **Prerequisite Check**: Verifies that Docker is installed and running.
2.  **OS Detection**: Configures networking (Native Host Mode for Linux, Bridge Mode for macOS/WSL).
3.  **Mode Selection**: Let's you choose between **Full Dashboard** (Source + Target) or **Target Only** mode.
4.  **Deployment**: Pulls the single `jsuzanne/stigix:stable` image and starts everything via Docker Compose.

---

## 🛠️ Manual Installation

If you prefer to set up the environment manually, follow these steps:

### 1. Requirements
- **Docker**: Engine 20.10+ and Compose V2.
- **Resources**: ~1GB RAM and 500MB Disk space.
- **Ports**: 8080 (UI), 3100 (MCP), 8082 (Target), 9000 (XFR), 5201 (iPerf).

### 2. Steps
```bash
git clone https://github.com/jsuzanne/stigix.git
cd stigix

# Initialize environment
cp .env.example .env
# Edit .env to add your credentials (Optional)
nano .env

# Start the All-in-One container
docker compose up -d
```

### 3. Verification
Access the dashboard at **http://localhost:8080**  
Default Credentials: `admin` / `admin`

---

## 🏗️ Deployment Modes

| Mode | Command Line Flag | Description |
|------|-------------------|-------------|
| **Both** | `--mode both` | Full dashboard + Traffic Generator + All internal Targets. |
| **Target Only** | `--mode target` | Only the responsive services (HTTP, Voice, XFR, iPerf). No UI. |
| **Source Only** | `--mode source` | Only the Dashboard and Traffic Generator. No local targets. |

---

## 🔧 Advanced Configuration

For a full reference of all supported environment variables, see **[ENVIRONMENT_VARIABLES.md](docs/ENVIRONMENT_VARIABLES.md)**.

### 🐧 Linux (Native Host Mode)
For best results on Linux, Stigix uses `network_mode: host`. This allows the container to:
- Bind directly to your physical interfaces.
- Simulate raw traffic (ARP, DHCP, RTP) without NAT interference.
- Measure convergence times with microsecond precision.

### 🍎 macOS / Windows (Bridge Mode)
On macOS and Windows (via Docker Desktop), host networking is not supported. Stigix automatically switches to **Bridge Mode**, which maps ports normally. While this works perfectly for dashboard and SaaS traffic, some raw-socket features (like IoT ARP/DHCP simulation) may be limited.

---

## 📂 File Structure

```text
stigix/
├── docker-compose.yml     # Consolidated All-in-One configuration
├── .env                   # Your local settings and credentials
├── config/                # Persistence for apps, probes, and users
├── logs/                  # Real-time traffic and test logs
└── mcp-data/              # Data for the Natural Language bridge
```

---

## 🆘 Troubleshooting

### Port 8080 already in use
If your UI fails to start, change `PORT` in your `.env` file:
```bash
echo "PORT=8081" >> .env
docker compose up -d
```

### Docker Permissions
If you get `Permission Denied`, ensure your user is in the `docker` group:
```bash
sudo usermod -aG docker $USER
# Log out and log back in
```

---

**Happy traffic generating! 🚀**
