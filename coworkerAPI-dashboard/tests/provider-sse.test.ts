import assert from "node:assert/strict";
import test from "node:test";
import { providerSseEvents } from "../src/provider-sse.js";

async function* split(bytes: Buffer) { for (const byte of bytes) yield Buffer.from([byte]); }
const collect = async (bytes: Buffer, limit?: number) => {
  const events = [];
  for await (const event of providerSseEvents(split(bytes), limit)) events.push(event);
  return events;
};
test("SSE parser handles fragmented UTF-8, CRLF, bare CR, multiline data and comments", async () => {
  const events = await collect(Buffer.from(': ping\r\nevent: response.output_text.delta\r\ndata: {"delta":"Tiếng Việt"}\r\n\r\ndata: first\rdata: second\r\revent: done\ndata: [DONE]\n\n'));
  assert.deepEqual(events, [
    { event: "response.output_text.delta", data: '{"delta":"Tiếng Việt"}' },
    { event: "message", data: "first\nsecond" },
    { event: "done", data: "[DONE]" },
  ]);
});
test("SSE parser rejects oversized, invalid UTF-8 and incomplete frames without exposing contents", async () => {
  await assert.rejects(collect(Buffer.from("data: secret\n")), /inside a frame/);
  await assert.rejects(collect(Buffer.from("secret-no-newline"), 3), /size limit/);
  await assert.rejects(collect(Buffer.from("data: secret\ndata: secret\n\n"), 15), /size limit/);
  await assert.rejects(collect(Buffer.from([0xc3, 0x28])), /invalid UTF-8/);
});
test("SSE parser yields a completed frame before the upstream stream ends", { timeout: 1000 }, async () => {
  let resume!: () => void;
  const gate = new Promise<void>((resolve) => { resume = resolve; });
  async function* upstream() {
    yield Buffer.from("data: first\n\n");
    await gate;
    yield Buffer.from("data: second\n\n");
  }
  const parser = providerSseEvents(upstream());
  try {
    assert.deepEqual(await parser.next(), { done: false, value: { event: "message", data: "first" } });
    resume();
    assert.deepEqual(await parser.next(), { done: false, value: { event: "message", data: "second" } });
    assert.equal((await parser.next()).done, true);
  } finally { resume(); await parser.return(undefined); }
});
