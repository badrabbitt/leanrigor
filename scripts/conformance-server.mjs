#!/usr/bin/env node
// Serves a LeanRigor gateway over Streamable HTTP for the official MCP
// conformance suite. It connects to no upstreams: the suite exercises
// LeanRigor's own protocol surface, not a third-party server's.
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ResultStore } from "@leanrigor/result-store";
import { TokenLeafEngine } from "@leanrigor/tokenleaf";
import { Gateway, serveHttp } from "@leanrigor/mcp-gateway";

const dir = await mkdtemp(path.join(tmpdir(), "leanrigor-conformance-"));
const gateway = new Gateway({
  upstreams: [],
  store: new ResultStore({ dataDir: dir, projectId: "conformance" }),
  engine: new TokenLeafEngine({ dataDir: dir, projectId: "conformance" }),
  sessionId: "conformance",
});
const running = await serveHttp({ gateway, port: Number(process.env.PORT ?? 8931) });
process.stderr.write(`${running.url}\n`);
process.on("SIGTERM", () => void running.close().then(() => process.exit(0)));
process.on("SIGINT", () => void running.close().then(() => process.exit(0)));
