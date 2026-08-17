import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Sink for user-visible output, injected so tests never capture the real console. */
export interface CliIo {
  out: (line: string) => void;
  err: (line: string) => void;
}

const defaultIo: CliIo = {
  out: (line) => console.log(line),
  err: (line) => console.error(line),
};

export const EXIT_OK = 0;
export const EXIT_FAILURE = 1;
export const EXIT_UNAVAILABLE = 2;

export const TAGLINE = "Less context. Full engineering rigor.";

/**
 * Every top-level command is declared up front so `help` and the dispatcher can
 * never drift apart. `implemented: false` commands must fail loudly rather than
 * exit zero, so a partially built CLI cannot be mistaken for a working one.
 */
export interface CommandSpec {
  readonly name: string;
  readonly summary: string;
  readonly implemented: boolean;
}

export const COMMANDS: readonly CommandSpec[] = [
  { name: "init", summary: "Install LeanRigor into a detected coding-agent host", implemented: false },
  { name: "doctor", summary: "Diagnose installation, configuration and permissions", implemented: false },
  { name: "mcp", summary: "Run the context-efficient MCP gateway", implemented: false },
  { name: "benchmark", summary: "Run the quality-adjusted savings benchmark", implemented: false },
  { name: "report", summary: "Show the local session report and share artifacts", implemented: false },
  { name: "skills", summary: "List, install and validate verified skills", implemented: false },
  { name: "telemetry", summary: "Inspect and control opt-in aggregate telemetry", implemented: false },
];

function packageVersion(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  // Resolves from both `src/` (tests) and `dist/` (published build).
  const manifest = JSON.parse(
    readFileSync(path.join(here, "..", "package.json"), "utf8"),
  ) as { version?: string };
  return manifest.version ?? "0.0.0";
}

function renderHelp(): string {
  const width = Math.max(...COMMANDS.map((c) => c.name.length));
  const rows = COMMANDS.map(
    (c) =>
      `  ${c.name.padEnd(width)}  ${c.summary}${c.implemented ? "" : "  (not implemented yet)"}`,
  );
  return [
    `leanrigor — ${TAGLINE}`,
    "",
    "Usage:",
    "  leanrigor <command> [options]",
    "",
    "Commands:",
    ...rows,
    "",
    "Options:",
    "  --version   Print the leanrigor version",
    "  -h, --help  Print this help",
    "",
    "Docs: https://github.com/badrabbitt/leanrigor",
  ].join("\n");
}

/**
 * Dispatches a command line and resolves to a process exit code. It never calls
 * `process.exit` so it stays testable and embeddable.
 */
export async function runCli(argv: string[], io: CliIo = defaultIo): Promise<number> {
  const [first, ...rest] = argv;

  if (first === undefined || first === "help" || first === "-h" || first === "--help") {
    io.out(renderHelp());
    return EXIT_OK;
  }

  if (first === "--version" || first === "-v" || first === "version") {
    io.out(packageVersion());
    return EXIT_OK;
  }

  const command = COMMANDS.find((c) => c.name === first);
  if (!command) {
    io.err(`LR_UNKNOWN_COMMAND: unknown command "${first}".`);
    io.err(`Run "leanrigor help" to list available commands.`);
    return EXIT_UNAVAILABLE;
  }

  if (!command.implemented) {
    io.err(`LR_NOT_IMPLEMENTED: "${command.name}" is not available in this build.`);
    return EXIT_UNAVAILABLE;
  }

  void rest;
  io.err(`LR_NOT_IMPLEMENTED: "${command.name}" has no dispatcher yet.`);
  return EXIT_UNAVAILABLE;
}
