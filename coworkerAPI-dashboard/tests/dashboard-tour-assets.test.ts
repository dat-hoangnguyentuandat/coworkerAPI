import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildServer } from '../src/app.js';
import { LocalStore } from '../src/local-store.js';
import { TOUR_IMAGES, TOUR_RESOURCES, tourImage } from '../src/dashboard-tour-assets.js';
import { DASHBOARD_MESSAGES } from '../src/dashboard-i18n.js';
import { BRIDGE_ACTIVATION_PROMPT, BRIDGE_ACTIVATION_URL } from '../src/branding.js';

test('guide images are bundled, served with fixed routes and bilingual descriptions', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'cwapi-tour-assets-'));
  const app = buildServer(undefined, undefined, new LocalStore(join(directory, 'state.json')));
  try {
    for (const name of TOUR_IMAGES) {
      const response = await app.inject('/dashboard/assets/guide/' + name);
      assert.equal(response.statusCode, 200);
      assert.deepEqual(response.rawPayload, tourImage(name));
      assert.match(response.headers['content-type']!, name.endsWith('.png') ? /image\/png/ : name.endsWith('.svg') ? /image\/svg\+xml/ : /image\/jpeg/);
      assert.equal(response.headers['x-content-type-options'], 'nosniff');
    }
    assert.equal((await app.inject('/dashboard/assets/guide/not-a-file.jpg')).statusCode, 404);
    for (const resource of Object.values(TOUR_RESOURCES)) {
      for (const image of resource.images) {
        assert.ok(TOUR_IMAGES.includes(image.file as typeof TOUR_IMAGES[number]));
        for (const locale of ['vi', 'en'] as const) assert.ok(DASHBOARD_MESSAGES[image.caption][locale]);
      }
      for (const link of resource.links) {
        assert.equal(new URL(link.href).protocol, 'https:');
        for (const locale of ['vi', 'en'] as const) assert.ok(DASHBOARD_MESSAGES[link.label][locale]);
      }
    }
    const html = (await app.inject('/dashboard')).body;
    assert.ok(html.includes('https://platform.openai.com/settings/organization/tunnels'));
    assert.ok(html.includes('https://platform.openai.com/settings/organization/api-keys'));
    assert.ok(html.includes('https://chatgpt.com/plugins'));
    assert.equal(new URL(BRIDGE_ACTIVATION_URL).searchParams.get('q'), BRIDGE_ACTIVATION_PROMPT);
    assert.ok(BRIDGE_ACTIVATION_PROMPT.includes('CoworkerAPI plugin'));
    assert.equal(TOUR_RESOURCES.activate.links[0].href, BRIDGE_ACTIVATION_URL);
    assert.ok(html.includes(BRIDGE_ACTIVATION_URL));
    assert.ok(TOUR_IMAGES.includes('create-api-key.jpg'));
    assert.ok(TOUR_IMAGES.includes('plugin-tools.png'));
    assert.equal(TOUR_RESOURCES.plugin.images[2].instruction, 3);
    for (const locale of ['vi', 'en'] as const) {
      assert.ok(DASHBOARD_MESSAGES['tour.tunnel-setup.body'][locale].includes('Create new secret key'));
      assert.ok(DASHBOARD_MESSAGES['tour.tunnel-setup.body'][locale].includes('Project'));
      assert.ok(!DASHBOARD_MESSAGES['tour.tunnel-setup.body'][locale].includes('Runtime API Keys'));
      assert.ok(!DASHBOARD_MESSAGES['ui.open_runtime_api_keys'][locale].includes('Runtime API Keys'));
      assert.ok(DASHBOARD_MESSAGES['tour.image.plugin'][locale].includes('CoworkerAPI'));
      assert.ok(!DASHBOARD_MESSAGES['tour.image.plugin'][locale].match(/Coworker(?!API)/));
      assert.ok(!DASHBOARD_MESSAGES['tour.activate.body'][locale].match(/Coworker(?!API)/));
    }
  } finally { await app.close(); rmSync(directory, { recursive: true, force: true }); }
});
