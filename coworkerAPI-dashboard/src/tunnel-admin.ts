import { createServer } from 'node:net';
import { TunnelManager } from './tunnel.js';
import { readTunnelSettings, validateTunnelSettings, writeTunnelSettings, type SavedTunnelSettings } from './tunnel-settings.js';
import { installTunnelClient } from './tunnel-install.js';

export type TunnelUpdate = { binaryPath: string; tunnelId: string; runtimeApiKey?: string; enabled: boolean };
export class TunnelAdmin {
  private settings: SavedTunnelSettings;
  private busy = false;
  constructor(private readonly dataDir: string, readonly manager: TunnelManager) {
    try { this.settings = readTunnelSettings(dataDir); }
    catch { this.settings = { enabled: false }; manager.configurationError(); }
  }
  metadata() {
    return { binaryPath: this.settings.binaryPath ?? '', tunnelId: this.settings.tunnelId ?? '', hasRuntimeKey: Boolean(this.settings.runtimeApiKey), enabled: this.settings.enabled, status: this.manager.snapshot(), canInstall: process.platform === 'win32' && ['x64', 'arm64'].includes(process.arch), busy: this.busy };
  }
  private async exclusive<T>(action: () => Promise<T>): Promise<T> {
    if (this.busy) throw new Error('tunnel_operation_busy');
    this.busy = true;
    try { return await action(); } finally { this.busy = false; }
  }
  private async startCurrent() {
    if (!this.settings.enabled) return this.manager.snapshot();
    if (this.manager.snapshot().state === 'running' || this.manager.snapshot().state === 'starting') return this.manager.snapshot();
    await validateTunnelSettings(this.settings);
    const healthPort = await new Promise<number>((yes, no) => {
      const socket = createServer(); socket.once('error', no);
      socket.listen(0, '127.0.0.1', () => { const port = (socket.address() as { port: number }).port; socket.close(error => error ? no(error) : yes(port)); });
    });
    await this.manager.configure({ ...this.settings, healthPort });
    return this.manager.start();
  }
  async boot() {
    try { return await this.exclusive(() => this.startCurrent()); }
    catch { this.manager.configurationError(); return this.manager.snapshot(); }
  }
  async save(update: TunnelUpdate) {
    return this.exclusive(async () => {
      const next = { ...update, runtimeApiKey: update.runtimeApiKey ?? this.settings.runtimeApiKey };
      await validateTunnelSettings(next);
      const previous = this.settings;
      await this.manager.stop();
      try { await writeTunnelSettings(this.dataDir, next); }
      catch (error) { if (previous.enabled) await this.startCurrent().catch(() => {}); throw error; }
      this.settings = next;
      await this.manager.configure(next);
      if (next.enabled) await this.startCurrent();
      return this.metadata();
    });
  }
  async start() {
    return this.exclusive(async () => {
      const next = { ...this.settings, enabled: true };
      await writeTunnelSettings(this.dataDir, next);
      this.settings = next;
      await this.startCurrent();
      return this.metadata();
    });
  }
  async stop() {
    return this.exclusive(async () => {
      await this.manager.stop();
      if (this.settings.runtimeApiKey) await writeTunnelSettings(this.dataDir, { ...this.settings, enabled: false });
      this.settings.enabled = false;
      return this.metadata();
    });
  }
  async test() {
    const probe = await this.manager.probe();
    return { ...probe, status: this.manager.snapshot(), message: probe.remoteReady ? 'Tunnel sẵn sàng. Kết nối plugin và kích hoạt widget trong ChatGPT để tiếp tục.' : 'Tunnel chưa xác nhận sẵn sàng. Kiểm tra Tunnel ID, Runtime API key, kết nối mạng và quyền Tunnels Read + Use.' };
  }
  async install() { return this.exclusive(() => installTunnelClient(this.dataDir)); }
}
