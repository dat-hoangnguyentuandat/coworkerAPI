import assert from "node:assert/strict";
import test from "node:test";
import { spawn, execFileSync } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

async function availablePort(): Promise<number> {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const port = address.port;
  server.close();
  await once(server, "close");
  return port;
}

test("packaged launcher serves standalone dashboard and MCP without Coworker", async () => {
  const port = await availablePort();
  const dataDir = await mkdtemp(join(tmpdir(), "coworkerapi-standalone-test-"));
  const bin = resolve(dirname(fileURLToPath(import.meta.url)), "../bin/coworkerapi.mjs");
  execFileSync(process.execPath, [bin, "init"], { cwd: dataDir, stdio: "pipe" });
  const config = await readFile(join(dataDir, ".env"), "utf8");
  assert.match(config, /COWORKER_MCP_SECRET=[A-Za-z0-9_-]{43}/);
  assert.match(config, /MASTER_ENCRYPTION_KEY=[a-f0-9]{64}/);
  execFileSync(process.execPath, [bin, "init"], { cwd: dataDir, stdio: "pipe" });
  assert.equal(await readFile(join(dataDir, ".env"), "utf8"), config);
  const env: NodeJS.ProcessEnv = { ...process.env, HOST: "127.0.0.1", PORT: String(port), COWORKER_UPSTREAM: "widget", COWORKER_MCP_SECRET: "standalone-test-secret", COWORKER_DATA_DIR: dataDir, COWORKER_ADMIN_ALLOW_REMOTE: "false", COWORKER_ADMIN_PASSWORD: "" };
  for (const name of ["COWORKER_TUNNEL_BIN", "COWORKER_TUNNEL_ID", "COWORKER_TUNNEL_API_KEY", "COWORKER_API_KEYS"]) delete env[name];
  const child = spawn(process.execPath, [bin, "start"], { cwd: dataDir, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.resume();
  child.stderr.resume();
  const base = `http://127.0.0.1:${port}`;
  try {
    let live: Response | undefined;
    for (let i = 0; i < 100; i++) {
      if (child.exitCode !== null) throw new Error(`Standalone launcher exited with code ${child.exitCode}`);
      try { live = await fetch(`${base}/health/live`, { signal: AbortSignal.timeout(200) }); break; }
      catch { await new Promise((resolve) => setTimeout(resolve, 50)); }
    }
    assert.equal(live?.status, 200);
    const dashboard = await fetch(`${base}/dashboard`);
    assert.equal(dashboard.status, 200);
    assert.match(await dashboard.text(), /CoworkerAPI/);
    const mcp = await fetch(`${base}/mcp`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    assert.equal(mcp.status, 401);
    const tunnel = await fetch(`${base}/health/tunnel`);
    assert.deepEqual(await tunnel.json(), { state: "disabled", message: "Tunnel is not configured." });
    const models = await fetch(`${base}/v1/models`);
    assert.equal(models.status, 401);
  } finally {
    child.kill();
    if (child.exitCode === null) await Promise.race([once(child, "exit"), new Promise((resolve) => setTimeout(resolve, 5_000))]);
    await rm(dataDir, { recursive: true, force: true });
  }
});
