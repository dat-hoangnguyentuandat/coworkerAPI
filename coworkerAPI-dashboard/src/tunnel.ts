import { spawn, type ChildProcess } from "node:child_process";

export type TunnelStatus = { state: "disabled" | "starting" | "running" | "error" | "stopped"; message: string };

type TunnelConfig = {
  binaryPath?: string;
  tunnelId?: string;
  runtimeApiKey?: string;
  mcpSecret: string;
  mcpUrl: string;
  healthPort?: number;
};

function processEnvironment(): NodeJS.ProcessEnv {
  const names = ["PATH", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY"];
  return Object.fromEntries(names.filter((name) => process.env[name]).map((name) => [name, process.env[name]]));
}

/** Owns the public MCP tunnel process; no Coworker desktop process is needed. */
export class TunnelManager {
  private child?: ChildProcess;
  private current: TunnelStatus = { state: "disabled", message: "Tunnel is not configured." };
  private stopping = false;

  constructor(private config: TunnelConfig) {}

  async configure(values: Partial<TunnelConfig>): Promise<void> {
    await this.stop();
    this.config = { ...this.config, ...values };
    this.current = { state: 'disabled', message: 'Tunnel is stopped; saved settings are ready.' };
  }

  async probe(): Promise<{ processRunning: boolean; remoteReady: boolean | null }> {
    const processRunning = this.current.state === 'running';
    if (!processRunning || !this.config.healthPort) return { processRunning, remoteReady: null };
    try {
      const response = await fetch(`http://127.0.0.1:${this.config.healthPort}/readyz`, { signal: AbortSignal.timeout(3000), redirect: 'error' });
      await response.body?.cancel();
      return { processRunning, remoteReady: response.status === 200 };
    } catch { return { processRunning, remoteReady: false }; }
  }

  snapshot(): TunnelStatus { return { ...this.current }; }
  configurationError(): void { this.current = { state: 'error', message: 'Không đọc hoặc chạy được cấu hình tunnel. Mở Kết nối để kiểm tra và lưu lại.' }; }

  start(): TunnelStatus {
    const { binaryPath, tunnelId, runtimeApiKey, mcpSecret, mcpUrl } = this.config;
    if (!binaryPath && !tunnelId && !runtimeApiKey) return this.snapshot();
    if (!binaryPath || !tunnelId || !runtimeApiKey) {
      this.current = { state: "error", message: "Set COWORKER_TUNNEL_BIN, COWORKER_TUNNEL_ID, and COWORKER_TUNNEL_API_KEY together." };
      return this.snapshot();
    }
    if (!/^tunnel_[a-f0-9]{32}$/.test(tunnelId) || runtimeApiKey.length < 20 || !mcpSecret) {
      this.current = { state: "error", message: "Invalid tunnel ID, Runtime API key, or missing MCP secret." };
      return this.snapshot();
    }
    if (this.child) return this.snapshot();
    this.stopping = false;
    this.current = { state: "starting", message: "Starting tunnel-client." };
    const env = {
      ...processEnvironment(),
      CONTROL_PLANE_TUNNEL_ID: tunnelId,
      CONTROL_PLANE_API_KEY: runtimeApiKey,
      MCP_SERVER_URL: mcpUrl,
      MCP_EXTRA_HEADERS: `Authorization: Bearer ${mcpSecret}`,
    };
    const child = spawn(binaryPath, ["run", "--health.listen-addr", `127.0.0.1:${this.config.healthPort ?? 0}`, "--log.level=info", "--log.format=struct-text"], {
      env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
    });
    this.child = child;
    child.once("spawn", () => { if (this.child === child) this.current = { state: "running", message: "Tunnel-client process is running; remote readiness is not yet verified." }; });
    child.once("error", (error) => {
      if (this.child !== child) return;
      this.child = undefined;
      this.current = { state: "error", message: `Tunnel-client could not start: ${error.message}` };
    });
    child.once("close", (code) => {
      if (this.child !== child) return;
      this.child = undefined;
      this.current = this.stopping
        ? { state: "stopped", message: "Tunnel-client stopped." }
        : { state: "error", message: `Tunnel-client exited with code ${code ?? "unknown"}.` };
    });
    // Do not log raw child output: control-plane credentials can appear there.
    child.stdout?.resume();
    child.stderr?.resume();
    return this.snapshot();
  }

  async stop(): Promise<void> {
    const child = this.child;
    if (!child) return;
    this.stopping = true;
    await new Promise<void>((resolve, reject) => {
      const deadline = setTimeout(() => {
        this.stopping = false;
        reject(new Error('tunnel_stop_timeout'));
      }, 5_000);
      deadline.unref();
      child.once('close', () => { clearTimeout(deadline); resolve(); });
      child.once('error', () => { clearTimeout(deadline); reject(new Error('tunnel_stop_failed')); });
      if (!child.kill()) { clearTimeout(deadline); reject(new Error('tunnel_stop_failed')); }
    });
    if (this.child === child) this.child = undefined;
    this.current = { state: "stopped", message: "Tunnel-client stopped." };
  }
}
