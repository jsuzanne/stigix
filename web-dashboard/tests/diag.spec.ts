import { test } from '@playwright/test';

test('diag: login + snapshot', async ({ page }) => {
    await page.goto('http://192.168.122.51:8080', { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: 'test-results/stigix-01-initial.png' });
    console.log('URL:', page.url(), '| Title:', await page.title());

    const inputs = await page.locator('input').count();
    console.log('Inputs visible:', inputs);

    await page.fill('input[placeholder*="username"]', 'admin').catch(e => console.log('fill user err:', e.message));
    await page.fill('input[type="password"]', 'admin').catch(e => console.log('fill pass err:', e.message));
    await page.screenshot({ path: 'test-results/stigix-02-filled.png' });

    await page.click('button[type="submit"]').catch(e => console.log('submit err:', e.message));
    await page.waitForTimeout(4000);
    await page.screenshot({ path: 'test-results/stigix-03-after-login.png' });

    console.log('URL after login:', page.url());
    const ids = await page.evaluate(() =>
        [...document.querySelectorAll('[id]')].map((el: any) => el.id).filter(Boolean).join(', ')
    );
    console.log('IDs on page:', ids.slice(0, 600));

    const peerBtn = await page.locator('#peer-context-switcher').isVisible().catch(() => false);
    console.log('#peer-context-switcher visible:', peerBtn);
});
