import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { once } from "node:events";
import { ResponsesProviderBridge } from "../src/responses-provider.js";
import type { BridgeEvent, ResponseRequest } from "../src/protocol.js";
import { writeOpenAIEvent } from "../src/serializers.js";
import type { ServerResponse } from "node:http";

test("Responses adapter retains native fields/events/tools/usage and rejects incomplete or failed upstreams", async () => {
  const previousPrivate = process.env.ALLOW_PRIVATE_UPSTREAMS;
  process.env.ALLOW_PRIVATE_UPSTREAMS = "true";
  let observed: Record<string, unknown> = {};
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const tool = { id: "fc_fixture", type: "function_call", call_id: "call_fixture", name: "read", arguments: '{"path":"index.html"}', status: "completed" };
  const response = { id: "resp_fixture", object: "response", status: "completed", model: "fixture", output: [{ id: "msg_fixture", type: "message", role: "assistant", content: [{ type: "output_text", text: "hello", annotations: [] }] }, tool], usage: { input_tokens: 12, output_tokens: 3 } };
  const server = createServer(async (request, reply) => {
    let body = ""; for await (const chunk of request) body += chunk;
    observed = JSON.parse(body);
    assert.equal(request.url, "/v1/responses");
    assert.equal(request.headers.authorization, "Bearer native-fixture-key");
    if (observed.model === "http-error") { reply.writeHead(500); reply.end("native-fixture-key secret body"); return; }
    if (!observed.stream) { reply.setHeader("content-type", "application/json"); reply.end(JSON.stringify(response)); return; }
    reply.setHeader("content-type", "text/event-stream");
    const event = (data: Record<string, unknown>) => reply.write(`event: ${data.type}\ndata: ${JSON.stringify(data)}\n\n`);
    if (observed.model === "failed") { event({ type: "response.failed", response: { error: { message: "native-fixture-key" } } }); reply.end(); return; }
    event({ type: "response.created", response: { id: "resp_fixture", model: "fixture", status: "in_progress", output: [] }, sequence_number: 0 });
    event({ type: "response.output_text.delta", delta: "hello", item_id: "msg_fixture", output_index: 0, content_index: 0, sequence_number: 1 });
    if (observed.model === "truncated") { reply.end(); return; }
    await gate;
    event({ type: "response.output_item.added", item: tool, output_index: 1, sequence_number: 2 });
    event({ type: "response.function_call_arguments.delta", delta: tool.arguments, output_index: 1, sequence_number: 3 });
    event({ type: "response.output_item.done", item: tool, output_index: 1, sequence_number: 4 });
    event({ type: "response.completed", response, sequence_number: 5 });
    reply.end();
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const adapter = new ResponsesProviderBridge({ id: "fixture", name: "Fixture", type: "openai-compatible", enabled: true, wireApi: "responses", baseUrl: `http://127.0.0.1:${address.port}/v1` }, "native-fixture-key");
  const baseRequest: ResponseRequest = { model: "fixture", input: [{ type: "function_call_output", call_id: "call_previous", output: "actual local result" }], reasoning: { effort: "low" }, tools: [{ type: "function", name: "read", parameters: {} }], stream: false, store: false };
  try {
    const events: BridgeEvent[] = [];
    for await (const event of adapter.respond(baseRequest, new AbortController().signal)) events.push(event);
    assert.deepEqual(observed, baseRequest);
    const final = events.at(-1); assert.ok(final?.type === "response.completed");
    assert.equal(final.response.output_text, "hello"); assert.deepEqual(final.response.usage, response.usage);
    const iterator = adapter.respond({ ...baseRequest, stream: true }, new AbortController().signal);
    const created = await iterator.next(); assert.equal(created.value?.type, "response.created");
    const delta = await iterator.next(); assert.equal(delta.value?.type, "response.output_text.delta"); // Gate has not opened: incremental delivery.
    assert.equal(delta.value?.native?.item_id, "msg_fixture");
    release();
    const streamEvents = [created.value!, delta.value!];
    for await (const event of iterator) streamEvents.push(event);
    assert.equal(streamEvents.filter((event) => event.type === "response.tool_call").length, 1);
    const written: string[] = [];
    const sink = { write(chunk: string) { written.push(chunk); return true; } } as unknown as ServerResponse;
    for (const event of streamEvents) writeOpenAIEvent(sink, event);
    assert.equal(written.length, 6);
    assert.ok(written.some((chunk) => chunk.includes('"type":"response.function_call_arguments.delta"')));
    assert.ok(written.at(-1)?.includes('"sequence_number":5'));
    for (const model of ["truncated", "failed", "http-error"]) {
      const failures: BridgeEvent[] = [];
      for await (const event of adapter.respond({ ...baseRequest, model, stream: true }, new AbortController().signal)) failures.push(event);
      assert.equal(failures.at(-1)?.type, "response.failed");
      assert.ok(!failures.some((event) => event.type === "response.completed"));
      assert.ok(!JSON.stringify(failures).includes("native-fixture-key"));
    }
  } finally {
    release(); server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve()));
    if (previousPrivate === undefined) delete process.env.ALLOW_PRIVATE_UPSTREAMS; else process.env.ALLOW_PRIVATE_UPSTREAMS = previousPrivate;
  }
});
