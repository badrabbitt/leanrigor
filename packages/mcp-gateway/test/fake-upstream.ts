import type { UpstreamClient, UpstreamTool, UpstreamToolResult } from "../src/upstream.js";

export interface FakeUpstreamOptions {
  readonly id: string;
  readonly toolCount?: number;
  /** Page size for `listTools`, exercising cursor pagination. */
  readonly pageSize?: number;
  /** Milliseconds a call takes, so timeout and cancellation are testable. */
  readonly callDelayMs?: number;
}

export function bigJsonPayload(targetBytes = 2 * 1024 * 1024): string {
  const items: unknown[] = [];
  let size = 2;
  let index = 0;
  while (size < targetBytes) {
    const item = {
      number: index + 1,
      title: `Issue ${index + 1}`,
      state: index < 19 ? "open" : "closed",
      labels: index % 100 === 0 ? ["security"] : [],
      body: "y".repeat(300),
      user: { login: `user-${index}`, id: index },
    };
    items.push(item);
    size += JSON.stringify(item).length + 1;
    index += 1;
  }
  return JSON.stringify(items);
}

/**
 * In-memory MCP upstream used by the gateway tests.
 *
 * It exposes a realistic tool catalog, cursor pagination, a two-mebibyte JSON
 * result and a list-changed notification, so gateway behaviour can be tested
 * without spawning a process.
 */
export class FakeUpstream implements UpstreamClient {
  readonly id: string;
  readonly calls: { name: string; args: unknown }[] = [];

  #tools: UpstreamTool[];
  readonly #pageSize: number;
  readonly #callDelayMs: number;
  #listeners: (() => void)[] = [];
  closed = false;

  constructor(options: FakeUpstreamOptions) {
    this.id = options.id;
    this.#pageSize = options.pageSize ?? 20;
    this.#callDelayMs = options.callDelayMs ?? 0;
    const count = options.toolCount ?? 50;
    this.#tools = Array.from({ length: count }, (_, i) => ({
      name: `tool_${i}`,
      description:
        `Tool number ${i}. `
        + "This description is long on purpose so the catalog costs real bytes. ".repeat(4),
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "A search query with a long description." },
          limit: { type: "number", description: "How many results to return." },
          filters: {
            type: "object",
            properties: { state: { type: "string" }, label: { type: "string" } },
          },
        },
        required: ["query"],
      },
    }));
    // A recognisable tool the search tests can look for by name.
    this.#tools[3] = {
      name: "list_issues",
      description: "List repository issues, optionally filtered by state and label.",
      inputSchema: {
        type: "object",
        properties: { state: { type: "string" }, label: { type: "string" } },
      },
    };
  }

  async listTools(cursor?: string): Promise<{ tools: UpstreamTool[]; nextCursor?: string }> {
    const start = cursor ? Number.parseInt(cursor, 10) : 0;
    const page = this.#tools.slice(start, start + this.#pageSize);
    const next = start + this.#pageSize;
    return next < this.#tools.length
      ? { tools: page, nextCursor: String(next) }
      : { tools: page };
  }

  async callTool(
    name: string,
    args: unknown,
    options: { signal?: AbortSignal } = {},
  ): Promise<UpstreamToolResult> {
    this.calls.push({ name, args });

    // A real transport rejects immediately on an already-aborted signal; the
    // fake must too, or cancellation looks like it silently succeeded.
    if (options.signal?.aborted) throw new Error("aborted");

    if (this.#callDelayMs > 0) {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, this.#callDelayMs);
        options.signal?.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(new Error("aborted"));
        });
      });
    }

    if (!this.#tools.some((tool) => tool.name === name)) {
      return { text: `unknown tool ${name}`, isError: true };
    }
    if (name === "list_issues") return { text: bigJsonPayload() };
    if (name === "tool_7") return { text: "line a\nline b\nERROR boom\n" };
    return { text: JSON.stringify({ tool: name, args }) };
  }

  onToolListChanged(listener: () => void): void {
    this.#listeners.push(listener);
  }

  /** Simulates an upstream announcing a changed tool list. */
  emitToolListChanged(extra: UpstreamTool[]): void {
    this.#tools = [...this.#tools, ...extra];
    for (const listener of this.#listeners) listener();
  }

  async close(): Promise<void> {
    this.closed = true;
    this.#listeners = [];
  }
}
