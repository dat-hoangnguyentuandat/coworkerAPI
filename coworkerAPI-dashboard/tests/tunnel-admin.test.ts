import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildServer } from '../src/app.js';
import { LocalStore } from '../src/local-store.js';
import { TunnelManager } from '../src/tunnel.js';
import { TunnelAdmin } from '../src/tunnel-admin.js';
import { readTunnelSettings } from '../src/tunnel-settings.js';

test('dashboard tunnel saves DPAPI-encrypted secrets, keeps blank keys, survives reopen, and enforces local session/CSRF/host protections', { skip: process.platform !== 'win32' }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'coworkerapi-tunnel-admin-'));
  const binaryPath = join(directory, 'tunnel-client.exe');
  // Validation fixture only: never execute this file; every save is disabled.
  await writeFile(binaryPath, 'validation-only-file');
  const store = new LocalStore(join(directory, 'state.json'));store.setup('123456');
  const manager = new TunnelManager({ mcpSecret: 'fixture-mcp-secret', mcpUrl: 'http://127.0.0.1:3211/mcp' });
  const admin = new TunnelAdmin(directory, manager);
  const app = buildServer(undefined, undefined, store, () => manager.snapshot(), admin);
  const secret = 'fixture-runtime-key-not-for-live-use';
  const payload = { binaryPath, tunnelId: 'tunnel_' + 'a'.repeat(32), runtimeApiKey: secret, enabled: false };
  try {
    assert.equal((await app.inject('/api/admin/v1/tunnel')).statusCode, 401);
    const login = await app.inject({method:'POST',url:'/api/admin/v1/login',payload:{password:'123456'}});
    const headers = { cookie: login.headers['set-cookie'] as string, 'x-coworker-csrf': login.json().csrf, host: 'localhost' };
    assert.equal((await app.inject({method:'PUT',url:'/api/admin/v1/tunnel',payload,headers:{cookie:headers.cookie,host:'localhost'}})).statusCode,403);
    assert.equal((await app.inject({method:'PUT',url:'/api/admin/v1/tunnel',payload,headers:{...headers,origin:'https://foreign.invalid'}})).statusCode,403);
    assert.equal((await app.inject({method:'PUT',url:'/api/admin/v1/tunnel',payload,headers:{...headers,host:'foreign.invalid'}})).statusCode,403);
    assert.equal((await app.inject({method:'PUT',url:'/api/admin/v1/tunnel',payload,headers,remoteAddress:'192.168.1.50'})).statusCode,403);
    for (const action of ['install','start','stop','test']) assert.equal((await app.inject({method:'POST',url:'/api/admin/v1/tunnel/'+action,headers:{cookie:headers.cookie,host:'localhost'},payload:{}})).statusCode,403);
    const invalid = await app.inject({method:'PUT',url:'/api/admin/v1/tunnel',headers,payload:{...payload,tunnelId:'invalid'}});
    assert.equal(invalid.statusCode,400);
    const saved = await app.inject({method:'PUT',url:'/api/admin/v1/tunnel',headers,payload});
    assert.equal(saved.statusCode,200,saved.body);
    assert.equal(saved.json().hasRuntimeKey,true);
    assert.equal(saved.json().enabled,false);
    assert.ok(!saved.body.includes(secret));
    const disk = await readFile(join(directory,'tunnel-settings.json'),'utf8');
    assert.ok(!disk.includes(secret));
    assert.equal(JSON.parse(disk).version,2);
    const reopened = readTunnelSettings(directory);
    assert.equal(reopened.runtimeApiKey,secret);
    const withoutKey={binaryPath,tunnelId:payload.tunnelId,enabled:false};
    assert.equal((await app.inject({method:'PUT',url:'/api/admin/v1/tunnel',headers,payload:withoutKey})).statusCode,200);
    assert.equal(readTunnelSettings(directory).runtimeApiKey,secret);
    const publicConfig = await app.inject({url:'/api/admin/v1/tunnel',headers});
    assert.ok(!publicConfig.body.includes(secret));
    assert.ok(!publicConfig.body.includes('protectedKey'));
    const probe = await app.inject({method:'POST',url:'/api/admin/v1/tunnel/test',headers,payload:{}});
    assert.equal(probe.json().processRunning,false);
    assert.equal(probe.json().remoteReady,null);
    const updates = await Promise.allSettled([admin.save(withoutKey),admin.save(withoutKey)]);
    assert.equal(updates.filter(result=>result.status==='fulfilled').length,1);
    assert.equal(updates.filter(result=>result.status==='rejected'&&result.reason.message==='tunnel_operation_busy').length,1);
  } finally { await app.close();await manager.stop();await rm(directory,{recursive:true,force:true}); }
});
