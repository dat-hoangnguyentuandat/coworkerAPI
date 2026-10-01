import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Script, createContext } from "node:vm";
import test from "node:test";
import { LocalStore, type RequestRecord } from "../src/local-store.js";
import { accumulateUsage, newUsageLedger, usageReport } from "../src/usage-ledger.js";
import { buildServer } from "../src/app.js";

const record = (id: string, overrides: Partial<RequestRecord> = {}): RequestRecord => ({ id, at: new Date().toISOString(), protocol: "anthropic-messages", status: 200, durationMs: 20, ...overrides });

test("persistent usage survives the metadata retention cap and restart without inventing token counts", () => {
  const directory = mkdtempSync(join(tmpdir(), "cwapi-usage-"));
  try {
    const file = join(directory, "state.json");
    const store = new LocalStore(file);
    for (let i = 0; i < 1002; i++) store.recordRequest(record(String(i), i === 0 ? { inputTokens: 7, outputTokens: 0, usageSource: "upstream", costEstimateUsd: 0.01 } : {}));
    const reopened = new LocalStore(file);
    assert.equal(reopened.listRequests().length, 1000);
    assert.equal(reopened.summary().requestsToday, 1002);
    const usage = reopened.usage();
    assert.equal(usage.coverage, "since-store-created");
    assert.equal(usage.days[0].requests, 1002);
    assert.deepEqual(usage.days[0].measurements.inputTokens, { sum: 7, known: 1, unknown: 1001 });
    assert.deepEqual(usage.days[0].measurements.outputTokens, { sum: 0, known: 1, unknown: 1001 });
    assert.deepEqual(usage.days[0].measurements.reasoningTokens, { sum: null, known: 0, unknown: 1002 });
    assert.deepEqual(usage.days[0].measurements.costEstimateUsd, { sum: 0.01, known: 1, unknown: 1001 });
    usage.days[0].requests = -1;
    assert.equal(reopened.usage().days[0].requests, 1002);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("legacy migration is explicitly partial, preserves state, and does not double count on reopen", () => {
  const directory = mkdtempSync(join(tmpdir(), "cwapi-usage-migration-"));
  try {
    const file = join(directory, "state.json");
    const original = new LocalStore(file);
    original.createKey("preserve");
    original.recordRequest(record("old", { at: "2025-01-01T01:00:00Z", status: 500 }));
    const legacy = JSON.parse(readFileSync(file, "utf8"));
    delete legacy.usage;
    writeFileSync(file, JSON.stringify(legacy));
    const migrated = new LocalStore(file);
    assert.equal(migrated.usage().coverage, "retained-history-plus-new");
    assert.equal(migrated.usage().days[0].day, "2025-01-01");
    assert.equal(migrated.usage().days[0].errors, 1);
    assert.deepEqual(migrated.listKeys(), original.listKeys());
    assert.equal(new LocalStore(file).usage().days[0].requests, 1);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("usage buckets use UTC and report measurement coverage, rejecting invalid numbers", () => {
  const ledger = newUsageLedger(false);
  accumulateUsage(ledger, record("a", { at: "2026-09-30T23:30:00-02:00", inputTokens: NaN, outputTokens: 1.5, ttftMs: 0, durationMs: Infinity }));
  accumulateUsage(ledger, record("b", { at: "2026-10-01T01:30:00Z", outcome: "cancelled", inputTokens: -1, cachedInputTokens: 4 }));
  const day = usageReport(ledger).days[0];
  assert.equal(day.day, "2026-10-01");
  assert.equal(day.errors, 1);
  assert.equal(day.averageLatencyMs, 20);
  assert.equal(day.latencyKnown, 1);
  assert.deepEqual(day.measurements.inputTokens, { sum: null, known: 0, unknown: 2 });
  assert.deepEqual(day.measurements.outputTokens, { sum: null, known: 0, unknown: 2 });
  assert.deepEqual(day.measurements.ttftMs, { sum: 0, known: 1, unknown: 1 });
  assert.throws(() => accumulateUsage(ledger, record("bad", { at: "invalid" })), /timestamp/);
  assert.equal(day.requests, 2);
});

test("usage endpoint is admin-only and metadata-only", async () => {
  const directory = mkdtempSync(join(tmpdir(), "cwapi-usage-admin-"));
  const store = new LocalStore(join(directory, "state.json"));
  const app = buildServer(undefined, undefined, store);
  try {
    store.recordRequest(Object.assign(record("a"), { prompt: "DO_NOT_STORE", apiKey: "DO_NOT_STORE" }));
    assert.equal((await app.inject({ method: "GET", url: "/api/admin/v1/usage" })).statusCode, 401);
    store.setup("test-password-long-enough");
    const login = await app.inject({ method: "POST", url: "/api/admin/v1/login", payload: { password: "test-password-long-enough" } });
    const response = await app.inject({ method: "GET", url: "/api/admin/v1/usage", headers: { cookie: login.headers["set-cookie"] as string } });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().days[0].requests, 1);
    assert.ok(!response.body.includes("DO_NOT_STORE"));
    assert.ok(!readFileSync(store.file, "utf8").includes("DO_NOT_STORE"));
    const html = await app.inject({ method: "GET", url: "/dashboard" });
    const script = html.body.match(/<script>([\s\S]*?)<\/script>/)![1];
    const content = { innerHTML: "", textContent: "" };
    const elements = new Map<string, unknown>([["content", content], ["auth-form", {}], ["auth-hint", {}], ["auth", { classList: { remove() {} } }], ["app", { classList: { add() {} } }]]);
    const browser = createContext({ Headers, setInterval() {}, document: {
      getElementById: (id: string) => elements.get(id) ?? null, querySelectorAll: () => [],
    }, fetch: async (url: string) => ({ ok: true, json: async () => url.endsWith("session") ? { initialized: true, loggedIn: false } : response.json() }) });
    new Script(script).runInContext(browser);
    await new Script("renderUsage()").runInContext(browser);
    assert.match(content.innerHTML, /Usage theo ngày \(UTC\)/);
    assert.match(content.innerHTML, /— \(1 chưa rõ\)/);
    assert.match(content.innerHTML, /Tổng hợp từ khi tạo kho dữ liệu/);
    assert.ok(!content.innerHTML.includes("DO_NOT_STORE"));
  } finally { await app.close(); rmSync(directory, { recursive: true, force: true }); }
});
