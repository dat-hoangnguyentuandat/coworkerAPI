#!/usr/bin/env node
// Test-only tab navigation; production never imports this harness.
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { readDiagnostic, diagnosticDelta } from "./live-diagnostic-evidence.mjs";
const base = process.env.COWORKER_E2E_BASE_URL ?? "http://127.0.0.1:3212";
const report = { startedAt: new Date().toISOString(), status: "failed", source: "test-only ChatGPT tab disconnect/return", checks: [] };
let away = false;
async function ui(action) {
  const child = spawn("powershell.exe", ["-NoProfile", "-File", resolve("scripts/chatgpt-widget-test-ui.ps1"), "-Action", action], { windowsHide: true, stdio: "ignore" });
  const timer = setTimeout(() => child.kill(), 30000);
  try {
    const code = await new Promise((yes, no) => { child.once("error", no); child.once("close", yes); });
    if (code !== 0) throw new Error("test_ui_action_failed");
  } finally { clearTimeout(timer); }
}
async function waitFor(connected, timeout) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const state = await readDiagnostic(base);
    if (state.connected === connected && state.pending === 0 && state.draining === 0) return { ...state, elapsedMs: Date.now() - started };
    await new Promise(yes => setTimeout(yes, 1000));
  }
  throw new Error(connected ? "fresh_heartbeat_not_observed" : "heartbeat_expiry_not_observed");
}
try {
  report.initialDiagnostic = await readDiagnostic(base);
  if (report.initialDiagnostic.connected !== true || report.initialDiagnostic.pending !== 0 || report.initialDiagnostic.draining !== 0) throw new Error("requires_idle_connected_gateway");
  away = true;
  await ui("disconnect");
  report.disconnectedDiagnostic = await waitFor(false, 45000);
  const inference = await fetch(base + "/health/inference", { signal: AbortSignal.timeout(5000) });
  report.checks.push({ name: "heartbeat_expires_and_inference_not_ready", passed: inference.status === 503, httpStatus: inference.status });
  if (inference.status !== 503) throw new Error("disconnected_inference_health_not_503");
  await ui("return");
  away = false;
  report.reconnectedDiagnostic = await waitFor(true, 90000);
  report.checks.push({ name: "existing_conversation_reconnects_without_activation", passed: report.reconnectedDiagnostic.runtime === "bridge-v8", elapsedMs: report.reconnectedDiagnostic.elapsedMs });
  if (report.reconnectedDiagnostic.runtime !== "bridge-v8") throw new Error("unexpected_widget_runtime");
  const child = spawn(process.execPath, [resolve("scripts/live-protocol-e2e.mjs")], { windowsHide: true, stdio: ["ignore", "pipe", "ignore"], env: { ...process.env, COWORKER_E2E_BASE_URL: base } });
  let output = "";
  child.stdout.on("data", chunk => { if (output.length < 200000) output += chunk; });
  const timer = setTimeout(() => child.kill(), 2400000);
  let code;
  try { code = await new Promise((yes, no) => { child.once("error", no); child.once("close", yes); }); }
  finally { clearTimeout(timer); }
  let protocolReport;
  try { protocolReport = JSON.parse(output.trim().split(/\r?\n/).at(-1)); } catch {}
  const passed = code === 0 && protocolReport?.status === "passed" && protocolReport.checks?.length === 6 && protocolReport.checks.every(check => check.passed === true);
  report.checks.push({ name: "six_real_protocol_modes_after_reconnect", passed, exitCode: code, protocolReportStartedAt: protocolReport?.startedAt ?? null });
  if (!passed) throw new Error("post_reconnect_protocol_e2e_failed");
  report.status = "passed";
} catch (error) {
  report.failure = ["requires_idle_connected_gateway", "test_ui_action_failed", "fresh_heartbeat_not_observed", "heartbeat_expiry_not_observed", "disconnected_inference_health_not_503", "unexpected_widget_runtime", "post_reconnect_protocol_e2e_failed"].includes(error?.message) ? error.message : "reconnect_runner_failed";
  process.exitCode = 1;
} finally {
  if (away) { try { await ui("return"); report.testTabRestored = true; } catch { report.testTabRestored = false; } }
  report.finalDiagnostic = await readDiagnostic(base);
  report.diagnosticDelta = diagnosticDelta(report.initialDiagnostic, report.finalDiagnostic);
  report.finishedAt = new Date().toISOString();
  await mkdir("artifacts", { recursive: true });
  await writeFile(join("artifacts", "live-widget-reconnect-" + report.startedAt.replace(/[:.]/g, "-") + ".json"), JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify(report));
}
