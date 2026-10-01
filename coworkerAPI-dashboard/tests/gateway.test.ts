import assert from "node:assert/strict";
import test from "node:test";
import { buildServer } from "../src/app.js";
import type { ChatGPTBridge } from "../src/protocol.js";
import { createHash } from "node:crypto";

const bridge: ChatGPTBridge = {
  async *respond(request) {
    yield { type: "response.completed", response: { id: "resp_test", model: request.model, output: [] } };
  },
};

test("requires a CoworkerAPI bearer key", async () => {
  process.env.COWORKER_API_KEYS = "test-key";
  const app = buildServer(bridge);
  const response = await app.inject({ method: "GET", url: "/v1/models" });
  assert.equal(response.statusCode, 401);
  await app.close();
});

test("lists and retrieves configured models with a request id", async () => {
  process.env.COWORKER_API_KEYS = "test-key";
  process.env.COWORKER_MODELS = "chatgpt-web,chatgpt-fast";
  const app = buildServer(bridge);
  const response = await app.inject({ method: "GET", url: "/v1/models/chatgpt-fast", headers: { authorization: "Bearer test-key", "x-request-id": "req-test" } });
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["x-request-id"], "req-test");
  assert.equal(response.json().id, "chatgpt-fast");
  assert.equal(response.json().owned_by, "coworkerapi");
  const list = await app.inject({ method: "GET", url: "/v1/models", headers: { authorization: "Bearer test-key" } });
  assert.ok(list.json().data.every((model: { owned_by: string }) => model.owned_by === 'coworkerapi'));
  await app.close();
});

test("forwards a validated Responses request to the bridge", async () => {
  process.env.COWORKER_API_KEYS = "test-key";
  const app = buildServer(bridge);
  const response = await app.inject({
    method: "POST", url: "/v1/responses", headers: { authorization: "Bearer test-key" },
    payload: { model: "chatgpt-web", input: [{ role: "user", content: "hello" }] },
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().id, "resp_test");
  await app.close();
});

test("assembles non-stream text from bridge deltas", async () => {
  process.env.COWORKER_API_KEYS = "test-key";
  const app = buildServer({
    async *respond() {
      yield { type: "response.output_text.delta", delta: "hel" };
      yield { type: "response.output_text.delta", delta: "lo" };
      yield { type: "response.completed", response: { id: "resp_delta" } };
    },
  });
  const response = await app.inject({ method: "POST", url: "/v1/responses", headers: { authorization: "Bearer test-key" }, payload: { model: "chatgpt-web", input: "hello" } });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().output_text, "hello");
  await app.close();
});

test("accepts Anthropic Messages requests through the same bridge", async () => {
  process.env.COWORKER_API_KEYS = "test-key";
  const app = buildServer({
    async *respond() {
      yield { type: "response.completed", response: { id: "resp_anthropic", output_text: "hello" } };
    },
  });
  const response = await app.inject({
    method: "POST", url: "/v1/messages", headers: { authorization: "Bearer test-key" },
    payload: { model: "chatgpt-web", max_tokens: 100, messages: [{ role: "user", content: "hello" }] },
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().content[0].text, "hello");
  await app.close();
});

test("preserves Anthropic system content blocks", async () => {
  process.env.COWORKER_API_KEYS = "test-key";
  let instructions = "";
  const app = buildServer({ async *respond(request) { instructions = request.instructions ?? ""; yield { type: "response.completed", response: { id: "system_ok", output_text: "ok" } }; } });
  const response = await app.inject({ method: "POST", url: "/v1/messages", headers: { authorization: "Bearer test-key" }, payload: { model: "chatgpt-web", max_tokens: 20, system: [{ type: "text", text: "Be precise." }], messages: [{ role: "user", content: "hi" }] } });
  assert.equal(response.statusCode, 200);
  assert.equal(instructions, "Be precise.");
  await app.close();
});

test("accepts OpenAI Chat Completions requests through the bridge", async () => {
  process.env.COWORKER_API_KEYS = "test-key";
  const app = buildServer({
    async *respond() { yield { type: "response.completed", response: { id: "chat_resp", output_text: "hello" } }; },
  });
  const response = await app.inject({
    method: "POST", url: "/v1/chat/completions", headers: { authorization: "Bearer test-key" },
    payload: { model: "chatgpt-web", messages: [{ role: "user", content: "hello" }] },
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().choices[0].message.content, "hello");
  await app.close();
});

test("preserves Chat Completions tool calls", async () => {
  process.env.COWORKER_API_KEYS = "test-key";
  const app = buildServer({
    async *respond() { yield { type: "response.completed", response: { id: "chat_tool", output: [{ type: "function_call", call_id: "call_1", name: "read_file", arguments: '{"path":"a.txt"}' }] } }; },
  });
  const response = await app.inject({ method: "POST", url: "/v1/chat/completions", headers: { authorization: "Bearer test-key" }, payload: { model: "chatgpt-web", messages: [{ role: "user", content: "read a.txt" }] } });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().choices[0].finish_reason, "tool_calls");
  assert.equal(response.json().choices[0].message.tool_calls[0].function.name, "read_file");
  await app.close();
});

test("preserves Anthropic tool_use content", async () => {
  process.env.COWORKER_API_KEYS = "test-key";
  const app = buildServer({
    async *respond() { yield { type: "response.completed", response: { id: "anth_tool", output: [{ type: "function_call", call_id: "call_1", name: "read_file", arguments: '{"path":"a.txt"}' }] } }; },
  });
  const response = await app.inject({ method: "POST", url: "/v1/messages", headers: { authorization: "Bearer test-key" }, payload: { model: "chatgpt-web", max_tokens: 100, messages: [{ role: "user", content: "read a.txt" }] } });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().stop_reason, "tool_use");
  assert.equal(response.json().content[0].name, "read_file");
  await app.close();
});

test("accepts Anthropic x-api-key authentication", async () => {
  process.env.COWORKER_API_KEYS = "anthropic-key";
  const app = buildServer({ async *respond() { yield { type: "response.completed", response: { id: "ok", output_text: "ok" } }; } });
  const response = await app.inject({ method: "POST", url: "/v1/messages", headers: { "x-api-key": "anthropic-key" }, payload: { model: "chatgpt-web", max_tokens: 20, messages: [{ role: "user", content: "hi" }] } });
  assert.equal(response.statusCode, 200);
  await app.close();
});

test("serializes bridge events into protocol-specific SSE", async () => {
  process.env.COWORKER_API_KEYS = "test-key";
  const streamBridge = {
    async *respond() {
      yield { type: "response.output_text.delta", delta: "hello" } as const;
      yield { type: "response.completed", response: { id: "resp_stream", output_text: "hello" } } as const;
    },
  };
  const app = buildServer(streamBridge);
  const openai = await app.inject({ method: "POST", url: "/v1/responses", headers: { authorization: "Bearer test-key" }, payload: { model: "chatgpt-web", input: "hi", stream: true } });
  const anthropic = await app.inject({ method: "POST", url: "/v1/messages", headers: { authorization: "Bearer test-key" }, payload: { model: "chatgpt-web", max_tokens: 20, messages: [{ role: "user", content: "hi" }], stream: true } });
  assert.match(openai.body, /event: response\.output_text\.delta/);
  assert.match(anthropic.body, /event: content_block_delta/);
  assert.doesNotMatch(anthropic.body, /event: response\.output_text\.delta/);
  await app.close();
});

test("supports Anthropic compatibility probes and token counting", async () => {
  process.env.COWORKER_API_KEYS = "test-key";
  const app = buildServer(bridge);
  const probe = await app.inject({ method: "HEAD", url: "/api/hello" });
  assert.equal(probe.statusCode, 200);
  const count = await app.inject({
    method: "POST", url: "/v1/messages/count_tokens", headers: { authorization: "Bearer test-key" },
    payload: { model: "chatgpt-web", messages: [{ role: "user", content: "hello" }] },
  });
  assert.equal(count.statusCode, 200);
  assert.equal(typeof count.json().input_tokens, "number");
  await app.close();
});

test("accepts hashed API keys without exposing plaintext configuration", async () => {
  const digest = createHash("sha256").update("hashed-key").digest("hex");
  process.env.COWORKER_API_KEYS = `sha256:${digest}`;
  const app = buildServer(bridge);
  const response = await app.inject({ method: "GET", url: "/v1/models", headers: { authorization: "Bearer hashed-key" } });
  assert.equal(response.statusCode, 200);
  await app.close();
});
