import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildServer } from "../src/app.js";
import { LocalStore } from "../src/local-store.js";
import { WidgetBridge } from "../src/widget-bridge.js";
import { WIDGET_CHAT_POLICY } from "../src/widget-chat-policy.js";

async function waitForPending(bridge: WidgetBridge, expected = 1): Promise<void> {
  // Schema validation precedes queueing and runs in bounded worker threads.
  // A fixed 500 ms sleep is not evidence that that async phase completed.
  const deadline = performance.now() + 5000;
  while (bridge.pendingCount < expected && performance.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
  assert.ok(bridge.pendingCount >= expected, "Request did not reach the queue within the bounded preflight deadline");
}

test("MCP diagnostics identify bounded UI resource reads without recording secret URLs", () => {
  const bridge = new WidgetBridge();
  bridge.recordMcpRequest("resources/read", "ui://coworker/bridge.html");
  assert.equal(bridge.snapshot().mcp.lastRequestedResource, "ui://coworker/bridge.html");
  for (const uri of ["https://user:secret@example.com/widget", "ui://coworker/bridge.html?token=secret", "ui://coworker/bridge.html#secret", "ui://coworker/" + "a".repeat(200) + ".html"]) {
    bridge.recordMcpRequest("resources/read", uri);
    assert.equal(bridge.snapshot().mcp.lastRequestedResource, "redacted");
    assert.ok(!JSON.stringify(bridge.snapshot()).includes("secret"));
  }
  assert.equal(bridge.snapshot().mcp.resourcesRead, 5);
});

test("widget bridge returns a real text response through internal claim and submit", async () => {
  process.env.COWORKER_API_KEYS = "widget-client-key";
  const bridge = new WidgetBridge();
  const app = buildServer(bridge, "widget-bridge-secret");
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  const pendingAbort = new AbortController();
  let stage = "start";
  try {
    const beforeReady = await fetch(`${base}/health/inference`);
    assert.equal(beforeReady.status, 503);
    stage = "client request";
    const pending = fetch(`${base}/v1/responses`, {
      method: "POST", headers: { Authorization: "Bearer widget-client-key", "Content-Type": "application/json" },
      body: JSON.stringify({ model: "chatgpt-web", input: "hello" }), signal: pendingAbort.signal,
    });
    void pending.catch(() => {});
    await waitForPending(bridge);
    stage = "pending count";
    assert.equal(bridge.pendingCount, 1);
    assert.equal(bridge.snapshot().counts.queued, 1);
    assert.equal(bridge.snapshot().claimed, 0);
    const metrics = await (await fetch(`${base}/health/bridge`)).json();
    assert.equal(metrics.pending, 1);
    assert.ok(!JSON.stringify(metrics).includes("hello"));
    stage = "unauthorized";
    const unauthorized = await fetch(`${base}/internal/widget/claim`, { method: "POST" });
    assert.equal(unauthorized.status, 401);
    const headers = { Authorization: "Bearer widget-bridge-secret", "Content-Type": "application/json" };
    stage = "claim";
    const claimed = await fetch(`${base}/internal/widget/claim`, { method: "POST", headers, body: "{}" });
    assert.equal(claimed.status, 200);
    const afterReady = await fetch(`${base}/health/inference`);
    assert.equal(afterReady.status, 200);
    const turn = (await claimed.json()).turn as { request_id: string; prompt: string };
    assert.match(turn.prompt, /hello/);
    assert.equal(bridge.snapshot().claimed, 1);
    stage = "duplicate claim";
    const duplicate = await fetch(`${base}/internal/widget/claim`, { method: "POST", headers, body: "{}" });
    assert.equal((await duplicate.json()).turn, null);
    stage = "submit";
    const submitted = await fetch(`${base}/internal/widget/submit`, {
      method: "POST", headers, body: JSON.stringify({ request_id: turn.request_id, text: "answer from ChatGPT" }),
    });
    assert.equal(submitted.status, 200);
    stage = "response";
    const response = await pending;
    assert.equal(response.status, 200);
    assert.equal((await response.json()).output_text, "answer from ChatGPT");
    assert.equal(bridge.pendingCount, 0);
    assert.equal(bridge.snapshot().counts.submitted, 1);
  } catch (error) { throw new Error(`Widget test failed at ${stage}: ${String(error)}`); }
  finally { pendingAbort.abort(); app.server.closeAllConnections(); await app.close(); }
});

test("widget status poll keeps concurrent client turns serialized", async () => {
  process.env.COWORKER_API_KEYS = "widget-client-key";
  const bridge = new WidgetBridge();
  const app = buildServer(bridge, "widget-bridge-secret");
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  const headers = { Authorization: "Bearer widget-bridge-secret", "Content-Type": "application/json" };
  const controller = new AbortController();
  try {
    const send = (input: string) => fetch(`${base}/v1/responses`, { method: "POST", headers: { Authorization: "Bearer widget-client-key", "Content-Type": "application/json" }, body: JSON.stringify({ model: "chatgpt-web", input }), signal: controller.signal });
    const first = send("first");
    const second = send("second");
    void first.catch(() => {});
    void second.catch(() => {});
    await waitForPending(bridge, 2);
    assert.equal(bridge.pendingCount, 2);
    const claim = async (body: Record<string, unknown>) => (await fetch(`${base}/internal/widget/claim`, { method: "POST", headers, body: JSON.stringify(body) })).json();
    const claimed = (await claim({})).turn as { request_id: string; prompt: string };
    assert.match(claimed.prompt, /first/);
    const waiting = await claim({ active_request_id: claimed.request_id });
    assert.equal(waiting.active_pending, true);
    assert.equal(waiting.turn, null);
    const submitted = await fetch(`${base}/internal/widget/submit`, { method: "POST", headers, body: JSON.stringify({ request_id: claimed.request_id, text: "done" }) });
    assert.equal(submitted.status, 200);
    const settled = await claim({ active_request_id: claimed.request_id });
    assert.equal(settled.active_pending, false);
    assert.equal(settled.turn, null);
    const next = (await claim({})).turn as { prompt: string; request_id: string };
    assert.match(next.prompt, /second/);
    await fetch(`${base}/internal/widget/submit`, { method: "POST", headers, body: JSON.stringify({ request_id: next.request_id, text: "done too" }) });
    assert.equal((await (await first).json()).output_text, "done");
    assert.equal((await (await second).json()).output_text, "done too");
  } finally { controller.abort(); app.server.closeAllConnections(); await app.close(); }
});

test("large widget requests use a short follow-up and authenticated full-payload read", async () => {
  process.env.COWORKER_API_KEYS = "widget-client-key";
  const bridge = new WidgetBridge();
  const app = buildServer(bridge, "widget-bridge-secret");
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  const headers = { Authorization: "Bearer widget-bridge-secret", "Content-Type": "application/json" };
  const pendingAbort = new AbortController();
  try {
    const pending = fetch(`${base}/v1/responses`, {
      method: "POST", headers: { Authorization: "Bearer widget-client-key", "Content-Type": "application/json" },
      body: JSON.stringify({ model: "chatgpt-web", instructions: `Preserve ${"x".repeat(9_000)}`, input: "Create a file" }), signal: pendingAbort.signal,
    });
    void pending.catch(() => {});
    await waitForPending(bridge);
    const claim = await fetch(`${base}/internal/widget/claim`, { method: "POST", headers, body: "{}" });
    const turn = (await claim.json()).turn as { request_id: string; prompt: string };
    assert.ok(turn.prompt.includes(WIDGET_CHAT_POLICY));
    assert.ok(turn.prompt.length - WIDGET_CHAT_POLICY.length < 1_000);
    assert.match(turn.prompt, /workbench_api_read_request/);
    assert.ok(!turn.prompt.includes("x".repeat(100)));
    const denied = await fetch(`${base}/internal/widget/read`, { method: "POST", body: JSON.stringify({ request_id: turn.request_id }), headers: { "Content-Type": "application/json" } });
    assert.equal(denied.status, 401);
    const read = await fetch(`${base}/internal/widget/read`, { method: "POST", headers, body: JSON.stringify({ request_id: turn.request_id }) });
    assert.equal(read.status, 200);
    const full = await read.json() as { request_id: string; prompt: string };
    assert.equal(full.request_id, turn.request_id);
    assert.ok(full.prompt.includes("x".repeat(9_000)));
    assert.match(full.prompt, /Create a file/);
    await fetch(`${base}/internal/widget/submit`, { method: "POST", headers, body: JSON.stringify({ request_id: turn.request_id, text: "done" }) });
    assert.equal((await (await pending).json()).output_text, "done");
    const expired = await fetch(`${base}/internal/widget/read`, { method: "POST", headers, body: JSON.stringify({ request_id: turn.request_id }) });
    assert.equal(expired.status, 404);
  } finally { pendingAbort.abort(); app.server.closeAllConnections(); await app.close(); }
});

test("client disconnect removes a claimed widget turn before upstream timeout", async () => {
  process.env.COWORKER_API_KEYS = "widget-client-key";
  const bridge = new WidgetBridge();
  const app = buildServer(bridge, "widget-bridge-secret");
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  const client = new AbortController();
  try {
    const pending = fetch(`${base}/v1/responses`, {
      method: "POST", headers: { Authorization: "Bearer widget-client-key", "Content-Type": "application/json" },
      body: JSON.stringify({ model: "chatgpt-web", input: "hello" }), signal: client.signal,
    });
    void pending.catch(() => {});
    await waitForPending(bridge);
    assert.equal(bridge.pendingCount, 1);
    const headers = { Authorization: "Bearer widget-bridge-secret", "Content-Type": "application/json" };
    const claimed = await fetch(`${base}/internal/widget/claim`, { method: "POST", headers, body: "{}" });
    const turn = (await claimed.json()).turn as { request_id: string };
    client.abort();
    await assert.rejects(pending);
    for (let i = 0; bridge.isPending(turn.request_id) && i < 50; i++) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(bridge.pendingCount, 0);
    const expired = await fetch(`${base}/internal/widget/read`, { method: "POST", headers, body: JSON.stringify({ request_id: turn.request_id }) });
    assert.equal(expired.status, 404);
  } finally { client.abort(); app.server.closeAllConnections(); await app.close(); }
});

test("widget bridge returns client function calls without executing them", async () => {
  process.env.COWORKER_API_KEYS = "widget-client-key";
  const bridge = new WidgetBridge();
  const app = buildServer(bridge, "widget-bridge-secret");
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  const headers = { Authorization: "Bearer widget-bridge-secret", "Content-Type": "application/json" };
  const pendingAbort = new AbortController();
  try {
    const pending = fetch(`${base}/v1/responses`, {
      method: "POST", headers: { Authorization: "Bearer widget-client-key", "Content-Type": "application/json" },
      body: JSON.stringify({ model: "chatgpt-web", input: "Find the weather", tools: [{ type: "function", name: "get_weather", parameters: { type: "object", properties: { city: { type: "string" } } } }] }),
      signal: pendingAbort.signal,
    });
    void pending.catch(() => {});
    await waitForPending(bridge);
    assert.equal(bridge.pendingCount, 1);
    const claimed = await fetch(`${base}/internal/widget/claim`, { method: "POST", headers, body: "{}" });
    const turn = (await claimed.json()).turn as { request_id: string; prompt: string };
    assert.match(turn.prompt, /get_weather/);
    const rejected = await fetch(`${base}/internal/widget/submit`, { method: "POST", headers, body: JSON.stringify({ request_id: turn.request_id, tool_calls: [{ name: "other_tool", arguments: {} }] }) });
    assert.equal(rejected.status, 400);
    const accepted = await fetch(`${base}/internal/widget/submit`, { method: "POST", headers, body: JSON.stringify({ request_id: turn.request_id, tool_calls: [{ name: "get_weather", arguments: { city: "Paris" } }] }) });
    assert.equal(accepted.status, 200);
    const response = await pending;
    const data = await response.json();
    assert.equal(data.output[0].type, "function_call");
    assert.equal(data.output[0].name, "get_weather");
    assert.deepEqual(JSON.parse(data.output[0].arguments), { city: "Paris" });
  } finally { pendingAbort.abort(); app.server.closeAllConnections(); await app.close(); }
});

test("widget bridge maps Anthropic tool definitions to tool_use", async () => {
  process.env.COWORKER_API_KEYS = "widget-client-key";
  const bridge = new WidgetBridge();
  const app = buildServer(bridge, "widget-bridge-secret");
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  const headers = { Authorization: "Bearer widget-bridge-secret", "Content-Type": "application/json" };
  const pendingAbort = new AbortController();
  try {
    const pending = fetch(`${base}/v1/messages`, {
      method: "POST", headers: { "x-api-key": "widget-client-key", "Content-Type": "application/json" },
      body: JSON.stringify({ model: "chatgpt-web", max_tokens: 100, messages: [{ role: "user", content: "Use lookup" }], tools: [{ name: "lookup", description: "Look something up", input_schema: { type: "object", properties: { key: { type: "string" } } } }] }),
      signal: pendingAbort.signal,
    });
    void pending.catch(() => {});
    await waitForPending(bridge);
    const claimed = await fetch(`${base}/internal/widget/claim`, { method: "POST", headers, body: "{}" });
    const turn = (await claimed.json()).turn as { request_id: string; prompt: string };
    assert.ok(turn, "Queued request must be claimable before reading its prompt");
    assert.match(turn.prompt, /lookup/);
    const submitted = await fetch(`${base}/internal/widget/submit`, { method: "POST", headers, body: JSON.stringify({ request_id: turn.request_id, tool_calls: [{ name: "lookup", arguments: { key: "a" } }] }) });
    assert.equal(submitted.status, 200);
    const response = await pending;
    const data = await response.json();
    assert.equal(data.stop_reason, "tool_use");
    assert.equal(data.content[0].name, "lookup");
  } finally { pendingAbort.abort(); app.server.closeAllConnections(); await app.close(); }
});

test("buffered widget streams return HTTP 504 when no callback arrives", async () => {
  process.env.COWORKER_API_KEYS = "widget-client-key";
  const previousTimeout = process.env.COWORKER_BRIDGE_TIMEOUT_MS;
  process.env.COWORKER_BRIDGE_TIMEOUT_MS = "40";
  const directory = mkdtempSync(join(tmpdir(), "coworkerapi-timeout-"));
  const store = new LocalStore(join(directory, "state.json"));
  const app = buildServer(new WidgetBridge(), "widget-bridge-secret", store);
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  try {
    for (const [path, body] of [
      ["/v1/responses", { model: "chatgpt-web", input: "hello", stream: true }],
      ["/v1/chat/completions", { model: "chatgpt-web", messages: [{ role: "user", content: "hello" }], stream: true }],
      ["/v1/messages", { model: "chatgpt-web", max_tokens: 100, messages: [{ role: "user", content: "hello" }], stream: true }],
    ] as const) {
      const response = await fetch(`${base}${path}`, {
        method: "POST",
        headers: { Authorization: "Bearer widget-client-key", "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      assert.equal(response.status, 504, path);
      assert.match(response.headers.get("content-type") ?? "", /application\/json/);
      const data = await response.json() as { error: { type: string } };
      assert.equal(data.error.type, "upstream_timeout");
    }
    assert.equal(store.summary().errorsToday, 3);
  } finally {
    if (previousTimeout === undefined) delete process.env.COWORKER_BRIDGE_TIMEOUT_MS;
    else process.env.COWORKER_BRIDGE_TIMEOUT_MS = previousTimeout;
    app.server.closeAllConnections();
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
