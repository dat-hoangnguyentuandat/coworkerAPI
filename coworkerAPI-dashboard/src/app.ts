import Fastify from "fastify";
import { randomUUID } from "node:crypto";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import { createKeyAuthenticator } from "./auth.js";
import { messagesRequestSchema, toAnthropicResponse, toResponseRequest } from "./anthropic.js";
import { chatCompletionRequestSchema, toChatCompletion, toResponseRequest as toChatResponseRequest } from "./chat-completions.js";
import { CoworkerBridge } from "./bridge.js";
import { responseRequestSchema, UnconfiguredBridge, type BridgeContext, type ChatGPTBridge, type ResponseRequest, type BridgeEvent } from "./protocol.js";
import { startSse } from "./sse.js";
import { writeAnthropicEvent, writeAnthropicStart, writeAnthropicStop, writeChatCompletionEvent, writeOpenAIEvent } from "./serializers.js";
import { WorkspaceAgentBridge } from "./workspace-agent.js";
import { registerWorkspaceAgentMcp } from "./workspace-agent-mcp.js";
import { WidgetBridge } from "./widget-bridge.js";
import { registerWidgetMcp } from "./widget-mcp.js";
import { collectWidgetResponse, writeWidgetAnthropicStream, writeWidgetChatStream, writeWidgetResponsesStream } from "./widget-sse.js";
import { registerDashboard } from "./dashboard.js";
import type { TunnelStatus } from "./tunnel.js";
import type { TunnelAdmin } from "./tunnel-admin.js";
import type { LocalStore } from "./local-store.js";
import { RequestLimits } from "./request-limits.js";
import { ResponsesProviderBridge } from "./responses-provider.js";
import { ChatProviderBridge } from "./chat-provider.js";
import { AnthropicProviderBridge } from "./anthropic-provider.js";
import { RequestAudit } from "./request-audit.js";
import { widgetToolPolicy, WidgetToolPolicyError, validateWidgetToolSchemas } from "./widget-tool-policy.js";
import { PACKAGE_VERSION } from "./package-version.js";

export function buildServer(bridge: ChatGPTBridge = new UnconfiguredBridge(), bridgeSecret = process.env.COWORKER_BRIDGE_SECRET, localStore?: LocalStore, tunnelStatus?: () => TunnelStatus, tunnelAdmin?: TunnelAdmin) {
  const app = Fastify({ logger: false, bodyLimit: 16 * 1024 * 1024 });
  const authenticate = createKeyAuthenticator(process.env.COWORKER_API_KEYS, localStore ? (token) => localStore.verifyKey(token) : undefined);
  // Resolve aliases before queuing any model work. A disabled model must not
  // remain callable merely because it has disappeared from /v1/models.
  const modelPaths = new Set(["/v1/responses", "/v1/messages", "/v1/chat/completions"]);
  const persistedLimits = localStore?.getLimits();
  const limits = new RequestLimits(persistedLimits?.requestsPerMinute ?? Number(process.env.COWORKER_REQUESTS_PER_MINUTE ?? 60), persistedLimits?.concurrentRequests ?? Number(process.env.COWORKER_CONCURRENT_REQUESTS ?? 4));
  app.addHook("preValidation", async (request, reply) => {
    if (request.method !== "POST" || !modelPaths.has(request.url.split("?")[0]) || !authenticate(request)) return;
    const authorization = header(request, "authorization");
    const token = authorization?.startsWith("Bearer ") ? authorization.slice(7).trim() : header(request, "x-api-key")?.trim();
    if (!token) return;
    const admitted = limits.acquire(token);
    if (!admitted.allowed) return reply.header("retry-after", admitted.retryAfter).code(429).send({
      ...(request.url.startsWith("/v1/messages") ? { type: "error" } : {}),
      error: { type: "rate_limit_error", code: `${admitted.reason}_limit_exceeded`, message: "Request admission limit exceeded. Retry after the indicated delay." },
    });
    // Streaming replies are hijacked; raw finish/close cover both completion
    // and disconnect. The release function is idempotent.
    reply.raw.once("finish", admitted.release);
    reply.raw.once("close", admitted.release);
  });
  app.addHook("preValidation", async (request, reply) => {
    if (!localStore || request.method !== "POST" || !modelPaths.has(request.url.split("?")[0])) return;
    if (!authenticate(request)) return; // Route emits its protocol-specific 401.
    const body = request.body as Record<string, unknown> | undefined;
    if (!body || typeof body.model !== "string") return; // Route validates schema.
    const model = localStore.listModels().find((item) => item.id === body.model && item.enabled);
    const fail = (status: number, code: string, message: string) => reply.code(status).send({
      ...(request.url.startsWith("/v1/messages") ? { type: "error" } : {}),
      error: { type: "invalid_request_error", code, message },
    });
    if (!model) return fail(404, "model_not_found", "The requested model alias is unavailable.");
    const provider = localStore.listProviders().find((item) => item.id === model.provider);
    if (provider && !provider.enabled) return fail(503, "provider_unavailable", "The model's provider is disabled.");
    if (model.provider !== "coworker-widget" && !provider) return fail(503, "provider_unavailable", "The model's provider is not configured.");
    if (provider && provider.type !== "coworker-widget") {
      if (!["openai", "openai-compatible", "anthropic"].includes(provider.type)) return fail(503, "provider_adapter_unavailable", "This provider's inference adapter is not available yet.");
      const nativePath = provider.type === "anthropic" ? "/v1/messages" : provider.wireApi === "chat-completions" ? "/v1/chat/completions" : "/v1/responses";
      if (request.url.split("?")[0] !== nativePath) return fail(400, "unsupported_protocol_translation", "This provider currently requires its matching native endpoint.");
    }
    if (body.stream === true && !model.supportsStreaming) return fail(400, "unsupported_streaming", "This model alias does not support streaming.");
    if (Array.isArray(body.tools) && body.tools.length && !model.supportsTools) return fail(400, "unsupported_tools", "This model alias does not support tools.");
  });
  const usesWidget = (model: string): boolean => {
    if (!(bridge instanceof WidgetBridge)) return false;
    const alias = localStore?.listModels().find((item) => item.id === model);
    const provider = localStore?.listProviders().find((item) => item.id === alias?.provider);
    return !alias || (provider ? provider.type === "coworker-widget" : alias.provider === "coworker-widget");
  };
  const publicNative = (native: Record<string, unknown> | undefined, model: string): Record<string, unknown> | undefined => {
    if (!native) return undefined;
    return native.response && typeof native.response === "object" && !Array.isArray(native.response)
      ? { ...native, response: { ...native.response as Record<string, unknown>, model } } : native;
  };
  app.addHook("preValidation", async (request, reply) => {
    if (request.method !== "POST" || !modelPaths.has(request.url.split("?")[0]) || !authenticate(request)) return;
    const body = request.body as Record<string, unknown> | undefined;
    if (!body || typeof body.model !== "string" || !usesWidget(body.model) || (body.tools !== undefined && !Array.isArray(body.tools))) return;
    const error = (code: string, message: string) => reply.code(code === "tool_schema_capacity" ? 503 : 400).send({ ...(request.url.startsWith("/v1/messages") ? { type: "error" } : {}), error: { type: code === "tool_schema_capacity" ? "server_error" : "invalid_request_error", code, message } });
    if (!request.url.startsWith("/v1/responses") && (body.tools as unknown[] | undefined)?.some(tool => tool && typeof tool === "object" && (tool as Record<string, unknown>).type === "namespace")) return error("unsupported_tools", "Function namespaces require the Responses endpoint.");
    try { await validateWidgetToolSchemas(widgetToolPolicy(body.tools as unknown[] | undefined, body.tool_choice, body.parallel_tool_calls)); }
    catch (cause) { return error(cause instanceof WidgetToolPolicyError ? cause.code : "invalid_tools", cause instanceof WidgetToolPolicyError ? cause.message : "Invalid client tool definitions."); }
  });
  // Preserve the original native payload locally, without duplicating it in
  // bridge context/envelopes or persisting request contents in logs.
  const wireBodies = new WeakMap<BridgeContext, Record<string, unknown>>();
  const auditContexts = new WeakMap<BridgeContext, RequestAudit>();
  async function* respond(resolvedRequest: ResponseRequest, signal: AbortSignal, context: BridgeContext): AsyncIterable<BridgeEvent> {
    const alias = localStore?.listModels().find((item) => item.id === resolvedRequest.model && item.enabled);
    const upstream = alias ? { ...resolvedRequest, model: alias.upstreamModel } : resolvedRequest;
    let selectedBridge = bridge;
    const provider = localStore?.listProviders().find((item) => item.id === alias?.provider);
    const audit = auditContexts.get(context);
    if (audit) { audit.markInferenceStarted(); audit.provider = alias?.provider ?? null; audit.upstreamModel = upstream.model; }
    if (provider && provider.type !== "coworker-widget") {
      let key: string | undefined;
      try { key = localStore?.providerKey(provider.id); } catch {}
      if (!key) { if (audit) audit.outcome = "failed"; yield { type: "response.failed", error: { code: "provider_unavailable", message: "Provider credential is unavailable." } }; return; }
      selectedBridge = provider.type === "anthropic" ? new AnthropicProviderBridge(provider, key, wireBodies.get(context) ?? {}) : provider.wireApi === "chat-completions"
        ? new ChatProviderBridge(provider, key, wireBodies.get(context) ?? {})
        : new ResponsesProviderBridge(provider, key);
    }
    const widget = provider?.type === "coworker-widget" || alias?.provider === "coworker-widget" || selectedBridge instanceof WidgetBridge;
    try {
      for await (const event of selectedBridge.respond(upstream, signal, context)) {
        audit?.observe(event, widget);
        if (event.type === "response.created" || event.type === "response.completed") {
          yield { ...event, response: { ...event.response, model: resolvedRequest.model }, native: publicNative(event.native, resolvedRequest.model) };
        } else if (event.type === "response.native_event") yield { ...event, event: publicNative(event.event, resolvedRequest.model)! };
        else yield event;
        // A terminal event ends the turn. Never consume or forward later output.
        if (event.type === "response.completed" || event.type === "response.failed") return;
      }
    } catch {
      // Upstream exception bodies can contain prompts/credentials; do not expose them.
      const failure: BridgeEvent = { type: "response.failed", error: { code: "upstream_error", message: "Upstream response was interrupted." } };
      audit?.observe(failure, widget); yield failure; return;
    }
    const failure: BridgeEvent = { type: "response.failed", error: { code: signal.aborted ? "upstream_timeout" : "upstream_incomplete", message: "Upstream ended without a terminal response." } };
    audit?.observe(failure, widget); yield failure;
  }
  const audits = new Map<string, RequestAudit>();
  const bridgeContext = (request: { headers: Record<string, string | string[] | undefined>; id?: string; body?: unknown }): BridgeContext => {
    const context: BridgeContext = {
    profileId: header(request, "x-coworker-profile-id"),
    conversationId: header(request, "x-coworker-conversation-id"),
    sessionId: header(request, "x-coworker-session-id") ?? header(request, "x-claude-code-session-id"),
    clientRequestId: header(request, "x-request-id") ?? request.id,
    };
    if (request.body && typeof request.body === "object" && !Array.isArray(request.body)) wireBodies.set(context, request.body as Record<string, unknown>);
    if (request.id && audits.has(request.id)) auditContexts.set(context, audits.get(request.id)!);
    return context;
  };
  app.register(cors, { origin: false });
  app.addHook("onRequest", (request, reply, done) => {
    const incoming = header(request, "x-request-id");
    reply.header("x-request-id", incoming || request.id || randomUUID());
    if (localStore && request.url.startsWith("/v1/")) {
      const audit = new RequestAudit(); audits.set(request.id, audit);
      const finalize = (disconnected: boolean) => {
        const body = request.body && typeof request.body === "object" ? request.body as Record<string, unknown> : {};
        const protocol = request.url.startsWith("/v1/messages") ? "anthropic-messages" : request.url.startsWith("/v1/chat/completions") ? "openai-chat" : request.url.startsWith("/v1/responses") ? "openai-responses" : "models";
        const record = audit.finish({ id: request.id, protocol, model: typeof body.model === "string" ? body.model : undefined, status: reply.raw.statusCode }, disconnected);
        audits.delete(request.id);
        if (record) {
          try { localStore.recordRequest(record); }
          catch { console.error("CoworkerAPI: request audit persistence failed."); }
        }
      };
      // Covers hijacked SSE and aborted clients; finish and close cannot double log.
      reply.raw.once("finish", () => finalize(false)); reply.raw.once("close", () => finalize(!reply.raw.writableFinished));
    }
    done();
  });
  if (localStore) {
    registerDashboard(app, localStore, () => bridge instanceof WidgetBridge ? bridge.active ? "ready" : "widget_not_connected" : bridge instanceof CoworkerBridge ? bridge.connected ? "ready" : "bridge_not_connected" : "configured", tunnelStatus, limits, tunnelAdmin);
  }
  if (bridge instanceof CoworkerBridge) {
    app.register(async (scope) => {
      await scope.register(websocket);
      scope.get("/internal/bridge", { websocket: true }, (socket: any, request: any) => {
        const authorization = request.headers.authorization;
        if (!bridgeSecret || authorization !== `Bearer ${bridgeSecret}`) {
          socket.close(1008, "unauthorized");
          return;
        }
        bridge.attach(socket);
      });
    });
  }
  if (bridge instanceof WorkspaceAgentBridge) {
    const mcpSecret = process.env.COWORKER_MCP_SECRET;
    if (!mcpSecret && process.env.COWORKER_MCP_AUTH_MODE !== "tunnel") throw new Error("COWORKER_MCP_SECRET is required unless COWORKER_MCP_AUTH_MODE=tunnel");
    registerWorkspaceAgentMcp(app, bridge, mcpSecret);
  }
  if (bridge instanceof WidgetBridge) {
    if (process.env.COWORKER_MCP_SECRET) registerWidgetMcp(app, bridge, process.env.COWORKER_MCP_SECRET);
    const secret = bridgeSecret;
    if (!secret) throw new Error("COWORKER_BRIDGE_SECRET is required in widget mode");
    const internalAuth = (request: { headers: Record<string, string | string[] | undefined>; raw: { socket: { remoteAddress?: string } } }) => {
      const local = ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(request.raw.socket.remoteAddress ?? "");
      return local && header(request, "authorization") === `Bearer ${secret}`;
    };
    app.post("/internal/widget/claim", async (request, reply) => {
      if (!internalAuth(request)) return reply.code(401).send({ error: "unauthorized" });
      const activeRequestId = (request.body as { active_request_id?: unknown } | undefined)?.active_request_id;
      if (typeof activeRequestId === "string") {
        bridge.heartbeat();
        return { turn: null, active_pending: bridge.isPending(activeRequestId) };
      }
      return { turn: bridge.claim(), active_pending: false };
    });
    app.post("/internal/widget/read", async (request, reply) => {
      if (!internalAuth(request)) return reply.code(401).send({ error: "unauthorized" });
      const requestId = (request.body as { request_id?: unknown } | undefined)?.request_id;
      if (typeof requestId !== "string") return reply.code(400).send({ error: "invalid_request_id" });
      const prompt = bridge.readRequest(requestId);
      return prompt === null ? reply.code(404).send({ error: "unknown_request" }) : { request_id: requestId, prompt };
    });
    app.post("/internal/widget/submit", async (request, reply) => {
      if (!internalAuth(request)) return reply.code(401).send({ error: "unauthorized" });
      const body = request.body as { request_id?: unknown; text?: unknown; tool_calls?: unknown } | undefined;
      if (typeof body?.request_id !== "string") return reply.code(400).send({ error: "invalid_result" });
      const text = typeof body.text === "string" && body.text.length <= 250_000 ? body.text : undefined;
      const toolCalls = Array.isArray(body.tool_calls) && body.tool_calls.length <= 16 && body.tool_calls.every((call) =>
        call && typeof call === "object" && typeof call.name === "string" && call.arguments && typeof call.arguments === "object" && !Array.isArray(call.arguments)
      ) ? body.tool_calls as Array<{ name: string; arguments: Record<string, unknown> }> : undefined;
      if ((text ? 1 : 0) + (toolCalls?.length ? 1 : 0) !== 1) return reply.code(400).send({ error: "invalid_result" });
      const status = await bridge.submit(body.request_id, { text, toolCalls });
      return reply.code(status === "accepted" || status === "cancelled" ? 200 : status === "invalid_result" ? 400 : 404).send({ status });
    });
  }
  app.get("/version", async () => ({ name: "CoworkerAPI", version: PACKAGE_VERSION, protocols: { openaiResponses: true, openaiChatCompletions: true, anthropicMessages: true } }));
  app.get("/health", async () => ({ status: "ok" }));
  app.get("/health/live", async () => ({ status: "ok" }));
  app.get("/health/bridge", async (request, reply) => {
    if (!["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(request.ip)) return reply.code(403).send({ error: "local_only" });
    return bridge instanceof WidgetBridge ? bridge.snapshot() : { mode: "non-widget" };
  });
  app.get("/health/ready", async (_request, reply) => {
    if (!process.env.COWORKER_API_KEYS && !localStore?.summary().activeKeys) return reply.code(503).send({ status: "not_ready" });
    return { status: "ready" };
  });
  // Provider availability is distinct from initialized gateway readiness.
  app.get("/health/inference", async (_request, reply) => {
    if (!process.env.COWORKER_API_KEYS && !localStore?.summary().activeKeys) return reply.code(503).send({ status: "not_ready" });
    if (bridge instanceof CoworkerBridge && !bridge.connected) return reply.code(503).send({ status: "bridge_not_connected", bridge: bridge.status() });
    if (bridge instanceof WidgetBridge && !bridge.active) return reply.code(503).send({ status: "widget_not_connected" });
    return { status: "ready", bridge: bridge instanceof CoworkerBridge ? bridge.status() : undefined };
  });
  app.get("/v1/models", async (request, reply) => {
    if (!authenticate(request)) return reply.code(401).send({ error: { type: "authentication_error", message: "Invalid API key" } });
    const models = localStore ? localStore.listModels().filter((item) => item.enabled).map((item) => item.id) : (process.env.COWORKER_MODELS ?? "chatgpt-web").split(",").map((id) => id.trim()).filter(Boolean);
    return { object: "list", data: models.map((id) => ({ id, object: "model", owned_by: "coworkerapi" })) };
  });
  app.get("/v1/models/:model", async (request, reply) => {
    if (!authenticate(request)) return reply.code(401).send({ error: { type: "authentication_error", message: "Invalid API key" } });
    const model = String((request.params as { model?: string }).model ?? "");
    const models = localStore ? localStore.listModels().filter((item) => item.enabled).map((item) => item.id) : (process.env.COWORKER_MODELS ?? "chatgpt-web").split(",").map((id) => id.trim()).filter(Boolean);
    if (!models.includes(model)) return reply.code(404).send({ error: { type: "invalid_request_error", message: `Model '${model}' not found` } });
    return { id: model, object: "model", owned_by: "coworkerapi" };
  });
  app.head("/api/hello", async (_request, reply) => reply.code(200).send());
  app.post("/v1/messages/count_tokens", async (request, reply) => {
    if (!authenticate(request)) return reply.code(401).send({ type: "error", error: { type: "authentication_error", message: "Invalid API key" } });
    const parsed = messagesRequestSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ type: "error", error: { type: "invalid_request_error", message: parsed.error.message } });
    // This is deliberately conservative: the ChatGPT upstream does not expose
    // tokenizer accounting through the bridge. Clients use this estimate only
    // for prompt budgeting, while authoritative usage comes from turn events.
    const serialized = JSON.stringify({ system: parsed.data.system, messages: parsed.data.messages, tools: parsed.data.tools });
    return { input_tokens: Math.max(1, Math.ceil(serialized.length / 4)) };
  });
  app.post("/v1/responses", async (request, reply) => {
    if (!authenticate(request)) return reply.code(401).send({ error: { type: "authentication_error", message: "Invalid API key" } });
    const parsed = responseRequestSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: { type: "invalid_request_error", message: parsed.error.message } });
    if (process.env.COWORKER_DIAG_TYPES === "1") {
      const toolTypes = (parsed.data.tools ?? []).map((tool) => {
        if (!tool || typeof tool !== "object") return "invalid";
        const item = tool as Record<string, unknown>;
        return `${String(item.type ?? "unspecified")}:${String(item.name ?? "")}[${Object.keys(item).join(",")}]`;
      });
      console.error(`CoworkerAPI Responses diagnostic: tools=${toolTypes.join(";") || "none"}, stream=${parsed.data.stream}`);
    }
    const controller = clientAbortController(request, reply);
    const timeout = upstreamTimeout(controller, bridge);
    const events = respond(parsed.data, controller.signal, bridgeContext(request));
    if (parsed.data.stream) {
      if (usesWidget(parsed.data.model)) {
        const outcome = await collectWidgetResponse(events);
        clearTimeout(timeout);
        if (outcome.error || !outcome.response) return reply.code(controller.signal.aborted ? 504 : 502).send({ error: { type: controller.signal.aborted ? "upstream_timeout" : outcome.error?.code ?? "upstream_error", message: outcome.error?.message ?? "Bridge ended without a response" } });
        reply.hijack();
        startSse(reply.raw);
        writeWidgetResponsesStream(reply.raw, outcome, parsed.data.model);
        reply.raw.end();
        return;
      }
      reply.hijack();
      startSse(reply.raw);
      for await (const event of events) {
        writeOpenAIEvent(reply.raw, event);
        if (event.type === "response.failed") break;
      }
      reply.raw.end();
      clearTimeout(timeout);
      return;
    }
    let completed: Record<string, unknown> | undefined;
    let outputText = "";
    let failure: { code: string; message: string } | undefined;
    for await (const event of events) {
      if (event.type === "response.completed") completed = event.response;
      if (event.type === "response.output_text.delta") outputText += event.delta;
      if (event.type === "response.failed") failure = event.error;
    }
    clearTimeout(timeout);
    if (controller.signal.aborted) return reply.code(504).send({ error: { type: "upstream_timeout", message: "CoworkerAPI bridge did not complete the request before the timeout." } });
    if (failure) return reply.code(["bridge_disconnected", "profile_unavailable"].includes(failure.code) ? 503 : 502).send({ error: failure });
    return completed ? withOutputText(completed, outputText) : reply.code(502).send({ error: { type: "upstream_error", message: "Bridge ended without a response" } });
  });
  app.post("/v1/chat/completions", async (request, reply) => {
    if (!authenticate(request)) return reply.code(401).send({ error: { type: "authentication_error", message: "Invalid API key" } });
    const parsed = chatCompletionRequestSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: { type: "invalid_request_error", message: parsed.error.message } });
    const controller = clientAbortController(request, reply);
    const timeout = upstreamTimeout(controller, bridge);
    const events = respond(toChatResponseRequest(parsed.data), controller.signal, bridgeContext(request));
    if (parsed.data.stream) {
      if (usesWidget(parsed.data.model)) {
        const outcome = await collectWidgetResponse(events);
        clearTimeout(timeout);
        if (outcome.error || !outcome.response) return reply.code(controller.signal.aborted ? 504 : 502).send({ error: { type: controller.signal.aborted ? "upstream_timeout" : outcome.error?.code ?? "upstream_error", message: outcome.error?.message ?? "Bridge ended without a response" } });
        reply.hijack();
        startSse(reply.raw);
        writeWidgetChatStream(reply.raw, outcome, parsed.data.model);
        reply.raw.end();
        return;
      }
      reply.hijack();
      startSse(reply.raw);
      for await (const event of events) {
        writeChatCompletionEvent(reply.raw, event, parsed.data.model);
        if (event.type === "response.failed" || event.type === "response.completed") break;
      }
      clearTimeout(timeout);
      reply.raw.end();
      return;
    }
    let completed: Record<string, unknown> | undefined;
    let outputText = "";
    let failure: { code: string; message: string } | undefined;
    for await (const event of events) {
      if (event.type === "response.completed") completed = event.response;
      if (event.type === "response.output_text.delta") outputText += event.delta;
      if (event.type === "response.failed") failure = event.error;
    }
    clearTimeout(timeout);
    if (controller.signal.aborted) return reply.code(504).send({ error: { type: "upstream_timeout", message: "CoworkerAPI bridge did not complete the request before the timeout." } });
    if (failure) return reply.code(["bridge_disconnected", "profile_unavailable"].includes(failure.code) ? 503 : 502).send({ error: failure });
    if (!completed) return reply.code(502).send({ error: { type: "upstream_error", message: "Bridge ended without a response" } });
    return toChatCompletion(withOutputText(completed, outputText), parsed.data.model);
  });
  app.post("/v1/messages", async (request, reply) => {
    if (!authenticate(request)) return reply.code(401).send({ type: "error", error: { type: "authentication_error", message: "Invalid API key" } });
    const parsed = messagesRequestSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ type: "error", error: { type: "invalid_request_error", message: parsed.error.message } });
    if (process.env.COWORKER_DIAG_TYPES === "1") {
      const contentLength = (value: unknown): number => typeof value === "string" ? value.length : JSON.stringify(value ?? "").length;
      const messages = parsed.data.messages as Array<{ content?: unknown }>;
      console.error(`CoworkerAPI Messages diagnostic: model=${parsed.data.model}, messages=${messages.length}, input_chars=${messages.reduce((n: number, m) => n + contentLength(m.content), 0)}, system_chars=${contentLength(parsed.data.system)}, tools=${parsed.data.tools?.length ?? 0}, stream=${parsed.data.stream}`);
    }
    const controller = clientAbortController(request, reply);
    const timeout = upstreamTimeout(controller, bridge);
    const events = respond(toResponseRequest(parsed.data), controller.signal, bridgeContext(request));
    if (parsed.data.stream) {
      if (usesWidget(parsed.data.model)) {
        const outcome = await collectWidgetResponse(events);
        clearTimeout(timeout);
        if (outcome.error || !outcome.response) return reply.code(controller.signal.aborted ? 504 : 502).send({ type: "error", error: { type: controller.signal.aborted ? "upstream_timeout" : outcome.error?.code ?? "upstream_error", message: outcome.error?.message ?? "Bridge ended without a response" } });
        reply.hijack();
        startSse(reply.raw);
        writeWidgetAnthropicStream(reply.raw, outcome, parsed.data.model);
        reply.raw.end();
        return;
      }
      reply.hijack();
      startSse(reply.raw);
      const nativeAnthropic = localStore?.listProviders().find(p => p.id === localStore.listModels().find(m => m.id === parsed.data.model)?.provider)?.type === "anthropic";
      if (!nativeAnthropic) writeAnthropicStart(reply.raw, parsed.data.model);
      let completed = false;
      for await (const event of events) {
        writeAnthropicEvent(reply.raw, event, parsed.data.model);
        if (event.type === "response.completed") completed = true;
        if (event.type === "response.failed") break;
      }
      if (!nativeAnthropic && completed) writeAnthropicStop(reply.raw);
      reply.raw.end();
      clearTimeout(timeout);
      return;
    }
    let completed: Record<string, unknown> | undefined;
    let outputText = "";
    let failure: { code: string; message: string } | undefined;
    for await (const event of events) {
      if (event.type === "response.completed") completed = event.response;
      if (event.type === "response.output_text.delta") outputText += event.delta;
      if (event.type === "response.failed") failure = event.error;
    }
    clearTimeout(timeout);
    if (controller.signal.aborted) return reply.code(504).send({ type: "error", error: { type: "upstream_timeout", message: "CoworkerAPI bridge did not complete the request before the timeout." } });
    if (failure) return reply.code(["bridge_disconnected", "profile_unavailable"].includes(failure.code) ? 503 : 502).send({ type: "error", error: failure });
    if (!completed) return reply.code(502).send({ type: "error", error: { type: "api_error", message: "Bridge ended without a response" } });
    return toAnthropicResponse(withOutputText(completed, outputText), parsed.data.model);
  });
  return app;
}

function clientAbortController(request: { raw: { on: (event: string, listener: () => void) => unknown } }, reply: { raw: { on: (event: string, listener: () => void) => unknown; writableEnded: boolean } }): AbortController {
  const controller = new AbortController();
  request.raw.on("aborted", () => controller.abort());
  // IncomingMessage is usually complete before model generation starts, so
  // its "aborted" event does not fire when a CLI disconnects while waiting.
  reply.raw.on("close", () => { if (!reply.raw.writableEnded) controller.abort(); });
  return controller;
}

function upstreamTimeout(controller: AbortController, bridge: ChatGPTBridge): ReturnType<typeof setTimeout> {
  const defaultTimeout = bridge instanceof WidgetBridge ? 300_000 : 120_000;
  const milliseconds = Number(process.env.COWORKER_BRIDGE_TIMEOUT_MS ?? defaultTimeout);
  return setTimeout(() => controller.abort(), Number.isFinite(milliseconds) && milliseconds > 0 ? milliseconds : defaultTimeout);
}

function withOutputText(response: Record<string, unknown>, outputText: string): Record<string, unknown> {
  if (typeof response.output_text === "string" || !outputText) return response;
  return { ...response, output_text: outputText };
}

function header(request: { headers: Record<string, string | string[] | undefined> }, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}
