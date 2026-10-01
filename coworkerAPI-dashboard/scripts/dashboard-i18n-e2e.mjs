// Bilingual browser checks with isolated data; no personal credentials or upstream calls.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildServer } from '../dist/src/app.js';
import { LocalStore } from '../dist/src/local-store.js';
import { TunnelManager } from '../dist/src/tunnel.js';
import { TunnelAdmin } from '../dist/src/tunnel-admin.js';

const { chromium } = await import(pathToFileURL(process.env.COWORKER_UI_PLAYWRIGHT_PATH ?? join(tmpdir(), 'coworkerapi-ui-test-dependencies/node_modules/playwright/index.mjs')).href);
const directory = await mkdtemp(join(tmpdir(), 'coworkerapi-i18n-'));
const output = resolve('artifacts/dashboard-i18n');
await mkdir(output, { recursive: true });
const store = new LocalStore(join(directory, 'state.json'));
store.setup('123456');
const manager = new TunnelManager({ mcpSecret: 'isolated-i18n-test', mcpUrl: 'http://127.0.0.1:3211/mcp' });
const app = buildServer(undefined, undefined, store, () => manager.snapshot(), new TunnelAdmin(directory, manager));
const errors = [];
let browser, pageChecks = 0, tourChecks = 0;
try {
  await app.listen({ host: '127.0.0.1', port: 0 });
  const url = 'http://127.0.0.1:' + app.server.address().port + '/dashboard';
  browser = await chromium.launch({ executablePath: process.env.COWORKER_UI_BROWSER_PATH ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  const change = async locale => {
    await page.locator('[data-locale-select]:visible').selectOption(locale);
    await page.waitForFunction(locale => document.documentElement.lang === locale && !document.querySelector('[data-locale-select]:disabled'), locale);
  };
  await page.goto(url);
  await page.locator('#auth').waitFor({ state: 'visible' });
  await page.locator('#password').fill('wrong-password');
  await page.locator('#auth-form button').click();
  await page.getByRole('alert').filter({ hasText: 'Mật khẩu chưa đúng' }).waitFor();
  await change('en');
  assert.equal(await page.locator('#auth-title').textContent(), 'Sign in to CoworkerAPI');
  assert.match(await page.locator('#message').textContent(), /Incorrect password/);
  assert.equal(await page.locator('#password').inputValue(), 'wrong-password');
  assert.equal(await page.locator('#auth-form button').textContent(), 'Sign in');
  await page.reload();
  await page.locator('#auth').waitFor({ state: 'visible' });
  assert.equal(await page.locator('html').getAttribute('lang'), 'en');
  await page.screenshot({ path: join(output, 'login-en.png'), fullPage: true });
  await page.locator('#password').fill('123456');
  await page.locator('#auth-form button').click();
  await page.locator('#tour-layer').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#tour-step').textContent(), 'Step 1 / 12');
  // Switching mid-guide keeps the same step and updates the underlying page.
  await page.evaluate(() => changeDashboardLocale('vi'));
  assert.equal(await page.locator('#tour-step').textContent(), 'Bước 1 / 12');
  assert.equal(await page.locator('#title').textContent(), 'Tổng quan');
  await page.evaluate(() => changeDashboardLocale('en'));
  assert.equal(await page.locator('#tour-step').textContent(), 'Step 1 / 12');
  await page.locator('#tour-skip').click();

  const pages = ['overview', 'connections', 'usage', 'keys', 'models', 'providers', 'logs', 'limits', 'settings'];
  const titles = ['Overview', 'Connections', 'Usage', 'API keys', 'Models', 'Providers', 'Logs', 'Limits', 'Settings'];
  for (const theme of ['dark', 'light']) {
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
    for (const width of [375, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      for (let i = 0; i < pages.length; i++) {
        await page.locator('[data-page="' + pages[i] + '"]').click();
        await page.locator('#content .panel').first().waitFor();
        assert.equal(await page.locator('#title').textContent(), titles[i]);
        const text = await page.locator('#content').innerText();
        assert.ok(!/[À-ỹ]/.test(text), 'untranslated English page: ' + pages[i]);
        const layout = await page.evaluate(() => ({ width: innerWidth, body: document.documentElement.scrollWidth, labels: [...document.querySelectorAll('#content .input')].every(el => el.labels?.length) }));
        assert.ok(layout.body <= layout.width + 1, pages[i] + ' overflows at ' + width);
        assert.ok(layout.labels, pages[i] + ' missing input labels');
        if (width === 375 || width === 1440) await page.screenshot({ path: join(output, pages[i] + '-en-' + theme + '-' + width + '.png'), fullPage: true });
        pageChecks++;
      }
      await page.locator('#show-tour').click();
      for (let step = 1; step <= 12; step++) {
        await page.getByText('Step ' + step + ' / 12', { exact: true }).waitFor();
        assert.ok(!/[À-ỹ]/.test(await page.locator('#tour-card').innerText()), 'untranslated tour step ' + step);
        const bounds = await page.locator('#tour-card').boundingBox();
        assert.ok(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= width + 1 && bounds.y + bounds.height <= 1001);
        if (step === 3 && width === 375) {
          await page.mouse.move(bounds.x + 40, bounds.y + 100);
          await page.mouse.wheel(0, 2000);
          await page.waitForFunction(() => { const el = document.getElementById('tour-card'); return el.scrollTop >= el.scrollHeight - el.clientHeight - 2; });
          await page.screenshot({ path: join(output, 'tunnel-guide-en-' + theme + '-375.png'), fullPage: true });
        }
        tourChecks++;
        await page.locator('#tour-next').click();
      }
      await page.locator('#tour-layer').waitFor({ state: 'hidden' });
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator('[data-page="connections"]').click();
  await page.locator('#tunnel-id').fill('tunnel_' + 'c'.repeat(32));
  await page.locator('#tunnel-key').fill('isolated-unsaved-runtime-key');
  await page.locator('#tunnel-enabled').uncheck();
  await change('vi');
  assert.equal(await page.locator('#tunnel-key').inputValue(), 'isolated-unsaved-runtime-key');
  assert.equal(await page.locator('#tunnel-id').inputValue(), 'tunnel_' + 'c'.repeat(32));
  assert.equal(await page.locator('#tunnel-enabled').isChecked(), false);
  await change('en');
  await page.locator('#test-tunnel').click();
  await page.locator('#tunnel-result').filter({ hasText: 'Tunnel readiness has not been confirmed' }).waitFor();
  await change('vi');
  assert.match(await page.locator('#tunnel-result').textContent(), /Tunnel chưa xác nhận sẵn sàng/);
  await page.locator('[data-page="providers"]').click();
  await page.locator('#provider-id').fill('Chưa sử dụng');
  await page.locator('#provider-name').fill('Tổng quan');
  await page.locator('#provider-type').selectOption('anthropic');
  await page.locator('#provider-key').fill('isolated-unsaved-provider-key');
  await change('en');
  assert.equal(await page.locator('#provider-name').inputValue(), 'Tổng quan', 'user input must never be translated');
  assert.equal(await page.locator('#provider-id').inputValue(), 'Chưa sử dụng');
  assert.equal(await page.locator('#provider-key').inputValue(), 'isolated-unsaved-provider-key');
  assert.equal(await page.locator('#provider-wire').isDisabled(), true);
  await page.locator('[data-page="keys"]').click();
  await page.locator('#key-name').fill('Tổng quan');
  await page.locator('#key-form button').click();
  await page.locator('#new-key .secret').waitFor();
  const key = await page.locator('#new-key .secret').textContent();
  await change('vi');
  assert.equal(await page.locator('#new-key .secret').textContent(), key);
  await change('en');
  assert.equal(await page.locator('#new-key .secret').textContent(), key);
  assert.equal(await page.locator('#key-list strong').textContent(), 'Tổng quan');
  await page.locator('[data-revoke]').click();
  assert.equal(await page.locator('#confirm-title').textContent(), 'Revoke API key?');
  await page.locator('#confirm-cancel').click();
  await page.locator('[data-page="limits"]').click();
  await page.locator('#limits-rpm').fill('42');
  await change('vi');
  assert.equal(await page.locator('#limits-rpm').inputValue(), '42');
  await page.locator('#limits-form button').click();
  await page.getByText('Đã lưu. Chính sách mới có hiệu lực ngay.').waitFor();
  await change('en');
  await page.getByText('Saved. The new policy is effective immediately.').waitFor();
  // Clear controls operate only on this isolated store.
  for (let i = 0; i < 2; i++) store.recordRequest({ id: 'cleanup-' + i, at: new Date().toISOString(), protocol: 'responses', status: 200, durationMs: 10 });
  await page.locator('[data-page="logs"]').click();
  await page.locator('#clear-logs').click();
  await page.locator('#confirm-dialog').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#confirm-title').textContent(), 'Clear all request logs?');
  await page.screenshot({ path: join(output, 'clear-logs-confirm-en.png'), fullPage: true });
  await page.locator('#confirm-cancel').click();
  assert.equal(store.listRequests().length, 2);
  await change('vi');
  await page.locator('#clear-logs').click();
  assert.equal(await page.locator('#confirm-title').textContent(), 'Xóa toàn bộ nhật ký?');
  await page.locator('#confirm-accept').click();
  await page.getByText('Đã xóa nhật ký. Số liệu Usage được giữ nguyên.', { exact: true }).waitFor();
  assert.equal(store.listRequests().length, 0);
  assert.equal(store.usage().days[0].requests, 2);
  assert.equal(await page.locator('#clear-logs').isDisabled(), true);
  store.recordRequest({ id: 'keep-after-reset', at: new Date().toISOString(), protocol: 'responses', status: 200, durationMs: 10 });
  await page.locator('[data-page="usage"]').click();
  await page.locator('#clear-usage').click();
  await page.locator('#confirm-dialog').waitFor({ state: 'visible' });
  await page.locator('#confirm-cancel').click();
  assert.equal(store.usage().days[0].requests, 3);
  await change('en');
  await page.locator('#clear-usage').click();
  assert.equal(await page.locator('#confirm-title').textContent(), 'Clear all usage data?');
  await page.locator('#confirm-accept').click();
  await page.getByText('Usage data cleared. Request logs were retained.', { exact: true }).waitFor();
  assert.equal(store.usage().days.length, 0);
  assert.equal(store.summary().requestsToday, 0);
  assert.equal(store.listRequests().length, 1);
  assert.equal(new LocalStore(store.file).usage().coverage, 'since-reset');
  assert.equal(await page.locator('#clear-usage').isDisabled(), true);
  await page.getByText('Metrics are aggregated since the last data reset.', { exact: true }).waitFor();
  await page.locator('[data-page="settings"]').click();
  await page.locator('#logout').click();
  await page.locator('#auth').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#auth-title').textContent(), 'Sign in to CoworkerAPI');
  assert.equal(await page.evaluate(() => localStorage.getItem('coworkerapi.locale')), 'en');
  assert.ok(!(await page.evaluate(() => JSON.stringify(localStorage))).includes(key), 'API key must not be persisted by i18n');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ status: 'passed', englishPageChecks: pageChecks, englishTourChecks: tourChecks, switchViEn: true, loginErrors: true, localePersistence: true, formPreservation: true, keyPreservation: true, userDataUnchanged: true, clearLogs: true, clearUsage: true, cleanupCancel: true, cleanupIsolation: true, browserErrors: errors.length }));
} finally {
  await browser?.close();
  await app.close();
  await manager.stop();
  await rm(directory, { recursive: true, force: true });
}
