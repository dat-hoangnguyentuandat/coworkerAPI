import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { LocalStore } from "../src/local-store.js";
import { WidgetBridge } from "../src/widget-bridge.js";
import { buildServer } from "../src/app.js";
import { AnthropicProviderBridge } from "../src/anthropic-provider.js";
import type { BridgeEvent } from "../src/protocol.js";

test("native Messages preserves payload/blocks and streams one lifecycle incrementally with sanitized failures", async () => {
  const previous = process.env.ALLOW_PRIVATE_UPSTREAMS; process.env.ALLOW_PRIVATE_UPSTREAMS = "true";
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  let observed: Record<string, any> = {};
  const raw = { id: "msg_fixture", type: "message", role: "assistant", model: "upstream-claude", content: [{ type: "thinking", thinking: "reason", signature: "signed" }, { type: "text", text: "hello", citations: [] }, { type: "tool_use", id: "call_a", name: "read", input: { path: "index.html" } }], stop_reason: "tool_use", stop_sequence: null, usage: { input_tokens: 5, output_tokens: 12, cache_read_input_tokens: 3 }, vendor: "retained" };
  const fixture = createServer(async (request, reply) => {
    assert.equal(request.url, "/v1/messages"); assert.equal(request.headers["x-api-key"], "anthropic-fixture-key");
    assert.equal(request.headers["anthropic-version"], "2023-06-01"); assert.equal(request.headers.authorization, undefined);
    let body = ""; for await (const chunk of request) body += chunk; observed = JSON.parse(body);
    if (!observed.stream) { reply.setHeader("content-type", "application/json"); reply.end(JSON.stringify(raw)); return; }
    reply.setHeader("content-type", "text/event-stream");
    const send = (value: Record<string, unknown>) => reply.write(`event: ${value.type}\ndata: ${JSON.stringify(value)}\n\n`);
    const mode = observed.metadata?.mode;
    if (mode === "error") { send({ type: "error", error: { message: "anthropic-fixture-key" } }); reply.end(); return; }
    if (mode === "stop_without_start") { send({ type: "message_stop" }); reply.end(); return; }
    send({ type: "message_start", message: { ...raw, content: [], stop_reason: null, usage: { input_tokens: 5, output_tokens: 1, cache_read_input_tokens: 3 } } });
    send({ type: "ping" });
    send({ type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "", signature: "" } });
    await gate;
    send({ type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "reason" } });
    send({ type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "signed" } });
    send({ type: "content_block_stop", index: 0 });
    send({ type: "content_block_start", index: 1, content_block: { type: "text", text: "", citations: [] } });
    send({ type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "hello" } });
    send({ type: "content_block_stop", index: 1 });
    send({ type: "content_block_start", index: 2, content_block: { type: "tool_use", id: "call_a", name: "read", input: {} } });
    send({ type: "content_block_delta", index: 2, delta: { type: "input_json_delta", partial_json: '{"path":' } });
    send({ type: "content_block_delta", index: 2, delta: { type: "input_json_delta", partial_json: mode === "bad_json" ? "BROKEN" : '"index.html"}' } });
    if (mode === "open_block") { send({ type: "message_delta", delta: { stop_reason: "tool_use" } }); send({ type: "message_stop" }); reply.end(); return; }
    send({ type: "content_block_stop", index: 2 });
    if (mode === "truncated") { reply.end(); return; }
    send({ type: "message_delta", delta: { stop_reason: mode === "missing_reason" ? null : "tool_use", stop_sequence: null }, usage: { output_tokens: 12 } });
    send({ type: "message_stop" }); reply.end();
  });
  fixture.listen(0, "127.0.0.1"); await once(fixture, "listening"); const upstream = fixture.address(); assert.ok(upstream && typeof upstream !== "string");
  const provider = { id: "anthropic-native", name: "Messages fixture", type: "anthropic" as const, enabled: true, baseUrl: `http://127.0.0.1:${upstream.port}` };
  const store = new LocalStore(join(mkdtempSync(join(tmpdir(), "coworkerapi-messages-")), "state.json"), randomBytes(32).toString("hex"));
  store.upsertProvider(provider, "anthropic-fixture-key"); store.upsertModel({ id: "public-claude", provider: provider.id, upstreamModel: "upstream-claude", enabled: true, supportsTools: true, supportsStreaming: true });
  const key = store.createKey("fixture-client").key; const widget = new WidgetBridge(); const app = buildServer(widget, "fixture-secret", store);
  const payload = { model: "public-claude", max_tokens: 100, stream: false, system: [{ type: "text", text: "system", cache_control: { type: "ephemeral" } }], messages: [{ role: "assistant", content: raw.content }, { role: "user", content: [{ type: "tool_result", tool_use_id: "call_a", content: "local result", is_error: false }] }], thinking: { type: "enabled", budget_tokens: 50 }, tools: [{ name: "read", input_schema: { type: "object" } }] };
  try {
    const headers = { "x-api-key": key, "Content-Type": "application/json" };
    const plain = await app.inject({ method: "POST", url: "/v1/messages", headers, payload });
    assert.equal(plain.statusCode, 200); assert.deepEqual(plain.json(), { ...raw, model: "public-claude" }); assert.deepEqual(observed, { ...payload, model: "upstream-claude" });
    const audit = store.listRequests()[0]; assert.equal(audit.provider, provider.id); assert.equal(audit.upstreamModel, "upstream-claude"); assert.equal(audit.outcome, "completed");
    assert.equal(audit.inputTokens, 5); assert.equal(audit.outputTokens, 12); assert.equal(audit.cachedInputTokens, 3); assert.equal(audit.reasoningTokens, null); assert.equal(audit.usageSource, "upstream");
    await app.listen({ host: "127.0.0.1", port: 0 }); const address = app.server.address(); assert.ok(address && typeof address !== "string");
    const response = await fetch(`http://127.0.0.1:${address.port}/v1/messages`, { method: "POST", headers, body: JSON.stringify({ ...payload, stream: true }), signal: AbortSignal.timeout(5000) });
    const reader = response.body!.getReader(); const first = await reader.read(); assert.ok(!first.done); let text = new TextDecoder().decode(first.value);
    assert.ok(text.includes("message_start")); assert.ok(!text.includes("message_stop")); release();
    while (true) { const chunk = await reader.read(); if (chunk.done) break; text += new TextDecoder().decode(chunk.value); }
    assert.equal((text.match(/event: message_start/g) ?? []).length, 1); assert.equal((text.match(/event: message_stop/g) ?? []).length, 1);
    assert.ok(text.includes("signature_delta")); assert.ok(text.includes('"output_tokens":12')); assert.ok(!text.includes('"model":"upstream-claude"'));
    const collect = async (mode?: string) => {
      const events: BridgeEvent[] = []; const adapter = new AnthropicProviderBridge(provider, "anthropic-fixture-key", { ...payload, metadata: { mode } });
      for await (const event of adapter.respond({ model: "upstream-claude", input: [], stream: true }, new AbortController().signal)) events.push(event);
      return events;
    };
    const events = await collect(); const final = events.at(-1); assert.ok(final?.type === "response.completed"); assert.deepEqual(final.response.native_anthropic_message, raw);
    for (const mode of ["error", "truncated", "bad_json", "open_block", "stop_without_start", "missing_reason"]) {
      const failed = await collect(mode); assert.equal(failed.at(-1)?.type, "response.failed"); assert.ok(!failed.some(e => e.type === "response.completed")); assert.ok(!JSON.stringify(failed).includes("anthropic-fixture-key"));
      const wire = await fetch(`http://127.0.0.1:${address.port}/v1/messages`, { method: "POST", headers, body: JSON.stringify({ ...payload, stream: true, metadata: { mode } }), signal: AbortSignal.timeout(5000) });
      const failureText = await wire.text(); assert.ok(failureText.includes("event: error")); assert.ok(!failureText.includes("event: message_stop"));
    }
    assert.equal(widget.snapshot().counts.queued, 0);
    const wrong = await app.inject({ method: "POST", url: "/v1/responses", headers, payload: { model: "public-claude", input: "test" } }); assert.equal(wrong.statusCode, 400);
  } finally {
    release(); await app.close(); fixture.closeAllConnections(); await new Promise<void>(resolve => fixture.close(() => resolve()));
    if (previous === undefined) delete process.env.ALLOW_PRIVATE_UPSTREAMS; else process.env.ALLOW_PRIVATE_UPSTREAMS = previous;
  }
});
