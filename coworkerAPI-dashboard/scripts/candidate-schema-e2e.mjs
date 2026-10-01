#!/usr/bin/env node
// Installed-package schema checks over real HTTP/MCP with simulated model callbacks.
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, writeFile, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const root = resolve(process.argv[2] ?? ".");
const { buildServer } = await import(pathToFileURL(join(root, "dist/src/app.js")));
const { WidgetBridge } = await import(pathToFileURL(join(root, "dist/src/widget-bridge.js")));
const previous = process.env.COWORKER_API_KEYS;
const previousMcp = process.env.COWORKER_MCP_SECRET;
const apiKey = randomBytes(32).toString("hex"), mcpKey = randomBytes(32).toString("hex");
process.env.COWORKER_API_KEYS = apiKey;
process.env.COWORKER_MCP_SECRET = mcpKey;
const bridge = new WidgetBridge(); const app = buildServer(bridge, mcpKey);
const report = { startedAt: new Date().toISOString(), packageRoot: root, upstream: "simulated model callbacks via MCP HTTP, not ChatGPT", status: "failed", checks: [] };
let client;
try {
  report.phase = "dependency_resolution_from_empty_cwd";
  const emptyCwd = await mkdtemp(join(tmpdir(), "coworkerapi-worker-cwd-"));
  const workerModule = pathToFileURL(join(root, "dist/src/tool-schema.js")).href;
  const probe = `import {checkToolSchemas} from ${JSON.stringify(workerModule)}; if (!await checkToolSchemas([{schema:{type:'object',properties:{value:{type:'string'}},required:['value']},arguments:{value:'fixture'}}])) process.exit(1); console.log('verified');`;
  const child = await promisify(execFile)(process.execPath, ["--input-type=module", "-e", probe], { cwd: emptyCwd, windowsHide: true, timeout: 10_000 });
  assert.equal(child.stdout.trim(), "verified");
  report.checks.push({ name: "installed_worker_resolves_dependencies_from_empty_cwd", passed: true });
  await app.listen({ host: "127.0.0.1", port: 0 });
  report.phase = "mcp_connect";
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const installedVersion = JSON.parse(await readFile(join(root, "package.json"), "utf8")).version;
  const versionResponse = await fetch(base + "/version");
  assert.equal(versionResponse.status, 200);
  assert.equal((await versionResponse.json()).version, installedVersion);
  assert.equal((await fetch(base + "/health")).status, 200);
  assert.equal((await fetch(base + "/health/ready")).status, 200);
  assert.equal((await fetch(base + "/health/inference")).status, 503);
  report.checks.push({ name: "installed_version_and_separate_gateway_provider_health", passed: true });
  client = new Client({ name: "candidate-schema-e2e", version: "1" });
  await client.connect(new StreamableHTTPClientTransport(new URL(base + "/mcp"), { requestInit: { headers: { authorization: `Bearer ${mcpKey}` } } }));
  const poll = { runtime_version: "bridge-v5", widget_id: randomUUID() };
  const headers = { authorization: `Bearer ${apiKey}`, "content-type": "application/json" };
  const schema = { type: "object", properties: { path: { type: "string", minLength: 1 }, mode: { enum: ["read", "write"] } }, required: ["path", "mode"], additionalProperties: false };
  for (const protocol of ["responses", "chat", "anthropic"]) for (const stream of [false, true]) {
    report.phase = protocol + (stream ? "_sse" : "_json");
    const path = protocol === "responses" ? "/v1/responses" : protocol === "chat" ? "/v1/chat/completions" : "/v1/messages";
    const tool = protocol === "anthropic" ? { name: "file", input_schema: schema } : protocol === "chat" ? { type: "function", function: { name: "file", parameters: schema } } : { type: "function", name: "file", parameters: schema };
    const payload = { model: "chatgpt-web", stream, tools: [tool], ...(protocol === "responses" ? { input: "schema fixture" } : { messages: [{ role: "user", content: "schema fixture" }], max_tokens: 100 }) };
    const pending = fetch(base + path, { method: "POST", headers, body: JSON.stringify(payload), signal: AbortSignal.timeout(20_000) });
    let turn;
    for (let i = 0; i < 300 && !turn; i++) {
      turn = (await client.callTool({ name: "workbench_api_poll", arguments: poll })).structuredContent.turn;
      if (!turn) await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.ok(turn);
    const ack = await client.callTool({ name: "workbench_api_poll", arguments: { ...poll, active_request_id: turn.request_id, claim_lease_id: turn.claim_lease_id, delivery: "send_started" } });
    assert.equal(ack.structuredContent.delivery_permitted, true);
    for (const invalid of [{ path: "index.html", mode: "delete" }, { path: "index.html" }, { path: 7, mode: "read" }, { path: "index.html", mode: "read", extra: true }]) {
      const submit = await client.callTool({ name: "workbench_api_submit", arguments: { request_id: turn.request_id, tool_calls: [{ name: "file", arguments: invalid }] } });
      assert.equal(submit.structuredContent.status, "invalid_result");
      assert.equal(bridge.pendingCount, 1);
    }
    const submit = await client.callTool({ name: "workbench_api_submit", arguments: { request_id: turn.request_id, tool_calls: [{ name: "file", arguments: { path: "index.html", mode: "read" } }] } });
    assert.equal(submit.structuredContent.status, "accepted");
    const response = await pending; assert.equal(response.status, 200);
    const body = await response.text(); assert.ok(body.includes("file") && body.includes("index.html"));
    assert.equal(bridge.pendingCount, 0);
    report.checks.push({ protocol, stream, name: "invalid_args_rejected_then_correct_callback_completes", passed: true });
    const malformed = structuredClone(payload);
    if (protocol === "anthropic") malformed.tools[0].input_schema = { type: "not-a-type" };
    else if (protocol === "chat") malformed.tools[0].function.parameters = { type: "not-a-type" };
    else malformed.tools[0].parameters = { type: "not-a-type" };
    const rejected = await fetch(base + path, { method: "POST", headers, body: JSON.stringify(malformed) });
    assert.equal(rejected.status, 400); assert.equal((await rejected.json()).error.code, "invalid_tool_schema");
    assert.equal(bridge.pendingCount, 0);
    report.checks.push({ protocol, stream, name: "malformed_schema_rejected_before_queue", passed: true });
  }
  report.status = "passed";
} catch { report.failure = "Installed schema verification failed; no credentials, prompts or callback arguments are recorded."; process.exitCode = 1; }
finally {
  await client?.close().catch(() => {}); bridge.shutdown(); await app.close();
  if (previous === undefined) delete process.env.COWORKER_API_KEYS; else process.env.COWORKER_API_KEYS = previous;
  if (previousMcp === undefined) delete process.env.COWORKER_MCP_SECRET; else process.env.COWORKER_MCP_SECRET = previousMcp;
  report.finishedAt = new Date().toISOString(); await mkdir("artifacts", { recursive: true });
  await writeFile(join("artifacts", `candidate-schema-e2e-${report.startedAt.replace(/[:.]/g, "-")}.json`), JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify(report));
}
