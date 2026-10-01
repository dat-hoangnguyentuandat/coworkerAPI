import type { ProviderRecord } from "./local-store.js";
import type { BridgeEvent, ChatGPTBridge, ResponseRequest } from "./protocol.js";
import { providerResponseBytes, ProviderTransportError } from "./provider-transport.js";
import { providerSseEvents } from "./provider-sse.js";

const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
function parseJson(text: string): Record<string, unknown> {
  try { const parsed: unknown = JSON.parse(text); if (record(parsed)) return parsed; } catch {}
  throw new ProviderTransportError("upstream_invalid_json", "Provider returned invalid JSON.");
}
function completed(value: unknown): Record<string, unknown> {
  if (!record(value) || typeof value.id !== "string" || !Array.isArray(value.output) || value.status !== "completed") {
    throw new ProviderTransportError("upstream_incomplete", "Provider did not return a completed response.");
  }
  const text = value.output.filter(record).filter((item) => item.type === "message").flatMap((item) => Array.isArray(item.content) ? item.content : []).filter(record).filter((item) => item.type === "output_text" && typeof item.text === "string").map((item) => item.text).join("");
  return { ...value, output_text: typeof value.output_text === "string" ? value.output_text : text };
}

/** Responses-native adapter. Raw semantic events are retained for same-protocol
 * clients; generic events allow explicit cross-protocol translation. */
export class ResponsesProviderBridge implements ChatGPTBridge {
  constructor(private readonly provider: ProviderRecord, private readonly apiKey: string) {}
  async *respond(request: ResponseRequest, signal: AbortSignal): AsyncGenerator<BridgeEvent> {
    try {
      if (!this.provider.enabled || !["openai", "openai-compatible"].includes(this.provider.type) || this.provider.wireApi === "chat-completions") throw new ProviderTransportError("provider_unavailable", "Provider does not support the Responses adapter.");
      // Native request fields, including reasoning/state/tool-result items,
      // remain intact. Only the routing layer changes the public model alias.
      const bytes = providerResponseBytes(this.provider, this.apiKey, "responses", { ...request }, signal);
      if (!request.stream) {
        const chunks: Buffer[] = [];
        for await (const chunk of bytes) chunks.push(chunk);
        const response = completed(parseJson(Buffer.concat(chunks).toString("utf8")));
        if (response.output_text) yield { type: "response.output_text.delta", delta: String(response.output_text) };
        for (const item of response.output as unknown[]) if (record(item) && item.type === "function_call") yield { type: "response.tool_call", call: item };
        yield { type: "response.completed", response };
        return;
      }
      const calls = new Set<string>();
      for await (const frame of providerSseEvents(bytes)) {
        if (frame.data === "[DONE]") break;
        const event = parseJson(frame.data);
        const type = event.type;
        if (typeof type !== "string") throw new ProviderTransportError("upstream_invalid_event", "Provider stream event has no type.");
        if (type === "error" || type === "response.failed" || type === "response.incomplete") {
          yield { type: "response.failed", error: { code: "upstream_response_failed", message: "Provider did not complete the response." } };
          return;
        }
        if (!/^response\.[a-z0-9_.]+$/.test(type)) throw new ProviderTransportError("upstream_invalid_event", "Provider stream contains an invalid event type.");
        if (type === "response.created" && record(event.response)) yield { type: "response.created", response: event.response, native: event };
        else if (type === "response.output_text.delta" && typeof event.delta === "string") yield { type: "response.output_text.delta", delta: event.delta, native: event };
        else if (type === "response.output_text.done" && typeof event.text === "string") yield { type: "response.output_text.done", text: event.text, native: event };
        else if (type === "response.output_item.done" && record(event.item) && event.item.type === "function_call") {
          if (typeof event.item.call_id !== "string") throw new ProviderTransportError("upstream_invalid_tool", "Provider tool call has no call ID.");
          calls.add(event.item.call_id);
          yield { type: "response.tool_call", call: event.item, native: event };
        } else if (type === "response.completed") {
          const response = completed(event.response);
          for (const item of response.output as unknown[]) {
            if (record(item) && item.type === "function_call" && typeof item.call_id === "string" && !calls.has(item.call_id)) yield { type: "response.tool_call", call: item };
          }
          yield { type: "response.completed", response, native: event };
          return;
        } else yield { type: "response.native_event", event };
      }
      throw new ProviderTransportError("upstream_incomplete", "Provider stream ended before a completed response.");
    } catch (error) {
      yield { type: "response.failed", error: { code: error instanceof ProviderTransportError ? error.code : "upstream_error", message: error instanceof ProviderTransportError ? error.message : "Provider request failed." } };
    }
  }
}
