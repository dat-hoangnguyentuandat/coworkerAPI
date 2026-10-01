import { lookup } from "node:dns/promises";
import { request as httpRequest, type IncomingMessage, type ClientRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import type { ProviderRecord } from "./local-store.js";
import { isPublicProviderAddress, providerBaseUrl } from "./provider-http.js";

export class ProviderTransportError extends Error {
  constructor(readonly code: string, message: string, readonly upstreamStatus?: number) { super(message); }
}
type Options = { allowPrivate?: boolean; timeoutMs?: number; maxRequestBytes?: number; maxResponseBytes?: number };
type Endpoint = "responses" | "chat/completions" | "messages";

/** Bounded authenticated POST transport. Never forwards client headers, follows
 * redirects, or includes untrusted upstream bodies/credentials in errors. */
export async function* providerResponseBytes(provider: ProviderRecord, apiKey: string, endpoint: Endpoint, body: Record<string, unknown>, signal: AbortSignal, options: Options = {}): AsyncGenerator<Buffer> {
  if (signal.aborted) throw new ProviderTransportError("request_cancelled", "Provider request cancelled.");
  if (!/^[\x21-\x7e]{1,16384}$/.test(apiKey)) throw new ProviderTransportError("invalid_credential", "Invalid provider credential format.");
  if (!["responses", "chat/completions", "messages"].includes(endpoint)) throw new ProviderTransportError("invalid_endpoint", "Invalid provider endpoint.");
  const allowPrivate = options.allowPrivate ?? process.env.ALLOW_PRIVATE_UPSTREAMS === "true";
  const url = providerBaseUrl(provider.baseUrl ?? "", allowPrivate);
  const prefix = url.pathname.replace(/\/$/, "");
  url.pathname = prefix + (endpoint === "messages" && !prefix.endsWith("/v1") ? "/v1" : "") + "/" + endpoint;
  const payload = Buffer.from(JSON.stringify(body));
  if (payload.length > (options.maxRequestBytes ?? 16 * 1024 * 1024)) throw new ProviderTransportError("request_too_large", "Provider request exceeds the size limit.");
  const timeoutMs = options.timeoutMs ?? 300_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw new ProviderTransportError("invalid_timeout", "Invalid provider timeout.");
  let request: ClientRequest | undefined;
  let response: IncomingMessage | undefined;
  let rejectPending: ((error: Error) => void) | undefined;
  let stopped: ProviderTransportError | undefined;
  const stop = (error: ProviderTransportError) => {
    stopped ??= error;
    request?.destroy(); response?.destroy(); rejectPending?.(stopped);
  };
  const onAbort = () => stop(new ProviderTransportError("request_cancelled", "Provider request cancelled."));
  const timer = setTimeout(() => stop(new ProviderTransportError("upstream_timeout", "Provider request timed out.")), timeoutMs);
  timer.unref();
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    if (signal.aborted) onAbort();
    const host = url.hostname.replace(/^\[|\]$/g, "");
    const addresses = await new Promise<Awaited<ReturnType<typeof lookup>> | Array<{ address: string; family: number }>>((resolve, reject) => {
      rejectPending = reject;
      if (stopped) { reject(stopped); return; }
      lookup(host, { all: true, verbatim: true }).then(resolve, () => reject(new ProviderTransportError("upstream_dns_error", "Unable to resolve provider host.")));
    }) as Array<{ address: string; family: number }>;
    rejectPending = undefined;
    if (stopped) throw stopped;
    if (!addresses.length || (!allowPrivate && addresses.some((item) => !isPublicProviderAddress(item.address)))) throw new ProviderTransportError("upstream_address_blocked", "Provider DNS resolves to a blocked address.");
    const pinned = addresses[0];
    response = await new Promise<IncomingMessage>((resolve, reject) => {
      rejectPending = reject;
      if (stopped) { reject(stopped); return; }
      const headers = {
        "content-type": "application/json", "content-length": payload.length,
        accept: body.stream === true ? "text/event-stream" : "application/json",
        ...(provider.type === "anthropic" ? { "x-api-key": apiKey, "anthropic-version": "2023-06-01" } : { authorization: `Bearer ${apiKey}` }),
      };
      request = (url.protocol === "https:" ? httpsRequest : httpRequest)(url, {
        method: "POST", headers, agent: false,
        lookup: ((_hostname: string, opts: { all?: boolean }, callback: (...args: unknown[]) => void) => opts.all ? callback(null, [pinned]) : callback(null, pinned.address, pinned.family)) as any,
      }, resolve);
      request.on("error", () => reject(stopped ?? new ProviderTransportError("upstream_connection_error", "Unable to connect to provider.")));
      request.end(payload);
    });
    rejectPending = undefined;
    if (stopped) throw stopped;
    if (response.statusCode !== 200) throw new ProviderTransportError("upstream_http_error", `Provider returned HTTP ${response.statusCode ?? 0}.`, response.statusCode);
    let bytes = 0;
    try {
      for await (const chunk of response) {
        if (stopped) throw stopped;
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        bytes += buffer.length;
        if (bytes > (options.maxResponseBytes ?? 64 * 1024 * 1024)) throw new ProviderTransportError("upstream_response_too_large", "Provider response exceeds the size limit.");
        yield buffer;
      }
    } catch (error) {
      if (error instanceof ProviderTransportError) throw error;
      throw stopped ?? new ProviderTransportError("upstream_interrupted", "Provider response was interrupted.");
    }
    if (stopped) throw stopped;
    if (!response.complete) throw new ProviderTransportError("upstream_interrupted", "Provider response was interrupted.");
  } finally {
    clearTimeout(timer); signal.removeEventListener("abort", onAbort);
    request?.destroy(); response?.destroy();
  }
}
