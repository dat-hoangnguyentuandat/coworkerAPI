#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve, join } from "node:path";
import { readDiagnostic, diagnosticDelta, safeDiagnostic } from "./live-diagnostic-evidence.mjs";

const base = process.env.COWORKER_E2E_BASE_URL ?? "http://127.0.0.1:3212";
let token = process.env.COWORKER_E2E_API_KEY;
if (!token) {
  const file = resolve(homedir(), ".claude/settings.json");
  if (existsSync(file)) {
    const settings = JSON.parse(readFileSync(file, "utf8"));
    const configuredBase = settings.env?.ANTHROPIC_BASE_URL;
    const key = settings.env?.ANTHROPIC_AUTH_TOKEN ?? settings.env?.ANTHROPIC_API_KEY;
    if (typeof configuredBase === "string" && new URL(configuredBase).origin === new URL(base).origin && typeof key === "string" && key.startsWith("cwapi_")) token = key;
  }
}
const report = { startedAt: new Date().toISOString(), base, upstream: "real ChatGPT MCP widget", status: "blocked", checks: [] };
try {
  report.initialDiagnostic = await readDiagnostic(base);
  const health = await fetch(`${base}/health/inference`, { signal: AbortSignal.timeout(5000) });
  if (!health.ok) throw new Error(`Gateway is not ready: ${(await health.json()).status}`);
  if (!token) throw new Error("Set COWORKER_E2E_API_KEY.");
  for (const protocol of ["responses", "chat", "anthropic"]) {
    // Keep prior answers in the next request to detect accidental replay of
    // an earlier turn, not just independently working single-turn requests.
    const history = [];
    for (const stream of [false, true]) {
      const nonce = `coworkerapi-e2e-${randomBytes(8).toString("hex")}`;
      const prompt = `Reply with exactly this string and nothing else: ${nonce}`;
      const path = protocol === "responses" ? "/v1/responses" : protocol === "chat" ? "/v1/chat/completions" : "/v1/messages";
      const input = [...history, { role: "user", content: prompt }];
      const body = protocol === "responses" ? { model: "chatgpt-web", input, stream } : { model: "chatgpt-web", messages: input, stream, ...(protocol === "anthropic" ? { max_tokens: 100 } : {}) };
      const started = Date.now();
      console.log(JSON.stringify({ started: { protocol, stream } }));
      const response = await fetch(`${base}${path}`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(360_000) });
      const raw = await response.text();
      const check = { protocol, stream, priorTurns: history.length / 2, httpStatus: response.status, latencyMs: Date.now() - started, passed: false };
      try {
        const diagnostic = await fetch(`${base}/health/bridge`, { signal: AbortSignal.timeout(3000) });
        if (diagnostic.ok) {
          const value = await diagnostic.json();
          check.bridge = safeDiagnostic(null, value);
        }
      } catch {}
      report.checks.push(check);
      if (!response.ok) throw new Error(`${protocol} stream=${stream} returned HTTP ${response.status}.`);
      let text = "";
      if (stream) {
        if (!response.headers.get("content-type")?.includes("text/event-stream")) throw new Error(`${protocol} did not return SSE.`);
        const events = raw.split(/\r?\n\r?\n/).map((frame) => frame.split(/\r?\n/).filter((line) => line.startsWith("data: ")).map((line) => line.slice(6)).join("\n")).filter(Boolean);
        const data = events.filter((event) => event !== "[DONE]").map((event) => JSON.parse(event));
        check.eventTypes = [...new Set(data.map((event) => event.type ?? event.object))];
        if (protocol === "responses") {
          text = data.filter((event) => event.type === "response.output_text.delta").map((event) => event.delta).join("");
          if (!data.some((event) => event.type === "response.completed")) throw new Error("Responses SSE lacked response.completed.");
        } else if (protocol === "chat") {
          text = data.map((event) => event.choices?.[0]?.delta?.content ?? "").join("");
          if (!events.includes("[DONE]") || !data.some((event) => event.choices?.[0]?.finish_reason === "stop")) throw new Error("Chat SSE did not finish correctly.");
        } else {
          text = data.filter((event) => event.type === "content_block_delta" && event.delta?.type === "text_delta").map((event) => event.delta.text).join("");
          if (!data.some((event) => event.type === "message_stop")) throw new Error("Anthropic SSE lacked message_stop.");
        }
      } else {
        const data = JSON.parse(raw);
        text = protocol === "responses" ? data.output_text : protocol === "chat" ? data.choices?.[0]?.message?.content : data.content?.filter((block) => block.type === "text").map((block) => block.text).join("");
      }
      check.passed = text?.trim() === nonce;
      if (!check.passed) throw new Error(`${protocol} stream=${stream} did not return the exact fresh test value.`);
      history.push({ role: "user", content: prompt }, { role: "assistant", content: text });
      console.log(JSON.stringify({ check }));
    }
  }
  report.status = "passed";
} catch (error) {
  report.failure = String(error?.message ?? error).replaceAll(token ?? "no-token-configured", "[redacted]");
  if (report.checks.length) report.status = "failed";
  process.exitCode = 1;
} finally {
  report.finalDiagnostic = await readDiagnostic(base);
  report.diagnosticDelta = diagnosticDelta(report.initialDiagnostic, report.finalDiagnostic);
  report.finishedAt = new Date().toISOString();
  const dir = resolve("artifacts");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `live-protocol-${report.startedAt.replace(/[:.]/g, "-")}.json`), JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
  await writeFile(join(dir, "live-protocol-e2e.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report));
}
