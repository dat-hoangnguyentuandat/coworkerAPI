import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildServer } from "../src/app.js";
import { LocalStore } from "../src/local-store.js";
import type { ChatGPTBridge } from "../src/protocol.js";

test("model aliases resolve upstream names, retain public names, and enforce capabilities across protocols", async () => {
  const directory = mkdtempSync(join(tmpdir(), "coworkerapi-routing-"));
  const store = new LocalStore(join(directory, "state.json"));
  const { key } = store.createKey("routing-test");
  const observed: string[] = [];
  const bridge: ChatGPTBridge = { async *respond(request) {
    observed.push(request.model);
    yield { type: "response.output_text.delta", delta: "hello" };
    yield { type: "response.completed", response: { id: "resp_routing", model: request.model, output_text: "hello", output: [] } };
  } };
  store.upsertModel({ id: "coding", provider: "coworker-widget", upstreamModel: "transport-model", enabled: true, supportsTools: true, supportsStreaming: true });
  store.upsertModel({ id: "limited", provider: "coworker-widget", upstreamModel: "transport-model", enabled: true, supportsTools: false, supportsStreaming: false });
  store.upsertModel({ id: "disabled", provider: "coworker-widget", upstreamModel: "transport-model", enabled: false, supportsTools: true, supportsStreaming: true });
  const app = buildServer(bridge, undefined, store);
  try {
    for (const path of ["/v1/responses", "/v1/messages", "/v1/chat/completions"]) {
      const input = path.endsWith("responses") ? { input: "hello" } : { messages: [{ role: "user", content: "hello" }], max_tokens: 20 };
      const send = (extra: Record<string, unknown>) => app.inject({ method: "POST", url: path, headers: { authorization: `Bearer ${key}` }, payload: { ...input, ...extra } });
      const success = await send({ model: "coding" });
      assert.equal(success.statusCode, 200, path);
      assert.equal(success.json().model, "coding", path);
      assert.equal(observed.at(-1), "transport-model");
      const calls = observed.length;
      for (const model of ["missing", "disabled"]) assert.equal((await send({ model })).statusCode, 404);
      const stream = await send({ model: "limited", stream: true });
      assert.equal(stream.statusCode, 400);
      assert.equal(stream.json().error.code, "unsupported_streaming");
      const tools = await send({ model: "limited", tools: [{ type: "function", name: "read", input_schema: {} }] });
      assert.equal(tools.statusCode, 400);
      assert.equal(tools.json().error.code, "unsupported_tools");
      assert.equal(observed.length, calls, "Rejected requests must never reach the bridge");
      store.upsertProvider({ id: "coworker-widget", name: "ChatGPT bridge", type: "coworker-widget", enabled: false });
      const providerDisabled = await send({ model: "coding" });
      assert.equal(providerDisabled.statusCode, 503);
      assert.equal(providerDisabled.json().error.code, "provider_unavailable");
      assert.equal(observed.length, calls, "Disabled providers must never reach the bridge");
      store.upsertProvider({ id: "coworker-widget", name: "ChatGPT bridge", type: "coworker-widget", enabled: true });
    }
  } finally {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
