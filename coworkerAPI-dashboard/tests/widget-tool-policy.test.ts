import test from "node:test";
import assert from "node:assert/strict";
import { widgetToolPolicy, WidgetToolPolicyError } from "../src/widget-tool-policy.js";
import { WidgetBridge } from "../src/widget-bridge.js";
import { buildServer } from "../src/app.js";

const functions = [{ type: "function", name: "read", parameters: { type: "object" } }, { type: "function", name: "write", parameters: { type: "object" } }];
test("widget function policy enforces required/forced/subset/none/parallel choices and namespace identity", () => {
  assert.equal(widgetToolPolicy(functions, "required").required, true);
  assert.equal(widgetToolPolicy(functions, "none").allowed.size, 0);
  const forced = widgetToolPolicy(functions, { type: "function", function: { name: "read" } });
  assert.deepEqual([...forced.allowed], ["read"]); assert.equal(forced.maxCalls, 1); assert.equal(forced.required, true);
  const anthropic = widgetToolPolicy(functions, { type: "any", disable_parallel_tool_use: true }); assert.equal(anthropic.maxCalls, 1); assert.equal(anthropic.required, true);
  const subset = widgetToolPolicy(functions, { type: "allowed_tools", mode: "required", tools: [{ type: "function", name: "write" }] }); assert.deepEqual([...subset.allowed], ["write"]);
  const namespace = widgetToolPolicy([{ type: "namespace", name: "files", tools: functions }], { type: "function", name: "read", namespace: "files" });
  assert.deepEqual([...namespace.allowed], ["files.read"]); assert.deepEqual(namespace.tools.get("files.read"), { name: "read", namespace: "files" });
  for (const [tools, choice, parallel] of [
    [[], "required"], [functions, { type: "function", name: "missing" }], [functions, { type: "allowed_tools", mode: "required", tools: [] }], [functions, "invalid"], [functions, undefined, "false"],
    [[...functions, functions[0]], "auto"], [[{ type: "web_search" }], "auto"], [[{ type: "namespace", name: "files", tools: [] }], "auto"], [[{ type: "namespace", name: "files", tools: [{ type: "function", name: "read", defer_loading: true }] }], "auto"],
  ] as any[]) assert.throws(() => widgetToolPolicy(tools, choice, parallel), WidgetToolPolicyError);
});

test("widget callbacks cannot bypass forced tool or parallel policy across protocols; namespace SSE preserves field", async () => {
  const previous = process.env.COWORKER_API_KEYS; process.env.COWORKER_API_KEYS = "tool-policy-fixture";
  const bridge = new WidgetBridge(); const app = buildServer(bridge, "tool-policy-internal-fixture");
  try {
    const headers = { authorization: "Bearer tool-policy-fixture" };
    for (const path of ["/v1/responses", "/v1/chat/completions", "/v1/messages"]) {
      const anthropic = path === "/v1/messages";
      const payload = { model: "chatgpt-web", ...(path === "/v1/responses" ? { input: "fixture" } : { messages: [{ role: "user", content: "fixture" }], max_tokens: 100 }),
        tools: anthropic ? functions.map(fn => ({ name: fn.name, input_schema: fn.parameters })) : path === "/v1/chat/completions" ? functions.map(fn => ({ type: "function", function: fn })) : functions,
        tool_choice: anthropic ? { type: "tool", name: "read", disable_parallel_tool_use: true } : { type: "function", name: "read" }, parallel_tool_calls: false };
      const pending = app.inject({ method: "POST", url: path, headers, payload });
      for (let i = 0; bridge.pendingCount === 0 && i < 1000; i++) await new Promise(resolve => setTimeout(resolve, 5));
      const turn = bridge.claim(); assert.ok(turn);
      assert.equal(await bridge.submit(turn.request_id, { text: "not a tool" }), "invalid_result");
      assert.equal(await bridge.submit(turn.request_id, { toolCalls: [{ name: "write", arguments: {} }] }), "invalid_result");
      assert.equal(await bridge.submit(turn.request_id, { toolCalls: [{ name: "read", arguments: {} }, { name: "read", arguments: {} }] }), "invalid_result");
      assert.equal(await bridge.submit(turn.request_id, { toolCalls: [{ name: "read", arguments: { path: "fixture.html" } }] }), "accepted");
      const result = await pending; assert.equal(result.statusCode, 200); assert.ok(result.body.includes("read"));
    }
    const tools = [{ type: "namespace", name: "files", tools: functions }];
    const pending = app.inject({ method: "POST", url: "/v1/responses", headers, payload: { model: "chatgpt-web", input: "fixture", tools, stream: true, tool_choice: { type: "function", name: "read", namespace: "files" } } });
    for (let i = 0; bridge.pendingCount === 0 && i < 1000; i++) await new Promise(resolve => setTimeout(resolve, 5));
    const turn = bridge.claim(); assert.ok(turn); assert.ok(turn.prompt.includes("files.read"));
    assert.equal(await bridge.submit(turn.request_id, { toolCalls: [{ name: "read", arguments: {} }] }), "invalid_result");
    assert.equal(await bridge.submit(turn.request_id, { toolCalls: [{ name: "files.read", arguments: {} }] }), "accepted");
    const result = await pending; assert.ok(result.body.includes('"namespace":"files"')); assert.ok(result.body.includes('"name":"read"'));
    for (const stream of [false, true]) {
      const rejected = await app.inject({ method: "POST", url: "/v1/responses", headers, payload: { model: "chatgpt-web", input: "fixture", tools: [{ type: "web_search" }], stream } });
      assert.equal(rejected.statusCode, 400); assert.equal(rejected.json().error.code, "unsupported_tools"); assert.equal(bridge.pendingCount, 0);
    }
  } finally { bridge.shutdown(); await app.close(); if (previous === undefined) delete process.env.COWORKER_API_KEYS; else process.env.COWORKER_API_KEYS = previous; }
});
