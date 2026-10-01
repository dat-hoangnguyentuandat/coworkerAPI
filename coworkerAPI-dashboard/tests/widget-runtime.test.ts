import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { createContext, Script } from "node:vm";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { buildServer } from "../src/app.js";
import { WidgetBridge } from "../src/widget-bridge.js";
import { WIDGET_HTML, WIDGET_URI } from "../src/widget-mcp.js";

for (const stage of ["sync_throw", "async_reject", "deadline"] as const) {
  test(`widget reports metadata-only host failure stage ${stage}`, async () => {
    const script = WIDGET_HTML.match(/<script>([\s\S]*?)<\/script>/)![1];
    const reports: Record<string, unknown>[] = [];
    const timers: { callback: () => void; delay: number }[] = [];
    const status = { textContent: "" };
    const state: unknown[] = [];
    const request = randomUUID(), lease = randomUUID();
    const browser = createContext({
      crypto: { randomUUID }, document: { getElementById: () => status },
      setTimeout(callback: () => void, delay: number) { timers.push({ callback, delay }); }, clearTimeout() {},
      window: { openai: {
        setWidgetState: (value: unknown) => state.push(value),
        callTool: async (_name: string, args: Record<string, unknown>) => {
          reports.push(args);
          return { structuredContent: args.active_request_id ? { active_pending: true, delivery_permitted: args.delivery === "send_started", delivery_state: "sending" }
            : { turn: { request_id: request, claim_lease_id: lease, delivery_state: "reserved", prompt: "PRIVATE_PAYLOAD" } } };
        },
        sendFollowUpMessage: () => {
          if (stage === "sync_throw") throw new Error("PRIVATE_EXCEPTION");
          if (stage === "async_reject") return Promise.reject(new Error("PRIVATE_EXCEPTION"));
          return new Promise(() => {});
        },
      } },
    });
    new Script(script).runInContext(browser);
    await new Script("loop()").runInContext(browser);
    if (stage === "deadline") timers.find(timer => timer.delay === 20_000)!.callback();
    for (let i = 0; i < 35; i++) await Promise.resolve();
    const failures = reports.filter(report => report.failure_stage);
    assert.equal(failures.length, 1);
    assert.equal(failures[0].failure_stage, stage);
    assert.equal(failures[0].delivery, stage === "deadline" ? "send_unknown" : "send_failed");
    assert.ok(!JSON.stringify({ reports, state, status }).includes("PRIVATE_EXCEPTION"));
    assert.ok(!JSON.stringify({ reports, state, status }).includes("PRIVATE_PAYLOAD"));
  });
}

test("unknown delivery remains visible across polling and restored renders without resend", async () => {
  const script = WIDGET_HTML.match(/<script>([\s\S]*?)<\/script>/)![1];
  const status = { textContent: "" };
  let sends = 0;
  let polls = 0;
  const browser = createContext({
    crypto: { randomUUID }, document: { getElementById: () => status },
    setTimeout() {}, clearTimeout() {},
    window: { openai: {
      widgetState: { version: "bridge-v8", widgetId: randomUUID(), activeRequest: randomUUID(), leaseId: randomUUID(), phase: "unknown", attempts: 1 },
      setWidgetState() {},
      callTool: async () => { polls++; return { structuredContent: { active_pending: true, delivery_state: "unknown", delivery_permitted: false } }; },
      sendFollowUpMessage: async () => { sends++; },
    } },
  });
  new Script(script).runInContext(browser);
  for (let i = 0; i < 3; i++) {
    await new Script("loop()").runInContext(browser);
    assert.equal(status.textContent, "Delivery not confirmed. Waiting for callback; no automatic resend.");
  }
  assert.equal(polls, 3);
  assert.equal(sends, 0);
});

test("callback completion cannot dispatch the next request before the previous host send settles", async () => {
  const script = WIDGET_HTML.match(/<script>([\s\S]*?)<\/script>/)![1];
  let sends = 0, claims = 0;
  let finishHost!: () => void;
  const previousHost = new Promise<void>(yes => { finishHost = yes; });
  const status = { textContent: "" };
  const browser = createContext({
    crypto: { randomUUID }, document: { getElementById: () => status },
    setTimeout() {}, clearTimeout() {},
    window: { openai: {
      setWidgetState() {},
      callTool: async (_name: string, args: Record<string, unknown>) => ({ structuredContent: args.heartbeat_only ? { turn: null } : args.active_request_id
        ? { active_pending: args.delivery === "send_started", delivery_permitted: args.delivery === "send_started" }
        : (claims++, { turn: { request_id: randomUUID(), claim_lease_id: randomUUID(), delivery_state: "reserved", prompt: "test" } }) }),
      sendFollowUpMessage: () => { sends++; return sends === 1 ? previousHost : Promise.resolve(); },
    } },
  });
  new Script(script).runInContext(browser);
  await new Script("loop()").runInContext(browser);
  await new Script("loop()").runInContext(browser); // model callback removed the old request
  new Script("nextAllowedAt = 0").runInContext(browser);
  await new Script("loop()").runInContext(browser);
  assert.equal(claims, 1);
  assert.equal(sends, 1);
  assert.match(status.textContent, /No overlapping dispatch/);
  await new Script("heartbeatLoop()").runInContext(browser);
  assert.equal(claims, 1, "Heartbeat must remain independent without claiming");
  finishHost();
  for (let i = 0; i < 20; i++) await Promise.resolve();
  await new Script("loop()").runInContext(browser);
  assert.equal(claims, 2);
  assert.equal(sends, 2);
});

test("missing host message capability cannot produce a misleading ready heartbeat", async () => {
  const script = WIDGET_HTML.match(/<script>([\s\S]*?)<\/script>/)![1];
  let polls = 0;
  const status = { textContent: "" };
  const browser = createContext({
    crypto: { randomUUID }, document: { getElementById: () => status },
    setTimeout() {}, clearTimeout() {},
    window: { openai: { callTool: async () => { polls++; return { structuredContent: { turn: null } }; } } },
  });
  new Script(script).runInContext(browser);
  await new Script("loop()").runInContext(browser);
  await new Script("heartbeatLoop()").runInContext(browser);
  assert.equal(polls, 0);
  assert.match(status.textContent, /does not expose the required/);
});

test("hung host send keeps independent heartbeat and poll live, becomes unknown, resumes without duplicate, and accepts late success", async (t) => {
  let now = 100_000;
  t.mock.method(Date, "now", () => now);
  const script = WIDGET_HTML.match(/<script>([\s\S]*?)<\/script>/)![1];
  const bridge = new WidgetBridge(0);
  const controller = new AbortController();
  const iterator = bridge.respond({ model: "chatgpt-web", input: "test", stream: false }, controller.signal)[Symbol.asyncIterator]();
  const pending = iterator.next();
  let state: Record<string, unknown> = {};
  let sends = 0;
  let accept!: () => void;
  const host = new Promise<void>(resolve => { accept = resolve; });
  const timers: { callback: () => void; delay: number; cleared?: boolean }[] = [];
  function render() {
    const browser = createContext({
      crypto: { randomUUID }, document: { getElementById: () => ({ textContent: "" }) },
      setTimeout(callback: () => void, delay: number) { const timer = { callback, delay }; timers.push(timer); return timer; },
      clearTimeout(timer: { cleared?: boolean }) { timer.cleared = true; },
      window: { openai: {
        widgetState: state, setWidgetState: (value: Record<string, unknown>) => { state = JSON.parse(JSON.stringify(value)); },
        callTool: async (_name: string, args: { active_request_id?: string; widget_id: string; claim_lease_id: string; heartbeat_only?: boolean; delivery?: "send_started" | "send_unknown" | "sent" | "reminder" | "ack_seen" | "host_invoked" }) => {
          bridge.heartbeat("bridge-v5");
          return { structuredContent: args.heartbeat_only ? { turn: null, active_pending: false } : args.active_request_id
            ? bridge.leasedStatus(args.active_request_id, args.widget_id, args.claim_lease_id, args.delivery)
            : { turn: bridge.claim("bridge-v5", args.widget_id) } };
        },
        sendFollowUpMessage: () => { sends++; return host; },
      } },
    });
    new Script(script).runInContext(browser);
    return browser;
  }
  const first = render();
  const loop = new Script("loop()").runInContext(first);
  for (let i = 0; i < 100 && sends === 0; i++) await Promise.resolve();
  assert.equal(sends, 1);
  await loop;
  assert.equal(new Script("running").runInContext(first), false, "Host promise must not hold the poll lock");
  now += 15_000;
  assert.equal(bridge.active, false);
  await new Script("heartbeatLoop()").runInContext(first);
  assert.equal(bridge.active, true);
  assert.equal(bridge.snapshot().counts.claimed, 1, "Independent heartbeat must never claim another turn");
  await new Script("loop()").runInContext(first);
  assert.equal(sends, 1, "Normal polls during host generation must not resend");
  const deadline = timers.find(timer => timer.delay === 20_000 && !timer.cleared)!;
  assert.ok(deadline); deadline.callback();
  for (let i = 0; i < 30; i++) await Promise.resolve();
  assert.equal(state.phase, "unknown");
  assert.equal(new Script("running").runInContext(first), false);
  assert.equal(bridge.snapshot().dispatch.unknown, 1);
  assert.ok(!JSON.stringify(state).includes("prompt"));
  const second = render();
  await new Script("loop()").runInContext(second);
  assert.equal(sends, 1);
  accept();
  for (let i = 0; i < 20; i++) await Promise.resolve();
  await new Script("loop()").runInContext(second);
  assert.equal(sends, 1);
  assert.equal(bridge.snapshot().counts.delivered, 1);
  controller.abort(); await pending;
});

test("hung MCP poll releases the loop lock and stale send permission never invokes the host", async () => {
  const script = WIDGET_HTML.match(/<script>([\s\S]*?)<\/script>/)![1];
  let hung = true, sends = 0;
  const timers: { callback: () => void; delay: number }[] = [];
  const browser = createContext({
    crypto: { randomUUID }, document: { getElementById: () => ({ textContent: "" }) },
    setTimeout(callback: () => void, delay: number) { timers.push({ callback, delay }); return timers.length; }, clearTimeout() {},
    window: { openai: {
      callTool: (_name: string, args: { active_request_id?: string }) => hung ? new Promise(() => {}) : Promise.resolve({ structuredContent: args.active_request_id
        ? { active_pending: false, delivery_permitted: false }
        : { turn: { request_id: randomUUID(), claim_lease_id: randomUUID(), delivery_state: "reserved", prompt: "test" } } }),
      sendFollowUpMessage: async () => { sends++; },
    } },
  });
  new Script(script).runInContext(browser);
  const first = new Script("loop()").runInContext(browser);
  for (let i = 0; i < 5; i++) await Promise.resolve();
  timers.find(timer => timer.delay === 10_000)!.callback(); await first;
  assert.equal(new Script("running").runInContext(browser), false);
  hung = false;
  await new Script("loop()").runInContext(browser);
  assert.equal(sends, 0);
});

test("widget does not resend a rejected follow-up and suppresses stale reminders", async () => {
  const script = WIDGET_HTML.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script);
  let now = 0;
  let attempts = 0;
  let pending = true;
  let deliveryState = "reserved";
  const deliveries: string[] = [];
  const timers: { callback: () => unknown; delay: number }[] = [];
  const requestId = "00000000-0000-4000-8000-000000000001";
  const browser = createContext({
    crypto: { randomUUID },
    clearTimeout() {},
    document: { getElementById: () => ({ textContent: "" }) },
    Date: { now: () => now },
    setTimeout: (callback: () => unknown, delay: number) => timers.push({ callback, delay }),
    window: { openai: {
      callTool: async (_name: string, args: { active_request_id?: string; delivery?: string }) => {
        if (args.delivery) {
          deliveries.push(args.delivery);
          if (args.delivery === "send_started") deliveryState = "sending";
          if (args.delivery === "send_failed") deliveryState = "unknown";
          if (args.delivery === "sent") throw new Error("Diagnostic reporting temporarily unavailable");
        }
        return { structuredContent: args.active_request_id ? { active_pending: pending, delivery_state: deliveryState, delivery_permitted: args.delivery === "send_started" } : { turn: { request_id: requestId, claim_lease_id: "00000000-0000-4000-8000-000000000002", delivery_state: deliveryState, prompt: `request_id=${requestId} test request` } } };
      },
      sendFollowUpMessage: async () => { attempts++; if (attempts === 1) throw new Error("Host is busy"); },
    } },
  });
  new Script(script).runInContext(browser);
  await new Script("loop()").runInContext(browser);
  for (let i = 0; i < 30; i++) await Promise.resolve();
  assert.equal(attempts, 1);
  assert.deepEqual(deliveries, ["send_started", "ack_seen", "host_invoked", "send_failed"]);
  now = 31_000;
  await new Script("loop()").runInContext(browser);
  for (let i = 0; i < 30; i++) await Promise.resolve();
  assert.equal(attempts, 1);
  assert.deepEqual(deliveries, ["send_started", "ack_seen", "host_invoked", "send_failed"]);
  now = 62_000;
  await new Script("loop()").runInContext(browser);
  assert.equal(attempts, 1, "A rejected promise must not authorize duplicate delivery");
  pending = false;
  now = 100_000;
  await new Script("loop()").runInContext(browser);
  assert.equal(attempts, 1, "Do not remind ChatGPT about a completed or cancelled request");
});

for (const transport of ["openai-alias", "mcp-apps"] as const) {
test(`widget ${transport} completes an Anthropic file tool loop through standalone MCP HTTP (model simulated)`, async () => {
  const previousKeys = process.env.COWORKER_API_KEYS;
  const previousSecret = process.env.COWORKER_MCP_SECRET;
  process.env.COWORKER_API_KEYS = "runtime-api-test-key";
  process.env.COWORKER_MCP_SECRET = "runtime-mcp-test-secret";
  const directory = await mkdtemp(join(tmpdir(), "coworkerapi-widget-runtime-"));
  const bridge = new WidgetBridge();
  const app = buildServer(bridge, "unused-internal-secret");
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  const client = new Client({ name: "widget-runtime-test", version: "1" });
  const calls: string[] = [];
  const timers: Array<() => unknown> = [];
  const status = { textContent: "" };
  let modelTurns = 0;
  const html = "<!doctype html><title>CoworkerAPI test</title><h1>Hello</h1>";
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { Authorization: "Bearer runtime-mcp-test-secret" } } }));
    const resource = await client.readResource({ uri: WIDGET_URI });
    const first = resource.contents[0];
    assert.ok(first && "text" in first);
    const script = first.text.match(/<script>([\s\S]*?)<\/script>/)?.[1];
    assert.ok(script);
    let listener!: (event: { source: unknown; data: Record<string, unknown> }) => void;
    const parent = { postMessage: (message: { method: string; id?: number; params?: { name: string; arguments: Record<string, unknown> } }) => {
      if (message.method === "ui/notifications/initialized") return;
      const result = message.method === "ui/initialize"
        ? Promise.resolve({ protocolVersion: "2026-01-26" })
        : (calls.push(message.params!.name), client.callTool({ name: message.params!.name, arguments: message.params!.arguments }));
      void result.then(value => listener({ source: parent, data: { jsonrpc: "2.0", id: message.id, result: value } }), () => listener({ source: parent, data: { jsonrpc: "2.0", id: message.id, error: { code: -32603 } } }));
    } };
    const browser = createContext({
      crypto: { randomUUID },
      clearTimeout() {},
      document: { getElementById: () => status },
      Date: { now: () => Date.now() + 60_000 },
      setTimeout: (callback: () => unknown) => { timers.push(callback); },
      window: { ...(transport === "mcp-apps" ? { parent, addEventListener: (_name: string, callback: typeof listener) => { listener = callback; } } : {}), openai: {
        callTool: async (name: string, args: Record<string, unknown>) => { assert.equal(transport, "openai-alias", "Standard transport must not fall back after a dispatched tool call"); calls.push(name); return client.callTool({ name, arguments: args }); },
        sendFollowUpMessage: async ({ prompt }: { prompt: string }) => {
          const id = prompt.match(/request_id=([a-f0-9-]{36})/)?.[1];
          assert.ok(id);
          modelTurns++;
          if (modelTurns === 1) {
            assert.match(prompt, /Write/);
            const result = await client.callTool({ name: "workbench_api_submit", arguments: { request_id: id, tool_calls: [{ name: "Write", arguments: { file_path: "index.html", content: html } }] } });
            assert.deepEqual(result.structuredContent, { status: "accepted" });
          } else {
            assert.match(prompt, /tool_result/);
            assert.match(prompt, /File created successfully/);
            await client.callTool({ name: "workbench_api_submit", arguments: { request_id: id, text: "Created index.html successfully." } });
          }
        },
      } },
    });
    new Script(script).runInContext(browser);
    const headers = { "x-api-key": "runtime-api-test-key", "Content-Type": "application/json" };
    const messages: unknown[] = [{ role: "user", content: "Create index.html with a Hello heading." }];
    const body = { model: "chatgpt-web", max_tokens: 1000, messages, tools: [{ name: "Write", description: "Write a file", input_schema: { type: "object", properties: { file_path: { type: "string" }, content: { type: "string" } }, required: ["file_path", "content"] } }] };
    const request = fetch(`${base}/v1/messages`, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(10_000) });
    for (let i = 0; bridge.pendingCount === 0 && i < 100; i++) await new Promise((resolve) => setTimeout(resolve, 10));
    await new Script("loop()").runInContext(browser);
    const response = await request;
    assert.equal(response.status, 200);
    const answer = await response.json();
    assert.equal(answer.stop_reason, "tool_use");
    const tool = answer.content[0];
    assert.equal(tool.name, "Write");
    assert.equal(tool.input.file_path, "index.html");
    await writeFile(join(directory, "index.html"), tool.input.content);
    assert.equal(await readFile(join(directory, "index.html"), "utf8"), html);
    messages.push({ role: "assistant", content: answer.content }, { role: "user", content: [{ type: "tool_result", tool_use_id: tool.id, content: "File created successfully" }] });
    const continuation = fetch(`${base}/v1/messages`, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(10_000) });
    for (let i = 0; bridge.pendingCount === 0 && i < 100; i++) await new Promise((resolve) => setTimeout(resolve, 10));
    await new Script("loop()").runInContext(browser);
    new Script("nextAllowedAt = 0").runInContext(browser);
    await new Script("loop()").runInContext(browser);
    const final = await continuation;
    assert.equal(final.status, 200);
    const finalBody = await final.json();
    assert.equal(finalBody.stop_reason, "end_turn");
    assert.equal(finalBody.content[0].text, "Created index.html successfully.");
    assert.equal(modelTurns, 2);
    assert.equal(bridge.pendingCount, 0);
    assert.ok(calls.every((name) => name === "workbench_api_poll"));
    assert.ok(bridge.snapshot().hostTransports[transport] > 0);
    assert.equal(bridge.snapshot().runtime.last, "bridge-v8");
  } finally {
    bridge.shutdown();
    await client.close();
    app.server.closeAllConnections();
    await app.close();
    await rm(directory, { recursive: true, force: true });
    if (previousKeys === undefined) delete process.env.COWORKER_API_KEYS;
    else process.env.COWORKER_API_KEYS = previousKeys;
    if (previousSecret === undefined) delete process.env.COWORKER_MCP_SECRET;
    else process.env.COWORKER_MCP_SECRET = previousSecret;
  }
});
}
