// Isolated real-browser checks: native option colors, theme reveal and refresh motion.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildServer } from '../dist/src/app.js';
import { LocalStore } from '../dist/src/local-store.js';

const { chromium } = await import(pathToFileURL(process.env.COWORKER_UI_PLAYWRIGHT_PATH ?? join(tmpdir(), 'coworkerapi-ui-test-dependencies/node_modules/playwright/index.mjs')).href);
const directory = await mkdtemp(join(tmpdir(), 'cwapi-motion-'));
const output = resolve('artifacts/dashboard-motion');
await mkdir(output, { recursive: true });
const store = new LocalStore(join(directory, 'state.json'));
store.setup('123456');
const app = buildServer(undefined, undefined, store);
let browser;
const errors = [];
try {
  await app.listen({ host: '127.0.0.1', port: 0 });
  browser = await chromium.launch({ executablePath: process.env.COWORKER_UI_BROWSER_PATH ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'no-preference' });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem('coworkerapi.onboarding.v1', JSON.stringify({ status: 'done', step: 'finish' }));
    window.motionEvidence = [];
    const original = Element.prototype.animate;
    Element.prototype.animate = function (frames, options) {
      window.motionEvidence.push({ id: this.id, pseudoElement: options?.pseudoElement, frames, duration: options?.duration });
      return original.call(this, frames, options);
    };
  });
  await page.goto('http://127.0.0.1:' + app.server.address().port + '/dashboard');
  await page.locator('#auth').waitFor({ state: 'visible' });
  await page.locator('#password').fill('123456');
  await page.locator('#auth-form button').click();
  await page.locator('#app').waitFor({ state: 'visible' });
  for (const theme of ['dark', 'light']) {
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
    const colors = await page.locator('.top-actions .locale-select option').evaluateAll(options => options.map(el => ({ color: getComputedStyle(el).color, background: getComputedStyle(el).backgroundColor })));
    assert.ok(colors.every(item => item.color === (theme === 'dark' ? 'rgb(243, 243, 243)' : 'rgb(32, 32, 32)')));
    assert.ok(colors.every(item => item.background === (theme === 'dark' ? 'rgb(24, 24, 24)' : 'rgb(255, 255, 255)')));
    await page.locator('.top-actions .locale-select').focus();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => !document.querySelector('[data-locale-select]:disabled'));
  }
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; window.motionEvidence = []; });
  await page.locator('#theme-toggle').click();
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'light' && !document.getElementById('theme-toggle').disabled);
  assert.equal(await page.evaluate(() => localStorage.getItem('coworkerapi-theme')), 'light');
  const reveal = await page.evaluate(() => window.motionEvidence.find(item => item.pseudoElement === '::view-transition-new(root)'));
  assert.ok(reveal, 'real View Transition reveal was not animated');
  assert.equal(reveal.duration, 520);
  assert.match(reveal.frames.clipPath[0], /^circle\(0px at/);
  await page.locator('#theme-toggle').focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark' && !document.getElementById('theme-toggle').disabled);
  await page.screenshot({ path: join(output, 'header-dark.png'), fullPage: true });

  // Hold only the local overview route long enough to inspect loading state.
  let release;
  const held = new Promise(resolve => { release = resolve; });
  await page.route('**/api/admin/v1/overview', async route => { await held; await route.continue(); });
  await page.locator('#refresh-page').click();
  assert.equal(await page.locator('#refresh-page').getAttribute('aria-busy'), 'true');
  assert.equal(await page.locator('#content').getAttribute('aria-busy'), 'true');
  assert.equal(await page.locator('#refresh-page').isDisabled(), true);
  const spin = await page.locator('#refresh-page svg').evaluate(el => getComputedStyle(el).animationName);
  assert.equal(spin, 'dashboard-refresh-spin');
  await page.screenshot({ path: join(output, 'refresh-pending.png'), fullPage: true });
  release();
  await page.waitForFunction(() => !document.getElementById('refresh-page').disabled);
  await page.unroute('**/api/admin/v1/overview');
  assert.equal(await page.locator('#content').getAttribute('aria-busy'), null);
  assert.ok(await page.evaluate(() => window.motionEvidence.some(item => item.id === 'content' && item.duration === 240)));

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() => window.motionEvidence = []);
  await page.locator('#theme-toggle').click();
  await page.waitForFunction(() => !document.getElementById('theme-toggle').disabled);
  await page.locator('#refresh-page').click();
  await page.waitForFunction(() => !document.getElementById('refresh-page').disabled);
  assert.equal(await page.evaluate(() => window.motionEvidence.length), 0, 'reduced motion must skip JS animations');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.evaluate(() => { document.startViewTransition = undefined; window.motionEvidence = []; });
  await page.locator('#theme-toggle').click();
  await page.waitForFunction(() => !document.getElementById('theme-toggle').disabled);
  assert.equal(await page.evaluate(() => window.motionEvidence.length), 0, 'unsupported browsers must fall back safely');

  await page.locator('[data-page="settings"]').click();
  await page.locator('.endpoint-card').first().waitFor();
  assert.equal(await page.locator('.endpoint-card').count(), 2);
  assert.deepEqual(await page.locator('.endpoint-card h2').allTextContents(), ['Anthropic-compatible endpoint', 'OpenAI-compatible endpoint']);
  const bases = await page.locator('.endpoint-card [data-copy]').evaluateAll(buttons => buttons.map(button => button.dataset.copy));
  assert.equal(bases[1], bases[0] + '/v1');
  assert.ok(!/Claude Code|Codex|OpenCode/.test(await page.locator('#content').innerText()));
  for (const width of [375, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.screenshot({ path: join(output, 'settings-' + width + '.png'), fullPage: true });
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ status: 'passed', nativeOptionColors: true, keyboardLocale: true, circularThemeReveal: true, keyboardTheme: true, refreshSpinAndReveal: true, reducedMotion: true, unsupportedFallback: true, endpointCards: 2, browserErrors: 0 }));
} finally {
  await browser?.close();
  await app.close();
  await rm(directory, { recursive: true, force: true });
}
