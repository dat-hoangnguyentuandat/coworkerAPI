// Isolated UI check. Never connects to ChatGPT or reads personal credentials.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildServer } from '../dist/src/app.js';
import { LocalStore } from '../dist/src/local-store.js';
import { TunnelManager } from '../dist/src/tunnel.js';
import { TunnelAdmin } from '../dist/src/tunnel-admin.js';

const modulePath = process.env.COWORKER_UI_PLAYWRIGHT_PATH ?? join(tmpdir(), 'coworkerapi-ui-test-dependencies/node_modules/playwright/index.mjs');
const { chromium } = await import(pathToFileURL(modulePath).href);
const testDir = await mkdtemp(join(tmpdir(), 'coworkerapi-dashboard-visual-'));
const output = resolve('artifacts/dashboard-ui');
await mkdir(output, { recursive: true });
const store = new LocalStore(join(testDir, 'state.json'));
store.setup('123456');
const manager = new TunnelManager({mcpSecret:'isolated-ui-test-no-live-secret',mcpUrl:'http://127.0.0.1:3211/mcp'});
const tunnelAdmin = new TunnelAdmin(testDir,manager);
const app = buildServer(undefined, undefined, store,()=>manager.snapshot(),tunnelAdmin);
let browser;
const failures = [];
let checks = 0;
try {
  await app.listen({ host: '127.0.0.1', port: 0 });
  const url = 'http://127.0.0.1:' + app.server.address().port;
  browser = await chromium.launch({ executablePath: process.env.COWORKER_UI_BROWSER_PATH ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  page.on('pageerror', error => failures.push(error.message));
  await page.goto(url + '/dashboard');
  await page.locator('#auth').waitFor({ state: 'visible' });
  await page.screenshot({ path: join(output, 'login-dark.png'), fullPage: true });
  await page.locator('#password').fill('wrong-password');
  await page.locator('#auth-form button').click();
  await page.getByRole('alert').filter({ hasText: 'Mật khẩu chưa đúng' }).waitFor();
  await page.locator('#password').fill('123456');
  await page.locator('#auth-form button').click();
  await page.locator('#app').waitFor({ state: 'visible' });
  await page.locator('#content .metrics').waitFor();
  await page.locator('#tour-layer').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#tour-step').textContent(), 'Bước 1 / 12');
  await page.locator('#tour-next').click();
  await page.getByText('Bước 2 / 12', { exact: true }).waitFor();
  await page.locator('#tour-back').click();
  await page.getByText('Bước 1 / 12', { exact: true }).waitFor();
  await page.keyboard.press('Escape');
  await page.locator('#tour-layer').waitFor({ state: 'hidden' });
  await page.reload();
  await page.locator('#app').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#tour-layer').isVisible(), false);
  let tourChecks = 0;
  for (const theme of ['dark', 'light']) {
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
    for (const width of [375, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.locator('#show-tour').click();
      for (let step = 1; step <= 12; step++) {
        await page.getByText('Bước ' + step + ' / 12', { exact: true }).waitFor();
        await page.locator('#tour-layer').waitFor({ state: 'visible' });
        const bounds = await page.locator('#tour-card').boundingBox();
        assert.ok(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= width + 1 && bounds.y + bounds.height <= 1001, 'tour card outside viewport: ' + width + '/' + step);
        assert.equal(await page.locator('.tour-current-target').count(), 1, 'missing target: ' + JSON.stringify({step,width,theme,state:await page.evaluate(()=>localStorage.getItem('coworkerapi.onboarding.v1'))}));
        if(step===5){const target=await page.locator('.tour-current-target').boundingBox();assert.ok(target.y+target.height<=bounds.y||target.y>=bounds.y+bounds.height||target.x+target.width<=bounds.x||target.x>=bounds.x+bounds.width,'activation link hidden behind tour card: '+JSON.stringify({width,target,bounds}));}
        if(step===3){
          const scrollable=await page.locator('#tour-card').evaluate(el=>el.scrollHeight>el.clientHeight+1);
          if(scrollable){
            await page.mouse.move(bounds.x+50,bounds.y+Math.min(120,bounds.height/2));
            await page.mouse.wheel(0,1000);
            await page.waitForFunction(()=>document.getElementById('tour-card').scrollTop>0);
            await page.evaluate(()=>new Promise(resolve=>setTimeout(resolve,350)));
            const before=await page.locator('#tour-card').evaluate(el=>el.scrollTop);
            assert.ok(before>0,'tour scroll snapped back after wheel: '+width);
            await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
            const after=await page.locator('#tour-card').evaluate(el=>({top:el.scrollTop,max:el.scrollHeight-el.clientHeight}));
            assert.ok(after.top>=before-1,'tour layout reset scroll: '+width);
            assert.ok(after.top>=after.max-2,'cannot reach bottom of long tour: '+width);
            await page.mouse.wheel(0,-1000);
            await page.waitForFunction(()=>document.getElementById('tour-card').scrollTop===0);
          }
        }
        if (step === 1 || step === 5) await page.screenshot({ path: join(output, 'tour-' + step + '-' + theme + '-' + width + '.png'), fullPage: true });
        tourChecks++;
        await page.locator('#tour-next').click();
      }
      await page.locator('#tour-layer').waitFor({ state: 'hidden' });
    }
  }
  await page.reload();
  await page.locator('#app').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#tour-layer').isVisible(), false, 'completed tour must not auto-open');
  await page.setViewportSize({width:375,height:812});
  await page.locator('#show-tour').click();
  for(let step=1;step<5;step++){await page.getByText('Bước '+step+' / 12',{exact:true}).waitFor();await page.locator('#tour-next').click()}
  await page.getByText('Bước 5 / 12',{exact:true}).waitFor();
  const mobileTarget=await page.locator('.tour-current-target').boundingBox();const mobileCard=await page.locator('#tour-card').boundingBox();
  assert.ok(mobileTarget.y+mobileTarget.height<=mobileCard.y||mobileTarget.y>=mobileCard.y+mobileCard.height,'activation target occluded on short mobile viewport');
  await context.route('https://chatgpt.com/**',route=>route.fulfill({status:200,contentType:'text/html',body:'<title>Isolated activation link check</title>'}));
  const popupPromise=page.waitForEvent('popup');
  await page.locator('.tour-current-target').click();
  const popup=await popupPromise;await popup.waitForLoadState();
  assert.match(new URL(popup.url()).searchParams.get('q'),/workbench_api_activate/);
  await popup.close();
  await page.locator('#tour-hide').click();
  await page.reload();await page.locator('#app').waitFor({state:'visible'});
  assert.equal(await page.locator('#tour-layer').isVisible(),false);
  await page.locator('#show-tour').click();await page.getByText('Bước 5 / 12',{exact:true}).waitFor();
  await page.locator('#tour-skip').click();
  await page.locator('#show-tour').click();
  await page.getByText('Bước 1 / 12', { exact: true }).waitFor();
  await page.locator('#tour-skip').click();
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('coworkerapi.onboarding.v1')).status), 'dismissed');
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
  const pages = ['overview', 'connections', 'usage', 'keys', 'models', 'providers', 'logs', 'limits', 'settings'];
  for (const theme of ['dark', 'light']) {
    if (theme === 'light') await page.locator('#theme-toggle').click();
    for (const width of [375, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const name of pages) {
        await page.locator('[data-page="' + name + '"]').click();
        await page.locator('#content .panel').first().waitFor();
        assert.equal(await page.locator('#content').getByText('Không thể tải dữ liệu', { exact: true }).count(), 0, name + ' render failed');
        assert.equal(await page.locator('.nav [aria-current="page"]').getAttribute('data-page'), name);
        const layout = await page.evaluate(() => ({ viewport: innerWidth, body: document.documentElement.scrollWidth, inputs: [...document.querySelectorAll('#content .input')].map(el => ({ id: el.id, label: !!el.labels?.length })) }));
        assert.ok(layout.body <= layout.viewport + 1, name + ' horizontal page overflow at ' + width + ': ' + layout.body);
        assert.ok(layout.inputs.every(input => input.label), name + ' missing field labels: ' + JSON.stringify(layout.inputs));
        checks++;
        if (width === 1440 || width === 375) await page.screenshot({ path: join(output, name + '-' + theme + '-' + width + '.png'), fullPage: true });
      }
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  if(process.env.COWORKER_UI_TEST_INSTALL==='1'){
    await page.locator('[data-page="connections"]').click();
    await page.locator('#install-tunnel-client').click();
    await page.getByText(/Đã cài tunnel-client/).waitFor({timeout:180000});
    assert.ok((await page.locator('#tunnel-binary').inputValue()).endsWith('tunnel-client.exe'));
    await page.locator('#tunnel-id').fill('tunnel_'+'b'.repeat(32));
    await page.locator('#tunnel-key').fill('isolated-ui-fixture-runtime-key');
    await page.locator('#tunnel-enabled').uncheck();
    await page.locator('#save-tunnel').click();
    await page.getByText('Đã lưu mã hóa. Tunnel đang tắt.',{exact:true}).waitFor();
    assert.equal(await page.locator('#tunnel-key').inputValue(),'');
    await page.locator('#refresh-page').click();await page.locator('#tunnel-id').waitFor();
    assert.equal(await page.locator('#tunnel-id').inputValue(),'tunnel_'+'b'.repeat(32));
    assert.equal(await page.locator('#tunnel-enabled').isChecked(),false);
    assert.equal(await page.locator('#tunnel-key').getAttribute('required'),null);
    await page.locator('#test-tunnel').click();
    await page.getByText(/Tunnel chưa xác nhận sẵn sàng/).waitFor();
  }
  await page.locator('[data-page="keys"]').click();
  await page.locator('#key-name').fill('Isolated UI test');
  await page.locator('#key-form button').click();
  await page.locator('#new-key .secret').waitFor();
  await page.locator('[data-revoke]').click();
  await page.locator('#confirm-dialog').waitFor({ state: 'visible' });
  await page.locator('#confirm-cancel').click();
  assert.equal(await page.locator('[data-revoke]').count(), 1);
  await page.locator('[data-revoke]').click();
  await page.locator('#confirm-accept').click();
  await page.locator('#key-list').getByText('Đã thu hồi').waitFor();
  // Exercise the populated chart against isolated fixture records, not real usage.
  store.recordRequest({ id: 'ui-fixture', at: new Date().toISOString(), protocol: 'anthropic-messages', status: 200, durationMs: 20 });
  await page.locator('[data-page="usage"]').click();
  await page.locator('.chart-bar').waitFor();
  await page.screenshot({ path: join(output, 'usage-light-populated.png'), fullPage: true });
  await page.locator('[data-page="limits"]').click();
  await page.locator('#limits-rpm').fill('45');
  await page.locator('#limits-concurrent').fill('2');
  await page.locator('#limits-form button').click();
  await page.getByText('Đã lưu. Chính sách mới có hiệu lực ngay.').waitFor();
  await page.locator('#refresh-page').click();
  await page.locator('#limits-rpm').waitFor();
  assert.equal(await page.locator('#limits-rpm').inputValue(), '45');
  await page.locator('[data-page="settings"]').click();
  await page.locator('#logout').click();
  await page.locator('#auth').waitFor({ state: 'visible' });
  await page.screenshot({ path: join(output, 'login-light.png'), fullPage: true });
  assert.deepEqual(failures, [], 'browser runtime errors');
  console.log(JSON.stringify({ status: 'passed', responsivePageChecks: checks, tourStepChecks: tourChecks, themes: ['dark', 'light'], widths: [375, 768, 1024, 1440], login: true, invalidPassword: true, tunnelInstallSave:process.env.COWORKER_UI_TEST_INSTALL==='1', tourBack: true, tourEscape: true, tourPauseResume: true, tourCompletion: true, tourSkip: true, keyCreateRevoke: true, revokeCancel: true, populatedUsage: true, limitsPersistence: true, logout: true, browserErrors: failures.length, screenshots: output }));
} finally {
  await browser?.close();
  await app.close();
  await manager.stop();
  await rm(testDir, { recursive: true, force: true });
}
