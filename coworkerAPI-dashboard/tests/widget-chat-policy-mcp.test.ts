import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { buildServer } from "../src/app.js";
import { WidgetBridge } from "../src/widget-bridge.js";
import { WIDGET_CHAT_POLICY, widgetSubmitNotice } from "../src/widget-chat-policy.js";

test("real MCP callbacks keep quiet notices separate from complete API text and tool payloads", async () => {
  const previousKeys = process.env.COWORKER_API_KEYS, previousSecret = process.env.COWORKER_MCP_SECRET;
  process.env.COWORKER_API_KEYS = "quiet-policy-api-fixture";
  process.env.COWORKER_MCP_SECRET = "quiet-policy-mcp-fixture";
  const bridge = new WidgetBridge();
  const app = buildServer(bridge, "quiet-policy-internal-fixture");
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address(); assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  const client = new Client({ name: "quiet-policy-test", version: "1" });
  const controller = new AbortController();
  const textOf = (value: unknown) => (value as { content: Array<{ type: string; text?: string }> }).content.filter(item => item.type === "text").map(item => item.text).join("\n");
  const submit = (requestId: string, result: object) => client.callTool({ name: "workbench_api_submit", arguments: { request_id: requestId, ...result } });
  async function queue(payload: object) {
    const response = fetch(`${base}/v1/responses`, { method: "POST", headers: { authorization: "Bearer quiet-policy-api-fixture", "content-type": "application/json" }, body: JSON.stringify({ model: "chatgpt-web", ...payload }), signal: controller.signal });
    void response.catch(() => {});
    for (let i = 0; !bridge.pendingCount && i < 500; i++) await new Promise(resolve => setTimeout(resolve, 10));
    const turn = bridge.claim(); assert.ok(turn);
    return { response, turn };
  }
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { authorization: "Bearer quiet-policy-mcp-fixture" } } }));
    assert.ok(client.getInstructions()?.includes(WIDGET_CHAT_POLICY));
    const tools = await client.listTools();
    for (const name of ["workbench_api_activate", "workbench_api_submit"]) assert.ok(tools.tools.find(tool => tool.name === name)?.description?.includes(WIDGET_CHAT_POLICY));
    const activation = await client.callTool({ name: "workbench_api_activate", arguments: {} });
    assert.deepEqual(activation.structuredContent, { status: "opening", widget_runtime: "bridge-v8" });
    assert.match(textOf(activation), /Do not post setup narration or claim Thành công/);
    assert.ok(textOf(activation).includes(WIDGET_CHAT_POLICY));
    const unknown = await submit(randomUUID(), { text: "not delivered" });
    assert.deepEqual(unknown.structuredContent, { status: "unknown_request" });
    assert.equal(textOf(unknown), widgetSubmitNotice("unknown_request", false));
    const finalText = "Complete answer\n```html\n<h1>API result remains intact</h1>\n```\nDetailed explanation and verification.";
    const textTurn = await queue({ input: "Return full source and explanation" });
    const acceptedText = await submit(textTurn.turn.request_id, { text: finalText });
    assert.deepEqual(acceptedText.structuredContent, { status: "accepted" });
    assert.equal(textOf(acceptedText), widgetSubmitNotice("accepted", false));
    const apiText = await textTurn.response; assert.equal(apiText.status, 200);
    assert.equal((await apiText.json()).output_text, finalText);
    const toolsTurn = await queue({ input: "Read a file", tools: [{ type: "function", name: "read_file", parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } }], tool_choice: "required" });
    const invalid = await submit(toolsTurn.turn.request_id, { text: "cannot replace required tool" });
    assert.deepEqual(invalid.structuredContent, { status: "invalid_result" });
    assert.equal(textOf(invalid), widgetSubmitNotice("invalid_result", false));
    assert.equal(bridge.isPending(toolsTurn.turn.request_id), true);
    const malformed = await submit(toolsTurn.turn.request_id, { tool_calls: [{ name: "read_file", arguments: { path: 123 } }] });
    assert.deepEqual(malformed.structuredContent, { status: "invalid_result" });
    assert.equal(textOf(malformed), widgetSubmitNotice("invalid_result", true));
    const argumentsObject = { path: "src/index.ts" };
    const acceptedTools = await submit(toolsTurn.turn.request_id, { tool_calls: [{ name: "read_file", arguments: argumentsObject }] });
    assert.deepEqual(acceptedTools.structuredContent, { status: "accepted" });
    assert.equal(textOf(acceptedTools), widgetSubmitNotice("accepted", true));
    const apiTools = await toolsTurn.response; assert.equal(apiTools.status, 200);
    const output = await apiTools.json();
    assert.equal(output.output[0].type, "function_call");
    assert.equal(output.output[0].name, "read_file");
    assert.deepEqual(JSON.parse(output.output[0].arguments), argumentsObject);
    assert.equal(output.output_text, "");
    const cancelledTurn = await queue({ input: "cancel before callback" });
    controller.abort(); await assert.rejects(cancelledTurn.response);
    for (let i = 0; bridge.isPending(cancelledTurn.turn.request_id) && i < 100; i++) await new Promise(resolve => setTimeout(resolve, 10));
    const cancelled = await submit(cancelledTurn.turn.request_id, { text: "late answer" });
    assert.deepEqual(cancelled.structuredContent, { status: "cancelled" });
    assert.equal(textOf(cancelled), widgetSubmitNotice("cancelled", false));
  } finally {
    controller.abort(); bridge.shutdown(); await client.close(); app.server.closeAllConnections(); await app.close();
    if (previousKeys === undefined) delete process.env.COWORKER_API_KEYS; else process.env.COWORKER_API_KEYS = previousKeys;
    if (previousSecret === undefined) delete process.env.COWORKER_MCP_SECRET; else process.env.COWORKER_MCP_SECRET = previousSecret;
  }
});
