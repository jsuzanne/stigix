# Maintenance & Update Guide

Keeping your SD-WAN Traffic Generator up to date ensures you have the latest performance improvements, security patches, and features (like the Convergence Lab).

---

## 🚀 Option 1: One-Click UI Update (Recommended)

The easiest way to update is directly from the Dashboard.

1. Log in as **admin**.
2. Navigate to the **System** tab.
3. If a new version is detected, click **"Update to Latest Stable"**.
4. The system will pull new images and restart automatically. Refresh your browser after 10-20 seconds.

> [!NOTE]
> This requires the Docker socket (`/var/run/docker.sock`) to be correctly mounted in your `docker-compose.yml`.

---

## 📜 Option 2: Scripted Update (Linux / macOS)

If you used the one-liner installation, you can run it again to update.

```bash
curl -sSL https://raw.githubusercontent.com/jsuzanne/sdwan-traffic-generator-web/main/install.sh | bash
```

The script will detect your existing installation and offer an **Upgrade** option:
- Select **1) Update images and restart services**.
- All your configurations (`config/*.txt`) and logs will be preserved.

---

## 💻 Option 3: Manual Update (All Platforms)

If you prefer using the terminal or are on Windows, use standard Docker commands.

### Linux / macOS
```bash
cd sdwan-traffic-gen
docker compose pull
docker compose up -d
```

### Windows (PowerShell / CMD)
```powershell
cd sdwan-traffic-gen
docker-compose pull
docker-compose up -d
```

---

## 🛠️ Maintenance Tasks

### Clearing Statistics
To reset all traffic counters and start fresh:
1. Go to the **Statistics** tab.
2. Click **"Reset All Statistics"**.
3. This clears the `stats.json` file but keeps your app configuration.

### Log Rotation
The system handles log rotation automatically:
- **Max Size**: 100MB per file.
- **Retention**: 7 days (default).
- You can adjust these in your `docker-compose.yml` environment variables:
  - `LOG_RETENTION_DAYS=14`
  - `LOG_MAX_SIZE_MB=200`

### Changing the Target Mode
If you want to switch a site from "Dashboard" to "Target Site" mode:
1. Stop services: `docker compose down`
2. Run the `install.sh` script again.
3. Select **2) Target Site Only**.

---

## 💾 Configuration Backup & Recovery

You can backup your entire system configuration (apps, security tests, and users) into a single portable JSON file.

### Exporting (Backup)
1. Go to the **System** tab.
2. Click **"Download Backup Bundle"**.
3. Save the resulting `.json` file. This includes all your custom tuning, users, and probes.

### Importing (Restore / Clone)
To restore a backup or clone it to another site (e.g., from DC1 to Branch A):
1. Install a fresh instance of SD-WAN Traffic Generator on the new site.
2. Go to the **System** tab.
3. Click **"Upload & Restore Bundle"** and select your saved JSON file.
4. The system will apply the settings and restart automatically.

> [!WARNING]
> Restoring a bundle will overwrite all current settings in the `config/` directory.

---

## ❓ Troubleshooting Updates

**Issue: "Update failed" in UI**
- Check if your internet connection is active.
- Ensure the container has permission to access the Docker socket.
- Run `docker compose logs -f sdwan-web-ui` to see the error details.

**Issue: Port 8080 already in use**
- If you are running multiple instances, change the port mapping in `docker-compose.yml`:
  ```yaml
  ports:
    - "8081:8080"
  ```
