import { randomUUID } from "node:crypto";
import type { BridgeContext, BridgeEvent, ChatGPTBridge, ResponseRequest } from "./protocol.js";

type PendingTurn = {
  resolve: (text: string) => void;
  reject: (error: Error) => void;
};

export type WorkspaceAgentOptions = {
  triggerId: string;
  accessToken: string;
  baseUrl?: string;
  fetcher?: typeof fetch;
  pollIntervalMs?: number;
};

/** Experimental text-only transport. ChatGPT must explicitly call submit_result. */
export class WorkspaceAgentBridge implements ChatGPTBridge {
  private readonly pending = new Map<string, PendingTurn>();
  private readonly fetcher: typeof fetch;
  private readonly baseUrl: string;

  constructor(private readonly options: WorkspaceAgentOptions) {
    this.fetcher = options.fetcher ?? fetch;
    this.baseUrl = (options.baseUrl ?? "https://api.chatgpt.com").replace(/\/$/, "");
  }

  get pendingCount(): number { return this.pending.size; }

  submitResult(requestId: string, text: string): "accepted" | "unknown_request" {
    const turn = this.pending.get(requestId);
    if (!turn) return "unknown_request";
    this.pending.delete(requestId);
    turn.resolve(text);
    return "accepted";
  }

  async *respond(request: ResponseRequest, signal: AbortSignal, context: BridgeContext = {}): AsyncIterable<BridgeEvent> {
    if (request.tools?.length || request.tool_choice) {
      yield { type: "response.failed", error: { code: "unsupported_tools", message: "Workspace Agent PoC supports text only; client tool calls are not yet verified." } };
      return;
    }
    if (signal.aborted) {
      yield { type: "response.failed", error: { code: "request_cancelled", message: "Request was cancelled." } };
      return;
    }
    const requestId = randomUUID();
    let resolve!: (text: string) => void;
    let reject!: (error: Error) => void;
    const result = new Promise<string>((yes, no) => { resolve = yes; reject = no; });
    // Attach a rejection handler immediately, including while the trigger HTTP call is pending.
    void result.catch(() => {});
    this.pending.set(requestId, { resolve, reject });
    const onAbort = () => {
      this.pending.delete(requestId);
      reject(new Error("request_cancelled"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    let pollTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      const trigger = await this.fetcher(`${this.baseUrl}/v1/workspace_agents/${encodeURIComponent(this.options.triggerId)}/trigger`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.options.accessToken}`,
          "Content-Type": "application/json",
          "OpenAI-Beta": "workspace_agent_runs=v1",
          "Idempotency-Key": requestId,
        },
        body: JSON.stringify({
          // One isolated ChatGPT conversation per HTTP request. The client
          // supplies its own history, so untrusted session IDs cannot merge turns.
          conversation_key: requestId,
          input: JSON.stringify({
            task: "Respond to this CoworkerAPI request, then call submit_result exactly once with request_id and the complete final text.",
            request_id: requestId,
            request: { model: request.model, instructions: request.instructions, input: request.input },
          }),
        }),
        signal,
      });
      if (!trigger.ok) throw new Error(`workspace_agent_trigger_${trigger.status}`);
      const accepted = await trigger.json() as { agent_trigger_run_id?: string };
      if (accepted.agent_trigger_run_id) {
        const runId = accepted.agent_trigger_run_id;
        const poll = async () => {
          if (!this.pending.has(requestId) || signal.aborted) return;
          try {
            const status = await this.fetcher(`${this.baseUrl}/v1/workspace_agents/${encodeURIComponent(this.options.triggerId)}/runs/${encodeURIComponent(runId)}`, {
              headers: { Authorization: `Bearer ${this.options.accessToken}` }, signal,
            });
            if (status.ok) {
              const run = await status.json() as { status?: string };
              if (run.status === "failed") throw new Error("workspace_agent_run_failed");
              if (run.status === "completed") {
                // A successful run can complete before its MCP callback reaches us.
                pollTimer = setTimeout(poll, this.options.pollIntervalMs ?? 1500);
                return;
              }
            }
          } catch (error) {
            if (error instanceof Error && error.message === "workspace_agent_run_failed") {
              this.pending.delete(requestId);
              reject(error);
              return;
            }
          }
          if (this.pending.has(requestId)) pollTimer = setTimeout(poll, this.options.pollIntervalMs ?? 1500);
        };
        pollTimer = setTimeout(poll, this.options.pollIntervalMs ?? 1500);
      }
      const text = await result;
      yield { type: "response.output_text.delta", delta: text };
      yield { type: "response.completed", response: {
        id: `resp_${requestId}`, object: "response", model: request.model, status: "completed",
        output_text: text,
        output: [{ id: `msg_${requestId}`, type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text, annotations: [] }] }],
      } };
    } catch (error) {
      const message = error instanceof Error ? error.message : "workspace_agent_error";
      yield { type: "response.failed", error: { code: signal.aborted ? "request_cancelled" : "workspace_agent_error", message } };
    } finally {
      if (pollTimer) clearTimeout(pollTimer);
      signal.removeEventListener("abort", onAbort);
      this.pending.delete(requestId);
    }
  }
}
