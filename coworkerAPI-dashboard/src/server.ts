import { buildServer } from "./app.js";
import { CoworkerBridge } from "./bridge.js";
import { WorkspaceAgentBridge } from "./workspace-agent.js";
import { WidgetBridge } from "./widget-bridge.js";
import { LocalStore } from "./local-store.js";
import { TunnelManager } from "./tunnel.js";
import { TunnelAdmin } from "./tunnel-admin.js";
import { existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join, resolve } from "node:path";

if (existsSync(".env")) process.loadEnvFile(".env");

const bridge = (process.env.COWORKER_UPSTREAM ?? "widget") === "widget"
  ? new WidgetBridge()
  : process.env.COWORKER_UPSTREAM === "workspace-agent"
  ? new WorkspaceAgentBridge({
      triggerId: required("WORKSPACE_AGENT_TRIGGER_ID"),
      accessToken: required("WORKSPACE_AGENT_ACCESS_TOKEN"),
    })
  : new CoworkerBridge();
const dataDir = resolve(process.env.COWORKER_DATA_DIR ?? "data");
if (bridge instanceof WidgetBridge) required("COWORKER_MCP_SECRET");
const port = Number(process.env.PORT ?? 3211);
const host = process.env.HOST ?? "127.0.0.1";
const tunnel = new TunnelManager({
  mcpSecret: process.env.COWORKER_MCP_SECRET ?? "",
  mcpUrl: `http://127.0.0.1:${port}/mcp`,
});
const store = new LocalStore(join(dataDir, "coworkerapi.json"));
const tunnelAdmin = new TunnelAdmin(dataDir, tunnel);
// Default password is for loopback-only local use. Remote deployments must
// provision their own password; never bootstrap the known local default there.
const bootstrapPassword = process.env.COWORKER_ADMIN_PASSWORD || (process.env.COWORKER_ADMIN_ALLOW_REMOTE === "true" ? undefined : "123456");
if (!store.initialized && bootstrapPassword) {
  if (bootstrapPassword.length < 6 || bootstrapPassword.length > 256) throw new Error("COWORKER_ADMIN_PASSWORD must be between 6 and 256 characters.");
  store.setup(bootstrapPassword);
}
if (process.env.COWORKER_ADMIN_ALLOW_REMOTE === "true" && !store.initialized) throw new Error("Remote admin requires a pre-initialized store or COWORKER_ADMIN_PASSWORD.");
const app = buildServer(bridge, process.env.COWORKER_BRIDGE_SECRET ?? randomBytes(32).toString("base64url"), store, () => tunnel.snapshot(), tunnelAdmin);
app.get("/health/tunnel", async () => tunnel.snapshot());
app.addHook("preClose", async () => { if (bridge instanceof WidgetBridge) bridge.shutdown(); });
app.addHook("onClose", async () => tunnel.stop());
app.listen({ port, host }).then(async () => {
  try { await tunnelAdmin.boot(); } catch { /* Dashboard remains available to repair tunnel settings. */ }
}).catch((error) => { app.log.error(error); process.exit(1); });

let closing = false;
async function shutdown() {
    if (closing) return;
    closing = true;
    const deadline = setTimeout(() => app.server.closeAllConnections(), 5_000);
    deadline.unref();
    try { await app.close(); }
    catch { process.exitCode = 1; }
    finally { clearTimeout(deadline); if (process.connected) process.disconnect(); }
}
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, shutdown);
}
// Only a parent with Node's private IPC channel can request launcher shutdown.
// Losing that parent also closes the owned bridge/tunnel, rather than orphaning it.
if (process.send) {
  process.on("message", (message) => {
    if (message && typeof message === "object" && "type" in message && message.type === "coworkerapi:shutdown") void shutdown();
  });
  process.on("disconnect", shutdown);
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
