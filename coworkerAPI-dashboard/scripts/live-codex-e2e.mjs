#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, readFile, mkdir, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { startE2eProxy } from "./e2e-proxy.mjs";

const base = process.env.COWORKER_E2E_BASE_URL ?? "http://127.0.0.1:3212";
let token = process.env.COWORKER_E2E_API_KEY;
if (!token) {
  const settingsPath = resolve(homedir(), ".claude/settings.json");
  if (existsSync(settingsPath)) {
    const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
    const configuredBase = settings.env?.ANTHROPIC_BASE_URL;
    const key = settings.env?.ANTHROPIC_AUTH_TOKEN ?? settings.env?.ANTHROPIC_API_KEY;
    if (typeof configuredBase === "string" && new URL(configuredBase).origin === new URL(base).origin && typeof key === "string" && key.startsWith("cwapi_")) token = key;
  }
}
const reportDir = resolve("artifacts");
await mkdir(reportDir, { recursive: true });
const report = { startedAt: new Date().toISOString(), base, upstream: "real ChatGPT MCP widget", status: "blocked", checks: [] };
let proxy;
try {
  const health = await fetch(`${base}/health/inference`, { signal: AbortSignal.timeout(5000) });
  const state = await health.json();
  report.checks.push({ name: "gateway_ready", passed: health.ok, status: state.status });
  if (!health.ok) throw new Error(`Gateway not ready: ${state.status}`);
  if (!token) throw new Error("Set COWORKER_E2E_API_KEY to a CoworkerAPI key.");
  const executable = process.env.COWORKER_E2E_CODEX_BIN ?? (process.platform === "win32" ? resolve(process.env.LOCALAPPDATA ?? "", "Programs/OpenAI/Codex/bin/codex.exe") : "codex");
  const directory = await mkdtemp(join(tmpdir(), "coworkerapi-live-codex-"));
  report.workDirectory = directory;
  const target = join(directory, "index.html");
  report.requests = [];
  proxy = await startE2eProxy(base, (request) => report.requests.push(request));
  const args = ["exec", "--ignore-user-config", "--skip-git-repo-check", "--ephemeral", "--sandbox", "workspace-write", "--json", "--color", "never", "-m", "chatgpt-web",
    "-c", 'model_provider="coworkerapi_e2e"',
    "-c", 'approval_policy="never"',
    "-c", 'web_search="disabled"',
    "-c", 'default_permissions=":workspace"',
    "-c", 'windows.sandbox="unelevated"',
    "-c", `projects.${JSON.stringify(directory)}.trust_level="trusted"`,
    "-c", 'model_providers.coworkerapi_e2e.name="CoworkerAPI E2E"',
    "-c", `model_providers.coworkerapi_e2e.base_url=${JSON.stringify(`${proxy.base}/v1`)}`,
    "-c", 'model_providers.coworkerapi_e2e.env_key="COWORKER_E2E_API_KEY"',
    "-c", 'model_providers.coworkerapi_e2e.wire_api="responses"',
    "-c", 'model_providers.coworkerapi_e2e.requires_openai_auth=false',
    "-c", 'model_providers.coworkerapi_e2e.supports_websockets=false',
    "-c", 'model_providers.coworkerapi_e2e.stream_idle_timeout_ms=360000',
    `This is a fresh empty test directory. Create ${target} using a local file tool or shell command. Include <!doctype html>, a title CoworkerAPI Codex E2E, and an h1 Codex works. Verify the file contents using a local tool and then give a brief final confirmation.`];
  const child = spawn(executable, args, { cwd: directory, windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, COWORKER_E2E_API_KEY: token } });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { if (stdout.length < 1_000_000) stdout += chunk; });
  child.stderr.on("data", (chunk) => { if (stderr.length < 100_000) stderr += chunk; });
  const timer = setTimeout(() => child.kill(), 900_000);
  let code;
  try { code = await new Promise((resolve, reject) => { child.once("error", reject); child.once("close", resolve); }); }
  finally { clearTimeout(timer); }
  report.checks.push({ name: "codex_exit_zero", passed: code === 0, exitCode: code });
  const events = stdout.trim().split(/\r?\n/).filter(Boolean).map((line) => { try { return JSON.parse(line); } catch { return {}; } });
  report.eventTypes = [...new Set(events.map((event) => event.type).filter(Boolean))];
  report.itemTypes = [...new Set(events.map((event) => event.item?.type).filter(Boolean))];
  report.messages = events.filter((event) => ["error", "agent_message"].includes(event.item?.type)).map((event) => ({ type: event.item.type, text: String(event.item.text ?? event.item.message ?? "").replaceAll(token, "[redacted]").slice(0, 3000) }));
  const errors = events.filter((event) => event.type === "error" || event.type === "turn.failed").map((event) => event.message ?? event.error?.message);
  if (errors.length) report.errors = errors.map((error) => String(error).replaceAll(token, "[redacted]").slice(0, 3000));
  if (code !== 0) {
    report.diagnostic = stderr.replaceAll(token, "[redacted]").slice(-3000);
    throw new Error(`Codex exited with code ${code}.`);
  }
  const html = await readFile(target, "utf8");
  const valid = /<!doctype html>/i.test(html) && /<title>\s*CoworkerAPI Codex E2E\s*<\/title>/i.test(html) && /<h1[^>]*>\s*Codex works\s*<\/h1>/i.test(html);
  report.checks.push({ name: "requested_html_created", passed: valid, bytes: Buffer.byteLength(html) });
  if (!valid || !report.eventTypes.includes("turn.completed")) throw new Error("Codex did not complete the required file task.");
  report.status = "passed";
} catch (error) {
  report.failure = String(error?.message ?? error).replaceAll(token ?? "no-token-configured", "[redacted]");
  if (report.checks.some((check) => check.name === "codex_exit_zero")) report.status = "failed";
  process.exitCode = 1;
} finally {
  if (proxy) await proxy.stop();
  report.finishedAt = new Date().toISOString();
  await writeFile(join(reportDir, `live-codex-${report.startedAt.replace(/[:.]/g, "-")}.json`), JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
  await writeFile(join(reportDir, "live-codex-e2e.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report));
}
