import assert from "node:assert/strict";
import test from "node:test";
import { Script } from "node:vm";
import { randomUUID } from "node:crypto";
import { WIDGET_CHAT_POLICY, widgetSubmitNotice } from "../src/widget-chat-policy.js";
import { WidgetBridge } from "../src/widget-bridge.js";
import { WIDGET_HTML } from "../src/widget-mcp.js";
import type { BridgeEvent } from "../src/protocol.js";

test("transport acknowledgements distinguish final text, tools, repair, and terminal failures", () => {
  assert.match(WIDGET_CHAT_POLICY, /must not shorten, replace, or reduce the quality/);
  assert.match(WIDGET_CHAT_POLICY, /complete answer or client-owned tool_calls ONLY through workbench_api_submit/);
  assert.match(WIDGET_CHAT_POLICY, /After an accepted tool_calls callback, remain silent/);
  assert.match(WIDGET_CHAT_POLICY, /exactly Thành công/);
  assert.match(WIDGET_CHAT_POLICY, /exactly Thất bại/);
  assert.equal(widgetSubmitNotice("accepted", false), "Thành công. The only permitted chat reply is exactly Thành công.");
  assert.match(widgetSubmitNotice("accepted", true), /Remain silent in chat/);
  assert.doesNotMatch(widgetSubmitNotice("accepted", true), /Thành công/);
  for (const status of ["cancelled", "unknown_request"] as const) {
    assert.match(widgetSubmitNotice(status, false), /only permitted chat reply is exactly Thất bại/);
    assert.match(widgetSubmitNotice(status, true), /[Dd]o not retry/);
  }
  const repair = widgetSubmitNotice("invalid_result", true);
  assert.match(repair, /still pending/);
  assert.match(repair, /Re-read workbench_api_read_request/);
  assert.match(repair, /argument JSON schemas and maximum call count/);
  assert.match(repair, /same request_id/);
  assert.match(repair, /Repair silently/);
});

test("full, large, and restored claim prompts preserve the complete request and quiet policy", async () => {
  const previous = process.env.COWORKER_WIDGET_INLINE_LIMIT;
  try {
    for (const large of [false, true]) {
      process.env.COWORKER_WIDGET_INLINE_LIMIT = large ? "4096" : "32768";
      const bridge = new WidgetBridge();
      const controller = new AbortController();
      const input = large ? "source-content-".repeat(1_000) : "Read the complete client source without summarizing away its requirements.";
      const events: BridgeEvent[] = [];
      const response = (async () => { for await (const event of bridge.respond({ model: "chatgpt-web", input, stream: false }, controller.signal)) events.push(event); })();
      try {
        for (let i = 0; !bridge.pendingCount && i < 100; i++) await new Promise(resolve => setTimeout(resolve, 5));
        const owner = randomUUID();
        const turn = bridge.claim("bridge-v8", owner);
        assert.ok(turn);
        assert.ok(turn.prompt.includes(WIDGET_CHAT_POLICY));
        const full = bridge.readRequest(turn.request_id);
        assert.ok(full);
        assert.ok(full.includes(WIDGET_CHAT_POLICY));
        assert.ok(full.includes(input), "Request content must not be trimmed by transport policy");
        if (large) {
          assert.match(turn.prompt, /FIRST call the MCP tool workbench_api_read_request/);
          assert.ok(!turn.prompt.includes(input));
          assert.ok(turn.prompt.length < full.length);
        } else assert.ok(turn.prompt.includes(input));
        const restored = bridge.claim("bridge-v8", owner);
        assert.ok(restored);
        assert.ok(restored.prompt.includes(WIDGET_CHAT_POLICY));
        assert.match(restored.prompt, /FIRST call workbench_api_read_request/);
        assert.equal(restored.claim_lease_id, turn.claim_lease_id);
        bridge.leasedStatus(turn.request_id, owner, turn.claim_lease_id!, "send_started");
        assert.equal(await bridge.submit(turn.request_id, { text: input }), "accepted");
        await response;
        const completed = events.find(event => event.type === "response.completed");
        assert.ok(completed?.type === "response.completed");
        assert.equal(completed.response.output_text, input);
      } finally { controller.abort(); await response; bridge.shutdown(); }
    }
  } finally {
    if (previous === undefined) delete process.env.COWORKER_WIDGET_INLINE_LIMIT;
    else process.env.COWORKER_WIDGET_INLINE_LIMIT = previous;
  }
});

test("generated widget JavaScript parses and carries quiet policy in dispatch fallback and reminder", () => {
  const script = WIDGET_HTML.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script);
  assert.doesNotThrow(() => new Script(script));
  assert.ok(script.includes(`const chatPolicy = ${JSON.stringify(WIDGET_CHAT_POLICY)}`));
  assert.match(script, /activePrompt \|\| 'CoworkerAPI request_id='/);
  assert.match(script, /basePrompt\.includes\(chatPolicy\) \? basePrompt : basePrompt \+ ' ' \+ chatPolicy/);
  assert.match(script, /Bridge reminder:[^\n]+\+ chatPolicy/);
  assert.match(script, /scrollToBottom:false/);
});
