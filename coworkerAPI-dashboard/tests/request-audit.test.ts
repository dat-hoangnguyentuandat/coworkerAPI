import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalStore } from "../src/local-store.js";
import { RequestAudit, tokenUsage } from "../src/request-audit.js";
import { buildServer } from "../src/app.js";
import type { ChatGPTBridge } from "../src/protocol.js";

test("usage maps native categories without inventing counts or double-counting details", () => {
  assert.deepEqual(tokenUsage({ input_tokens: 100, output_tokens: 30, input_tokens_details: { cached_tokens: 60, cache_write_tokens: 4 }, output_tokens_details: { reasoning_tokens: 20 } }), { inputTokens: 100, outputTokens: 30, cachedInputTokens: 60, cacheWriteInputTokens: 4, reasoningTokens: 20 });
  assert.deepEqual(tokenUsage({ prompt_tokens: 9, completion_tokens: 4, prompt_tokens_details: { cached_tokens: 0 }, completion_tokens_details: { reasoning_tokens: 2 } }), { inputTokens: 9, outputTokens: 4, cachedInputTokens: 0, cacheWriteInputTokens: null, reasoningTokens: 2 });
  assert.deepEqual(tokenUsage({ input_tokens: 5, output_tokens: 12, cache_read_input_tokens: 3, cache_creation_input_tokens: 7 }), { inputTokens: 5, outputTokens: 12, cachedInputTokens: 3, cacheWriteInputTokens: 7, reasoningTokens: null });
  assert.ok(Object.values(tokenUsage({ input_tokens: -1, output_tokens: 2.5, cache_read_input_tokens: "3", cache_creation_input_tokens: Infinity })).every(value => value === null));
  const audit = new RequestAudit();
  audit.observe({ type: "response.completed", response: { usage: { input_tokens: 0, output_tokens: 0 } } }, true);
  const base = { id: "fixture", status: 200, protocol: "openai-responses" };
  const record = audit.finish(base, false)!; assert.equal(record.inputTokens, null); assert.equal(record.usageSource, "unknown"); assert.equal(record.costEstimateUsd, null); assert.equal(record.ttftMs, null);
  assert.equal(audit.finish(base, false), undefined);
  const incomplete = new RequestAudit(); incomplete.inferenceStarted = true;
  assert.equal(incomplete.finish(base, false)?.outcome, "failed");
});

test("real HTTP audit persists completed, HTTP-200 stream failure and client cancellation exactly once without content", async () => {
  const directory = mkdtempSync(join(tmpdir(), "coworkerapi-audit-")); const store = new LocalStore(join(directory, "state.json"));
  const key = store.createKey("audit-client").key;
  const bridge: ChatGPTBridge = { async *respond(request, signal) {
    yield { type: "response.output_text.delta", delta: "sensitive-response-fixture" };
    if (request.input === "pending") {
      if (!signal.aborted) await new Promise<void>(resolve => signal.addEventListener("abort", () => resolve(), { once: true }));
      yield { type: "response.failed", error: { code: "cancelled", message: "sensitive-error-fixture" } }; return;
    }
    if (request.input === "failure") { yield { type: "response.failed", error: { code: "upstream_error", message: "sensitive-error-fixture" } }; return; }
    yield { type: "response.completed", response: { id: "resp_fixture", output_text: "sensitive-response-fixture", usage: { input_tokens: 0, output_tokens: 0 } } };
  } };
  const app = buildServer(bridge, undefined, store);
  try {
    const headers = { authorization: `Bearer ${key}`, "content-type": "application/json" };
    await app.inject({ method: "POST", url: "/v1/responses", headers, payload: { model: "chatgpt-web", input: "sensitive-prompt-fixture" } });
    assert.equal(store.listRequests().length, 1); assert.equal(store.listRequests()[0].outcome, "completed"); assert.equal(store.listRequests()[0].inputTokens, null);
    await app.listen({ host: "127.0.0.1", port: 0 }); const address = app.server.address(); assert.ok(address && typeof address !== "string");
    const url = `http://127.0.0.1:${address.port}/v1/responses`;
    const failed = await fetch(url, { method: "POST", headers, body: JSON.stringify({ model: "chatgpt-web", input: "failure", stream: true }) });
    assert.equal(failed.status, 200); assert.ok((await failed.text()).includes("response.failed"));
    assert.equal(store.listRequests().length, 2); assert.equal(store.listRequests()[0].outcome, "failed"); assert.equal(store.listRequests()[0].status, 200);
    const controller = new AbortController();
    const pending = await fetch(url, { method: "POST", headers, body: JSON.stringify({ model: "chatgpt-web", input: "pending", stream: true }), signal: controller.signal });
    const reader = pending.body!.getReader(); await reader.read(); controller.abort();
    const deadline = Date.now() + 3000;
    while (store.listRequests().length < 3 && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(store.listRequests().length, 3);
    const cancelled = store.listRequests()[0]; assert.equal(cancelled.outcome, "cancelled"); assert.equal(cancelled.provider, "coworker-widget"); assert.equal(cancelled.upstreamModel, "chatgpt-web"); assert.ok(typeof cancelled.ttftMs === "number");
    const reloaded = new LocalStore(store.file); assert.equal(reloaded.listRequests().length, 3); assert.equal(reloaded.summary().errorsToday, 2);
    store.recordRequest({ id: "allowlist", at: new Date().toISOString(), protocol: "fixture", status: 200, durationMs: 1, rawPrompt: "sensitive-prompt-fixture", apiKey: key } as any);
    const disk = readFileSync(store.file, "utf8");
    for (const secret of [key, "sensitive-prompt-fixture", "sensitive-response-fixture", "sensitive-error-fixture"]) assert.ok(!disk.includes(secret));
  } finally { await app.close(); }
});
