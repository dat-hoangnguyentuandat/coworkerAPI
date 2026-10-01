import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalStore } from "../src/local-store.js";
import { buildServer } from "../src/app.js";

test("remote admin is opt-in, never permits network setup, and retains password/session/CSRF/origin protections", async () => {
  const previous = process.env.COWORKER_ADMIN_ALLOW_REMOTE;
  const directory = mkdtempSync(join(tmpdir(), "coworkerapi-remote-admin-"));
  const store = new LocalStore(join(directory, "state.json"));
  store.setup("bootstrap-test-password-long");
  const remoteAddress = "172.18.0.1";
  let app;
  try {
    delete process.env.COWORKER_ADMIN_ALLOW_REMOTE;
    app = buildServer(undefined, undefined, store);
    assert.equal((await app.inject({ method: "POST", url: "/api/admin/v1/login", remoteAddress, payload: { password: "bootstrap-test-password-long" } })).statusCode, 403);
    await app.close();
    process.env.COWORKER_ADMIN_ALLOW_REMOTE = "true";
    app = buildServer(undefined, undefined, store);
    assert.equal((await app.inject({ method: "POST", url: "/api/admin/v1/setup", remoteAddress, payload: { password: "another-password-long" } })).statusCode, 403);
    assert.equal((await app.inject({ method: "GET", url: "/api/admin/v1/overview", remoteAddress })).statusCode, 401);
    assert.equal((await app.inject({ method: "POST", url: "/api/admin/v1/login", remoteAddress, payload: { password: "incorrect" } })).statusCode, 401);
    const login = await app.inject({ method: "POST", url: "/api/admin/v1/login", remoteAddress, payload: { password: "bootstrap-test-password-long" } });
    assert.equal(login.statusCode, 200);
    const cookie = login.headers["set-cookie"] as string;
    const csrf = login.json().csrf;
    assert.equal((await app.inject({ method: "GET", url: "/api/admin/v1/overview", remoteAddress, headers: { cookie } })).statusCode, 200);
    assert.equal((await app.inject({ method: "POST", url: "/api/admin/v1/api-keys", remoteAddress, headers: { cookie }, payload: { name: "test" } })).statusCode, 403);
    assert.equal((await app.inject({ method: "POST", url: "/api/admin/v1/api-keys", remoteAddress, headers: { cookie, "x-coworker-csrf": csrf, origin: "https://other-origin.invalid" }, payload: { name: "test" } })).statusCode, 403);
    assert.equal((await app.inject({ method: "POST", url: "/api/admin/v1/api-keys", remoteAddress, headers: { cookie, "x-coworker-csrf": csrf }, payload: { name: "test" } })).statusCode, 201);
  } finally {
    await app?.close();
    rmSync(directory, { recursive: true, force: true });
    if (previous === undefined) delete process.env.COWORKER_ADMIN_ALLOW_REMOTE;
    else process.env.COWORKER_ADMIN_ALLOW_REMOTE = previous;
  }
});
