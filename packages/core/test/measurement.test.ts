import { describe, expect, it } from "vitest";
import {
  LedgerEventSchema,
  MEASUREMENT_MODES,
  MeasurementModeSchema,
  bytesAvoided,
  isProviderReported,
} from "../src/measurement.js";

function baseEvent(overrides: Record<string, unknown> = {}) {
  return {
    eventId: "evt-1",
    sessionId: "ses-1",
    operation: "tool-result",
    baselineBytes: 1000,
    optimizedBytes: 200,
    measurementMode: "byte-only",
    createdAt: "2026-08-17T09:00:00.000Z",
    ...overrides,
  };
}

describe("MeasurementMode", () => {
  it("declares exactly the four documented modes", () => {
    expect([...MEASUREMENT_MODES]).toEqual([
      "provider-usage",
      "provider-count-api",
      "tokenizer-estimate",
      "byte-only",
    ]);
  });

  it("accepts every documented mode", () => {
    for (const mode of MEASUREMENT_MODES) {
      expect(MeasurementModeSchema.safeParse(mode).success).toBe(true);
    }
  });

  it("rejects an undocumented mode", () => {
    expect(MeasurementModeSchema.safeParse("estimated-actual").success).toBe(false);
  });

  it("treats only provider-returned modes as provider-reported", () => {
    expect(isProviderReported("provider-usage")).toBe(true);
    expect(isProviderReported("provider-count-api")).toBe(true);
    expect(isProviderReported("tokenizer-estimate")).toBe(false);
    expect(isProviderReported("byte-only")).toBe(false);
  });
});

describe("LedgerEventSchema", () => {
  it("accepts a minimal valid byte-only event", () => {
    expect(LedgerEventSchema.safeParse(baseEvent()).success).toBe(true);
  });

  it("rejects negative byte counts", () => {
    expect(LedgerEventSchema.safeParse(baseEvent({ baselineBytes: -1 })).success).toBe(false);
    expect(LedgerEventSchema.safeParse(baseEvent({ optimizedBytes: -1 })).success).toBe(false);
  });

  it("rejects non-integer byte counts", () => {
    expect(LedgerEventSchema.safeParse(baseEvent({ baselineBytes: 12.5 })).success).toBe(false);
  });

  it("rejects unknown fields", () => {
    const result = LedgerEventSchema.safeParse(baseEvent({ prompt: "secret text" }));
    expect(result.success).toBe(false);
  });

  it("rejects empty identifiers", () => {
    expect(LedgerEventSchema.safeParse(baseEvent({ eventId: "" })).success).toBe(false);
    expect(LedgerEventSchema.safeParse(baseEvent({ sessionId: "" })).success).toBe(false);
  });

  it("records an expansion honestly instead of rejecting it", () => {
    const expanded = LedgerEventSchema.safeParse(
      baseEvent({ baselineBytes: 100, optimizedBytes: 400 }),
    );
    expect(expanded.success).toBe(true);
    expect(bytesAvoided(expanded.data!)).toBe(-300);
  });

  it("rejects a claimed positive saving when the optimized payload is larger", () => {
    const result = LedgerEventSchema.safeParse(
      baseEvent({ baselineBytes: 100, optimizedBytes: 400, bytesAvoided: 300 }),
    );
    expect(result.success).toBe(false);
  });

  it("rejects a claimed saving that disagrees with the recorded byte counts", () => {
    const result = LedgerEventSchema.safeParse(baseEvent({ bytesAvoided: 999 }));
    expect(result.success).toBe(false);
  });

  it("accepts a claimed saving that matches the recorded byte counts", () => {
    expect(LedgerEventSchema.safeParse(baseEvent({ bytesAvoided: 800 })).success).toBe(true);
  });

  it("rejects token counts on a byte-only event", () => {
    const result = LedgerEventSchema.safeParse(
      baseEvent({ measurementMode: "byte-only", baselineTokens: 10, optimizedTokens: 4 }),
    );
    expect(result.success).toBe(false);
  });

  it("requires a named estimator for tokenizer estimates", () => {
    const missing = LedgerEventSchema.safeParse(
      baseEvent({ measurementMode: "tokenizer-estimate", baselineTokens: 10, optimizedTokens: 4 }),
    );
    expect(missing.success).toBe(false);

    const named = LedgerEventSchema.safeParse(
      baseEvent({
        measurementMode: "tokenizer-estimate",
        baselineTokens: 10,
        optimizedTokens: 4,
        estimator: "cl100k-compatible@1",
      }),
    );
    expect(named.success).toBe(true);
  });

  it("forbids an estimator label on provider-reported usage", () => {
    const result = LedgerEventSchema.safeParse(
      baseEvent({
        measurementMode: "provider-usage",
        baselineTokens: 10,
        optimizedTokens: 4,
        estimator: "cl100k-compatible@1",
      }),
    );
    expect(result.success).toBe(false);
  });

  it("accepts every operation kind and rejects unknown ones", () => {
    for (const operation of ["tool-schema", "tool-result", "resource", "skill", "workflow"]) {
      expect(LedgerEventSchema.safeParse(baseEvent({ operation })).success).toBe(true);
    }
    expect(LedgerEventSchema.safeParse(baseEvent({ operation: "prompt" })).success).toBe(false);
  });

  it("requires an ISO-8601 UTC timestamp", () => {
    expect(LedgerEventSchema.safeParse(baseEvent({ createdAt: "yesterday" })).success).toBe(false);
  });

  it("carries no raw payload field", () => {
    for (const field of ["payload", "content", "text", "body", "result", "path", "repository"]) {
      const result = LedgerEventSchema.safeParse(baseEvent({ [field]: "x" }));
      expect(result.success, `field "${field}" must be rejected`).toBe(false);
    }
  });
});
