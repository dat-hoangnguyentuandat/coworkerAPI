import type { FastifyInstance } from "fastify";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { createKeyAuthenticator } from "./auth.js";
import type { WorkspaceAgentBridge } from "./workspace-agent.js";

export function registerWorkspaceAgentMcp(app: FastifyInstance, bridge: WorkspaceAgentBridge, secret?: string): void {
  const authenticate = createKeyAuthenticator(secret);
  app.post("/mcp", async (request, reply) => {
    // ChatGPT's plugin connection cannot send an arbitrary static API key.
    // In tunnel mode, the authenticated tunnel-client must be on this host.
    const tunnelMode = process.env.COWORKER_MCP_AUTH_MODE === "tunnel";
    const local = ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(request.raw.socket.remoteAddress ?? "");
    if (!(tunnelMode && local) && !authenticate(request)) return reply.code(401).send({ error: "unauthorized" });
    const server = new McpServer({ name: "coworkerapi-result", version: "0.1.0" }, {
      instructions: "After completing a CoworkerAPI request, call submit_result exactly once with its request_id and your complete final text. Do not include secrets.",
    });
    server.registerTool("submit_result", {
      title: "Return a CoworkerAPI answer",
      description: "Send the complete final text for the request_id supplied by the Workspace Agent trigger back to the waiting API client. Call once after finishing the answer.",
      inputSchema: {
        request_id: z.string().uuid(),
        text: z.string().min(1).max(250_000),
      },
      outputSchema: { status: z.enum(["accepted", "unknown_request"]) },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    }, async ({ request_id, text }) => {
      const status = bridge.submitResult(request_id, text);
      return { structuredContent: { status }, content: [{ type: "text", text: status }] };
    });
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
