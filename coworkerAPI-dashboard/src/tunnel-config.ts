import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type TunnelCredentials = { binaryPath?: string; tunnelId?: string; runtimeApiKey?: string };

export function loadTunnelCredentials(dataDir: string): TunnelCredentials {
  const configured = {
    binaryPath: process.env.COWORKER_TUNNEL_BIN,
    tunnelId: process.env.COWORKER_TUNNEL_ID,
    runtimeApiKey: process.env.COWORKER_TUNNEL_API_KEY,
  };
  if (Object.values(configured).some(Boolean)) return configured;
  const encryptedFile = join(dataDir, "tunnel-credentials.json");
  if (!existsSync(encryptedFile)) return {};
  if (process.platform !== "win32") throw new Error("Encrypted tunnel credentials require Windows; use environment settings elsewhere.");
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const script = [resolve(moduleDir, "../../scripts/decrypt-tunnel.ps1"), resolve(moduleDir, "../scripts/decrypt-tunnel.ps1")].find(existsSync);
  if (!script) throw new Error("Encrypted tunnel credential helper is missing.");
  try {
    const output = execFileSync("pwsh.exe", ["-NoProfile", "-NonInteractive", "-File", script, encryptedFile], {
      encoding: "utf8", windowsHide: true, timeout: 10_000, maxBuffer: 16_384,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const credentials = JSON.parse(output) as TunnelCredentials;
    if (!credentials.binaryPath || !credentials.tunnelId || !credentials.runtimeApiKey) throw new Error("Incomplete tunnel credentials");
    return credentials;
  } catch {
    throw new Error("Could not unlock encrypted tunnel credentials for this Windows user. Check PowerShell 7 and the imported credentials.");
  }
}
