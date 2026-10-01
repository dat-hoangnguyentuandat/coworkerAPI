import { createServer, request as forwardRequest } from "node:http";

/** Local test observer. Reports tool descriptors, never credentials or prompts. */
export async function startE2eProxy(base, onRequest) {
  const server = createServer(async (incoming, outgoing) => {
    const parts = [];
    let length = 0;
    for await (const part of incoming) {
      length += part.length;
      if (length > 16 * 1024 * 1024) { outgoing.writeHead(413).end(); return; }
      parts.push(part);
    }
    const body = Buffer.concat(parts);
    try {
      const payload = JSON.parse(body.toString("utf8"));
      const inputs = Array.isArray(payload.input) ? payload.input : [];
      const developerText = inputs.filter((item) => item.role === "developer").flatMap((item) => typeof item.content === "string" ? [item.content] : (item.content ?? []).map((part) => part.text ?? "")).join("\n");
      const toolResults = inputs.filter((item) => item.type === "function_call_output").map((item) => { const output = typeof item.output === "string" ? item.output : JSON.stringify(item.output); return { rejectedByPolicy: /rejected.*policy|blocked by policy/i.test(output), readOnly: /read.only/i.test(output), error: /failed|error/i.test(output) }; });
      onRequest({ path: incoming.url, model: payload.model, stream: payload.stream, permissionHints: [...new Set(developerText.match(/(?:sandbox_mode[^\n]{0,120}|read-only filesystem|workspace-write)/gi) ?? [])], toolResults, tools: (payload.tools ?? []).map((tool) => ({ type: tool.type, name: tool.name ?? tool.function?.name, members: (tool.tools ?? tool.functions ?? []).map((member) => ({ type: member.type, name: member.name ?? member.function?.name })) })) });
    } catch {}
    const target = new URL(incoming.url, base);
    const upstream = forwardRequest(target, { method: incoming.method, headers: { ...incoming.headers, host: target.host } }, (response) => {
      outgoing.writeHead(response.statusCode ?? 502, response.headers);
      response.pipe(outgoing);
    });
    upstream.on("error", () => { if (!outgoing.headersSent) outgoing.writeHead(502); outgoing.end(); });
    outgoing.on("close", () => upstream.destroy());
    upstream.end(body);
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const address = server.address();
  return { base: `http://127.0.0.1:${address.port}`, stop: async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); } };
}
