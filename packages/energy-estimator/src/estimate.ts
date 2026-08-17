import { LeanRigorError } from "@leanrigor/core";
import { loadMethodology } from "./assumptions.js";
import type { EstimateInput, EstimateRange, Methodology, ModelClass } from "./model.js";

/**
 * Phrases that must never appear in estimator output.
 *
 * The estimator cannot measure a datacenter, cannot produce an exact carbon
 * figure, and cannot convert tokens into trees or bottles of water. These
 * strings are checked in tests against every user-visible label the package
 * emits.
 */
export const FORBIDDEN_CLAIMS: readonly string[] = [
  "exact co2",
  "exact carbon",
  "trees saved",
  "trees planted",
  "bottles of water",
  "datacenter measured",
  "measured in the datacenter",
  "actual energy used",
  "actual emissions",
];

const WH_PER_KWH = 1000;

function assertNonNegativeInteger(value: number, field: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new LeanRigorError("LR_INVALID_EVENT", `${field} must be a non-negative number`, {
      details: { field, value },
    });
  }
}

/**
 * Estimates the energy an inference of this shape would take.
 *
 * Prefill and decode are computed separately because they have different
 * costs per token, and folding them into one number hides the fact that output
 * tokens dominate. The result is a *range*: an unknown model family widens it
 * rather than collapsing to a confident midpoint, and no carbon figure is
 * produced unless the caller supplies the grid intensity, because LeanRigor
 * cannot see which grid served the request.
 */
export function estimateEnergy(
  input: EstimateInput,
  methodology: Methodology = loadMethodology(),
): EstimateRange {
  assertNonNegativeInteger(input.inputTokens, "inputTokens");
  assertNonNegativeInteger(input.outputTokens, "outputTokens");
  if (input.cachedInputTokens !== undefined) {
    assertNonNegativeInteger(input.cachedInputTokens, "cachedInputTokens");
  }

  const modelClass: ModelClass = input.modelClass ?? "unknown";
  const coefficients = methodology.modelClasses[modelClass];
  if (!coefficients) {
    throw new LeanRigorError(
      "LR_MEASUREMENT_UNAVAILABLE",
      `methodology ${methodology.methodologyVersion} has no coefficients for model class "${modelClass}"`,
    );
  }

  const inputK = input.inputTokens / 1000;
  const outputK = input.outputTokens / 1000;
  const cachedK = (input.cachedInputTokens ?? 0) / 1000;

  const prefillLow =
    inputK * coefficients.prefillWhPerThousandTokens.low
    + cachedK * coefficients.prefillWhPerThousandTokens.low * methodology.cacheReadDiscount.low;
  const prefillHigh =
    inputK * coefficients.prefillWhPerThousandTokens.high
    + cachedK * coefficients.prefillWhPerThousandTokens.high * methodology.cacheReadDiscount.high;

  const decodeLow = outputK * coefficients.decodeWhPerThousandTokens.low;
  const decodeHigh = outputK * coefficients.decodeWhPerThousandTokens.high;

  const low = (prefillLow + decodeLow) * methodology.infrastructureOverhead.low;
  const high = (prefillHigh + decodeHigh) * methodology.infrastructureOverhead.high;

  const assumptions = [
    `Model class assumed: ${modelClass}. ${coefficients.description}`,
    `Prefill and decode are estimated separately, ${coefficients.prefillWhPerThousandTokens.low}–${coefficients.prefillWhPerThousandTokens.high} Wh and ${coefficients.decodeWhPerThousandTokens.low}–${coefficients.decodeWhPerThousandTokens.high} Wh per thousand tokens.`,
    `Infrastructure overhead multiplier ${methodology.infrastructureOverhead.low}–${methodology.infrastructureOverhead.high}: ${methodology.infrastructureOverhead.description}`,
    methodology.notice,
  ];

  if (cachedK > 0) {
    assumptions.push(
      `Cache reads are charged ${methodology.cacheReadDiscount.low}–${methodology.cacheReadDiscount.high} of prefill energy: ${methodology.cacheReadDiscount.description}`,
    );
  }

  if (input.modelClass === undefined) {
    assumptions.push(
      "No model family was supplied, so the range spans every class in the methodology rather than narrowing to a guess.",
    );
  }

  const result: EstimateRange = {
    low,
    central: (low + high) / 2,
    high,
    unit: "Wh",
    methodologyVersion: methodology.methodologyVersion,
    modelClass,
    assumptions,
  };

  if (input.gridIntensityGramsPerKwh === undefined) return result;

  assertNonNegativeInteger(input.gridIntensityGramsPerKwh, "gridIntensityGramsPerKwh");
  const perWh = input.gridIntensityGramsPerKwh / WH_PER_KWH;

  return {
    ...result,
    assumptions: [
      ...assumptions,
      `Carbon uses the grid intensity you supplied, ${input.gridIntensityGramsPerKwh} gCO2e/kWh. LeanRigor does not assume a grid.`,
    ],
    carbon: {
      low: low * perWh,
      central: ((low + high) / 2) * perWh,
      high: high * perWh,
      unit: "gCO2e",
      gridIntensityGramsPerKwh: input.gridIntensityGramsPerKwh,
    },
  };
}

/** Renders an estimate for display. Every label here is checked in tests. */
export function renderEstimate(estimate: EstimateRange): string {
  const lines = [
    "Environmental estimate (not a measurement)",
    "",
    `  Estimated energy range      ${estimate.low.toFixed(3)}–${estimate.high.toFixed(3)} ${estimate.unit}`,
    `  Methodology                 ${estimate.methodologyVersion}`,
    `  Model class assumed         ${estimate.modelClass}`,
  ];

  if (estimate.carbon) {
    lines.push(
      `  Estimated carbon range      ${estimate.carbon.low.toFixed(3)}–${estimate.carbon.high.toFixed(3)} ${estimate.carbon.unit}`,
      `  Grid intensity you supplied ${estimate.carbon.gridIntensityGramsPerKwh} gCO2e/kWh`,
    );
  } else {
    lines.push("  Carbon                      not estimated; supply a grid intensity to compute it");
  }

  lines.push("", "Assumptions:");
  for (const assumption of estimate.assumptions) lines.push(`  - ${assumption}`);
  return lines.join("\n");
}
