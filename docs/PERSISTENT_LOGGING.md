# Persistent Logging and Test Results

Learn about the persistent logging system introduced in v1.1.0 for security test results and system monitoring.

## Overview

The SD-WAN Traffic Generator now features **persistent logging** for all security test results, providing:

- ✅ **JSONL file storage** - Structured, searchable logs
- ✅ **Automatic rotation** - Size and age-based cleanup
- ✅ **Search and filtering** - Find specific tests quickly
- ✅ **Pagination** - Handle thousands of results
- ✅ **Export capabilities** - Download results for reporting
- ✅ **System health monitoring** - Track memory and disk usage

---

## Log Storage

### File Location

All test results are stored in JSONL (JSON Lines) format:

```
logs/test-results.jsonl
```

### JSONL Format

Each line is a complete JSON object representing one test result:

```json
{"timestamp":1768778415000,"testId":"url-1768778415000-malware","testType":"url","testName":"Malware","result":{"success":false,"httpCode":0,"status":"blocked","url":"http://urlfiltering.paloaltonetworks.com/test-malware","category":"Malware"}}
{"timestamp":1768778420000,"testId":"dns-1768778420000-phishing","testType":"dns","testName":"Phishing","result":{"success":true,"status":"blocked","domain":"test-phishing.testpanw.com","resolved":false}}
```

**Benefits of JSONL:**
- One test per line
- Easy to parse and search
- Append-only (fast writes)
- Works with standard tools (`jq`, `grep`, etc.)

---

## Log Rotation

### Automatic Cleanup

Logs are automatically rotated based on:

1. **Age**: Default 7 days retention
2. **Size**: Default 100 MB maximum

### Configuration

Set via environment variables in `docker-compose.yml`:

```yaml
environment:
  - LOG_RETENTION_DAYS=7    # Keep logs for 7 days
  - LOG_MAX_SIZE_MB=100     # Max 100 MB per log file
```

### Rotation Behavior

**When logs exceed size limit:**
```
test-results.jsonl          → test-results.jsonl.1
test-results.jsonl.1        → test-results.jsonl.2
test-results.jsonl.2        → deleted
```

**When logs exceed age:**
```
Entries older than 7 days are automatically removed
```

### Manual Cleanup

```bash
# Delete all test results
rm logs/test-results.jsonl

# Delete old rotated logs
rm logs/test-results.jsonl.*

# Restart to create fresh log
docker compose restart sdwan-web-ui
```

---

## Search and Filtering

### Web UI Search

The **Security** tab includes a powerful search interface:

![Test Results with Search](screenshots/03-security/10.png)

**Features:**
- **Text search**: Search by test name, URL, domain, or status
- **Type filter**: Filter by URL, DNS, or Threat tests
- **Status filter**: Show only blocked, allowed, or pending tests
- **Date range**: Filter by time period
- **Pagination**: Navigate through thousands of results

### Command-Line Search

Use `jq` to search JSONL files:

```bash
# Find all blocked URL tests
cat logs/test-results.jsonl | jq 'select(.testType=="url" and .result.status=="blocked")'

# Find tests for specific category
cat logs/test-results.jsonl | jq 'select(.testName=="Malware")'

# Count tests by type
cat logs/test-results.jsonl | jq -s 'group_by(.testType) | map({type: .[0].testType, count: length})'

# Find tests in last hour
cat logs/test-results.jsonl | jq --arg time $(date -d '1 hour ago' +%s000) 'select(.timestamp > ($time | tonumber))'

# Get all blocked tests today
cat logs/test-results.jsonl | jq --arg date $(date +%Y-%m-%d) 'select(.timestamp > (($date + "T00:00:00Z" | fromdateiso8601) * 1000) and .result.status=="blocked")'
```

### Using grep

```bash
# Find all malware tests
grep -i "malware" logs/test-results.jsonl

# Find all blocked tests
grep '"status":"blocked"' logs/test-results.jsonl

# Count total tests
wc -l logs/test-results.jsonl
```

---

## API Endpoints

### Get Test Results

**Endpoint:** `GET /api/security/results`

**Query Parameters:**
- `search` - Text search across all fields
- `type` - Filter by test type (`url`, `dns`, `threat`)
- `status` - Filter by status (`blocked`, `allowed`, `pending`)
- `limit` - Results per page (default: 50, max: 500)
- `offset` - Pagination offset

**Example:**
```bash
# Get last 100 results
curl http://localhost:8080/api/security/results?limit=100

# Search for "malware"
curl http://localhost:8080/api/security/results?search=malware

# Get blocked URL tests
curl http://localhost:8080/api/security/results?type=url&status=blocked

# Pagination
curl http://localhost:8080/api/security/results?limit=50&offset=100
```

**Response:**
```json
{
  "results": [
    {
      "timestamp": 1768778415000,
      "testId": "url-1768778415000-malware",
      "testType": "url",
      "testName": "Malware",
      "result": {
        "success": false,
        "httpCode": 0,
        "status": "blocked",
        "url": "http://urlfiltering.paloaltonetworks.com/test-malware",
        "category": "Malware"
      }
    }
  ],
  "total": 1523,
  "limit": 50,
  "offset": 0
}
```

### Get Statistics

**Endpoint:** `GET /api/security/stats`

**Response:**
```json
{
  "total_tests": 1523,
  "url_tests": {
    "total": 856,
    "blocked": 798,
    "allowed": 58
  },
  "dns_tests": {
    "total": 542,
    "blocked": 512,
    "allowed": 30
  },
  "threat_tests": {
    "total": 125,
    "blocked": 125,
    "allowed": 0
  },
  "last_test_time": 1768778415000
}
```

### Clear Results

**Endpoint:** `DELETE /api/security/results`

**Response:**
```json
{
  "success": true,
  "message": "Test results cleared"
}
```

---

## Export Capabilities

### Export from Web UI

1. Go to **Security** tab
2. Scroll to **Test Results** section
3. Click **Export** button
4. Choose format:
   - **JSON** - Full structured data
   - **CSV** - Spreadsheet-compatible
   - **JSONL** - Raw log format

### Export via API

```bash
# Export all results as JSON
curl http://localhost:8080/api/security/results?limit=10000 > results.json

# Export filtered results
curl "http://localhost:8080/api/security/results?type=url&status=blocked&limit=10000" > blocked-urls.json
```

### Convert JSONL to CSV

```bash
# Using jq
cat logs/test-results.jsonl | jq -r '[.timestamp, .testType, .testName, .result.status] | @csv' > results.csv

# With headers
echo "Timestamp,Type,Name,Status" > results.csv
cat logs/test-results.jsonl | jq -r '[.timestamp, .testType, .testName, .result.status] | @csv' >> results.csv
```

---

## System Health Monitoring

### Health Endpoint

**Endpoint:** `GET /api/health`

**Response:**
```json
{
  "status": "healthy",
  "uptime": 86400,
  "memory": {
    "used": 256000000,
    "total": 2048000000,
    "percentage": 12.5
  },
  "disk": {
    "used": 5368709120,
    "total": 107374182400,
    "percentage": 5.0
  },
  "logs": {
    "size": 52428800,
    "entries": 15234,
    "oldestEntry": 1768692015000,
    "newestEntry": 1768778415000
  }
}
```

### Monitor in Web UI

The **Dashboard** tab shows system health:

- **Memory Usage** - Current RAM consumption
- **Disk Usage** - Storage space used
- **Log Size** - Current log file size
- **Uptime** - Time since last restart

### Alerts

The system automatically warns when:

- Memory usage > 80%
- Disk usage > 90%
- Log size > 90% of max
- Disk space < 1 GB

---

## Performance Considerations

### Log File Size

**Typical sizes:**
- 1,000 tests ≈ 500 KB
- 10,000 tests ≈ 5 MB
- 100,000 tests ≈ 50 MB

**Recommendation:** Keep `LOG_MAX_SIZE_MB` at 100 MB for optimal performance.

### Search Performance

**Fast searches:**
- Text search on indexed fields (testName, testType)
- Status filtering
- Type filtering

**Slower searches:**
- Full-text search across all fields
- Complex regex patterns
- Very large result sets (>10,000)

**Optimization:**
- Use pagination (`limit` and `offset`)
- Filter by type and status before searching
- Export and analyze offline for very large datasets

### Disk Space

**Estimate storage needs:**

```
Tests per day: 1,000
Average size: 500 bytes
Retention: 7 days

Total: 1,000 × 500 × 7 = 3.5 MB
```

**Recommendation:** Allocate at least 500 MB for logs directory.

---

## Backup and Restore

### Backup Logs

```bash
# Backup all logs
tar -czf logs-backup-$(date +%Y%m%d).tar.gz logs/

# Backup to remote server
rsync -avz logs/ user@backup-server:/backups/sdwan-logs/
```

### Restore Logs

```bash
# Extract backup
tar -xzf logs-backup-20260119.tar.gz

# Restart services
docker compose restart sdwan-web-ui
```

### Scheduled Backups

Add to crontab:

```bash
# Daily backup at 2 AM
0 2 * * * tar -czf /backups/sdwan-logs-$(date +\%Y\%m\%d).tar.gz /path/to/sdwan-traffic-gen/logs/
```

---

## Troubleshooting

### Logs Not Persisting

1. Check volume mount in `docker-compose.yml`:
   ```yaml
   volumes:
     - ./logs:/var/log/sdwan-traffic-gen
   ```

2. Verify directory permissions:
   ```bash
   ls -la logs/
   chmod 755 logs/
   ```

3. Check container logs:
   ```bash
   docker compose logs sdwan-web-ui
   ```

### Search Not Working

1. Verify JSONL format is valid:
   ```bash
   cat logs/test-results.jsonl | jq . > /dev/null
   ```

2. Check for corrupted entries:
   ```bash
   grep -v '^{' logs/test-results.jsonl
   ```

3. Rebuild search index:
   ```bash
   docker compose restart sdwan-web-ui
   ```

### Disk Space Issues

1. Check current usage:
   ```bash
   du -sh logs/
   ```

2. Reduce retention period:
   ```yaml
   environment:
     - LOG_RETENTION_DAYS=3  # Reduce from 7 to 3 days
   ```

3. Manually clean old logs:
   ```bash
   find logs/ -name "*.jsonl.*" -mtime +7 -delete
   ```

---

## Best Practices

### 1. Regular Monitoring

Check system health daily:
```bash
curl http://localhost:8080/api/health | jq .
```

### 2. Periodic Exports

Export results weekly for long-term storage:
```bash
curl http://localhost:8080/api/security/results?limit=10000 > weekly-export-$(date +%Y%m%d).json
```

### 3. Disk Space Management

Monitor disk usage:
```bash
df -h | grep /var/log
```

### 4. Backup Strategy

- Daily automated backups
- Keep 30 days of backups
- Test restore procedures monthly

### 5. Log Rotation

Adjust retention based on usage:
- High-frequency testing: 3-5 days
- Normal usage: 7 days
- Low-frequency: 14-30 days

---

## Related Documentation

- **[Security Testing](SECURITY_TESTING.md)** - Comprehensive security testing guide
- **[Quick Start](QUICK_START.md)** - Installation and setup
- **[Configuration](CONFIGURATION.md)** - Advanced configuration
- **[Troubleshooting](TROUBLESHOOTING.md)** - Common issues

---

**Last Updated:** 2026-01-19  
**Version:** 1.1.0  
**Feature:** Persistent Logging
