import test from "node:test";
import assert from "node:assert/strict";
import { buildServer } from "../src/app.js";
import type { ChatGPTBridge } from "../src/protocol.js";

test("all protocols reject incomplete/thrown turns and suppress output after terminal events", async () => {
  const previous = process.env.COWORKER_API_KEYS; process.env.COWORKER_API_KEYS = "terminal-fixture-key";
  const bridge: ChatGPTBridge = { async *respond(request) {
    yield { type: "response.output_text.delta", delta: "first" };
    const mode = typeof request.input === "string" ? request.input : (request.input as any[])[0].content;
    if (mode === "throw") throw new Error("secret-upstream-exception");
    if (mode === "incomplete") return;
    if (mode === "failure") yield { type: "response.failed", error: { code: "upstream_error", message: "Fixture failure." } };
    else yield { type: "response.completed", response: { id: "resp_fixture", output_text: "first", output: [] } };
    yield { type: "response.output_text.delta", delta: "INVALID-LATE-OUTPUT" };
    yield { type: "response.completed", response: { id: "resp_duplicate", output_text: "INVALID-LATE-OUTPUT" } };
  } };
  const app = buildServer(bridge);
  try {
    const headers = { authorization: "Bearer terminal-fixture-key" };
    for (const path of ["/v1/responses", "/v1/chat/completions", "/v1/messages"]) {
      for (const stream of [false, true]) for (const mode of ["incomplete", "throw", "failure", "complete"]) {
        const payload = path === "/v1/responses" ? { model: "fixture", input: mode, stream } : { model: "fixture", messages: [{ role: "user", content: mode }], max_tokens: 100, stream };
        const response = await app.inject({ method: "POST", url: path, headers, payload });
        assert.ok(!response.body.includes("secret-upstream-exception")); assert.ok(!response.body.includes("INVALID-LATE-OUTPUT"));
        if (!stream) assert.equal(response.statusCode, mode === "complete" ? 200 : 502);
        else if (mode !== "complete") {
          assert.ok(response.body.includes(mode === "incomplete" ? "upstream_incomplete" : "upstream_error"));
          assert.ok(!response.body.includes("event: message_stop")); assert.ok(!response.body.includes("event: response.completed")); assert.ok(!response.body.includes("[DONE]"));
        } else if (path === "/v1/messages") assert.equal((response.body.match(/event: message_stop/g) ?? []).length, 1);
      }
    }
  } finally { await app.close(); if (previous === undefined) delete process.env.COWORKER_API_KEYS; else process.env.COWORKER_API_KEYS = previous; }
});
