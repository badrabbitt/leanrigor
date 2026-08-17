import { LeanRigorError } from "@leanrigor/core";
import { contextReduction, median, type CaseResult } from "./case.js";

export interface Comparison {
  readonly baseline: readonly CaseResult[];
  readonly candidate: readonly CaseResult[];
  readonly baselinePassRate: number;
  readonly candidatePassRate: number;
  /** Candidate minus baseline, as a fraction. Multiply by 100 for points. */
  readonly passRateDelta: number;
  readonly medianContextReduction: number;
  readonly pairedCaseIds: readonly string[];
  /** Cases present in one run but not the other; excluded from every figure. */
  readonly unpairedCaseIds: readonly string[];
}

function passRate(results: readonly CaseResult[]): number {
  const completed = results.filter((result) => result.completed);
  if (completed.length === 0) return 0;
  return completed.filter((r) => r.passed && r.requiredGatesPassed).length / completed.length;
}

/**
 * Pairs a baseline run against a candidate run by case id.
 *
 * Unpaired cases are excluded and reported rather than quietly averaged in:
 * comparing a baseline of ten cases against a candidate of six produces a
 * number that looks like a result and is not one. Measurement modes must also
 * match per pair — subtracting a local estimate from provider-reported usage
 * would be arithmetic on incompatible units.
 */
export function compareRuns(
  baseline: readonly CaseResult[],
  candidate: readonly CaseResult[],
): Comparison {
  const baselineById = new Map(baseline.map((result) => [result.caseId, result]));
  const candidateById = new Map(candidate.map((result) => [result.caseId, result]));

  const paired: string[] = [];
  const unpaired: string[] = [];

  for (const id of new Set([...baselineById.keys(), ...candidateById.keys()])) {
    const left = baselineById.get(id);
    const right = candidateById.get(id);
    if (!left || !right) {
      unpaired.push(id);
      continue;
    }
    if (left.measurementMode !== right.measurementMode) {
      throw new LeanRigorError(
        "LR_INVALID_EVENT",
        `case "${id}" was measured as ${left.measurementMode} in the baseline and `
        + `${right.measurementMode} in the candidate; these are not comparable`,
        { details: { caseId: id } },
      );
    }
    paired.push(id);
  }

  paired.sort();
  unpaired.sort();

  const pairedBaseline = paired.map((id) => baselineById.get(id)!);
  const pairedCandidate = paired.map((id) => candidateById.get(id)!);

  const baselineRate = passRate(pairedBaseline);
  const candidateRate = passRate(pairedCandidate);

  return {
    baseline: pairedBaseline,
    candidate: pairedCandidate,
    baselinePassRate: baselineRate,
    candidatePassRate: candidateRate,
    passRateDelta: candidateRate - baselineRate,
    medianContextReduction: median(
      pairedCandidate
        .filter((result) => result.completed && result.passed && result.requiredGatesPassed)
        .map(contextReduction),
    ),
    pairedCaseIds: paired,
    unpairedCaseIds: unpaired,
  };
}

export function renderComparison(comparison: Comparison): string {
  const pct = (value: number) => `${(value * 100).toFixed(1)}%`;
  const lines = [
    "Benchmark comparison",
    "",
    `  Paired cases                ${comparison.pairedCaseIds.length}`,
    `  Baseline pass rate          ${pct(comparison.baselinePassRate)}`,
    `  Candidate pass rate         ${pct(comparison.candidatePassRate)}`,
    `  Pass-rate delta             ${comparison.passRateDelta >= 0 ? "+" : ""}${(comparison.passRateDelta * 100).toFixed(1)} points`,
    `  Median context reduction    ${pct(comparison.medianContextReduction)} (passing cases only)`,
  ];
  if (comparison.unpairedCaseIds.length > 0) {
    lines.push(
      "",
      `  Excluded, unpaired          ${comparison.unpairedCaseIds.join(", ")}`,
    );
  }
  return lines.join("\n");
}
