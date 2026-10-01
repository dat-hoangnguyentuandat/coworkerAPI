import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { once } from "node:events";
import { LocalStore } from "../src/local-store.js";
import { WidgetBridge } from "../src/widget-bridge.js";
import { buildServer } from "../src/app.js";

test("native Responses alias routes encrypted credentials and streams before completion without using widget queue", async () => {
  const previous = process.env.ALLOW_PRIVATE_UPSTREAMS;
  process.env.ALLOW_PRIVATE_UPSTREAMS = "true";
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let hits = 0;
  let observed: Record<string, unknown> = {};
  const complete = { id: "resp_native", object: "response", status: "completed", model: "upstream-model", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "hello" }] }], usage: { input_tokens: 3, output_tokens: 1 } };
  const fixture = createServer(async (request, reply) => {
    hits++;
    assert.equal(request.headers.authorization, "Bearer fixture-native-key");
    let body = ""; for await (const chunk of request) body += chunk;
    observed = JSON.parse(body);
    if (!observed.stream) { reply.setHeader("content-type", "application/json"); reply.end(JSON.stringify(complete)); return; }
    reply.setHeader("content-type", "text/event-stream");
    const send = (event: Record<string, unknown>) => reply.write(`data: ${JSON.stringify(event)}\n\n`);
    send({ type: "response.created", response: { ...complete, status: "in_progress", output: [] }, sequence_number: 0 });
    send({ type: "response.output_text.delta", delta: "hello", item_id: "msg_native", output_index: 0, content_index: 0, sequence_number: 1 });
    await gate;
    send({ type: "response.completed", response: complete, sequence_number: 2 }); reply.end();
  });
  fixture.listen(0, "127.0.0.1"); await once(fixture, "listening");
  const fixtureAddress = fixture.address(); assert.ok(fixtureAddress && typeof fixtureAddress !== "string");
  const store = new LocalStore(join(mkdtempSync(join(tmpdir(), "coworkerapi-native-routing-")), "state.json"), randomBytes(32).toString("hex"));
  store.setup("native-routing-admin-password");
  const provider = { id: "native", name: "Native fixture", type: "openai-compatible" as const, enabled: true, wireApi: "responses" as const, baseUrl: `http://127.0.0.1:${fixtureAddress.port}/v1` };
  store.upsertProvider(provider, "fixture-native-key");
  const key = store.createKey("native-routing-client").key;
  const widget = new WidgetBridge();
  const app = buildServer(widget, "native-routing-internal-secret", store);
  try {
    const login = await app.inject({ method: "POST", url: "/api/admin/v1/login", payload: { password: "native-routing-admin-password" } });
    const alias = await app.inject({ method: "PUT", url: "/api/admin/v1/models/native-public", headers: { cookie: login.headers["set-cookie"] as string, "x-coworker-csrf": login.json().csrf }, payload: { provider: "native", upstreamModel: "upstream-model", enabled: true, supportsTools: true, supportsStreaming: true } });
    assert.equal(alias.statusCode, 200);
    const input = [{ type: "function_call_output", call_id: "previous", output: "actual local result" }];
    const headers = { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
    const plain = await app.inject({ method: "POST", url: "/v1/responses", headers, payload: { model: "native-public", input, stream: false, reasoning: { effort: "low" } } });
    assert.equal(plain.statusCode, 200); assert.equal(plain.json().model, "native-public"); assert.equal(plain.json().output_text, "hello");
    assert.equal(observed.model, "upstream-model"); assert.deepEqual(observed.input, input); assert.deepEqual(observed.reasoning, { effort: "low" });
    assert.equal(widget.pendingCount, 0);
    assert.equal(store.listRequests()[0].inputTokens, 3); assert.equal(store.listRequests()[0].outputTokens, 1); assert.equal(store.listRequests()[0].usageSource, "upstream");
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address(); assert.ok(address && typeof address !== "string");
    const streamed = await fetch(`http://127.0.0.1:${address.port}/v1/responses`, { method: "POST", headers, body: JSON.stringify({ model: "native-public", input: "hello", stream: true }), signal: AbortSignal.timeout(5000) });
    assert.equal(streamed.status, 200);
    const reader = streamed.body!.getReader(); let text = "";
    while (!text.includes("response.output_text.delta")) { const chunk = await reader.read(); assert.ok(!chunk.done); text += new TextDecoder().decode(chunk.value); }
    assert.ok(text.includes('"model":"native-public"')); assert.ok(!text.includes("response.completed"));
    release();
    while (true) { const chunk = await reader.read(); if (chunk.done) break; text += new TextDecoder().decode(chunk.value); }
    assert.equal((text.match(/event: response.completed/g) ?? []).length, 1);
    assert.ok(!text.includes('"model":"upstream-model"'));
    assert.equal(widget.snapshot().counts.queued, 0);
    const translated = await app.inject({ method: "POST", url: "/v1/messages", headers, payload: { model: "native-public", max_tokens: 10, messages: [{ role: "user", content: "hi" }] } });
    assert.equal(translated.statusCode, 400); assert.equal(translated.json().error.code, "unsupported_protocol_translation");
    store.upsertProvider({ ...provider, enabled: false });
    const before = hits;
    assert.equal((await app.inject({ method: "POST", url: "/v1/responses", headers, payload: { model: "native-public", input: "hi" } })).statusCode, 503);
    assert.equal(hits, before);
  } finally {
    release(); app.server.closeAllConnections(); await app.close(); fixture.closeAllConnections(); await new Promise<void>((resolve) => fixture.close(() => resolve()));
    if (previous === undefined) delete process.env.ALLOW_PRIVATE_UPSTREAMS; else process.env.ALLOW_PRIVATE_UPSTREAMS = previous;
  }
});
