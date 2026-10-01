#!/usr/bin/env node
// Installed-package HTTP verification; explicitly simulated upstream, no paid APIs.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { randomBytes } from "node:crypto";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(process.argv[2] ?? ".");
const { buildServer } = await import(pathToFileURL(join(root, "dist/src/app.js")));
const { LocalStore } = await import(pathToFileURL(join(root, "dist/src/local-store.js")));
const { WidgetBridge } = await import(pathToFileURL(join(root, "dist/src/widget-bridge.js")));
const report = { startedAt: new Date().toISOString(), packageRoot: root, upstream: "isolated HTTP fixture, not paid inference", status: "failed", checks: [] };
const previous = process.env.ALLOW_PRIVATE_UPSTREAMS; process.env.ALLOW_PRIVATE_UPSTREAMS = "true";
const store = new LocalStore(join(await mkdtemp(join(tmpdir(), "coworkerapi-native-package-")), "state.json"), randomBytes(32).toString("hex"));
const widget = new WidgetBridge(); const app = buildServer(widget, "internal-native-fixture", store);
let unblock = () => {}; let barrier = Promise.resolve(); let observed;
const fixture = createServer(async (request, reply) => {
  let text = ""; for await (const chunk of request) text += chunk; const body = JSON.parse(text); observed = body;
  const anthropic = request.url === "/v1/messages"; const chat = request.url === "/v1/chat/completions";
  assert.equal(anthropic ? request.headers["x-api-key"] : request.headers.authorization, anthropic ? "native-fixture-key" : "Bearer native-fixture-key");
  const response = anthropic
    ? { id: "msg_fixture", type: "message", role: "assistant", model: body.model, content: [{ type: "text", text: "hello" }], stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 9, output_tokens: 2 } }
    : chat ? { id: "chatcmpl_fixture", object: "chat.completion", model: body.model, choices: [{ index: 0, message: { role: "assistant", content: "hello" }, finish_reason: "stop" }], usage: { prompt_tokens: 9, completion_tokens: 2 } }
    : { id: "resp_fixture", object: "response", model: body.model, status: "completed", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "hello" }] }], usage: { input_tokens: 9, output_tokens: 2 } };
  if (!body.stream) { reply.setHeader("content-type", "application/json"); reply.end(JSON.stringify(response)); return; }
  reply.setHeader("content-type", "text/event-stream");
  const send = event => reply.write(`${chat ? "" : `event: ${event.type}\n`}data: ${JSON.stringify(event)}\n\n`);
  if (anthropic) { send({ type: "message_start", message: { ...response, content: [], stop_reason: null } }); send({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }); send({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "hello" } }); }
  else if (chat) send({ id: response.id, object: "chat.completion.chunk", model: body.model, choices: [{ index: 0, delta: { content: "hello" }, finish_reason: null }] });
  else { send({ type: "response.created", response: { ...response, status: "in_progress", output: [] } }); send({ type: "response.output_text.delta", delta: "hello", output_index: 0, content_index: 0 }); }
  await barrier;
  if (body.metadata?.mode === "truncated") { reply.end(); return; }
  if (anthropic) { send({ type: "content_block_stop", index: 0 }); send({ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 2 } }); send({ type: "message_stop" }); }
  else if (chat) { send({ id: response.id, object: "chat.completion.chunk", model: body.model, choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: response.usage }); reply.write("data: [DONE]\n\n"); }
  else send({ type: "response.completed", response });
  reply.end();
});
try {
  fixture.listen(0, "127.0.0.1"); await once(fixture, "listening"); const upstream = fixture.address();
  await app.listen({ port: 0, host: "127.0.0.1" }); const address = app.server.address(); const base = `http://127.0.0.1:${address.port}`;
  const key = store.createKey("fixture-client").key; const headers = { authorization: `Bearer ${key}`, "content-type": "application/json" };
  for (const protocol of ["responses", "chat", "anthropic"]) {
    const path = protocol === "responses" ? "/v1/responses" : protocol === "chat" ? "/v1/chat/completions" : "/v1/messages";
    store.upsertProvider({ id: protocol, name: protocol, type: protocol === "anthropic" ? "anthropic" : "openai-compatible", enabled: true, baseUrl: `http://127.0.0.1:${upstream.port}/v1`, wireApi: protocol === "chat" ? "chat-completions" : "responses" }, "native-fixture-key");
    store.upsertModel({ id: `public-${protocol}`, upstreamModel: `upstream-${protocol}`, provider: protocol, enabled: true, supportsTools: true, supportsStreaming: true });
    const payload = { model: `public-${protocol}`, ...(protocol === "responses" ? { input: "fixture prompt" } : { messages: [{ role: "user", content: "fixture prompt" }], max_tokens: 100 }), metadata: { retained: true } };
    for (const stream of [false, true]) {
      barrier = stream ? new Promise(resolve => { unblock = resolve; }) : Promise.resolve();
      const result = await fetch(base + path, { method: "POST", headers, body: JSON.stringify({ ...payload, stream }), signal: AbortSignal.timeout(5000) }); assert.equal(result.status, 200);
      let text;
      if (stream) { const reader = result.body.getReader(); const first = await reader.read(); assert.ok(!first.done); text = new TextDecoder().decode(first.value); assert.ok(!text.includes("event: message_stop") && !text.includes("event: response.completed") && !text.includes("data: [DONE]")); unblock(); for (;;) { const next = await reader.read(); if (next.done) break; text += new TextDecoder().decode(next.value); } }
      else text = await result.text();
      assert.ok(text.includes("hello")); assert.ok(!text.includes(`"model":"upstream-${protocol}"`)); assert.deepEqual(observed, { ...payload, stream, model: `upstream-${protocol}` });
      const audit = store.listRequests()[0]; assert.equal(audit.outcome, "completed"); assert.equal(audit.inputTokens, 9); assert.equal(audit.outputTokens, 2); assert.equal(audit.provider, protocol); assert.equal(audit.usageSource, "upstream");
      report.checks.push({ protocol, stream, passed: true });
    }
    barrier = Promise.resolve();
    const failed = await fetch(base + path, { method: "POST", headers, body: JSON.stringify({ ...payload, stream: true, metadata: { mode: "truncated" } }), signal: AbortSignal.timeout(5000) }); const failedText = await failed.text();
    report.lastFailureCheck = { protocol, incompleteError: failedText.includes("upstream_incomplete"), interruptedError: failedText.includes("upstream_interrupted"), hasTerminal: failedText.includes("event: message_stop") || failedText.includes("event: response.completed") || failedText.includes("data: [DONE]"), failedAudit: store.listRequests()[0].outcome === "failed" };
    assert.ok(failedText.includes("upstream_incomplete")); assert.ok(!report.lastFailureCheck.hasTerminal); assert.equal(store.listRequests()[0].outcome, "failed");
    report.checks.push({ protocol, truncated: true, passed: true });
  }
  assert.equal(widget.pendingCount, 0); report.status = "passed";
} catch (error) { report.error = error instanceof assert.AssertionError ? "Installed fixture assertion failed." : "Installed fixture verification failed."; process.exitCode = 1;
} finally {
  unblock(); await app.close(); fixture.closeAllConnections(); fixture.close();
  if (previous === undefined) delete process.env.ALLOW_PRIVATE_UPSTREAMS; else process.env.ALLOW_PRIVATE_UPSTREAMS = previous;
  report.finishedAt = new Date().toISOString(); await mkdir("artifacts", { recursive: true }); await writeFile(join("artifacts", `candidate-native-e2e-${report.startedAt.replace(/[:.]/g, "-")}.json`), JSON.stringify(report, null, 2) + "\n"); console.log(JSON.stringify(report));
}
