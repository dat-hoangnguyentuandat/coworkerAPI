import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { WidgetBridge } from "../src/widget-bridge.js";

const ownerA = randomUUID(), ownerB = randomUUID();
function queued(bridge: WidgetBridge) {
  const controller = new AbortController();
  const iterator = bridge.respond({ model: "chatgpt-web", input: "private-test-payload", stream: false }, controller.signal)[Symbol.asyncIterator]();
  const result = iterator.next();
  return { controller, result, iterator };
}

for (const stage of ["sync_throw", "async_reject", "deadline"] as const) {
test(`host failure stage ${stage} is owner-bound, deduplicated, and never authorizes resend`, async () => {
  const bridge = new WidgetBridge(0);
  const job = queued(bridge);
  const turn = bridge.claim("bridge-v5", ownerA)!;
  const send = (delivery: "send_started" | "send_failed" | "send_unknown", stage?: "sync_throw" | "async_reject" | "deadline", owner = ownerA) => bridge.leasedStatus(turn.request_id, owner, turn.claim_lease_id!, delivery, stage);
  const failure = stage === "deadline" ? "send_unknown" : "send_failed";
  send(failure, stage);
  assert.deepEqual(bridge.snapshot().hostFailureStages, { sync_throw: 0, async_reject: 0, deadline: 0, unspecified: 0 });
  assert.equal(send("send_started").delivery_permitted, true);
  assert.equal(send(failure, stage, ownerB).delivery_permitted, false);
  assert.equal(send(failure, stage).delivery_state, "unknown");
  send(failure, stage);
  assert.equal(bridge.snapshot().hostFailureStages[stage], 1);
  assert.equal(send("send_started").delivery_permitted, false);
  const snapshot = bridge.snapshot(); snapshot.hostFailureStages[stage] = 999;
  assert.equal(bridge.snapshot().hostFailureStages[stage], 1);
  assert.ok(!JSON.stringify(bridge.snapshot()).includes(turn.request_id));
  job.controller.abort(); await job.result; await job.iterator.return?.();
});
}

test("v5 diagnostic marks are owner-bound, deduplicated and non-authorizing metadata", async () => {
  const bridge = new WidgetBridge(0);
  const job = queued(bridge);
  const turn = bridge.claim("bridge-v5", ownerA)!;
  const report = (delivery: "send_started" | "ack_seen" | "host_invoked", owner = ownerA) => bridge.leasedStatus(turn.request_id, owner, turn.claim_lease_id!, delivery);
  assert.equal(report("ack_seen").delivery_permitted, false);
  assert.equal(bridge.snapshot().counts.ackSeen, 0, "Metadata cannot dispatch a reserved turn");
  report("send_started");
  assert.equal(bridge.snapshot().dispatchDiagnostics.awaitingAckReceipt, 1);
  report("ack_seen", ownerB);
  assert.equal(bridge.snapshot().counts.ackSeen, 0);
  report("ack_seen"); report("ack_seen");
  assert.equal(bridge.snapshot().dispatchDiagnostics.awaitingHostInvocation, 1);
  assert.equal(report("host_invoked").delivery_permitted, false);
  report("host_invoked");
  assert.equal(bridge.snapshot().dispatchDiagnostics.awaitingHostOutcome, 1);
  assert.equal(bridge.snapshot().counts.ackSeen, 1);
  assert.equal(bridge.snapshot().counts.hostInvoked, 1);
  assert.equal(await bridge.submit(turn.request_id, { text: "done" }), "accepted");
  await job.result; await job.iterator.return?.();
});

test("expired unsent lease is reclaimed; stale owner cannot dispatch or submit before ack", async (t) => {
  let now = 100_000;
  t.mock.method(Date, "now", () => now);
  const bridge = new WidgetBridge(0, 30_000);
  const job = queued(bridge);
  const first = bridge.claim("bridge-v4", ownerA)!;
  assert.equal(await bridge.submit(first.request_id, { text: "premature" }), "unknown_request");
  now += 30_001;
  const second = bridge.claim("bridge-v4", ownerB)!;
  assert.equal(second.request_id, first.request_id);
  assert.notEqual(second.claim_lease_id, first.claim_lease_id);
  assert.equal(bridge.leasedStatus(first.request_id, ownerA, first.claim_lease_id!, "send_started").delivery_permitted, false);
  assert.equal(bridge.leasedStatus(second.request_id, ownerB, second.claim_lease_id!, "send_started").delivery_permitted, true);
  assert.equal(bridge.leasedStatus(second.request_id, ownerB, second.claim_lease_id!, "send_started").delivery_permitted, false);
  assert.equal(bridge.snapshot().counts.repeatedSendStarts, 1);
  const snapshot = JSON.stringify(bridge.snapshot());
  for (const secret of [first.request_id, ownerA, ownerB, second.claim_lease_id!, "private-test-payload"]) assert.ok(!snapshot.includes(secret));
  assert.equal(bridge.snapshot().counts.recoveredClaims, 1);
  assert.equal(await bridge.submit(second.request_id, { text: "done" }), "accepted");
  await job.result;
  await job.iterator.return?.();
});

test("sending and unknown leases survive expiry without duplicate dispatch; late success and reminders are deduplicated", async (t) => {
  let now = 100_000;
  t.mock.method(Date, "now", () => now);
  const bridge = new WidgetBridge(0, 30_000);
  const job = queued(bridge);
  const turn = bridge.claim("bridge-v4", ownerA)!;
  const report = (state?: "send_started" | "send_unknown" | "sent" | "reminder") => bridge.leasedStatus(turn.request_id, ownerA, turn.claim_lease_id!, state);
  assert.equal(report("send_started").delivery_permitted, true);
  now += 40_000;
  assert.equal(bridge.claim("bridge-v4", ownerB), null);
  assert.equal(bridge.claim("bridge-v4", ownerA)!.delivery_state, "sending");
  report("send_unknown");
  now += 40_000;
  assert.equal(bridge.claim("bridge-v4", ownerB), null);
  assert.equal(report("send_started").delivery_permitted, false);
  report("sent"); report("sent");
  assert.equal(bridge.snapshot().counts.delivered, 1);
  assert.equal(report("reminder").delivery_permitted, false, "No reminder immediately after delivery");
  now += 60_000;
  assert.equal(report("reminder").delivery_permitted, true);
  assert.equal(report("reminder").delivery_permitted, false);
  job.controller.abort();
  await job.result;
  assert.equal(report("reminder").delivery_permitted, false);
  assert.equal(await bridge.submit(turn.request_id, { text: "late" }), "cancelled");
});

test("legacy failure without stage survives lease expiry without resend and accepts a late callback", async (t) => {
  let now = 100_000;
  t.mock.method(Date, "now", () => now);
  const bridge = new WidgetBridge(0, 30_000);
  const job = queued(bridge);
  const turn = bridge.claim("bridge-v5", ownerA)!;
  assert.equal(bridge.leasedStatus(turn.request_id, ownerA, turn.claim_lease_id!, "send_started").delivery_permitted, true);
  assert.equal(bridge.leasedStatus(turn.request_id, ownerA, turn.claim_lease_id!, "send_failed").delivery_state, "unknown");
  now += 120_001;
  assert.equal(bridge.claim("bridge-v5", ownerB), null);
  assert.equal(bridge.leasedStatus(turn.request_id, ownerA, turn.claim_lease_id!, "send_started").delivery_permitted, false);
  assert.equal(bridge.leasedStatus(turn.request_id, ownerB, turn.claim_lease_id!, "send_started").delivery_permitted, false);
  assert.equal(bridge.snapshot().counts.sendStarted, 1);
  assert.equal(bridge.snapshot().counts.recoveredClaims, 0);
  assert.equal(bridge.snapshot().counts.deliveryUnknown, 1);
  assert.equal(await bridge.submit(turn.request_id, { text: "late result" }), "accepted");
  await job.result; await job.iterator.return?.();
});
