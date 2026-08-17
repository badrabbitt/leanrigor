import { contextReduction, median, type CaseResult } from "./case.js";
import type { Comparison } from "./compare.js";

export interface ReleaseGateThresholds {
  /** Fraction of cases that must run to completion. */
  readonly minimumCompletionRate: number;
  /** Worst acceptable change in pass rate, in percentage points. */
  readonly maximumPassRateDeltaPoints: number;
  /** Median tool-context reduction required to advertise savings. */
  readonly minimumMedianReduction: number;
}

export const DEFAULT_THRESHOLDS: ReleaseGateThresholds = {
  minimumCompletionRate: 0.9,
  maximumPassRateDeltaPoints: -2,
  minimumMedianReduction: 0.4,
};

export interface ReleaseGateInput {
  readonly comparison: Comparison;
  /** Open privacy or provenance violations classed as critical. */
  readonly openCriticalViolations?: number;
  /** Whether the MCP conformance suite passed against its reviewed baseline. */
  readonly conformancePassed: boolean;
  readonly thresholds?: ReleaseGateThresholds;
}

export interface GateCheck {
  readonly id: string;
  readonly passed: boolean;
  readonly detail: string;
}

export interface ReleaseGateResult {
  /** Whether the release may proceed at all. */
  readonly passed: boolean;
  /**
   * Whether the release may *advertise* savings. A release can be shippable
   * while forbidden from making a savings claim.
   */
  readonly mayAdvertiseSavings: boolean;
  readonly checks: readonly GateCheck[];
}

function rate(results: readonly CaseResult[], predicate: (r: CaseResult) => boolean): number {
  if (results.length === 0) return 0;
  return results.filter(predicate).length / results.length;
}

/**
 * Decides whether a release may ship and whether it may claim savings.
 *
 * The two questions are separate on purpose. A build can be correct and still
 * have no right to a savings headline, and the most dangerous failure mode for
 * this product is a report that shows a large reduction next to tasks that did
 * not pass. Every check states its number, so a "failed" verdict can be argued
 * with rather than merely obeyed.
 */
export function evaluateReleaseGate(input: ReleaseGateInput): ReleaseGateResult {
  const thresholds = input.thresholds ?? DEFAULT_THRESHOLDS;
  const { comparison } = input;
  const checks: GateCheck[] = [];

  const completion = rate(comparison.candidate, (result) => result.completed);
  checks.push({
    id: "completion-rate",
    passed: completion >= thresholds.minimumCompletionRate,
    detail: `${(completion * 100).toFixed(1)}% of ${comparison.candidate.length} cases completed `
      + `(minimum ${(thresholds.minimumCompletionRate * 100).toFixed(0)}%)`,
  });

  // Rounded before comparison: a delta of exactly -2 points arrives from
  // floating-point arithmetic as -2.0000000000000018, and a threshold that
  // rejects its own boundary value is a bug, not a strict policy.
  const deltaPoints = Number((comparison.passRateDelta * 100).toFixed(6));
  checks.push({
    id: "pass-rate-delta",
    passed: deltaPoints >= thresholds.maximumPassRateDeltaPoints,
    detail: `pass rate changed by ${deltaPoints >= 0 ? "+" : ""}${deltaPoints.toFixed(1)} points `
      + `(floor ${thresholds.maximumPassRateDeltaPoints})`,
  });

  // Savings are measured only over cases that passed. A reduction achieved by
  // producing a wrong answer is not a reduction.
  const passing = comparison.candidate.filter(
    (result) => result.completed && result.passed && result.requiredGatesPassed,
  );
  const medianReduction = median(passing.map(contextReduction));
  checks.push({
    id: "median-context-reduction",
    passed: medianReduction >= thresholds.minimumMedianReduction,
    detail: `median reduction ${(medianReduction * 100).toFixed(1)}% over ${passing.length} passing `
      + `case(s) (minimum ${(thresholds.minimumMedianReduction * 100).toFixed(0)}%)`,
  });

  const violations = input.openCriticalViolations ?? 0;
  checks.push({
    id: "no-critical-violations",
    passed: violations === 0,
    detail:
      violations === 0
        ? "no open critical privacy or provenance violation"
        : `${violations} open critical privacy or provenance violation(s)`,
  });

  checks.push({
    id: "mcp-conformance",
    passed: input.conformancePassed,
    detail: input.conformancePassed
      ? "MCP conformance passed against its reviewed baseline"
      : "MCP conformance failed or was not run",
  });

  const blocking = new Set(["pass-rate-delta", "no-critical-violations", "mcp-conformance"]);
  const passed = checks.every((check) => blocking.has(check.id) ? check.passed : true);
  const mayAdvertiseSavings = checks.every((check) => check.passed);

  return { passed, mayAdvertiseSavings, checks };
}

export function renderReleaseGate(result: ReleaseGateResult): string {
  const lines = ["Release gate", ""];
  for (const check of result.checks) {
    lines.push(`  [${check.passed ? "ok  " : "FAIL"}] ${check.id.padEnd(26)} ${check.detail}`);
  }
  lines.push("");
  lines.push(result.passed ? "Release may proceed." : "Release is blocked.");
  lines.push(
    result.mayAdvertiseSavings
      ? "This release may advertise its measured savings."
      : "This release may NOT advertise savings; the quality bar was not met.",
  );
  return lines.join("\n");
}
