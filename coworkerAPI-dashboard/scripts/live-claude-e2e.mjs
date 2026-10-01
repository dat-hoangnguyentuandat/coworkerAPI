#!/usr/bin/env node
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import { join, resolve } from "node:path";
import { parseClaudeEvents, claudeProjectEvidence, claudeToolNames } from "./claude-event-evidence.mjs";

const base = process.env.COWORKER_E2E_BASE_URL ?? "http://127.0.0.1:3212";
let token = process.env.COWORKER_E2E_API_KEY;
if (!token) {
  const settingsPath = resolve(homedir(), ".claude/settings.json");
  if (existsSync(settingsPath)) {
    const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
    const configuredBase = settings.env?.ANTHROPIC_BASE_URL;
    const configuredKey = settings.env?.ANTHROPIC_AUTH_TOKEN ?? settings.env?.ANTHROPIC_API_KEY;
    if (typeof configuredBase === "string" && new URL(configuredBase).origin === new URL(base).origin && typeof configuredKey === "string" && configuredKey.startsWith("cwapi_")) token = configuredKey;
  }
}
const reportDir = resolve("artifacts");
const mode = process.env.COWORKER_E2E_MODE ?? "write";
if (!["write", "full-tools", "project"].includes(mode)) throw new Error("COWORKER_E2E_MODE must be write, full-tools or project.");
await mkdir(reportDir, { recursive: true });
const report = { startedAt: new Date().toISOString(), base, mode, upstream: "real ChatGPT MCP widget", status: "blocked", checks: [], failure: undefined };
try {
  const response = await fetch(`${base}/health/inference`, { signal: AbortSignal.timeout(5000) });
  const health = await response.json();
  report.checks.push({ name: "gateway_ready", passed: response.ok, status: health.status });
  if (!response.ok) throw new Error(`Gateway not ready: ${health.status}. Activate the ChatGPT bridge and configure an API key before running live E2E.`);
  if (!token) throw new Error("Set COWORKER_E2E_API_KEY to a CoworkerAPI key; it is never included in the report.");
  const executable = process.env.COWORKER_E2E_CLAUDE_BIN ?? (process.platform === "win32" ? join(process.env.APPDATA ?? "", "npm/node_modules/@anthropic-ai/claude-code/bin/claude.exe") : "claude");
  if (process.platform === "win32" && !existsSync(executable)) throw new Error("Claude Code executable was not found; set COWORKER_E2E_CLAUDE_BIN.");
  const directory = await mkdtemp(join(tmpdir(), "coworkerapi-live-claude-"));
  report.workDirectory = directory;
  const targetFile = join(directory, "index.html");
  const prompt = mode === "project"
    ? `This is a controlled regression test in a fresh empty directory ${directory}. Work only in this directory; do not read environment variables or unrelated files. Using Write, create index.html with <!doctype html>, title CoworkerAPI E2E and h1 CoworkerAPI works. Also create logic.mjs with EXACT initial implementation: export function add(a, b) { return a + b; }. Create logic.test.mjs using node:test and node:assert/strict. Tests must require add(2,3)=5, add("2","3")=5, add(-2,5)=3, add(1.25,"2")=3.25, and TypeError for NaN, Infinity, "bad", an empty string, null and a boolean. Run the actual Bash command node --test --test-reporter=tap logic.test.mjs BEFORE fixing logic.mjs. The initial failures are intentional and must actually occur, not merely be described. After receiving that failing tool result, use Read to inspect logic.mjs and Edit to repair add: accept only finite numbers or nonempty numeric strings, reject all other values with TypeError, and return their numeric sum. Do not weaken the tests. Run the same Bash test command again and require zero failures. Then give a brief final confirmation. Use actual local CLI tools, not Coworker workspace MCP tools. Do not skip the first failing test run.`
    : `This is a new task in a newly created empty directory. Create the new file ${targetFile} using Write. Include <!doctype html>, a title CoworkerAPI E2E, and an h1 CoworkerAPI works. ${mode === "full-tools" ? "Then use Read to inspect that file, use Edit to add data-e2e=\"verified\" to the h1, and use Bash to run a node command that reads the file and checks its doctype, title, heading and data-e2e attribute. The command must exit with code 0 if all checks pass. Use these actual tools in this order and then give a short confirmation." : "Then give a short confirmation."}`;
  const args = ["-p", prompt, "--setting-sources", "project,local", "--model", process.env.COWORKER_E2E_MODEL ?? "chatgpt-web", "--permission-mode", "acceptEdits", "--no-session-persistence", "--output-format", "stream-json", "--verbose"];
  if (mode === "write") args.push("--tools", "Write", "--allowedTools", "Write", "--system-prompt", "You are a coding assistant. Use Write to create the requested file, then give a brief final answer.");
  else args.push("--allowedTools", "Write", "Read", "Edit", "Bash(node:*)");
  const child = spawn(executable, args, {
    cwd: directory, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, ANTHROPIC_BASE_URL: base, ANTHROPIC_AUTH_TOKEN: token, ANTHROPIC_API_KEY: "", API_TIMEOUT_MS: "360000", CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1" },
  });
  let output = "";
  child.stdout.on("data", (chunk) => { if (output.length < 1_000_000) output += chunk; });
  child.stderr.resume();
  const timer = setTimeout(() => child.kill(), 900_000);
  let code;
  try { code = await new Promise((resolve, reject) => { child.once("error", reject); child.once("close", resolve); }); }
  finally { clearTimeout(timer); }
  report.checks.push({ name: "claude_exit_zero", passed: code === 0, exitCode: code });
  // Preserve metadata about completed tool steps even when the bounded runner
  // exits nonzero. Do not dump partial stdout, arguments, or tool-result bodies.
  const { events: parsedEvents, malformedEventLines } = parseClaudeEvents(output);
  report.malformedEventLines = malformedEventLines;
  report.toolUses = claudeToolNames(parsedEvents);
  if (code !== 0) throw new Error(`Claude Code exited with code ${code}.`);
  if (malformedEventLines) throw new Error("Claude Code emitted incomplete or non-JSON event lines.");
  const events = parsedEvents;
  const answer = events.findLast((event) => event.type === "result");
  if (!answer) throw new Error("Claude Code did not return a final result event.");
  const toolUses = claudeToolNames(events);
  report.toolUses = toolUses;
  report.claude = { subtype: answer.subtype, isError: answer.is_error, turns: answer.num_turns, result: typeof answer.result === "string" ? answer.result.replaceAll(token, "[redacted]").slice(0, 5000) : undefined };
  report.checks.push({ name: "claude_completed", passed: !answer.is_error && answer.subtype === "success" });
  const html = await readFile(join(directory, "index.html"), "utf8");
  const valid = /<!doctype html>/i.test(html) && /<title>\s*CoworkerAPI E2E\s*<\/title>/i.test(html) && /<h1[^>]*>\s*CoworkerAPI works\s*<\/h1>/i.test(html);
  report.checks.push({ name: "requested_html_created", passed: valid, bytes: Buffer.byteLength(html) });
  if (!valid || answer.is_error || answer.subtype !== "success") throw new Error("Claude Code did not complete the requested file tool loop.");
  const requiredTools = mode === "write" ? ["Write"] : ["Write", "Read", "Edit", "Bash"];
  const usedRequiredTools = requiredTools.every((name) => toolUses.includes(name));
  report.checks.push({ name: "required_tools_executed", passed: usedRequiredTools, required: requiredTools });
  if (!usedRequiredTools) throw new Error("Claude Code did not execute all required test tools.");
  if (mode === "full-tools") {
    const edited = /<h1\b[^>]*data-e2e=["']verified["'][^>]*>/i.test(html);
    report.checks.push({ name: "html_edit_verified", passed: edited });
    if (!edited) throw new Error("The requested HTML edit was not present.");
  }
  if (mode === "project") {
    const projectEvidence = claudeProjectEvidence(events);
    report.checks.push(projectEvidence);
    if (!projectEvidence.passed) throw new Error("The required initial assertion failure, intervening repair and later successful CLI test run were not all observed.");
    const library = await readFile(join(directory, "logic.mjs"), "utf8");
    const tests = await readFile(join(directory, "logic.test.mjs"), "utf8");
    report.project = { files: ["index.html", "logic.mjs", "logic.test.mjs"], libraryBytes: Buffer.byteLength(library), testBytes: Buffer.byteLength(tests) };
    const moduleUrl = pathToFileURL(join(directory, "logic.mjs")).href;
    const verify = `import assert from 'node:assert/strict'; import {add} from ${JSON.stringify(moduleUrl)}; for(const [a,b,result] of [[2,3,5],['2','3',5],[-2,5,3],[1.25,'2',3.25],[0,0,0]]) assert.equal(add(a,b),result); for(const bad of [NaN,Infinity,'bad','',null,true,{},[]]) {assert.throws(()=>add(bad,1),TypeError); assert.throws(()=>add(1,bad),TypeError);} console.log('verified');`;
    // Independent verification does not inherit CLI/gateway credentials and can
    // read only its owned project directory; filesystem writes/child workers deny.
    const verifyEnv = Object.fromEntries(["SystemRoot", "SYSTEMROOT", "WINDIR"].filter(name => process.env[name]).map(name => [name, process.env[name]]));
    const verified = await promisify(execFile)(process.execPath, ["--permission", `--allow-fs-read=${directory}`, "--input-type=module", "-e", verify], { cwd: directory, env: verifyEnv, windowsHide: true, timeout: 15_000, maxBuffer: 100_000 });
    if (verified.stdout.trim() !== "verified") throw new Error("Independent project verification did not complete.");
    report.checks.push({ name: "independent_numeric_and_invalid_input_assertions", passed: true, credentialEnvironment: "not inherited", filesystemReadScope: "owned project directory" });
  }
  report.status = "passed";
} catch (error) {
  report.failure = String(error?.message ?? error).replaceAll(token ?? "no-token-configured", "[redacted]");
  if (report.checks.some((check) => check.name === "claude_exit_zero")) report.status = "failed";
  process.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString();
  await writeFile(join(reportDir, `live-claude-${mode}-${report.startedAt.replace(/[:.]/g, "-")}.json`), JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
  await writeFile(join(reportDir, "live-claude-e2e.json"), JSON.stringify(report, null, 2) + "\n");
  await writeFile(join(reportDir, `live-claude-${mode}.json`), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report));
}
