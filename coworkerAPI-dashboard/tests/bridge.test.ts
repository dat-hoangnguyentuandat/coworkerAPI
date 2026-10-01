import assert from "node:assert/strict";
import test from "node:test";
import { CoworkerBridge } from "../src/bridge.js";
import { buildServer } from "../src/app.js";
import WebSocket from "ws";

test("routes a turn through the connected Coworker bridge", async () => {
  const sent: string[] = [];
  const handlers = new Map<string, (...args: any[]) => void>();
  const socket = {
    readyState: 1,
    send: (value: string) => sent.push(value),
    close: () => undefined,
    on: (event: string, handler: (...args: any[]) => void) => handlers.set(event, handler),
  } as any;
  const bridge = new CoworkerBridge();
  bridge.attach(socket);
  handlers.get("message")?.(Buffer.from(JSON.stringify({ type: "bridge.ready", bridgeId: "test", profileIds: ["profile-1"] })));
  const stream = bridge.respond({ model: "chatgpt-web", input: "hello", stream: true }, new AbortController().signal, { profileId: "profile-1" });
  const start = JSON.parse(sent[0]);
  assert.equal(start.type, "turn.start");
  assert.equal(start.context.profileId, "profile-1");
  handlers.get("message")?.(Buffer.from(JSON.stringify({
    type: "turn.event", requestId: start.requestId,
    event: { type: "response.completed", response: { id: "resp_1" } },
  })));
  const events = [];
  for await (const event of stream) events.push(event);
  assert.deepEqual(events, [{ type: "response.completed", response: { id: "resp_1" } }]);
});

test("reports bridge connection status without secrets", async () => {
  process.env.COWORKER_API_KEYS = "client-key";
  const bridge = new CoworkerBridge();
  const app = buildServer(bridge, "bridge-key");
  const response = await app.inject({ method: "GET", url: "/health/inference" });
  assert.equal(response.statusCode, 503);
  assert.equal(response.json().status, "bridge_not_connected");
  assert.deepEqual(response.json().bridge.bridges, []);
  await app.close();
});

test("serves a connected bridge over the internal WebSocket route", async () => {
  process.env.COWORKER_API_KEYS = "client-key";
  const bridge = new CoworkerBridge();
  const app = buildServer(bridge, "bridge-key");
  await app.listen({ host: "127.0.0.1", port: 0 });
  const address = app.server.address() as { port: number };
  const socket = new WebSocket(`ws://127.0.0.1:${address.port}/internal/bridge`, { headers: { authorization: "Bearer bridge-key" } });
  const responsePromise = new Promise<Response>((resolve, reject) => {
    socket.once("open", async () => {
      try {
        resolve(await fetch(`http://127.0.0.1:${address.port}/v1/responses`, {
          method: "POST", headers: { authorization: "Bearer client-key", "content-type": "application/json" },
          body: JSON.stringify({ model: "chatgpt-web", input: "hello" }),
        }));
      } catch (error) { reject(error); }
    });
    socket.on("message", (raw) => {
      const message = JSON.parse(raw.toString());
      if (message.type === "turn.start") socket.send(JSON.stringify({ type: "turn.event", requestId: message.requestId, event: { type: "response.completed", response: { id: "resp_ws" } } }));
    });
    socket.once("error", reject);
  });
  const response = await responsePromise;
  assert.equal(response.status, 200);
  assert.equal((await response.json()).id, "resp_ws");
  socket.close();
  await app.close();
});

test("routes profile-scoped turns to the matching bridge agent", async () => {
  const makeSocket = () => {
    const handlers = new Map<string, (...args: any[]) => void>();
    return { readyState: 1, send: (value: string) => sent.push(JSON.parse(value)), close: () => undefined, on: (event: string, handler: (...args: any[]) => void) => handlers.set(event, handler), handlers } as any;
  };
  const sent: any[] = [];
  const first = makeSocket();
  const second = makeSocket();
  const bridge = new CoworkerBridge();
  bridge.attach(first);
  bridge.attach(second);
  first.handlers.get("message")?.(Buffer.from(JSON.stringify({ type: "bridge.ready", bridgeId: "one", profileIds: ["profile-one"] })));
  second.handlers.get("message")?.(Buffer.from(JSON.stringify({ type: "bridge.ready", bridgeId: "two", profileIds: ["profile-two"] })));
  const stream = bridge.respond({ model: "chatgpt-web", input: "hello", stream: false }, new AbortController().signal, { profileId: "profile-two" });
  const start = sent.at(-1);
  assert.equal(start.type, "turn.start");
  second.handlers.get("message")?.(Buffer.from(JSON.stringify({ type: "turn.event", requestId: start.requestId, event: { type: "response.completed", response: { id: "profile-two-response" } } })));
  const events = [];
  for await (const event of stream) events.push(event);
  assert.equal((events[0] as any).response.id, "profile-two-response");
  assert.equal(sent.filter(item => item.type === "turn.start").length, 1);
});

test("one bridge disconnect does not fail another bridge's turn", async () => {
  const makeSocket = () => {
    const handlers = new Map<string, (...args: any[]) => void>();
    const sent: any[] = [];
    return { readyState: 1, send: (value: string) => sent.push(JSON.parse(value)), close: () => undefined, on: (event: string, handler: (...args: any[]) => void) => handlers.set(event, handler), handlers, sent } as any;
  };
  const first = makeSocket();
  const second = makeSocket();
  const bridge = new CoworkerBridge();
  bridge.attach(first);
  bridge.attach(second);
  first.handlers.get("message")?.(Buffer.from(JSON.stringify({ type: "bridge.ready", bridgeId: "first", profileIds: ["one"] })));
  second.handlers.get("message")?.(Buffer.from(JSON.stringify({ type: "bridge.ready", bridgeId: "second", profileIds: ["two"] })));
  const stream = bridge.respond({ model: "chatgpt-web", input: "hi", stream: false }, new AbortController().signal, { profileId: "two" });
  const requestId = second.sent[0].requestId;
  first.handlers.get("message")?.(Buffer.from(JSON.stringify({ type: "turn.event", requestId, event: { type: "response.completed", response: { id: "spoofed" } } })));
  first.handlers.get("close")?.();
  second.handlers.get("message")?.(Buffer.from(JSON.stringify({ type: "turn.event", requestId, event: { type: "response.completed", response: { id: "real" } } })));
  const events = [];
  for await (const event of stream) events.push(event);
  assert.equal((events[0] as any).response.id, "real");
});

test("unknown profile fails closed", async () => {
  const bridge = new CoworkerBridge();
  const sent: string[] = [];
  const handlers = new Map<string, (...args: any[]) => void>();
  const socket = { readyState: 1, send: (value: string) => sent.push(value), close: () => undefined, on: (event: string, handler: (...args: any[]) => void) => handlers.set(event, handler) } as any;
  bridge.attach(socket);
  handlers.get("message")?.(Buffer.from(JSON.stringify({ type: "bridge.ready", bridgeId: "one", profileIds: ["one"] })));
  const events = [];
  for await (const event of bridge.respond({ model: "chatgpt-web", input: "hi", stream: false }, new AbortController().signal, { profileId: "other" })) events.push(event);
  assert.equal((events[0] as any).error.code, "profile_unavailable");
  assert.equal(sent.length, 0);
});
