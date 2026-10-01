import { z } from "zod";
import type { ResponseRequest } from "./protocol.js";

export const chatCompletionRequestSchema = z.object({
  model: z.string().min(1),
  messages: z.array(z.unknown()).min(1),
  tools: z.array(z.unknown()).optional(),
  tool_choice: z.unknown().optional(),
  temperature: z.number().optional(),
  top_p: z.number().optional(),
  max_tokens: z.number().int().positive().optional(),
  stream: z.boolean().default(false),
}).passthrough();

export type ChatCompletionRequest = z.infer<typeof chatCompletionRequestSchema>;

export function toResponseRequest(request: ChatCompletionRequest): ResponseRequest {
  const system = request.messages.find((message) => isRecord(message) && message.role === "system");
  return {
    model: request.model,
    input: request.messages,
    instructions: isRecord(system) && typeof system.content === "string" ? system.content : undefined,
    tools: request.tools,
    tool_choice: request.tool_choice,
    parallel_tool_calls: request.parallel_tool_calls,
    stream: request.stream,
    max_output_tokens: request.max_tokens,
  };
}

export function toChatCompletion(response: Record<string, unknown>, model: string) {
  if (isRecord(response.native_chat_completion)) return { ...response.native_chat_completion, model };
  const id = typeof response.id === "string" ? response.id : `chatcmpl_${crypto.randomUUID()}`;
  const text = typeof response.output_text === "string" ? response.output_text : "";
  const toolCalls = Array.isArray(response.output)
    ? response.output.filter((item): item is Record<string, unknown> => isRecord(item) && (item.type === "function_call" || item.type === "tool_call")).map((item, index) => {
      const fn = isRecord(item.function) ? item.function : item;
      return { id: String(item.call_id ?? item.id ?? `call_${index}`), type: "function", function: { name: String(fn.name ?? "tool"), arguments: typeof fn.arguments === "string" ? fn.arguments : JSON.stringify(fn.arguments ?? item.input ?? {}) } };
    })
    : [];
  return {
    id,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: typeof response.model === "string" ? response.model : model,
    choices: [{ index: 0, message: { role: "assistant", content: text || (toolCalls.length ? null : ""), ...(toolCalls.length ? { tool_calls: toolCalls } : {}) }, finish_reason: toolCalls.length ? "tool_calls" : "stop" }],
    usage: response.usage ?? { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  };
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null;
}
