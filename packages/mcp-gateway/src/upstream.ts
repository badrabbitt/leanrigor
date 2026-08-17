import { LeanRigorError, type UpstreamServer } from "@leanrigor/core";

export interface UpstreamTool {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema: Record<string, unknown>;
}

export interface UpstreamToolResult {
  /** Serialized textual result. Binary content is described, never inlined. */
  readonly text: string;
  readonly isError?: boolean;
}

/**
 * The gateway's view of an upstream MCP server.
 *
 * Keeping this narrow means the gateway can be tested against an in-memory
 * upstream, and a real transport is one adapter rather than a dependency woven
 * through the routing logic.
 */
export interface UpstreamClient {
  readonly id: string;
  listTools(cursor?: string): Promise<{ tools: UpstreamTool[]; nextCursor?: string }>;
  callTool(
    name: string,
    args: unknown,
    options?: { signal?: AbortSignal },
  ): Promise<UpstreamToolResult>;
  onToolListChanged(listener: () => void): void;
  close(): Promise<void>;
}

/**
 * Connects to a configured MCP server using the official SDK.
 *
 * Only explicitly configured commands are launched, and only the environment
 * variables named in `envPassthrough` are forwarded: LeanRigor never discovers
 * servers or hands an upstream the full environment.
 */
export async function connectUpstream(
  config: UpstreamServer,
  env: Record<string, string | undefined> = process.env,
): Promise<UpstreamClient> {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");

  const client = new Client(
    { name: "leanrigor-gateway", version: "0.1.0" },
    { capabilities: {} },
  );

  if (config.transport === "stdio") {
    if (!config.command) {
      throw new LeanRigorError("LR_INVALID_CONFIG", `upstream "${config.id}" has no command`);
    }
    const { StdioClientTransport } = await import(
      "@modelcontextprotocol/sdk/client/stdio.js"
    );
    const forwarded: Record<string, string> = {};
    for (const name of config.envPassthrough) {
      const value = env[name];
      if (value !== undefined) forwarded[name] = value;
    }
    await client.connect(
      new StdioClientTransport({
        command: config.command,
        args: config.args,
        env: forwarded,
      }) as unknown as Parameters<typeof client.connect>[0],
    );
  } else {
    if (!config.url) {
      throw new LeanRigorError("LR_INVALID_CONFIG", `upstream "${config.id}" has no url`);
    }
    const { StreamableHTTPClientTransport } = await import(
      "@modelcontextprotocol/sdk/client/streamableHttp.js"
    );
    // See the note in http.ts: the SDK's optional-property style differs from
    // this project's, so the transport is cast at the boundary.
    await client.connect(
      new StreamableHTTPClientTransport(new URL(config.url)) as unknown as Parameters<
        typeof client.connect
      >[0],
    );
  }

  const listeners: (() => void)[] = [];

  return {
    id: config.id,

    async listTools(cursor?: string) {
      const response = await client.listTools(cursor === undefined ? {} : { cursor });
      return {
        tools: response.tools.map((tool) => ({
          name: tool.name,
          ...(tool.description === undefined ? {} : { description: tool.description }),
          inputSchema: tool.inputSchema as Record<string, unknown>,
        })),
        ...(response.nextCursor === undefined ? {} : { nextCursor: response.nextCursor }),
      };
    },

    async callTool(name, args, options) {
      const response = await client.callTool(
        { name, arguments: (args ?? {}) as Record<string, unknown> },
        undefined,
        options?.signal ? { signal: options.signal } : undefined,
      );
      const content = Array.isArray(response.content) ? response.content : [];
      const text = content
        .map((part) => {
          const typed = part as { type?: string; text?: string; mimeType?: string };
          if (typed.type === "text") return typed.text ?? "";
          // Binary parts are described rather than inlined; their bytes would
          // dwarf the useful signal in model context.
          return `<${typed.type ?? "unknown"} content${typed.mimeType ? ` ${typed.mimeType}` : ""}>`;
        })
        .join("\n");
      return { text, ...(response.isError ? { isError: true } : {}) };
    },

    onToolListChanged(listener) {
      listeners.push(listener);
      client.setNotificationHandler(
        // The SDK validates the shape; the gateway only needs the signal.
        { parse: (value: unknown) => value } as never,
        () => {
          for (const l of listeners) l();
        },
      );
    },

    async close() {
      await client.close();
    },
  };
}
