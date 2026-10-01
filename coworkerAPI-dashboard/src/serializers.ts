import type { ServerResponse } from "node:http";
import type { BridgeEvent } from "./protocol.js";
import { writeSse } from "./sse.js";

export function writeOpenAIEvent(response: ServerResponse, event: BridgeEvent): void {
  const native = event.native ?? (event.type === "response.native_event" ? event.event : undefined);
  if (native && typeof native.type === "string") {
    if (!/^response\.[a-z0-9_.]+$/.test(native.type)) {
      writeSse(response, "error", { type: "error", error: { type: "upstream_invalid_event", message: "Invalid native event type." } });
      return;
    }
    writeSse(response, native.type, native);
    return;
  }
  if (event.type === "response.tool_call") {
    writeSse(response, "response.output_item.added", { type: "response.output_item.added", item: event.call });
    return;
  }
  writeSse(response, event.type, { ...event });
}

export function writeChatCompletionEvent(response: ServerResponse, event: BridgeEvent, model: string): void {
  if (event.nativeChat !== undefined) {
    if (event.nativeChat === "[DONE]") response.write("data: [DONE]\n\n");
    else if (event.nativeChat !== null) writeChatData(response, { ...event.nativeChat, model });
    return;
  }
  const id = typeof event.type === "string" ? `chatcmpl_${model}` : `chatcmpl_${model}`;
  if (event.type === "response.output_text.delta") {
    writeChatData(response, { id, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model, choices: [{ index: 0, delta: { content: event.delta }, finish_reason: null }] });
  } else if (event.type === "response.tool_call") {
    const fn = typeof event.call.function === "object" && event.call.function !== null ? event.call.function as Record<string, unknown> : event.call;
    writeChatData(response, { id, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model, choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: String(event.call.id ?? event.call.call_id ?? "tool_call"), type: "function", function: { name: String(event.call.name ?? fn.name ?? "tool"), arguments: typeof fn.arguments === "string" ? fn.arguments : JSON.stringify(event.call.input ?? fn.arguments ?? {}) } }] }, finish_reason: null }] });
  } else if (event.type === "response.completed") {
    writeChatData(response, { id, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] });
    writeChatData(response, "[DONE]");
  } else if (event.type === "response.failed") {
    writeChatData(response, { error: { type: event.error.code, message: event.error.message } });
  }
}

function writeChatData(response: ServerResponse, data: unknown): void {
  response.write(`data: ${JSON.stringify(data)}\n\n`);
}

export function writeAnthropicEvent(response: ServerResponse, event: BridgeEvent, model: string): void {
  if (event.nativeAnthropic !== undefined) {
    const native = event.nativeAnthropic;
    if (native === null) return;
    if (typeof native.type !== "string" || !/^[a-z][a-z0-9_]*$/.test(native.type)) {
      writeSse(response, "error", { type: "error", error: { type: "upstream_invalid_event", message: "Invalid native event type." } });
      return;
    }
    const message = native.message;
    writeSse(response, native.type, native.type === "message_start" && message && typeof message === "object" && !Array.isArray(message) ? { ...native, message: { ...message, model } } : native);
    return;
  }
  if (event.type === "response.output_text.delta") {
    writeSse(response, "content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: event.delta } });
    return;
  }
  if (event.type === "response.completed") {
    const usage = event.response.usage ?? { input_tokens: 0, output_tokens: 0 };
    writeSse(response, "message_delta", { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage });
    return;
  }
  if (event.type === "response.failed") {
    writeSse(response, "error", { type: "error", error: { type: event.error.code, message: event.error.message } });
    return;
  }
  if (event.type === "response.created") {
    // writeAnthropicStart already emitted message_start. The created event is
    // retained for OpenAI consumers but must not duplicate Anthropic framing.
    return;
  }
  if (event.type === "response.tool_call") {
    const call = event.call;
    const fn = typeof call.function === "object" && call.function !== null ? call.function as Record<string, unknown> : undefined;
    writeSse(response, "content_block_start", {
      type: "content_block_start", index: 0,
      content_block: { type: "tool_use", id: String(call.id ?? "tool_call"), name: String(call.name ?? fn?.name ?? "tool"), input: call.input ?? fn?.arguments ?? {} },
    });
  }
}

export function writeAnthropicStart(response: ServerResponse, model: string): void {
  writeSse(response, "message_start", { type: "message_start", message: { id: "msg_pending", type: "message", role: "assistant", model, content: [], usage: { input_tokens: 0, output_tokens: 0 } } });
  writeSse(response, "content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } });
}

export function writeAnthropicStop(response: ServerResponse): void {
  writeSse(response, "content_block_stop", { type: "content_block_stop", index: 0 });
  writeSse(response, "message_stop", { type: "message_stop" });
}
