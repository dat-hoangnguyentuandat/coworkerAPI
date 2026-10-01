#!/usr/bin/env node
// Explicit, test-only restart of the already-installed candidate on port 3212.
import { spawn } from "node:child_process";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createHash, randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { resolve, join } from "node:path";
import { readDiagnostic } from "./live-diagnostic-evidence.mjs";
const candidate = resolve(process.env.COWORKER_E2E_CANDIDATE_DIR ?? "");
const base = "http://127.0.0.1:3212";
const mode = process.env.COWORKER_E2E_RESTART_STAGE ?? "idle";
const report = { startedAt: new Date().toISOString(), mode, status: "failed", source: "owned test gateway/tunnel restart", checks: [] };
let gateway;
let probeAbort, probeResult;
const digest = async () => Object.fromEntries(await Promise.all(["coworkerapi.json", "tunnel-credentials.json"].map(async name => [name, createHash("sha256").update(await readFile(join(candidate, "data", name))).digest("hex")])));
async function run(command, args, options = {}) {
  const child = spawn(command, args, { windowsHide: true, stdio: "ignore", ...options });
  const code = await new Promise((yes, no) => { child.once("error", no); child.once("close", yes); });
  if (code !== 0) throw new Error("test_command_failed");
}
try {
  if (process.platform !== "win32" || !/^coworkerapi-candidate-[a-f0-9]{32}$/.test(candidate.split(/[\\/]/).at(-1))) throw new Error("invalid_candidate");
  if (!["idle", "claimed"].includes(mode)) throw new Error("invalid_restart_stage");
  const pkg = JSON.parse(await readFile(join(candidate, "node_modules/coworker-api/package.json"), "utf8"));
  report.initialDiagnostic = await readDiagnostic(base);
  if (report.initialDiagnostic.gatewayVersion !== pkg.version || report.initialDiagnostic.connected !== true || report.initialDiagnostic.pending !== 0 || report.initialDiagnostic.draining !== 0) throw new Error("requires_idle_matching_candidate");
  let before = await digest();
  if (mode === "claimed") {
    const settings = JSON.parse(await readFile(join(homedir(), ".claude/settings.json"), "utf8"));
    const token = process.env.COWORKER_E2E_API_KEY ?? settings.env?.ANTHROPIC_AUTH_TOKEN ?? settings.env?.ANTHROPIC_API_KEY;
    // A separate candidate origin requires an explicitly supplied test key;
    // never disclose the configured key to another port as an auth probe.
    if (typeof token !== "string" || !token.startsWith("cwapi_") || (!process.env.COWORKER_E2E_API_KEY && new URL(settings.env?.ANTHROPIC_BASE_URL).origin !== new URL(base).origin)) throw new Error("test_credential_unavailable");
    const authorized = await fetch(base + "/v1/models", { headers: { Authorization: "Bearer " + token }, signal: AbortSignal.timeout(5000) });
    if (!authorized.ok) throw new Error("test_credential_unavailable");
    await authorized.arrayBuffer();
    // The auth probe legitimately writes a models audit record. The restart
    // preservation baseline must include it, rather than call it data loss.
    before = await digest();
    probeAbort = new AbortController();
    const nonce = "restart-probe-" + randomBytes(8).toString("hex");
    probeResult = fetch(base + "/v1/responses", { method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" }, body: JSON.stringify({ model: "chatgpt-web", input: "Reply with exactly " + nonce + " and nothing else.", stream: false }), signal: probeAbort.signal })
      .then(async response => { try { await response.text(); return { outcome: "completed", httpStatus: response.status }; } catch { return { outcome: "transport_interrupted" }; } }, () => ({ outcome: "transport_interrupted" }));
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      const state = await readDiagnostic(base);
      if (state.pending === 1 && state.claimed === 1 && state.counts.queued === report.initialDiagnostic.counts.queued + 1 && state.counts.hostInvoked === report.initialDiagnostic.counts.hostInvoked + 1) { report.claimedDiagnostic = state; break; }
      await new Promise(yes => setTimeout(yes, 100));
    }
    if (!report.claimedDiagnostic) throw new Error("owned_probe_not_dispatched");
    report.checks.push({ name: "owned_probe_claimed_and_host_invoked_before_restart", passed: true });
    // Include all admission/auth audit writes before the disruption boundary.
    before = await digest();
  }
  const stop = `
$ErrorActionPreference='Stop'
$health=Invoke-RestMethod 'http://127.0.0.1:3212/health/bridge'
if(${mode === "claimed" ? "$health.pending -ne 1 -or $health.claimed -ne 1 -or $health.counts.queued -ne " + report.claimedDiagnostic.counts.queued : "$health.pending -ne 0"} -or $health.draining -ne 0){throw 'unexpected_queue'}
$listeners=@(Get-NetTCPConnection -State Listen -LocalPort 3212)
if($listeners.Count -ne 1){throw 'unexpected_listener'}
$ownedGateway=Get-CimInstance Win32_Process -Filter ('ProcessId = '+$listeners[0].OwningProcess)
if($ownedGateway.Name -ne 'node.exe' -or $ownedGateway.CommandLine -notmatch 'node_modules/coworker-api/scripts/start-standalone-smoke.mjs'){throw 'unexpected_gateway'}
$children=@(Get-CimInstance Win32_Process -Filter ('ParentProcessId = '+$ownedGateway.ProcessId))
if($children.Count -ne 1 -or $children[0].Name -ne 'tunnel-client.exe'){throw 'unexpected_children'}
Stop-Process -Id $children[0].ProcessId -ErrorAction Stop
Stop-Process -Id $ownedGateway.ProcessId -ErrorAction Stop
`;
  await run("powershell.exe", ["-NoProfile", "-Command", stop]);
  if (probeResult) {
    let timer;
    const interrupted = await Promise.race([probeResult, new Promise(yes => { timer = setTimeout(() => yes({ outcome: "not_terminated" }), 12000); })]).finally(() => clearTimeout(timer));
    const passed = interrupted.outcome === "transport_interrupted";
    report.checks.push({ name: "interrupted_request_never_reports_success", passed, outcome: interrupted.outcome });
    // Always restore the gateway first, even if this assertion failed.
    report.interruptionVerified = passed;
  }
  const down = await readDiagnostic(base);
  report.checks.push({ name: "owned_gateway_stopped", passed: down.gatewayVersion === null });
  if (down.gatewayVersion !== null) throw new Error("gateway_did_not_stop");
  gateway = spawn(process.execPath, ["node_modules/coworker-api/scripts/start-standalone-smoke.mjs"], { cwd: candidate, windowsHide: true, detached: true, stdio: "ignore" });
  // Keep the restarted test service alive after the harness exits.
  await new Promise((yes, no) => { gateway.once("spawn", yes); gateway.once("error", no); });
  report.gatewayPid = gateway.pid;
  gateway.unref();
  const start = Date.now();
  while (Date.now() - start < 90000) {
    const state = await readDiagnostic(base);
    if (state.gatewayVersion === pkg.version && state.connected === true && state.runtime === "bridge-v8") { report.reconnectedDiagnostic = state; break; }
    await new Promise(yes => setTimeout(yes, 1000));
  }
  if (!report.reconnectedDiagnostic) throw new Error("existing_widget_did_not_reconnect");
  report.checks.push({ name: "existing_widget_reconnects_without_UI", passed: true, elapsedMs: Date.now() - start });
  const after = await digest();
  const preserved = Object.keys(before).every(name => before[name] === after[name]);
  report.changedDataFiles = Object.keys(before).filter(name => before[name] !== after[name]);
  report.checks.push({ name: "data_and_encrypted_tunnel_credentials_preserved", passed: preserved });
  if (!preserved) throw new Error("data_fingerprint_changed");
  if (mode === "claimed" && !report.interruptionVerified) throw new Error("interrupted_request_not_verified");
  const protocolStart = new Date().toISOString();
  await run(process.execPath, [resolve("scripts/live-protocol-e2e.mjs")]);
  report.checks.push({ name: "six_live_protocol_modes_after_restart", passed: true, runnerStartedAfter: protocolStart });
  report.status = "passed";
} catch (error) {
  report.failure = ["invalid_candidate", "invalid_restart_stage", "test_credential_unavailable", "owned_probe_not_dispatched", "interrupted_request_not_verified", "requires_idle_matching_candidate", "test_command_failed", "gateway_did_not_stop", "existing_widget_did_not_reconnect", "data_fingerprint_changed"].includes(error?.message) ? error.message : "restart_runner_failed";
  process.exitCode = 1;
} finally {
  probeAbort?.abort();
  report.finalDiagnostic = await readDiagnostic(base);
  report.finishedAt = new Date().toISOString();
  await mkdir("artifacts", { recursive: true });
  await writeFile(join("artifacts", "live-restart-" + report.startedAt.replace(/[:.]/g, "-") + ".json"), JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify(report));
}
