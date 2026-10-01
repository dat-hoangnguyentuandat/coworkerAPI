import assert from "node:assert/strict";
import test from "node:test";
import { RequestLimits } from "../src/request-limits.js";
import { buildServer } from "../src/app.js";
import { WidgetBridge } from "../src/widget-bridge.js";

test("limits isolate credentials, bound cardinality, expire windows, and release once", () => {
  let now = 1000;
  const limits = new RequestLimits(2, 1, 2, () => now);
  const first = limits.acquire("first");
  assert.ok(first.allowed);
  assert.deepEqual(limits.acquire("first"), { allowed: false, reason: "concurrency", retryAfter: 1 });
  first.release(); first.release();
  const second = limits.acquire("first");
  assert.ok(second.allowed); second.release();
  assert.deepEqual(limits.acquire("first"), { allowed: false, reason: "rate", retryAfter: 60 });
  const other = limits.acquire("other");
  assert.ok(other.allowed);
  assert.deepEqual(limits.acquire("third"), { allowed: false, reason: "capacity", retryAfter: 60 });
  now += 60_000;
  const third = limits.acquire("third");
  assert.ok(third.allowed); third.release(); other.release();
  assert.throws(() => new RequestLimits(0));
});

test("gateway emits protocol-shaped 429 and releases concurrency on client abort", async () => {
  const previous = { keys: process.env.COWORKER_API_KEYS, concurrent: process.env.COWORKER_CONCURRENT_REQUESTS };
  process.env.COWORKER_API_KEYS = "limited-key";
  process.env.COWORKER_CONCURRENT_REQUESTS = "1";
  const bridge = new WidgetBridge(0);
  const app = buildServer(bridge, "test-secret");
  const abort = new AbortController();
  try {
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    assert.ok(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}`;
    const headers = { Authorization: "Bearer limited-key", "Content-Type": "application/json" };
    const pending = fetch(`${base}/v1/responses`, { method: "POST", headers, body: JSON.stringify({ model: "chatgpt-web", input: "wait" }), signal: abort.signal }).catch(() => null);
    for (let i = 0; !bridge.pendingCount && i < 100; i++) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(bridge.pendingCount, 1);
    const limited = await fetch(`${base}/v1/messages`, { method: "POST", headers: { "x-api-key": "limited-key", "Content-Type": "application/json" }, body: JSON.stringify({ model: "chatgpt-web", max_tokens: 10, messages: [{ role: "user", content: "hello" }] }) });
    assert.equal(limited.status, 429);
    assert.equal(limited.headers.get("retry-after"), "1");
    assert.equal((await limited.json()).error.type, "rate_limit_error");
    abort.abort(); await pending;
    for (let i = 0; bridge.pendingCount && i < 100; i++) await new Promise((resolve) => setTimeout(resolve, 10));
    const next = await app.inject({ method: "POST", url: "/v1/responses", headers, payload: { model: 7, input: "invalid model" } });
    assert.equal(next.statusCode, 400); // Admitted, then rejected by schema, not stale concurrency.
  } finally {
    abort.abort(); app.server.closeAllConnections(); await app.close();
    if (previous.keys === undefined) delete process.env.COWORKER_API_KEYS; else process.env.COWORKER_API_KEYS = previous.keys;
    if (previous.concurrent === undefined) delete process.env.COWORKER_CONCURRENT_REQUESTS; else process.env.COWORKER_CONCURRENT_REQUESTS = previous.concurrent;
  }
});

test("unauthenticated requests do not consume the shared cross-protocol minute budget", async () => {
  const previous = { keys: process.env.COWORKER_API_KEYS, rate: process.env.COWORKER_REQUESTS_PER_MINUTE };
  process.env.COWORKER_API_KEYS = "minute-key";
  process.env.COWORKER_REQUESTS_PER_MINUTE = "1";
  const app = buildServer();
  try {
    const invalid = await app.inject({ method: "POST", url: "/v1/responses", headers: { Authorization: "Bearer wrong-key" }, payload: { model: 7, input: "ignored" } });
    assert.equal(invalid.statusCode, 401);
    const admitted = await app.inject({ method: "POST", url: "/v1/responses", headers: { Authorization: "Bearer minute-key" }, payload: { model: 7, input: "invalid model" } });
    assert.equal(admitted.statusCode, 400);
    const limited = await app.inject({ method: "POST", url: "/v1/chat/completions", headers: { "x-api-key": "minute-key" }, payload: { model: "chatgpt-web", messages: [] } });
    assert.equal(limited.statusCode, 429);
    assert.equal(limited.json().error.code, "rate_limit_exceeded");
    assert.ok(Number(limited.headers["retry-after"]) > 0);
    assert.ok(!limited.body.includes("minute-key"));
  } finally {
    await app.close();
    if (previous.keys === undefined) delete process.env.COWORKER_API_KEYS; else process.env.COWORKER_API_KEYS = previous.keys;
    if (previous.rate === undefined) delete process.env.COWORKER_REQUESTS_PER_MINUTE; else process.env.COWORKER_REQUESTS_PER_MINUTE = previous.rate;
  }
});
