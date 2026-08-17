import { describe, expect, it } from "vitest";
import { LeanRigorError } from "@leanrigor/core";
import {
  DEFAULT_THRESHOLDS,
  compareRuns,
  evaluateReleaseGate,
  renderReleaseGate,
  type CaseResult,
} from "../src/index.js";

function result(overrides: Partial<CaseResult> = {}): CaseResult {
  return {
    caseId: "case-1",
    runId: "run-1",
    condition: "gateway",
    completed: true,
    passed: true,
    requiredGatesPassed: true,
    baselineBytes: 10_000,
    optimizedBytes: 2000,
    measurementMode: "byte-only",
    durationMs: 5,
    toolCalls: 1,
    retries: 0,
    errors: 0,
    ...overrides,
  };
}

function pair(count: number, candidateOverrides: Partial<CaseResult> = {}) {
  const baseline = Array.from({ length: count }, (_, i) =>
    result({ caseId: `case-${i}`, condition: "baseline", optimizedBytes: 10_000 }),
  );
  const candidate = Array.from({ length: count }, (_, i) =>
    result({ caseId: `case-${i}`, ...candidateOverrides }),
  );
  return compareRuns(baseline, candidate);
}

describe("compareRuns", () => {
  it("pairs cases by id", () => {
    const comparison = pair(3);
    expect(comparison.pairedCaseIds).toEqual(["case-0", "case-1", "case-2"]);
    expect(comparison.unpairedCaseIds).toEqual([]);
  });

  it("excludes and reports unpaired cases instead of averaging them in", () => {
    const comparison = compareRuns(
      [result({ caseId: "a" }), result({ caseId: "b" })],
      [result({ caseId: "a" })],
    );
    expect(comparison.pairedCaseIds).toEqual(["a"]);
    expect(comparison.unpairedCaseIds).toEqual(["b"]);
  });

  it("refuses to compare incompatible measurement modes", () => {
    expect(() =>
      compareRuns(
        [result({ caseId: "a", measurementMode: "byte-only" })],
        [result({ caseId: "a", measurementMode: "provider-usage" })],
      ),
    ).toThrow(LeanRigorError);
  });

  it("computes the pass-rate delta in the candidate's favour when it improves", () => {
    const comparison = compareRuns(
      [result({ caseId: "a", passed: false, condition: "baseline" })],
      [result({ caseId: "a", passed: true })],
    );
    expect(comparison.passRateDelta).toBe(1);
  });

  it("measures reduction only over passing cases", () => {
    const comparison = compareRuns(
      [result({ caseId: "a", condition: "baseline", optimizedBytes: 10_000 })],
      [result({ caseId: "a", passed: false, optimizedBytes: 1 })],
    );
    expect(comparison.medianContextReduction).toBe(0);
  });
});

describe("release gate", () => {
  const passing = () =>
    evaluateReleaseGate({ comparison: pair(10), conformancePassed: true });

  it("passes a clean run and permits a savings claim", () => {
    const gate = passing();
    expect(gate.passed).toBe(true);
    expect(gate.mayAdvertiseSavings).toBe(true);
  });

  it("reports every documented check", () => {
    expect(passing().checks.map((check) => check.id)).toEqual([
      "completion-rate",
      "pass-rate-delta",
      "median-context-reduction",
      "no-critical-violations",
      "mcp-conformance",
    ]);
  });

  it("refuses a savings claim when high savings sit beside failed tasks", () => {
    const baseline = Array.from({ length: 10 }, (_, i) =>
      result({ caseId: `case-${i}`, condition: "baseline", optimizedBytes: 10_000 }),
    );
    const candidate = Array.from({ length: 10 }, (_, i) =>
      result({ caseId: `case-${i}`, passed: i < 3, optimizedBytes: 1 }),
    );
    const gate = evaluateReleaseGate({
      comparison: compareRuns(baseline, candidate),
      conformancePassed: true,
    });
    expect(gate.mayAdvertiseSavings).toBe(false);
    expect(gate.passed).toBe(false);
    expect(gate.checks.find((c) => c.id === "pass-rate-delta")?.passed).toBe(false);
  });

  it("fails when fewer than 90% of cases completed", () => {
    const baseline = Array.from({ length: 10 }, (_, i) =>
      result({ caseId: `case-${i}`, condition: "baseline", optimizedBytes: 10_000 }),
    );
    const candidate = Array.from({ length: 10 }, (_, i) =>
      result({ caseId: `case-${i}`, completed: i < 8 }),
    );
    const gate = evaluateReleaseGate({
      comparison: compareRuns(baseline, candidate),
      conformancePassed: true,
    });
    expect(gate.checks.find((c) => c.id === "completion-rate")?.passed).toBe(false);
    expect(gate.mayAdvertiseSavings).toBe(false);
  });

  it("fails a pass-rate delta worse than minus two points", () => {
    const baseline = Array.from({ length: 100 }, (_, i) =>
      result({ caseId: `case-${i}`, condition: "baseline", optimizedBytes: 10_000 }),
    );
    const candidate = Array.from({ length: 100 }, (_, i) =>
      result({ caseId: `case-${i}`, passed: i >= 3 }),
    );
    const gate = evaluateReleaseGate({
      comparison: compareRuns(baseline, candidate),
      conformancePassed: true,
    });
    expect(gate.checks.find((c) => c.id === "pass-rate-delta")?.passed).toBe(false);
  });

  it("accepts a pass-rate delta of exactly minus two points", () => {
    const baseline = Array.from({ length: 100 }, (_, i) =>
      result({ caseId: `case-${i}`, condition: "baseline", optimizedBytes: 10_000 }),
    );
    const candidate = Array.from({ length: 100 }, (_, i) =>
      result({ caseId: `case-${i}`, passed: i >= 2 }),
    );
    const gate = evaluateReleaseGate({
      comparison: compareRuns(baseline, candidate),
      conformancePassed: true,
    });
    expect(gate.checks.find((c) => c.id === "pass-rate-delta")?.passed).toBe(true);
  });

  it("refuses a savings claim below a 40% median reduction", () => {
    const gate = evaluateReleaseGate({
      comparison: pair(10, { optimizedBytes: 7000 }),
      conformancePassed: true,
    });
    expect(gate.checks.find((c) => c.id === "median-context-reduction")?.passed).toBe(false);
    expect(gate.mayAdvertiseSavings).toBe(false);
    // Quality was fine, so the build itself is not blocked.
    expect(gate.passed).toBe(true);
  });

  it("blocks the release on an open critical violation", () => {
    const gate = evaluateReleaseGate({
      comparison: pair(10),
      conformancePassed: true,
      openCriticalViolations: 1,
    });
    expect(gate.passed).toBe(false);
    expect(gate.mayAdvertiseSavings).toBe(false);
  });

  it("blocks the release when MCP conformance did not pass", () => {
    const gate = evaluateReleaseGate({ comparison: pair(10), conformancePassed: false });
    expect(gate.passed).toBe(false);
  });

  it("states the number behind every verdict", () => {
    for (const check of passing().checks) {
      expect(check.detail.length).toBeGreaterThan(10);
    }
    expect(passing().checks[0]!.detail).toMatch(/\d/);
  });

  it("uses the documented default thresholds", () => {
    expect(DEFAULT_THRESHOLDS).toEqual({
      minimumCompletionRate: 0.9,
      maximumPassRateDeltaPoints: -2,
      minimumMedianReduction: 0.4,
    });
  });
});

describe("renderReleaseGate", () => {
  it("says plainly when savings may not be advertised", () => {
    const gate = evaluateReleaseGate({
      comparison: pair(10, { optimizedBytes: 9000 }),
      conformancePassed: true,
    });
    expect(renderReleaseGate(gate)).toContain("may NOT advertise savings");
  });

  it("says plainly when the release is blocked", () => {
    const gate = evaluateReleaseGate({ comparison: pair(10), conformancePassed: false });
    expect(renderReleaseGate(gate)).toContain("Release is blocked.");
  });
});
