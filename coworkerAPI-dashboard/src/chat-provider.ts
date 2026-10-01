import type { ProviderRecord } from "./local-store.js";
import type { BridgeEvent, ChatGPTBridge, ResponseRequest } from "./protocol.js";
import { providerResponseBytes, ProviderTransportError } from "./provider-transport.js";
import { providerSseEvents } from "./provider-sse.js";

const record = (value: unknown): value is Record<string, any> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
function parse(text: string): Record<string, any> {
  try { const value: unknown = JSON.parse(text); if (record(value)) return value; } catch {}
  throw new ProviderTransportError("upstream_invalid_json", "Provider returned invalid JSON.");
}
function normalize(completion: Record<string, any>): Record<string, unknown> {
  const first = completion.choices?.find((choice: any) => choice?.index === 0);
  if (typeof completion.id !== "string" || !record(first?.message) || !["stop", "length", "tool_calls", "content_filter", "function_call"].includes(first.finish_reason)) throw new ProviderTransportError("upstream_incomplete", "Provider did not return a finished chat completion.");
  const message = first.message;
  const text = typeof message.content === "string" ? message.content : "";
  const output = Array.isArray(message.tool_calls) ? message.tool_calls.map((call: any) => {
    if (!record(call) || typeof call.id !== "string" || !call.id || !record(call.function) || typeof call.function.name !== "string" || !call.function.name || typeof call.function.arguments !== "string") throw new ProviderTransportError("upstream_invalid_tool", "Provider returned an invalid tool call.");
    return { type: "function_call", id: call.id, call_id: call.id, name: call.function.name, arguments: call.function.arguments, status: "completed" };
  }) : [];
  return { id: completion.id, model: completion.model, status: "completed", output_text: text, output, usage: completion.usage, native_chat_completion: completion };
}

export class ChatProviderBridge implements ChatGPTBridge {
  constructor(private readonly provider: ProviderRecord, private readonly apiKey: string, private readonly original: Record<string, unknown>) {}
  async *respond(request: ResponseRequest, signal: AbortSignal): AsyncGenerator<BridgeEvent> {
    try {
      if (!this.provider.enabled || !["openai", "openai-compatible"].includes(this.provider.type) || this.provider.wireApi !== "chat-completions") throw new ProviderTransportError("provider_unavailable", "Provider does not support the Chat Completions adapter.");
      const body = { ...this.original, model: request.model, stream: request.stream };
      const bytes = providerResponseBytes(this.provider, this.apiKey, "chat/completions", body, signal);
      if (!request.stream) {
        const buffers: Buffer[] = []; for await (const chunk of bytes) buffers.push(chunk);
        const response = normalize(parse(Buffer.concat(buffers).toString("utf8")));
        yield { type: "response.completed", response };
        return;
      }
      let id: string | undefined;
      let text = "";
      let finish: string | undefined;
      let usage: unknown;
      const tools = new Map<number, { id: string; name: string; arguments: string }>();
      for await (const frame of providerSseEvents(bytes)) {
        if (frame.data === "[DONE]") {
          if (!id || !finish) throw new ProviderTransportError("upstream_incomplete", "Provider chat stream ended before a finish reason.");
          const completion = { id, object: "chat.completion", model: request.model, choices: [{ index: 0, message: { role: "assistant", content: text || null, ...(tools.size ? { tool_calls: [...tools.entries()].sort(([a], [b]) => a - b).map(([, call]) => ({ id: call.id, type: "function", function: { name: call.name, arguments: call.arguments } })) } : {}) }, finish_reason: finish }], usage };
          const response = normalize(completion);
          for (const call of response.output as Record<string, unknown>[]) yield { type: "response.tool_call", call, nativeChat: null };
          yield { type: "response.completed", response, nativeChat: "[DONE]" };
          return;
        }
        const chunk = parse(frame.data);
        if (chunk.error) throw new ProviderTransportError("upstream_response_failed", "Provider chat request failed.");
        if (typeof chunk.id !== "string" || !Array.isArray(chunk.choices)) throw new ProviderTransportError("upstream_invalid_event", "Provider returned an invalid chat chunk.");
        if (id && chunk.id !== id) throw new ProviderTransportError("upstream_invalid_event", "Provider changed the chat stream ID.");
        id = chunk.id;
        if (chunk.usage) usage = chunk.usage;
        const choice = chunk.choices.find((item: any) => item?.index === 0);
        if (choice) {
          if (!record(choice.delta)) throw new ProviderTransportError("upstream_invalid_event", "Provider chat chunk has no delta.");
          if (typeof choice.delta.content === "string") text += choice.delta.content;
          if (Array.isArray(choice.delta.tool_calls)) for (const part of choice.delta.tool_calls) {
            if (!record(part) || !Number.isSafeInteger(part.index) || part.index < 0 || part.index > 127) throw new ProviderTransportError("upstream_invalid_tool", "Provider tool delta has an invalid index.");
            const call = tools.get(part.index) ?? { id: "", name: "", arguments: "" };
            if (typeof part.id === "string") {
              if (call.id && call.id !== part.id) throw new ProviderTransportError("upstream_invalid_tool", "Provider changed a tool call ID.");
              call.id = part.id;
            }
            if (record(part.function)) {
              if (typeof part.function.name === "string") call.name += part.function.name;
              if (typeof part.function.arguments === "string") call.arguments += part.function.arguments;
            }
            tools.set(part.index, call);
          }
          if (typeof choice.finish_reason === "string") finish = choice.finish_reason;
        }
        if (typeof choice?.delta?.content === "string") yield { type: "response.output_text.delta", delta: choice.delta.content, nativeChat: chunk };
        else yield { type: "response.native_event", event: chunk, nativeChat: chunk };
      }
      throw new ProviderTransportError("upstream_incomplete", "Provider chat stream ended without [DONE].");
    } catch (error) {
      yield { type: "response.failed", error: { code: error instanceof ProviderTransportError ? error.code : "upstream_error", message: error instanceof ProviderTransportError ? error.message : "Provider chat request failed." } };
    }
  }
}
