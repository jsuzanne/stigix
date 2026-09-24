> **Last Updated:** 2026-05-11 | **Created:** 2026-05-11 (v1.3.0-patch.16)

# Stigix on Azure — Deployment Guide

Step-by-step guide to deploy Stigix on a Microsoft Azure Ubuntu VM.

---

## Table of Contents

- [Step 1: Create the Azure VM](#step-1-create-the-azure-vm)
- [Step 2: Connect and prepare the VM](#step-2-connect-and-prepare-the-vm)
- [Step 3: Install Docker](#step-3-install-docker)
- [Step 4: Install Stigix](#step-4-install-stigix)
- [Step 5: Access the Dashboard](#step-5-access-the-dashboard)
- [Troubleshooting](#troubleshooting)

---

## Step 1: Create the Azure VM

### Recommended settings

| Parameter | Value |
|-----------|-------|
| **Image** | Ubuntu Server 22.04 LTS |
| **Size** | Standard B2s (2 vCPU, 4 GB RAM) minimum |
| **OS disk** | 30 GB Standard SSD |
| **Authentication** | SSH public key (recommended) |

### Open the required ports (NSG rules)

In the Azure portal, go to your VM → **Networking** and add these **Inbound rules**:

| Port | Protocol | Purpose |
|------|----------|---------|
| 22 | TCP | SSH access |
| 8080 | TCP | Stigix web dashboard |

> **Tip:** Restrict the source IP to your own IP or a trusted range instead of `Any`.

Note down the **Public IP** of your VM — you'll need it to connect.

---

## Step 2: Connect and prepare the VM

### Connect via SSH

```bash
ssh -i /path/to/your_key.pem azureuser@PUBLIC_IP
```

> Replace `azureuser` with your actual username and `PUBLIC_IP` with the VM's public IP.

### Update the system

```bash
sudo apt update && sudo apt upgrade -y
```

### Configure the firewall

```bash
sudo ufw allow OpenSSH
sudo ufw allow 8080/tcp
sudo ufw enable
```

---

## Step 3: Install Docker

Run these commands one by one:

```bash
# Install dependencies
sudo apt-get install -y ca-certificates curl gnupg

# Add Docker's GPG key
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | \
  sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg

# Add the Docker repository
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
  https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

# Install Docker Engine + Compose plugin
sudo apt update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# Allow your user to run Docker without sudo
sudo usermod -aG docker $USER
```

**Log out and back in** so the group membership takes effect:

```bash
exit
ssh -i /path/to/your_key.pem azureuser@PUBLIC_IP
```

### Verify Docker is working

```bash
docker --version
docker ps
```

---

## Step 4: Install Stigix

### Option A — Automatic installer (recommended)

```bash
curl -sSL https://raw.githubusercontent.com/jsuzanne/stigix/main/install.sh | bash
```

The script will:
- Detect that you are on Linux and use **host networking** (best performance)
- Pull the `jsuzanne/stigix:stable` image from Docker Hub
- Generate default configuration (apps, interface, admin user)
- Start the Stigix container

### Option B — Docker Compose (manual)

```bash
mkdir -p stigix && cd stigix
curl -sSL -o docker-compose.yml \
  https://raw.githubusercontent.com/jsuzanne/stigix/main/docker-compose.yml
docker compose up -d
```

---

## Step 5: Access the Dashboard

Open your browser and go to:

```
http://PUBLIC_IP:8080
```

Default login credentials:

| Field | Value |
|-------|-------|
| **Username** | `admin` |
| **Password** | `admin` |

⚠️ **Change the default password** immediately after first login (Settings → Change Password).

---

## Troubleshooting

### Dashboard not loading

1. Check the NSG allows inbound TCP 8080 (Azure portal → VM → Networking)
2. Check UFW allows port 8080:
   ```bash
   sudo ufw status
   ```
3. Check the container is running:
   ```bash
   docker ps
   ```
4. Check the health endpoint from the VM:
   ```bash
   curl http://localhost:8080/api/health
   ```
5. Check Stigix logs:
   ```bash
   # If using docker compose:
   docker compose logs -f

   # If using the installer (single container):
   docker logs stigix -f
   ```

### Common error: "permission denied" on docker

You haven't reconnected after adding your user to the docker group. Log out and SSH back in.

### Common error: Port 8080 already in use

Another service is using port 8080. Find and stop it:

```bash
sudo ss -tlnp | grep :8080
```

---

## Useful Commands

```bash
# View logs
docker compose logs -f

# Restart Stigix
docker compose restart

# Stop Stigix
docker compose down

# Update to the latest version
docker compose pull && docker compose down && docker compose up -d
```

---

[← Back to Main Documentation](../README.md)
