import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createContext, Script } from "node:vm";
import { buildServer } from "../src/app.js";
import { LocalStore } from "../src/local-store.js";
import { RequestLimits } from "../src/request-limits.js";

test("policy updates preserve active leases and prior minute history", () => {
  const limits = new RequestLimits(10, 3);
  const active = limits.acquire("key");
  assert.ok(active.allowed);
  limits.configure(1, 1);
  assert.equal(limits.acquire("key").allowed, false);
  active.release();
  const denied = limits.acquire("key");
  assert.ok(!denied.allowed && denied.reason === "rate");
  limits.configure(2, 1);
  const allowed = limits.acquire("key");
  assert.ok(allowed.allowed); allowed.release();
});

test("dashboard limits enforce auth/CSRF, execute browser form, persist and apply at runtime", async () => {
  const directory = mkdtempSync(join(tmpdir(), "coworkerapi-limits-admin-"));
  const file = join(directory, "state.json");
  const store = new LocalStore(file);
  store.setup("limits-admin-test-password");
  const clientKey = store.createKey("test-client").key;
  const app = buildServer(undefined, undefined, store);
  let reloaded: ReturnType<typeof buildServer> | undefined;
  try {
    assert.equal((await app.inject({ url: "/api/admin/v1/limits" })).statusCode, 401);
    const login = await app.inject({ method: "POST", url: "/api/admin/v1/login", payload: { password: "limits-admin-test-password" } });
    const headers = { cookie: login.headers["set-cookie"] as string, "x-coworker-csrf": login.json().csrf };
    const payload = { requestsPerMinute: 1, concurrentRequests: 1 };
    assert.equal((await app.inject({ method: "PUT", url: "/api/admin/v1/limits", headers: { cookie: headers.cookie }, payload })).statusCode, 403);
    assert.equal((await app.inject({ method: "PUT", url: "/api/admin/v1/limits", headers, payload: { ...payload, requestsPerMinute: 0 } })).statusCode, 400);
    assert.equal((await app.inject({ method: "PUT", url: "/api/admin/v1/limits", headers, payload })).statusCode, 200);
    const request = { method: "POST" as const, url: "/v1/responses", headers: { Authorization: `Bearer ${clientKey}` }, payload: { model: 7, input: "invalid model" } };
    assert.equal((await app.inject(request)).statusCode, 400);
    assert.equal((await app.inject(request)).statusCode, 429);
    reloaded = buildServer(undefined, undefined, new LocalStore(file));
    assert.equal((await reloaded.inject(request)).statusCode, 400);
    assert.equal((await reloaded.inject(request)).statusCode, 429);
    const page = await app.inject({ url: "/dashboard" });
    const script = page.body.match(/<script>([\s\S]*?)<\/script>/)?.[1];
    assert.ok(script);
    const elements = new Map<string, any>();
    for (const id of ["auth-hint", "auth", "app", "auth-form", "title", "bridge", "content", "limits-form", "limits-rpm", "limits-concurrent", "limits-result"]) {
      elements.set(id, { textContent: "", innerHTML: "", value: "", classList: { add() {}, remove() {} } });
    }
    const browser = createContext({ Headers, sessionCsrf: headers["x-coworker-csrf"], setInterval() {},
      document: { hidden: false, getElementById: (id: string) => elements.get(id), querySelectorAll: () => [] },
      fetch: async (url: string, options: RequestInit) => {
        const requestHeaders = Object.fromEntries(new Headers(options.headers).entries());
        requestHeaders.cookie = headers.cookie;
        const response = await app.inject({ method: (options.method ?? "GET") as "GET" | "PUT", url, headers: requestHeaders, payload: options.body as string | undefined });
        return { ok: response.statusCode < 400, json: async () => response.json() };
      },
    });
    new Script(script + ";csrf=sessionCsrf;").runInContext(browser);
    await new Script("renderLimits()").runInContext(browser);
    assert.equal(elements.get("limits-rpm").value, 1);
    elements.get("limits-rpm").value = "2";
    elements.get("limits-concurrent").value = "3";
    await elements.get("limits-form").onsubmit({ preventDefault() {} });
    assert.match(elements.get("limits-result").textContent, /Đã lưu/);
    assert.deepEqual(new LocalStore(file).getLimits(), { requestsPerMinute: 2, concurrentRequests: 3 });
    assert.equal((await app.inject(request)).statusCode, 400); // Prior minute count survived policy change.
    assert.equal((await app.inject(request)).statusCode, 429);
  } finally { await app.close(); await reloaded?.close(); }
});
