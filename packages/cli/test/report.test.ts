import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TokenLeafEngine } from "@leanrigor/tokenleaf";
import { runReport, toShareCard } from "../src/commands/report.js";
import { renderReport } from "../src/render/terminal.js";

let dataDir: string;
let engine: TokenLeafEngine;
let counter = 0;

function capture() {
  const lines: string[] = [];
  return { lines, io: { out: (l: string) => lines.push(l), err: (l: string) => lines.push(l) } };
}

function event(overrides: Record<string, unknown> = {}) {
  counter += 1;
  return {
    eventId: `evt-${counter}`,
    sessionId: "session-1",
    operation: "tool-result" as const,
    baselineBytes: 40_000,
    optimizedBytes: 4000,
    measurementMode: "byte-only" as const,
    passed: true,
    requiredGatesPassed: true,
    createdAt: "2026-08-17T09:00:00.000Z",
    ...overrides,
  };
}

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), "leanrigor-report-cmd-"));
  engine = new TokenLeafEngine({ dataDir, projectId: "default" });
  counter = 0;
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

describe("report ordering", () => {
  it("leads with the verified outcome, before any savings figure", async () => {
    await engine.record(event() as never);
    const { lines, io } = capture();
    await runReport(io, { dataDir, sessionId: "session-1" });
    const text = lines.join("\n");
    expect(text.indexOf("Verified events passed")).toBeLessThan(text.indexOf("bytes avoided"));
  });

  it("shows required gate coverage above the savings", async () => {
    await engine.record(event() as never);
    const { lines, io } = capture();
    await runReport(io, {
      dataDir,
      sessionId: "session-1",
      gates: { required: 12, passed: 12, skippedWithReason: 0 },
    });
    const text = lines.join("\n");
    expect(text).toContain("Required Rigor Gates passed");
    expect(text.indexOf("Required Rigor Gates")).toBeLessThan(text.indexOf("tokens avoided"));
  });

  it("reports gates skipped with a reason separately from gates passed", async () => {
    await engine.record(event() as never);
    const { lines, io } = capture();
    await runReport(io, {
      dataDir,
      sessionId: "session-1",
      gates: { required: 12, passed: 10, skippedWithReason: 2 },
    });
    const text = lines.join("\n");
    expect(text).toContain("10 / 12");
    expect(text).toContain("Gates skipped with a reason");
  });
});

describe("measurement modes", () => {
  const snapshot = (lines: string[]) =>
    lines
      .join("\n")
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => line.replace(/\d[\d,]*/g, "<n>"));

  it("renders a byte-only session", async () => {
    await engine.record(event() as never);
    const { lines, io } = capture();
    await runReport(io, { dataDir, sessionId: "session-1" });
    expect(snapshot(lines)).toMatchInlineSnapshot(`
      [
        "LeanRigor session report — powered by TokenLeaf Engine",
        "Verified events passed                           <n> / <n>",
        "Verified pass rate                              <n>.<n>%",
        "Events excluded from savings                         <n>",
        "Operations optimized                                 <n>",
        "Raw payload bytes                               <n>",
        "Returned payload bytes                           <n>",
        "Payload bytes avoided                           <n>",
        "Estimated tool-context tokens avoided                <n>",
        "Measurement: byte measurement only",
        "Coverage: payloads handled by LeanRigor only",
        "Environmental estimate: disabled",
      ]
    `);
  });

  it("labels a tokenizer estimate with its estimator", async () => {
    await engine.record(
      event({
        measurementMode: "tokenizer-estimate",
        estimator: "cl100k@1",
        baselineTokens: 10_000,
        optimizedTokens: 1000,
      }) as never,
    );
    const { lines, io } = capture();
    await runReport(io, { dataDir, sessionId: "session-1" });
    expect(lines.join("\n")).toContain("Measurement: cl100k@1");
  });

  it("never calls a local estimate actual usage", async () => {
    await engine.record(
      event({
        measurementMode: "tokenizer-estimate",
        estimator: "cl100k@1",
        baselineTokens: 10,
        optimizedTokens: 5,
      }) as never,
    );
    const { lines, io } = capture();
    await runReport(io, { dataDir, sessionId: "session-1" });
    const text = lines.join("\n").toLowerCase();
    expect(text).not.toContain("actual tokens");
    expect(text).not.toContain("actual usage");
  });

  it("splits mixed measurement modes instead of adding them", async () => {
    await engine.record(
      event({
        measurementMode: "tokenizer-estimate",
        estimator: "cl100k@1",
        baselineTokens: 100,
        optimizedTokens: 40,
      }) as never,
    );
    await engine.record(
      event({
        measurementMode: "provider-usage",
        baselineTokens: 500,
        optimizedTokens: 200,
      }) as never,
    );
    const { lines, io } = capture();
    await runReport(io, { dataDir, sessionId: "session-1" });
    const text = lines.join("\n");
    expect(text).toContain("mixed measurement modes");
    expect(text).toContain("provider-usage");
  });
});

describe("environmental output", () => {
  it("is hidden unless explicitly enabled", async () => {
    await engine.record(event() as never);
    const { lines, io } = capture();
    await runReport(io, { dataDir, sessionId: "session-1" });
    expect(lines.join("\n")).toContain("Environmental estimate: disabled");
  });

  it("appears when enabled, labelled as an estimate", async () => {
    await engine.record(event() as never);
    const { lines, io } = capture();
    await runReport(io, { dataDir, sessionId: "session-1", energy: true });
    const text = lines.join("\n");
    expect(text).toContain("Environmental estimate (not a measurement)");
    expect(text.toLowerCase()).not.toContain("exact co2");
  });
});

describe("json output", () => {
  it("emits the typed session report", async () => {
    await engine.record(event() as never);
    const { lines, io } = capture();
    await runReport(io, { dataDir, sessionId: "session-1", json: true });
    const parsed = JSON.parse(lines.join("\n")) as { sessionId: string; totalEvents: number };
    expect(parsed.sessionId).toBe("session-1");
    expect(parsed.totalEvents).toBe(1);
  });
});

describe("empty state", () => {
  it("renders a report with no events without inventing numbers", async () => {
    const { lines, io } = capture();
    await runReport(io, { dataDir, sessionId: "nothing" });
    const text = lines.join("\n");
    expect(text).toContain("no verdict");
    expect(text).toContain("Operations optimized");
  });
});

describe("renderReport", () => {
  it("shows a benchmark figure with its case count when supplied", () => {
    const text = renderReport({
      session: {
        sessionId: "s",
        totalEvents: 0,
        countedEvents: 0,
        excludedEvents: 0,
        verifiedEvents: 0,
        passedEvents: 0,
        taskPassRate: undefined,
        bytes: { baseline: 0, optimized: 0, avoided: 0, qualityAdjustedAvoided: 0 },
        byMode: {},
        grossTokensAvoided: 0,
        qualityAdjustedTokensAvoided: 0,
        tokenMeasurementModes: [],
        estimators: [],
      },
      benchmark: { medianReduction: 0.933, cases: 8 },
    });
    expect(text).toContain("93.3%");
    expect(text).toContain("over cases");
  });
});

describe("toShareCard", () => {
  it("carries counts only, with no identifying field", async () => {
    await engine.record(event() as never);
    const card = toShareCard(await engine.sessionReport("session-1"));
    for (const key of Object.keys(card)) {
      expect(["sessionId", "projectId", "path", "repository", "handle"]).not.toContain(key);
    }
  });
});
