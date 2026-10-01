import type { ProviderRecord } from "./local-store.js";
import type { BridgeEvent, ChatGPTBridge, ResponseRequest } from "./protocol.js";
import { providerResponseBytes, ProviderTransportError } from "./provider-transport.js";
import { providerSseEvents } from "./provider-sse.js";

const record = (value: unknown): value is Record<string, any> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
function invalid(code = "upstream_invalid_event"): never { throw new ProviderTransportError(code, "Provider returned an invalid or incomplete Messages response."); }
function parse(text: string): Record<string, any> {
  try { const value: unknown = JSON.parse(text); if (record(value)) return value; } catch {}
  return invalid("upstream_invalid_json");
}
function normalize(message: Record<string, any>): Record<string, unknown> {
  if (typeof message.id !== "string" || !message.id || message.type !== "message" || message.role !== "assistant" || !Array.isArray(message.content) || typeof message.stop_reason !== "string" || !message.stop_reason) invalid("upstream_incomplete");
  const output: Record<string, unknown>[] = [];
  let text = "";
  for (const block of message.content) {
    if (!record(block) || typeof block.type !== "string") invalid();
    if (block.type === "text") { if (typeof block.text !== "string") invalid(); text += block.text; }
    if (block.type === "tool_use") {
      if (typeof block.id !== "string" || !block.id || typeof block.name !== "string" || !block.name || !record(block.input)) invalid("upstream_invalid_tool");
      output.push({ type: "function_call", id: block.id, call_id: block.id, name: block.name, arguments: JSON.stringify(block.input), status: "completed" });
    }
  }
  return { id: message.id, model: message.model, status: "completed", output_text: text, output, usage: message.usage, native_anthropic_message: message };
}

/** Same-protocol Messages adapter: preserve native payloads and event lifecycle. */
export class AnthropicProviderBridge implements ChatGPTBridge {
  constructor(private readonly provider: ProviderRecord, private readonly apiKey: string, private readonly original: Record<string, unknown>) {}
  async *respond(request: ResponseRequest, signal: AbortSignal): AsyncGenerator<BridgeEvent> {
    try {
      if (!this.provider.enabled || this.provider.type !== "anthropic") invalid("provider_unavailable");
      const bytes = providerResponseBytes(this.provider, this.apiKey, "messages", { ...this.original, model: request.model, stream: request.stream }, signal);
      if (!request.stream) {
        const chunks: Buffer[] = []; for await (const chunk of bytes) chunks.push(chunk);
        yield { type: "response.completed", response: normalize(parse(Buffer.concat(chunks).toString("utf8"))) };
        return;
      }
      let message: Record<string, any> | undefined;
      let endedBlocks = false;
      const blocks = new Map<number, { value: Record<string, any>; open: boolean; json: string }>();
      for await (const frame of providerSseEvents(bytes)) {
        const event = parse(frame.data);
        if (event.type === "error") throw new ProviderTransportError("upstream_response_failed", "Provider Messages request failed.");
        if (typeof event.type !== "string" || !/^[a-z][a-z0-9_]*$/.test(event.type) || (frame.event && frame.event !== event.type)) invalid();
        if (event.type === "message_start") {
          if (message || !record(event.message) || typeof event.message.id !== "string" || !event.message.id || event.message.type !== "message" || event.message.role !== "assistant" || !Array.isArray(event.message.content) || event.message.content.length) invalid();
          message = { ...event.message, content: [] };
        } else if (event.type.startsWith("content_block_")) {
          if (!message || endedBlocks || !Number.isSafeInteger(event.index) || event.index < 0 || event.index > 4095) invalid();
          const state = blocks.get(event.index);
          if (event.type === "content_block_start") {
            if (state || !record(event.content_block) || typeof event.content_block.type !== "string" || event.index !== blocks.size) invalid();
            blocks.set(event.index, { value: { ...event.content_block }, open: true, json: "" });
          } else if (event.type === "content_block_delta") {
            if (!state?.open || !record(event.delta)) invalid();
            const delta = event.delta;
            const fields: Record<string, string> = { text_delta: "text", thinking_delta: "thinking", signature_delta: "signature" };
            if (fields[delta.type]) {
              const field = fields[delta.type];
              if (typeof delta[field] !== "string" || state.value.type !== (field === "text" ? "text" : "thinking")) invalid();
              state.value[field] = (state.value[field] ?? "") + delta[field];
            } else if (delta.type === "input_json_delta") {
              if (!["tool_use", "server_tool_use"].includes(state.value.type) || typeof delta.partial_json !== "string") invalid();
              state.json += delta.partial_json;
            } else if (delta.type === "citations_delta") {
              if (!record(delta.citation)) invalid();
              state.value.citations = [...(state.value.citations ?? []), delta.citation];
            }
          } else if (event.type === "content_block_stop") {
            if (!state?.open) invalid();
            if (state.json) state.value.input = parse(state.json);
            state.open = false;
          }
        } else if (event.type === "message_delta") {
          if (!message || [...blocks.values()].some(block => block.open) || !record(event.delta)) invalid();
          endedBlocks = true;
          Object.assign(message, event.delta);
          if (event.usage !== undefined) { if (!record(event.usage)) invalid(); message.usage = { ...message.usage, ...event.usage }; }
        } else if (event.type === "message_stop") {
          if (!message || !endedBlocks || [...blocks.values()].some(block => block.open)) invalid("upstream_incomplete");
          message.content = [...blocks.values()].map(block => block.value);
          const response = normalize(message);
          for (const call of response.output as Record<string, unknown>[]) yield { type: "response.tool_call", call, nativeAnthropic: null };
          yield { type: "response.completed", response, nativeAnthropic: event };
          return;
        }
        if (event.type === "content_block_delta" && event.delta?.type === "text_delta") yield { type: "response.output_text.delta", delta: event.delta.text, nativeAnthropic: event };
        else yield { type: "response.native_event", event, nativeAnthropic: event };
      }
      invalid("upstream_incomplete");
    } catch (error) {
      yield { type: "response.failed", error: { code: error instanceof ProviderTransportError ? error.code : "upstream_error", message: error instanceof ProviderTransportError ? error.message : "Provider Messages request failed." } };
    }
  }
}
