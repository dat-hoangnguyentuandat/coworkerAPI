import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Script, createContext } from "node:vm";
import { buildServer } from "../src/app.js";
import { LocalStore } from "../src/local-store.js";

test("local dashboard initializes, manages hashed API keys, and persists models", async () => {
  const directory = mkdtempSync(join(tmpdir(), "coworkerapi-dashboard-"));
  const file = join(directory, "state.json");
  const previousKeys = process.env.COWORKER_API_KEYS;
  delete process.env.COWORKER_API_KEYS;
  const store = new LocalStore(file);
  const app = buildServer(undefined, undefined, store);
  try {
    const page = await app.inject({ method: "GET", url: "/dashboard" });
    assert.equal(page.statusCode, 200);
    assert.match(page.body, /CoworkerAPI/);
    assert.match(page.body, /<label for="password">/);
    assert.match(page.body, /minlength="6"/);
    assert.match(page.body, /prefers-reduced-motion/);
    assert.match(page.body, /focus-visible/);
    assert.match(page.body, /data-theme=light/);
    assert.match(page.body, /<dialog id="confirm-dialog"/);
    assert.match(page.body, /id="tour-card"/);
    assert.match(page.body, /id="show-tour"/);
    assert.match(page.body, /coworkerapi\.onboarding\.v1/);
    assert.match(page.body, /id="tour-hide"[^>]*><span data-i18n="ui.hide_for_now">Ẩn tạm<\/span>/);
    assert.match(page.body, /Tiến độ được lưu trong trình duyệt/);
    assert.match(page.body, /Giới hạn tương thích/);
    assert.match(page.body, /Cách đọc số liệu/);
    assert.match(page.body, /Cách đọc nhật ký/);
    assert.ok(!page.body.includes('Một gateway, các công cụ AI của bạn.'));
    assert.ok(!page.body.includes('Kết nối chính thức qua plugin'));
    assert.equal((page.body.match(/data-page="[a-z]+"/g) ?? []).length, 9);
    assert.ok(!page.body.includes('Local gateway · v0.1 test'));
    assert.ok(!page.body.includes('fonts.googleapis.com'));
    const activationLink = page.body.match(/(https:\/\/chatgpt\.com\/\?q=[^"\\<>\s]+)/);
    assert.ok(activationLink);
    assert.equal(new URL(activationLink[1]).searchParams.get("q"), "Use the CoworkerAPI plugin tool workbench_api_activate now to open the CoworkerAPI bridge widget in this new chat.");
    const browserScript = page.body.match(/<script>([\s\S]*?)<\/script>/);
    assert.ok(browserScript);
    assert.doesNotThrow(() => new Script(browserScript[1]));
    const elements = new Map<string, { textContent: string; innerHTML: string; className: string; classList: { add(): void; remove(): void } }>();
    for (const id of ["auth-hint", "auth", "app", "auth-form", "title", "bridge", "content"]) elements.set(id, { textContent: "", innerHTML: "", className: "", classList: { add() {}, remove() {} } });
    const browserCalls: { url: string; options: RequestInit }[] = [];
    const browser = createContext({
      Headers,
      document: { hidden: false, getElementById: (id: string) => elements.get(id) ?? null, querySelectorAll: () => [] },
      setInterval() {},
      fetch: async (url: string, options: RequestInit) => {
        browserCalls.push({ url, options });
        return { ok: true, json: async () => url.endsWith("session") ? { initialized: true, loggedIn: false } : { bridge: "widget_not_connected", tunnel: { state: "disabled" }, endpoint: "http://127.0.0.1:3211", requestsToday: 0, activeKeys: 0, errorsToday: 0, averageLatencyMs: 0 } };
      },
    });
    new Script(browserScript[1]).runInContext(browser);
    await new Script("render()").runInContext(browser);
    assert.match(elements.get("content")!.innerHTML, /Mở bridge trong ChatGPT/);
    assert.equal(elements.get("content")!.textContent, "");
    assert.equal(elements.get("bridge")!.textContent, "Chờ kết nối");
    const initial = await app.inject({ method: "GET", url: "/api/admin/v1/session" });
    assert.equal(initial.json().initialized, false);
    assert.throws(() => store.setup("12345"), /6–256/);
    assert.equal((await app.inject({ method: "POST", url: "/api/admin/v1/setup", payload: { password: "12345" } })).statusCode, 400);
    const setup = await app.inject({ method: "POST", url: "/api/admin/v1/setup", payload: { password: "123456" } });
    assert.equal(setup.statusCode, 200);
    assert.equal(new LocalStore(file).verifyPassword("123456"), true);
    assert.equal(store.setup("another-password"), false);
    const login = await app.inject({ method: "POST", url: "/api/admin/v1/login", payload: { password: "123456" } });
    assert.equal(login.statusCode, 200);
    const cookie = login.headers["set-cookie"] as string;
    const csrf = login.json().csrf as string;
    await new Script("api('api-keys/example', {method:'DELETE'})").runInContext(browser);
    assert.equal(new Headers(browserCalls.at(-1)!.options.headers).has("content-type"), false);
    await new Script("api('api-keys', {method:'POST',body:'{}',headers:{'x-custom':'retained'}})").runInContext(browser);
    assert.equal(new Headers(browserCalls.at(-1)!.options.headers).get("content-type"), "application/json");
    assert.equal(new Headers(browserCalls.at(-1)!.options.headers).get("x-custom"), "retained");
    const overview = await app.inject({ method: "GET", url: "/api/admin/v1/overview", headers: { cookie } });
    assert.deepEqual(overview.json().tunnel, { state: "disabled", message: "Tunnel is not configured." });
    const withoutCsrf = await app.inject({ method: "POST", url: "/api/admin/v1/api-keys", headers: { cookie }, payload: { name: "CLI" } });
    assert.equal(withoutCsrf.statusCode, 403);
    const created = await app.inject({ method: "POST", url: "/api/admin/v1/api-keys", headers: { cookie, "x-coworker-csrf": csrf }, payload: { name: "CLI" } });
    assert.equal(created.statusCode, 201);
    const key = created.json().key as string;
    const id = created.json().record.id as string;
    assert.match(key, /^cwapi_/);
    const models = await app.inject({ method: "GET", url: "/v1/models", headers: { authorization: `Bearer ${key}` } });
    assert.equal(models.statusCode, 200);
    assert.equal(models.json().data[0].id, "chatgpt-web");
    assert.ok(!JSON.stringify(store.listKeys()).includes(key));
    const alias = await app.inject({ method: "PUT", url: "/api/admin/v1/models/coding-main", headers: { cookie, "x-coworker-csrf": csrf }, payload: { provider: "coworker-widget", upstreamModel: "chatgpt-web", enabled: true, supportsTools: true, supportsStreaming: true } });
    assert.equal(alias.statusCode, 200);
    assert.ok(new LocalStore(file).listModels().some((item) => item.id === "coding-main"));
    await new Script("api('api-keys/example', {method:'DELETE'})").runInContext(browser);
    const browserHeaders = new Headers(browserCalls.at(-1)!.options.headers);
    browserHeaders.set("cookie", cookie);
    browserHeaders.set("x-coworker-csrf", csrf);
    const revoke = await app.inject({ method: "DELETE", url: `/api/admin/v1/api-keys/${id}`, headers: Object.fromEntries(browserHeaders.entries()) });
    assert.equal(revoke.statusCode, 200);
    const denied = await app.inject({ method: "GET", url: "/v1/models", headers: { authorization: `Bearer ${key}` } });
    assert.equal(denied.statusCode, 401);
  } finally {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
    if (previousKeys === undefined) delete process.env.COWORKER_API_KEYS;
    else process.env.COWORKER_API_KEYS = previousKeys;
  }
});
