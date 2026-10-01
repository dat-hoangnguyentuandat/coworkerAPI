import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createContext, Script } from "node:vm";
import { randomBytes } from "node:crypto";
import { buildServer } from "../src/app.js";
import { LocalStore } from "../src/local-store.js";

test("model dashboard edits and persists enabled/tools/SSE flags without silently re-enabling them", async () => {
  const store = new LocalStore(join(mkdtempSync(join(tmpdir(), "coworkerapi-model-admin-")), "state.json"), randomBytes(32).toString("hex"));
  store.upsertProvider({ id: "native-response", name: "Native Responses", type: "openai-compatible", baseUrl: "https://example.com/v1", wireApi: "responses", enabled: true }, "browser-native-fixture-key");
  store.upsertProvider({ id: "native-anthropic", name: "Native Messages", type: "anthropic", baseUrl: "https://example.com", enabled: true }, "browser-messages-fixture-key");
  store.setup("model-admin-test-password");
  store.upsertModel({ id: "limited-model", provider: "coworker-widget", upstreamModel: "chatgpt-web", enabled: false, supportsTools: false, supportsStreaming: false });
  const app = buildServer(undefined, undefined, store);
  try {
    const login = await app.inject({ method: "POST", url: "/api/admin/v1/login", payload: { password: "model-admin-test-password" } });
    const cookie = login.headers["set-cookie"] as string;
    const script = (await app.inject({ url: "/dashboard" })).body.match(/<script>([\s\S]*?)<\/script>/)?.[1];
    assert.ok(script);
    const elements = new Map<string, any>();
    for (const id of ["auth-hint", "auth", "app", "auth-form", "title", "bridge", "content", "model-list", "model-form", "model-id", "model-provider", "upstream-model", "model-enabled", "model-tools", "model-streaming", "model-result"]) {
      elements.set(id, { textContent: "", innerHTML: "", value: "", checked: true, classList: { add() {}, remove() {} } });
    }
    const edit = { dataset: { editModel: "limited-model" }, onclick: undefined as undefined | (() => void) };
    const browser = createContext({ Headers, sessionCsrf: login.json().csrf, setInterval() {},
      document: { hidden: false, getElementById: (id: string) => elements.get(id), querySelectorAll: (selector: string) => selector === "[data-edit-model]" ? [edit] : [] },
      fetch: async (url: string, options: RequestInit) => {
        const headers = Object.fromEntries(new Headers(options.headers).entries());
        headers.cookie = cookie;
        const response = await app.inject({ method: (options.method ?? "GET") as "GET" | "PUT", url, headers, payload: options.body as string | undefined });
        return { ok: response.statusCode < 400, json: async () => response.json() };
      },
    });
    new Script(script + ";csrf=sessionCsrf;").runInContext(browser);
    await new Script("renderModels()").runInContext(browser);
    edit.onclick!();
    assert.equal(elements.get("model-id").value, "limited-model");
    for (const flag of ["model-enabled", "model-tools", "model-streaming"]) assert.equal(elements.get(flag).checked, false);
    elements.get("upstream-model").value = "new-upstream";
    await elements.get("model-form").onsubmit({ preventDefault() {} });
    const persisted = new LocalStore(store.file).listModels().find((model) => model.id === "limited-model");
    assert.deepEqual(persisted, { id: "limited-model", provider: "coworker-widget", upstreamModel: "new-upstream", enabled: false, supportsTools: false, supportsStreaming: false });
    assert.match(elements.get("model-result").textContent, /Đã lưu/);
    assert.match(elements.get("content").innerHTML, /native-response/);
    elements.get("model-id").value = "native-alias";
    elements.get("model-provider").value = "native-response";
    elements.get("upstream-model").value = "native-upstream";
    elements.get("model-enabled").checked = true;
    await elements.get("model-form").onsubmit({ preventDefault() {} });
    assert.equal(store.listModels().find((model) => model.id === "native-alias")?.provider, "native-response");
    assert.match(elements.get("content").innerHTML, /native-anthropic/);
    elements.get("model-id").value = "messages-alias";
    elements.get("model-provider").value = "native-anthropic";
    await elements.get("model-form").onsubmit({ preventDefault() {} });
    assert.equal(new LocalStore(store.file).listModels().find((model) => model.id === "messages-alias")?.provider, "native-anthropic");
  } finally { await app.close(); }
});
