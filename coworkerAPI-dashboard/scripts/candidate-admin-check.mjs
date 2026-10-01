#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";

const base = process.env.COWORKER_E2E_BASE_URL ?? "http://127.0.0.1:3212";
const report = { startedAt: new Date().toISOString(), base, status: "failed", checks: [] };
try {
  const initial = await (await fetch(`${base}/api/admin/v1/session`)).json();
  if (initial.initialized) throw new Error("This setup check requires an uninitialized isolated candidate dashboard.");
  const password = randomBytes(32).toString("base64url");
  const setup = await fetch(`${base}/api/admin/v1/setup`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
  if (!setup.ok) throw new Error(`Setup failed: HTTP ${setup.status}`);
  const login = await fetch(`${base}/api/admin/v1/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
  const session = await login.json();
  const cookie = login.headers.get("set-cookie")?.split(";")[0];
  if (!login.ok || !cookie || !session.csrf) throw new Error("Candidate dashboard login failed.");
  report.checks.push({ name: "setup_and_login", passed: true });
  const headers = { "Content-Type": "application/json", cookie, "x-coworker-csrf": session.csrf };
  const created = await fetch(`${base}/api/admin/v1/api-keys`, { method: "POST", headers, body: JSON.stringify({ name: "candidate-admin-e2e" }) });
  const key = await created.json();
  if (created.status !== 201 || !key.record?.id || !key.key) throw new Error("Candidate API key creation failed.");
  const models = await fetch(`${base}/v1/models`, { headers: { Authorization: `Bearer ${key.key}` } });
  if (!models.ok) throw new Error("The dashboard-created key did not authenticate.");
  report.checks.push({ name: "created_key_authenticates", passed: true });
  const alias = await fetch(`${base}/api/admin/v1/models/e2e-candidate-alias`, { method: "PUT", headers, body: JSON.stringify({ provider: "coworker-widget", upstreamModel: "chatgpt-web", enabled: true, supportsTools: true, supportsStreaming: true }) });
  if (!alias.ok) throw new Error("Candidate model alias creation failed.");
  const registered = await (await fetch(`${base}/v1/models`, { headers: { Authorization: `Bearer ${key.key}` } })).json();
  if (!registered.data.some((model) => model.id === "e2e-candidate-alias")) throw new Error("Model alias was not visible to API clients.");
  report.checks.push({ name: "model_alias_visible", passed: true });
  const originalLimits = await (await fetch(`${base}/api/admin/v1/limits`, { headers: { cookie } })).json();
  const limitedPolicy = { requestsPerMinute: 1, concurrentRequests: 1 };
  const forbiddenLimits = await fetch(`${base}/api/admin/v1/limits`, { method: "PUT", headers: { cookie, "Content-Type": "application/json" }, body: JSON.stringify(limitedPolicy) });
  if (forbiddenLimits.status !== 403) throw new Error("Limits mutation did not enforce CSRF.");
  const savedLimits = await fetch(`${base}/api/admin/v1/limits`, { method: "PUT", headers, body: JSON.stringify(limitedPolicy) });
  if (!savedLimits.ok) throw new Error("Candidate limits update failed.");
  const clientHeaders = { Authorization: `Bearer ${key.key}`, "Content-Type": "application/json" };
  const admissionProbe = () => fetch(`${base}/v1/responses`, { method: "POST", headers: clientHeaders, body: JSON.stringify({ model: 7, input: "invalid-model admission probe" }) });
  if ((await admissionProbe()).status !== 400) throw new Error("First admission probe was not admitted to schema validation.");
  const rateLimited = await admissionProbe();
  if (rateLimited.status !== 429 || Number(rateLimited.headers.get("retry-after")) < 1) throw new Error("Candidate minute limit did not return 429 with Retry-After.");
  const restored = await fetch(`${base}/api/admin/v1/limits`, { method: "PUT", headers, body: JSON.stringify({ requestsPerMinute: originalLimits.requestsPerMinute, concurrentRequests: originalLimits.concurrentRequests }) });
  if (!restored.ok) throw new Error("Candidate limit policy could not be restored.");
  report.checks.push({ name: "admin_limits_csrf_and_live_429", passed: true });
  const revoked = await fetch(`${base}/api/admin/v1/api-keys/${key.record.id}`, { method: "DELETE", headers: { cookie, "x-coworker-csrf": session.csrf } });
  if (!revoked.ok) throw new Error(`Candidate key revocation failed: HTTP ${revoked.status}`);
  const rejected = await fetch(`${base}/v1/models`, { headers: { Authorization: `Bearer ${key.key}` } });
  if (rejected.status !== 401) throw new Error("Revoked candidate key still authenticated.");
  report.checks.push({ name: "revoked_key_rejected", passed: true });
  const logs = await (await fetch(`${base}/api/admin/v1/requests`, { headers })).json();
  if (!logs.requests.some((request) => request.protocol === "models")) throw new Error("Candidate request logs were not visible.");
  report.checks.push({ name: "request_logs_visible", passed: true });
  if (process.env.COWORKER_E2E_PROVIDER_URL) {
    const credential = `provider-e2e-${randomBytes(24).toString("hex")}`;
    const saved = await fetch(`${base}/api/admin/v1/providers/e2e-native`, { method: "PUT", headers, body: JSON.stringify({ name: "Isolated provider probe", type: "openai-compatible", baseUrl: process.env.COWORKER_E2E_PROVIDER_URL, wireApi: "responses", enabled: true, apiKey: credential }) });
    if (!saved.ok) throw new Error(`Provider save failed: HTTP ${saved.status}`);
    const listed = await fetch(`${base}/api/admin/v1/providers`, { headers: { cookie } });
    const listText = await listed.text();
    const list = JSON.parse(listText);
    if (!listed.ok || listText.includes(credential) || listText.includes("ciphertext") || !list.providers.some((provider) => provider.id === "e2e-native" && provider.hasCredential)) throw new Error("Provider list did not safely expose saved metadata.");
    report.checks.push({ name: "provider_saved_without_secret_disclosure", passed: true });
    const tested = await fetch(`${base}/api/admin/v1/providers/e2e-native/test`, { method: "POST", headers: { cookie, "x-coworker-csrf": session.csrf } });
    const probe = await tested.json();
    if (!tested.ok || probe.connection !== "ok" || probe.authentication !== "ok" || !probe.models.includes("fixture-model")) throw new Error(`Provider connection test failed: HTTP ${tested.status}`);
    report.checks.push({ name: "native_provider_model_probe", passed: true, upstream: "isolated HTTP fixture, not native inference" });
  }
  await fetch(`${base}/api/admin/v1/logout`, { method: "POST", headers, body: "{}" });
  report.status = "passed";
} catch (error) {
  report.failure = String(error?.message ?? error);
  process.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString();
  const dir = resolve("artifacts");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "candidate-admin-e2e.json"), JSON.stringify(report, null, 2) + "\n");
  await writeFile(join(dir, `candidate-admin-e2e-${report.startedAt.replace(/[:.]/g, "-")}.json`), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report));
}
