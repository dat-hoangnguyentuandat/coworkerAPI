#!/usr/bin/env node
import { existsSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runLauncher } from "./launcher.mjs";

const command = process.argv[2] ?? "menu";
const serverModule = new URL("../dist/src/server.js", import.meta.url);
if (!["menu", "web"].includes(command) && existsSync(resolve(".env"))) process.loadEnvFile(resolve(".env"));

if (command === "menu" || command === "web") {
  if (command === "menu" && (!process.stdin.isTTY || !process.stdout.isTTY)) {
    console.log("CoworkerAPI launcher needs an interactive terminal.\nUsage: coworkerapi [menu|web|init|start|doctor|version|help]");
  } else {
    try { await runLauncher({ bin: fileURLToPath(import.meta.url), web: command === "web" }); }
    catch (error) { console.error(error.message); process.exitCode = 1; }
  }
} else if (command === "help" || command === "--help" || command === "-h") {
  console.log("Usage: coworkerapi [menu|web|init|start|doctor|version|help]\nNo arguments: interactive launcher. web: open dashboard and keep server alive.\ninit/start/doctor: use .env in the current directory.\nLauncher: existing .env, COWORKER_CONFIG_DIR, or your user configuration directory.");
} else if (command === "version" || command === "--version") {
  const { readFileSync } = await import("node:fs");
  console.log(`CoworkerAPI ${JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version}`);
} else if (command === "init") {
  const file = resolve(".env");
  if (existsSync(file)) {
    console.log("Configuration already exists. Existing settings were preserved.");
  } else {
    writeFileSync(file, [
      "HOST=127.0.0.1", "PORT=3211", "COWORKER_UPSTREAM=widget", "COWORKER_DATA_DIR=data",
      `COWORKER_MCP_SECRET=${randomBytes(32).toString("base64url")}`,
      `MASTER_ENCRYPTION_KEY=${randomBytes(32).toString("hex")}`,
      "COWORKER_BRIDGE_TIMEOUT_MS=300000", "COWORKER_MODELS=chatgpt-web",
      "COWORKER_TUNNEL_BIN=", "COWORKER_TUNNEL_ID=", "COWORKER_TUNNEL_API_KEY=", "",
    ].join("\n"), { encoding: "utf8", mode: 0o600, flag: "wx" });
    console.log(`Configuration created: ${file}`);
  }
  console.log("Next: configure your tunnel, run coworkerapi start, then set up the dashboard and open the ChatGPT bridge link.");
} else if (command === "start") {
  if (!existsSync(serverModule)) {
    console.error("CoworkerAPI has not been built. Run: npm run build");
    process.exitCode = 1;
  } else if ((process.env.COWORKER_UPSTREAM ?? "widget") === "widget" && !process.env.COWORKER_MCP_SECRET) {
    console.error("Run coworkerapi init or set COWORKER_MCP_SECRET in .env.");
    process.exitCode = 1;
  } else {
    process.env.COWORKER_UPSTREAM ??= "widget";
    const host = process.env.HOST ?? "127.0.0.1";
    const port = process.env.PORT ?? "3211";
    console.log(`CoworkerAPI dashboard: http://${host}:${port}/dashboard`);
    console.log(`OpenAI endpoint:      http://${host}:${port}/v1`);
    console.log(`Anthropic endpoint:   http://${host}:${port}`);
    if (process.env.COWORKER_UPSTREAM === "widget") console.log(`ChatGPT MCP endpoint: http://${host}:${port}/mcp`);
    console.log("Leave this terminal open. Use 'coworkerapi doctor' in another terminal to inspect the standalone service.");
    await import(serverModule.href);
  }
} else if (command === "doctor") {
  const host = process.env.HOST ?? "127.0.0.1";
  const port = Number(process.env.PORT ?? 3211);
  try {
    const response = await fetch(`http://${host}:${port}/health/ready`, { signal: AbortSignal.timeout(3000) });
    console.log(`Gateway: ${response.status} ${JSON.stringify(await response.json())}`);
  } catch (error) { console.log(`Gateway: unreachable (${error instanceof Error ? error.message : "error"})`); }
  try {
    const response = await fetch(`http://${host}:${port}/version`, { signal: AbortSignal.timeout(3000) });
    console.log(`Version: ${response.status} ${JSON.stringify(await response.json())}`);
  } catch { console.log("Version: unreachable"); }
  try {
    const response = await fetch(`http://${host}:${port}/health/inference`, { signal: AbortSignal.timeout(3000) });
    console.log(`Primary bridge inference: ${response.status} ${JSON.stringify(await response.json())}`);
  } catch { console.log("Primary bridge inference: unreachable"); }
  try {
    const response = await fetch(`http://${host}:${port}/mcp`, { method: "POST", signal: AbortSignal.timeout(3000) });
    console.log(`CoworkerAPI MCP /mcp: ${response.status === 401 ? "available (authentication required)" : `HTTP ${response.status}`}`);
  } catch (error) { console.log(`CoworkerAPI MCP /mcp: unreachable (${error instanceof Error ? error.message : "error"})`); }
  try {
    const response = await fetch(`http://${host}:${port}/health/tunnel`, { signal: AbortSignal.timeout(3000) });
    console.log(`CoworkerAPI tunnel: ${JSON.stringify(await response.json())}`);
  } catch (error) { console.log(`CoworkerAPI tunnel: unreachable (${error instanceof Error ? error.message : "error"})`); }
} else {
  console.error("Usage: coworkerapi [menu|web|init|start|doctor|version|help]");
  process.exitCode = 1;
}
