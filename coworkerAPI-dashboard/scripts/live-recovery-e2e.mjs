#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { readDiagnostic, diagnosticDelta, safeDiagnostic } from "./live-diagnostic-evidence.mjs";

const base = process.env.COWORKER_E2E_BASE_URL ?? "http://127.0.0.1:3212";
let token = process.env.COWORKER_E2E_API_KEY;
if (!token) {
  try {
    const settings = JSON.parse(await readFile(join(homedir(), ".claude/settings.json"), "utf8"));
    const configuredBase = settings.env?.ANTHROPIC_BASE_URL;
    const key = settings.env?.ANTHROPIC_AUTH_TOKEN ?? settings.env?.ANTHROPIC_API_KEY;
    if (typeof configuredBase === "string" && new URL(configuredBase).origin === new URL(base).origin && typeof key === "string" && key.startsWith("cwapi_")) token = key;
  } catch {}
}
const cancelStage = process.env.COWORKER_E2E_CANCEL_STAGE ?? "queued";
if (!["queued", "claimed"].includes(cancelStage)) throw new Error("COWORKER_E2E_CANCEL_STAGE must be queued or claimed.");
const report = { startedAt: new Date().toISOString(), base, cancelStage, upstream: "real ChatGPT MCP widget", status: "failed", checks: [] };
const readBridge = async () => {
  const response = await fetch(`${base}/health/bridge`, { signal: AbortSignal.timeout(3000) });
  if (!response.ok) throw new Error("Bridge diagnostics unavailable.");
  return response.json();
};
let abort;
try {
  report.initialDiagnostic = await readDiagnostic(base);
  if (!token) throw new Error("Set COWORKER_E2E_API_KEY.");
  const baseline = await readBridge();
  if (!baseline.connected || baseline.pending !== 0 || baseline.draining > 0) throw new Error("Recovery test requires an idle connected bridge; do not interrupt another task.");
  abort = new AbortController();
  const waiting = fetch(`${base}/v1/responses`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "chatgpt-web", input: "Reply with a brief acknowledgment for this cancellation test.", stream: true }), signal: abort.signal,
  }).then((response) => response.text()).then(() => "completed", () => "cancelled");
  const deadline = Date.now() + 30_000;
  let observed;
  do {
    observed = await readBridge();
    if (observed.counts.queued > baseline.counts.queued && (cancelStage !== "claimed" || observed.claimed > 0)) break;
    await new Promise((yes) => setTimeout(yes, 100));
  } while (Date.now() < deadline);
  if (!observed || observed.counts.queued <= baseline.counts.queued) throw new Error("Test request never reached the queue.");
  if (cancelStage === "claimed" && observed.claimed === 0) throw new Error("Test request was not observed claimed; claimed cancellation was not tested.");
  abort.abort();
  const outcome = await waiting;
  if (outcome !== "cancelled") throw new Error("Test request completed before cancellation could be verified.");
  const cleanupDeadline = Date.now() + 10_000;
  let cleaned;
  do {
    cleaned = await readBridge();
    if (cleaned.pending === 0 && cleaned.counts.cancelled > baseline.counts.cancelled) break;
    await new Promise((yes) => setTimeout(yes, 100));
  } while (Date.now() < cleanupDeadline);
  if (cleaned.pending !== 0 || cleaned.counts.cancelled <= baseline.counts.cancelled) throw new Error("Cancellation did not remove the test request from the gateway queue.");
  report.checks.push({ name: "client_abort_cleans_queue", passed: true, claimedBeforeAbort: observed.claimed > 0, draining: cleaned.draining ?? null });
  const nonce = `recovery-e2e-${randomBytes(8).toString("hex")}`;
  const response = await fetch(`${base}/v1/messages`, {
    method: "POST", headers: { "x-api-key": token, "Content-Type": "application/json", "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: "chatgpt-web", max_tokens: 100, messages: [{ role: "user", content: `Reply with exactly ${nonce} and nothing else.` }] }), signal: AbortSignal.timeout(360_000),
  });
  if (!response.ok) throw new Error(`Recovery request failed: HTTP ${response.status}`);
  const answer = await response.json();
  const text = answer.content?.filter((block) => block.type === "text").map((block) => block.text).join("");
  if (text?.trim() !== nonce) throw new Error("Recovery request did not return the fresh exact test value.");
  const final = await readBridge();
  if (final.pending !== 0 || final.counts.submitted <= baseline.counts.submitted) throw new Error("Recovery callback/queue state was not verified.");
  report.checks.push({ name: "real_request_after_abort", passed: true, pending: final.pending, draining: final.draining ?? null, cancelled: final.counts.cancelled, cancelledCallbacks: final.counts.cancelledCallbacks ?? null, submitted: final.counts.submitted, runtime: final.runtime ?? null });
  report.status = "passed";
} catch (error) {
  report.failure = String(error?.message ?? error).replaceAll(token ?? "no-key-configured", "[redacted]");
  try {
    const state = await readBridge();
    report.bridgeAtFailure = safeDiagnostic(null, state);
  } catch {}
  process.exitCode = 1;
} finally {
  abort?.abort();
  report.finalDiagnostic = await readDiagnostic(base);
  report.diagnosticDelta = diagnosticDelta(report.initialDiagnostic, report.finalDiagnostic);
  report.finishedAt = new Date().toISOString();
  const directory = resolve("artifacts");
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, `live-recovery-${report.startedAt.replace(/[:.]/g, "-")}.json`), JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
  await writeFile(join(directory, "live-recovery-e2e.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report));
}
