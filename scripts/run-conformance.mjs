#!/usr/bin/env node
// Runs the official MCP conformance suite against the LeanRigor gateway and
// compares the result to conformance/expected-failures.yaml. Fails on any
// unexpected failure, and on a stale baseline entry that now passes.
import { spawn } from "node:child_process";
import { once } from "node:events";

const PORT = Number(process.env.PORT ?? 8931);
const server = spawn(process.execPath, ["scripts/conformance-server.mjs"], {
  env: { ...process.env, PORT: String(PORT) },
  stdio: ["ignore", "ignore", "pipe"],
});
server.stderr.pipe(process.stderr);

// The server prints its URL on stderr once it is listening.
await Promise.race([once(server.stderr, "data"), new Promise((r) => setTimeout(r, 5000))]);

const suite = spawn(
  "npx",
  [
    "--yes",
    "@modelcontextprotocol/conformance@0.1.16",
    "server",
    "--url",
    `http://127.0.0.1:${PORT}/mcp`,
    "--suite",
    "active",
    "--expected-failures",
    "conformance/expected-failures.yaml",
  ],
  { stdio: "inherit" },
);

const [code] = await once(suite, "exit");
server.kill("SIGTERM");
process.exit(code ?? 1);
