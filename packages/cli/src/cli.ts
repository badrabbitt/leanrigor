import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { flagAsBoolean, flagAsList, parseFlags } from "./flags.js";

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
  { name: "init", summary: "Install LeanRigor into a detected coding-agent host", implemented: true },
  { name: "doctor", summary: "Diagnose installation, configuration and permissions", implemented: true },
  { name: "mcp", summary: "Run the context-efficient MCP gateway", implemented: false },
  { name: "benchmark", summary: "Run the quality-adjusted savings benchmark", implemented: false },
  { name: "report", summary: "Show the local session report and share artifacts", implemented: false },
  { name: "skills", summary: "List, install and validate verified skills", implemented: false },
  { name: "telemetry", summary: "Inspect and control opt-in aggregate telemetry", implemented: true },
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

  const { flags } = parseFlags(rest);

  switch (command.name) {
    case "init": {
      const { runInit, runUninstall } = await import("./commands/init.js");
      const options = {
        ...(typeof flags.project === "string" ? { projectDir: flags.project } : {}),
        ...(typeof flags.home === "string" ? { homeDir: flags.home } : {}),
        ...(flagAsList(flags.host) ? { hosts: flagAsList(flags.host)! } : {}),
      };
      return flagAsBoolean(flags.uninstall)
        ? runUninstall(io, options)
        : runInit(io, {
            ...options,
            yes: flagAsBoolean(flags.yes),
            dryRun: flagAsBoolean(flags["dry-run"]),
          });
    }
    case "doctor": {
      const { runDoctor } = await import("./commands/doctor.js");
      return runDoctor(io, {
        ...(typeof flags.project === "string" ? { projectDir: flags.project } : {}),
        ...(typeof flags.home === "string" ? { homeDir: flags.home } : {}),
      });
    }
    case "telemetry": {
      const { runTelemetry } = await import("./commands/telemetry.js");
      const { positionals } = parseFlags(rest);
      const projectDir = typeof flags.project === "string" ? flags.project : process.cwd();
      return runTelemetry(positionals[0] ?? "status", io, {
        dataDir:
          typeof flags["data-dir"] === "string"
            ? flags["data-dir"]
            : path.join(projectDir, ".leanrigor"),
        ...(typeof flags.endpoint === "string" ? { endpoint: flags.endpoint } : {}),
      });
    }
    default:
      io.err(`LR_NOT_IMPLEMENTED: "${command.name}" has no dispatcher yet.`);
      return EXIT_UNAVAILABLE;
  }
}
