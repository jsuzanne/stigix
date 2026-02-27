bash
# Créer le répertoire docs
mkdir -p ~/stigix/docs
Créez le fichier :

bash
nano ~/stigix/docs/CONFIGURATION.md
Collez ce contenu :

text
# Configuration Guide

This guide covers all configuration options for the SD-WAN Traffic Generator.

## Table of Contents

- [Application Configuration](#application-configuration)
- [Network Interfaces](#network-interfaces)
- [User Agents](#user-agents)
- [Traffic Patterns](#traffic-patterns)
- [Advanced Settings](#advanced-settings)

---

## Application Configuration

### File Location

`/opt/sdwan-traffic-gen/config/applications-config.json`

### Format (JSON)

```json
{
  "control": {
    "enabled": true,
    "sleep_interval": 1.0
  },
  "applications": [
    {
      "domain": "teams.microsoft.com",
      "weight": 95,
      "endpoint": "/api/mt/emea/beta/users/",
      "category": "Microsoft 365"
    }
  ]
}
```

- **domain**: Target application domain or IP (e.g., `teams.microsoft.com` or `http://192.168.1.1`)
- **weight**: Relative frequency (automatically managed as percentages in the Web UI)
- **endpoint**: Specific URL path (e.g., `/api/v1/users`)
- **category**: Functional grouping for the Dashboard UI

> [!TIP]
> **Protocol Support**: By default, the engine uses `https://`. To force HTTP (useful for internal servers), prefix the domain with `http://`.
> **IP Addresses**: You can use raw IP addresses as the domain. Statistics will show the full IP address for clarity.

### Weight Calculation

Weights are **relative**, not percentages. The probability of selecting an app is:

Probability = app_weight / total_weights

text

**Example:**
teams.microsoft.com|100|/api/mt/emea/beta/users/
http://192.168.203.100|50|/cgi-bin/hw.sh
google.com|50|/

text

Total weights = 200

- Teams: 100/200 = **50% of traffic**
- Google: 50/200 = **25% of traffic**
- Slack: 50/200 = **25% of traffic**

### Setting Target Percentages

If you want **exact percentages**, use this formula:

Target % = (weight / total_weights) × 100

text

**Example: 30% Teams, 20% Google, 50% others**

Let's say "others" have total weight of 500.

Teams weight = (500 × 30) / 70 = 214
Google weight = (500 × 20) / 70 = 143
Others = 500

Total = 857
Verification:

Teams: 214/857 = 25% ≈ 30% ✓

Google: 143/857 = 16.7% ≈ 20% ✓

text

### Application Categories

#### Microsoft 365 Suite

High priority (25% of traffic by default)
outlook.office365.com|100|/
teams.microsoft.com|95|/api/mt/emea/beta/users/
login.microsoftonline.com|90|/
graph.microsoft.com|85|/v1.0/me
onedrive.live.com|80|/
sharepoint.com|75|/

text

**Why these endpoints?**
- `/api/mt/emea/beta/users/` - Teams API (recognized as "Microsoft Teams" by SD-WAN)
- `/v1.0/me` - Graph API (user profile queries)
- Root paths for others (general authentication/access)

#### Google Workspace

Medium-high priority (20% of traffic)
mail.google.com|90|/mail/
drive.google.com|85|/
docs.google.com|80|/document/
meet.google.com|75|/
calendar.google.com|70|/

text

#### Collaboration Tools

Medium priority (15% of traffic)
zoom.us|70|/
slack.com|65|/api/api.test
webex.com|60|/
discord.com|55|/api/v9/gateway

text

#### Cloud Providers

Low-medium priority (5% of traffic)
portal.azure.com|40|/
console.aws.amazon.com|40|/
console.cloud.google.com|35|/

text

### Custom Profiles for Different Scenarios

#### Profile 1: Microsoft-Heavy Enterprise

40% Microsoft, 15% Google, 45% others
Save as: profile-microsoft-heavy.txt
Microsoft 365 (40%)
outlook.office365.com|150|/
teams.microsoft.com|140|/api/mt/emea/beta/users/
login.microsoftonline.com|130|/
sharepoint.com|120|/

Google Workspace (15%)
drive.google.com|60|/
mail.google.com|55|/

Others (45%)
zoom.us|80|/
slack.com|70|/api/api.test
salesforce.com|60|/
github.com|50|/

text

#### Profile 2: Cloud-Native Startup

Focus on DevOps and Cloud
Save as: profile-cloud-native.txt
Cloud Providers (30%)
portal.azure.com|100|/
console.aws.amazon.com|95|/
console.cloud.google.com|90|/

DevOps (25%)
github.com|85|/
gitlab.com|80|/
bitbucket.org|70|/

Collaboration (20%)
slack.com|75|/api/api.test
zoom.us|70|/
discord.com|65|/

Google Workspace (15%)
drive.google.com|60|/
docs.google.com|55|/

Others (10%)
asana.com|40|/
figma.com|35|/

text

#### Profile 3: Remote Work / Video-Heavy

Emphasis on video conferencing
Save as: profile-remote-work.txt
Video Conferencing (40%)
zoom.us|150|/
teams.microsoft.com|140|/api/mt/emea/beta/users/
meet.google.com|130|/
webex.com|120|/

Collaboration (30%)
slack.com|110|/api/api.test
miro.com|100|/
monday.com|95|/

Others (30%)
drive.google.com|90|/
outlook.office365.com|85|/
asana.com|80|/

text

### Applying Custom Profiles

Replace the configuration file:
`sudo cp custom-config.json /opt/sdwan-traffic-gen/config/applications-config.json`

The backend and engine will automatically detect changes within 1-5 seconds. No restart required.

---

## Network Interfaces

### File Location

`/opt/sdwan-traffic-gen/config/interfaces.txt`

text

### Finding Your Interfaces

List all interfaces
ip link show

List interfaces with IPs
ip addr show

Common interface names:
- eth0, eth1 (traditional)
- ens192, ens224 (consistent naming)
- enp0s3, enp0s8 (PCIe naming)
text

### Single Interface (Default)

echo "eth0" | sudo tee /opt/sdwan-traffic-gen/config/interfaces.txt

text

### Multiple Interfaces (Load Balancing)

cat << EOF | sudo tee /opt/sdwan-traffic-gen/config/interfaces.txt
eth0
eth1
eth2
EOF

text

Traffic will be **randomly distributed** across all interfaces.

### SD-WAN Specific Configuration

#### Scenario 1: Testing Path Selection

Interface per WAN link
eth0 = MPLS
eth1 = Internet 1
eth2 = Internet 2
eth0
eth1
eth2

text

The script will generate traffic on all three, allowing you to see SD-WAN path selection in action.

#### Scenario 2: Dedicated Management Interface

Only use data interfaces, not management
Don't include: eth0 (mgmt)
ens192
ens224

text

---

## User Agents

### File Location

`/opt/sdwan-traffic-gen/config/user_agents.txt`

text

### Purpose

Rotating User-Agent strings make traffic more realistic and help SD-WAN systems identify application types.

### Format

One User-Agent per line:

Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36
Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) WebKit/605.1.15
Microsoft Office/16.0 (Windows NT 10.0; Microsoft Teams)

text

### Default User Agents

The default configuration includes:
- **5 browser agents** (Chrome, Firefox, Safari, Edge)
- **3 mobile agents** (iOS, Android)
- **2 application agents** (Teams, Outlook)

### Adding Custom User Agents

Edit file
sudo nano /opt/sdwan-traffic-gen/config/user_agents.txt

Add your custom agent
Mozilla/5.0 (X11; Linux x86_64) Custom-Agent/1.0

text

### Finding Real User Agents

Visit: https://www.whatismybrowser.com/guides/the-latest-user-agent/

Or check your browser:
- Chrome: `chrome://version/`
- Firefox: Type "about:support" in URL bar

---

## Traffic Patterns

### Request Rate

Edit the main script:

sudo nano /opt/sdwan-traffic-gen/traffic-generator.sh

Find this line:
SLEEP_BETWEEN_REQUESTS=1

text

**Examples:**

| Value | Requests/Min | Use Case |
|-------|--------------|----------|
| 0.1 | 600 | Heavy load testing |
| 0.5 | 120 | Busy office simulation |
| 1 | 60 | **Default** - Normal usage |
| 2 | 30 | Light usage |
| 5 | 12 | Very light/background |

### Timeout Settings

Request timeout (seconds)
MAX_TIMEOUT=15

Increase for slow connections
MAX_TIMEOUT=30

Decrease for faster failure detection
MAX_TIMEOUT=5

text

### Backoff Configuration

When a site is unreachable, the script uses progressive backoff:

B1=60 # 1 min - first error
B2=300 # 5 min - second error
B3=1800 # 30 min - third error
B4=3600 # 1 hour - persistent errors
B5=10800 # 3 hours - site down

text

**Customizing backoff:**

More aggressive (shorter backoff)
B1=30
B2=120
B3=600

More lenient (longer backoff)
B1=300
B2=900
B3=3600

text

---

## Advanced Settings

### Client ID

The default client ID is `client01`. To run multiple instances:

Instance 1
sudo /opt/sdwan-traffic-gen/traffic-generator.sh client01 &

Instance 2
sudo /opt/sdwan-traffic-gen/traffic-generator.sh client02 &

Instance 3
sudo /opt/sdwan-traffic-gen/traffic-generator.sh client03 &

text

Each will log separately with its client ID in the logs.

### Statistics Interval

Statistics are written every 50 requests by default.

In updateStats() function, find:
if (( (TOTAL_REQUESTS % 50) == 0 )); then
writeStats
fi

Change to write every 100 requests:
if (( (TOTAL_REQUESTS % 100) == 0 )); then

text

### Log Rotation Tuning

Edit logrotate configuration:

sudo nano /etc/logrotate.d/sdwan-traffic-gen

text

**Conservative** (small logs):
/var/log/sdwan-traffic-gen/*.log {
daily
rotate 3
size 50M
compress
...
}

text

**Aggressive** (keep more history):
/var/log/sdwan-traffic-gen/*.log {
daily
rotate 14
size 200M
compress
...
}

text

### Environment Variables

You can override settings via environment variables:

Create override file
sudo mkdir -p /etc/systemd/system/sdwan-traffic-gen.service.d
sudo nano /etc/systemd/system/sdwan-traffic-gen.service.d/override.conf

Add:
[Service]
Environment="CLIENT_ID=demo-client"
Environment="SLEEP_TIME=0.5"

Reload
sudo systemctl daemon-reload
sudo systemctl restart sdwan-traffic-gen

text

---

## Validation & Testing

### Verify Configuration Syntax

Test applications.txt format
awk -F'|' 'NF!=3 {print "Invalid line:", NR, $0}'
/opt/sdwan-traffic-gen/config/applications.txt

Should return nothing if all lines are valid
text

### Test Individual Application

Test manually
curl --interface eth0
-H "User-Agent: Mozilla/5.0"
-sL -m 15 -w "%{http_code}"
-o /dev/null
https://teams.microsoft.com/api/mt/emea/beta/users/

text

### Dry Run Mode

Stop service
sudo systemctl stop sdwan-traffic-gen

Run manually to see debug output
sudo bash -x /opt/sdwan-traffic-gen/traffic-generator.sh client01

text

Press `Ctrl+C` to stop after verifying.

---

## Configuration Backup & Restore

### Backup

Backup all configs
sudo tar -czf ~/sdwan-config-backup-$(date +%Y%m%d).tar.gz
/opt/sdwan-traffic-gen/config/

Verify backup
tar -tzf ~/sdwan-config-backup-*.tar.gz

text

### Restore

Stop service
sudo systemctl stop sdwan-traffic-gen

Restore
sudo tar -xzf ~/sdwan-config-backup-*.tar.gz -C /

Restart
sudo systemctl start sdwan-traffic-gen

text

---

## Best Practices

1. **Always backup** before major config changes
2. **Test in stages**: Change one thing at a time
3. **Monitor logs** after changes: `tail -f /var/log/sdwan-traffic-gen/traffic.log`
4. **Use meaningful weights**: Don't just use 1, 2, 3... use 10, 20, 30 for easier math
5. **Document custom profiles**: Comment your applications.txt file
6. **Version control**: Keep your custom profiles in git

---

---

**Related Documentation:**
- [Installation Guide](../README.md#installation)
- [Traffic Generator Guide](TRAFFIC_GENERATOR.md)
- [Troubleshooting](TROUBLESHOOTING.md)

**Last Updated:** 2026-02-18  
**Version:** 1.2.1-patch.65
