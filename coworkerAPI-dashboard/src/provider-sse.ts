import { ProviderTransportError } from "./provider-transport.js";

export type ProviderSseEvent = { event: string; data: string };

/** Incremental UTF-8 SSE decoding; bounded frames and strict truncated-frame
 * detection so interrupted upstream output cannot become a successful result. */
export async function* providerSseEvents(chunks: AsyncIterable<Uint8Array>, maxFrameBytes = 1024 * 1024): AsyncGenerator<ProviderSseEvent> {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let pending = "";
  let event = "message";
  let data: string[] = [];
  let frameBytes = 0;
  const decode = (bytes?: Uint8Array, stream = false) => {
    try { return decoder.decode(bytes, { stream }); }
    catch { throw new ProviderTransportError("upstream_invalid_utf8", "Provider stream contains invalid UTF-8."); }
  };
  const line = (value: string): ProviderSseEvent | undefined => {
    frameBytes += Buffer.byteLength(value) + 1;
    if (frameBytes > maxFrameBytes) throw new ProviderTransportError("upstream_frame_too_large", "Provider SSE frame exceeds the size limit.");
    if (!value) {
      const result = data.length ? { event, data: data.join("\n") } : undefined;
      event = "message"; data = []; frameBytes = 0; return result;
    }
    if (value.startsWith(":")) return;
    const colon = value.indexOf(":");
    const name = colon < 0 ? value : value.slice(0, colon);
    let field = colon < 0 ? "" : value.slice(colon + 1);
    if (field.startsWith(" ")) field = field.slice(1);
    if (name === "event") event = field;
    else if (name === "data") data.push(field);
  };
  async function* consume(final: boolean): AsyncGenerator<ProviderSseEvent> {
    while (true) {
      const newline = pending.search(/[\r\n]/);
      if (newline < 0 || (!final && newline === pending.length - 1 && pending[newline] === "\r")) break;
      const value = pending.slice(0, newline);
      const width = pending[newline] === "\r" && pending[newline + 1] === "\n" ? 2 : 1;
      pending = pending.slice(newline + width);
      const ready = line(value);
      if (ready) yield ready;
    }
    if (frameBytes + Buffer.byteLength(pending) > maxFrameBytes) throw new ProviderTransportError("upstream_frame_too_large", "Provider SSE frame exceeds the size limit.");
  }
  if (!Number.isSafeInteger(maxFrameBytes) || maxFrameBytes < 1) throw new ProviderTransportError("invalid_frame_limit", "Invalid SSE frame limit.");
  for await (const chunk of chunks) {
    pending += decode(chunk, true);
    yield* consume(false);
  }
  pending += decode();
  yield* consume(true);
  if (pending || data.length) throw new ProviderTransportError("upstream_truncated_frame", "Provider SSE stream ended inside a frame.");
}
