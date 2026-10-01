import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createContext, Script } from "node:vm";
import { buildServer } from "../src/app.js";
import { LocalStore } from "../src/local-store.js";

test("admin provider CRUD protects credentials, requires CSRF, and tests bridge status", async () => {
  const directory = mkdtempSync(join(tmpdir(), "coworkerapi-provider-admin-"));
  const file = join(directory, "state.json");
  const store = new LocalStore(file, randomBytes(32).toString("hex"));
  store.setup("provider-admin-test-password");
  const app = buildServer(undefined, undefined, store);
  try {
    assert.equal((await app.inject({ url: "/api/admin/v1/providers" })).statusCode, 401);
    const login = await app.inject({ method: "POST", url: "/api/admin/v1/login", payload: { password: "provider-admin-test-password" } });
    const headers = { cookie: login.headers["set-cookie"] as string, "x-coworker-csrf": login.json().csrf };
    const payload = { name: "Native provider", type: "openai-compatible", baseUrl: "https://example.com/v1", enabled: true, apiKey: "admin-upstream-test-key" };
    assert.equal((await app.inject({ method: "PUT", url: "/api/admin/v1/providers/native", headers: { cookie: headers.cookie }, payload })).statusCode, 403);
    assert.equal((await app.inject({ method: "PUT", url: "/api/admin/v1/providers/native", headers, payload })).statusCode, 200);
    assert.ok(!readFileSync(file, "utf8").includes(payload.apiKey));
    const list = await app.inject({ url: "/api/admin/v1/providers", headers });
    assert.ok(!list.body.includes(payload.apiKey));
    assert.ok(!list.body.includes("ciphertext"));
    assert.equal(list.json().providers[0].hasCredential, true);
    const dashboard = await app.inject({ url: "/dashboard" });
    const script = dashboard.body.match(/<script>([\s\S]*?)<\/script>/)?.[1];
    assert.ok(script);
    const elements = new Map<string, any>();
    for (const id of ["auth-hint", "auth", "app", "auth-form", "title", "bridge", "content", "provider-list", "provider-result", "provider-form", "provider-id", "provider-name", "provider-type", "provider-url", "provider-key", "provider-wire", "provider-enabled"]) elements.set(id, { textContent: "", innerHTML: "", value: "", checked: true, classList: { add() {}, remove() {} } });
    const browser = createContext({
      Headers,
      sessionCsrf: headers["x-coworker-csrf"],
      document: { hidden: false, getElementById: (id: string) => elements.get(id), querySelectorAll: () => [] },
      setInterval() {},
      fetch: async (url: string, options: RequestInit) => {
        const requestHeaders = Object.fromEntries(new Headers(options.headers).entries());
        requestHeaders.cookie = headers.cookie;
        const response = await app.inject({ method: (options.method ?? "GET") as "GET" | "PUT", url, headers: requestHeaders, payload: options.body as string | undefined });
        return { ok: response.statusCode < 400, json: async () => response.json() };
      },
    });
    new Script(script).runInContext(browser);
    await new Script("csrf=sessionCsrf; renderProviders()").runInContext(browser);
    assert.match(elements.get("provider-list").innerHTML, /Native provider/);
    assert.ok(!elements.get("provider-list").innerHTML.includes(payload.apiKey));
    elements.get("provider-id").value = "browser-provider";
    elements.get("provider-name").value = "Provider from browser";
    elements.get("provider-type").value = "openai-compatible";
    elements.get("provider-url").value = "https://example.com/v1";
    elements.get("provider-wire").value = "responses";
    elements.get("provider-key").value = "browser-provider-test-key";
    await elements.get("provider-form").onsubmit({ preventDefault() {}, submitter: { disabled: false } });
    assert.equal(store.providerKey("browser-provider"), "browser-provider-test-key");
    assert.equal(elements.get("provider-key").value, "");
    assert.ok(!readFileSync(file, "utf8").includes("browser-provider-test-key"));
    assert.match(elements.get("provider-result").textContent, /Đã lưu/);
    assert.equal((await app.inject({ method: "PUT", url: "/api/admin/v1/providers/blocked", headers, payload: { ...payload, baseUrl: "https://127.0.0.1/v1" } })).statusCode, 400);
    const { apiKey: _key, ...metadata } = payload;
    assert.equal((await app.inject({ method: "PUT", url: "/api/admin/v1/providers/native", headers, payload: { ...metadata, enabled: false } })).statusCode, 200);
    assert.equal((await app.inject({ method: "POST", url: "/api/admin/v1/providers/native/test", headers })).statusCode, 409);
    assert.equal((await app.inject({ method: "PUT", url: "/api/admin/v1/providers/bridge", headers, payload: { name: "ChatGPT", type: "coworker-widget", enabled: true } })).statusCode, 200);
    const probe = await app.inject({ method: "POST", url: "/api/admin/v1/providers/bridge/test", headers });
    assert.equal(probe.statusCode, 200);
    assert.equal(probe.json().connection, "not_connected");
  } finally { await app.close(); rmSync(directory, { recursive: true, force: true }); }
});
