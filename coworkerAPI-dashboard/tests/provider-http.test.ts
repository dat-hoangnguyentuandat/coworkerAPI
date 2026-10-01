import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import test from "node:test";
import { isPublicProviderAddress, probeProvider, providerBaseUrl } from "../src/provider-http.js";

test("provider URL/address policy blocks private, reserved and transition addresses", () => {
  for (const address of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "198.18.0.1", "192.0.2.1", "::1", "fc00::1", "fe80::1", "::ffff:127.0.0.1", "2002:7f00:1::", "2001:db8::1"]) assert.equal(isPublicProviderAddress(address), false, address);
  for (const address of ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"]) assert.equal(isPublicProviderAddress(address), true, address);
  for (const url of ["https://localhost/v1", "https://127.0.0.1/v1", "https://[::1]/", "http://example.com/v1", "https://user:secret@example.com/v1", "https://example.com/v1?key=secret", "https://example.com/#fragment", "file:///etc/passwd"]) assert.throws(() => providerBaseUrl(url, false), /HTTPS|Private|Invalid/, url);
  assert.equal(providerBaseUrl("https://example.com/v1", false).pathname, "/v1");
  assert.equal(providerBaseUrl("http://127.0.0.1/v1", true).hostname, "127.0.0.1");
});

test("provider model probes use bounded HTTP, sanitize upstream metadata and never follow credential-leaking redirects", async () => {
  let requests = 0;
  const secret = "provider-probe-test-secret";
  const server = createServer((request, reply) => {
    requests++;
    assert.equal(request.headers.authorization, `Bearer ${secret}`);
    if (request.url === "/redirect/models") { reply.writeHead(302, { location: "/stolen" }); reply.end(); }
    else if (request.url === "/large/models") reply.end(JSON.stringify({ data: [], echo: "x".repeat(5000) }));
    else if (request.url === "/slow/models") { /* timeout must destroy client */ }
    else { reply.setHeader("content-type", "application/json"); reply.end(JSON.stringify({ data: [{ id: "model-a", apiKey: secret }, { id: secret }, { id: 123 }], apiKey: secret })); }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const provider = { id: "test", name: "Test", type: "openai-compatible" as const, enabled: true, baseUrl: `http://127.0.0.1:${address.port}/v1` };
  try {
    await assert.rejects(() => probeProvider(provider, secret, { allowPrivate: false }), /HTTPS|Private/);
    assert.equal(requests, 0);
    const success = await probeProvider(provider, secret, { allowPrivate: true });
    assert.deepEqual(success.models, ["model-a"]);
    assert.ok(!JSON.stringify(success).includes(secret));
    await assert.rejects(() => probeProvider({ ...provider, baseUrl: provider.baseUrl.replace("/v1", "/redirect") }, secret, { allowPrivate: true }), /HTTP 302/);
    assert.equal(requests, 2, "Redirect target must never receive credentials");
    await assert.rejects(() => probeProvider({ ...provider, baseUrl: provider.baseUrl.replace("/v1", "/large") }, secret, { allowPrivate: true, maxBytes: 100 }), /size limit/);
    await assert.rejects(() => probeProvider({ ...provider, baseUrl: provider.baseUrl.replace("/v1", "/slow") }, secret, { allowPrivate: true, timeoutMs: 100 }), /timed out/);
  } finally { server.closeAllConnections(); server.close(); await once(server, "close"); }
});
