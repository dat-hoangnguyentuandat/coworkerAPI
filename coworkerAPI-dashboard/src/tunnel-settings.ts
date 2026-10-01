import { execFile, execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, rename, writeFile, stat } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { loadTunnelCredentials, type TunnelCredentials } from './tunnel-config.js';

export type SavedTunnelSettings = TunnelCredentials & { enabled: boolean };
type ProtectedSettings = { version: 2; enabled: boolean; binaryPath: string; tunnelId: string; protectedKey: string };
function helper(): string {
  const directory = dirname(fileURLToPath(import.meta.url));
  const path = [resolve(directory, '../../scripts/protect-tunnel-secret.ps1'), resolve(directory, '../scripts/protect-tunnel-secret.ps1')].find(existsSync);
  if (!path || process.platform !== 'win32') throw new Error('tunnel_secure_storage_unavailable');
  return path;
}
export function readTunnelSettings(dataDir: string): SavedTunnelSettings {
  const file = join(dataDir, 'tunnel-settings.json');
  if (!existsSync(file)) {
    const legacy = loadTunnelCredentials(dataDir);
    return { ...legacy, enabled: Boolean(legacy.binaryPath || legacy.tunnelId || legacy.runtimeApiKey) };
  }
  try {
    const saved = JSON.parse(readFileSync(file, 'utf8')) as ProtectedSettings;
    if (saved.version !== 2 || typeof saved.enabled !== 'boolean' || !saved.protectedKey || !saved.binaryPath || !saved.tunnelId) throw new Error();
    const runtimeApiKey = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', helper(), '-Mode', 'unprotect'], {
      input: saved.protectedKey, encoding: 'utf8', windowsHide: true, timeout: 10_000, maxBuffer: 32_768, stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { enabled: saved.enabled, binaryPath: saved.binaryPath, tunnelId: saved.tunnelId, runtimeApiKey };
  } catch { throw new Error('tunnel_settings_cannot_unlock'); }
}
export async function validateTunnelSettings(settings: SavedTunnelSettings): Promise<void> {
  if (!settings.binaryPath || !isAbsolute(settings.binaryPath) || settings.binaryPath.length > 2048 || !/^tunnel-client(?:\.exe)?$/i.test(basename(settings.binaryPath))) throw new Error('tunnel_binary_invalid');
  if (!/^tunnel_[a-f0-9]{32}$/.test(settings.tunnelId ?? '')) throw new Error('tunnel_id_invalid');
  if (!settings.runtimeApiKey || settings.runtimeApiKey.length < 20 || settings.runtimeApiKey.length > 16_384 || /\s/.test(settings.runtimeApiKey)) throw new Error('tunnel_key_invalid');
  try { if (!(await stat(settings.binaryPath)).isFile()) throw new Error(); } catch { throw new Error('tunnel_binary_missing'); }
}
export async function writeTunnelSettings(dataDir: string, settings: SavedTunnelSettings): Promise<void> {
  await validateTunnelSettings(settings);
  const protectedKey = await new Promise<string>((yes, no) => {
    const child = execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', helper(), '-Mode', 'protect'], {
      encoding: 'utf8', windowsHide: true, timeout: 10_000, maxBuffer: 32_768,
    }, (error, stdout) => error ? no(new Error('tunnel_secret_storage_failed')) : yes(stdout.trim()));
    child.stdin?.on('error', () => {});
    child.stdin?.end(settings.runtimeApiKey);
  });
  if (!protectedKey || !/^[A-Za-z0-9+/=]+$/.test(protectedKey)) throw new Error('tunnel_secret_storage_failed');
  const saved: ProtectedSettings = { version: 2, enabled: settings.enabled, binaryPath: settings.binaryPath!, tunnelId: settings.tunnelId!, protectedKey };
  await mkdir(dataDir, { recursive: true });
  const temporary = join(dataDir, 'tunnel-settings-' + randomUUID() + '.tmp');
  await writeFile(temporary, JSON.stringify(saved) + '\n', { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  await rename(temporary, join(dataDir, 'tunnel-settings.json'));
}
