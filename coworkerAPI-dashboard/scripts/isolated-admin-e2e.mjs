#!/usr/bin/env node
// Real HTTP admin lifecycle against a new store, never resets an existing one.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const packageRoot = process.argv[2] ? resolve(process.argv[2]) : fileURLToPath(new URL("../", import.meta.url));
const { buildServer } = await import(pathToFileURL(join(packageRoot, "dist/src/app.js")).href);
const { LocalStore } = await import(pathToFileURL(join(packageRoot, "dist/src/local-store.js")).href);
const directory = await mkdtemp(join(tmpdir(), "coworkerapi-admin-http-"));
const previous = process.env.COWORKER_API_KEYS;
const previousPrivate = process.env.ALLOW_PRIVATE_UPSTREAMS;
delete process.env.COWORKER_API_KEYS;
process.env.ALLOW_PRIVATE_UPSTREAMS = "true";
const app = buildServer(undefined, undefined, new LocalStore(join(directory, "state.json"), randomBytes(32).toString("hex")));
const upstream = createServer((request, reply) => {
  if (request.url !== "/v1/models" || !request.headers.authorization?.startsWith("Bearer provider-e2e-")) {
    reply.writeHead(401); reply.end(); return;
  }
  reply.setHeader("content-type", "application/json");
  reply.end(JSON.stringify({ data: [{ id: "fixture-model" }] }));
});
try {
  upstream.listen(0, "127.0.0.1");
  await once(upstream, "listening");
  const upstreamAddress = upstream.address();
  if (!upstreamAddress || typeof upstreamAddress === "string") throw new Error("No fixture upstream listener");
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  if (!address || typeof address === "string") throw new Error("No HTTP listener");
  const child = spawn(process.execPath, [fileURLToPath(new URL("candidate-admin-check.mjs", import.meta.url))], {
    windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, COWORKER_E2E_BASE_URL: `http://127.0.0.1:${address.port}`, COWORKER_E2E_PROVIDER_URL: `http://127.0.0.1:${upstreamAddress.port}/v1` },
  });
  child.stdout.pipe(process.stdout);
  child.stderr.pipe(process.stderr);
  process.exitCode = await new Promise((yes, no) => { child.once("error", no); child.once("close", (code) => yes(code ?? 1)); });
} finally {
  await app.close();
  upstream.closeAllConnections();
  upstream.close();
  if (previous === undefined) delete process.env.COWORKER_API_KEYS;
  else process.env.COWORKER_API_KEYS = previous;
  if (previousPrivate === undefined) delete process.env.ALLOW_PRIVATE_UPSTREAMS;
  else process.env.ALLOW_PRIVATE_UPSTREAMS = previousPrivate;
}
