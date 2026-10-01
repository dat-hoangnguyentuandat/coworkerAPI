import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { once } from "node:events";
import { randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ChatProviderBridge } from "../src/chat-provider.js";
import { LocalStore } from "../src/local-store.js";
import { WidgetBridge } from "../src/widget-bridge.js";
import { buildServer } from "../src/app.js";
import type { BridgeEvent } from "../src/protocol.js";

test("native Chat routing retains payload/response, parallel tool deltas, usage and real incremental SSE", async () => {
  const previous = process.env.ALLOW_PRIVATE_UPSTREAMS; process.env.ALLOW_PRIVATE_UPSTREAMS = "true";
  let release!: () => void; const gate = new Promise<void>((resolve) => { release = resolve; });
  let observed: Record<string, any> = {};
  const rawCompletion = { id: "chatcmpl_fixture", object: "chat.completion", model: "upstream-chat", choices: [{ index: 0, message: { role: "assistant", content: "hello", refusal: null }, finish_reason: "length" }], usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 }, vendor_field: "retained" };
  const fixture = createServer(async (request, reply) => {
    assert.equal(request.url, "/v1/chat/completions"); assert.equal(request.headers.authorization, "Bearer chat-fixture-key");
    let body = ""; for await (const chunk of request) body += chunk; observed = JSON.parse(body);
    if (!observed.stream) { reply.setHeader("content-type", "application/json"); reply.end(JSON.stringify(rawCompletion)); return; }
    reply.setHeader("content-type", "text/event-stream");
    const send = (choice: Record<string, unknown> | null, usage?: unknown) => reply.write(`data: ${JSON.stringify({ id: "chatcmpl_fixture", object: "chat.completion.chunk", model: "upstream-chat", choices: choice ? [{ index: 0, ...choice }] : [], ...(usage ? { usage } : {}) })}\n\n`);
    if (observed.metadata?.mode === "error") { reply.end('data: {"error":{"message":"chat-fixture-key"}}\n\n'); return; }
    send({ delta: { role: "assistant", content: "hello", tool_calls: [{ index: 0, id: "call_a", type: "function", function: { name: "read", arguments: '{"path":' } }, { index: 1, id: "call_b", type: "function", function: { name: "write", arguments: '{"text":' } }] }, finish_reason: null });
    await gate;
    send({ delta: { tool_calls: [{ index: 1, function: { arguments: '"value"}' } }, { index: 0, function: { arguments: '"index.html"}' } }] }, finish_reason: null });
    if (observed.metadata?.mode === "truncated") { reply.end(); return; }
    send({ delta: {}, finish_reason: "tool_calls" });
    send(null, rawCompletion.usage); reply.end("data: [DONE]\n\n");
  });
  fixture.listen(0, "127.0.0.1"); await once(fixture, "listening");
  const fixtureAddress = fixture.address(); assert.ok(fixtureAddress && typeof fixtureAddress !== "string");
  const provider = { id: "chat-native", name: "Chat fixture", enabled: true, type: "openai-compatible" as const, wireApi: "chat-completions" as const, baseUrl: `http://127.0.0.1:${fixtureAddress.port}/v1` };
  const store = new LocalStore(join(mkdtempSync(join(tmpdir(), "coworkerapi-chat-routing-")), "state.json"), randomBytes(32).toString("hex"));
  store.upsertProvider(provider, "chat-fixture-key");
  store.upsertModel({ id: "public-chat", provider: provider.id, upstreamModel: "upstream-chat", enabled: true, supportsTools: true, supportsStreaming: true });
  const key = store.createKey("chat-client").key;
  const widget = new WidgetBridge(); const app = buildServer(widget, "chat-internal-secret", store);
  const payload = { model: "public-chat", messages: [{ role: "assistant", content: null, tool_calls: [{ id: "old", type: "function", function: { name: "read", arguments: "{}" } }] }, { role: "tool", tool_call_id: "old", content: "actual local result" }], temperature: 0.2, top_p: 0.9, max_tokens: 100, stream: false, metadata: { source: "fixture" }, tools: [{ type: "function", function: { name: "read", parameters: {} } }] };
  try {
    const headers = { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
    const plain = await app.inject({ method: "POST", url: "/v1/chat/completions", headers, payload });
    assert.equal(plain.statusCode, 200); assert.deepEqual(plain.json(), { ...rawCompletion, model: "public-chat" });
    assert.deepEqual(observed, { ...payload, model: "upstream-chat" });
    assert.equal(store.listRequests()[0].inputTokens, 5); assert.equal(store.listRequests()[0].outputTokens, 2); assert.equal(store.listRequests()[0].usageSource, "upstream");
    await app.listen({ host: "127.0.0.1", port: 0 }); const address = app.server.address(); assert.ok(address && typeof address !== "string");
    const streamed = await fetch(`http://127.0.0.1:${address.port}/v1/chat/completions`, { method: "POST", headers, body: JSON.stringify({ ...payload, stream: true }), signal: AbortSignal.timeout(5000) });
    const reader = streamed.body!.getReader(); const first = await reader.read(); assert.ok(!first.done);
    let text = new TextDecoder().decode(first.value); assert.ok(text.includes("call_a")); assert.ok(!text.includes("[DONE]"));
    release(); while (true) { const chunk = await reader.read(); if (chunk.done) break; text += new TextDecoder().decode(chunk.value); }
    assert.equal((text.match(/data: \[DONE\]/g) ?? []).length, 1);
    assert.ok(text.includes('"finish_reason":"tool_calls"')); assert.ok(text.includes('"prompt_tokens":5'));
    assert.ok(!text.includes('"model":"upstream-chat"')); assert.equal(widget.snapshot().counts.queued, 0);
    const adapter = new ChatProviderBridge(provider, "chat-fixture-key", { ...payload, stream: true });
    const events: BridgeEvent[] = []; for await (const event of adapter.respond({ model: "upstream-chat", input: [], stream: true }, new AbortController().signal)) events.push(event);
    const final = events.at(-1); assert.ok(final?.type === "response.completed");
    assert.deepEqual((final.response.output as any[]).map((call) => [call.call_id, call.name, JSON.parse(call.arguments)]), [["call_a", "read", { path: "index.html" }], ["call_b", "write", { text: "value" }]]);
    for (const mode of ["truncated", "error"]) {
      const failing = new ChatProviderBridge(provider, "chat-fixture-key", { ...payload, stream: true, metadata: { mode } });
      const failed: BridgeEvent[] = []; for await (const event of failing.respond({ model: "upstream-chat", input: [], stream: true }, new AbortController().signal)) failed.push(event);
      assert.equal(failed.at(-1)?.type, "response.failed"); assert.ok(!failed.some((event) => event.type === "response.completed")); assert.ok(!JSON.stringify(failed).includes("chat-fixture-key"));
    }
    const translated = await app.inject({ method: "POST", url: "/v1/responses", headers, payload: { model: "public-chat", input: "hi" } });
    assert.equal(translated.statusCode, 400);
  } finally {
    release(); app.server.closeAllConnections(); await app.close(); fixture.closeAllConnections(); await new Promise<void>((resolve) => fixture.close(() => resolve()));
    if (previous === undefined) delete process.env.ALLOW_PRIVATE_UPSTREAMS; else process.env.ALLOW_PRIVATE_UPSTREAMS = previous;
  }
});
