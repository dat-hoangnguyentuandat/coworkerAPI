import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
const execute = promisify(execFile);
const MAX_DOWNLOAD = 64 * 1024 * 1024;
type Asset = { name: string; size: number; digest?: string; browser_download_url: string };
async function readBounded(response: Response, maximum: number): Promise<Buffer> {
  if (!response.ok || !response.body) throw new Error('tunnel_download_failed');
  const chunks: Buffer[] = []; let length = 0;
  const reader = response.body.getReader();
  try { for (;;) { const { done, value } = await reader.read(); if (done) break; length += value.length; if (length > maximum) throw new Error('tunnel_download_too_large'); chunks.push(Buffer.from(value)); } }
  finally { await reader.cancel().catch(() => {}); }
  return Buffer.concat(chunks);
}
/** Only installs a SHA256-verified Windows asset from OpenAI's official repo. */
export async function installTunnelClient(dataDir: string): Promise<{ binaryPath: string; version: string }> {
  if (process.platform !== 'win32' || !['x64', 'arm64'].includes(process.arch)) throw new Error('tunnel_install_platform_unsupported');
  const headers = { 'User-Agent': 'CoworkerAPI', Accept: 'application/vnd.github+json' };
  const releaseResponse = await fetch('https://api.github.com/repos/openai/tunnel-client/releases/latest', { headers, signal: AbortSignal.timeout(30_000), redirect: 'error' });
  const release = JSON.parse((await readBounded(releaseResponse, 1024 * 1024)).toString('utf8')) as { tag_name: string; assets: Asset[] };
  if (!/^v\d+\.\d+\.\d+$/.test(release.tag_name) || !Array.isArray(release.assets)) throw new Error('tunnel_release_invalid');
  const architecture = process.arch === 'x64' ? 'amd64' : 'arm64';
  const name = `tunnel-client-${release.tag_name}-windows-${architecture}.zip`;
  const asset = release.assets.find(item => item.name === name);
  if (!asset || !/^sha256:[a-f0-9]{64}$/.test(asset.digest ?? '') || asset.size < 1024 || asset.size > MAX_DOWNLOAD) throw new Error('tunnel_checksum_unavailable');
  if (asset.browser_download_url !== `https://github.com/openai/tunnel-client/releases/download/${release.tag_name}/${name}`) throw new Error('tunnel_download_url_invalid');
  const response = await fetch(asset.browser_download_url, { headers: { 'User-Agent': 'CoworkerAPI' }, signal: AbortSignal.timeout(120_000) });
  if (!['github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com'].includes(new URL(response.url).hostname)) throw new Error('tunnel_download_url_invalid');
  const archive = await readBounded(response, MAX_DOWNLOAD);
  if (archive.length !== asset.size || createHash('sha256').update(archive).digest('hex') !== asset.digest!.slice(7)) throw new Error('tunnel_checksum_mismatch');
  const directory = join(dataDir, 'bin', release.tag_name + '-' + architecture + '-' + randomUUID());
  await mkdir(directory, { recursive: true });
  const archivePath = join(directory, name); const binaryPath = join(directory, 'tunnel-client.exe');
  await writeFile(archivePath, archive, { mode: 0o600, flag: 'wx' });
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const script = [resolve(moduleDir, '../../scripts/extract-tunnel-client.ps1'), resolve(moduleDir, '../scripts/extract-tunnel-client.ps1')].find(existsSync);
  if (!script) throw new Error('tunnel_installer_missing');
  try { await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', script, '-ArchivePath', archivePath, '-DestinationPath', binaryPath], { windowsHide: true, timeout: 30_000 }); }
  catch { throw new Error('tunnel_extract_failed'); }
  return { binaryPath, version: release.tag_name };
}
