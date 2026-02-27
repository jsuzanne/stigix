# Troubleshooting Guide

Common issues and their solutions.

## Table of Contents

- [Service Issues](#service-issues)
- [Network Connectivity](#network-connectivity)
- [Configuration Problems](#configuration-problems)
- [Performance Issues](#performance-issues)
- [Log Issues](#log-issues)

---

## Service Issues

### Service Won't Start

**Symptom:**
sudo systemctl start sdwan-traffic-gen

Job for sdwan-traffic-gen.service failed
text

**Diagnosis:**
Check detailed error
sudo journalctl -u sdwan-traffic-gen -n 50 --no-pager

Check service status
sudo systemctl status sdwan-traffic-gen

text

**Common Causes & Solutions:**

#### 1. Missing configuration files

Check files exist
ls -la /opt/sdwan-traffic-gen/config/

Should show:
applications.txt
interfaces.txt
user_agents.txt
If missing, reinstall
cd stigix
sudo ./install.sh

text

#### 2. Permission problems

Fix permissions
sudo chown -R root:root /opt/sdwan-traffic-gen
sudo chmod +x /opt/sdwan-traffic-gen/traffic-generator.sh
sudo chmod 644 /opt/sdwan-traffic-gen/config/*

Restart
sudo systemctl restart sdwan-traffic-gen

text

#### 3. Script syntax error

Test script manually
sudo bash -n /opt/sdwan-traffic-gen/traffic-generator.sh

If errors, check for:
- Missing quotes
- Unclosed brackets
- Invalid bash syntax
Reinstall if corrupted
cd stigix
sudo cp traffic-generator.sh /opt/sdwan-traffic-gen/
sudo systemctl restart sdwan-traffic-gen

text

### Service Keeps Restarting

**Symptom:**
sudo systemctl status sdwan-traffic-gen

Active: activating (auto-restart)
text

**Diagnosis:**
Watch logs in real-time
sudo journalctl -u sdwan-traffic-gen -f

text

**Solutions:**

#### Check for crash loop

See if there's a repeating error
sudo journalctl -u sdwan-traffic-gen | tail -100

Common errors:
"Interface not found" → Fix interfaces.txt
"Permission denied" → Fix permissions
"Connection refused" → Network issue
text

#### Run manually to see error

Stop service
sudo systemctl stop sdwan-traffic-gen

Run manually
sudo /opt/sdwan-traffic-gen/traffic-generator.sh client01

Watch for error messages
Press Ctrl+C to stop
text

### Service Shows Active But No Traffic

**Symptom:**
sudo systemctl status sdwan-traffic-gen

Active: active (running)
But no logs:
tail /var/log/sdwan-traffic-gen/traffic.log

(empty or old entries)
text

**Diagnosis:**
Check if process exists
ps aux | grep traffic-generator

Check if it's actually running
pgrep -af traffic-generator

text

**Solutions:**

Force restart
sudo systemctl stop sdwan-traffic-gen
sudo pkill -9 -f traffic-generator
sudo systemctl start sdwan-traffic-gen

Wait 5 seconds
sleep 5

Check logs
tail -f /var/log/sdwan-traffic-gen/traffic.log

text

---

## Network Connectivity

### No Requests Going Through

**Symptom:**
All requests show `code: 000` in logs:
[INFO] client01 FAILED https://google.com/ - code: 000

text

**Diagnosis:**
Test basic connectivity
ping -c 3 8.8.8.8

Test DNS
nslookup google.com

Test HTTPS
curl -I https://google.com

text

**Solutions:**

#### 1. Interface doesn't exist

List actual interfaces
ip link show

Update config with real interface
echo "eth0" | sudo tee /opt/sdwan-traffic-gen/config/interfaces.txt

Restart
sudo systemctl restart sdwan-traffic-gen

text

#### 2. Firewall blocking

Check firewall rules
sudo iptables -L -n

Temporarily disable to test (CAUTION)
sudo ufw disable

or
sudo iptables -F

Test again
tail -f /var/log/sdwan-traffic-gen/traffic.log

Re-enable firewall after test
sudo ufw enable

text

#### 3. No default route

Check routing table
ip route show

Should have a default route like:
default via 192.168.1.1 dev eth0
If missing, add temporarily
sudo ip route add default via YOUR_GATEWAY dev eth0

text

#### 4. Proxy required

If your network requires a proxy:

Set proxy for curl
export https_proxy=http://proxy.company.com:8080
export http_proxy=http://proxy.company.com:8080

Add to service
sudo mkdir -p /etc/systemd/system/sdwan-traffic-gen.service.d
cat << EOF | sudo tee /etc/systemd/system/sdwan-traffic-gen.service.d/proxy.conf
[Service]
Environment="https_proxy=http://proxy.company.com:8080"
Environment="http_proxy=http://proxy.company.com:8080"
EOF

Reload
sudo systemctl daemon-reload
sudo systemctl restart sdwan-traffic-gen

text

### Only Some Applications Fail

**Symptom:**
[INFO] client01 SUCCESS https://google.com/ - code: 200
[INFO] client01 FAILED https://specific-app.com/ - code: 000

text

**Diagnosis:**
Test failing app manually
curl -I https://specific-app.com/

Test with same interface
curl --interface eth0 -I https://specific-app.com/

text

**Solutions:**

- **Site is down**: Remove from applications.txt temporarily
- **Requires authentication**: Normal, backoff will handle it
- **Blocked by firewall**: Add firewall rule
- **DNS issue**: Check `/etc/resolv.conf`

### High Error Rate

**Symptom:**
Many errors in `stats.json`:
{
"errors_by_app": {
"teams": 15,
"slack": 12
}
}

text

**Solutions:**

1. **Increase timeout**:
sudo nano /opt/sdwan-traffic-gen/traffic-generator.sh

Change: MAX_TIMEOUT=15 to MAX_TIMEOUT=30
text

2. **Check network quality**:
Packet loss test
ping -c 100 8.8.8.8 | grep loss

If high loss, investigate network issues
text

3. **Reduce request rate**:
Give more time between requests
sudo nano /opt/sdwan-traffic-gen/traffic-generator.sh

Change: SLEEP_BETWEEN_REQUESTS=1 to SLEEP_BETWEEN_REQUESTS=2
text

---

## Configuration Problems

### Invalid Applications.txt Format

**Symptom:**
Service starts but no traffic, or errors like:
[ERROR] Invalid format in applications.txt

text

**Diagnosis:**
Check format
cat /opt/sdwan-traffic-gen/config/applications.txt

Each line should be: domain|weight|endpoint
Example: google.com|50|/
text

**Solutions:**

Validate format
awk -F'|' 'NF!=3 && !/^#/ && NF>0 {print "Line", NR":", $0}'
/opt/sdwan-traffic-gen/config/applications.txt

Common mistakes:
- Missing pipe: google.com 50 /
- Extra pipes: google.com|50|/|extra
- Spaces: google.com | 50 | /
- Empty lines between entries (OK)
- Comments without # at start
Fix manually or restore default
sudo cp config/applications.txt /opt/sdwan-traffic-gen/config/
sudo systemctl restart sdwan-traffic-gen

text

### Wrong Interface Name

**Symptom:**
[ERROR] Cannot bind to interface 'eth0': No such device

text

**Solutions:**
Find correct interface
ip link show | grep -E '^[0-9]+:'

Update config
ip link show | grep -E '^[0-9]+:' | awk -F': ' '{print $2}' | grep -v lo | head -1 |
sudo tee /opt/sdwan-traffic-gen/config/interfaces.txt

Restart
sudo systemctl restart sdwan-traffic-gen

text

---

## Performance Issues

### High CPU Usage

**Symptom:**
top

traffic-generator.sh using 80%+ CPU
text

**Solutions:**

1. **Increase sleep time**:
sudo nano /opt/sdwan-traffic-gen/traffic-generator.sh

Change: SLEEP_BETWEEN_REQUESTS=1 to SLEEP_BETWEEN_REQUESTS=2
text

2. **Reduce application count**:
Comment out less important apps
sudo nano /opt/sdwan-traffic-gen/config/applications.txt

Add # at start of lines to disable
text

3. **Check for infinite loop**:
Watch process
top -p $(pgrep -f traffic-generator)

If constantly at 100%, script may have bug
Reinstall from latest version
text

### High Memory Usage

**Symptom:**
ps aux | grep traffic-generator

Shows high RSS/VSZ
text

**Solutions:**

Restart service (clears memory)
sudo systemctl restart sdwan-traffic-gen

If problem persists, check for memory leak
Monitor over time:
watch -n 60 'ps aux | grep traffic-generator | grep -v grep'

Report issue if memory keeps growing
text

### Disk Space Full

**Symptom:**
df -h

/var is 100% full
text

**Solutions:**

Check log sizes
du -sh /var/log/sdwan-traffic-gen/

Force log rotation
sudo logrotate -f /etc/logrotate.d/sdwan-traffic-gen

Delete old compressed logs
sudo find /var/log/sdwan-traffic-gen/ -name "*.gz" -mtime +7 -delete

Truncate current log (CAUTION - loses data)
sudo systemctl stop sdwan-traffic-gen
sudo truncate -s 0 /var/log/sdwan-traffic-gen/traffic.log
sudo systemctl start sdwan-traffic-gen

text

---

## Log Issues

### Logs Not Updating

**Symptom:**
tail -f /var/log/sdwan-traffic-gen/traffic.log

No new entries
text

**Diagnosis:**
Check service status
sudo systemctl status sdwan-traffic-gen

Check if log file is writable
ls -la /var/log/sdwan-traffic-gen/traffic.log

Check disk space
df -h /var

text

**Solutions:**

Restart service
sudo systemctl restart sdwan-traffic-gen

Fix permissions
sudo chown root:root /var/log/sdwan-traffic-gen/traffic.log
sudo chmod 644 /var/log/sdwan-traffic-gen/traffic.log

Recreate log directory
sudo systemctl stop sdwan-traffic-gen
sudo rm -rf /var/log/sdwan-traffic-gen
sudo mkdir -p /var/log/sdwan-traffic-gen
sudo systemctl start sdwan-traffic-gen

text

### Stats JSON Not Created

**Symptom:**
cat /var/log/sdwan-traffic-gen/stats.json

No such file
text

**Explanation:**
Stats are only created after **50 requests**.

**Solutions:**

Check request count
grep -c "requesting" /var/log/sdwan-traffic-gen/traffic.log

If < 50, just wait
If > 50 and still no stats:
Check writeStats function
sudo nano /opt/sdwan-traffic-gen/traffic-generator.sh

Look for: if (( (TOTAL_REQUESTS % 50) == 0 ))
Force stats creation by lowering threshold temporarily
Change 50 to 10, restart, then change back
text

### Log Rotation Not Working

**Symptom:**
ls -lh /var/log/sdwan-traffic-gen/

Only traffic.log, no .1 .2 .gz files
And traffic.log is huge (> 100MB)
text

**Solutions:**

Test logrotate manually
sudo logrotate -d /etc/logrotate.d/sdwan-traffic-gen

Force rotation
sudo logrotate -f /etc/logrotate.d/sdwan-traffic-gen

Check logrotate is scheduled
ls -la /etc/cron.daily/logrotate

If missing:
sudo ln -s /usr/sbin/logrotate /etc/cron.daily/logrotate

text

---

## SD-WAN Specific Issues

### Applications Not Identified

**Symptom:**
SD-WAN shows traffic as "unknown" or "ssl" instead of application names.

**Solutions:**

1. **Use application-specific endpoints**:
Instead of:
teams.microsoft.com|100|/

Use:
teams.microsoft.com|100|/api/mt/emea/beta/users/

text

2. **Enable SSL decryption** on your SD-WAN device (consult vendor docs)

3. **Check SNI** is visible:
Capture traffic to verify SNI
sudo tcpdump -i eth0 -n port 443 | grep -i "teams.microsoft"

text

### Path Selection Not Working

**Symptom:**
All traffic goes through one path instead of being distributed.

**Solutions:**

1. **Use multiple interfaces**:
Edit interfaces.txt
cat << EOF | sudo tee /opt/sdwan-traffic-gen/config/interfaces.txt
eth0
eth1
EOF

sudo systemctl restart sdwan-traffic-gen

text

2. **Check SD-WAN policy**: Ensure policy allows traffic distribution

3. **Verify interface has IP**:
ip addr show

Each interface should have an IP
text

---

## Getting Help

If you've tried everything above and still have issues:

### Collect Diagnostic Information

Create diagnostic report
cat << 'EOF' > ~/sdwan-diag.sh
#!/bin/bash
echo "=== System Info ==="
uname -a
echo ""
echo "=== Service Status ==="
systemctl status sdwan-traffic-gen
echo ""
echo "=== Recent Logs ==="
journalctl -u sdwan-traffic-gen -n 50 --no-pager
echo ""
echo "=== Config Files ==="
ls -la /opt/sdwan-traffic-gen/config/
echo ""
echo "=== Network Interfaces ==="
ip link show
echo ""
echo "=== Disk Space ==="
df -h /var
echo ""
echo "=== Log Size ==="
du -sh /var/log/sdwan-traffic-gen/
EOF

chmod +x ~/sdwan-diag.sh
~/sdwan-diag.sh > ~/sdwan-diag.txt 2>&1

Share sdwan-diag.txt when asking for help
text

### Where to Get Help

- **GitHub Issues**: https://github.com/jsuzanne/stigix/issues
- **Discussions**: https://github.com/jsuzanne/stigix/discussions

When opening an issue, include:
1. Your diagnostic report (sdwan-diag.txt)
2. What you expected to happen
3. What actually happened
4. Steps you've already tried

---

**Related Documentation:**
- [Installation Guide](../README.md#installation)
- [Configuration Guide](CONFIGURATION.md)
- [Usage Guide](USAGE.md)
