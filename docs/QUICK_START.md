# Quick Start Guide

Get your SD-WAN Traffic Generator up and running in 5 minutes!

## Prerequisites

- Docker and Docker Compose installed
- Linux, macOS, or Windows with WSL2
- At least 2GB free RAM
- Network connectivity

## Installation Methods

### Method 1: Docker Compose (Recommended)

**Step 1: Create project directory**

```bash
mkdir sdwan-traffic-gen
cd sdwan-traffic-gen
```

**Step 2: Download docker-compose.yml**

```bash
curl -O https://raw.githubusercontent.com/jsuzanne/sdwan-traffic-generator-web/main/docker-compose.yml
```

Or create it manually:

```yaml
version: '3.8'

services:
  sdwan-web-ui:
    image: jsuzanne/sdwan-web-ui:stable
    container_name: sdwan-web-ui
    ports:
      - "8080:8080"
    environment:
      - JWT_SECRET=change-this-secret-in-production
      - LOG_RETENTION_DAYS=7
      - LOG_MAX_SIZE_MB=100
    volumes:
      - ./config:/opt/sdwan-traffic-gen/config
      - ./logs:/var/log/sdwan-traffic-gen
    restart: unless-stopped
    networks:
      - sdwan-network

  sdwan-traffic-gen:
    image: jsuzanne/sdwan-traffic-gen:stable
    container_name: sdwan-traffic-gen
    environment:
      - SLEEP_BETWEEN_REQUESTS=1
    volumes:
      - ./config:/opt/sdwan-traffic-gen/config
      - ./logs:/var/log/sdwan-traffic-gen
    restart: unless-stopped
    networks:
      - sdwan-network
    depends_on:
      - sdwan-web-ui

networks:
  sdwan-network:
    driver: bridge
```

**Step 3: Create configuration directory**

```bash
mkdir -p config logs
```

**Step 4: Configure Applications**

The system automatically generates a default `config/applications-config.json` on first start. You can also create it manually with your desired applications and categories:

```bash
cat > config/applications-config.json << 'EOF'
{
  "control": { "enabled": true, "sleep_interval": 1.0 },
  "applications": [
    { "domain": "outlook.office365.com", "weight": 68, "endpoint": "/", "category": "Microsoft 365" },
    { "domain": "teams.microsoft.com", "weight": 68, "endpoint": "/api/mt/emea/beta/users/", "category": "Microsoft 365" },
    { "domain": "mail.google.com", "weight": 100, "endpoint": "/mail/", "category": "Google Workspace" }
  ]
}
EOF
```

**Step 5: Start the services**

```bash
docker compose up -d
```

**Step 6: Access the dashboard**

Open your browser to: **http://localhost:8080**

**Default credentials:** `admin` / `admin`

**⚠️ Change the password immediately after first login!**

---

## 📡 Network Mode: Host vs Bridge

The installer automatically selects the best network mode for your platform:

### Host Mode (Linux only - Native)
- ✅ **Enabled on:** Native Linux (Ubuntu, Debian, CentOS, etc.)
- ✅ **Benefits:** 
  - Full IoT simulation support (DHCP, ARP, Layer 2 protocols)
  - Better Voice/RTP performance with real network stack access
  - Real MAC address spoofing for device simulation
  - Direct access to network interfaces
- ⚙️ **Uses:** `docker-compose.host.yml`

### Bridge Mode (macOS, Windows, WSL2)
- ✅ **Enabled on:** macOS, Windows (Docker Desktop), WSL2
- ⚠️ **Limitations:**
  - IoT simulation features limited (no DHCP/ARP/Layer 2)
  - Voice/RTP works but without advanced network features
  - Network interface binding may have restrictions
- ℹ️ **Why:** Docker's Host Mode is not supported on macOS/Windows
- ⚙️ **Uses:** `docker-compose.example.yml`

### Platform Detection
The install script automatically detects your platform and selects the appropriate mode:
- **Native Linux** → Host Mode (full features)
- **WSL2** → Bridge Mode (Host Mode not recommended on WSL2)
- **macOS** → Bridge Mode (Host Mode not available)
- **Windows** → Bridge Mode (via WSL2)

**Note:** If you're on Linux and want to force Bridge Mode, you can manually download `docker-compose.example.yml` instead of using the install script.

---

## First-Time Configuration

### 1. Login to Dashboard

Navigate to `http://localhost:8080` and login with `admin/admin`.

### 2. Configure Network Interface

Go to **Configuration** tab:
- Click "Add Interface"
- Enter your network interface (e.g., `eth0`, `enp0s3`, `wlan0`)
- Click "Add"

**How to find your interface:**
```bash
# Linux
ip addr show

# macOS
ifconfig

# Look for your active network interface (usually eth0, enp0s3, or wlan0)
```

### 3. Start Traffic Generation

Go to **Dashboard** tab:
- Click the toggle button to start traffic generation
- Status should change to "Active" (green)
- Watch the request counter increase

### 4. Monitor Traffic

- **Dashboard Tab**: Real-time statistics and charts
- **Logs Tab**: Live traffic logs
- **Configuration Tab**: Adjust application weights and categories

### 5. Test Security Features

Go to **Security** tab:
- Run URL Filtering tests
- Run DNS Security tests
- Run Threat Prevention tests
- View test results history

---

## Common Tasks

### View Logs

```bash
# All logs
docker compose logs -f

# Web UI only
docker compose logs -f sdwan-web-ui

# Traffic generator only
docker compose logs -f sdwan-traffic-gen
```

### Restart Services

```bash
docker compose restart
```

### Stop Services

```bash
docker compose down
```

### Update to Latest Version

```bash
docker compose pull
docker compose up -d
```

### Change Port

If port 8080 is already in use:

```bash
# Edit docker-compose.yml
# Change: "8080:8080" to "8081:8080"

docker compose up -d
```

Or use environment variable:

```bash
echo "WEB_UI_PORT=8081" > .env
docker compose up -d
```

---

## Troubleshooting

### Port Already in Use

```bash
# Find what's using port 8080
sudo lsof -i :8080

# Change port in docker-compose.yml
# Change: "8080:8080" to "8081:8080"
```

### Container Won't Start

```bash
# Check logs
docker compose logs sdwan-web-ui
docker compose logs sdwan-traffic-gen

# Rebuild
docker compose down
docker compose up -d --build
```

### No Traffic Being Generated

1. Check network interface is configured
2. Verify traffic generation is started (green status)
3. Check logs: `docker compose logs -f sdwan-traffic-gen`
4. Verify `applications-config.json` exists and has valid entries

### Can't Access Dashboard

1. Check container is running: `docker ps`
2. Check port mapping: `docker compose ps`
3. Try `http://127.0.0.1:8080` instead of `localhost`
4. Check firewall rules

---

## Next Steps

- **[Traffic Generator Guide](TRAFFIC_GENERATOR.md)** - Learn about `applications-config.json` and categories.
- **[Security Testing](SECURITY_TESTING.md)** - Comprehensive security testing guide
- **[Configuration Guide](CONFIGURATION.md)** - Advanced configuration options
- **[Troubleshooting](TROUBLESHOOTING.md)** - Detailed troubleshooting guide

---

## Production Deployment

For production use:

1. **Change JWT_SECRET** in docker-compose.yml
2. **Change default password** after first login
3. **Use HTTPS** with reverse proxy (nginx, traefik)
4. **Restrict access** with firewall rules
5. **Enable log rotation** (already configured)
6. **Monitor disk space** for logs directory

---

**Need help?** Check the [Troubleshooting Guide](TROUBLESHOOTING.md) or open an issue on GitHub.
