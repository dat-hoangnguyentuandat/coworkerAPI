import assert from "node:assert/strict";
import test from "node:test";
import type { ServerResponse } from "node:http";
import { writeWidgetAnthropicStream, writeWidgetChatStream, writeWidgetResponsesStream } from "../src/widget-sse.js";

function capture(write: (raw: ServerResponse) => void): string {
  const chunks: string[] = [];
  write({ write(chunk: string) { chunks.push(chunk); return true; } } as unknown as ServerResponse);
  return chunks.join("");
}

const textResponse = { id: "resp_text", model: "chatgpt-web", output_text: "OK", output: [{ id: "msg_text", type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: "OK", annotations: [] }] }] };
const toolResponse = { id: "resp_tool", model: "chatgpt-web", output_text: "", output: [{ id: "fc_test", type: "function_call", status: "completed", call_id: "call_test", name: "get_weather", arguments: '{"city":"Paris"}' }] };

test("widget Responses SSE includes lifecycle and function-call events", () => {
  const textStream = capture((raw) => writeWidgetResponsesStream(raw, { response: textResponse }, "chatgpt-web"));
  assert.match(textStream, /event: response\.created/);
  assert.match(textStream, /event: response\.output_text\.delta/);
  assert.match(textStream, /event: response\.completed/);
  const toolStream = capture((raw) => writeWidgetResponsesStream(raw, { response: toolResponse }, "chatgpt-web"));
  assert.match(toolStream, /event: response\.function_call_arguments\.delta/);
  assert.match(toolStream, /event: response\.output_item\.done/);
});

test("widget Chat Completions SSE signals tool_calls and terminates", () => {
  const stream = capture((raw) => writeWidgetChatStream(raw, { response: toolResponse }, "chatgpt-web"));
  assert.match(stream, /"finish_reason":"tool_calls"/);
  assert.match(stream, /"name":"get_weather"/);
  assert.match(stream, /data: \[DONE\]/);
});

test("widget Anthropic SSE uses tool_use block and stop reason", () => {
  const stream = capture((raw) => writeWidgetAnthropicStream(raw, { response: toolResponse }, "chatgpt-web"));
  assert.match(stream, /event: message_start/);
  assert.match(stream, /"type":"input_json_delta"/);
  assert.match(stream, /"stop_reason":"tool_use"/);
  assert.match(stream, /event: message_stop/);
});
