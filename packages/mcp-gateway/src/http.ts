import { createServer, type IncomingMessage, type Server as HttpServer } from "node:http";
import { randomUUID } from "node:crypto";
import type { Gateway } from "./gateway.js";
import { createGatewayServer } from "./server.js";
import { isRequestAllowed } from "./host-guard.js";

export interface HttpServeOptions {
  readonly gateway: Gateway;
  readonly port?: number;
  /** Loopback by default: the gateway is a local process, not a public service. */
  readonly host?: string;
  readonly path?: string;
  /** Largest request body accepted, guarding against a runaway client. */
  readonly maxRequestBytes?: number;
  /**
   * Extra hostnames permitted in Host and Origin headers. Loopback names are
   * always permitted; anything else must be opted into deliberately.
   */
  readonly allowedHosts?: readonly string[];
}

export interface RunningHttpServer {
  readonly port: number;
  readonly url: string;
  /** Live MCP sessions. Exposed so tests and diagnostics can observe them. */
  readonly sessionCount: () => number;
  close(): Promise<void>;
}

interface Session {
  transport: {
    sessionId?: string;
    handleRequest: (req: IncomingMessage, res: never, body?: unknown) => Promise<void>;
    onclose?: () => void;
  };
  close: () => Promise<void>;
}

async function readBody(request: IncomingMessage, limit: number): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = chunk as Buffer;
    size += buffer.byteLength;
    if (size > limit) throw new Error("request body too large");
    chunks.push(buffer);
  }
  if (size === 0) return undefined;
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

function isInitialize(body: unknown): boolean {
  const messages = Array.isArray(body) ? body : [body];
  return messages.some(
    (message) => (message as { method?: string } | null)?.method === "initialize",
  );
}

/**
 * Serves a gateway over Streamable HTTP.
 *
 * Each MCP session gets its own server and transport instance, keyed by the
 * session id the transport issues. Sharing one instance across clients would
 * make the second client fail with "already initialized" — a defect the official
 * conformance suite catches immediately.
 */
export async function serveHttp(options: HttpServeOptions): Promise<RunningHttpServer> {
  const { StreamableHTTPServerTransport } = await import(
    "@modelcontextprotocol/sdk/server/streamableHttp.js"
  );

  const host = options.host ?? "127.0.0.1";
  const endpoint = options.path ?? "/mcp";
  const maxRequestBytes = options.maxRequestBytes ?? 4 * 1024 * 1024;
  const sessions = new Map<string, Session>();

  async function createSession(): Promise<Session> {
    const server = await createGatewayServer({ gateway: options.gateway });
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sessionId: string) => {
        sessions.set(sessionId, session);
      },
    });
    // The SDK is authored without `exactOptionalPropertyTypes`, so its transports
    // do not structurally satisfy this project's stricter view of the same
    // interface. The cast is confined to this boundary.
    await server.connect(transport as unknown as Parameters<typeof server.connect>[0]);

    const session: Session = {
      transport: transport as unknown as Session["transport"],
      close: async () => {
        await server.close();
      },
    };

    transport.onclose = () => {
      if (transport.sessionId) sessions.delete(transport.sessionId);
    };

    return session;
  }

  const http: HttpServer = createServer((request, response) => {
    void (async () => {
      // DNS-rebinding guard: a page on any origin can reach a loopback port, so
      // Host and Origin are validated before the request is routed at all.
      if (!isRequestAllowed(request.headers, options.allowedHosts ?? [])) {
        response
          .writeHead(403, { "content-type": "application/json" })
          .end(
            JSON.stringify({
              jsonrpc: "2.0",
              error: { code: -32600, message: "Forbidden: invalid Host or Origin header" },
              id: null,
            }),
          );
        return;
      }

      const url = new URL(request.url ?? "/", `http://${request.headers.host ?? host}`);
      if (url.pathname !== endpoint) {
        response.writeHead(404).end();
        return;
      }

      const sessionId = request.headers["mcp-session-id"];
      const existing = typeof sessionId === "string" ? sessions.get(sessionId) : undefined;

      // GET and DELETE carry no body and always belong to an existing session.
      if (request.method !== "POST") {
        if (!existing) {
          response.writeHead(404).end();
          return;
        }
        await existing.transport.handleRequest(request, response as never);
        return;
      }

      let body: unknown;
      try {
        body = await readBody(request, maxRequestBytes);
      } catch {
        response.writeHead(413).end();
        return;
      }

      if (existing) {
        await existing.transport.handleRequest(request, response as never, body);
        return;
      }

      if (!isInitialize(body)) {
        response
          .writeHead(400, { "content-type": "application/json" })
          .end(
            JSON.stringify({
              jsonrpc: "2.0",
              error: { code: -32600, message: "Bad Request: no valid session ID provided" },
              id: null,
            }),
          );
        return;
      }

      const session = await createSession();
      await session.transport.handleRequest(request, response as never, body);
    })().catch(() => {
      if (!response.headersSent) response.writeHead(500).end();
    });
  });

  await new Promise<void>((resolve) => http.listen(options.port ?? 0, host, resolve));
  const address = http.address();
  const port = typeof address === "object" && address ? address.port : (options.port ?? 0);

  return {
    port,
    url: `http://${host}:${port}${endpoint}`,
    sessionCount: () => sessions.size,
    async close() {
      await new Promise<void>((resolve) => http.close(() => resolve()));
      for (const session of sessions.values()) await session.close();
      sessions.clear();
    },
  };
}
