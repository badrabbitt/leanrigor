import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { defaultConfig, parseConfig, type LeanRigorConfig } from "@leanrigor/core";
import { Gateway, connectUpstream, serveHttp, serveStdio } from "@leanrigor/mcp-gateway";
import { ResultStore } from "@leanrigor/result-store";
import { TokenLeafEngine } from "@leanrigor/tokenleaf";
import type { CliIo } from "../cli.js";
import { EXIT_FAILURE, EXIT_OK } from "../cli.js";

export interface McpOptions {
  readonly projectDir?: string;
  readonly transport?: "stdio" | "http";
  readonly port?: number;
  /** Resolve immediately after starting; used by tests. */
  readonly detach?: boolean;
}

export async function loadConfig(projectDir: string): Promise<LeanRigorConfig> {
  const configPath = path.join(projectDir, ".leanrigor", "config.json");
  const fallback = defaultConfig(path.join(projectDir, ".leanrigor"), "default");
  try {
    return parseConfig(JSON.parse(await readFile(configPath, "utf8")) as unknown);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    if (error instanceof SyntaxError) return fallback;
    throw error;
  }
}

/**
 * Starts the gateway.
 *
 * On stdio nothing may be written to stdout except protocol frames, so every
 * diagnostic goes to stderr. A stray progress message would corrupt the stream
 * and the host would report an opaque protocol error.
 */
export async function runMcpServe(io: CliIo, options: McpOptions = {}): Promise<number> {
  const projectDir = options.projectDir ?? process.cwd();
  const config = await loadConfig(projectDir);
  const transport = options.transport ?? "stdio";

  const upstreams = [];
  for (const server of config.upstreamServers.filter((entry) => entry.enabled)) {
    try {
      upstreams.push(await connectUpstream(server));
    } catch (error) {
      io.err(`LR_UPSTREAM_UNAVAILABLE: could not connect "${server.id}": ${(error as Error).message}`);
    }
  }

  const gateway = new Gateway({
    upstreams,
    store: new ResultStore({ dataDir: config.dataDir, projectId: config.projectId }),
    engine: new TokenLeafEngine({ dataDir: config.dataDir, projectId: config.projectId }),
    sessionId: randomUUID(),
    maxProjectedResultBytes: config.gateway.maxProjectedResultBytes,
    maxCapturedResultBytes: config.gateway.maxCapturedResultBytes,
    requestTimeoutMs: config.gateway.requestTimeoutMs,
  });

  try {
    await gateway.refreshCatalog();
  } catch (error) {
    io.err(`LR_UPSTREAM_UNAVAILABLE: could not index upstream tools: ${(error as Error).message}`);
    return EXIT_FAILURE;
  }

  if (transport === "http") {
    const running = await serveHttp({
      gateway,
      ...(options.port === undefined ? {} : { port: options.port }),
    });
    io.err(`LeanRigor gateway listening on ${running.url}`);
    io.err(`Indexed ${gateway.catalog.size} upstream tool(s) from ${upstreams.length} server(s).`);
    if (options.detach) {
      await running.close();
      return EXIT_OK;
    }
    await new Promise<void>((resolve) => {
      process.once("SIGINT", resolve);
      process.once("SIGTERM", resolve);
    });
    await running.close();
    return EXIT_OK;
  }

  const stop = await serveStdio(gateway);
  io.err(`LeanRigor gateway ready on stdio; ${gateway.catalog.size} upstream tool(s) indexed.`);
  if (options.detach) {
    await stop();
    return EXIT_OK;
  }
  await new Promise<void>((resolve) => {
    process.once("SIGINT", resolve);
    process.once("SIGTERM", resolve);
  });
  await stop();
  return EXIT_OK;
}
