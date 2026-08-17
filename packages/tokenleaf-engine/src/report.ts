import {
  countsTowardSavings,
  hasTokenCounts,
  type LedgerEvent,
  type MeasurementMode,
} from "@leanrigor/core";

export interface ModeBreakdown {
  readonly mode: MeasurementMode;
  readonly events: number;
  readonly countedEvents: number;
  readonly baselineBytes: number;
  readonly optimizedBytes: number;
  readonly bytesAvoided: number;
  readonly qualityAdjustedBytesAvoided: number;
  /** False for `byte-only`, where no token figure exists at all. */
  readonly tokensMeasured: boolean;
  readonly grossTokensAvoided: number | undefined;
  readonly qualityAdjustedTokensAvoided: number | undefined;
}

export interface SessionReport {
  readonly sessionId: string;
  readonly totalEvents: number;
  readonly countedEvents: number;
  readonly excludedEvents: number;
  /** Events that carry an explicit pass/fail verdict. */
  readonly verifiedEvents: number;
  readonly passedEvents: number;
  /** Undefined when no event carried a verdict. */
  readonly taskPassRate: number | undefined;
  readonly bytes: {
    readonly baseline: number;
    readonly optimized: number;
    readonly avoided: number;
    readonly qualityAdjustedAvoided: number;
  };
  readonly byMode: Readonly<Partial<Record<MeasurementMode, ModeBreakdown>>>;
  /**
   * Token totals are only defined when every token-bearing event used the same
   * measurement mode. Mixed modes stay in `byMode`, because adding an estimate
   * to provider-reported usage would produce a number that means nothing.
   */
  readonly grossTokensAvoided: number | undefined;
  readonly qualityAdjustedTokensAvoided: number | undefined;
  readonly tokenMeasurementModes: readonly MeasurementMode[];
  readonly estimators: readonly string[];
}

interface ModeAccumulator {
  events: number;
  countedEvents: number;
  baselineBytes: number;
  optimizedBytes: number;
  bytesAvoided: number;
  qualityAdjustedBytesAvoided: number;
  tokensMeasured: boolean;
  grossTokensAvoided: number | undefined;
  qualityAdjustedTokensAvoided: number | undefined;
}

function emptyAccumulator(mode: MeasurementMode): ModeAccumulator {
  const measured = hasTokenCounts(mode);
  return {
    events: 0,
    countedEvents: 0,
    baselineBytes: 0,
    optimizedBytes: 0,
    bytesAvoided: 0,
    qualityAdjustedBytesAvoided: 0,
    tokensMeasured: measured,
    grossTokensAvoided: measured ? 0 : undefined,
    qualityAdjustedTokensAvoided: measured ? 0 : undefined,
  };
}

/**
 * Aggregates a session's events.
 *
 * Two totals are always produced side by side: a gross figure covering every
 * event, and a quality-adjusted figure covering only events whose task passed
 * its verifier with all mandatory gate evidence present. Savings from a failed
 * task are never advertised.
 */
export function buildSessionReport(sessionId: string, allEvents: LedgerEvent[]): SessionReport {
  const events = allEvents.filter((event) => event.sessionId === sessionId);

  const modes = new Map<MeasurementMode, ModeAccumulator>();
  const estimators = new Set<string>();

  let baseline = 0;
  let optimized = 0;
  let qualityAdjustedBytes = 0;
  let counted = 0;
  let verified = 0;
  let passed = 0;

  for (const event of events) {
    const acc = modes.get(event.measurementMode) ?? emptyAccumulator(event.measurementMode);
    modes.set(event.measurementMode, acc);

    const counts = countsTowardSavings(event);
    const deltaBytes = event.baselineBytes - event.optimizedBytes;

    acc.events += 1;
    acc.baselineBytes += event.baselineBytes;
    acc.optimizedBytes += event.optimizedBytes;
    acc.bytesAvoided += deltaBytes;

    baseline += event.baselineBytes;
    optimized += event.optimizedBytes;

    if (counts) {
      counted += 1;
      acc.countedEvents += 1;
      acc.qualityAdjustedBytesAvoided += deltaBytes;
      qualityAdjustedBytes += deltaBytes;
    }

    if (event.passed !== undefined) {
      verified += 1;
      if (event.passed) passed += 1;
    }

    if (event.estimator) estimators.add(event.estimator);

    if (
      acc.tokensMeasured
      && event.baselineTokens !== undefined
      && event.optimizedTokens !== undefined
    ) {
      const deltaTokens = event.baselineTokens - event.optimizedTokens;
      acc.grossTokensAvoided = (acc.grossTokensAvoided ?? 0) + deltaTokens;
      if (counts) {
        acc.qualityAdjustedTokensAvoided = (acc.qualityAdjustedTokensAvoided ?? 0) + deltaTokens;
      }
    }
  }

  const byMode: Partial<Record<MeasurementMode, ModeBreakdown>> = {};
  for (const [mode, acc] of modes) {
    byMode[mode] = { mode, ...acc };
  }

  const tokenModes = [...modes.keys()].filter((mode) => hasTokenCounts(mode)).sort();
  const single = tokenModes.length === 1 ? modes.get(tokenModes[0]!) : undefined;

  return {
    sessionId,
    totalEvents: events.length,
    countedEvents: counted,
    excludedEvents: events.length - counted,
    verifiedEvents: verified,
    passedEvents: passed,
    taskPassRate: verified === 0 ? undefined : passed / verified,
    bytes: {
      baseline,
      optimized,
      avoided: baseline - optimized,
      qualityAdjustedAvoided: qualityAdjustedBytes,
    },
    byMode,
    grossTokensAvoided: tokenModes.length === 0 ? 0 : single?.grossTokensAvoided,
    qualityAdjustedTokensAvoided:
      tokenModes.length === 0 ? 0 : single?.qualityAdjustedTokensAvoided,
    tokenMeasurementModes: tokenModes,
    estimators: [...estimators].sort(),
  };
}

function n(value: number): string {
  return value.toLocaleString("en-US");
}

function pad(label: string, value: string, width = 42): string {
  return `${label.padEnd(width)}${value.padStart(12)}`;
}

/**
 * Renders the terminal report. Verified outcome comes first; savings follow and
 * always carry their measurement label. A single token total is printed only
 * when one measurement mode produced it.
 */
export function renderSessionReport(report: SessionReport): string {
  const lines: string[] = ["LeanRigor session report — powered by TokenLeaf Engine", ""];

  const passRate =
    report.taskPassRate === undefined ? "no verdict" : `${(report.taskPassRate * 100).toFixed(1)}%`;
  lines.push(pad("Verified events passed", `${n(report.passedEvents)} / ${n(report.verifiedEvents)}`));
  lines.push(pad("Verified pass rate", passRate));
  lines.push(pad("Events excluded from savings", n(report.excludedEvents)));
  lines.push("");

  lines.push(pad("Operations optimized", n(report.totalEvents)));
  lines.push(pad("Raw payload bytes", n(report.bytes.baseline)));
  lines.push(pad("Returned payload bytes", n(report.bytes.optimized)));
  lines.push(pad("Payload bytes avoided (quality-adjusted)", n(report.bytes.qualityAdjustedAvoided)));
  lines.push("");

  if (report.tokenMeasurementModes.length > 1) {
    lines.push("Estimated tool-context tokens avoided — mixed measurement modes,");
    lines.push("reported separately because these figures are not comparable:");
    for (const mode of report.tokenMeasurementModes) {
      const breakdown = report.byMode[mode];
      lines.push(pad(`  ${mode}`, n(breakdown?.qualityAdjustedTokensAvoided ?? 0)));
    }
  } else {
    lines.push(
      pad("Estimated tool-context tokens avoided", n(report.qualityAdjustedTokensAvoided ?? 0)),
    );
  }
  lines.push("");

  const measurement =
    report.estimators.length > 0 ? report.estimators.join(", ") : "byte measurement only";
  lines.push(`Measurement: ${measurement}`);
  lines.push("Coverage: payloads handled by LeanRigor only");
  lines.push("Environmental estimate: disabled");

  return lines.join("\n");
}
