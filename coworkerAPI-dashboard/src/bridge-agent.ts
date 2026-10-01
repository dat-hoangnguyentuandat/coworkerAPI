import WebSocket from "ws";
import { bridgeEnvelopeSchema, type BridgeEvent, type BridgeContext, type ResponseRequest } from "./protocol.js";

export type TurnHandler = (request: ResponseRequest, context: BridgeContext, signal: AbortSignal) => AsyncIterable<BridgeEvent>;

export type BridgeAgentOptions = {
  url: string;
  secret: string;
  bridgeId: string;
  profileIds?: string[];
  reconnectMs?: number;
};

/**
 * Small client intended for Coworker's Electron main process.
 *
 * It owns transport only. The handler must call Coworker's existing ChatGPT
 * task/profile/MCP pipeline and yield normalized BridgeEvents; this package
 * never reads cookies or executes workspace tools itself.
 */
export class CoworkerBridgeAgent {
  private socket?: WebSocket;
  private stopped = false;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private readonly reconnectMs: number;
  private readonly cancellations = new Map<string, { controller: AbortController; socket: WebSocket }>();

  constructor(private readonly options: BridgeAgentOptions, private readonly handleTurn: TurnHandler) {
    this.reconnectMs = options.reconnectMs ?? 1500;
  }

  start(): void {
    if (this.socket || this.reconnectTimer) return;
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    for (const { controller } of this.cancellations.values()) controller.abort();
    this.cancellations.clear();
    if (this.socket?.readyState === WebSocket.CONNECTING) this.socket.terminate();
    else this.socket?.close(1000, "stopped");
    this.socket = undefined;
  }

  private connect(): void {
    if (this.stopped) return;
    const socket = new WebSocket(this.options.url, { headers: { authorization: `Bearer ${this.options.secret}` } });
    this.socket = socket;
    socket.on("open", () => socket.send(JSON.stringify({ type: "bridge.ready", bridgeId: this.options.bridgeId, profileIds: this.options.profileIds })));
    socket.on("message", (raw) => void this.handleMessage(raw.toString(), socket));
    socket.on("close", () => {
      if (this.socket === socket) this.socket = undefined;
      for (const [requestId, turn] of this.cancellations) {
        if (turn.socket !== socket) continue;
        turn.controller.abort();
        this.cancellations.delete(requestId);
      }
      this.scheduleReconnect();
    });
    socket.on("error", () => socket.terminate());
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => { this.reconnectTimer = undefined; this.connect(); }, this.reconnectMs);
  }

  private async handleMessage(raw: string, socket: WebSocket): Promise<void> {
    let message: ReturnType<typeof bridgeEnvelopeSchema.parse>;
    try { message = bridgeEnvelopeSchema.parse(JSON.parse(raw)); } catch { return; }
    if (message.type === "bridge.ready") return;
    if (message.type === "turn.cancel") {
      const turn = this.cancellations.get(message.requestId);
      if (turn?.socket === socket) turn.controller.abort();
      return;
    }
    if (message.type !== "turn.start") return;
    if (this.cancellations.has(message.requestId)) return;
    const controller = new AbortController();
    this.cancellations.set(message.requestId, { controller, socket });
    let terminal = false;
    try {
      for await (const event of this.handleTurn(message.request, message.context ?? {}, controller.signal)) {
        if (controller.signal.aborted) break;
        this.send(socket, { type: "turn.event", requestId: message.requestId, event });
        if (event.type === "response.completed" || event.type === "response.failed") { terminal = true; break; }
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        terminal = true;
        this.send(socket, { type: "turn.event", requestId: message.requestId, event: { type: "response.failed", error: { code: "coworker_turn_failed", message: error instanceof Error ? error.message : String(error) } } });
      }
    } finally {
      this.cancellations.delete(message.requestId);
      if (!terminal && !controller.signal.aborted) {
        this.send(socket, { type: "turn.event", requestId: message.requestId, event: { type: "response.failed", error: { code: "bridge_incomplete_turn", message: "CoworkerAPI bridge turn ended without a completed or failed event." } } });
      }
    }
  }

  private send(socket: WebSocket, message: unknown): void {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  }
}
