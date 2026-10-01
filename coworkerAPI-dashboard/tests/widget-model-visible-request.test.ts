import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { buildServer } from "../src/app.js";
import { WidgetBridge } from "../src/widget-bridge.js";

test("content-only MCP hosts receive each complete current request, not only structured metadata", async t => {
  const previousKeys = process.env.COWORKER_API_KEYS;
  const previousSecret = process.env.COWORKER_MCP_SECRET;
  const previousLimit = process.env.COWORKER_WIDGET_INLINE_LIMIT;
  process.env.COWORKER_API_KEYS = "model-visible-api-fixture";
  process.env.COWORKER_MCP_SECRET = "model-visible-mcp-fixture";
  process.env.COWORKER_WIDGET_INLINE_LIMIT = "8000";
  const bridge = new WidgetBridge(0);
  const app = buildServer(bridge, "model-visible-internal-fixture");
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address(); assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  const client = new Client({ name: "content-only-host-test", version: "1" });
  const source = "export const sourceMarker = 'complete-not-truncated';\n".repeat(1_600);
  const greet = { role: "user", content: "xin chào — distinct earlier greeting" };
  const assistant = { role: "assistant", content: "Xin chào!" };
  const arithmetic = { role: "user", content: "current-user-marker: calculate 317 + 29, not the earlier greeting" };
  const cases = [
    { name: "Responses string input end marker has no array index", route: "/v1/responses", payload: { input: "string-current-user-marker: calculate 317 + 29" }, required: ["string-current-user-marker: calculate 317 + 29"] },
    { name: "Anthropic greeting", route: "/v1/messages", payload: { messages: [greet], max_tokens: 200 }, required: [greet.content] },
    { name: "Anthropic next user overrides greeting history", route: "/v1/messages", payload: { messages: [greet, assistant, arithmetic], max_tokens: 200 }, required: [greet.content, arithmetic.content] },
    { name: "Chat Completions greeting", route: "/v1/chat/completions", payload: { messages: [greet] }, required: [greet.content] },
    { name: "Chat Completions current user after greeting", route: "/v1/chat/completions", payload: { messages: [greet, assistant, arithmetic] }, required: [greet.content, arithmetic.content] },
    { name: "Responses current user after greeting", route: "/v1/responses", payload: { input: [greet, assistant, arithmetic] }, required: [greet.content, arithmetic.content] },
    { name: "Anthropic trailing tool result remains complete", route: "/v1/messages", payload: { messages: [greet, arithmetic, { role: "assistant", content: [{ type: "tool_use", id: "call_read", name: "read", input: {} }] }, { role: "user", content: [{ type: "tool_result", tool_use_id: "call_read", content: "latest-tool-marker: actual source contents" }] }], max_tokens: 200 }, required: [arithmetic.content, "latest-tool-marker: actual source contents", "tool_result"] },
    { name: "Chat Completions trailing tool output", route: "/v1/chat/completions", payload: { messages: [greet, arithmetic, { role: "assistant", content: null, tool_calls: [{ id: "call_read", type: "function", function: { name: "read", arguments: "{}" } }] }, { role: "tool", tool_call_id: "call_read", content: "latest-openai-tool-marker" }] }, required: [arithmetic.content, "latest-openai-tool-marker", "tool_call_id"] },
    { name: "Responses trailing function output and full large source", route: "/v1/responses", payload: { instructions: "Read the entire source exactly", input: [greet, arithmetic, { type: "function_call_output", call_id: "call_read", output: source + "source-tail-marker" }] }, required: [arithmetic.content, source, "source-tail-marker", "function_call_output"] },
  ];
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { authorization: "Bearer model-visible-mcp-fixture" } } }));
    const unknown = await client.callTool({ name: "workbench_api_read_request", arguments: { request_id: randomUUID() } });
    assert.equal(unknown.isError, true);
    assert.equal(unknown.structuredContent, undefined);
    assert.deepEqual(unknown.content, [{ type: "text", text: "Request no longer pending." }]);
    for (const fixture of cases) await t.test(fixture.name, async () => {
      const controller = new AbortController();
      const pending = fetch(`${base}${fixture.route}`, { method: "POST", headers: { authorization: "Bearer model-visible-api-fixture", "content-type": "application/json" }, body: JSON.stringify({ model: "chatgpt-web", ...fixture.payload }), signal: controller.signal });
      void pending.catch(() => {});
      let requestId: string | undefined;
      try {
        for (let i = 0; !bridge.pendingCount && i < 500; i++) await new Promise(resolve => setTimeout(resolve, 10));
        const turn = bridge.claim(); assert.ok(turn); requestId = turn.request_id;
        const read = await client.callTool({ name: "workbench_api_read_request", arguments: { request_id: requestId } });
        const structured = read.structuredContent as { request_id: string; prompt: string };
        assert.equal(structured.request_id, requestId);
        const input = "input" in fixture.payload ? fixture.payload.input : fixture.payload.messages;
        if (Array.isArray(input)) assert.ok(structured.prompt.includes(`last input index=${input.length - 1}`));
        else {
          assert.equal(typeof input, "string");
          assert.ok(!structured.prompt.includes("last input index="));
        }
        assert.ok(structured.prompt.lastIndexOf(`End of request_id=${requestId}`) > structured.prompt.indexOf("Request JSON:\n"));
        assert.match(structured.prompt, /If the final input is a tool result, use it to continue the latest user task/);
        for (const required of fixture.required) assert.ok(structured.prompt.includes(required) || structured.prompt.includes(JSON.stringify(required).slice(1, -1)));
        if (fixture.required.includes(source)) {
          assert.match(turn.prompt, /workbench_api_read_request/);
          assert.ok(turn.prompt.length < structured.prompt.length);
          assert.ok(!turn.prompt.includes("source-tail-marker"));
          assert.ok(!turn.prompt.includes(JSON.stringify(source).slice(1, -1)));
        }
        // Simulate only the host's documented model-visible projection, not an LLM answer.
        const visible = (read.content as Array<{ type: string; text?: string }>).filter(block => block.type === "text").map(block => block.text ?? "").join("\n");
        assert.equal(visible === structured.prompt, true, `Model-visible content must equal the full current request: visible=${visible.length} chars, full=${structured.prompt.length} chars`);
        for (const required of fixture.required) assert.ok(visible.includes(required) || visible.includes(JSON.stringify(required).slice(1, -1)), "Content-only host must not lose request payload");
      } finally {
        // No supplied model answer: transport completeness is tested without claiming live inference correctness.
        controller.abort(); await assert.rejects(pending);
        for (let i = 0; requestId && bridge.isPending(requestId) && i < 100; i++) await new Promise(resolve => setTimeout(resolve, 10));
        if (requestId) {
          assert.equal(bridge.isPending(requestId), false);
          const cancelled = await client.callTool({ name: "workbench_api_read_request", arguments: { request_id: requestId } });
          assert.equal(cancelled.isError, true);
          assert.equal(cancelled.structuredContent, undefined);
          assert.deepEqual(cancelled.content, [{ type: "text", text: "Request no longer pending." }]);
        }
      }
    });
  } finally {
    bridge.shutdown(); await client.close(); app.server.closeAllConnections(); await app.close();
    for (const [key, previous] of [["COWORKER_API_KEYS", previousKeys], ["COWORKER_MCP_SECRET", previousSecret], ["COWORKER_WIDGET_INLINE_LIMIT", previousLimit]] as const) {
      if (previous === undefined) delete process.env[key]; else process.env[key] = previous;
    }
  }
});
