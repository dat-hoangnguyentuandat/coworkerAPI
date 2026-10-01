import assert from "node:assert/strict";
import test from "node:test";
import { TunnelManager } from "../src/tunnel.js";

const base = { mcpSecret: "test-mcp-secret", mcpUrl: "http://127.0.0.1:3211/mcp" };

test("standalone tunnel stays disabled when not configured", () => {
  const tunnel = new TunnelManager(base);
  assert.deepEqual(tunnel.start(), { state: "disabled", message: "Tunnel is not configured." });
});

test("standalone tunnel rejects partial or invalid credentials without starting a process", () => {
  const tunnelId = `tunnel_${"a".repeat(32)}`;
  const partial = new TunnelManager({ ...base, binaryPath: "tunnel-client" });
  assert.equal(partial.start().state, "error");
  const invalidId = new TunnelManager({ ...base, binaryPath: "tunnel-client", tunnelId: "invalid", runtimeApiKey: "x".repeat(20) });
  assert.equal(invalidId.start().state, "error");
  const missingSecret = new TunnelManager({ ...base, mcpSecret: "", binaryPath: "tunnel-client", tunnelId, runtimeApiKey: "x".repeat(20) });
  assert.equal(missingSecret.start().state, "error");
});

test("standalone tunnel reports a missing executable without leaking credentials", async () => {
  const tunnel = new TunnelManager({ ...base, binaryPath: "nonexistent-coworkerapi-tunnel-client", tunnelId: `tunnel_${"b".repeat(32)}`, runtimeApiKey: "secret-runtime-key-123456789" });
  tunnel.start();
  for (let i = 0; i < 50 && tunnel.snapshot().state === "starting"; i++) await new Promise((resolve) => setTimeout(resolve, 10));
  const status = tunnel.snapshot();
  assert.equal(status.state, "error");
  assert.doesNotMatch(status.message, /secret-runtime-key-123456789|test-mcp-secret/);
  await tunnel.stop();
});
