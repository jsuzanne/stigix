# Security Testing - Frequently Asked Questions

## How Does the System Determine "Blocked" vs "Allowed"?

### URL Filtering Tests

**Test Method:** Uses `curl` to fetch Palo Alto Networks test URLs

```bash
curl -fsS --max-time 10 -o /dev/null -w '%{http_code}' 'URL'
```

**Detection Logic:**

| HTTP Status Code | Result | Meaning |
|-----------------|--------|---------|
| 200-399 | ✅ **Allowed** | Request succeeded, page loaded |
| 400-599 | 🔴 **Blocked** | HTTP error returned |
| Timeout/Error | 🔴 **Blocked** | Connection failed or refused |

**Examples:**
- **Allowed**: `HTTP 200` - URL filtering policy allows the category
- **Blocked**: `HTTP 403` - URL filtering policy blocks the category
- **Blocked**: `Connection timeout` - Firewall dropped the connection

**Without Prisma Access:** Most tests show "Allowed" because there's no firewall blocking
**With Prisma Access:** Tests show "Blocked" when security policies are configured

---

### DNS Security Tests

**Test Method:** Uses `nslookup` to resolve Palo Alto Networks test domains

```bash
nslookup test-malware.testpanw.com
```

**Detection Logic:**

| DNS Response | Result | Meaning |
|--------------|--------|---------|
| Resolves to IP | ✅ **Allowed** | DNS query succeeded |
| NXDOMAIN | 🔴 **Blocked** | DNS Security blocked the domain |
| "server can't find" | 🔴 **Blocked** | DNS Security blocked the domain |

**Examples:**

**Allowed (No Prisma DNS Security):**
```
test-malware.testpanw.com → google.com (216.58.214.174)
Result: Allowed
```

**Blocked (With Prisma DNS Security):**
```
** server can't find test-malware.testpanw.com: NXDOMAIN
Result: Blocked
```

**Without Prisma Access:** Domains resolve normally → "Allowed"
**With Prisma Access:** Malicious domains return NXDOMAIN → "Blocked"

---

### Threat Prevention (EICAR)

**Test Method:** Uses `curl` to download EICAR test file

```bash
curl -fsS --max-time 20 ENDPOINT -o /tmp/eicar.com.txt
```

**Detection Logic:**

| Download Result | Result | Meaning |
|----------------|--------|---------|
| File downloaded | ✅ **Allowed** | IPS/Threat Prevention not blocking |
| Download failed | 🔴 **Blocked** | IPS detected and blocked EICAR |

**Examples:**
- **Allowed**: File downloads successfully (IPS not configured or disabled)
- **Blocked**: `curl: (56) Recv failure` (IPS blocked the download)

**Security Note:** The file is automatically deleted after the test regardless of result

**Without Prisma Access:** Download may succeed or fail based on endpoint availability
**With Prisma Access:** IPS blocks EICAR downloads → "Blocked"

---

## How Does Scheduled Execution Work?

### Quick Answer
**No, you don't need to click "Run All Enabled" after configuring the schedule!** Tests run automatically in the background.

### Setup Steps

1. **Navigate to Security Tab** → Scheduled Execution section
2. **Toggle "Enable"** to activate scheduling
3. **Configure Interval**: Set minutes between runs (5-1440)
4. **Select Test Types**: Check which tests to run automatically
   - ☑ URL Filtering Tests
   - ☑ DNS Security Tests
   - ☑ Threat Prevention Tests
5. **Save**: Configuration saves automatically

### Behavior

**First Run:**
- Starts after the configured interval from when you enable it
- Example: If interval is 60 minutes, first run is in 60 minutes

**Subsequent Runs:**
- Executes automatically every N minutes
- Runs in the background (no manual trigger needed)
- Updates statistics automatically

**Test Limits (Scheduled):**
- URL Filtering: Max 5 categories per run
- DNS Security: Max 5 domains per run
- Threat Prevention: Max 3 endpoints per run

**Why limits?** Prevents overwhelming the firewall with too many simultaneous requests

### Manual vs Scheduled Execution

| Feature | Manual ("Run All Enabled") | Scheduled Execution |
|---------|---------------------------|---------------------|
| **Trigger** | You click the button | Automatic (background) |
| **Test Count** | ALL enabled tests | Subset (max 5 per type) |
| **Frequency** | On-demand | Every N minutes |
| **Use Case** | Demos, immediate testing | POCs, continuous monitoring |
| **Statistics** | Updates immediately | Updates after each run |
| **Results Table** | Shows all results | Shows all results |

### Monitoring Scheduled Tests

**Check Status:**
- Look for "Next scheduled run: [time]" in the Scheduled Execution section
- Statistics Dashboard updates after each run
- Test Results table shows all executions (manual + scheduled)

**Verify It's Working:**
1. Enable scheduling with 5-minute interval
2. Wait 5 minutes
3. Check Statistics Dashboard for updated counts
4. Check Test Results table for new entries

### Stopping Scheduled Tests

Simply toggle "Enable" to OFF in the Scheduled Execution section. The scheduler stops immediately.

---

## Understanding Your Test Results

### Example: Testing Without Prisma Access

**What you'll see:**
- Most URL tests: ✅ Allowed (pages load normally)
- Most DNS tests: ✅ Allowed (domains resolve)
- EICAR test: May vary based on network/endpoint

**This is normal!** Without Prisma Access security policies, there's nothing to block the requests.

### Example: Testing With Prisma Access

**What you'll see:**
- Malicious URLs: 🔴 Blocked (URL Filtering policy)
- Safe URLs: ✅ Allowed (not in block categories)
- Malicious domains: 🔴 Blocked (DNS Security)
- EICAR download: 🔴 Blocked (IPS/Threat Prevention)

**This proves your security policies are working!**

---

## Common Questions

### Q: Why are all my tests showing "Allowed"?
**A:** You're likely testing from a network without Prisma Access. Tests will show "Allowed" because there's no firewall blocking them. Deploy to your LAB environment with Prisma Access to see "Blocked" results.

### Q: Do I need to click "Run All Enabled" if scheduling is enabled?
**A:** No! Scheduled tests run automatically in the background. "Run All Enabled" is for manual, on-demand testing.

### Q: How often should I schedule tests?
**A:** 
- **Demos**: Disable scheduling, use manual "Run All Enabled"
- **POCs**: 30-60 minute intervals
- **Continuous monitoring**: 60-120 minute intervals

### Q: Can I run manual tests while scheduling is enabled?
**A:** Yes! Manual and scheduled tests are independent. You can run manual tests anytime.

### Q: Where can I see scheduled test results?
**A:** 
- **Statistics Dashboard**: Shows aggregated counts
- **Test Results Table**: Shows individual test entries (both manual and scheduled)

### Q: How do I know if my firewall policies are working?
**A:** Look for "Blocked" results in the Test Results table. If everything shows "Allowed", your security policies may not be configured or you're not behind Prisma Access.

---

## Troubleshooting

### Tests Always Show "Allowed"
**Cause:** No Prisma Access or security policies not configured  
**Fix:** 
1. Verify you're testing from a device behind Prisma Access
2. Check URL Filtering, DNS Security, and Threat Prevention policies are enabled
3. Ensure security profiles are applied to the correct zones

### Scheduled Tests Not Running
**Cause:** Scheduler disabled or misconfigured  
**Fix:**
1. Check "Enable" toggle is ON
2. Verify interval is 5-1440 minutes
3. Ensure at least one test type is checked
4. Check backend logs: `docker-compose logs -f stigix`

### Statistics Not Updating
**Cause:** Backend errors or tests failing to execute  
**Fix:**
1. Check browser console for API errors (F12)
2. Check backend logs for errors
3. Verify network connectivity to test URLs/domains

---

**Last Updated:** 2026-01-16  
**Version:** 1.1.0
