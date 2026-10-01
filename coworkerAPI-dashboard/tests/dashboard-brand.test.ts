import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { COWORKER_LOGO, DASHBOARD_LOGO_URL } from '../src/dashboard-brand.js';
import { buildServer } from '../src/app.js';
import { LocalStore } from '../src/local-store.js';

test('dashboard serves the original packaged Coworker PNG on login, sidebar and favicon', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'cwapi-brand-'));
  const app = buildServer(undefined, undefined, new LocalStore(join(directory, 'state.json')));
  try {
    const response = await app.inject(DASHBOARD_LOGO_URL);
    assert.equal(response.statusCode, 200);
    assert.match(response.headers['content-type']!, /^image\/png/);
    assert.deepEqual(response.rawPayload, COWORKER_LOGO);
    assert.equal(COWORKER_LOGO.subarray(1, 4).toString(), 'PNG');
    const html = (await app.inject('/dashboard')).body;
    assert.equal((html.match(/class="coworker-logo"/g) ?? []).length, 2);
    assert.ok(html.includes('rel="icon" type="image/png" href="' + DASHBOARD_LOGO_URL + '"'));
    assert.equal((await app.inject('/favicon.ico')).headers.location, DASHBOARD_LOGO_URL);
    assert.equal(createHash('sha256').update(response.rawPayload).digest('hex'), '5d28009891e07b22056dbfecb5011612ddba13fca416eb2c9a97dc3d2379a5b3');
  } finally { await app.close(); rmSync(directory, { recursive: true, force: true }); }
});
