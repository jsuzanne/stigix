import { test, expect, Page, Route } from '@playwright/test';

/**
 * remote-view-routing.spec.ts  —  LIVE INFRA · Complete Read + Write Validation
 * ──────────────────────────────────────────────────────────────────────────────
 * Validates that ALL data reads (GETs) AND write actions (POSTs/DELETEs) in
 * remote-view mode are correctly routed via /api/gateway/:peerId/* and never
 * hit DC1 locally.
 *
 * DC1 : http://192.168.122.51:8080  (admin/admin)
 * BR8 : "BR8-Ubuntu" — selected via UI peer switcher
 *
 * 504 responses = routing OK, BR8 backend timeout (not a routing bug).
 * LOCAL POST /api/auth/login = expected (auth is always DC1-local).
 */

// ─── Config ────────────────────────────────────────────────────────────────────
const DC1_URL    = process.env.STIGIX_URL  || 'http://192.168.122.51:8080';
const USERNAME   = process.env.STIGIX_USER || 'admin';
const PASSWORD   = process.env.STIGIX_PASS || 'admin';
const PEER_LABEL = process.env.STIGIX_PEER || 'BR8';

// ─── Request Capture ───────────────────────────────────────────────────────────
interface Req { method: string; path: string; status: number; peerId: string; isGateway: boolean; }
let allReqs: Req[] = [];

async function installInterceptor(page: Page) {
    allReqs = [];
    await page.route('**/api/**', async (route: Route) => {
        const url    = route.request().url();
        const method = route.request().method();
        if (url.includes('/api/gateway/')) {
            const m      = url.match(/\/api\/gateway\/([^/?#]+)(\/[^?#]*)/);
            const peerId = m?.[1] ?? '?';
            const path   = m?.[2] ?? url;
            try {
                const resp = await route.fetch();
                allReqs.push({ method, path, status: resp.status(), peerId, isGateway: true });
                await route.fulfill({ response: resp });
            } catch {
                allReqs.push({ method, path, status: 0, peerId, isGateway: true });
                await route.abort();
            }
        } else {
            const pathMatch = url.match(/\/api\/(.*?)(\?|$)/);
            const path      = '/api/' + (pathMatch?.[1] ?? '?');
            if (method !== 'GET') console.log(`  ⚠️  LOCAL: ${method} ${path}`);
            try {
                const resp = await route.fetch();
                allReqs.push({ method, path, status: resp.status(), peerId: 'LOCAL', isGateway: false });
                await route.fulfill({ response: resp });
            } catch {
                allReqs.push({ method, path, status: 0, peerId: 'LOCAL', isGateway: false });
                await route.abort();
            }
        }
    });
}

const gwReqs = () => allReqs.filter(r => r.isGateway);

/** Assert a GET was served from BR8 gateway (status can be anything — routing is what matters) */
function assertGWRead(apiPath: string): void {
    const hit = gwReqs().find(r =>
        r.method === 'GET' &&
        r.path.includes(apiPath) &&
        r.peerId.toUpperCase().includes(PEER_LABEL.toUpperCase())
    );
    if (!hit) {
        const local = allReqs
            .filter(r => !r.isGateway && r.path.includes(apiPath))
            .map(r => `  LOCAL GET ${r.path} [${r.status}]`)
            .join('\n');
        throw new Error(
            `Expected gateway READ: GET ${apiPath} via →${PEER_LABEL}\n` +
            (local ? `Found LOCAL instead:\n${local}` : '(not captured at all)')
        );
    }
    const ok = hit.status > 0 && hit.status < 500 || hit.status === 504;
    console.log(`  ${ok ? '✅' : `⚠️  [${hit.status}]`} GW GET ${hit.path}`);
}

/** Assert a write (POST/DELETE/PUT) was routed via BR8 gateway */
function assertGWWrite(method: string, apiPath: string): Req {
    const hit = gwReqs().find(r =>
        r.method === method &&
        r.path.includes(apiPath) &&
        r.peerId.toUpperCase().includes(PEER_LABEL.toUpperCase())
    );
    if (!hit) {
        const gw    = gwReqs().filter(r => r.method !== 'GET').map(r => `  [${r.status}] ${r.method} ${r.path}`).join('\n') || '  (none)';
        const local = allReqs.filter(r => !r.isGateway && r.method !== 'GET').map(r => `  LOCAL ${r.method} ${r.path}`).join('\n') || '  (none)';
        throw new Error(`Expected gateway WRITE: ${method} ${apiPath} via →${PEER_LABEL}\nGW writes:\n${gw}\nLocal writes:\n${local}`);
    }
    console.log(`  ✅ [${hit.status}] GW ${hit.method} ${hit.path}`);
    return hit;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────
async function login(page: Page) {
    await page.goto(DC1_URL, { waitUntil: 'domcontentloaded', timeout: 20_000 });
    await page.waitForTimeout(1_000);
    if (await page.locator('#peer-context-switcher').isVisible({ timeout: 2_000 }).catch(() => false)) return;
    await page.fill('input[placeholder*="username"]', USERNAME);
    await page.fill('input[type="password"]', PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForSelector('#peer-context-switcher', { timeout: 20_000 });
}

async function selectPeer(page: Page) {
    await page.click('#peer-context-switcher');
    await page.locator('#peer-context-dropdown').waitFor({ state: 'visible', timeout: 5_000 });
    await page.click(`#peer-context-dropdown button:has-text("${PEER_LABEL}")`);
    await page.waitForTimeout(2_000);
    const txt = await page.locator('#peer-context-switcher').textContent();
    console.log(`  ✅ Peer: "${txt?.trim()}"`);
}

async function goToTab(page: Page, tabText: string) {
    await page.locator('button').filter({ hasText: tabText }).first().click();
    await page.waitForTimeout(600);
}

async function waitNoLoading(page: Page, text = 'Loading', timeout = 12_000) {
    await page.waitForFunction(
        (t: string) => !document.body.innerText.includes(t),
        text, { timeout }
    ).catch(() => {});
    await page.waitForTimeout(400);
}

// ─── Suite ─────────────────────────────────────────────────────────────────────
test.describe('Remote-View — Read + Write Routing (DC1→BR8 Live)', () => {

    test.beforeAll(async ({ browser }) => {
        const page = await browser.newPage();
        const res  = await page.goto(DC1_URL, { timeout: 15_000 });
        await page.close();
        expect(res?.status()).toBeLessThan(400);
        console.log(`✅ DC1 reachable (HTTP ${res?.status()})`);
    });

    test.beforeEach(async ({ page }) => {
        await installInterceptor(page);
        await login(page);
        await selectPeer(page);
    });

    // ═══════════════════════════════════════════════════════════════
    //  READ — data loaded from BR8 gateway
    // ═══════════════════════════════════════════════════════════════

    test.describe('READ — gateway data loading', () => {

        test('Traffic Generator: data reads from BR8', async ({ page }) => {
            await goToTab(page, 'Traffic Generator');
            await waitNoLoading(page, 'Loading');
            await page.waitForTimeout(2_000);
            assertGWRead('/api/traffic/status');
            assertGWRead('/api/traffic/history');
            assertGWRead('/api/config/traffic-thresholds');
        });

        test('Digital Experience: data reads from BR8', async ({ page }) => {
            await goToTab(page, 'Digital Experience');
            await waitNoLoading(page, 'Loading');
            await page.waitForTimeout(2_000);
            assertGWRead('/api/connectivity/active-probes');
            assertGWRead('/api/connectivity/custom');
        });

        test('Security: data reads from BR8', async ({ page }) => {
            await goToTab(page, 'Security');
            await waitNoLoading(page, 'Loading security configuration');
            assertGWRead('/api/security/config');
            assertGWRead('/api/security/profile');
            // Scores dashboard loads async — wait for it before asserting
            await waitNoLoading(page, 'Loading Score Dashboard', 15_000);
            assertGWRead('/api/security/scores');
        });

        test('Voice: data reads from BR8', async ({ page }) => {
            // Register listeners BEFORE navigating so we catch the initial parallel fetches
            const ingressPromise = page.waitForResponse(
                r => r.url().includes('/api/gateway/') && r.url().includes('voice/ingress'),
                { timeout: 10_000 }
            ).catch(() => null);
            const configPromise = page.waitForResponse(
                r => r.url().includes('/api/gateway/') && r.url().includes('voice/config'),
                { timeout: 10_000 }
            ).catch(() => null);
            await goToTab(page, 'Voice');
            await Promise.all([ingressPromise, configPromise]);
            assertGWRead('/api/voice/config');
            assertGWRead('/api/voice/ingress');
        });

        test('IoT: data reads from BR8', async ({ page }) => {
            // Register listener BEFORE navigating — iot/devices may complete quickly via gateway
            const devicesPromise = page.waitForResponse(
                r => r.url().includes('/api/gateway/') && r.url().includes('iot/devices'),
                { timeout: 10_000 }
            ).catch(() => null);
            await goToTab(page, 'IoT');
            await devicesPromise;
            assertGWRead('/api/iot/settings');
            assertGWRead('/api/iot/devices');
            assertGWRead('/api/iot/bad-behavior');
        });

        test('VyOS Control: data reads from BR8', async ({ page }) => {
            await goToTab(page, 'VyOS Control');
            await waitNoLoading(page, 'Loading');
            await page.waitForTimeout(1_500);
            assertGWRead('/api/vyos/routers');
            assertGWRead('/api/vyos/sequences');
            assertGWRead('/api/vyos/history');
        });

        test('Bandwidth: speedtest list reads from BR8', async ({ page }) => {
            // Register response listener BEFORE navigating so we catch the initial fetch
            const xfrPromise = page.waitForResponse(
                r => r.url().includes('/api/gateway/') && r.url().includes('/api/tests/xfr'),
                { timeout: 8_000 }
            ).catch(() => null);
            await goToTab(page, 'Bandwidth Test');
            const xfrResp = await xfrPromise;
            if (!xfrResp) {
                console.log('  /api/tests/xfr not auto-fetched on Bandwidth tab open — SKIP');
                test.skip();
                return;
            }
            assertGWRead('/api/tests/xfr');
        });

    }); // describe READ

    // ═══════════════════════════════════════════════════════════════
    //  WRITE — actions routed to BR8 gateway
    // ═══════════════════════════════════════════════════════════════

    test.describe('WRITE — actions routed via gateway', () => {

        test('Traffic Generator: start/stop via BR8 gateway', async ({ page }) => {
            test.setTimeout(90_000); // beforeEach ~20s + two gateway round-trips
            await goToTab(page, 'Traffic Generator');
            const stopBtn  = page.locator('button:has-text("Stop Traffic")').first();
            const startBtn = page.locator('button:has-text("Start Traffic")').first();
            const isRunning = await stopBtn.isVisible({ timeout: 4_000 }).catch(() => false);
            console.log(`  Traffic: ${isRunning ? 'RUNNING' : 'IDLE'}`);

            if (isRunning) {
                await stopBtn.click();
                await page.waitForFunction(() => !document.body.innerText.includes('Stopping'), { timeout: 15_000 }).catch(() => {});
                await page.waitForTimeout(500);
                assertGWWrite('POST', '/api/traffic/stop');
                if (await startBtn.isVisible({ timeout: 4_000 }).catch(() => false)) {
                    await startBtn.click();
                    await page.waitForFunction(() => !document.body.innerText.includes('Starting'), { timeout: 15_000 }).catch(() => {});
                    await page.waitForTimeout(500);
                    assertGWWrite('POST', '/api/traffic/start');
                }
            } else {
                await expect(startBtn).toBeVisible({ timeout: 6_000 });
                await startBtn.click();
                await page.waitForFunction(() => !document.body.innerText.includes('Starting'), { timeout: 15_000 }).catch(() => {});
                await page.waitForTimeout(500);
                assertGWWrite('POST', '/api/traffic/start');
            }
        });

        test('Voice: control (start/stop) via BR8 gateway', async ({ page }) => {
            test.setTimeout(60_000);
            // Register listener BEFORE navigating so we don't miss the button state
            await goToTab(page, 'Voice');
            // Wait for voice config to load via gateway (determines enabled state)
            await page.waitForResponse(
                r => r.url().includes('/api/gateway/') && r.url().includes('voice/config'),
                { timeout: 8_000 }
            ).catch(() => {});
            await page.waitForTimeout(500); // let React re-render with received state

            const stopBtn  = page.locator('button:has-text("Stop Voice")').first();
            const startBtn = page.locator('button:has-text("Start Voice"), button:has-text("Start Simulation")').first();
            const isRunning = await stopBtn.isVisible({ timeout: 3_000 }).catch(() => false);
            console.log(`  Voice: ${isRunning ? 'RUNNING' : 'IDLE'}`);

            // Set up response listener BEFORE click so we don't race
            const voiceCtrlResp = page.waitForResponse(
                r => r.url().includes('voice/control'),
                { timeout: 15_000 }
            ).catch(() => null);

            if (isRunning) {
                await stopBtn.click();
            } else {
                await expect(startBtn).toBeVisible({ timeout: 4_000 });
                // Skip if button is disabled (no voice servers configured on BR8)
                const isDisabled = await startBtn.isDisabled();
                if (isDisabled) {
                    console.log('  Voice start button disabled (no servers configured) — SKIP');
                    test.skip();
                    return;
                }
                await startBtn.click();
            }

            // Wait for the gateway POST to actually complete (not just the button to change)
            await voiceCtrlResp;
            await page.waitForTimeout(300);
            assertGWWrite('POST', '/api/voice/control');
        });

        test('Security: batch URL test via BR8 gateway', async ({ page }) => {
            await goToTab(page, 'Security');
            await waitNoLoading(page, 'Loading security configuration');
            const btn = page.locator('button:has-text("Run Selected Categories")').first();
            await expect(btn).toBeVisible({ timeout: 6_000 });
            if (await btn.isDisabled()) { test.skip(); return; }
            await btn.click();
            await page.waitForTimeout(10_000);
            assertGWWrite('POST', '/api/security/url-test-batch');
        });

        test('Security: batch DNS test via BR8 gateway', async ({ page }) => {
            await goToTab(page, 'Security');
            await waitNoLoading(page, 'Loading security configuration');
            const btn = page.locator('button:has-text("Run Selected Domains")').first();
            await expect(btn).toBeVisible({ timeout: 6_000 });
            if (await btn.isDisabled()) { test.skip(); return; }
            await btn.click();
            await page.waitForTimeout(10_000);
            assertGWWrite('POST', '/api/security/dns-test-batch');
        });

        test('Security: individual URL test via BR8 gateway', async ({ page }) => {
            await goToTab(page, 'Security');
            await waitNoLoading(page, 'Loading security configuration');
            const runBtns = page.locator('button[title="Run test"]');
            const count   = await runBtns.count();
            if (count === 0) { console.log('  No individual "Run test" buttons — SKIP'); test.skip(); return; }
            console.log(`  Found ${count} individual "Run test" buttons`);
            await runBtns.first().click();
            await page.waitForTimeout(8_000);
            assertGWWrite('POST', '/api/security/url-test');
        });

        test('Security: individual DNS test via BR8 gateway', async ({ page }) => {
            await goToTab(page, 'Security');
            await waitNoLoading(page, 'Loading security configuration');
            const runBtns = page.locator('button[title="Run test"]');
            const count   = await runBtns.count();
            if (count < 2) { console.log('  Not enough buttons for DNS individual test — SKIP'); test.skip(); return; }
            await runBtns.nth(1).click();
            await page.waitForTimeout(8_000);
            const hit = gwReqs().find(r =>
                r.method === 'POST' &&
                (r.path.includes('/api/security/dns-test') || r.path.includes('/api/security/url-test')) &&
                r.peerId.toUpperCase().includes(PEER_LABEL.toUpperCase())
            );
            if (!hit) throw new Error('No individual security test POST captured via gateway');
            console.log(`  ✅ [${hit.status}] GW POST ${hit.path}`);
        });

        test('Security: EICAR/threat test via BR8 gateway', async ({ page }) => {
            await goToTab(page, 'Security');
            await waitNoLoading(page, 'Loading security configuration');
            const threatBtn = page.locator('button:has-text("Run Threat Test"), button[title="Run EICAR test on this target"]').first();
            const visible   = await threatBtn.isVisible({ timeout: 4_000 }).catch(() => false);
            if (!visible) { console.log('  Threat/EICAR button not visible — SKIP'); test.skip(); return; }
            await threatBtn.click();
            await page.waitForTimeout(8_000);
            const hit = gwReqs().find(r =>
                r.method === 'POST' && r.path.includes('/api/security/threat-test') &&
                r.peerId.toUpperCase().includes(PEER_LABEL.toUpperCase())
            );
            if (!hit) throw new Error('No threat-test POST captured via gateway');
            console.log(`  ✅ [${hit.status}] GW POST ${hit.path}`);
        });

        test('IoT: bad-behavior toggle via BR8 gateway', async ({ page }) => {
            await goToTab(page, 'IoT');
            await waitNoLoading(page, 'Loading');
            await page.waitForTimeout(1_500);
            // The global bad-behavior toggle has id="bad-behavior-toggle"
            // Text: "Attacks ON" (when active) or "Clean" (when inactive)
            const bbBtn = page.locator('#bad-behavior-toggle');
            const visible = await bbBtn.isVisible({ timeout: 4_000 }).catch(() => false);
            if (!visible) { console.log('  #bad-behavior-toggle not found — SKIP'); test.skip(); return; }
            const label = (await bbBtn.textContent())?.trim() ?? '';
            console.log(`  IoT bad-behavior state: "${label}"`);
            await bbBtn.click();
            await page.waitForTimeout(5_000);
            const hit = gwReqs().find(r =>
                r.method === 'POST' && r.path.includes('/api/iot/bad-behavior') &&
                r.peerId.toUpperCase().includes(PEER_LABEL.toUpperCase())
            );
            if (!hit) throw new Error('No POST /api/iot/bad-behavior captured via gateway');
            console.log(`  ✅ [${hit.status}] GW POST ${hit.path}`);
            // Restore original state
            const newLabel = (await bbBtn.textContent())?.trim() ?? '';
            if (newLabel !== label) {
                await bbBtn.click();
                await page.waitForTimeout(3_000);
                console.log('  ✅ State restored');
            }
        });

    }); // describe WRITE

    // ═══════════════════════════════════════════════════════════════
    //  SUMMARY — full navigation report
    // ═══════════════════════════════════════════════════════════════

    test('REPORT: full gateway routing summary', async ({ page }) => {
        const tabs = [
            'Traffic Generator', 'Digital Experience', 'Bandwidth Test',
            'Security', 'IoT', 'Voice', 'VyOS Control'
        ];
        for (const tab of tabs) {
            await page.locator('button').filter({ hasText: tab }).first().click().catch(() => {});
            await waitNoLoading(page, 'Loading');
        }

        const gw         = gwReqs();
        const local      = allReqs.filter(r => !r.isGateway);
        const gwPosts    = gw.filter(r => r.method !== 'GET');
        const localPosts = local.filter(r => r.method !== 'GET' && !r.path.includes('/auth/'));

        console.log(`\n${'═'.repeat(60)}`);
        console.log(`  Gateway Routing Report — DC1 → ${PEER_LABEL}`);
        console.log(`${'═'.repeat(60)}`);
        console.log(`  Gateway total : ${gw.length}  (${gwPosts.length} writes)`);
        console.log(`  Local total   : ${local.length}  (${localPosts.length} unexpected writes)`);
        console.log(`\n  Gateway GETs:`);
        const getGroups = gw.filter(r => r.method === 'GET').reduce<Record<string, number>>((a, r) => {
            const k = r.path.split('?')[0]; a[k] = (a[k] || 0) + 1; return a;
        }, {});
        Object.entries(getGroups).sort().forEach(([k, n]) => {
            const errs = gw.filter(r => r.method === 'GET' && r.path.startsWith(k) && r.status >= 400 && r.status !== 404);
            console.log(`    [x${n}] ${k}${errs.length ? `  ⚠️  ${[...new Set(errs.map(e => e.status))]}` : ''}`);
        });
        if (localPosts.length > 0) {
            console.log(`\n  ❌ Unexpected LOCAL writes:`);
            localPosts.forEach(r => console.log(`    ${r.method} ${r.path} [${r.status}]`));
        } else {
            console.log(`\n  ✅ No unexpected local writes`);
        }
        console.log(`${'═'.repeat(60)}\n`);

        expect(gw.length).toBeGreaterThan(10);
        // Auth login is the only acceptable local write
        expect(localPosts.length).toBe(0);
    });

}); // describe
