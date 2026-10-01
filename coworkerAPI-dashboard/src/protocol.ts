import { z } from "zod";

export const responseRequestSchema = z.object({
  model: z.string().min(1),
  input: z.unknown(),
  instructions: z.string().optional(),
  tools: z.array(z.unknown()).optional(),
  tool_choice: z.unknown().optional(),
  stream: z.boolean().default(false),
  store: z.boolean().optional(),
}).passthrough();

export type ResponseRequest = z.infer<typeof responseRequestSchema>;

export type BridgeContext = {
  profileId?: string;
  conversationId?: string;
  sessionId?: string;
  clientRequestId?: string;
};

export type BridgeEvent = (
  | { type: "response.created"; response: Record<string, unknown> }
  | { type: "response.output_text.delta"; delta: string }
  | { type: "response.output_text.done"; text: string }
  | { type: "response.tool_call"; call: Record<string, unknown> }
  | { type: "response.completed"; response: Record<string, unknown> }
  | { type: "response.failed"; error: { code: string; message: string } }
  | { type: "response.native_event"; event: Record<string, unknown> }
) & { native?: Record<string, unknown>; nativeChat?: Record<string, unknown> | "[DONE]" | null; nativeAnthropic?: Record<string, unknown> | null };

export type BridgeEnvelope =
  | { type: "turn.start"; requestId: string; request: ResponseRequest; context?: BridgeContext }
  | { type: "turn.cancel"; requestId: string }
  | { type: "turn.event"; requestId: string; event: BridgeEvent }
  | { type: "bridge.ready"; bridgeId: string; profileIds?: string[] };

const bridgeEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("response.created"), response: z.record(z.string(), z.unknown()) }),
  z.object({ type: z.literal("response.output_text.delta"), delta: z.string() }),
  z.object({ type: z.literal("response.output_text.done"), text: z.string() }),
  z.object({ type: z.literal("response.tool_call"), call: z.record(z.string(), z.unknown()) }),
  z.object({ type: z.literal("response.completed"), response: z.record(z.string(), z.unknown()) }),
  z.object({ type: z.literal("response.failed"), error: z.object({ code: z.string(), message: z.string() }) }),
  z.object({ type: z.literal("response.native_event"), event: z.record(z.string(), z.unknown()) }),
]);

export const bridgeEnvelopeSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("turn.start"), requestId: z.string().uuid(), request: responseRequestSchema, context: z.object({ profileId: z.string().optional(), conversationId: z.string().optional(), sessionId: z.string().optional(), clientRequestId: z.string().optional() }).optional() }),
  z.object({ type: z.literal("turn.cancel"), requestId: z.string().uuid() }),
  z.object({ type: z.literal("turn.event"), requestId: z.string().uuid(), event: bridgeEventSchema }),
  z.object({ type: z.literal("bridge.ready"), bridgeId: z.string().min(1), profileIds: z.array(z.string().min(1)).optional() }),
]);

export interface ChatGPTBridge {
  respond(request: ResponseRequest, signal: AbortSignal, context?: BridgeContext): AsyncIterable<BridgeEvent>;
}

export class UnconfiguredBridge implements ChatGPTBridge {
  async *respond(_request: ResponseRequest, _signal: AbortSignal, _context?: BridgeContext): AsyncIterable<BridgeEvent> {
    yield {
      type: "response.failed",
      error: {
        code: "bridge_unconfigured",
        message: "No Coworker ChatGPT bridge is connected.",
      },
    };
  }
}
