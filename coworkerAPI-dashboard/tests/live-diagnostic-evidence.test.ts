import assert from "node:assert/strict";
import test from "node:test";
const { safeDiagnostic, diagnosticDelta } = await import(new URL("../scripts/live-diagnostic-evidence.mjs", import.meta.url).href);
test("live diagnostic evidence strips unknown fields and unsafe values", () => {
  const value = safeDiagnostic({ version: "0.1.2-test.20", secret: "PRIVATE" }, { connected: true, pending: -1, runtime: { last: "bridge-v7", secret: "PRIVATE" }, counts: { queued: 2, submitted: Infinity, secret: "PRIVATE" } });
  assert.equal(value.gatewayVersion, "0.1.2-test.20");
  assert.equal(value.runtime, "bridge-v7");
  assert.equal(value.pending, null);
  assert.equal(value.counts.submitted, null);
  assert.ok(!JSON.stringify(value).includes("PRIVATE"));
  assert.equal(safeDiagnostic({ version: "PRIVATE" }, null).gatewayVersion, null);
});
test("live diagnostic deltas reject incomplete/reset/mismatched snapshots", () => {
  const empty = safeDiagnostic({ version: "0.1.2" }, {});
  const initial = { ...empty, counts: Object.fromEntries(Object.keys(empty.counts).map(k => [k, 3])) };
  const final = { ...initial, counts: { ...initial.counts, queued: 5 } };
  assert.equal(diagnosticDelta(initial, final).counts.queued, 2);
  assert.equal(diagnosticDelta(initial, empty).comparable, false);
  assert.equal(diagnosticDelta(initial, { ...final, gatewayVersion: "0.1.3" }).comparable, false);
  assert.equal(diagnosticDelta(initial, { ...final, counts: { ...final.counts, submitted: 0 } }).counts.queued, null);
});
test("host stage and tool transport evidence is allowlisted and independently comparable", () => {
  const initial = safeDiagnostic({ version: "0.1.2" }, { hostFailureStages: { sync_throw: 0, async_reject: 0, deadline: 2, unspecified: 3, private: "PRIVATE" }, hostTransports: { "mcp-apps": 10, "openai-alias": 0, unspecified: 4, private: "PRIVATE" } });
  const final = safeDiagnostic({ version: "0.1.2" }, { hostFailureStages: { sync_throw: 0, async_reject: 1, deadline: 2, unspecified: 3 }, hostTransports: { "mcp-apps": 12, "openai-alias": 0, unspecified: 4 } });
  const delta = diagnosticDelta(initial, final);
  assert.equal(delta.comparable, false);
  assert.equal(delta.hostFailureStages.comparable, true);
  assert.equal(delta.hostFailureStages.values.async_reject, 1);
  assert.equal(delta.hostToolTransports.values["mcp-apps"], 2);
  assert.ok(!JSON.stringify(initial).includes("PRIVATE"));
  const reset = { ...final, hostFailureStages: { ...final.hostFailureStages, deadline: 0 } };
  assert.equal(diagnosticDelta(initial, reset).hostFailureStages.comparable, false);
});
