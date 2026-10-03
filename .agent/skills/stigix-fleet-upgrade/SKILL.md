---
name: stigix-fleet-upgrade
description: >
  Procedure for rolling out upgrades across all Stigix SD-WAN lab machines (DC1, BR1, BR2, BR5, BR8)
  via SSH using docker system prune and docker compose.
---

# Stigix Fleet Upgrade Skill

Use this skill whenever the user asks to "upgrade", update, or roll out the latest Stigix image across the lab nodes.

## Target Nodes & Topology

| Site / Node | IP Address | Hostname | Role |
|---|---|---|---|
| **DC1** | `192.168.122.51` | `lubuntu201` | Leader / Core Hub |
| **BR2** | `192.168.122.56` | `lubuntu206` | Spoke Branch |
| **BR1** | `192.168.122.57` | `Ubuntu207` | Spoke Branch |
| **BR5** | `192.168.123.101` | `ubuntubr5` | Spoke Branch |
| **BR8** | `192.168.123.102` | `UbuntuBR8` | Spoke Branch (MCP Host) |

## SSH Connection Profile

- **User**: `jsuzanne`
- **Identity Key**: `~/.ssh/id_ed25519_antigravity_lab`
- **Options**: `-o BatchMode=yes -o ConnectTimeout=10`
- **Application Directory**: `~/stigix`

```bash
ssh -i ~/.ssh/id_ed25519_antigravity_lab jsuzanne@<IP> "cd stigix && ..."
```

## Build Completion Verification

Before triggering node upgrades, verify that the GitHub Actions build has published the target Docker tag (or short commit SHA):

```bash
ssh -i ~/.ssh/id_ed25519_antigravity_lab jsuzanne@192.168.122.51 \
  "docker manifest inspect jsuzanne/stigix:sha-<SHORT_SHA>"
```
- Return code `0`: Image is published on Docker Hub and ready for deployment.
- Return code non-zero: Build is still running in GitHub Actions.

## Standard Upgrade Command

For each machine, execute:

```bash
cd stigix && docker system prune -a -f && docker compose up -d --pull=always --force-recreate
```

### Full Fleet Deployment Script

```bash
NODES=(
  "192.168.122.51:DC1"
  "192.168.122.56:BR2"
  "192.168.122.57:BR1"
  "192.168.123.101:BR5"
  "192.168.123.102:BR8"
)

for ENTRY in "${NODES[@]}"; do
  IP="${ENTRY%%:*}"
  NAME="${ENTRY##*:}"
  echo "===> Upgrading $NAME ($IP)..."
  ssh -i ~/.ssh/id_ed25519_antigravity_lab -o BatchMode=yes -o ConnectTimeout=15 jsuzanne@$IP \
    "cd stigix && docker system prune -a -f && docker compose up -d --pull=always --force-recreate"
done
```

## Post-Upgrade Health Check

1. Check running containers on all nodes:
   ```bash
   ssh -i ~/.ssh/id_ed25519_antigravity_lab jsuzanne@$IP "docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}'"
   ```

2. Confirm version on Leader DC1:
   ```bash
   curl -s http://192.168.122.51:8080/api/version
   ```

3. Confirm Fleet Control Plane registered peers:
   ```bash
   curl -s http://192.168.122.51:8080/api/fleet/overview
   ```
