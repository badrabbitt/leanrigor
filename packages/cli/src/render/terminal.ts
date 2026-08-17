import type { SessionReport } from "@leanrigor/tokenleaf";

export interface GateCoverage {
  readonly required: number;
  readonly passed: number;
  readonly skippedWithReason: number;
}

export interface ReportView {
  readonly session: SessionReport;
  readonly gates?: GateCoverage;
  /** Rendered environmental block, present only when the user enabled it. */
  readonly environmental?: string;
  readonly benchmark?: { readonly medianReduction: number; readonly cases: number };
}

function n(value: number): string {
  return value.toLocaleString("en-US");
}

function row(label: string, value: string, width = 42): string {
  return `${label.padEnd(width)}${value.padStart(12)}`;
}

/**
 * Renders the session report.
 *
 * Order is a product decision, not a layout one: verified outcome and gate
 * coverage come first, and savings follow. A reader who stops after two lines
 * should learn whether the work was correct, not how many tokens were saved.
 */
export function renderReport(view: ReportView): string {
  const { session } = view;
  const lines = ["LeanRigor session report — powered by TokenLeaf Engine", ""];

  lines.push(
    row("Verified events passed", `${n(session.passedEvents)} / ${n(session.verifiedEvents)}`),
  );
  lines.push(
    row(
      "Verified pass rate",
      session.taskPassRate === undefined
        ? "no verdict"
        : `${(session.taskPassRate * 100).toFixed(1)}%`,
    ),
  );

  if (view.gates) {
    lines.push(row("Required Rigor Gates passed", `${n(view.gates.passed)} / ${n(view.gates.required)}`));
    if (view.gates.skippedWithReason > 0) {
      lines.push(row("Gates skipped with a reason", n(view.gates.skippedWithReason)));
    }
  }
  lines.push(row("Events excluded from savings", n(session.excludedEvents)));
  lines.push("");

  lines.push(row("Operations optimized", n(session.totalEvents)));
  lines.push(row("Raw payload bytes", n(session.bytes.baseline)));
  lines.push(row("Returned payload bytes", n(session.bytes.optimized)));
  lines.push(row("Payload bytes avoided", n(session.bytes.qualityAdjustedAvoided)));
  lines.push("");

  if (session.tokenMeasurementModes.length > 1) {
    lines.push("Estimated tool-context tokens avoided — mixed measurement modes,");
    lines.push("reported separately because these figures are not comparable:");
    for (const mode of session.tokenMeasurementModes) {
      lines.push(row(`  ${mode}`, n(session.byMode[mode]?.qualityAdjustedTokensAvoided ?? 0)));
    }
  } else {
    lines.push(
      row("Estimated tool-context tokens avoided", n(session.qualityAdjustedTokensAvoided ?? 0)),
    );
  }

  if (view.benchmark) {
    lines.push("");
    lines.push(
      row(
        "Benchmark median reduction",
        `${(view.benchmark.medianReduction * 100).toFixed(1)}%`,
      ),
    );
    lines.push(row("  over cases", n(view.benchmark.cases)));
  }

  lines.push("");
  lines.push(
    `Measurement: ${session.estimators.length > 0 ? session.estimators.join(", ") : "byte measurement only"}`,
  );
  lines.push("Coverage: payloads handled by LeanRigor only");

  if (view.environmental) {
    lines.push("");
    lines.push(view.environmental);
  } else {
    lines.push("Environmental estimate: disabled");
  }

  return lines.join("\n");
}
