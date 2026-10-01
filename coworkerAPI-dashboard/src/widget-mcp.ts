import type { FastifyInstance } from "fastify";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { createKeyAuthenticator } from "./auth.js";
import { WidgetBridge } from "./widget-bridge.js";
import { WIDGET_HOST_BRIDGE_JS } from "./widget-host-bridge.js";
import { PACKAGE_VERSION } from "./package-version.js";
import { WIDGET_CHAT_POLICY, widgetSubmitNotice } from "./widget-chat-policy.js";

export const WIDGET_URI = "ui://coworkerapi/bridge-v8.html";
export const WIDGET_HTML = `<!doctype html><html><head><meta charset="utf-8"></head><body style="font:13px system-ui;padding:10px"><strong>CoworkerAPI bridge · v8</strong><div id="status">Connecting…</div><script>
${WIDGET_HOST_BRIDGE_JS}
const uuid = value => typeof value === 'string' && /^[a-f0-9-]{36}$/i.test(value);
const chatPolicy = ${JSON.stringify(WIDGET_CHAT_POLICY)};
const saved = window.openai?.widgetState;
const previous = ['bridge-v4','bridge-v5','bridge-v6','bridge-v7','bridge-v8'].includes(saved?.version) ? saved : {};
const widgetId = uuid(previous.widgetId) ? previous.widgetId : crypto.randomUUID();
let running = false;
// A result callback can arrive before the host finishes its conversation turn.
// Keep that local host operation separate from the gateway request lifecycle.
let hostSendsPending = 0;
let activeRequest = uuid(previous.activeRequest) && uuid(previous.leaseId) ? previous.activeRequest : null;
let leaseId = activeRequest ? previous.leaseId : null;
let phase = ['reserved','sending','sent','failed','unknown'].includes(previous.phase) ? previous.phase : 'reserved';
let activePrompt = null;
let sendAttempts = Number.isInteger(previous.attempts) ? Math.max(0, Math.min(3, previous.attempts)) : 0;
let nextAttemptAt = Number.isFinite(previous.nextAttemptAt) ? previous.nextAttemptAt : 0;
let nextReminderAt = Number.isFinite(previous.nextReminderAt) ? previous.nextReminderAt : 0;
let reminders = Number.isInteger(previous.reminders) ? Math.max(0, Math.min(2, previous.reminders)) : 0;
let nextAllowedAt = 0;
const status = document.getElementById('status');
function persist() {
  try { window.openai?.setWidgetState?.({ version:'bridge-v8', widgetId, activeRequest, leaseId, phase, attempts:sendAttempts, nextAttemptAt, nextReminderAt, reminders }); } catch (_) {}
}
function bounded(promise, ms) {
  let timer;
  const deadline = new Promise((_, reject) => { timer = setTimeout(() => { const error = new Error('host_timeout'); error.bridgeTimeout = true; reject(error); }, ms); });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}
async function poll(args={}) { await hostBridgeReady; return bounded(Promise.resolve().then(() => callHostTool('workbench_api_poll', { ...args, runtime_version: 'bridge-v8', widget_id: widgetId, host_transport:hostTransport })), 10000); }
function report(requestId, claimId, delivery, failureStage) { return poll({ active_request_id:requestId, claim_lease_id:claimId, ...(delivery ? {delivery} : {}), ...(failureStage ? {failure_stage:failureStage} : {}) }); }
function clearActive() {
  activeRequest = null; leaseId = null; activePrompt = null; phase = 'reserved'; sendAttempts = 0; reminders = 0;
  nextAllowedAt = Date.now() + 6000; persist();
}
async function sendActive() {
  const requestId = activeRequest, claimId = leaseId;
  const basePrompt = activePrompt || 'CoworkerAPI request_id=' + requestId + '. FIRST call workbench_api_read_request to obtain the complete payload; then return workbench_api_submit for this request. Do not execute local tools.';
  const prompt = basePrompt.includes(chatPolicy) ? basePrompt : basePrompt + ' ' + chatPolicy;
  // Persist uncertainty before awaiting the ack: rerenders must never blindly resend.
  phase = 'sending'; sendAttempts++; nextAttemptAt = Date.now() + 30000; persist();
  const ack = (await report(requestId, claimId, 'send_started'))?.structuredContent;
  if (!ack?.active_pending) { clearActive(); return; }
  if (!ack.delivery_permitted) { phase = ack.delivery_state || 'unknown'; persist(); return; }
  void report(requestId, claimId, 'ack_seen').catch(() => {});
  let host, synchronousFailure = false;
  hostSendsPending++;
  try { host = Promise.resolve(window.openai.sendFollowUpMessage({ prompt, scrollToBottom:false })); }
  catch (error) { synchronousFailure = true; host = Promise.reject(error); }
  void report(requestId, claimId, 'host_invoked').catch(() => {});
  // A late successful completion may confirm delivery, but must not touch a new turn.
  host.then(() => {
    hostSendsPending--;
    if (activeRequest !== requestId || leaseId !== claimId) return;
    phase = 'sent'; nextReminderAt = Date.now() + 60000; persist();
    void report(requestId, claimId, 'sent').catch(() => {});
  }, () => { hostSendsPending--; });
  // The host may resolve only after generation. Never hold the poll loop while
  // awaiting that promise; its outcome handler is tied to this exact lease.
  void (async () => { try {
    await bounded(host, 20000);
    if (activeRequest !== requestId || leaseId !== claimId) return;
    status.textContent = 'Request sent. Waiting for the MCP result callback.';
  } catch (error) {
    if (activeRequest !== requestId || leaseId !== claimId) return;
    phase = 'unknown'; persist();
    // Report only a fixed stage enum, never exception text, prompts or credentials.
    const failureStage = error?.bridgeTimeout ? 'deadline' : synchronousFailure ? 'sync_throw' : 'async_reject';
    try { await report(requestId, claimId, error?.bridgeTimeout ? 'send_unknown' : 'send_failed', failureStage); } catch (_) {}
    if (activeRequest !== requestId || leaseId !== claimId) return;
    status.textContent = 'Delivery not confirmed. Waiting for callback; no automatic resend.';
  } })().catch(() => {});
}
async function remind() {
  const requestId = activeRequest, claimId = leaseId;
  const permission = (await report(requestId, claimId, 'reminder'))?.structuredContent;
  if (!permission?.active_pending) { clearActive(); return; }
  if (!permission.delivery_permitted || activeRequest !== requestId || leaseId !== claimId) return;
  reminders++; nextReminderAt = Date.now() + 60000; persist();
  void bounded(Promise.resolve().then(() => window.openai.sendFollowUpMessage({ prompt:'Bridge reminder: for request_id=' + requestId + ', read workbench_api_read_request if needed, then call workbench_api_submit. Do not answer only in chat or call workbench_api_activate. ' + chatPolicy, scrollToBottom:false })), 20000).catch(() => {});
}
async function loop() {
  if (running) return;
  running = true;
  try {
    if (!hostCanCallTools() || typeof window.openai?.sendFollowUpMessage !== 'function') { status.textContent = 'This ChatGPT surface does not expose the required MCP App APIs.'; return; }
    if (!activeRequest && hostSendsPending > 0) { status.textContent = 'Previous ChatGPT send is still pending. No overlapping dispatch.'; return; }
    if (!activeRequest && Date.now() < nextAllowedAt) return;
    const result = await (activeRequest ? report(activeRequest, leaseId) : poll());
    const data = result?.structuredContent;
    if (!data || result.isError) throw new Error('invalid_poll');
    if (data.upgrade_required) { status.textContent = 'Open the bridge again to upgrade this widget.'; return; }
    if (activeRequest) {
      if (!data.active_pending) { clearActive(); status.textContent = 'Previous request finished. Waiting briefly.'; return; }
      // Local successful delivery wins over a lost telemetry ack (server still sending).
      if (phase !== 'sent' || data.delivery_state !== 'sending') phase = data.delivery_state || phase;
      persist();
      if (['reserved','failed'].includes(phase) && sendAttempts < 3 && Date.now() >= nextAttemptAt) await sendActive();
      else if (phase === 'sent' && reminders < 2 && Date.now() >= nextReminderAt) await remind();
      else status.textContent = phase === 'unknown'
        ? 'Delivery not confirmed. Waiting for callback; no automatic resend.'
        : 'Waiting for ChatGPT to return the current API request…';
      return;
    }
    const turn = data.turn;
    if (turn?.prompt && uuid(turn.request_id) && uuid(turn.claim_lease_id)) {
      activeRequest = turn.request_id; leaseId = turn.claim_lease_id; activePrompt = turn.prompt;
      phase = turn.delivery_state || 'unknown'; sendAttempts = 0; reminders = 0; nextAttemptAt = 0; nextReminderAt = Date.now() + 60000;
      persist();
      if (['reserved','failed'].includes(phase)) await sendActive();
    } else status.textContent = 'Ready. Waiting for an API request.';
  } catch (_) { status.textContent = 'Bridge temporarily unavailable. Retrying the status check.'; }
  // Keep the bridge responsive while an API client is issuing tool-loop
  // turns. This only affects the widget's lightweight status poll; inference
  // and ChatGPT generation remain fully serialized by the active lease.
  finally { running = false; setTimeout(loop, 750); }
}
persist();
async function heartbeatLoop() {
  try { if (hostCanCallTools() && typeof window.openai?.sendFollowUpMessage === 'function') await poll({ heartbeat_only:true }); } catch (_) {}
  finally { setTimeout(heartbeatLoop, 3000); }
}
setTimeout(heartbeatLoop, 4500);
setTimeout(loop, 500);
</script></body></html>`;

export function registerWidgetTools(server: McpServer, bridge: WidgetBridge): void {
  // Old tool descriptors can retain a resource URI after an upgrade. Serve the
  // current implementation at those URIs too; never strand a retained chat.
  // Observed in live ChatGPT resources/read after migration from Coworker.
  const retainedCoworkerUri = "ui://coworker/api-bridge-v3.html";
  for (const [index, uri] of [WIDGET_URI, "ui://coworkerapi/bridge-v7.html", "ui://coworkerapi/bridge-v6.html", "ui://coworkerapi/bridge-v5.html", "ui://coworkerapi/bridge-v4.html", "ui://coworkerapi/bridge-v3.html", "ui://coworkerapi/bridge-v2.html", "ui://coworkerapi/bridge-v1.html", retainedCoworkerUri].entries()) {
  server.registerResource(`coworkerapi-bridge-${index}`, uri, {}, async () => {
    bridge.recordResourceRead(uri);
    return {
    contents: [{ uri, mimeType: "text/html;profile=mcp-app", text: WIDGET_HTML, _meta: { ui: { prefersBorder: true } } }],
    };
  });
  }
  server.registerTool("workbench_api_activate", {
    title: "Open CoworkerAPI bridge",
    description: "Open the CoworkerAPI bridge widget in this ChatGPT conversation. It waits for API requests from coding tools and sends them here through the supported MCP App message API. " + WIDGET_CHAT_POLICY,
    inputSchema: {},
    _meta: { ui: { resourceUri: WIDGET_URI }, "openai/outputTemplate": WIDGET_URI },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }, async () => {
    bridge.recordActivation();
    return { content: [{ type: "text", text: "CoworkerAPI bridge v8 widget requested. Wait for the dashboard to confirm its heartbeat; this tool result alone does not prove connection. Keep this conversation open while using API clients. Do not post setup narration or claim Thành công from this opening acknowledgement. " + WIDGET_CHAT_POLICY }], structuredContent: { status: "opening", widget_runtime: "bridge-v8" } };
  });
  server.registerTool("workbench_api_poll", {
    title: "Claim next CoworkerAPI request",
    description: "Used by the CoworkerAPI bridge widget to take one pending request. Do not call directly unless running the bridge.",
    inputSchema: { active_request_id: z.string().uuid().optional(), runtime_version: z.enum(["bridge-v3", "bridge-v4", "bridge-v5", "bridge-v6", "bridge-v7", "bridge-v8"]).optional(), widget_id: z.string().uuid().optional(), claim_lease_id: z.string().uuid().optional(), heartbeat_only: z.boolean().optional(), delivery: z.enum(["sent", "send_failed", "send_unknown", "reminder", "send_started", "ack_seen", "host_invoked"]).optional(), failure_stage: z.enum(["sync_throw", "async_reject", "deadline"]).optional(), host_transport: z.enum(["mcp-apps", "openai-alias"]).optional() },
    outputSchema: { turn: z.object({ request_id: z.string().uuid(), prompt: z.string(), claim_lease_id: z.string().uuid().optional(), delivery_state: z.string().optional() }).nullable(), active_pending: z.boolean(), delivery_permitted: z.boolean().optional(), delivery_state: z.string().optional(), upgrade_required: z.boolean().optional() },
    _meta: { ui: { visibility: ["app"] } },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }, async ({ active_request_id, delivery, runtime_version, widget_id, claim_lease_id, heartbeat_only, failure_stage, host_transport }) => {
    if (!["bridge-v5", "bridge-v6", "bridge-v7", "bridge-v8"].includes(runtime_version ?? "") || !widget_id) return { structuredContent: { turn: null, active_pending: false, upgrade_required: true }, content: [{ type: "text", text: "Open workbench_api_activate again to load bridge-v8 before using API clients." }] };
    bridge.recordHostTransport(host_transport);
    if (heartbeat_only) {
      bridge.heartbeat(runtime_version);
      return { structuredContent: { turn: null, active_pending: false }, content: [{ type: "text", text: "Widget heartbeat checked; no request was claimed or dispatched." }] };
    }
    if (active_request_id) {
      bridge.heartbeat(runtime_version);
      const state = claim_lease_id ? bridge.leasedStatus(active_request_id, widget_id, claim_lease_id, delivery, failure_stage) : { active_pending: false, delivery_permitted: false };
      return { structuredContent: { turn: null, ...state }, content: [{ type: "text", text: "Active lease checked." }] };
    }
    const turn = bridge.claim(runtime_version, widget_id);
    return { structuredContent: { turn, active_pending: false }, content: [{ type: "text", text: turn ? "Claimed one API request." : "No pending API request." }] };
  });
  server.registerTool("workbench_api_read_request", {
    title: "Read a large CoworkerAPI request",
    description: "When a CoworkerAPI bridge follow-up says the request is large, call this with its request_id to obtain the complete original request, including instructions, messages, and client-owned tools. Then call workbench_api_submit. Never execute local-action tools for this request.",
    inputSchema: { request_id: z.string().uuid() },
    outputSchema: { request_id: z.string().uuid(), prompt: z.string() },
    _meta: { ui: { visibility: ["model"] } },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }, async ({ request_id }) => {
    const prompt = bridge.readRequest(request_id);
    if (prompt === null) return { isError: true, content: [{ type: "text", text: "Request no longer pending." }] };
    // Keep the complete request visible to hosts that project only TextContent
    // to the model. structuredContent remains available to widget consumers.
    return { structuredContent: { request_id, prompt }, content: [{ type: "text", text: prompt }] };
  });
  server.registerTool("workbench_api_submit", {
    title: "Return an answer to CoworkerAPI",
    description: "REQUIRED FINAL STEP for every CoworkerAPI request. Call exactly once with its request_id and either complete final text or client-owned function tool_calls [{name,arguments}]. The API client executes returned tool calls. A normal chat answer is not returned to the API client. " + WIDGET_CHAT_POLICY,
    inputSchema: { request_id: z.string().uuid(), text: z.string().min(1).max(250_000).optional(), tool_calls: z.array(z.object({ name: z.string().min(1), arguments: z.record(z.string(), z.unknown()) })).min(1).max(16).optional() },
    outputSchema: { status: z.enum(["accepted", "unknown_request", "invalid_result", "cancelled"]) },
    _meta: { ui: { visibility: ["model", "app"] }, "openai/toolInvocation/invoking": "Đang gửi…", "openai/toolInvocation/invoked": "Đã xử lý" },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  }, async ({ request_id, text, tool_calls }) => {
    const status = await bridge.submit(request_id, { text, toolCalls: tool_calls });
    return { structuredContent: { status }, content: [{ type: "text", text: widgetSubmitNotice(status, Boolean(tool_calls?.length)) }] };
  });
}

export function registerWidgetMcp(app: FastifyInstance, bridge: WidgetBridge, secret: string): void {
  const authenticate = createKeyAuthenticator(secret);
  app.post("/mcp", async (request, reply) => {
    if (!authenticate(request)) return reply.code(401).send({ error: "unauthorized" });
    const rpc = request.body as { method?: unknown; params?: { uri?: unknown } } | undefined;
    bridge.recordMcpRequest(rpc?.method, rpc?.params?.uri);
    const server = new McpServer({ name: "coworkerapi", version: PACKAGE_VERSION }, {
      capabilities: { tools: { listChanged: true } },
      instructions: "CoworkerAPI is an API bridge. After each client request, return the result with workbench_api_submit, not only a chat response. For large requests, call workbench_api_read_request first. Do not run local-action tools for an API client request. " + WIDGET_CHAT_POLICY,
    });
    registerWidgetTools(server, bridge);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await server.connect(transport);
    reply.hijack();
    try {
      await transport.handleRequest(request.raw, reply.raw, request.body);
    } catch {
      if (!reply.raw.headersSent) reply.raw.writeHead(500).end();
      else reply.raw.end();
    } finally {
      await server.close();
    }
  });
}
