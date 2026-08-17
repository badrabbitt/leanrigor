import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { TokenLeafEngine, type SessionReport } from "@leanrigor/tokenleaf";
import { estimateEnergy, renderEstimate } from "@leanrigor/energy-estimator";
import type { CliIo } from "../cli.js";
import { EXIT_OK } from "../cli.js";
import { renderReport, type GateCoverage, type ReportView } from "../render/terminal.js";
import { renderShareCard, type ShareCard } from "../render/share-svg.js";

export interface ReportOptions {
  readonly dataDir: string;
  readonly projectId?: string;
  readonly sessionId?: string;
  /** Write a share card here. */
  readonly share?: string;
  readonly json?: boolean;
  /** Environmental output is hidden unless this is explicitly set. */
  readonly energy?: boolean;
  readonly gates?: GateCoverage;
  readonly clientVersion?: string;
}

/**
 * Builds the share card from an aggregate report.
 *
 * The card carries only counts. A session id, project name or path would be
 * enough to identify a repository, and the whole point of a shareable artifact
 * is that sharing it costs the user nothing.
 */
export function toShareCard(
  session: SessionReport,
  options: { gates?: GateCoverage; clientVersion?: string } = {},
): ShareCard {
  return {
    operations: session.totalEvents,
    baselineBytes: session.bytes.baseline,
    optimizedBytes: session.bytes.optimized,
    tokensAvoided: session.qualityAdjustedTokensAvoided,
    measurementLabel:
      session.estimators.length > 0
        ? `Measured with ${session.estimators.join(", ")}`
        : "Byte measurement only",
    passedEvents: session.passedEvents,
    verifiedEvents: session.verifiedEvents,
    ...(options.gates
      ? { gatesPassed: options.gates.passed, gatesRequired: options.gates.required }
      : {}),
    clientVersion: options.clientVersion ?? "0.1.0",
  };
}

export async function runReport(io: CliIo, options: ReportOptions): Promise<number> {
  const engine = new TokenLeafEngine({
    dataDir: options.dataDir,
    projectId: options.projectId ?? "default",
  });

  const events = await engine.readAll();
  const sessionId = options.sessionId ?? events.at(-1)?.sessionId ?? "no-session";
  const session = await engine.sessionReport(sessionId);

  if (options.json) {
    io.out(JSON.stringify(session, null, 2));
    return EXIT_OK;
  }

  const view: ReportView = {
    session,
    ...(options.gates ? { gates: options.gates } : {}),
    ...(options.energy
      ? {
          environmental: renderEstimate(
            estimateEnergy({
              inputTokens: session.bytes.qualityAdjustedAvoided > 0
                ? Math.round(session.bytes.qualityAdjustedAvoided / 4)
                : 0,
              outputTokens: 0,
            }),
          ),
        }
      : {}),
  };

  io.out(renderReport(view));

  if (options.share) {
    const svg = renderShareCard(
      toShareCard(session, {
        ...(options.gates ? { gates: options.gates } : {}),
        ...(options.clientVersion ? { clientVersion: options.clientVersion } : {}),
      }),
    );
    await mkdir(path.dirname(options.share), { recursive: true });
    await writeFile(options.share, svg, "utf8");
    io.out("");
    io.out(`Wrote ${options.share}`);
    io.out("The card contains aggregate counts only — no prompt, path or repository name.");
  }

  return EXIT_OK;
}
