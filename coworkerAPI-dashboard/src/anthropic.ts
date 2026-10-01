import { z } from "zod";
import type { ResponseRequest } from "./protocol.js";

export const messagesRequestSchema = z.object({
  model: z.string().min(1),
  messages: z.array(z.unknown()).min(1),
  system: z.unknown().optional(),
  tools: z.array(z.unknown()).optional(),
  tool_choice: z.unknown().optional(),
  max_tokens: z.number().int().positive().optional(),
  stream: z.boolean().default(false),
}).passthrough();

export type MessagesRequest = z.infer<typeof messagesRequestSchema>;

export function toResponseRequest(request: MessagesRequest): ResponseRequest {
  return {
    model: request.model,
    input: request.messages,
    instructions: systemText(request.system),
    tools: request.tools,
    tool_choice: request.tool_choice,
    parallel_tool_calls: request.parallel_tool_calls,
    stream: request.stream,
    max_output_tokens: request.max_tokens,
  };
}

function systemText(system: unknown): string | undefined {
  if (typeof system === "string") return system;
  if (!Array.isArray(system)) return undefined;
  const text = system.map((block) => {
    if (typeof block === "string") return block;
    if (block && typeof block === "object" && "text" in block) return String((block as { text?: unknown }).text ?? "");
    return "";
  }).filter(Boolean).join("\n");
  return text || undefined;
}

export function toAnthropicResponse(response: Record<string, unknown>, model: string) {
  const native = response.native_anthropic_message;
  if (native && typeof native === "object" && !Array.isArray(native)) return { ...native, model };
  const text = typeof response.output_text === "string" ? response.output_text : "";
  const content: Array<Record<string, unknown>> = text ? [{ type: "text", text }] : [];
  if (Array.isArray(response.output)) {
    for (const item of response.output) {
      if (!item || typeof item !== "object") continue;
      const value = item as Record<string, unknown>;
      if (value.type !== "function_call" && value.type !== "tool_call") continue;
      const fn = value.function && typeof value.function === "object" ? value.function as Record<string, unknown> : value;
      let input: unknown = fn.arguments ?? value.input ?? {};
      if (typeof input === "string") {
        try { input = JSON.parse(input); } catch { input = {}; }
      }
      content.push({ type: "tool_use", id: String(value.call_id ?? value.id ?? `tool_${content.length}`), name: String(fn.name ?? "tool"), input });
    }
  }
  return {
    id: typeof response.id === "string" ? response.id : `msg_${crypto.randomUUID()}`,
    type: "message",
    role: "assistant",
    model,
    content,
    stop_reason: content.some((item) => item.type === "tool_use") ? "tool_use" : "end_turn",
    stop_sequence: null,
    usage: response.usage ?? { input_tokens: 0, output_tokens: 0 },
  };
}
