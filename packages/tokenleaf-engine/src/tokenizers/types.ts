import type { MeasurementMode } from "@leanrigor/core";

export interface TokenCount {
  /**
   * Token count, or `undefined` when no token measurement was possible.
   * A missing count is never replaced by a guess.
   */
  readonly tokens?: number;
  /** Serialized byte length, which LeanRigor can always measure directly. */
  readonly bytes: number;
  readonly mode: MeasurementMode;
  /**
   * Present only for `tokenizer-estimate`. Provider-reported counts carry no
   * estimator label, because no local estimator produced them.
   */
  readonly estimator?: string;
}

export interface TokenEstimator {
  readonly name: string;
  readonly version: string;
  readonly mode: MeasurementMode;
  count(text: string): Promise<TokenCount>;
}

export function byteLengthOf(text: string): number {
  return Buffer.byteLength(text, "utf8");
}

/**
 * Wraps a count returned by a provider SDK response. This is the only path that
 * may produce `provider-usage`.
 */
export function fromProviderUsage(usage: { tokens: number; bytes: number }): TokenCount {
  return { tokens: usage.tokens, bytes: usage.bytes, mode: "provider-usage" };
}
