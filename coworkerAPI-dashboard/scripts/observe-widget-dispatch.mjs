#!/usr/bin/env node
// Read-only operational evidence. Never records prompts, IDs or credentials.
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
const base = process.env.COWORKER_E2E_BASE_URL ?? "http://127.0.0.1:3212";
const target = Number(process.argv[2]);
const duration = Number(process.argv[3] ?? 420_000);
if (!Number.isInteger(target) || target <= 0 || !Number.isFinite(duration) || duration < 1000 || duration > 3_600_000) throw new Error("Specify a positive queued-counter target and a bounded observation duration.");
const counterNames = ["queued", "claimed", "submitted", "cancelled", "sendStarted", "ackSeen", "hostInvoked", "delivered", "deliveryUnknown", "deliveryFailed", "recoveredClaims", "repeatedSendStarts", "staleLeaseReports"];
const phases = ["reserved", "sending", "sent", "failed", "unknown"];
const number = value => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
const report = { startedAt: new Date().toISOString(), targetQueued: target, source: "read-only local widget diagnostics", status: "observation_timeout", samples: [], pollErrors: 0 };
const started = Date.now();
while (Date.now() - started < duration) {
  try {
    const response = await fetch(base + "/health/bridge", { signal: AbortSignal.timeout(3000) });
    if (!response.ok) throw new Error("diagnostic_unavailable");
    const value = await response.json();
    report.samples.push({ elapsedMs: Date.now() - started, connected: value.connected === true, pending: number(value.pending), claimed: number(value.claimed), draining: number(value.draining), heartbeatAgeMs: number(value.lastPollAgeMs), runtime: ["bridge-v4", "bridge-v5", "bridge-v6", "bridge-v7", "bridge-v8"].includes(value.runtime?.last) ? value.runtime.last : null,
      dispatch: Object.fromEntries(phases.map(key => [key, number(value.dispatch?.[key])])),
      boundaries: Object.fromEntries(["awaitingAckReceipt", "awaitingHostInvocation", "awaitingHostOutcome"].map(key => [key, number(value.dispatchDiagnostics?.[key])])),
      // null means this installed gateway lacks stage telemetry, not zero errors.
      hostFailureStages: Object.fromEntries(["sync_throw", "async_reject", "deadline", "unspecified"].map(key => [key, number(value.hostFailureStages?.[key])])),
      hostTransports: Object.fromEntries(["mcp-apps", "openai-alias", "unspecified"].map(key => [key, number(value.hostTransports?.[key])])),
      counts: Object.fromEntries(counterNames.map(key => [key, number(value.counts?.[key])])) });
    if (value.counts?.queued >= target && value.pending === 0 && value.draining === 0) { report.status = value.connected === true ? "target_drained" : "target_drained_disconnected"; break; }
  } catch { report.pollErrors++; }
  await new Promise(resolve => setTimeout(resolve, 2000));
}
report.finishedAt = new Date().toISOString();
report.summary = { samples: report.samples.length, activeSamples: report.samples.filter(s => s.claimed > 0).length, disconnectedActiveSamples: report.samples.filter(s => s.claimed > 0 && !s.connected).length, pendingSamples: report.samples.filter(s => s.pending > 0).length, disconnectedPendingSamples: report.samples.filter(s => s.pending > 0 && !s.connected).length, maxHeartbeatAgeMs: Math.max(0, ...report.samples.map(s => s.heartbeatAgeMs ?? 0)), last: report.samples.at(-1) ?? null };
await mkdir("artifacts", { recursive: true });
const file = join("artifacts", "widget-dispatch-observation-" + report.startedAt.replace(/[:.]/g, "-") + ".json");
await writeFile(file, JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ file, status: report.status, pollErrors: report.pollErrors, summary: report.summary }));
