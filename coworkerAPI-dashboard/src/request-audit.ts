import type { BridgeEvent } from "./protocol.js";
import type { RequestRecord } from "./local-store.js";

export type TokenUsage = {
  inputTokens: number | null; cachedInputTokens: number | null;
  cacheWriteInputTokens: number | null; outputTokens: number | null;
  reasoningTokens: number | null;
};
const object = (value: unknown): Record<string, any> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
const count = (value: unknown): number | null => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
export function tokenUsage(value: unknown): TokenUsage {
  const usage = object(value);
  return {
    inputTokens: count(usage.input_tokens ?? usage.prompt_tokens),
    cachedInputTokens: count(usage.input_tokens_details?.cached_tokens ?? usage.prompt_tokens_details?.cached_tokens ?? usage.cache_read_input_tokens),
    cacheWriteInputTokens: count(usage.input_tokens_details?.cache_write_tokens ?? usage.prompt_tokens_details?.cache_write_tokens ?? usage.cache_creation_input_tokens),
    outputTokens: count(usage.output_tokens ?? usage.completion_tokens),
    reasoningTokens: count(usage.output_tokens_details?.reasoning_tokens ?? usage.completion_tokens_details?.reasoning_tokens),
  };
}

/** Metadata-only, exactly-once audit state shared with the request lifecycle. */
export class RequestAudit {
  readonly started = Date.now();
  private finished = false;
  provider: string | null = null;
  inferenceStarted = false;
  private inferenceStartedAt: number | null = null;
  markInferenceStarted(): void { this.inferenceStarted = true; this.inferenceStartedAt = Date.now(); }
  upstreamModel: string | null = null;
  outcome: RequestRecord["outcome"] = "unknown";
  ttftMs: number | null = null;
  usage: TokenUsage = tokenUsage(undefined);
  usageSource: RequestRecord["usageSource"] = "unknown";
  observe(event: BridgeEvent, widget: boolean): void {
    // First observable text output, not inference time hidden behind a buffered
    // ChatGPT callback. No first-token timestamp is invented for nonstream/tool-only.
    if (event.type === "response.output_text.delta" && event.delta && this.ttftMs === null) this.ttftMs = Date.now() - this.started;
    if (event.type === "response.failed") this.outcome = "failed";
    if (event.type === "response.completed") {
      this.outcome = "completed";
      if (!widget) {
        this.usage = tokenUsage(event.response.usage);
        if (Object.values(this.usage).some(value => value !== null)) this.usageSource = "upstream";
      }
    }
  }
  finish(base: Pick<RequestRecord, "id" | "protocol" | "model" | "status">, disconnected: boolean): RequestRecord | undefined {
    if (this.finished) return;
    this.finished = true;
    const failed = this.outcome === "failed" || (this.inferenceStarted && this.outcome !== "completed");
    const outcome = disconnected ? "cancelled" : failed ? "failed" : base.status >= 400 ? "rejected" : this.outcome;
    const ended = Date.now();
    const inferenceStartedAt = this.inferenceStartedAt;
    return { ...base, at: new Date(this.started).toISOString(), durationMs: ended - this.started,
      queueMs: inferenceStartedAt === null ? null : Math.max(0, inferenceStartedAt - this.started),
      inferenceMs: inferenceStartedAt === null ? null : Math.max(0, ended - inferenceStartedAt),
      provider: this.provider, upstreamModel: this.upstreamModel, outcome,
      ttftMs: this.ttftMs, ...this.usage, usageSource: this.usageSource, costEstimateUsd: null };
  }
}
