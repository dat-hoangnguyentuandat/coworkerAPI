import assert from "node:assert/strict";
import test from "node:test";
import { WidgetBridge } from "../src/widget-bridge.js";

test("cancelled claimed turns drain until the late callback, which never satisfies the next client", async () => {
  const bridge = new WidgetBridge();
  const controller = new AbortController();
  const first = bridge.respond({ model: "chatgpt-web", input: "first", stream: false }, controller.signal)[Symbol.asyncIterator]();
  const firstEvent = first.next();
  const oldTurn = bridge.claim();
  assert.ok(oldTurn);
  controller.abort();
  assert.equal((await firstEvent).value?.type, "response.failed");
  assert.equal(bridge.pendingCount, 0);
  assert.equal(bridge.snapshot().draining, 1);
  const second = bridge.respond({ model: "chatgpt-web", input: "second", stream: false }, new AbortController().signal)[Symbol.asyncIterator]();
  const secondEvent = second.next();
  assert.equal(bridge.claim(), null, "Do not send another turn while the cancelled ChatGPT turn is draining");
  assert.equal(await bridge.submit(oldTurn.request_id, { text: "old answer" }), "cancelled");
  assert.equal(bridge.snapshot().draining, 0);
  const nextTurn = bridge.claim();
  assert.ok(nextTurn);
  assert.notEqual(nextTurn.request_id, oldTurn.request_id);
  assert.equal(await bridge.submit(oldTurn.request_id, { text: "duplicate old answer" }), "cancelled");
  assert.equal(bridge.pendingCount, 1, "A stale callback cannot complete another client request");
  assert.equal(await bridge.submit(nextTurn.request_id, { text: "new answer" }), "accepted");
  assert.deepEqual((await secondEvent).value, { type: "response.output_text.delta", delta: "new answer" });
  assert.equal((await second.next()).value?.type, "response.completed");
  await second.return?.();
  await first.return?.();
  bridge.shutdown();
});

test("cancelled turn drain is bounded when ChatGPT never submits a late callback", async () => {
  const bridge = new WidgetBridge(10);
  const controller = new AbortController();
  const first = bridge.respond({ model: "chatgpt-web", input: "first", stream: false }, controller.signal)[Symbol.asyncIterator]();
  const event = first.next();
  assert.ok(bridge.claim());
  controller.abort();
  await event;
  assert.equal(bridge.snapshot().draining, 1);
  await new Promise((yes) => setTimeout(yes, 20));
  assert.equal(bridge.snapshot().draining, 0);
  await first.return?.();
  bridge.shutdown();
});
