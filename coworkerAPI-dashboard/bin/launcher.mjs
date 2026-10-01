import { spawn } from "node:child_process";
import { once } from "node:events";
import { createConnection } from "node:net";
import { emitKeypressEvents } from "node:readline";
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { resolve, join } from "node:path";

export function configDirectory(env = process.env, cwd = process.cwd()) {
  if (env.COWORKER_CONFIG_DIR) return resolve(env.COWORKER_CONFIG_DIR);
  if (existsSync(join(cwd, ".env"))) return cwd;
  return join(env.LOCALAPPDATA || env.XDG_CONFIG_HOME || join(homedir(), ".config"), "coworkerapi");
}

export function browserCommand(url, platform = process.platform, env = process.env) {
  const parsed = new URL(url);
  if (parsed.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)) throw new Error("Only a local dashboard URL can be opened.");
  if (env.TERMUX_VERSION || env.PREFIX?.includes("com.termux")) return ["termux-open-url", [url]];
  if (platform === "win32") return ["rundll32.exe", ["url.dll,FileProtocolHandler", url]];
  if (platform === "darwin") return ["open", [url]];
  return ["xdg-open", [url]];
}

export async function openBrowser(url) {
  const [command, args] = browserCommand(url);
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, stdio: "ignore", shell: false });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve() : reject(new Error("Browser opener failed. Open the dashboard URL manually.")));
  });
}

export function localBase(env = process.env) {
  const port = Number(env.PORT ?? 3211);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT must be between 1 and 65535.");
  const host = env.HOST ?? "127.0.0.1";
  if (!["localhost", "127.0.0.1", "0.0.0.0", "::", "::1"].includes(host)) throw new Error("The launcher requires a local HOST. Use coworkerapi start for other hosts.");
  return `http://${host === "::1" ? "[::1]" : "127.0.0.1"}:${port}`;
}

async function portInUse(base) {
  const url = new URL(base);
  return new Promise((resolve) => {
    const socket = createConnection({ host: url.hostname.replace(/[\[\]]/g, ""), port: Number(url.port) });
    const finish = (value) => { socket.destroy(); resolve(value); };
    socket.setTimeout(500, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

export class LauncherServer {
  constructor({ base, bin, cwd, env = process.env }) { Object.assign(this, { base, bin, cwd, env }); }
  async healthy() {
    try {
      const response = await fetch(`${this.base}/version`, { signal: AbortSignal.timeout(700), redirect: "error" });
      return response.ok && (await response.json()).name === "CoworkerAPI";
    } catch { return false; }
  }
  async start() {
    if (this.stopping) throw new Error("Launcher is closing.");
    if (await this.healthy()) return;
    if (await portInUse(this.base)) throw new Error("The configured port is occupied by another service. Choose a different PORT.");
    if (this.stopping) throw new Error("Launcher is closing.");
    this.child = spawn(process.execPath, [this.bin, "start"], { cwd: this.cwd, env: this.env, windowsHide: true, stdio: ["ignore", "ignore", "ignore", "ipc"] });
    let spawnFailed = false;
    this.child.on("error", () => { spawnFailed = true; });
    for (let i = 0; i < 100; i++) {
      if (this.stopping) throw new Error("Launcher is closing.");
      if (spawnFailed || this.child.exitCode !== null || this.child.signalCode !== null) break;
      if (await this.healthy()) return;
      await new Promise((r) => setTimeout(r, 100));
    }
    await this.stopChild();
    throw new Error("Server did not start. Run coworkerapi start in the configuration directory to inspect the error.");
  }
  async stopChild() {
    const child = this.child;
    if (!child) return;
    this.child = undefined;
    if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
    const exited = once(child, "exit").catch(() => {});
    // Node signals terminate immediately on Windows. IPC lets the server close
    // its bridge and owned tunnel first on every platform.
    if (child.connected) child.send({ type: "coworkerapi:shutdown" }, () => {});
    else child.kill("SIGTERM");
    let timer;
    await Promise.race([exited, new Promise((r) => { timer = setTimeout(r, 6000); })]);
    clearTimeout(timer);
    if (child.exitCode === null && child.signalCode === null) { child.kill("SIGKILL"); await exited; }
  }
  async close() { this.stopping = true; await this.stopChild(); }
}

export async function runLauncher({ bin, web = false }) {
  const cwd = configDirectory();
  mkdirSync(cwd, { recursive: true });
  // Bootstrap only once; init never overwrites an existing configuration.
  if (!existsSync(join(cwd, ".env"))) {
    const init = spawn(process.execPath, [bin, "init"], { cwd, windowsHide: true, stdio: "ignore" });
    const [code] = await once(init, "exit");
    if (code !== 0) throw new Error("Could not create the launcher configuration.");
  }
  process.loadEnvFile(join(cwd, ".env"));
  const base = localBase();
  const server = new LauncherServer({ base, bin, cwd });
  let finish;
  const done = new Promise((r) => { finish = r; });
  const quit = () => { server.stopping = true; finish(); };
  process.on("SIGINT", quit);
  process.on("SIGTERM", quit);
  let keyHandler;
  const wasRaw = process.stdin.isRaw;
  try {
    console.log("Starting CoworkerAPI...");
    await server.start();
    if (web) {
      try { await openBrowser(`${base}/dashboard`); } catch { console.log("Could not open the browser automatically."); }
      console.log(`Dashboard: ${base}/dashboard\nKeep this terminal open. Ctrl+C to exit.`);
      await done;
      return;
    }
    emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    let selected = 0, busy = false, status = "";
    const labels = ["Open dashboard in browser", "Connection status", "API endpoints", "Exit"];
    const render = () => {
      const width = Math.max(24, Math.min(72, (process.stdout.columns || 80) - 4));
      const line = (value) => `| ${value.slice(0, width - 2).padEnd(width - 2)} |`;
      console.log("\x1b[2J\x1b[H\x1b[?25l  C O W O R K E R A P I\n");
      console.log(`+${"-".repeat(width)}+\n${line("AI applications, connected through ChatGPT") }\n${line(`Server: running (${server.child ? "launcher-owned" : "existing service"})`)}\n${line(`${base}/dashboard`)}\n+${"-".repeat(width)}+`);
      labels.forEach((label, i) => console.log(`${selected === i ? ">" : " "} ${i + 1}. ${label}`));
      console.log(`\nUp/Down + Enter | 1-4 | Q / Esc to exit\nConfig: ${cwd}\n${status}`);
    };
    const action = async (index) => {
      if (busy) return;
      if (index === 3) { quit(); return; }
      busy = true;
      try {
        if (index === 0) { await server.start(); await openBrowser(`${base}/dashboard`); status = "Dashboard opened."; }
        if (index === 1) {
          const response = await fetch(`${base}/health/inference`, { signal: AbortSignal.timeout(3000) });
          await response.body?.cancel();
          status = `Server: ${await server.healthy() ? "running" : "unavailable"}. Bridge: ${response.ok ? "ready" : "not ready"}.\nOpen Connections in the dashboard to complete ChatGPT setup.`;
        }
        if (index === 2) status = `OpenAI: ${base}/v1\nAnthropic: ${base}\nCreate your API key in the dashboard.`;
      } catch { status = `Action failed. Open ${base}/dashboard manually or run coworkerapi doctor.`; }
      finally { busy = false; if (!server.stopping) render(); }
    };
    keyHandler = (_str, key = {}) => {
      if (key.name === "escape" || key.name === "q" || (key.ctrl && key.name === "c")) { quit(); return; }
      if (busy) return;
      if (key.name === "up" || key.name === "k") selected = (selected + 3) % 4;
      else if (key.name === "down" || key.name === "j") selected = (selected + 1) % 4;
      else if (key.name === "return") { void action(selected); return; }
      else if (/^[1-4]$/.test(_str)) { selected = Number(_str) - 1; void action(selected); return; }
      render();
    };
    process.stdin.on("keypress", keyHandler);
    render();
    await done;
  } finally {
    if (keyHandler) process.stdin.off("keypress", keyHandler);
    if (process.stdin.isTTY) process.stdin.setRawMode(Boolean(wasRaw));
    process.stdin.pause();
    process.stdout.write("\x1b[?25h");
    await server.close();
    process.off("SIGINT", quit);
    process.off("SIGTERM", quit);
  }
}
