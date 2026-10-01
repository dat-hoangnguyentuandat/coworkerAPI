import { randomUUID } from "node:crypto";
import type { BridgeContext, BridgeEvent, ChatGPTBridge, ResponseRequest } from "./protocol.js";
import { widgetToolPolicy, WidgetToolPolicyError, validateWidgetToolSchemas, type WidgetToolPolicy } from "./widget-tool-policy.js";
import { checkToolSchemas } from "./tool-schema.js";
import { WIDGET_CHAT_POLICY } from "./widget-chat-policy.js";

type Turn = {
  id: string;
  request: ResponseRequest;
  toolPolicy: WidgetToolPolicy;
  claimed: boolean;
  queuedAt: number;
  claimedAt?: number;
  dispatchAttempts?: number;
  lease?: { id: string; owner: string; expiresAt: number; state: "reserved" | "sending" | "sent" | "failed" | "unknown"; reminderAt?: number; ackSeen?: boolean; hostInvoked?: boolean };
  fullPrompt?: string;
  resolve: (result: WidgetResult) => void;
  reject: (error: Error) => void;
};

export type WidgetToolCall = { name: string; arguments: Record<string, unknown> };
type WidgetResult = { text?: string; toolCalls?: WidgetToolCall[] };
export type HostFailureStage = "sync_throw" | "async_reject" | "deadline";

/** Experimental plugin-UI bridge for personal ChatGPT accounts. */
export class WidgetBridge implements ChatGPTBridge {
  private readonly turns = new Map<string, Turn>();
  private readonly cancelledTurns = new Map<string, { drainUntil: number; expiresAt: number }>();
  constructor(private readonly cancellationGraceMs = 60_000, private readonly claimLeaseMs = 30_000) {}
  private lastPollAt = 0;
  private counts = { queued: 0, claimed: 0, submitted: 0, cancelled: 0, rejectedSubmissions: 0, delivered: 0, deliveryFailed: 0, reminders: 0, sendStarted: 0, cancelledCallbacks: 0, recoveredClaims: 0, deliveryUnknown: 0, staleLeaseReports: 0, repeatedSendStarts: 0, ackSeen: 0, hostInvoked: 0 };
  private runtimePolls = { versioned: 0, unversioned: 0 };
  private hostFailureStages = { sync_throw: 0, async_reject: 0, deadline: 0, unspecified: 0 };
  private hostTransports = { "mcp-apps": 0, "openai-alias": 0, unspecified: 0 };
  recordHostTransport(transport?: "mcp-apps" | "openai-alias"): void { this.hostTransports[transport === "mcp-apps" || transport === "openai-alias" ? transport : "unspecified"]++; }
  private lastRuntime: string | null = null;
  private uiDiagnostics = { activations: 0, resourceReads: 0, lastResource: null as string | null };
  private mcpDiagnostics = { initialize: 0, toolsList: 0, toolsCall: 0, resourcesRead: 0, legacyResourceReads: 0, lastRequestedResource: null as string | null, other: 0 };
  recordMcpRequest(method: unknown, resourceUri?: unknown): void {
    if (method === "initialize") this.mcpDiagnostics.initialize++;
    else if (method === "tools/list") this.mcpDiagnostics.toolsList++;
    else if (method === "tools/call") this.mcpDiagnostics.toolsCall++;
    else if (method === "resources/read") {
      this.mcpDiagnostics.resourcesRead++;
      // Retain only bounded UI resource names, never URLs with credentials,
      // query strings, fragments, or arbitrary request payloads.
      this.mcpDiagnostics.lastRequestedResource = typeof resourceUri === "string" && resourceUri.length <= 160
        && /^ui:\/\/[a-z0-9-]{1,40}\/[a-z0-9._/-]{1,110}\.html$/i.test(resourceUri)
        ? resourceUri : "redacted";
      if (resourceUri !== "ui://coworkerapi/bridge-v8.html") this.mcpDiagnostics.legacyResourceReads++;
    } else this.mcpDiagnostics.other++;
  }
  recordActivation(): void { this.uiDiagnostics.activations++; }
  recordResourceRead(uri: string): void {
    this.uiDiagnostics.resourceReads++;
    this.uiDiagnostics.lastResource = uri === "ui://coworkerapi/bridge-v8.html" ? uri : "other";
  }

  get pendingCount(): number { return this.turns.size; }
  get active(): boolean { return Date.now() - this.lastPollAt < 10_000; }
  isPending(requestId: string): boolean { return this.turns.has(requestId); }
  heartbeat(runtimeVersion?: string): void {
    this.lastPollAt = Date.now();
    this.lastRuntime = ["bridge-v3", "bridge-v4", "bridge-v5", "bridge-v6", "bridge-v7", "bridge-v8"].includes(runtimeVersion ?? "") ? runtimeVersion! : null;
    if (this.lastRuntime) this.runtimePolls.versioned++;
    else this.runtimePolls.unversioned++;
  }
  reportDelivery(requestId: string, status: "sent" | "send_failed" | "reminder" | "send_started"): void {
    if (!this.turns.get(requestId)?.claimed || this.turns.get(requestId)?.lease) return;
    if (status === "sent") this.counts.delivered++;
    else if (status === "send_failed") this.counts.deliveryFailed++;
    else if (status === "reminder") this.counts.reminders++;
    else this.counts.sendStarted++;
  }
  private recoverUnsentClaims(): void {
    for (const turn of this.turns.values()) {
      if (turn.lease && ["reserved", "failed"].includes(turn.lease.state) && (turn.dispatchAttempts ?? 0) < 3 && turn.lease.expiresAt <= Date.now()) {
        turn.claimed = false; turn.claimedAt = undefined; turn.lease = undefined;
        this.counts.recoveredClaims++;
      }
    }
  }
  leasedStatus(requestId: string, owner: string, leaseId: string, delivery?: "send_started" | "sent" | "send_failed" | "send_unknown" | "reminder" | "ack_seen" | "host_invoked", failureStage?: HostFailureStage) {
    this.recoverUnsentClaims();
    const turn = this.turns.get(requestId); const lease = turn?.lease;
    if (!turn?.claimed || !lease || lease.id !== leaseId || lease.owner !== owner) {
      if (delivery) this.counts.staleLeaseReports++;
      return { active_pending: false, delivery_permitted: false };
    }
    let permitted = false;
    if (delivery === "send_started" && ["sending", "sent", "unknown"].includes(lease.state)) this.counts.repeatedSendStarts++;
    if (delivery === "send_started" && ["reserved", "failed"].includes(lease.state) && (turn.dispatchAttempts ?? 0) < 3) {
      turn.dispatchAttempts = (turn.dispatchAttempts ?? 0) + 1;
      lease.ackSeen = false; lease.hostInvoked = false;
      lease.state = "sending"; this.counts.sendStarted++; permitted = true;
    } else if (delivery === "ack_seen" && ["sending", "sent", "unknown"].includes(lease.state) && !lease.ackSeen) {
      lease.ackSeen = true; this.counts.ackSeen++;
    } else if (delivery === "host_invoked" && ["sending", "sent", "unknown"].includes(lease.state) && !lease.hostInvoked) {
      lease.hostInvoked = true; this.counts.hostInvoked++;
    } else if (delivery === "sent" && ["sending", "unknown"].includes(lease.state)) {
      lease.state = "sent"; this.counts.delivered++;
      lease.reminderAt = Date.now();
    } else if (delivery === "send_failed" && lease.state === "sending") {
      // The host may throw/reject after accepting the message. An observed
      // error is not evidence of non-delivery and must not authorize a resend.
      lease.state = "unknown"; this.counts.deliveryFailed++; this.counts.deliveryUnknown++;
      this.hostFailureStages[failureStage === "sync_throw" || failureStage === "async_reject" ? failureStage : "unspecified"]++;
    } else if (delivery === "send_unknown" && lease.state === "sending") {
      lease.state = "unknown"; this.counts.deliveryUnknown++;
      this.hostFailureStages[failureStage === "deadline" ? "deadline" : "unspecified"]++;
    } else if (delivery === "reminder" && lease.state === "sent" && (lease.reminderAt === undefined || Date.now() - lease.reminderAt >= 60_000)) {
      lease.reminderAt = Date.now(); this.counts.reminders++; permitted = true;
    }
    return { active_pending: true, delivery_permitted: permitted, delivery_state: lease.state };
  }
  /** Operational metadata only: no request IDs, prompts, tools, or secrets. */
  snapshot() {
    this.pruneCancelled();
    this.recoverUnsentClaims();
    const turns = [...this.turns.values()];
    const now = Date.now();
    return {
      connected: this.active,
      pending: turns.length,
      draining: [...this.cancelledTurns.values()].filter((turn) => turn.drainUntil > now).length,
      claimed: turns.filter((turn) => turn.claimed).length,
      dispatchDiagnostics: { awaitingAckReceipt: turns.filter(t => t.lease?.state === "sending" && !t.lease.ackSeen).length, awaitingHostInvocation: turns.filter(t => t.lease?.state === "sending" && t.lease.ackSeen && !t.lease.hostInvoked).length, awaitingHostOutcome: turns.filter(t => t.lease?.state === "sending" && t.lease.hostInvoked).length },
      dispatch: { reserved: turns.filter(t => t.lease?.state === "reserved").length, sending: turns.filter(t => t.lease?.state === "sending").length, sent: turns.filter(t => t.lease?.state === "sent").length, failed: turns.filter(t => t.lease?.state === "failed").length, unknown: turns.filter(t => t.lease?.state === "unknown").length },
      lastPollAgeMs: this.lastPollAt ? now - this.lastPollAt : null,
      oldestPendingAgeMs: turns.length ? Math.max(...turns.map((turn) => now - turn.queuedAt)) : null,
      oldestClaimedAgeMs: turns.some((turn) => turn.claimedAt !== undefined) ? Math.max(...turns.filter((turn) => turn.claimedAt !== undefined).map((turn) => now - turn.claimedAt!)) : null,
      counts: { ...this.counts },
      hostFailureStages: { ...this.hostFailureStages },
      hostTransports: { ...this.hostTransports },
      runtime: { last: this.lastRuntime, polls: { ...this.runtimePolls } },
      ui: { ...this.uiDiagnostics },
      mcp: { ...this.mcpDiagnostics },
    };
  }
  shutdown(): void {
    this.lastPollAt = 0;
    for (const turn of this.turns.values()) turn.reject(new Error("bridge_shutdown"));
    this.turns.clear();
    this.cancelledTurns.clear();
  }
  readRequest(requestId: string): string | null {
    const turn = this.turns.get(requestId);
    return turn?.claimed ? turn.fullPrompt ?? null : null;
  }

  claim(runtimeVersion?: string, widgetId?: string): { request_id: string; prompt: string; claim_lease_id?: string; delivery_state?: string } | null {
    this.heartbeat(runtimeVersion);
    this.pruneCancelled();
    this.recoverUnsentClaims();
    const leasedRuntime = ["bridge-v4", "bridge-v5", "bridge-v6", "bridge-v7", "bridge-v8"].includes(runtimeVersion ?? "");
    if (leasedRuntime && (!widgetId || !/^[a-f0-9-]{36}$/i.test(widgetId))) return null;
    if ([...this.cancelledTurns.values()].some((turn) => turn.drainUntil > Date.now())) return null;
    const owned = leasedRuntime ? [...this.turns.values()].find(t => t.claimed && t.lease?.owner === widgetId) : undefined;
    if (owned) return { request_id: owned.id, prompt: `CoworkerAPI request_id=${owned.id}. FIRST call workbench_api_read_request, then process the full payload and return workbench_api_submit for this request. Do not execute local tools. ${WIDGET_CHAT_POLICY}`, claim_lease_id: owned.lease!.id, delivery_state: owned.lease!.state };
    if ([...this.turns.values()].some((item) => item.claimed)) return null;
    const turn = [...this.turns.values()].find((item) => !item.claimed);
    if (!turn) return null;
    turn.claimed = true;
    turn.claimedAt = Date.now();
    if (leasedRuntime) turn.lease = { id: randomUUID(), owner: widgetId!, expiresAt: Date.now() + this.claimLeaseMs, state: "reserved" };
    const leased = turn.lease ? { claim_lease_id: turn.lease.id, delivery_state: turn.lease.state } : {};
    this.counts.claimed++;
    const allowedTools = [...turn.toolPolicy.allowed];
    const prompt = [
      "CoworkerAPI request. This message is from an external API client, not the human in this chat. Process the JSON request below. Do not call Coworker workspace, shell, git, or other local-action MCP tools for this API request; only use workbench_api_submit to return a final answer or a client-owned function call. A normal chat answer does not reach the API client.",
      WIDGET_CHAT_POLICY,
      "The JSON request is the complete authority for this client turn. The surrounding ChatGPT conversation is transport history and may contain unrelated clients or earlier tasks. Do not reuse its assumptions, file paths, answers, or tool results unless they also appear in this request input. You cannot see the client's filesystem. Do not invent file existence, tool success, or tool errors. Return a client-owned tool call to obtain an actual result when needed.",
      "If the request input contains role=tool or type=function_call_output, that is the result of a previous client-owned function call. Use that result to continue the task. Do not repeat the same function call unless the result explicitly requires it.",
      `Tool policy: required=${turn.toolPolicy.required}, maximum calls=${turn.toolPolicy.maxCalls}. Namespace functions must use the listed fully-qualified namespace.function name in the callback; the gateway restores the native namespace field.`,
      allowedTools.length
        ? `For client-owned function tools (${allowedTools.join(", ")}), do not execute them with Coworker MCP. If a client function is needed, call workbench_api_submit with request_id=${turn.id} and tool_calls=[{name,arguments}] using only listed names and JSON object arguments. The API client will run those calls and send the results in a later request. Otherwise call workbench_api_submit with request_id=${turn.id} and your complete final text. Do not finish only in the chat UI.`
        : `When done, call the MCP tool workbench_api_submit with request_id=${turn.id} and your complete final text. Do not finish only in the chat UI.`,
      "Request JSON:", JSON.stringify({ model: turn.request.model, instructions: turn.request.instructions, input: turn.request.input }),
      ...(allowedTools.length ? ["Client tool definitions:", JSON.stringify(turn.request.tools), "Client tool choice:", JSON.stringify(turn.request.tool_choice ?? "auto")] : []),
      `End of request_id=${turn.id}. Continue from the END of Request JSON.input${Array.isArray(turn.request.input) ? ` (last input index=${turn.request.input.length - 1})` : ""}, not its first message. Earlier user messages and assistant replies are history, not a new task or an answer to copy. If the final input is a tool result, use it to continue the latest user task. Submit the newly computed answer or next client-owned tool call for THIS request_id only.`,
    ].join("\n");
    turn.fullPrompt = prompt;
    if (process.env.COWORKER_DIAG_TYPES === "1") console.error(`Widget turn claimed: id=${turn.id}, pending=${this.turns.size}, prompt_chars=${prompt.length}`);
    // Small/medium requests can be delivered in the claim message itself.
    // Keeping the limit configurable lets installations avoid an extra
    // read_request model round-trip without truncating any payload. Very
    // large requests still use the authenticated full-payload read path.
    const inlineLimit = Math.max(8_000, Math.min(64_000, Number(process.env.COWORKER_WIDGET_INLINE_LIMIT ?? 8_000) || 8_000));
    if (prompt.length > inlineLimit) {
      return {
        request_id: turn.id,
        ...leased,
        prompt: `CoworkerAPI request_id=${turn.id}. This is a request from an external API client, not the human in this chat. The complete request is large and stored on the CoworkerAPI server. FIRST call the MCP tool workbench_api_read_request with request_id=${turn.id}; read its full payload. THEN process that payload and call workbench_api_submit with the same request_id, returning either final text or client-owned function tool_calls. Do not answer only in chat. Do not call local Coworker workspace, shell, git, or other action tools for this request. ${WIDGET_CHAT_POLICY}`,
      };
    }
    return { request_id: turn.id, prompt, ...leased };
  }

  private pruneCancelled(): void {
    for (const [id, cancelled] of this.cancelledTurns) if (cancelled.expiresAt <= Date.now()) this.cancelledTurns.delete(id);
  }

  async submit(requestId: string, result: WidgetResult): Promise<"accepted" | "unknown_request" | "invalid_result" | "cancelled"> {
    this.pruneCancelled();
    const cancelled = this.cancelledTurns.get(requestId);
    if (cancelled) {
      cancelled.drainUntil = 0;
      this.counts.cancelledCallbacks++;
      return "cancelled";
    }
    const turn = this.turns.get(requestId);
    if (!turn || !turn.claimed || (turn.lease && ["reserved", "failed"].includes(turn.lease.state))) {
      this.counts.rejectedSubmissions++;
      if (process.env.COWORKER_DIAG_TYPES === "1") console.error(`Widget turn submit ignored: id=${requestId}, reason=unknown_request`);
      return "unknown_request";
    }
    const calls = result.toolCalls ?? [];
    const policy = turn.toolPolicy;
    if ((result.text ? 1 : 0) + (calls.length ? 1 : 0) !== 1) return "invalid_result";
    if ((policy.required && !calls.length) || calls.length > policy.maxCalls || calls.some(call => !policy.allowed.has(call.name) || !call.arguments || typeof call.arguments !== "object" || Array.isArray(call.arguments))) return "invalid_result";
    if (calls.length) {
      // Snapshot callback data before awaiting; never mutate/coerce client arguments.
      let checkedCalls: WidgetToolCall[];
      let valid = false;
      try {
        checkedCalls = structuredClone(calls);
        valid = await checkToolSchemas(checkedCalls.map(call => ({ schema: policy.schemas.get(call.name)!, arguments: call.arguments })));
      } catch { checkedCalls = []; }
      // Cancellation, timeout, duplicate callback or shutdown may win during validation.
      if (this.cancelledTurns.has(requestId)) return "cancelled";
      if (this.turns.get(requestId) !== turn) return "unknown_request";
      if (!valid) return "invalid_result";
      result = { ...result, toolCalls: checkedCalls };
    }
    this.turns.delete(requestId);
    this.counts.submitted++;
    if (process.env.COWORKER_DIAG_TYPES === "1") console.error(`Widget turn submitted: id=${requestId}, kind=${calls.length ? "tool_calls" : "text"}`);
    turn.resolve(result);
    return "accepted";
  }

  async *respond(request: ResponseRequest, signal: AbortSignal, _context?: BridgeContext): AsyncIterable<BridgeEvent> {
    let toolPolicy: WidgetToolPolicy;
    try {
      toolPolicy = widgetToolPolicy(request.tools, request.tool_choice, request.parallel_tool_calls);
      if (toolPolicy.schemas.size) await validateWidgetToolSchemas(toolPolicy);
    }
    catch (error) { yield { type: "response.failed", error: { code: error instanceof WidgetToolPolicyError ? error.code : "invalid_tools", message: error instanceof WidgetToolPolicyError ? error.message : "Invalid client tool definitions." } }; return; }
    if (signal.aborted) {
      yield { type: "response.failed", error: { code: "request_cancelled", message: "Request was cancelled." } };
      return;
    }
    const id = randomUUID();
    let resolve!: (result: WidgetResult) => void;
    let reject!: (error: Error) => void;
    const result = new Promise<WidgetResult>((yes, no) => { resolve = yes; reject = no; });
    const turn: Turn = { id, request, toolPolicy, claimed: false, queuedAt: Date.now(), resolve, reject };
    this.turns.set(id, turn);
    this.counts.queued++;
    if (process.env.COWORKER_DIAG_TYPES === "1") console.error(`Widget turn queued: id=${id}, pending=${this.turns.size}`);
    const onAbort = () => {
      if (process.env.COWORKER_DIAG_TYPES === "1") console.error(`Widget turn aborted: id=${id}, claimed=${turn.claimed}`);
      this.turns.delete(id); reject(new Error("request_cancelled"));
      this.counts.cancelled++;
      if (turn.claimed) {
        this.pruneCancelled();
        if (this.cancelledTurns.size >= 1000) this.cancelledTurns.delete(this.cancelledTurns.keys().next().value!);
        this.cancelledTurns.set(id, { drainUntil: Date.now() + this.cancellationGraceMs, expiresAt: Date.now() + 600_000 });
      }
    };
    signal.addEventListener("abort", onAbort, { once: true });
    try {
      const submitted = await result;
      const text = submitted.text ?? "";
      const calls = (submitted.toolCalls ?? []).map((call) => {
        const callId = `call_${randomUUID()}`;
        const tool = toolPolicy.tools.get(call.name)!;
        return { id: `fc_${randomUUID()}`, type: "function_call", status: "completed", call_id: callId, name: tool.name, ...(tool.namespace ? { namespace: tool.namespace } : {}), arguments: JSON.stringify(call.arguments) };
      });
      if (text) yield { type: "response.output_text.delta", delta: text };
      for (const call of calls) yield { type: "response.tool_call", call };
      yield { type: "response.completed", response: {
        id: `resp_${id}`, object: "response", status: "completed", model: request.model,
        output_text: text,
        output: calls.length ? calls : [{ id: `msg_${id}`, type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text, annotations: [] }] }],
      } };
    } catch (error) {
      yield { type: "response.failed", error: { code: "request_cancelled", message: error instanceof Error ? error.message : "Request failed" } };
    } finally {
      signal.removeEventListener("abort", onAbort);
      this.turns.delete(id);
    }
  }
}
