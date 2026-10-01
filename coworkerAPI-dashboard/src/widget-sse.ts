import type { ServerResponse } from "node:http";
import type { BridgeEvent } from "./protocol.js";
import { writeSse } from "./sse.js";

type Outcome = { response?: Record<string, unknown>; error?: { code: string; message: string } };

export async function collectWidgetResponse(events: AsyncIterable<BridgeEvent>): Promise<Outcome> {
  let response: Record<string, unknown> | undefined;
  let error: Outcome["error"];
  for await (const event of events) {
    if (event.type === "response.completed") response = event.response;
    if (event.type === "response.failed") error = event.error;
  }
  return { response, error: error ?? (!response ? { code: "upstream_error", message: "Bridge ended without a response" } : undefined) };
}

function outputItems(response: Record<string, unknown>): Record<string, unknown>[] {
  return Array.isArray(response.output) ? response.output.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object") : [];
}

function toolItems(response: Record<string, unknown>): Record<string, unknown>[] {
  return outputItems(response).filter((item) => item.type === "function_call");
}

function textOf(response: Record<string, unknown>): string {
  return typeof response.output_text === "string" ? response.output_text : "";
}

export function writeWidgetResponsesStream(raw: ServerResponse, outcome: Outcome, model: string): void {
  if (outcome.error || !outcome.response) {
    writeSse(raw, "error", { type: "error", error: { type: outcome.error?.code ?? "upstream_error", message: outcome.error?.message ?? "Missing response" } });
    return;
  }
  const response = outcome.response;
  let sequence = 0;
  const emit = (type: string, data: Record<string, unknown>) => writeSse(raw, type, { type, sequence_number: sequence++, ...data });
  emit("response.created", { response: { id: response.id, object: "response", created_at: Math.floor(Date.now() / 1000), status: "in_progress", model, output: [] } });
  outputItems(response).forEach((item, outputIndex) => {
    if (item.type === "function_call") {
      const argumentsText = String(item.arguments ?? "{}");
      emit("response.output_item.added", { output_index: outputIndex, item: { ...item, arguments: "", status: "in_progress" } });
      emit("response.function_call_arguments.delta", { item_id: item.id, output_index: outputIndex, delta: argumentsText });
      emit("response.function_call_arguments.done", { item_id: item.id, output_index: outputIndex, arguments: argumentsText });
      emit("response.output_item.done", { output_index: outputIndex, item });
    } else if (item.type === "message") {
      const text = textOf(response);
      const part = { type: "output_text", text: "", annotations: [] };
      emit("response.output_item.added", { output_index: outputIndex, item: { ...item, status: "in_progress", content: [] } });
      emit("response.content_part.added", { item_id: item.id, output_index: outputIndex, content_index: 0, part });
      if (text) emit("response.output_text.delta", { item_id: item.id, output_index: outputIndex, content_index: 0, delta: text });
      emit("response.output_text.done", { item_id: item.id, output_index: outputIndex, content_index: 0, text });
      emit("response.content_part.done", { item_id: item.id, output_index: outputIndex, content_index: 0, part: { ...part, text } });
      emit("response.output_item.done", { output_index: outputIndex, item });
    }
  });
  emit("response.completed", { response });
}

export function writeWidgetChatStream(raw: ServerResponse, outcome: Outcome, model: string): void {
  if (outcome.error || !outcome.response) {
    raw.write(`data: ${JSON.stringify({ error: { type: outcome.error?.code ?? "upstream_error", message: outcome.error?.message ?? "Missing response" } })}\n\n`);
    return;
  }
  const response = outcome.response;
  const id = typeof response.id === "string" ? response.id : "chatcmpl_widget";
  const chunk = (delta: Record<string, unknown>, finish_reason: string | null = null) => raw.write(`data: ${JSON.stringify({ id, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model, choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
  chunk({ role: "assistant", content: "" });
  if (textOf(response)) chunk({ content: textOf(response) });
  const calls = toolItems(response);
  calls.forEach((call, index) => chunk({ tool_calls: [{ index, id: call.call_id, type: "function", function: { name: call.name, arguments: String(call.arguments ?? "{}") } }] }));
  chunk({}, calls.length ? "tool_calls" : "stop");
  raw.write("data: [DONE]\n\n");
}

export function writeWidgetAnthropicStream(raw: ServerResponse, outcome: Outcome, model: string): void {
  if (outcome.error || !outcome.response) {
    writeSse(raw, "error", { type: "error", error: { type: outcome.error?.code ?? "upstream_error", message: outcome.error?.message ?? "Missing response" } });
    return;
  }
  const response = outcome.response;
  const calls = toolItems(response);
  const text = textOf(response);
  writeSse(raw, "message_start", { type: "message_start", message: { id: response.id, type: "message", role: "assistant", model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } } });
  let index = 0;
  if (text || !calls.length) {
    writeSse(raw, "content_block_start", { type: "content_block_start", index, content_block: { type: "text", text: "" } });
    if (text) writeSse(raw, "content_block_delta", { type: "content_block_delta", index, delta: { type: "text_delta", text } });
    writeSse(raw, "content_block_stop", { type: "content_block_stop", index });
    index++;
  }
  for (const call of calls) {
    writeSse(raw, "content_block_start", { type: "content_block_start", index, content_block: { type: "tool_use", id: call.call_id, name: call.name, input: {} } });
    writeSse(raw, "content_block_delta", { type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json: String(call.arguments ?? "{}") } });
    writeSse(raw, "content_block_stop", { type: "content_block_stop", index });
    index++;
  }
  writeSse(raw, "message_delta", { type: "message_delta", delta: { stop_reason: calls.length ? "tool_use" : "end_turn", stop_sequence: null }, usage: { output_tokens: 0 } });
  writeSse(raw, "message_stop", { type: "message_stop" });
}
