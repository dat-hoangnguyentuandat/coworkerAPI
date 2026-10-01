import assert from "node:assert/strict";
import test from "node:test";
import { createContext, Script } from "node:vm";
import { WIDGET_HOST_BRIDGE_JS } from "../src/widget-host-bridge.js";

type Message = { jsonrpc: string; id?: number; method?: string; params?: unknown; result?: unknown; error?: unknown };
function harness(initialize = true) {
  let listener!: (event: { source: unknown; data: Message }) => void;
  let aliasCalls = 0;
  const sent: Message[] = [];
  const timers: { callback: () => void; cleared?: boolean }[] = [];
  const parent = { postMessage(message: Message) {
    sent.push(message);
    if (initialize && message.method === "ui/initialize") listener({ source: parent, data: { jsonrpc: "2.0", id: message.id, result: { protocolVersion: "2026-01-26" } } });
  } };
  const browser = createContext({
    setTimeout(callback: () => void) { const timer = { callback }; timers.push(timer); return timer; },
    clearTimeout(timer: { cleared?: boolean }) { timer.cleared = true; },
    window: { parent, addEventListener: (_name: string, callback: typeof listener) => { listener = callback; }, openai: { callTool: async () => { aliasCalls++; return { structuredContent: { alias: true } }; } } },
  });
  new Script(WIDGET_HOST_BRIDGE_JS).runInContext(browser);
  return { browser, sent, timers, get aliasCalls() { return aliasCalls; },
    reply(message: Message, source: unknown = parent) { listener({ source, data: message }); } };
}

test("standard tool transport initializes before calls and accepts only matching parent responses", async () => {
  const host = harness();
  await new Script("hostBridgeReady").runInContext(host.browser);
  assert.deepEqual(host.sent.map(message => message.method), ["ui/initialize", "ui/notifications/initialized"]);
  const request = new Script("callHostTool('workbench_api_poll', {heartbeat_only:true})").runInContext(host.browser);
  for (let i = 0; i < 5; i++) await Promise.resolve();
  const call = host.sent.at(-1)!;
  assert.equal(call.method, "tools/call");
  host.reply({ jsonrpc: "2.0", id: call.id, result: {} }, {});
  host.reply({ jsonrpc: "2.0", id: call.id! + 1, result: {} });
  host.reply({ jsonrpc: "2.0", id: call.id, result: {}, error: {} });
  host.reply({ jsonrpc: "2.0", id: call.id, method: "tools/call", result: {} });
  assert.equal(new Script("rpcWaiters.size").runInContext(host.browser), 1);
  host.reply({ jsonrpc: "2.0", id: call.id, result: { structuredContent: { ready: true } } });
  assert.equal((await request).structuredContent.ready, true);
  assert.equal(host.aliasCalls, 0);
  assert.equal(new Script("rpcWaiters.size").runInContext(host.browser), 0);
});

test("standard tool timeout cleans pending state and never retries via the compatibility alias", async () => {
  const host = harness();
  await new Script("hostBridgeReady").runInContext(host.browser);
  const request = new Script("callHostTool('workbench_api_poll', {})").runInContext(host.browser);
  for (let i = 0; i < 5; i++) await Promise.resolve();
  const rejected = assert.rejects(request, /host_rpc_timeout/);
  host.timers.find(timer => !timer.cleared)!.callback();
  await rejected;
  assert.equal(new Script("rpcWaiters.size").runInContext(host.browser), 0);
  assert.equal(host.aliasCalls, 0);
  const late = host.sent.at(-1)!;
  host.reply({ jsonrpc: "2.0", id: late.id, result: {} });
  assert.equal(host.aliasCalls, 0);
});

test("only a failed initialization may select alias fallback; raw host errors never propagate", async () => {
  const host = harness(false);
  const init = host.sent[0];
  host.reply({ jsonrpc: "2.0", id: init.id, error: { message: "PRIVATE_EXCEPTION" } });
  await new Script("hostBridgeReady").runInContext(host.browser);
  assert.equal((await new Script("callHostTool('workbench_api_poll', {})").runInContext(host.browser)).structuredContent.alias, true);
  assert.equal(host.aliasCalls, 1);
  assert.equal(host.sent.length, 1);
  const standard = harness();
  await new Script("hostBridgeReady").runInContext(standard.browser);
  const request = new Script("callHostTool('workbench_api_poll', {})").runInContext(standard.browser);
  for (let i = 0; i < 5; i++) await Promise.resolve();
  const rejected = assert.rejects(request, (error: Error) => error.message === "host_rpc_rejected");
  standard.reply({ jsonrpc: "2.0", id: standard.sent.at(-1)!.id, error: { message: "PRIVATE_EXCEPTION" } });
  await rejected;
  assert.equal(standard.aliasCalls, 0);
});

test("hung initialization and bounded waiter capacity do not retain unbounded RPC state", async () => {
  const host = harness(false);
  host.timers[0].callback();
  await new Script("hostBridgeReady").runInContext(host.browser);
  assert.equal(new Script("rpcWaiters.size").runInContext(host.browser), 0);
  const requests: Promise<unknown>[] = [];
  for (let i = 0; i < 32; i++) requests.push(new Script("hostRpc('tools/call', {})").runInContext(host.browser).catch(() => {}));
  await assert.rejects(new Script("hostRpc('tools/call', {})").runInContext(host.browser), /capacity/);
  assert.equal(new Script("rpcWaiters.size").runInContext(host.browser), 32);
  for (const timer of host.timers.slice(1)) timer.callback();
  await Promise.all(requests);
  assert.equal(new Script("rpcWaiters.size").runInContext(host.browser), 0);
});
