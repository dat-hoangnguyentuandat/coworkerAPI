import { randomUUID } from "node:crypto";
import type { WebSocket } from "ws";
import { bridgeEnvelopeSchema, type BridgeContext, type BridgeEvent, type ChatGPTBridge, type ResponseRequest } from "./protocol.js";

class EventQueue implements AsyncIterable<BridgeEvent> {
  private values: BridgeEvent[] = [];
  private waiters: Array<(result: IteratorResult<BridgeEvent>) => void> = [];
  private ended = false;

  push(value: BridgeEvent): void {
    if (this.ended) return;
    const waiter = this.waiters.shift();
    if (waiter) waiter({ value, done: false });
    else this.values.push(value);
  }

  end(): void {
    this.ended = true;
    for (const waiter of this.waiters.splice(0)) waiter({ value: undefined, done: true });
  }

  async *[Symbol.asyncIterator](): AsyncIterator<BridgeEvent> {
    while (true) {
      if (this.values.length) yield this.values.shift()!;
      else if (this.ended) return;
      else {
        const result = await new Promise<IteratorResult<BridgeEvent>>((resolve) => this.waiters.push(resolve));
        if (result.done) return;
        yield result.value;
      }
    }
  }
}

export class CoworkerBridge implements ChatGPTBridge {
  private readonly sockets = new Map<string, { socket: WebSocket; profileIds: Set<string> }>();
  private defaultBridgeId?: string;
  private pending = new Map<string, { queue: EventQueue; socket: WebSocket; cleanup: () => void }>();

  get connected(): boolean {
    return [...this.sockets.values()].some(({ socket }) => socket.readyState === 1);
  }

  status(): { connected: boolean; bridges: Array<{ bridgeId: string; profileIds: string[]; connected: boolean }> } {
    return {
      connected: this.connected,
      bridges: [...this.sockets.entries()].map(([bridgeId, connection]) => ({ bridgeId, profileIds: [...connection.profileIds], connected: connection.socket.readyState === 1 })),
    };
  }

  attach(socket: WebSocket): void {
    const pendingId = `pending-${randomUUID()}`;
    this.sockets.set(pendingId, { socket, profileIds: new Set() });
    this.defaultBridgeId ??= pendingId;
    socket.on("message", (raw) => this.handleMessage(raw.toString(), socket));
    socket.on("close", () => this.detach(socket));
    socket.on("error", () => this.detach(socket));
  }

  respond(request: ResponseRequest, signal: AbortSignal, context: BridgeContext = {}): AsyncIterable<BridgeEvent> {
    const requestId = randomUUID();
    const queue = new EventQueue();
    const connection = this.selectConnection(context.profileId);
    if (!connection) {
      queue.push({ type: "response.failed", error: { code: context.profileId ? "profile_unavailable" : "bridge_disconnected", message: context.profileId ? `No CoworkerAPI bridge owns profile '${context.profileId}'.` : "CoworkerAPI bridge is not connected." } });
      queue.end();
    } else {
      const onAbort = () => {
        try { connection.socket.send(JSON.stringify({ type: "turn.cancel", requestId })); } catch {}
        queue.push({ type: "response.failed", error: { code: "request_cancelled", message: "Request was cancelled before CoworkerAPI completed the turn." } });
        queue.end();
        this.finish(requestId);
      };
      this.pending.set(requestId, { queue, socket: connection.socket, cleanup: () => signal.removeEventListener("abort", onAbort) });
      signal.addEventListener("abort", onAbort, { once: true });
      try {
        if (signal.aborted) onAbort();
        else connection.socket.send(JSON.stringify({ type: "turn.start", requestId, request, context }));
      } catch {
        queue.push({ type: "response.failed", error: { code: "bridge_send_failed", message: "Could not send turn to CoworkerAPI bridge." } });
        queue.end();
        this.finish(requestId);
      }
    }
    return this.consume(requestId, queue);
  }

  private async *consume(requestId: string, queue: EventQueue): AsyncIterable<BridgeEvent> {
    try {
      for await (const event of queue) {
        yield event;
        if (event.type === "response.completed" || event.type === "response.failed") return;
      }
    } finally {
      const pending = this.pending.get(requestId);
      if (pending) {
        try { pending.socket.send(JSON.stringify({ type: "turn.cancel", requestId })); } catch {}
        this.finish(requestId);
      }
      queue.end();
    }
  }

  private handleMessage(raw: string, sourceSocket: WebSocket): void {
    let envelope: ReturnType<typeof bridgeEnvelopeSchema.parse>;
    try { envelope = bridgeEnvelopeSchema.parse(JSON.parse(raw)); } catch { return; }
    if (envelope.type === "bridge.ready") {
      const existing = this.sockets.get(envelope.bridgeId);
      if (existing && existing.socket !== sourceSocket) {
        sourceSocket.close(1008, "duplicate bridge id");
        return;
      }
      for (const [bridgeId, connection] of this.sockets) {
        if (connection.socket === sourceSocket) this.sockets.delete(bridgeId);
      }
      this.sockets.set(envelope.bridgeId, { socket: sourceSocket, profileIds: new Set(envelope.profileIds ?? []) });
      if (!this.defaultBridgeId || !this.sockets.has(this.defaultBridgeId)) this.defaultBridgeId = envelope.bridgeId;
      return;
    }
    if (envelope.type !== "turn.event") return;
    const pending = this.pending.get(envelope.requestId);
    if (!pending || pending.socket !== sourceSocket) return;
    pending.queue.push(envelope.event);
    if (envelope.event.type === "response.completed" || envelope.event.type === "response.failed") {
      pending.queue.end();
      this.finish(envelope.requestId);
    }
  }

  private detach(socket: WebSocket): void {
    for (const [bridgeId, connection] of this.sockets) {
      if (connection.socket === socket) this.sockets.delete(bridgeId);
    }
    if (this.defaultBridgeId && !this.sockets.has(this.defaultBridgeId)) this.defaultBridgeId = this.sockets.keys().next().value;
    for (const [requestId, pending] of this.pending) {
      if (pending.socket !== socket) continue;
      pending.queue.push({ type: "response.failed", error: { code: "bridge_disconnected", message: "CoworkerAPI bridge disconnected." } });
      pending.queue.end();
      this.finish(requestId);
    }
  }

  private finish(requestId: string): void {
    const pending = this.pending.get(requestId);
    if (!pending) return;
    pending.cleanup();
    this.pending.delete(requestId);
  }

  private selectConnection(profileId?: string): { socket: WebSocket; profileIds: Set<string> } | undefined {
    if (profileId) {
      for (const connection of this.sockets.values()) {
        if (connection.profileIds.has(profileId) && connection.socket.readyState === 1) return connection;
      }
      return undefined;
    }
    const fallback = this.defaultBridgeId ? this.sockets.get(this.defaultBridgeId) : undefined;
    if (fallback?.socket.readyState === 1) return fallback;
    return [...this.sockets.values()].find(({ socket }) => socket.readyState === 1);
  }
}
