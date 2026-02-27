# SD-WAN Traffic Generator - Installation Guide

**Version:** 1.1.0-patch.26  
**Last Updated:** 2026-01-23

## 📦 Docker Image Tags

The project uses three types of Docker tags to ensure stability:

| Tag | Usage | Frequency |
|-----|-------|-----------|
| **`stable`** (Recommended) | **Public Deployment / Lab** | Updated manually after validation. Long-term support. |
| **`latest`** | Internal Testing & Dev | Updated every time code is pushed to `main`. |
| **`v1.1.X-patch.X`** | Fixed Version Releases | Created when a new release is tagged (recommended for critical setups). |

## 🚀 Installation Methods

### Method 1: Pre-built Images (Recommended) ⭐

**Fastest way to get started - ready in 30 seconds**

#### Step 1: Clone the repository
```bash
git clone https://github.com/jsuzanne/stigix.git
cd stigix
```

#### Step 2: Copy example configuration
```bash
cp docker-compose.example.yml docker-compose.yml
```

**[Optional]** Edit if you need to change port or JWT_SECRET:
```bash
nano docker-compose.yml
```

#### Step 3: Start services
```bash
docker compose up -d
```

#### Step 4: Wait for initialization (~10 seconds)
```bash
docker compose logs -f
```

You should see:
- ✅ web-ui: Config files initialized
- ✅ web-ui: applications.txt created (67 apps)
- ✅ web-ui: interfaces.txt detected (eth0)
- ✅ traffic-gen: Starting SD-WAN Traffic Generator

#### Step 5: Access the dashboard
Open your browser: **http://localhost:8080**

- **Login:** admin
- **Password:** admin

#### Step 6: Start Traffic!
Click "Start Traffic" in the dashboard → Traffic generation begins immediately ✨

---

### Method 2: Build from Source

**For developers who want to modify the code**

#### Step 1: Clone the repository
```bash
git clone https://github.com/jsuzanne/stigix.git
cd stigix
```

#### Step 2: [Optional] Modify the code
Edit anything you want in:
- `web-dashboard/`
- `traffic-generator.py`
- etc.

#### Step 3: Build and start
```bash
docker compose -f docker-compose.yml up -d --build
```

The `--build` flag forces image reconstruction.

#### Step 4: Check logs
```bash
docker compose logs -f
```

#### Step 5: Access dashboard
**http://localhost:8080**  
Login: admin / admin

---

## 🔧 Advanced Configuration

### 1. Change Port (if 8080 is already in use)

In `docker-compose.yml`:
```yaml
ports:
  - "8081:8080"  # Instead of 8080:8080
```

Or use a `.env` file:
```bash
echo "WEB_UI_PORT=8081" > .env
```

### 2. Add Custom Connectivity Tests

In `docker-compose.yml`, under `web-ui > environment`:
```yaml
environment:
  # HTTP/HTTPS tests
  - CONNECTIVITY_HTTP_1=MyApp:https://myapp.company.com
  - CONNECTIVITY_HTTP_2=API:http://api.internal:8080

  # PING tests
  - CONNECTIVITY_PING_1=Gateway:10.0.0.1
  - CONNECTIVITY_PING_2=Branch:192.168.100.1

  # TCP port tests
  - CONNECTIVITY_TCP_1=SSH:192.168.1.100:22
  - CONNECTIVITY_TCP_2=Database:10.0.0.50:3306
```

### 3. Modify Request Frequency

In `docker-compose.yml`, under `traffic-gen > environment`:
```yaml
environment:
  - SLEEP_BETWEEN_REQUESTS=2  # 1 request every 2 seconds
```

Or use a `.env` file:
```bash
echo "SLEEP_BETWEEN_REQUESTS=0.5" > .env  # 2 req/sec
```

### 4. Change Log Retention

In `docker-compose.yml`, under `web-ui > environment`:
```yaml
environment:
  - LOG_RETENTION_DAYS=30     # Keep logs for 30 days
  - LOG_MAX_SIZE_MB=500       # Max 500 MB per log file
```

### 5. Secure for Production

**Change JWT_SECRET (IMPORTANT!):**
```yaml
environment:
  - JWT_SECRET=your-super-secure-secret-here
```

**Change admin password after first login:**

---

### 6. Prisma SD-WAN Integration

To enable site auto-detection and flow validation, add your Prisma credentials to `docker-compose.yml` or your `.env` file:

```yaml
environment:
  - PRISMA_SDWAN_REGION=${PRISMA_SDWAN_REGION}
  - PRISMA_SDWAN_TSGID=${PRISMA_SDWAN_TSGID}
  - PRISMA_SDWAN_CLIENT_ID=${PRISMA_SDWAN_CLIENT_ID}
  - PRISMA_SDWAN_CLIENT_SECRET=${PRISMA_SDWAN_CLIENT_SECRET}
```

Or in your `.env` file:
```bash
PRISMA_SDWAN_REGION=de
PRISMA_SDWAN_TSGID=123456789
PRISMA_SDWAN_CLIENT_ID=abc@tsgid.iam.panserviceaccount.com
PRISMA_SDWAN_CLIENT_SECRET=long-secret-key-here
```
Dashboard → Settings → Change Password

---

## 📂 File Structure After Installation

```
stigix/
├── docker-compose.yml          # Your config (copied from .example.yml)
├── config/                     # ✅ Auto-generated on first start
│   ├── applications.txt        # 67 popular SaaS applications
│   ├── interfaces.txt          # Network interface (eth0 or en0)
│   └── users.json              # Users (admin/admin)
└── logs/                       # ✅ Auto-created
    ├── traffic.log             # Traffic generator logs
    ├── test-results.jsonl      # Test results
    └── stats.json              # Statistics
```

---

## 🎯 Verify Everything Works

### 1. Check containers
```bash
docker compose ps
```

Expected output:
```
NAME               STATUS                    PORTS
sdwan-web-ui       Up (healthy)              0.0.0.0:8080->8080/tcp
sdwan-traffic-gen  Up
```

### 2. Check logs (should be CLEAN, no errors)
```bash
docker compose logs traffic-gen | grep ERROR
```

Expected result: **Empty** (no ERROR lines) ✅

### 3. Check dashboard health
```bash
curl http://localhost:8080/api/health
```

Expected result:
```json
{"status":"healthy","version":"1.1.0-patch.7"}
```

### 4. Check traffic generation
Access dashboard and click "Start Traffic"

After 10 seconds:
```bash
docker compose logs traffic-gen --tail=20
```

You should see:
```
[INFO] GET https://www.google.com - Status: 200 - Time: 123ms
[INFO] GET https://www.facebook.com - Status: 200 - Time: 456ms
```

---

## 🛠️ Useful Commands

```bash
# View logs in real-time
docker compose logs -f

# View logs for a single service
docker compose logs -f traffic-gen
docker compose logs -f web-ui

# Restart services
docker compose restart

# Stop services
docker compose stop

# Stop and remove containers
docker compose down

# Rebuild after code modification
docker compose up -d --build

# View resource usage
docker stats sdwan-web-ui sdwan-traffic-gen

# Access a container
docker compose exec web-ui sh
docker compose exec traffic-gen sh
```

---

## 🐛 Troubleshooting

### Issue: Port 8080 already in use

**Solution:** Change the port in docker-compose.yml
```yaml
ports:
  - "8081:8080"
```

### Issue: Cannot connect to dashboard

**Solution 1:** Check that containers are running
```bash
docker compose ps
```

**Solution 2:** Check logs
```bash
docker compose logs web-ui
```

**Solution 3:** Check firewall
```bash
# On Linux
sudo ufw allow 8080/tcp
```

### Issue: Traffic not generating

**Solution:** Check interfaces.txt
```bash
docker compose exec traffic-gen cat /opt/sdwan-traffic-gen/config/interfaces.txt
```

Should contain eth0 (Docker) or en0 (macOS).  
If incorrect, edit `config/interfaces.txt` and restart.

### Issue: [ERROR] Configuration file not found

**Solution:** You're using an old version!
```bash
git pull origin main
docker compose down
docker compose up -d
```

v1.1.0-patch.7 no longer has this issue ✅

### Issue: Logs fill up disk

**Solution:** Reduce retention
```yaml
environment:
  - LOG_RETENTION_DAYS=3
  - LOG_MAX_SIZE_MB=50
```

---

## ✨ Main Features

### Web Dashboard (http://localhost:8080)
- ✅ Secure login (JWT)
- ✅ Graphical configuration
- ✅ Start/Stop traffic with one click
- ✅ Real-time logs
- ✅ Statistics (requests, errors, latency)
- ✅ Connectivity tests (HTTP, PING, TCP)
- ✅ Export results (JSON)

### Traffic Generator
- ✅ 67 pre-configured SaaS applications
- ✅ Realistic generation (User-Agent, Referer, etc.)
- ✅ Multi-threading for performance
- ✅ Detailed logs (timestamp, status, latency)
- ✅ Automatic log rotation
- ✅ Configurable (frequency, apps, interfaces)

---

## 📚 Complete Documentation

- **GitHub:** https://github.com/jsuzanne/stigix
- **README:** https://github.com/jsuzanne/stigix#readme

---

## 🆘 Support

If you encounter issues:
1. Check this troubleshooting guide
2. Review logs: `docker compose logs -f`
3. Open an issue on GitHub with logs and error messages

---

**Happy traffic generating! 🚀**
