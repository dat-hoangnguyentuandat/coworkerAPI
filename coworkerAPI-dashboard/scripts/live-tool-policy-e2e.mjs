#!/usr/bin/env node
// Real ChatGPT callback validation only; returned client tools are NOT executed.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const base = process.env.COWORKER_E2E_BASE_URL ?? "http://127.0.0.1:3212";
const settings = JSON.parse(readFileSync(resolve(homedir(), ".claude/settings.json"), "utf8"));
const candidateKey = settings.env?.ANTHROPIC_AUTH_TOKEN ?? settings.env?.ANTHROPIC_API_KEY;
const token = process.env.COWORKER_E2E_API_KEY ?? (typeof candidateKey === "string" && candidateKey.startsWith("cwapi_") && new URL(settings.env.ANTHROPIC_BASE_URL).origin === new URL(base).origin ? candidateKey : undefined);
const report = { startedAt: new Date().toISOString(), base, upstream: "real ChatGPT MCP widget", status: "failed", checks: [] };
try {
  if (!token) throw new Error("Missing local gateway key.");
  const ready = await fetch(base + "/health/inference", { signal: AbortSignal.timeout(5000) }); assert.ok(ready.ok);
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  for (const protocol of ["responses", "chat", "anthropic", "namespace"]) {
    const marker = randomBytes(8).toString("hex");
    const fn = { type: "function", name: "echo", description: "Return this client function call; it will not be executed on the gateway.", parameters: { type: "object", properties: { marker: { type: "string" } }, required: ["marker"], additionalProperties: false } };
    const prompt = `Call the client echo function exactly once with marker=${marker}. Do not execute any local tool. Return the function call, not final text.`;
    const tools = protocol === "namespace" ? [{ type: "namespace", name: "fixtures", tools: [fn] }] : protocol === "chat" ? [{ type: "function", function: fn }] : protocol === "anthropic" ? [{ name: fn.name, description: fn.description, input_schema: fn.parameters }] : [fn];
    const toolChoice = protocol === "namespace" ? { type: "function", name: "echo", namespace: "fixtures" } : protocol === "chat" ? { type: "function", function: { name: "echo" } } : protocol === "anthropic" ? { type: "tool", name: "echo", disable_parallel_tool_use: true } : { type: "function", name: "echo" };
    const path = protocol === "chat" ? "/v1/chat/completions" : protocol === "anthropic" ? "/v1/messages" : "/v1/responses";
    const stream = protocol === "namespace";
    const payload = { model: "chatgpt-web", ...(path === "/v1/responses" ? { input: prompt } : { messages: [{ role: "user", content: prompt }], max_tokens: 256 }), tools, tool_choice: toolChoice, parallel_tool_calls: false, stream };
    console.log(JSON.stringify({ started: { protocol, stream } }));
    const started = Date.now(); const response = await fetch(base + path, { method: "POST", headers, body: JSON.stringify(payload), signal: AbortSignal.timeout(360000) }); assert.equal(response.status, 200);
    let call;
    if (stream) {
      const raw = await response.text(); const frames = raw.split(/\r?\n\r?\n/).flatMap(frame => { const data = frame.split(/\r?\n/).filter(line => line.startsWith("data: ")).map(line => line.slice(6)).join("\n"); return data ? [JSON.parse(data)] : []; });
      const final = frames.find(frame => frame.type === "response.completed"); assert.ok(final); call = final.response.output[0]; assert.equal(call.namespace, "fixtures");
    } else {
      const body = await response.json();
      call = protocol === "anthropic" ? body.content.find(block => block.type === "tool_use") : protocol === "chat" ? body.choices[0].message.tool_calls[0] : body.output[0];
    }
    const name = protocol === "chat" ? call.function.name : call.name;
    const args = protocol === "anthropic" ? call.input : JSON.parse(protocol === "chat" ? call.function.arguments : call.arguments);
    assert.equal(name, "echo"); assert.deepEqual(args, { marker });
    report.checks.push({ protocol, stream, passed: true, latencyMs: Date.now() - started, clientToolsExecuted: false });
  }
  const rejected = await fetch(base + "/v1/responses", { method: "POST", headers, body: JSON.stringify({ model: "chatgpt-web", input: "fixture", tools: [{ type: "web_search" }] }), signal: AbortSignal.timeout(5000) });
  assert.equal(rejected.status, 400); assert.equal((await rejected.json()).error.code, "unsupported_tools"); report.checks.push({ name: "unsupported_hosted_tool_rejected", passed: true });
  report.status = "passed";
} catch { report.failure = "Real widget tool-policy verification did not complete successfully."; process.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString(); await mkdir("artifacts", { recursive: true });
  await writeFile(join("artifacts", `live-tool-policy-${report.startedAt.replace(/[:.]/g, "-")}.json`), JSON.stringify(report, null, 2) + "\n"); console.log(JSON.stringify(report));
}
