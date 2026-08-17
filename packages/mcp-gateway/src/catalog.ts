import { LeanRigorError } from "@leanrigor/core";
import type { UpstreamClient, UpstreamTool } from "./upstream.js";

export interface CatalogEntry {
  /** Namespaced name: `<upstreamId>.<toolName>`. */
  readonly name: string;
  readonly upstreamId: string;
  readonly toolName: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
}

export interface ToolSummary {
  readonly name: string;
  readonly summary: string;
}

const MAX_SUMMARY_CHARS = 140;

function summarize(description: string): string {
  const oneLine = description.replace(/\s+/g, " ").trim();
  if (oneLine.length <= MAX_SUMMARY_CHARS) return oneLine;
  return `${oneLine.slice(0, MAX_SUMMARY_CHARS - 1).trimEnd()}…`;
}

/**
 * The indexed tool catalog.
 *
 * The point of the catalog is that its *full* form — every description and
 * input schema — never has to enter model context. Search returns names and
 * one-line summaries; a schema is fetched only for a tool the agent has chosen.
 */
export class Catalog {
  readonly #entries = new Map<string, CatalogEntry>();

  get size(): number {
    return this.#entries.size;
  }

  has(name: string): boolean {
    return this.#entries.has(name);
  }

  get(name: string): CatalogEntry | undefined {
    return this.#entries.get(name);
  }

  entries(): CatalogEntry[] {
    return [...this.#entries.values()];
  }

  clear(): void {
    this.#entries.clear();
  }

  /**
   * Adds one upstream's tools.
   *
   * A namespaced collision means two upstreams were configured with the same
   * id. Silently keeping the last one would route a call to the wrong server,
   * so this is an error.
   */
  add(upstreamId: string, tools: readonly UpstreamTool[]): void {
    for (const tool of tools) {
      const name = `${upstreamId}.${tool.name}`;
      const existing = this.#entries.get(name);
      if (existing) {
        throw new LeanRigorError(
          "LR_NAME_COLLISION",
          `tool "${name}" is provided by more than one upstream; give each server a unique id`,
          { details: { tool: name, upstream: upstreamId } },
        );
      }
      this.#entries.set(name, {
        name,
        upstreamId,
        toolName: tool.name,
        description: tool.description ?? "",
        inputSchema: tool.inputSchema,
      });
    }
  }

  /** Serialized size of the whole catalog: the baseline search is measured against. */
  fullSerializedBytes(): number {
    return Buffer.byteLength(
      JSON.stringify(
        this.entries().map((entry) => ({
          name: entry.name,
          description: entry.description,
          inputSchema: entry.inputSchema,
        })),
      ),
      "utf8",
    );
  }

  /**
   * Ranks tools against a query. Exact and prefix name matches outrank
   * description matches, and ties break on name so results are deterministic.
   */
  search(query: string, limit: number): ToolSummary[] {
    const needle = query.trim().toLowerCase();
    const scored: { entry: CatalogEntry; score: number }[] = [];

    for (const entry of this.#entries.values()) {
      const toolName = entry.toolName.toLowerCase();
      const fullName = entry.name.toLowerCase();
      const description = entry.description.toLowerCase();

      let score = 0;
      if (needle === "") score = 1;
      else if (toolName === needle || fullName === needle) score = 100;
      else if (toolName.startsWith(needle)) score = 80;
      else if (toolName.includes(needle)) score = 60;
      else if (fullName.includes(needle)) score = 40;
      else if (description.includes(needle)) score = 20;

      if (score > 0) scored.push({ entry, score });
    }

    return scored
      .sort((a, b) => b.score - a.score || a.entry.name.localeCompare(b.entry.name))
      .slice(0, Math.max(0, limit))
      .map(({ entry }) => ({ name: entry.name, summary: summarize(entry.description) }));
  }
}

/** Reads an upstream's whole tool list, following cursor pagination. */
export async function collectTools(
  upstream: UpstreamClient,
  maxPages = 100,
): Promise<UpstreamTool[]> {
  const tools: UpstreamTool[] = [];
  let cursor: string | undefined;

  for (let page = 0; page < maxPages; page += 1) {
    const response = await upstream.listTools(cursor);
    tools.push(...response.tools);
    if (!response.nextCursor) return tools;
    cursor = response.nextCursor;
  }

  throw new LeanRigorError(
    "LR_LIMIT_EXCEEDED",
    `upstream "${upstream.id}" returned more than ${maxPages} pages of tools`,
    { details: { upstream: upstream.id, maxPages } },
  );
}
