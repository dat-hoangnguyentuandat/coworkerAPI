import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { once } from "node:events";
import { providerResponseBytes, ProviderTransportError } from "../src/provider-transport.js";
import type { ProviderRecord } from "../src/local-store.js";

test("native transport streams bounded POST bytes, pins host, rejects redirects and cancels upstream", async () => {
  let hits = 0;
  let lastPath = "";
  let sawCredential = false;
  let sawClientHeader = false;
  let requestBody = "";
  const server = createServer(async (request, reply) => {
    hits++; lastPath = request.url ?? "";
    sawCredential = request.headers.authorization === "Bearer transport-test-key" || request.headers["x-api-key"] === "transport-test-key";
    sawClientHeader = Boolean(request.headers["x-coworker-profile-id"]);
    requestBody = "";
    for await (const chunk of request) requestBody += chunk;
    if (request.url?.includes("redirect")) { reply.writeHead(302, { location: "/credential-sink" }); reply.end("transport-test-key"); return; }
    if (request.url?.includes("fail")) { reply.writeHead(401); reply.end("transport-test-key secret upstream body"); return; }
    if (request.url?.includes("hang")) { reply.writeHead(200); reply.write("first"); return; }
    reply.writeHead(200); reply.write("first"); setImmediate(() => reply.end("second"));
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  const provider = (path: string, type: ProviderRecord["type"] = "openai-compatible"): ProviderRecord => ({ id: "test", name: "fixture", type, baseUrl: base + path, enabled: true });
  const collect = async (path: string, options = {}, signal = new AbortController().signal, type: ProviderRecord["type"] = "openai-compatible") => {
    const chunks: Buffer[] = [];
    for await (const chunk of providerResponseBytes(provider(path, type), "transport-test-key", type === "anthropic" ? "messages" : "responses", { model: "fixture", stream: true }, signal, { allowPrivate: true, ...options })) chunks.push(chunk);
    return Buffer.concat(chunks).toString();
  };
  try {
    assert.equal(await collect("/v1"), "firstsecond");
    assert.equal(lastPath, "/v1/responses"); assert.ok(sawCredential); assert.ok(!sawClientHeader);
    assert.deepEqual(JSON.parse(requestBody), { model: "fixture", stream: true });
    assert.equal(await collect("/v1", {}, undefined, "anthropic"), "firstsecond");
    assert.equal(lastPath, "/v1/messages");
    const beforeRedirect = hits;
    await assert.rejects(collect("/redirect"), (error: unknown) => error instanceof ProviderTransportError && error.upstreamStatus === 302);
    assert.equal(hits, beforeRedirect + 1);
    await assert.rejects(collect("/fail"), (error: unknown) => error instanceof ProviderTransportError && !error.message.includes("transport-test-key") && error.upstreamStatus === 401);
    await assert.rejects(collect("/v1", { maxResponseBytes: 4 }), /size limit/);
    await assert.rejects(collect("/v1", { maxRequestBytes: 1 }), /size limit/);
    await assert.rejects(collect("/hang", { timeoutMs: 50 }), /timed out/);
    const aborted = new AbortController(); aborted.abort();
    const beforeAbort = hits;
    await assert.rejects(collect("/v1", {}, aborted.signal), /cancelled/);
    assert.equal(hits, beforeAbort);
    const activeAbort = new AbortController();
    const iterator = providerResponseBytes(provider("/hang"), "transport-test-key", "responses", {}, activeAbort.signal, { allowPrivate: true });
    assert.equal((await iterator.next()).value?.toString(), "first");
    activeAbort.abort(); await assert.rejects(iterator.next(), /cancelled/);
    const blocked = providerResponseBytes(provider("/v1"), "transport-test-key", "responses", {}, new AbortController().signal, { allowPrivate: false });
    await assert.rejects(blocked.next(), /HTTPS|Private/);
  } finally { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
});
