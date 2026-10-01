import test from "node:test";
import assert from "node:assert/strict";
import { assertBoundedToolJson, checkToolSchemas, ToolSchemaError } from "../src/tool-schema.js";
import { WidgetBridge } from "../src/widget-bridge.js";
import { buildServer } from "../src/app.js";

const schema = { type: "object", properties: { path: { type: "string", minLength: 1 }, mode: { enum: ["read", "write"] }, count: { type: "integer", minimum: 1 } }, required: ["path", "mode"], additionalProperties: false };
test("schema worker validates nested arguments, local references and dialects without mutation", async () => {
  const args = { path: "index.html", mode: "read", count: 1 };
  assert.equal(await checkToolSchemas([{ schema, arguments: args }]), true);
  assert.deepEqual(args, { path: "index.html", mode: "read", count: 1 });
  assert.equal(await checkToolSchemas([{ schema, arguments: args }, { schema, arguments: args }]), true, "Repeated object identity is not a JSON cycle");
  for (const arguments_ of [{ mode: "read" }, { path: "", mode: "read" }, { path: "x", mode: "delete" }, { ...args, count: "1" }, { ...args, extra: true }]) {
    assert.equal(await checkToolSchemas([{ schema, arguments: arguments_ }]), false);
  }
  for (const dialect of [undefined, "https://json-schema.org/draft/2019-09/schema", "https://json-schema.org/draft/2020-12/schema"]) {
    const recursive = { ...(dialect ? { $schema: dialect } : {}), type: "object", properties: { node: { $ref: "#/$defs/node" } }, required: ["node"], $defs: { node: { type: "object", properties: { value: { type: "string" }, child: { $ref: "#/$defs/node" } }, required: ["value"] } } };
    assert.equal(await checkToolSchemas([{ schema: recursive, arguments: { node: { value: "x", child: { value: "y" } } } }]), true);
    assert.equal(await checkToolSchemas([{ schema: recursive, arguments: { node: { value: "x", child: { value: 7 } } } }]), false);
  }
  assert.equal(await checkToolSchemas([{ schema: { type: "object", properties: { email: { type: "string", format: "email" } } }, arguments: { email: "not-an-email" } }]), false);
});

test("cancellation and duplicate callbacks cannot win twice across async schema validation", async () => {
  const bridge = new WidgetBridge(0);
  const controller = new AbortController();
  const tools = [{ type: "function", name: "file", parameters: schema }];
  const iterator = bridge.respond({ model: "chatgpt-web", input: "fixture", tools, stream: false }, controller.signal)[Symbol.asyncIterator]();
  const pending = iterator.next();
  for (let i = 0; bridge.pendingCount === 0 && i < 1000; i++) await new Promise(resolve => setTimeout(resolve, 5));
  const turn = bridge.claim(); assert.ok(turn);
  const callback = { toolCalls: [{ name: "file", arguments: { path: "x", mode: "read" } }] };
  const outcomes = await Promise.all([bridge.submit(turn.request_id, callback), bridge.submit(turn.request_id, callback)]);
  assert.deepEqual(outcomes.sort(), ["accepted", "unknown_request"]);
  assert.equal(bridge.snapshot().counts.submitted, 1);
  await pending; await iterator.return?.();

  const cancelled = bridge.respond({ model: "chatgpt-web", input: "fixture", tools, stream: false }, controller.signal)[Symbol.asyncIterator]();
  const cancelledPending = cancelled.next();
  for (let i = 0; bridge.pendingCount === 0 && i < 1000; i++) await new Promise(resolve => setTimeout(resolve, 5));
  const cancelledTurn = bridge.claim(); assert.ok(cancelledTurn);
  const checking = bridge.submit(cancelledTurn.request_id, callback);
  controller.abort();
  assert.equal(await checking, "cancelled");
  assert.equal((await cancelledPending).value?.type, "response.failed");
  assert.equal(bridge.snapshot().counts.submitted, 1);
  assert.equal(bridge.pendingCount, 0);
  await cancelled.return?.(); bridge.shutdown();
});

test("untrusted schema limits, remote references and unknown validation keywords fail closed", async () => {
  for (const invalid of [{ type: "not-a-type" }, { unknownValidationKeyword: true }, { $ref: "https://example.invalid/never-fetch" }, { $async: true, type: "object" }]) {
    await assert.rejects(checkToolSchemas([{ schema: invalid }]), (error: unknown) => error instanceof ToolSchemaError && error.code === "invalid_tool_schema");
  }
  const cyclic: any = {}; cyclic.loop = cyclic;
  assert.throws(() => assertBoundedToolJson(cyclic), ToolSchemaError);
  assert.throws(() => assertBoundedToolJson({ value: "x".repeat(1_000_001) }), ToolSchemaError);
  let deep: any = {}; for (let i = 0; i < 70; i++) deep = { nested: deep };
  assert.throws(() => assertBoundedToolJson(deep), ToolSchemaError);
});

test("pathological regex is time-bounded off-thread and does not freeze heartbeat/event loop", async () => {
  let ticks = 0; const timer = setInterval(() => ticks++, 10);
  try {
    await assert.rejects(checkToolSchemas([{ schema: { type: "object", properties: { value: { type: "string", pattern: "^(a+)+$" } } }, arguments: { value: "a".repeat(100) + "!" } }], 500), (error: unknown) => error instanceof ToolSchemaError && error.code === "tool_schema_timeout");
    assert.ok(ticks > 5);
    assert.equal(await checkToolSchemas([{ schema, arguments: { path: "ok", mode: "read" } }]), true, "Worker capacity is released after timeout");
  } finally { clearInterval(timer); }
});

test("schema-invalid callbacks remain pending and correct tool arguments complete each public protocol", async () => {
  const previous = process.env.COWORKER_API_KEYS; process.env.COWORKER_API_KEYS = "schema-fixture";
  const bridge = new WidgetBridge(); const app = buildServer(bridge, "schema-internal-fixture");
  const headers = { authorization: "Bearer schema-fixture" };
  try {
    for (const path of ["/v1/responses", "/v1/chat/completions", "/v1/messages"]) {
      const fn = { name: "file", parameters: schema };
      const tools = path === "/v1/messages" ? [{ name: fn.name, input_schema: schema }] : path === "/v1/chat/completions" ? [{ type: "function", function: fn }] : [{ type: "function", ...fn }];
      const payload = { model: "chatgpt-web", tools, ...(path === "/v1/responses" ? { input: "fixture" } : { messages: [{ role: "user", content: "fixture" }], max_tokens: 100 }) };
      const pending = app.inject({ method: "POST", url: path, headers, payload });
      for (let i = 0; bridge.pendingCount === 0 && i < 1000; i++) await new Promise(resolve => setTimeout(resolve, 5));
      const turn = bridge.claim(); assert.ok(turn);
      assert.equal(await bridge.submit(turn.request_id, { toolCalls: [{ name: "file", arguments: { path: "x", mode: "delete" } }] }), "invalid_result");
      assert.equal(bridge.pendingCount, 1);
      assert.equal(await bridge.submit(turn.request_id, { toolCalls: [{ name: "file", arguments: { path: "x", mode: "read" } }] }), "accepted");
      assert.equal((await pending).statusCode, 200);
      for (const stream of [false, true]) {
        const rejected = await app.inject({ method: "POST", url: path, headers, payload: { ...payload, stream, tools: path === "/v1/messages" ? [{ name: "file", input_schema: { type: "impossible" } }] : path === "/v1/chat/completions" ? [{ type: "function", function: { name: "file", parameters: { type: "impossible" } } }] : [{ type: "function", name: "file", parameters: { type: "impossible" } }] } });
        assert.equal(rejected.statusCode, 400); assert.equal(rejected.json().error.code, "invalid_tool_schema"); assert.equal(bridge.pendingCount, 0);
      }
    }
  } finally { bridge.shutdown(); await app.close(); if (previous === undefined) delete process.env.COWORKER_API_KEYS; else process.env.COWORKER_API_KEYS = previous; }
});
