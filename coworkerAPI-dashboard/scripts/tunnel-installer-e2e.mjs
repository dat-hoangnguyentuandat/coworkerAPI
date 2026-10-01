// Download and validate the actual public OpenAI Windows release via admin HTTP.
// Uses an isolated store and never sends a runtime key or starts a live tunnel.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { buildServer } from '../dist/src/app.js';
import { LocalStore } from '../dist/src/local-store.js';
import { TunnelManager } from '../dist/src/tunnel.js';
import { TunnelAdmin } from '../dist/src/tunnel-admin.js';
const directory=await mkdtemp(join(tmpdir(),'coworkerapi-real-installer-'));
const store=new LocalStore(join(directory,'state.json'));store.setup('123456');
const manager=new TunnelManager({mcpSecret:'isolated-no-live-secret',mcpUrl:'http://127.0.0.1:3211/mcp'});
const admin=new TunnelAdmin(directory,manager);
const app=buildServer(undefined,undefined,store,()=>manager.snapshot(),admin);
try {
  await app.listen({host:'127.0.0.1',port:0});
  const base='http://127.0.0.1:'+app.server.address().port;
  const login=await fetch(base+'/api/admin/v1/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:'123456'})});
  const cookie=login.headers.get('set-cookie');const {csrf}=await login.json();
  const result=await fetch(base+'/api/admin/v1/tunnel/install',{method:'POST',headers:{cookie,'x-coworker-csrf':csrf,'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(180000)});
  const installed=await result.json();assert.equal(result.status,200,JSON.stringify(installed));
  const {stdout}=await promisify(execFile)(installed.binaryPath,['--version'],{windowsHide:true,timeout:10000});
  assert.ok(stdout.trim().startsWith(installed.version.slice(1)), 'executable version differs from verified release');
  const help=await promisify(execFile)(installed.binaryPath,['run','--help'],{windowsHide:true,timeout:10000,maxBuffer:1024*1024});
  assert.match(help.stdout,/health.listen-addr/);
  console.log(JSON.stringify({status:'passed',source:'official OpenAI GitHub release with SHA256 verification',version:installed.version,adminHttpInstall:true,executableVersionVerified:true,runHealthFlagVerified:true,liveTunnelStarted:false}));
} finally {await app.close();await manager.stop();await rm(directory,{recursive:true,force:true});}
