import { randomUUID } from "node:crypto";
import { LeanRigorError } from "@leanrigor/core";
import {
  DiffProjector,
  JsonProjector,
  LogProjector,
  ResultStore,
  TextProjector,
  type ProjectionBudget,
  type ProjectionInput,
  type ProjectionResult,
  type Projector,
} from "@leanrigor/result-store";
import type { TokenLeafEngine } from "@leanrigor/tokenleaf";
import { Catalog, collectTools, type CatalogEntry, type ToolSummary } from "./catalog.js";
import type { UpstreamClient } from "./upstream.js";

export interface GatewayOptions {
  readonly upstreams: readonly UpstreamClient[];
  readonly store: ResultStore;
  readonly engine: TokenLeafEngine;
  readonly sessionId: string;
  /** Ceiling for any view returned to the model. */
  readonly maxProjectedResultBytes?: number;
  /** Largest upstream result LeanRigor will store. */
  readonly maxCapturedResultBytes?: number;
  readonly maxArgumentBytes?: number;
  readonly requestTimeoutMs?: number;
  /** When set, only these upstream ids may be invoked. */
  readonly allowedUpstreams?: readonly string[];
  readonly projectors?: readonly Projector[];
}

export interface SearchToolsInput {
  readonly query: string;
  readonly limit?: number;
}

export interface SearchToolsOutput {
  readonly tools: readonly ToolSummary[];
  readonly totalMatched: number;
  readonly bytes: { readonly baseline: number; readonly optimized: number };
}

export interface InvokeToolInput {
  readonly tool: string;
  readonly arguments?: unknown;
}

export interface InvokeToolOutput {
  readonly handle: string;
  readonly summary: string;
  readonly schema: string;
  readonly projector: string;
  readonly lossPolicy: ProjectionResult["lossPolicy"];
  readonly view: string;
  readonly availableViews: readonly string[];
  readonly isError: boolean;
  readonly bytes: { readonly baseline: number; readonly optimized: number };
}

export interface FetchResultInput {
  readonly handle: string;
  readonly page?: number;
  readonly pageSize?: number;
  readonly fields?: readonly string[];
}

const DEFAULTS = {
  maxProjectedResultBytes: 16 * 1024,
  maxCapturedResultBytes: 64 * 1024 * 1024,
  maxArgumentBytes: 256 * 1024,
  requestTimeoutMs: 60_000,
} as const;

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * The context-efficient MCP gateway.
 *
 * It sits between a coding-agent host and its upstream MCP servers and changes
 * what reaches model context in two ways: tool schemas are searched instead of
 * broadcast, and large results are stored locally and returned as a compact,
 * handle-backed projection. Nothing is destroyed — every projection carries the
 * handle that restores the original.
 */
export class Gateway {
  readonly catalog = new Catalog();

  readonly #upstreams: Map<string, UpstreamClient>;
  readonly #store: ResultStore;
  readonly #engine: TokenLeafEngine;
  readonly #sessionId: string;
  readonly #maxProjected: number;
  readonly #maxCaptured: number;
  readonly #maxArgumentBytes: number;
  readonly #timeoutMs: number;
  readonly #allowed: ReadonlySet<string> | undefined;
  readonly #projectors: readonly Projector[];
  #pending: Promise<unknown> = Promise.resolve();

  constructor(options: GatewayOptions) {
    this.#upstreams = new Map(options.upstreams.map((upstream) => [upstream.id, upstream]));
    this.#store = options.store;
    this.#engine = options.engine;
    this.#sessionId = options.sessionId;
    this.#maxProjected = options.maxProjectedResultBytes ?? DEFAULTS.maxProjectedResultBytes;
    this.#maxCaptured = options.maxCapturedResultBytes ?? DEFAULTS.maxCapturedResultBytes;
    this.#maxArgumentBytes = options.maxArgumentBytes ?? DEFAULTS.maxArgumentBytes;
    this.#timeoutMs = options.requestTimeoutMs ?? DEFAULTS.requestTimeoutMs;
    this.#allowed = options.allowedUpstreams ? new Set(options.allowedUpstreams) : undefined;
    this.#projectors = options.projectors ?? [
      new DiffProjector(),
      new JsonProjector(),
      new LogProjector(),
      new TextProjector(),
    ];

    // Two upstreams sharing an id would make namespacing meaningless.
    if (this.#upstreams.size !== options.upstreams.length) {
      const seen = new Set<string>();
      for (const upstream of options.upstreams) {
        if (seen.has(upstream.id)) {
          throw new LeanRigorError(
            "LR_NAME_COLLISION",
            `two upstreams share the id "${upstream.id}"`,
            { details: { upstream: upstream.id } },
          );
        }
        seen.add(upstream.id);
      }
    }

    for (const upstream of options.upstreams) {
      upstream.onToolListChanged(() => {
        this.#pending = this.#pending.then(() => this.refreshCatalog()).catch(() => undefined);
      });
    }
  }

  /** Waits for background reindexing triggered by upstream notifications. */
  async settle(): Promise<void> {
    await this.#pending;
  }

  async refreshCatalog(): Promise<void> {
    const next = new Catalog();
    for (const upstream of this.#upstreams.values()) {
      next.add(upstream.id, await collectTools(upstream));
    }
    this.catalog.clear();
    for (const entry of next.entries()) {
      this.catalog.add(entry.upstreamId, [
        {
          name: entry.toolName,
          ...(entry.description === "" ? {} : { description: entry.description }),
          inputSchema: entry.inputSchema,
        },
      ]);
    }
  }

  async #record(
    operation: "tool-schema" | "tool-result",
    baselineBytes: number,
    optimizedBytes: number,
  ): Promise<void> {
    await this.#engine.record({
      eventId: randomUUID(),
      sessionId: this.#sessionId,
      operation,
      baselineBytes,
      optimizedBytes,
      measurementMode: "byte-only",
      createdAt: nowIso(),
    });
  }

  async searchTools(input: SearchToolsInput): Promise<SearchToolsOutput> {
    const limit = Math.min(Math.max(1, input.limit ?? 10), 50);
    const tools = this.catalog.search(input.query, limit);

    const baseline = this.catalog.fullSerializedBytes();
    const optimized = Buffer.byteLength(JSON.stringify(tools), "utf8");
    await this.#record("tool-schema", baseline, optimized);

    return {
      tools,
      totalMatched: this.catalog.search(input.query, Number.MAX_SAFE_INTEGER).length,
      bytes: { baseline, optimized },
    };
  }

  /** Returns one tool's full schema. Only requested tools cost schema context. */
  async describeTool(name: string): Promise<CatalogEntry> {
    const entry = this.catalog.get(name);
    if (!entry) {
      throw new LeanRigorError("LR_UNKNOWN_COMMAND", `no tool named "${name}" in the catalog`, {
        details: { tool: name },
      });
    }
    return entry;
  }

  #selectProjector(input: ProjectionInput): Projector {
    for (const projector of this.#projectors) {
      if (projector.supports(input)) return projector;
    }
    return new TextProjector();
  }

  async invokeTool(input: InvokeToolInput, signal?: AbortSignal): Promise<InvokeToolOutput> {
    const entry = await this.describeTool(input.tool);

    if (this.#allowed && !this.#allowed.has(entry.upstreamId)) {
      throw new LeanRigorError(
        "LR_UPSTREAM_UNAVAILABLE",
        `upstream "${entry.upstreamId}" is not in the configured allowlist`,
        { details: { upstream: entry.upstreamId } },
      );
    }

    const serializedArgs = JSON.stringify(input.arguments ?? {});
    const argBytes = Buffer.byteLength(serializedArgs, "utf8");
    if (argBytes > this.#maxArgumentBytes) {
      throw new LeanRigorError(
        "LR_LIMIT_EXCEEDED",
        `arguments are ${argBytes} bytes, above the ${this.#maxArgumentBytes} byte limit`,
        { details: { bytes: argBytes, limit: this.#maxArgumentBytes } },
      );
    }

    const upstream = this.#upstreams.get(entry.upstreamId);
    if (!upstream) {
      throw new LeanRigorError(
        "LR_UPSTREAM_UNAVAILABLE",
        `upstream "${entry.upstreamId}" is not connected`,
        { details: { upstream: entry.upstreamId } },
      );
    }

    const controller = new AbortController();
    const onAbort = () => controller.abort();
    signal?.addEventListener("abort", onAbort, { once: true });
    // The caller may have aborted while the checks above were running; a
    // listener attached after the fact would never fire.
    if (signal?.aborted) controller.abort();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.#timeoutMs);

    let result: Awaited<ReturnType<UpstreamClient["callTool"]>>;
    try {
      result = await upstream.callTool(entry.toolName, input.arguments ?? {}, {
        signal: controller.signal,
      });
    } catch (error) {
      if (timedOut) {
        throw new LeanRigorError(
          "LR_UPSTREAM_TIMEOUT",
          `"${input.tool}" did not respond within ${this.#timeoutMs} ms`,
          { details: { tool: input.tool, timeoutMs: this.#timeoutMs } },
        );
      }
      throw new LeanRigorError("LR_UPSTREAM_UNAVAILABLE", `"${input.tool}" failed`, {
        details: { tool: input.tool, reason: error instanceof Error ? error.name : "unknown" },
      });
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }

    const bytes = Buffer.from(result.text, "utf8");
    if (bytes.byteLength > this.#maxCaptured) {
      throw new LeanRigorError(
        "LR_LIMIT_EXCEEDED",
        `"${input.tool}" returned ${bytes.byteLength} bytes, above the ${this.#maxCaptured} byte capture limit`,
        { details: { tool: input.tool, bytes: bytes.byteLength, limit: this.#maxCaptured } },
      );
    }

    const stored = await this.#store.put(bytes, { schema: entry.name });
    const projection = this.#project({ bytes, handle: stored.handle, schema: entry.name }, {
      maxBytes: this.#maxProjected,
    });

    await this.#record("tool-result", bytes.byteLength, projection.bytes.optimized);

    return {
      handle: stored.handle,
      summary: projection.summary,
      schema: entry.name,
      projector: projection.projector,
      lossPolicy: projection.lossPolicy,
      view: projection.view,
      availableViews: projection.availableViews,
      isError: result.isError ?? false,
      bytes: projection.bytes,
    };
  }

  #project(input: ProjectionInput, budget: ProjectionBudget): ProjectionResult {
    return this.#selectProjector(input).project(input, budget);
  }

  /** Re-projects a stored result: another view of data already on disk. */
  async fetchResult(input: FetchResultInput): Promise<ProjectionResult> {
    const bytes = await this.#store.get(input.handle);
    const metadata = await this.#store.metadata(input.handle);
    const projectionInput: ProjectionInput = {
      bytes,
      handle: metadata.handle,
      schema: metadata.schema,
    };
    return this.#project(projectionInput, {
      maxBytes: this.#maxProjected,
      ...(input.page === undefined ? {} : { page: input.page }),
      ...(input.pageSize === undefined ? {} : { pageSize: input.pageSize }),
      ...(input.fields === undefined ? {} : { fields: input.fields }),
    });
  }

  async close(): Promise<void> {
    for (const upstream of this.#upstreams.values()) await upstream.close();
  }
}
