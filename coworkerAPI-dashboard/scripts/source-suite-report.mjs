#!/usr/bin/env node
// Durable, metadata-only source-suite evidence. Never persist TAP arguments/errors.
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const report = { startedAt: new Date().toISOString(), status: "failed", phase: "build", failedTests: [] };
async function run(args) {
  const child = spawn(process.execPath, args, { cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  let output = "", stderrBytes = 0, truncated = false;
  child.stdout.on("data", chunk => { if (output.length + chunk.length <= 2_000_000) output += chunk; else truncated = true; });
  child.stderr.on("data", chunk => { stderrBytes += chunk.length; });
  const timer = setTimeout(() => child.kill(), 180_000);
  try {
    const code = await new Promise((yes, no) => { child.once("error", no); child.once("close", yes); });
    return { code, output, stderrBytes, truncated };
  } finally { clearTimeout(timer); }
}
try {
  const build = await run([join(root, "node_modules/typescript/bin/tsc"), "-p", join(root, "tsconfig.json")]);
  report.buildExitCode = build.code;
  if (build.code !== 0) throw new Error("build_failed");
  report.phase = "tests";
  const result = await run(["--test", "--test-reporter=tap", "--import", "tsx", "tests/**/*.test.ts"]);
  report.testExitCode = result.code; report.stderrBytes = result.stderrBytes; report.outputTruncated = result.truncated;
  report.failedTests = [...result.output.matchAll(/^\s*not ok \d+ - (.+)$/gm)].map(match => match[1].slice(0, 240));
  const count = name => Number(result.output.match(new RegExp(`^# ${name} (\\d+)$`, "m"))?.[1] ?? -1);
  report.tests = count("tests"); report.passed = count("pass"); report.failed = count("fail");
  report.cancelled = count("cancelled"); report.skipped = count("skipped");
  // Only source locations/Node error classifications, not expected/actual values.
  report.failureLocations = [...new Set([...result.output.matchAll(/tests[\\/][A-Za-z0-9._-]+\.test\.ts:\d+:\d+/g)].map(match => match[0]))];
  report.failureCodes = [...new Set([...result.output.matchAll(/\bERR_[A-Z0-9_]+\b/g)].map(match => match[0]))];
  if (result.code !== 0 || result.truncated || report.tests <= 0 || report.failed !== 0 || report.cancelled !== 0 || report.skipped !== 0 || report.passed !== report.tests) throw new Error("source_suite_failed");
  report.status = "passed";
} catch (error) { report.failure = ["build_failed", "source_suite_failed"].includes(error?.message) ? error.message : "source_suite_runner_failed"; process.exitCode = 1; }
finally {
  report.finishedAt = new Date().toISOString(); const directory = resolve(root, "artifacts"); await mkdir(directory, { recursive: true });
  await writeFile(join(directory, `source-suite-${report.startedAt.replace(/[:.]/g, "-")}.json`), JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify(report));
}
