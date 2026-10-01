// Isolated browser test: no personal data or ChatGPT calls.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildServer } from '../dist/src/app.js';
import { LocalStore } from '../dist/src/local-store.js';
const { chromium } = await import(pathToFileURL(process.env.COWORKER_UI_PLAYWRIGHT_PATH ?? join(tmpdir(), 'coworkerapi-ui-test-dependencies/node_modules/playwright/index.mjs')).href);
const directory = await mkdtemp(join(tmpdir(), 'cwapi-tour-media-'));
const output = resolve('artifacts/dashboard-tour-media');
await mkdir(output, { recursive: true });
const store = new LocalStore(join(directory, 'state.json'));
store.setup('123456');
const app = buildServer(undefined, undefined, store);
let browser;
const errors = [];
try {
  await app.listen({ host: '127.0.0.1', port: 0 });
  const base = 'http://127.0.0.1:' + app.server.address().port;
  browser = await chromium.launch({ executablePath: process.env.COWORKER_UI_BROWSER_PATH ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
  const page = await browser.newPage({ reducedMotion: 'reduce' });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base + '/dashboard');
  await page.locator('#password').fill('123456');
  await page.locator('#auth-form button').click();
  await page.locator('#tour-layer').waitFor({ state: 'visible' });
  await page.locator('#tour-next').click();
  await page.locator('#tour-next').click();
  for (const locale of ['vi', 'en']) {
    await page.evaluate(locale => changeDashboardLocale(locale), locale);
    for (const theme of ['light', 'dark']) {
      await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
      for (const width of [375, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        await page.waitForFunction(() => document.querySelectorAll('#tour-body img').length === 2 && [...document.querySelectorAll('#tour-body img')].every(img => img.complete && img.naturalWidth > 0));
        const links = await page.locator('#tour-body [data-tour-link]').evaluateAll(nodes => nodes.map(node => ({ href: node.href, target: node.target, rel: node.rel })));
        assert.equal(links.length, 3);
        assert.ok(links.every(link => link.target === '_blank' && link.rel.includes('noopener')));
        assert.equal(await page.locator('#tour-body .tour-resources').count(), 0);
        assert.equal(await page.locator('#tour-body ol > li').nth(0).locator('a[data-tour-link="0"]').count(), 1);
        assert.equal(await page.locator('#tour-body ol > li').nth(1).locator('a[data-tour-link="1"]').count(), 1);
        assert.equal(await page.locator('#tour-body ol > li').nth(0).locator('img').count(), 1);
        assert.equal(await page.locator('#tour-body ol > li').nth(1).locator('img').count(), 1);
        const imageLink = page.locator('#tour-body .tour-figure a').first();
        await imageLink.scrollIntoViewIfNeeded();
        const before = await page.locator('#tour-card').evaluate(el => el.scrollTop);
        await imageLink.click();
        await page.locator('#tour-image-dialog').waitFor({ state: 'visible' });
        await page.waitForFunction(() => document.querySelector('#tour-image-full').complete && document.querySelector('#tour-image-full').naturalWidth > 0);
        assert.equal(browser.contexts()[0].pages().length, 1, 'image must not open another tab');
        assert.equal(await page.locator('#tour-image-close').textContent(), locale === 'vi' ? 'Đóng' : 'Close');
        await page.keyboard.press('Tab');
        assert.equal(await page.locator('#tour-image-dialog').evaluate(el => el.contains(document.activeElement)), true);
        await page.screenshot({ path: join(output, `image-popup-${locale}-${theme}-${width}.png`) });
        await page.locator('#tour-image-close').click();
        await page.locator('#tour-image-dialog').waitFor({ state: 'hidden' });
        assert.equal(await page.locator('#tour-card').evaluate(el => el.scrollTop), before);
        assert.equal(await imageLink.evaluate(el => el === document.activeElement), true);
        const card = page.locator('#tour-card');
        await card.evaluate(el => { el.scrollTop = el.scrollHeight; });
        const bottom = await card.evaluate(el => el.scrollTop);
        assert.ok(bottom > 0);
        await page.waitForTimeout(3500);
        assert.ok(await card.evaluate(el => el.scrollTop) >= bottom - 2, 'heartbeat must not reset guide scroll');
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        await page.screenshot({ path: join(output, `tunnel-${locale}-${theme}-${width}.png`) });
      }
    }
  }
  await page.locator('#tour-next').click();
  await page.waitForFunction(() => document.querySelectorAll('#tour-body img').length === 3 && [...document.querySelectorAll('#tour-body img')].every(img => img.complete && img.naturalWidth > 0));
  assert.equal(await page.locator('#tour-body ol > li').nth(3).locator('img[src$="plugin-tools.png"]').count(), 1);
  const toolImage = page.locator('#tour-body ol > li').nth(3).locator('.tour-figure a');
  await toolImage.scrollIntoViewIfNeeded();
  await toolImage.click();
  await page.locator('#tour-image-dialog').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#tour-image-full').getAttribute('src'), base + '/dashboard/assets/guide/plugin-tools.png');
  await page.waitForFunction(() => document.querySelector('#tour-image-full').complete && document.querySelector('#tour-image-full').naturalWidth > 0);
  await page.screenshot({ path: join(output, 'plugin-tools-popup.png') });
  await page.locator('#tour-image-close').click();
  assert.equal(await page.locator('#tour-body a[href="https://chatgpt.com/plugins"]').count(), 1);
  const image = page.locator('#tour-body .tour-figure a').first();
  await image.scrollIntoViewIfNeeded();
  await image.click();
  await page.locator('#tour-image-dialog').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#tour-image-full').getAttribute('src'), base + '/dashboard/assets/guide/developer-mode.jpg');
  await page.keyboard.press('Escape');
  await page.locator('#tour-image-dialog').waitFor({ state: 'hidden' });
  assert.equal(await page.locator('#tour-layer').isVisible(), true, 'Escape closes the image, not the guide');
  await image.click();
  await page.locator('#tour-image-dialog').waitFor({ state: 'visible' });
  await page.mouse.click(2, 2);
  await page.locator('#tour-image-dialog').waitFor({ state: 'hidden' });
  await page.locator('#tour-next').click();
  await page.waitForFunction(() => document.querySelector('#tour-step').textContent === 'Step 5 / 12');
  const activation = await page.locator('#tour-body ol > li').first().locator('[data-tour-link]').getAttribute('href');
  assert.ok(new URL(activation).searchParams.get('q').includes('workbench_api_activate'));
  assert.deepEqual(errors, []);
  console.log('PASS: inline links/images, 8 responsive/theme combinations, persistent scroll, in-page image popup, keyboard focus, Close/Escape/backdrop, no new tab, activation URL.');
} finally {
  await browser?.close();
  await app.close();
  await rm(directory, { recursive: true, force: true });
}
