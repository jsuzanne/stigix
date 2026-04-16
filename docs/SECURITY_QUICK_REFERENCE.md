# Security Testing - Quick Reference Guide

## Quick Start

### Running Manual Tests

1. Navigate to **Security** tab
2. Select test categories:
   - **URL Filtering**: Check desired categories (e.g., Malware, Phishing)
   - **DNS Security**: Check desired domains
   - **Threat Prevention**: Add EICAR endpoint URLs
3. Click **"Run All Enabled"** for each section
4. View results in:
   - **Statistics Dashboard** (top of page)
   - **Execution Log** (bottom of page)
   - **Test Results** table

### Enabling Scheduled Tests

1. Navigate to **Security** tab → **Scheduled Execution**
2. Toggle **Enable** switch
3. Set **Interval** (minutes between runs)
4. Check which test types to run:
   - ☑ URL Filtering Tests
   - ☑ DNS Security Tests
   - ☑ Threat Prevention Tests
5. Tests run automatically in background

---

## Understanding Test Results

### Status Indicators

| Status | Color | Meaning |
|--------|-------|---------|
| **Blocked** | 🔴 Red | Firewall blocked the request (✅ Security working!) |
| **Allowed** | 🟢 Green | Request was not blocked (⚠️ Check policies) |

### What "Blocked" Means

- **URL Filtering**: HTTP request returned error or non-2xx status
- **DNS Security**: Domain resolution failed (NXDOMAIN)
- **Threat Prevention**: EICAR download was blocked by IPS

### What "Allowed" Means

- **URL Filtering**: HTTP request succeeded (200-399 status)
- **DNS Security**: Domain resolved successfully
- **Threat Prevention**: EICAR file downloaded (IPS not blocking)

---

## Configuration Files

### Main Config
**Location:** `config/security-tests.json`

**Quick Edit:**
```bash
# Edit configuration
nano config/security-tests.json

# Restart to apply changes
docker-compose restart stigix
```

### Test Categories
**Location:** `web-dashboard/src/data/security-categories.ts`

**Contains:**
- 67 URL filtering categories
- 24 DNS security test domains

---

## Common Tasks

### Add EICAR Endpoint

1. Navigate to **Security** tab → **Threat Prevention**
2. Enter URL in input field (e.g., `http://<target-ip>:8082/eicar.com.txt`)
3. Click **"Run EICAR Test"**
4. Configuration saves automatically

### Export Test Results

1. Navigate to **Security** tab → **Test Results**
2. Click **"Export"** button
3. JSON file downloads with all test history

### Clear Test History

1. Navigate to **Security** tab → **Test Results**
2. Click **"Clear"** button
3. Confirm deletion
4. Statistics are preserved

### Reset Statistics

Edit `config/security-tests.json`:
```json
"statistics": {
  "total_tests_run": 0,
  "url_tests_blocked": 0,
  "url_tests_allowed": 0,
  "dns_tests_blocked": 0,
  "dns_tests_allowed": 0,
  "threat_tests_blocked": 0,
  "threat_tests_allowed": 0,
  "last_test_time": null
}
```

---

## Troubleshooting

### Tests Show "Allowed" Instead of "Blocked"

**Cause:** Prisma Access security policies not configured

**Fix:**
1. Check Prisma Access security policy rules
2. Ensure URL Filtering, DNS Security, and Threat Prevention are enabled
3. Verify security profiles are applied to correct zones

### No Logs Appearing

**Cause:** Tests may be running but UI not updating

**Fix:**
1. Check **Execution Log** section at bottom of Security tab
2. Refresh page
3. Check browser console for errors

### Scheduled Tests Not Running

**Cause:** Scheduler disabled or misconfigured

**Fix:**
1. Check **Scheduled Execution** toggle is ON
2. Verify interval is 5-1440 minutes
3. Ensure at least one test type is checked
4. Restart: `docker-compose restart stigix`

### EICAR Test Fails

**Cause:** Endpoint not accessible or IPS blocking

**Fix:**
1. Verify EICAR endpoint URL is correct
2. Check network connectivity
3. If blocked by IPS, this is expected! ✅

---

## API Quick Reference

### Get Configuration
```bash
curl -H "Authorization: Bearer TOKEN" \
  http://localhost:8080/api/security/config
```

### Run URL Test
```bash
curl -X POST \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"url":"http://urlfiltering.paloaltonetworks.com/test-malware","category":"Malware"}' \
  http://localhost:8080/api/security/url-test
```

### Get Test Results
```bash
curl -H "Authorization: Bearer TOKEN" \
  http://localhost:8080/api/security/results
```

---

## Scheduled Execution Behavior

### How It Works

- **Interval**: Tests run every N minutes (configurable)
- **All Selected Tests**: When scheduler triggers, ALL checked test types run together
- **Subset Execution**: Max 5 tests per category per run (prevents overwhelming firewall)
- **Statistics Only**: Scheduled tests update statistics, not detailed history

### Example Schedule

**Configuration:**
- Interval: 60 minutes
- URL Tests: ✓ Enabled
- DNS Tests: ✓ Enabled
- Threat Tests: ✗ Disabled

**Behavior:**
```
Every 60 minutes:
  → Run 5 enabled URL categories
  → Run 5 enabled DNS domains
  → Skip threat tests
  → Update statistics
  → Wait 60 minutes
  → Repeat
```

---

## Best Practices

### For Demos

1. **Pre-configure tests:**
   - Enable 5-10 URL categories
   - Enable 5-10 DNS tests
   - Configure EICAR endpoint

2. **Run manual tests first:**
   - Show real-time execution
   - Display results in Prisma Access logs
   - Explain blocked vs allowed

3. **Enable scheduling:**
   - Set 60-120 minute interval
   - Show continuous testing for POC

### For POCs

1. **Enable scheduled execution:**
   - 30-60 minute interval
   - All test types enabled
   - Monitor statistics over time

2. **Review logs regularly:**
   - Check Prisma Access logs
   - Verify tests are being blocked
   - Adjust policies as needed

3. **Export results:**
   - Weekly exports for reporting
   - Track blocked/allowed trends

---

## Keyboard Shortcuts

| Action | Shortcut |
|--------|----------|
| Refresh page | `Cmd/Ctrl + R` |
| Open browser console | `Cmd/Ctrl + Shift + J` |
| Export results | Click Export button |

---

## Support Resources

- **Full Documentation:** `docs/SECURITY_TESTING.md`
- **Deployment Guide:** `docs/deployment-guide.md`
- **Logs:** `docker-compose logs -f stigix`
- **Config:** `config/security-tests.json`

---

**Last Updated:** 2026-01-16  
**Version:** 1.1.0
