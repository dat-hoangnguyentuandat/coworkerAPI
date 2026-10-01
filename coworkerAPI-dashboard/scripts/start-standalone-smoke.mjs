#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

process.env.COWORKER_UPSTREAM = "widget";
process.env.COWORKER_DATA_DIR = resolve("data");
process.env.HOST = "127.0.0.1";
process.env.PORT = "3212";
process.env.COWORKER_MCP_SECRET = randomBytes(32).toString("base64url");
if (!process.env.COWORKER_API_KEYS) {
  const settingsPath = resolve(homedir(), ".claude/settings.json");
  if (existsSync(settingsPath)) {
    const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
    const baseUrl = settings.env?.ANTHROPIC_BASE_URL;
    const key = settings.env?.ANTHROPIC_AUTH_TOKEN ?? settings.env?.ANTHROPIC_API_KEY;
    if (typeof baseUrl === "string" && new URL(baseUrl).hostname === "127.0.0.1" && typeof key === "string" && key.startsWith("cwapi_")) process.env.COWORKER_API_KEYS = key;
  }
}
if (!process.env.COWORKER_API_KEYS) throw new Error("Set COWORKER_API_KEYS before starting the standalone smoke service.");
console.log("Starting standalone CoworkerAPI on http://127.0.0.1:3212; MCP secret remains in memory.");
await import("../dist/src/server.js");
