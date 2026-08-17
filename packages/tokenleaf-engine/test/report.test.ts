import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TokenLeafEngine, renderSessionReport } from "../src/index.js";

let dir: string;
let engine: TokenLeafEngine;
let counter = 0;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "leanrigor-report-"));
  engine = new TokenLeafEngine({ dataDir: dir, projectId: "proj" });
  counter = 0;
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function estimateEvent(overrides: Record<string, unknown> = {}) {
  counter += 1;
  return {
    eventId: `evt-${counter}`,
    sessionId: "session-1",
    operation: "tool-result" as const,
    baselineBytes: 4000,
    optimizedBytes: 1000,
    measurementMode: "tokenizer-estimate" as const,
    estimator: "cl100k-compatible@1",
    createdAt: "2026-08-17T09:00:00.000Z",
    ...overrides,
  };
}

const passedEvent = (o: Record<string, unknown> = {}) => estimateEvent({ passed: true, ...o });
const failedEvent = (o: Record<string, unknown> = {}) => estimateEvent({ passed: false, ...o });

describe("sessionReport", () => {
  it("excludes savings from failed tasks", async () => {
    await engine.record(passedEvent({ baselineTokens: 100, optimizedTokens: 40 }) as never);
    await engine.record(failedEvent({ baselineTokens: 1000, optimizedTokens: 1 }) as never);
    const report = await engine.sessionReport("session-1");
    expect(report.qualityAdjustedTokensAvoided).toBe(60);
  });

  it("excludes savings from tasks missing mandatory gate evidence", async () => {
    await engine.record(
      passedEvent({ baselineTokens: 100, optimizedTokens: 40, requiredGatesPassed: false }) as never,
    );
    const report = await engine.sessionReport("session-1");
    expect(report.qualityAdjustedTokensAvoided).toBe(0);
    expect(report.excludedEvents).toBe(1);
  });

  it("treats an unknown verdict as not counted", async () => {
    await engine.record(estimateEvent({ baselineTokens: 100, optimizedTokens: 40 }) as never);
    const report = await engine.sessionReport("session-1");
    expect(report.qualityAdjustedTokensAvoided).toBe(0);
  });

  it("reports gross totals separately from quality-adjusted totals", async () => {
    await engine.record(passedEvent({ baselineTokens: 100, optimizedTokens: 40 }) as never);
    await engine.record(failedEvent({ baselineTokens: 1000, optimizedTokens: 1 }) as never);
    const report = await engine.sessionReport("session-1");
    expect(report.grossTokensAvoided).toBe(1059);
    expect(report.qualityAdjustedTokensAvoided).toBe(60);
  });

  it("counts an expansion as a negative saving rather than zero", async () => {
    await engine.record(
      passedEvent({
        baselineBytes: 100,
        optimizedBytes: 400,
        baselineTokens: 10,
        optimizedTokens: 50,
      }) as never,
    );
    const report = await engine.sessionReport("session-1");
    expect(report.qualityAdjustedTokensAvoided).toBe(-40);
    expect(report.bytes.avoided).toBe(-300);
  });

  it("never merges unlike measurement modes into one unlabelled token total", async () => {
    await engine.record(passedEvent({ baselineTokens: 100, optimizedTokens: 40 }) as never);
    await engine.record(
      estimateEvent({
        passed: true,
        measurementMode: "provider-usage",
        estimator: undefined,
        baselineTokens: 500,
        optimizedTokens: 200,
      }) as never,
    );
    const report = await engine.sessionReport("session-1");
    expect(report.qualityAdjustedTokensAvoided).toBeUndefined();
    expect(report.byMode["tokenizer-estimate"]?.qualityAdjustedTokensAvoided).toBe(60);
    expect(report.byMode["provider-usage"]?.qualityAdjustedTokensAvoided).toBe(300);
  });

  it("separates the four measurement modes in coverage", async () => {
    await engine.record(
      passedEvent({ measurementMode: "byte-only", estimator: undefined }) as never,
    );
    await engine.record(passedEvent({ baselineTokens: 10, optimizedTokens: 5 }) as never);
    const report = await engine.sessionReport("session-1");
    expect(Object.keys(report.byMode).sort()).toEqual(["byte-only", "tokenizer-estimate"]);
    expect(report.byMode["byte-only"]?.tokensMeasured).toBe(false);
  });

  it("reports the task pass rate over events with a verdict", async () => {
    await engine.record(passedEvent({ baselineTokens: 10, optimizedTokens: 5 }) as never);
    await engine.record(passedEvent({ baselineTokens: 10, optimizedTokens: 5 }) as never);
    await engine.record(failedEvent({ baselineTokens: 10, optimizedTokens: 5 }) as never);
    const report = await engine.sessionReport("session-1");
    expect(report.verifiedEvents).toBe(3);
    expect(report.passedEvents).toBe(2);
    expect(report.taskPassRate).toBeCloseTo(2 / 3, 10);
  });

  it("ignores events from other sessions", async () => {
    await engine.record(passedEvent({ baselineTokens: 10, optimizedTokens: 5 }) as never);
    await engine.record(
      passedEvent({ sessionId: "session-2", baselineTokens: 999, optimizedTokens: 1 }) as never,
    );
    const report = await engine.sessionReport("session-1");
    expect(report.totalEvents).toBe(1);
  });

  it("lists the estimators that contributed to the report", async () => {
    await engine.record(passedEvent({ baselineTokens: 10, optimizedTokens: 5 }) as never);
    const report = await engine.sessionReport("session-1");
    expect(report.estimators).toEqual(["cl100k-compatible@1"]);
  });

  it("returns an empty report for an unknown session", async () => {
    const report = await engine.sessionReport("nothing");
    expect(report.totalEvents).toBe(0);
    expect(report.qualityAdjustedTokensAvoided).toBe(0);
  });
});

describe("renderSessionReport", () => {
  it("leads with verified outcome before savings", async () => {
    await engine.record(passedEvent({ baselineTokens: 100, optimizedTokens: 40 }) as never);
    const text = renderSessionReport(await engine.sessionReport("session-1"));
    const outcomeAt = text.indexOf("Verified");
    const savingsAt = text.indexOf("Estimated");
    expect(outcomeAt).toBeGreaterThanOrEqual(0);
    expect(outcomeAt).toBeLessThan(savingsAt);
  });

  it("labels token figures as estimates and never as actual usage", async () => {
    await engine.record(passedEvent({ baselineTokens: 100, optimizedTokens: 40 }) as never);
    const text = renderSessionReport(await engine.sessionReport("session-1"));
    expect(text).toContain("Estimated tool-context tokens avoided");
    expect(text).toContain("cl100k-compatible@1");
    expect(text.toLowerCase()).not.toContain("actual tokens");
    expect(text.toLowerCase()).not.toContain("exact co2");
  });

  it("prints per-mode lines instead of one total when modes are mixed", async () => {
    await engine.record(passedEvent({ baselineTokens: 100, optimizedTokens: 40 }) as never);
    await engine.record(
      estimateEvent({
        passed: true,
        measurementMode: "provider-usage",
        estimator: undefined,
        baselineTokens: 500,
        optimizedTokens: 200,
      }) as never,
    );
    const text = renderSessionReport(await engine.sessionReport("session-1"));
    expect(text).toContain("provider-usage");
    expect(text).toContain("tokenizer-estimate");
    expect(text).toContain("mixed measurement modes");
  });

  it("states measurement coverage", async () => {
    await engine.record(passedEvent({ baselineTokens: 10, optimizedTokens: 5 }) as never);
    const text = renderSessionReport(await engine.sessionReport("session-1"));
    expect(text).toContain("Coverage:");
  });

  it("hides environmental output by default", async () => {
    await engine.record(passedEvent({ baselineTokens: 10, optimizedTokens: 5 }) as never);
    const text = renderSessionReport(await engine.sessionReport("session-1"));
    expect(text).toContain("Environmental estimate: disabled");
  });
});
