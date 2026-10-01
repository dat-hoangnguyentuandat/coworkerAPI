#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

if (process.platform !== "win32") throw new Error("This one-time encrypted Coworker import is Windows-only.");
const source = resolve(process.argv[2] ?? join(process.env.APPDATA ?? "", "coworker"));
const destination = resolve(process.argv[3] ?? join(process.cwd(), "data"));
const state = JSON.parse(readFileSync(join(source, "Local State"), "utf8"));
const settings = JSON.parse(readFileSync(join(source, "settings.json"), "utf8"));
const tunnels = Array.isArray(settings.tunnels) ? settings.tunnels : settings.tunnel ? [settings.tunnel] : [];
const selected = tunnels.filter((item) => item.enabled && /^tunnel_[a-f0-9]{32}$/.test(item.tunnelId) && /^enc:[A-Za-z0-9+/=]+$/.test(item.runtimeApiKey ?? ""));
if (selected.length !== 1) throw new Error("Expected exactly one enabled encrypted Coworker tunnel; no credentials were imported.");
const tunnel = selected[0];
if (!/^.{1,1024}$/.test(tunnel.binaryPath ?? "")) throw new Error("Tunnel executable path is missing or invalid.");
if (!/^[A-Za-z0-9+/=]+$/.test(state.os_crypt?.encrypted_key ?? "")) throw new Error("Encrypted Windows state key is missing.");
mkdirSync(destination, { recursive: true });
const target = join(destination, "tunnel-credentials.json");
writeFileSync(target, JSON.stringify({
  version: 1,
  tunnelId: tunnel.tunnelId,
  binaryPath: tunnel.binaryPath,
  encryptedRuntimeApiKey: tunnel.runtimeApiKey,
  encryptedStateKey: state.os_crypt.encrypted_key,
}) + "\n", { encoding: "utf8", mode: 0o600, flag: "wx" });
console.log(`Encrypted tunnel configuration imported to ${target}. No plaintext key was printed or stored.`);
