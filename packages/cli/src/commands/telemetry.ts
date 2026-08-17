import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CliIo } from "../cli.js";
import { EXIT_FAILURE, EXIT_OK } from "../cli.js";

export interface TelemetryState {
  readonly enabled: boolean;
  readonly anonymousInstallId: string;
  readonly endpoint: string;
  readonly enabledAt?: string;
}

export interface TelemetryOptions {
  readonly dataDir: string;
  readonly endpoint?: string;
  /** Injected so tests can assert that nothing is sent while disabled. */
  readonly transport?: (url: string, body: string) => Promise<void>;
  readonly host?: "claude-code" | "codex" | "gemini" | "other";
  readonly clientVersion?: string;
}

const DEFAULT_ENDPOINT = "https://telemetry.leanrigor.dev/v1/events";

function statePath(dataDir: string): string {
  return path.join(dataDir, "telemetry.json");
}

/**
 * Reads consent state.
 *
 * A missing file means disabled. Consent is something the user gave, so its
 * absence is never read as permission.
 */
export async function readState(options: TelemetryOptions): Promise<TelemetryState> {
  const fallback: TelemetryState = {
    enabled: false,
    anonymousInstallId: "not-yet-generated",
    endpoint: options.endpoint ?? DEFAULT_ENDPOINT,
  };
  try {
    const parsed = JSON.parse(await readFile(statePath(options.dataDir), "utf8")) as TelemetryState;
    return { ...fallback, ...parsed, enabled: parsed.enabled === true };
  } catch {
    return fallback;
  }
}

async function writeState(options: TelemetryOptions, state: TelemetryState): Promise<void> {
  await mkdir(options.dataDir, { recursive: true });
  await writeFile(statePath(options.dataDir), `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

export interface PendingPayload {
  schemaVersion: 1;
  eventId: string;
  anonymousInstallId: string;
  day: string;
  host: string;
  measurementMode: string;
  baselineBytes: number;
  optimizedBytes: number;
  verifiedTasks: number;
  passedTasks: number;
  clientVersion: string;
}

/**
 * Builds exactly the payload that would be sent.
 *
 * `telemetry inspect` prints this, so the promise "we send only aggregates" is
 * something a user can check rather than take on trust.
 */
export function buildPendingPayload(
  state: TelemetryState,
  options: TelemetryOptions,
  totals: {
    baselineBytes: number;
    optimizedBytes: number;
    verifiedTasks: number;
    passedTasks: number;
    measurementMode: string;
  },
  day = new Date().toISOString().slice(0, 10),
  eventId = randomUUID(),
): PendingPayload {
  return {
    schemaVersion: 1,
    eventId,
    anonymousInstallId: state.anonymousInstallId,
    day,
    host: options.host ?? "other",
    measurementMode: totals.measurementMode,
    baselineBytes: totals.baselineBytes,
    optimizedBytes: totals.optimizedBytes,
    verifiedTasks: totals.verifiedTasks,
    passedTasks: totals.passedTasks,
    clientVersion: options.clientVersion ?? "0.1.0",
  };
}

const SAMPLE_TOTALS = {
  baselineBytes: 2_804_112,
  optimizedBytes: 611_420,
  verifiedTasks: 8,
  passedTasks: 8,
  measurementMode: "byte-only",
};

export async function runTelemetry(
  action: string,
  io: CliIo,
  options: TelemetryOptions,
): Promise<number> {
  const state = await readState(options);

  switch (action) {
    case "status": {
      io.out(`Telemetry: ${state.enabled ? "enabled" : "disabled"}`);
      io.out(`Endpoint:  ${state.endpoint}`);
      io.out(`Install id: ${state.enabled ? state.anonymousInstallId : "not generated until enabled"}`);
      io.out("");
      io.out("Telemetry is disabled by default and sends aggregate measurements only.");
      io.out("It never contains prompts, source code, file paths or repository names.");
      return EXIT_OK;
    }

    case "inspect": {
      io.out("The exact next payload:");
      io.out("");
      io.out(JSON.stringify(buildPendingPayload(state, options, SAMPLE_TOTALS), null, 2));
      io.out("");
      io.out(
        state.enabled
          ? "Telemetry is enabled; a payload of this shape will be sent."
          : "Telemetry is disabled; nothing will be sent.",
      );
      return EXIT_OK;
    }

    case "enable": {
      const next: TelemetryState = {
        enabled: true,
        anonymousInstallId:
          state.anonymousInstallId === "not-yet-generated"
            ? randomUUID()
            : state.anonymousInstallId,
        endpoint: options.endpoint ?? state.endpoint,
        enabledAt: new Date().toISOString(),
      };
      await writeState(options, next);
      io.out("Telemetry enabled. Aggregate measurements only.");
      io.out(`Install id: ${next.anonymousInstallId}`);
      io.out("Run `leanrigor telemetry inspect` to see exactly what is sent.");
      io.out("Run `leanrigor telemetry disable` to stop.");
      return EXIT_OK;
    }

    case "disable": {
      await writeState(options, { ...state, enabled: false });
      io.out("Telemetry disabled. Nothing further will be sent.");
      return EXIT_OK;
    }

    default: {
      io.err(`LR_UNKNOWN_COMMAND: unknown telemetry action "${action}".`);
      io.err("Valid actions: status, inspect, enable, disable.");
      return EXIT_FAILURE;
    }
  }
}

/**
 * Sends a payload, but only when consent is recorded.
 *
 * The consent check lives here rather than at the call site, so a future caller
 * cannot forget it.
 */
export async function sendIfEnabled(
  options: TelemetryOptions,
  payload: PendingPayload,
): Promise<"sent" | "disabled"> {
  const state = await readState(options);
  if (!state.enabled) return "disabled";
  const transport =
    options.transport
    ?? (async (url: string, body: string) => {
      await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      });
    });
  await transport(state.endpoint, JSON.stringify(payload));
  return "sent";
}
