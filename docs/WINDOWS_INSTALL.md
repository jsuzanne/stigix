# Windows Installation Guide

Complete step-by-step guide to install and run SD-WAN Traffic Generator on Windows 10/11.

---

## 📋 Table of Contents

- [System Requirements](#-system-requirements)
- [Step 1: Install WSL 2](#-step-1-install-wsl-2)
- [Step 2: Install Docker Desktop](#-step-2-install-docker-desktop)
- [Step 3: Install the Application](#-step-3-install-the-application)
- [Step 4: Access the Dashboard](#-step-4-access-the-dashboard)
- [Useful Commands](#-useful-commands)
- [Troubleshooting](#-troubleshooting)
- [Uninstallation](#-uninstallation)

---

## 📋 System Requirements

- **Operating System:** Windows 10 64-bit (Build 2004 or later) or Windows 11
- **RAM:** Minimum 4 GB (8 GB recommended)
- **Disk Space:** 10 GB free space
- **Privileges:** Administrator access required for initial setup
- **Internet:** Active connection for downloading Docker images

---

## 🔧 Step 1: Install WSL 2

WSL 2 (Windows Subsystem for Linux) is required for Docker Desktop on Windows.

### 1.1 Open PowerShell as Administrator

- Press `Win + X`
- Select **"Windows PowerShell (Admin)"** or **"Terminal (Admin)"**

### 1.2 Install WSL 2

```powershell
wsl --install
```

This command will:
- Enable WSL feature
- Enable Virtual Machine Platform feature
- Download and install the Linux kernel
- Install Ubuntu distribution (default)

### 1.3 Restart Windows

```powershell
Restart-Computer
```

Or manually restart your computer.

### 1.4 Verify WSL Installation

After reboot, open PowerShell (no admin needed) and run:

```powershell
wsl --list --verbose
```

**Expected output:**
```text
  NAME            STATE    VERSION
* docker-desktop  Running  2
```

If you see `VERSION 1`, upgrade to WSL 2:

```powershell
wsl --set-default-version 2
```

---

## 🐳 Step 2: Install Docker Desktop

### 2.1 Download Docker Desktop

1. Go to: https://www.docker.com/products/docker-desktop/
2. Click **"Download for Windows"**
3. Save the installer (Docker Desktop Installer.exe)

### 2.2 Run the Installer

1. Double-click **Docker Desktop Installer.exe**
2. Make sure **"Use WSL 2 instead of Hyper-V"** is checked
3. Click **"OK"** to proceed with installation
4. Wait for installation to complete (2-5 minutes)

### 2.3 Start Docker Desktop

1. Click **"Close and restart"** when prompted (or restart manually)
2. After restart, Docker Desktop will launch automatically
3. Wait for the 🐳 icon to appear in the system tray (bottom-right)
4. **Important:** Wait until the icon stops animating (1-2 minutes)

### 2.4 Verify Docker Installation

Open PowerShell and run:

```powershell
docker --version
docker ps
```

**Expected output:**
```text
Docker version 24.0.7, build afdd53b
CONTAINER ID   IMAGE     COMMAND   CREATED   STATUS    PORTS     NAMES
```

If you see an error like:
```
error during connect: ... pipe/dockerDesktopLinuxEngine: The system cannot find the file specified
```

This means Docker Desktop is not running. Launch it from the Start menu and wait 1-2 minutes.

---

## 🚀 Step 3: Install the Application

### 3.1 Create Installation Directory

Open PowerShell (no admin needed):

```powershell
# Create directory
mkdir C:\sdwan-traffic-gen
cd C:\sdwan-traffic-gen
```

### 3.2 Download docker-compose.yml

```powershell
# Note: Use curl.exe (not curl alias in PowerShell)
curl.exe -L https://raw.githubusercontent.com/jsuzanne/sdwan-traffic-generator-web/main/docker-compose.example.yml -o docker-compose.yml
```

### 3.3 Verify Download

```powershell
type docker-compose.yml
```

You should see YAML configuration starting with `services:`.

### 3.4 Start the Application

```powershell
docker compose up -d
```

**First run may take 2-5 minutes** to download images (~500 MB total).

**Expected output:**
```text
[+] Running 3/3
 ✔ Network sdwan-traffic-gen_default          Created
 ✔ Container sdwan-web-ui                     Healthy
 ✔ Container sdwan-traffic-gen                Started
```

### 3.5 Verify Containers are Running

```powershell
docker compose ps
```

**Expected output:**
```text
NAME               STATUS                    PORTS
sdwan-web-ui       Up (healthy)              0.0.0.0:8080->8080/tcp
sdwan-traffic-gen  Up
```

### 3.6 Check Logs

```powershell
docker compose logs
```

Look for:
```text
🚀 SD-WAN Traffic Generator v1.1.0-patch.7
Backend running at http://localhost:8080
Created default applications.txt with 67 applications
Created default interfaces.txt (auto-detected)
```

**No [ERROR] messages should appear.**

---

## 🌐 Step 4: Access the Dashboard

### 4.1 Open Browser

On the Windows machine, open your preferred browser and navigate to:

```
http://localhost:8080
```

### 4.2 Login

- **Username:** `admin`
- **Password:** `admin`

⚠️ **Important:** Change the default password after first login!

### 4.3 Configure Network Interface (if needed)

1. Go to **Configuration** tab
2. Check the detected network interface
3. If incorrect, edit `C:\sdwan-traffic-gen\config\interfaces.txt`
4. Restart: `docker compose restart`

### 4.4 Start Traffic Generation

1. Click **Start Traffic** on the dashboard
2. Monitor real-time logs and statistics

---

## 🛠️ Useful Commands

All commands should be run in PowerShell from `C:\sdwan-traffic-gen`:

```powershell
cd C:\sdwan-traffic-gen
```

### View Logs

```powershell
# All logs
docker compose logs

# Follow logs in real-time
docker compose logs -f

# Specific service
docker compose logs sdwan-web-ui
docker compose logs sdwan-traffic-gen
```

### Restart Services

```powershell
# Restart all
docker compose restart

# Restart specific service
docker compose restart sdwan-web-ui
```

### Stop Services

```powershell
# Stop (keep containers)
docker compose stop

# Stop and remove containers
docker compose down
```

### Update to Latest Version

```powershell
# Pull latest images
docker compose pull

# Restart with new images
docker compose down
docker compose up -d
```

### Check Resource Usage

```powershell
docker stats sdwan-web-ui sdwan-traffic-gen
```

### Access Container Shell

```powershell
# Web UI container
docker compose exec sdwan-web-ui sh

# Traffic generator container
docker compose exec sdwan-traffic-gen sh

# Type 'exit' to leave the shell
```

---

## 🐛 Troubleshooting

### Issue: "Cannot connect to the Docker daemon"

**Error:**
```text
error during connect: ... pipe/dockerDesktopLinuxEngine: The system cannot find the file specified
```

**Solution:**
1. Launch **Docker Desktop** from Start menu
2. Wait 1-2 minutes until 🐳 icon in system tray is stable
3. Verify: `docker ps` (should work without error)
4. Try again: `docker compose up -d`

---

### Issue: "context deadline exceeded" during pull

**Error:**
```text
Error response from daemon: Get "https://registry-1.docker.io/v2/": context deadline exceeded
```

**Cause:** Network timeout when downloading from Docker Hub.

**Solution:**
```powershell
# Retry the pull
docker compose pull

# If still fails, wait a few minutes and try again
```

---

### Issue: Port 8080 already in use

**Error:**
```text
Bind for 0.0.0.0:8080 failed: port is already allocated
```

**Solution:**

Option 1 - Change port:
```powershell
notepad docker-compose.yml
```

Find the `ports:` section for `sdwan-web-ui`:
```yaml
ports:
  - "8081:8080"  # Changed from 8080:8080
```

Save and restart:
```powershell
docker compose down
docker compose up -d
```

Access at: `http://localhost:8081`

Option 2 - Stop conflicting service:
```powershell
# Find what's using port 8080
netstat -ano | findstr :8080

# Stop the process (replace PID with actual number)
taskkill /PID <PID> /F
```

---

### Issue: WSL 2 not installed

**Error:**
```text
WSL 2 installation is incomplete
```

**Solution:**
1. Open PowerShell as Administrator
2. Run:
   ```powershell
   wsl --install
   wsl --set-default-version 2
   ```
3. Restart Windows
4. Launch Docker Desktop

---

### Issue: Docker Desktop won't start

**Symptoms:**
- Docker Desktop icon keeps spinning
- "Docker Desktop starting..." never completes

**Solutions:**

1. **Restart WSL:**
   ```powershell
   wsl --shutdown
   # Wait 10 seconds
   # Launch Docker Desktop again
   ```

2. **Reset Docker Desktop:**
   - Right-click Docker Desktop icon in system tray
   - Select **"Troubleshoot"**
   - Click **"Reset to factory defaults"**
   - Restart Docker Desktop

3. **Check Windows Updates:**
   - Ensure Windows is fully updated
   - Some Docker features require latest Windows builds

---

### Issue: No traffic being generated

**Symptoms:**
- Dashboard shows "Active" but no requests logged
- Traffic counter stays at 0

**Solutions:**

1. **Check network interface:**
   ```powershell
   type C:\sdwan-traffic-gen\config\interfaces.txt
   ```
   Should show a valid interface (e.g., `eth0`, `Ethernet`).

2. **Check traffic is started:**
   - Dashboard → "Start Traffic" button should be green

3. **Check logs:**
   ```powershell
   docker compose logs sdwan-traffic-gen
   ```
   Look for errors.

---

### Issue: "version is obsolete" warning

**Warning:**
```text
WARN: the attribute `version` is obsolete, it will be ignored
```

**Solution:** This is just a warning, not an error. To remove it:

```powershell
notepad docker-compose.yml
```

Delete the first line:
```yaml
version: '3.8'  # ← Delete this entire line
```

Save and restart:
```powershell
docker compose down
docker compose up -d
```

---

## 🗑️ Uninstallation

### Remove Application

```powershell
cd C:\sdwan-traffic-gen

# Stop and remove containers
docker compose down

# Remove images (optional)
docker rmi jsuzanne/sdwan-web-ui:stable
docker rmi jsuzanne/sdwan-traffic-gen:stable

# Remove directory
cd ..
Remove-Item -Recurse -Force C:\sdwan-traffic-gen
```

### Uninstall Docker Desktop

1. Open **Settings** → **Apps** → **Installed apps**
2. Find **Docker Desktop**
3. Click **"..."** → **"Uninstall"**
4. Follow prompts

### Uninstall WSL (optional)

⚠️ **Warning:** Only do this if you don't use WSL for anything else.

```powershell
# Open PowerShell as Administrator
wsl --unregister Ubuntu
wsl --unregister docker-desktop
wsl --unregister docker-desktop-data

# Disable WSL feature
dism.exe /online /disable-feature /featurename:Microsoft-Windows-Subsystem-Linux /norestart
dism.exe /online /disable-feature /featurename:VirtualMachinePlatform /norestart
```

Restart Windows.

---

## 📚 Additional Resources

- **Docker Desktop for Windows:** https://docs.docker.com/desktop/install/windows-install/
- **WSL 2 Documentation:** https://docs.microsoft.com/en-us/windows/wsl/
- **Main Documentation:** [README.md](../README.md)
- **General Troubleshooting:** [Troubleshooting Guide](TROUBLESHOOTING.md)

---

## 🆘 Still Having Issues?

If you encounter problems not covered here:

1. **Check GitHub Issues:** https://github.com/jsuzanne/stigix/issues
2. **Create a new issue** with:
   - Windows version (`winver` command)
   - Docker version (`docker --version`)
   - WSL version (`wsl --list --verbose`)
   - Error messages and logs
   - Steps to reproduce

---

**Made with ❤️ for Windows users**

[← Back to Main Documentation](../README.md)
