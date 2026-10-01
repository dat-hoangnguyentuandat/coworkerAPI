#!/usr/bin/env node
// Installed persistence + HTTP admin check. Request usage is simulated metadata.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(process.argv[2] ?? '.');
const { LocalStore } = await import(pathToFileURL(join(root, 'dist/src/local-store.js')));
const { buildServer } = await import(pathToFileURL(join(root, 'dist/src/app.js')));
const report = { startedAt: new Date().toISOString(), packageRoot: root, upstream: 'simulated request metadata, not ChatGPT', status: 'failed', checks: [] };
let app;
try {
  const directory = await mkdtemp(join(tmpdir(), 'coworkerapi-installed-usage-'));
  const file = join(directory, 'state.json');
  report.workDirectory = directory;
  const store = new LocalStore(file);
  const password = randomBytes(32).toString('hex');
  store.setup(password);
  const timestamp = new Date().toISOString();
  for (let i = 0; i < 1002; i++) store.recordRequest({ id: String(i), at: timestamp, protocol: 'anthropic-messages', status: i === 0 ? 500 : 200, durationMs: 10,
    ...(i === 0 ? { inputTokens: 12, outputTokens: 0, costEstimateUsd: 0.01, usageSource: 'upstream' } : {}),
    prompt: 'usage-e2e-do-not-store', apiKey: 'usage-e2e-do-not-store' });
  assert.equal(store.listRequests().length, 1000);
  assert.equal(store.summary().requestsToday, 1002);
  assert.equal(store.summary().errorsToday, 1);
  assert.equal((await readFile(file, 'utf8')).includes('usage-e2e-do-not-store'), false);
  report.checks.push({ name: 'retention_cap_does_not_reduce_totals_and_metadata_allowlist', passed: true });
  for (let restart = 0; restart < 2; restart++) {
    app = buildServer(undefined, undefined, new LocalStore(file));
    await app.listen({ host: '127.0.0.1', port: 0 });
    const base = `http://127.0.0.1:${app.server.address().port}`;
    const unauthorized = await fetch(base + '/api/admin/v1/usage');
    assert.equal(unauthorized.status, 401); await unauthorized.body.cancel();
    const login = await fetch(base + '/api/admin/v1/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password }) });
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie').split(';')[0]; await login.body.cancel();
    const response = await fetch(base + '/api/admin/v1/usage', { headers: { cookie } });
    assert.equal(response.status, 200);
    const usage = await response.json();
    const day = usage.days[0];
    assert.equal(usage.coverage, 'since-store-created');
    assert.equal(day.requests, 1002);
    assert.deepEqual(day.measurements.inputTokens, { sum: 12, known: 1, unknown: 1001 });
    assert.deepEqual(day.measurements.outputTokens, { sum: 0, known: 1, unknown: 1001 });
    assert.deepEqual(day.measurements.reasoningTokens, { sum: null, known: 0, unknown: 1002 });
    assert.deepEqual(day.measurements.costEstimateUsd, { sum: 0.01, known: 1, unknown: 1001 });
    const page = await fetch(base + '/dashboard');
    assert.ok((await page.text()).includes('Usage theo ngày (UTC)'));
    report.checks.push({ name: `authenticated_usage_after_server_start_${restart + 1}`, passed: true });
    await app.close(); app = undefined;
  }
  report.status = 'passed';
} catch (error) { report.failure = error?.code ?? error?.name ?? 'usage_check_failed'; process.exitCode = 1; }
finally {
  if (app) await app.close();
  report.finishedAt = new Date().toISOString();
  await mkdir('artifacts', { recursive: true });
  await writeFile(join('artifacts', `candidate-usage-e2e-${report.startedAt.replace(/[:.]/g, '-')}.json`), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify(report));
}
