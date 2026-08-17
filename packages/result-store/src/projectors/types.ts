import type { ContentHandle } from "@leanrigor/core";

/**
 * How much of the original a projection discarded.
 *
 * - `lossless`         the view carries the whole payload
 * - `reversible-lossy` part was withheld; the original handle restores it
 * - `summary-only`     only an index or summary remains, still handle-backed
 *
 * Every policy keeps `originalHandle`, so no projection is a one-way door.
 */
export type LossPolicy = "lossless" | "reversible-lossy" | "summary-only";

export interface ProjectionInput {
  /** The full payload as stored. */
  readonly bytes: Buffer;
  /** Handle to the payload, so the agent can always fetch more. */
  readonly handle: ContentHandle;
  /** Optional previous revision, enabling structural diffs. */
  readonly previous?: Buffer;
  readonly schema?: string;
}

export interface ProjectionBudget {
  /** Hard ceiling for the serialized view, in bytes. */
  readonly maxBytes: number;
  /** Field allowlist applied to collection items. */
  readonly fields?: readonly string[];
  /** 0-based page number, matching the `index` reported in the view. */
  readonly page?: number;
  readonly pageSize?: number;
}

export interface ProjectionResult {
  readonly projector: string;
  readonly lossPolicy: LossPolicy;
  /** One-line description of the whole payload, safe to show instead of it. */
  readonly summary: string;
  /** The serialized view handed to the model. Always well-formed. */
  readonly view: string;
  readonly originalHandle: ContentHandle;
  /** Named views the agent may request next. */
  readonly availableViews: readonly string[];
  readonly bytes: {
    readonly baseline: number;
    readonly optimized: number;
  };
}

export interface Projector {
  readonly name: string;
  supports(input: ProjectionInput): boolean;
  project(input: ProjectionInput, budget: ProjectionBudget): ProjectionResult;
}

export function byteLength(text: string): number {
  return Buffer.byteLength(text, "utf8");
}

export function withinBudget(text: string, budget: ProjectionBudget): boolean {
  return byteLength(text) <= budget.maxBytes;
}
