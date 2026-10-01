import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { LocalStore } from '../src/local-store.js';
import { buildServer } from '../src/app.js';

function seed(store: LocalStore, id: string) {
  store.recordRequest({ id, at: new Date().toISOString(), protocol: 'responses', model: 'chatgpt-web', status: 200, durationMs: 15, inputTokens: 8 });
}

test('cleanup persists independently, keeps credentials/settings, and counts new completions after reset', () => {
  const directory = mkdtempSync(join(tmpdir(), 'cwapi-cleanup-store-'));
  try {
    const store = new LocalStore(join(directory, 'state.json'));
    store.setup('123456');
    const key = store.createKey('preserve');
    store.setLimits({ requestsPerMinute: 50, concurrentRequests: 2 });
    store.upsertProvider({ id: 'widget', name: 'Keep provider', type: 'coworker-widget', enabled: true });
    seed(store, 'one'); seed(store, 'two');
    const usage = store.usage();
    assert.equal(store.clearRequests(), 2);
    const afterLogs = new LocalStore(store.file);
    assert.deepEqual(afterLogs.listRequests(), []);
    assert.deepEqual(afterLogs.usage(), usage);
    seed(store, 'three');
    const logs = store.listRequests();
    const reset = store.clearUsage();
    assert.equal(reset.deletedDays, 1);
    assert.ok(Number.isFinite(Date.parse(reset.trackingStartedAt)));
    const reopened = new LocalStore(store.file);
    assert.deepEqual(reopened.listRequests(), logs);
    assert.deepEqual(reopened.usage().days, []);
    assert.equal(reopened.usage().coverage, 'since-reset');
    assert.equal(reopened.summary().requestsToday, 0);
    assert.equal(reopened.summary().activeKeys, 1);
    assert.equal(reopened.verifyKey(key.key), true);
    assert.equal(reopened.verifyPassword('123456'), true);
    assert.deepEqual(reopened.getLimits(), { requestsPerMinute: 50, concurrentRequests: 2 });
    assert.equal(reopened.listProviders()[0].name, 'Keep provider');
    seed(reopened, 'completed-after-reset');
    assert.equal(reopened.usage().days[0].requests, 1);
    assert.equal(reopened.listRequests().length, 2);
    reopened.clearRequests();
    assert.equal(reopened.clearRequests(), 0);
    reopened.clearUsage();
    assert.equal(reopened.clearUsage().deletedDays, 0);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('cleanup endpoints require admin, CSRF and same-origin and clear only the selected dataset', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'cwapi-cleanup-http-'));
  const store = new LocalStore(join(directory, 'state.json'));
  store.setup('123456');
  const key = store.createKey('client');
  const app = buildServer(undefined, undefined, store);
  try {
    const login = await app.inject({ method: 'POST', url: '/api/admin/v1/login', payload: { password: '123456' } });
    const cookie = login.headers['set-cookie'] as string;
    const csrf = login.json().csrf;
    const headers = { cookie, 'x-coworker-csrf': csrf };
    for (const resource of ['requests', 'usage']) {
      seed(store, resource);
      const url = '/api/admin/v1/' + resource;
      assert.equal((await app.inject({ method: 'DELETE', url })).statusCode, 401);
      assert.equal((await app.inject({ method: 'DELETE', url, headers: { authorization: 'Bearer ' + key.key } })).statusCode, 401);
      assert.equal((await app.inject({ method: 'DELETE', url, headers: { cookie } })).statusCode, 403);
      assert.equal((await app.inject({ method: 'DELETE', url, headers: { ...headers, 'x-coworker-csrf': 'wrong' } })).statusCode, 403);
      assert.equal((await app.inject({ method: 'DELETE', url, headers: { ...headers, origin: 'https://attacker.invalid' } })).statusCode, 403);
      assert.equal((await app.inject({ method: 'DELETE', url, remoteAddress: '192.0.2.5', headers })).statusCode, 403);
    }
    assert.equal(store.listRequests().length, 2);
    const logsResult = await app.inject({ method: 'DELETE', url: '/api/admin/v1/requests', headers });
    assert.equal(logsResult.statusCode, 200);
    assert.equal(logsResult.json().deletedRequests, 2);
    assert.equal(store.usage().days[0].requests, 2);
    seed(store, 'keep-log');
    const usageResult = await app.inject({ method: 'DELETE', url: '/api/admin/v1/usage', headers });
    assert.equal(usageResult.statusCode, 200);
    assert.equal(usageResult.json().deletedDays, 1);
    assert.equal(store.listRequests().length, 1);
    assert.equal(store.usage().days.length, 0);
    assert.equal(new LocalStore(store.file).usage().coverage, 'since-reset');
  } finally { await app.close(); rmSync(directory, { recursive: true, force: true }); }
});
