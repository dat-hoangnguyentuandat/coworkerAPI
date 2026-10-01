import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { buildServer } from "../src/app.js";
import { WidgetBridge } from "../src/widget-bridge.js";

const expectedVersion = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
test("initialized gateway stays ready when widget upstream is disconnected; inference health is separate", async () => {
  const previous = process.env.COWORKER_API_KEYS; process.env.COWORKER_API_KEYS = "readiness-fixture";
  const app = buildServer(new WidgetBridge(), "readiness-internal-fixture");
  try {
    const ready = await app.inject({ method: "GET", url: "/health/ready" });
    assert.equal(ready.statusCode, 200); assert.deepEqual(ready.json(), { status: "ready" });
    const inference = await app.inject({ method: "GET", url: "/health/inference" });
    assert.equal(inference.statusCode, 503); assert.equal(inference.json().status, "widget_not_connected");
    const metadata = await app.inject({ method: "GET", url: "/version" });
    assert.equal(metadata.json().version, expectedVersion);
  } finally { await app.close(); if (previous === undefined) delete process.env.COWORKER_API_KEYS; else process.env.COWORKER_API_KEYS = previous; }
});
test("public version and liveness metadata do not require configured auth or upstream", async () => {
  const previous = process.env.COWORKER_API_KEYS; delete process.env.COWORKER_API_KEYS;
  const app = buildServer();
  try {
    const response = await app.inject({ method: "GET", url: "/version" });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { name: "CoworkerAPI", version: expectedVersion, protocols: { openaiResponses: true, openaiChatCompletions: true, anthropicMessages: true } });
    for (const url of ["/health", "/health/live"]) {
      const live = await app.inject({ method: "GET", url });
      assert.equal(live.statusCode, 200); assert.deepEqual(live.json(), { status: "ok" });
    }
    assert.equal((await app.inject({ method: "GET", url: "/health/ready" })).statusCode, 503);
    assert.equal((await app.inject({ method: "GET", url: "/v1/models" })).statusCode, 401);
  } finally { await app.close(); if (previous === undefined) delete process.env.COWORKER_API_KEYS; else process.env.COWORKER_API_KEYS = previous; }
});

test("compiled version metadata is package-derived even when launched from an empty cwd", async () => {
  const directory = await mkdtemp(join(tmpdir(), "coworkerapi-version-cwd-"));
  const appUrl = new URL("../dist/src/app.js", import.meta.url).href;
  const script = `import {buildServer} from ${JSON.stringify(appUrl)}; const app=buildServer(); const response=await app.inject({method:'GET',url:'/version'}); console.log(response.body); await app.close();`;
  const child = await promisify(execFile)(process.execPath, ["--input-type=module", "-e", script], { cwd: directory, windowsHide: true, timeout: 10_000 });
  assert.equal(JSON.parse(child.stdout.trim()).version, expectedVersion);
});
