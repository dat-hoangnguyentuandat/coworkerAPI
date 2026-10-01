import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP } from "node:net";
import type { ProviderRecord } from "./local-store.js";

const denied = new BlockList();
for (const [address, prefix] of [["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4]] as const) denied.addSubnet(address, prefix, "ipv4");
const globalV6 = new BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");
// Block transition mechanisms and special-use ranges, not just ::1/ULA.
for (const [address, prefix] of [["2001::", 23], ["2001:db8::", 32], ["2002::", 16], ["3fff::", 20]] as const) denied.addSubnet(address, prefix, "ipv6");

export function isPublicProviderAddress(address: string): boolean {
  const family = isIP(address);
  return family === 4 ? !denied.check(address, "ipv4") : family === 6 && globalV6.check(address, "ipv6") && !denied.check(address, "ipv6");
}

export function providerBaseUrl(base: string, allowPrivate = process.env.ALLOW_PRIVATE_UPSTREAMS === "true"): URL {
  let url: URL;
  try { url = new URL(base); } catch { throw new Error("Invalid provider base URL."); }
  if (!url.hostname || url.username || url.password || url.search || url.hash || (url.protocol !== "https:" && !(allowPrivate && url.protocol === "http:"))) throw new Error("Provider base URL must use HTTPS without embedded credentials, query or fragment.");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (!allowPrivate && (host.toLowerCase() === "localhost" || (isIP(host) && !isPublicProviderAddress(host)))) throw new Error("Private or reserved upstream addresses are disabled.");
  return url;
}

/** Bounded model-list probe. DNS is checked and pinned to prevent rebinding;
 * redirects are never followed, so credentials cannot leak to another host. */
export async function probeProvider(provider: ProviderRecord, apiKey: string, options: { allowPrivate?: boolean; timeoutMs?: number; maxBytes?: number } = {}) {
  if (!/^[\x21-\x7e]{1,16384}$/.test(apiKey)) throw new Error("Invalid provider credential format.");
  const allowPrivate = options.allowPrivate ?? process.env.ALLOW_PRIVATE_UPSTREAMS === "true";
  const url = providerBaseUrl(provider.baseUrl ?? "", allowPrivate);
  url.pathname = url.pathname.replace(/\/$/, "") + (provider.type === "anthropic" ? "/v1/models" : "/models");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const started = Date.now();
  const timeoutMs = options.timeoutMs ?? 10_000;
  let dnsTimer: ReturnType<typeof setTimeout> | undefined;
  const addresses = await Promise.race([
    lookup(host, { all: true, verbatim: true }).catch(() => { throw new Error("Unable to resolve the provider host."); }),
    new Promise<never>((_yes, no) => { dnsTimer = setTimeout(() => no(new Error("Provider DNS lookup timed out.")), timeoutMs); dnsTimer.unref(); }),
  ]).finally(() => clearTimeout(dnsTimer));
  if (!addresses.length || (!allowPrivate && addresses.some((item) => !isPublicProviderAddress(item.address)))) throw new Error("Provider DNS resolves to a blocked address.");
  const pinned = addresses[0];
  const remaining = timeoutMs - (Date.now() - started);
  if (remaining <= 0) throw new Error("Provider connection timed out.");
  const body = await new Promise<Record<string, unknown>>((yes, no) => {
    const headers = provider.type === "anthropic"
      ? { "x-api-key": apiKey, "anthropic-version": "2023-06-01", accept: "application/json" }
      : { authorization: `Bearer ${apiKey}`, accept: "application/json" };
    const send = url.protocol === "https:" ? httpsRequest : httpRequest;
    const request = send(url, {
      method: "GET", headers, agent: false,
      lookup: ((_hostname: string, lookupOptions: { all?: boolean }, callback: (...args: unknown[]) => void) => lookupOptions.all ? callback(null, [pinned]) : callback(null, pinned.address, pinned.family)) as any,
    }, (response) => {
      if (response.statusCode !== 200) {
        response.resume();
        no(new Error(`Provider connection failed: HTTP ${response.statusCode ?? 0}.`));
        return;
      }
      let length = 0;
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => {
        length += chunk.length;
        if (length > (options.maxBytes ?? 1024 * 1024)) { request.destroy(); no(new Error("Provider model list exceeds the size limit.")); }
        else chunks.push(chunk);
      });
      response.on("end", () => {
        try { yes(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
        catch { no(new Error("Provider returned an invalid JSON model list.")); }
      });
      response.on("error", () => no(new Error("Provider response was interrupted.")));
    });
    const timer = setTimeout(() => { request.destroy(); no(new Error("Provider connection timed out.")); }, remaining);
    request.on("close", () => clearTimeout(timer));
    request.on("error", () => no(new Error("Unable to connect to the provider.")));
    request.end();
  });
  if (!body || typeof body !== "object" || !Array.isArray(body.data)) throw new Error("Provider returned an invalid model list.");
  // Treat the upstream as untrusted. Return only bounded model IDs, never its
  // arbitrary metadata, error body, or an accidentally echoed credential.
  const models = body.data.filter((item): item is { id: string } => item && typeof item.id === "string" && item.id.length <= 200 && !item.id.includes(apiKey)).slice(0, 1000).map((item) => item.id);
  return { connection: "ok", authentication: "ok", latencyMs: Date.now() - started, models };
}
