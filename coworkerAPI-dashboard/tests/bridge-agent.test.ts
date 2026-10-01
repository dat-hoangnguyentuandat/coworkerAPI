import assert from "node:assert/strict";
import test from "node:test";
import { buildServer } from "../src/app.js";
import { CoworkerBridgeAgent } from "../src/bridge-agent.js";
import { CoworkerBridge } from "../src/bridge.js";

test("bridge agent completes a real WebSocket turn", async () => {
  process.env.COWORKER_API_KEYS = "client-key";
  const app = buildServer(new CoworkerBridge(), "bridge-key");
  await app.listen({ host: "127.0.0.1", port: 0 });
  const port = (app.server.address() as { port: number }).port;
  const agent = new CoworkerBridgeAgent({ url: `ws://127.0.0.1:${port}/internal/bridge`, secret: "bridge-key", bridgeId: "test-agent" }, async function* (request) {
    yield { type: "response.created", response: { id: "resp_agent" } } as const;
    yield { type: "response.output_text.delta", delta: String(request.input) } as const;
    yield { type: "response.completed", response: { id: "resp_agent", output_text: String(request.input) } } as const;
  });
  agent.start();
  try {
    for (let attempt = 0; attempt < 30; attempt++) {
      const ready = await fetch(`http://127.0.0.1:${port}/health/inference`);
      if (ready.status === 200) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    const response = await fetch(`http://127.0.0.1:${port}/v1/responses`, { method: "POST", headers: { authorization: "Bearer client-key", "content-type": "application/json" }, body: JSON.stringify({ model: "chatgpt-web", input: "hello" }) });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).output_text, "hello");
  } finally {
    agent.stop();
    await app.close();
  }
});

test("bridge agent reports a handler that ends without a terminal event", async () => {
  process.env.COWORKER_API_KEYS = "client-key";
  const app = buildServer(new CoworkerBridge(), "bridge-key");
  await app.listen({ host: "127.0.0.1", port: 0 });
  const port = (app.server.address() as { port: number }).port;
  const agent = new CoworkerBridgeAgent({ url: `ws://127.0.0.1:${port}/internal/bridge`, secret: "bridge-key", bridgeId: "incomplete-agent" }, async function* () {
    yield { type: "response.output_text.delta", delta: "partial" } as const;
  });
  agent.start();
  try {
    for (let attempt = 0; attempt < 30; attempt++) {
      if ((await fetch(`http://127.0.0.1:${port}/health/inference`)).status === 200) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    const response = await fetch(`http://127.0.0.1:${port}/v1/responses`, { method: "POST", headers: { authorization: "Bearer client-key", "content-type": "application/json" }, body: JSON.stringify({ model: "chatgpt-web", input: "hello" }) });
    assert.equal(response.status, 502);
    assert.equal((await response.json()).error.code, "bridge_incomplete_turn");
  } finally {
    agent.stop();
    await app.close();
  }
});
