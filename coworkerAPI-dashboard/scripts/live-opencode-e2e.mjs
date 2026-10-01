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
  const path = resolve(homedir(), ".claude/settings.json");
  if (existsSync(path)) {
    const settings = JSON.parse(readFileSync(path, "utf8"));
    const configuredBase = settings.env?.ANTHROPIC_BASE_URL;
    const key = settings.env?.ANTHROPIC_AUTH_TOKEN ?? settings.env?.ANTHROPIC_API_KEY;
    if (typeof configuredBase === "string" && new URL(configuredBase).origin === new URL(base).origin && typeof key === "string" && key.startsWith("cwapi_")) token = key;
  }
}
const reportDir = resolve("artifacts");
await mkdir(reportDir, { recursive: true });
const report = { startedAt: new Date().toISOString(), base, upstream: "real ChatGPT MCP widget", status: "blocked", checks: [], requests: [] };
let proxy;
try {
  const health = await fetch(`${base}/health/inference`, { signal: AbortSignal.timeout(5000) });
  const state = await health.json();
  report.checks.push({ name: "gateway_ready", passed: health.ok, status: state.status });
  if (!health.ok) throw new Error(`Gateway not ready: ${state.status}`);
  if (!token) throw new Error("Set COWORKER_E2E_API_KEY.");
  proxy = await startE2eProxy(base, (request) => report.requests.push(request));
  const directory = await mkdtemp(join(tmpdir(), "coworkerapi-live-opencode-"));
  report.workDirectory = directory;
  const target = join(directory, "index.html");
  const config = {
    model: "coworkerapi_e2e/chatgpt-web", small_model: "coworkerapi_e2e/chatgpt-web", enabled_providers: ["coworkerapi_e2e"], share: "disabled", autoupdate: false,
    provider: { coworkerapi_e2e: { npm: "@ai-sdk/openai-compatible", name: "CoworkerAPI E2E", options: { baseURL: `${proxy.base}/v1`, apiKey: "{env:COWORKER_E2E_API_KEY}" }, models: { "chatgpt-web": { name: "ChatGPT bridge", limit: { context: 128000, output: 4096 } } } } },
    permission: { "*": "deny", read: "allow", write: "allow", edit: "allow", bash: { "*": "deny", "node *": "allow" } },
  };
  const executable = process.env.COWORKER_E2E_OPENCODE_BIN ?? (process.platform === "win32" ? resolve(process.env.APPDATA ?? "", "npm/node_modules/opencode-ai/bin/opencode.exe") : "opencode");
  const prompt = `This is a newly created empty directory. Create ${target} using your local file tool. Include <!doctype html>, a title CoworkerAPI OpenCode E2E, and an h1 OpenCode works. Read the file using a local tool to verify it, then give a short final confirmation.`;
  const child = spawn(executable, ["run", "--pure", "--format", "json", "--title", "CoworkerAPI E2E", "-m", "coworkerapi_e2e/chatgpt-web", prompt], {
    cwd: directory, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, COWORKER_E2E_API_KEY: token, OPENCODE_CONFIG_CONTENT: JSON.stringify(config) },
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { if (stdout.length < 1_000_000) stdout += chunk; });
  child.stderr.on("data", (chunk) => { if (stderr.length < 100_000) stderr += chunk; });
  const timer = setTimeout(() => child.kill(), 900_000);
  let code;
  try { code = await new Promise((resolve, reject) => { child.once("error", reject); child.once("close", resolve); }); }
  finally { clearTimeout(timer); }
  report.checks.push({ name: "opencode_exit_zero", passed: code === 0, exitCode: code });
  const events = stdout.trim().split(/\r?\n/).filter(Boolean).map((line) => { try { return JSON.parse(line); } catch { return {}; } });
  report.eventTypes = [...new Set(events.map((event) => event.type).filter(Boolean))];
  report.toolUses = events.filter((event) => event.type === "tool_use").map((event) => event.part?.tool);
  report.messages = events.filter((event) => event.type === "text" || event.type === "error").map((event) => String(event.part?.text ?? event.error?.data?.message ?? event.error?.message ?? "").replaceAll(token, "[redacted]").slice(0, 3000));
  if (code !== 0) { report.diagnostic = stderr.replaceAll(token, "[redacted]").slice(-3000); throw new Error(`OpenCode exited with code ${code}.`); }
  const html = await readFile(target, "utf8");
  const valid = /<!doctype html>/i.test(html) && /<title>\s*CoworkerAPI OpenCode E2E\s*<\/title>/i.test(html) && /<h1[^>]*>\s*OpenCode works\s*<\/h1>/i.test(html);
  report.checks.push({ name: "requested_html_created", passed: valid, bytes: Buffer.byteLength(html) });
  if (!valid || report.eventTypes.includes("error")) throw new Error("OpenCode did not complete the file task.");
  report.status = "passed";
} catch (error) {
  report.failure = String(error?.message ?? error).replaceAll(token ?? "no-token-configured", "[redacted]");
  if (report.checks.some((check) => check.name === "opencode_exit_zero")) report.status = "failed";
  process.exitCode = 1;
} finally {
  if (proxy) await proxy.stop();
  report.finishedAt = new Date().toISOString();
  await writeFile(join(reportDir, `live-opencode-${report.startedAt.replace(/[:.]/g, "-")}.json`), JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
  await writeFile(join(reportDir, "live-opencode-e2e.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report));
}
