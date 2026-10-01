import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { buildServer } from "../src/app.js";
import { WorkspaceAgentBridge } from "../src/workspace-agent.js";

test("Workspace Agent trigger returns text through an authenticated MCP callback", async () => {
  process.env.COWORKER_API_KEYS = "client-test-key";
  process.env.COWORKER_MCP_SECRET = "mcp-test-key";
  let seenInput: Record<string, unknown> | undefined;
  const bridge = new WorkspaceAgentBridge({
    triggerId: "agtch_test",
    accessToken: "agent-test-token",
    pollIntervalMs: 10_000,
    fetcher: async (_url, init) => {
      assert.equal(init?.method, "POST");
      assert.equal((init?.headers as Record<string, string>).Authorization, "Bearer agent-test-token");
      const payload = JSON.parse(String(init?.body)) as { input: string };
      seenInput = JSON.parse(payload.input) as Record<string, unknown>;
      return new Response(JSON.stringify({ conversation_url: "https://chatgpt.com/c/test" }), { status: 202 });
    },
  });
  const app = buildServer(bridge);
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  const client = new Client({ name: "test-callback", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
    requestInit: { headers: { Authorization: "Bearer mcp-test-key" } },
  });
  try {
    const unauthorized = await fetch(`${base}/mcp`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    assert.equal(unauthorized.status, 401);
    await client.connect(transport);
    const tools = await client.listTools();
    assert.ok(tools.tools.some((tool) => tool.name === "submit_result"));
    const responsePromise = fetch(`${base}/v1/responses`, {
      method: "POST",
      headers: { Authorization: "Bearer client-test-key", "Content-Type": "application/json" },
      body: JSON.stringify({ model: "chatgpt-web", input: "hello" }),
    });
    for (let i = 0; !seenInput && i < 50; i++) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.ok(seenInput);
    assert.equal((seenInput.request as Record<string, unknown>).input, "hello");
    const callback = await client.callTool({ name: "submit_result", arguments: { request_id: seenInput.request_id, text: "hello from ChatGPT" } });
    assert.deepEqual(callback.structuredContent, { status: "accepted" });
    const response = await responsePromise;
    assert.equal(response.status, 200);
    assert.equal((await response.json()).output_text, "hello from ChatGPT");
    assert.equal(bridge.pendingCount, 0);
  } finally {
    await client.close();
    await app.close();
  }
});

test("Workspace Agent PoC rejects client tool calls before triggering ChatGPT", async () => {
  let called = false;
  const bridge = new WorkspaceAgentBridge({ triggerId: "agtch_test", accessToken: "token", fetcher: async () => { called = true; throw new Error("unexpected"); } });
  const events = [];
  for await (const event of bridge.respond({ model: "chatgpt-web", input: "hi", stream: false, tools: [{ type: "function", name: "shell" }] }, new AbortController().signal)) events.push(event);
  assert.equal(events[0]?.type, "response.failed");
  assert.equal(called, false);
});
