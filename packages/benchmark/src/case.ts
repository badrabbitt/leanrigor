import { z } from "zod";
import { MeasurementModeSchema } from "@leanrigor/core";

/**
 * The four experimental conditions from the design document. A comparison is
 * only meaningful between the same case run under different conditions.
 */
export const CONDITIONS = [
  "baseline",
  "gateway",
  "gateway+workflow",
  "gateway+workflow+skill",
] as const;
export type Condition = (typeof CONDITIONS)[number];

export const BenchmarkCaseSchema = z.strictObject({
  id: z.string().min(1),
  /** What the case exercises, for the published report. */
  description: z.string().min(1),
  kind: z.enum(["json", "log", "diff", "resource", "tool-catalog", "workflow"]),
  /** Fixture file, relative to the evals root. */
  fixture: z.string().min(1).optional(),
  /** Tools in the simulated catalog, for tool-catalog cases. */
  toolCount: z.number().int().min(0).optional(),
  riskLevel: z.enum(["trivial", "low", "medium", "high", "critical"]).optional(),
});

export type BenchmarkCase = z.infer<typeof BenchmarkCaseSchema>;

export interface CaseResult {
  readonly caseId: string;
  readonly runId: string;
  readonly condition: Condition;
  /** Whether the case ran to completion at all. */
  readonly completed: boolean;
  /** Whether the deterministic verifier accepted the output. */
  readonly passed: boolean;
  /** Whether every mandatory Rigor Gate produced evidence. */
  readonly requiredGatesPassed: boolean;
  readonly baselineBytes: number;
  readonly optimizedBytes: number;
  readonly baselineTokens?: number;
  readonly optimizedTokens?: number;
  readonly measurementMode: z.infer<typeof MeasurementModeSchema>;
  readonly estimator?: string;
  readonly durationMs: number;
  readonly toolCalls: number;
  readonly retries: number;
  readonly errors: number;
}

export interface RunEnvironment {
  readonly runId: string;
  readonly nodeVersion: string;
  readonly platform: string;
  readonly packageVersions: Readonly<Record<string, string>>;
  /** Recorded so a run can be repeated, where the host supports a seed. */
  readonly seed?: number;
  readonly startedAt: string;
}

export interface BenchmarkRun {
  readonly environment: RunEnvironment;
  readonly results: readonly CaseResult[];
}

/** Fraction of context avoided. Negative when an optimization expanded output. */
export function contextReduction(result: CaseResult): number {
  if (result.baselineBytes === 0) return 0;
  return (result.baselineBytes - result.optimizedBytes) / result.baselineBytes;
}

export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!;
}
