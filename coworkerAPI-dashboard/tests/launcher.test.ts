import assert from "node:assert/strict";
import test from "node:test";
import { createServer, type RequestListener } from "node:http";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
// JavaScript launcher is shipped directly, outside the TypeScript server build.
// @ts-ignore
import { browserCommand, configDirectory, localBase, LauncherServer } from "../bin/launcher.mjs";

const bin = resolve("bin/coworkerapi.mjs");
test("launcher browser commands use argument arrays, including Termux", () => {
  const url = "http://127.0.0.1:3211/dashboard";
  assert.deepEqual(browserCommand(url, "linux", { TERMUX_VERSION: "0.118" }), ["termux-open-url", [url]]);
  assert.deepEqual(browserCommand(url, "linux", { PREFIX: "/data/data/com.termux/files/usr" }), ["termux-open-url", [url]]);
  assert.deepEqual(browserCommand(url, "win32", {}), ["rundll32.exe", ["url.dll,FileProtocolHandler", url]]);
  assert.deepEqual(browserCommand(url, "darwin", {}), ["open", [url]]);
  assert.deepEqual(browserCommand(url, "linux", {}), ["xdg-open", [url]]);
  assert.throws(() => browserCommand("https://example.com", "win32", {}));
  assert.throws(() => localBase({ PORT: "not-a-port" }));
  assert.equal(localBase({ HOST: "0.0.0.0", PORT: "3333" }), "http://127.0.0.1:3333");
});

test("no-terminal launcher prints help and does not initialize or start a service", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "coworkerapi-launcher-help-"));
  try {
    const output = execFileSync(process.execPath, [bin], { cwd, encoding: "utf8" });
    assert.match(output, /interactive terminal/);
    assert.match(execFileSync(process.execPath, [bin, "--help"], { cwd, encoding: "utf8" }), /Usage:/);
    assert.match(execFileSync(process.execPath, [bin, "version"], { cwd, encoding: "utf8" }), /CoworkerAPI \d/);
    assert.equal(configDirectory({ COWORKER_CONFIG_DIR: cwd }, "elsewhere"), cwd);
    assert.equal(configDirectory({ LOCALAPPDATA: cwd }, cwd), join(cwd, "coworkerapi"));
  } finally { await rm(cwd, { recursive: true, force: true }); }
});

async function fixture(handler: RequestListener) {
  const server = createServer(handler);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return { server, base: `http://127.0.0.1:${address.port}`, port: address.port };
}

test("launcher reuses an existing CoworkerAPI without stopping it on exit", async () => {
  const { server, base } = await fixture((_req, res) => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ name: "CoworkerAPI" })); });
  const manager = new LauncherServer({ base, bin, cwd: process.cwd() });
  try {
    await manager.start();
    assert.equal(manager.child, undefined);
    await manager.close();
    assert.equal((await fetch(`${base}/version`)).status, 200);
  } finally { server.closeAllConnections(); await new Promise<void>((r) => server.close(() => r())); }
});

test("launcher refuses an unrelated occupied port", async () => {
  const { server, base } = await fixture((_req, res) => { res.end("another app"); });
  const manager = new LauncherServer({ base, bin, cwd: process.cwd() });
  try {
    await assert.rejects(manager.start(), /occupied/);
    assert.equal(manager.child, undefined);
  } finally { await manager.close(); server.closeAllConnections(); await new Promise<void>((r) => server.close(() => r())); }
});

test("launcher starts a real isolated server and stops only its owned child", async () => {
  const temp = await mkdtemp(join(tmpdir(), "coworkerapi-launcher-owned-"));
  const reservation = await fixture((_req, res) => res.end());
  reservation.server.closeAllConnections();
  await new Promise<void>((r) => reservation.server.close(() => r()));
  const env = { ...process.env, HOST: "127.0.0.1", PORT: String(reservation.port), COWORKER_UPSTREAM: "widget", COWORKER_MCP_SECRET: "launcher-isolated-test", COWORKER_DATA_DIR: temp, COWORKER_ADMIN_ALLOW_REMOTE: "false", COWORKER_ADMIN_PASSWORD: "123456", COWORKER_TUNNEL_BIN: "", COWORKER_TUNNEL_ID: "", COWORKER_TUNNEL_API_KEY: "" };
  const manager = new LauncherServer({ base: reservation.base, bin, cwd: temp, env });
  try {
    await manager.start();
    assert.ok(manager.child?.pid);
    assert.equal(await manager.healthy(), true);
    assert.equal((await fetch(`${reservation.base}/dashboard`)).status, 200);
    await manager.close();
    assert.equal(await manager.healthy(), false);
    await assert.rejects(manager.start(), /closing/);
  } finally { await manager.close(); await rm(temp, { recursive: true, force: true }); }
});

test("launcher reports failed startup and cleans up the child", async () => {
  const temp = await mkdtemp(join(tmpdir(), "coworkerapi-launcher-fail-"));
  const reservation = await fixture((_req, res) => res.end());
  await new Promise<void>((r) => reservation.server.close(() => r()));
  const manager = new LauncherServer({ base: reservation.base, bin: join(temp, "missing.mjs"), cwd: temp });
  try {
    await assert.rejects(manager.start(), /did not start/);
    assert.equal(manager.child, undefined);
  } finally { await manager.close(); await rm(temp, { recursive: true, force: true }); }
});
