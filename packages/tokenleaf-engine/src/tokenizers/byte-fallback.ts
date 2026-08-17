import { LeanRigorError } from "@leanrigor/core";
import { byteLengthOf, type TokenCount, type TokenEstimator } from "./types.js";

/**
 * Measures bytes only.
 *
 * It deliberately reports no token count. A bytes-per-token constant would look
 * like a measurement while being a guess, and every downstream report would
 * inherit that false precision.
 */
export class ByteFallbackEstimator implements TokenEstimator {
  readonly name = "byte-only";
  readonly version = "1";
  readonly mode = "byte-only" as const;

  async count(text: string): Promise<TokenCount> {
    return { bytes: byteLengthOf(text), mode: this.mode };
  }
}

export interface FallbackOptions {
  /**
   * When false, a failed measurement is an error. A run that must produce
   * comparable numbers — a benchmark — should not silently change units.
   */
  readonly allowByteOnlyFallback: boolean;
  /** Called when a downgrade happens, so the CLI can say so out loud. */
  readonly onDowngrade?: (error: LeanRigorError) => void;
}

/**
 * Wraps an estimator so a measurement failure either downgrades to `byte-only`
 * or propagates as a typed error — never silently produces a wrong number.
 */
export function withByteOnlyFallback(
  primary: TokenEstimator,
  options: FallbackOptions,
): TokenEstimator {
  const fallback = new ByteFallbackEstimator();
  return {
    name: primary.name,
    version: primary.version,
    mode: primary.mode,
    async count(text: string): Promise<TokenCount> {
      try {
        return await primary.count(text);
      } catch (error) {
        if (!options.allowByteOnlyFallback) throw error;
        if (error instanceof LeanRigorError) options.onDowngrade?.(error);
        return fallback.count(text);
      }
    },
  };
}
