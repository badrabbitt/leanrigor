import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runBenchmark } from "../src/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const evalsRoot = path.resolve(here, "..", "..", "..", "evals");

let outDir: string;

function capture() {
  const lines: string[] = [];
  return { lines, io: { out: (l: string) => lines.push(l), err: (l: string) => lines.push(l) } };
}

beforeEach(async () => {
  outDir = await mkdtemp(path.join(tmpdir(), "leanrigor-bench-"));
});

afterEach(async () => {
  await rm(outDir, { recursive: true, force: true });
});

describe("benchmark command", () => {
  it("runs the shipped suite end to end", async () => {
    const { lines, io } = capture();
    await runBenchmark(io, { evalsRoot, runId: "run-test", conformancePassed: true });
    const text = lines.join("\n");
    expect(text).toContain("Benchmark comparison");
    expect(text).toContain("Paired cases");
  });

  it("achieves the documented reduction target on the shipped corpus", async () => {
    const { lines, io } = capture();
    await runBenchmark(io, { evalsRoot, runId: "run-test", conformancePassed: true });
    const match = /Median context reduction\s+([\d.]+)%/.exec(lines.join("\n"));
    expect(match).not.toBeNull();
    expect(Number(match![1])).toBeGreaterThanOrEqual(40);
  });

  it("passes the release gate when conformance passed", async () => {
    const { io } = capture();
    const code = await runBenchmark(io, { evalsRoot, runId: "r", conformancePassed: true });
    expect(code).toBe(0);
  });

  it("blocks the release when conformance was not run, and says so", async () => {
    const { lines, io } = capture();
    const code = await runBenchmark(io, { evalsRoot, runId: "r", conformancePassed: false });
    expect(code).toBe(1);
    expect(lines.join("\n")).toContain("Release is blocked.");
  });

  it("always prints the quality verdict beside the reduction figure", async () => {
    const { lines, io } = capture();
    await runBenchmark(io, { evalsRoot, runId: "r", conformancePassed: true });
    const text = lines.join("\n");
    expect(text.indexOf("Median context reduction")).toBeGreaterThan(0);
    expect(text).toContain("pass-rate-delta");
  });

  it("writes a machine-readable result with its environment recorded", async () => {
    const target = path.join(outDir, "result.json");
    const { io } = capture();
    await runBenchmark(io, { evalsRoot, runId: "r", conformancePassed: true, json: target });
    const parsed = JSON.parse(await readFile(target, "utf8")) as {
      environment: { nodeVersion: string; platform: string; packageVersions: object };
      candidate: unknown[];
    };
    expect(parsed.environment.nodeVersion).toMatch(/^v\d+/);
    expect(parsed.environment.platform).toBeTruthy();
    expect(parsed.candidate.length).toBeGreaterThan(0);
  });

  it("writes a Markdown report that links every percentage to a case count", async () => {
    const target = path.join(outDir, "report.md");
    const { io } = capture();
    await runBenchmark(io, { evalsRoot, runId: "r", conformancePassed: true, markdown: target });
    const markdown = await readFile(target, "utf8");
    expect(markdown).toContain("| Metric | Value | Cases | Measurement |");
    expect(markdown).toContain("Release gate");
    expect(markdown).toContain("passed their deterministic");
  });

  it("reports a missing suite instead of inventing an empty result", async () => {
    const { lines, io } = capture();
    const code = await runBenchmark(io, { evalsRoot, suite: "does-not-exist" });
    expect(code).toBe(1);
    expect(lines.join("\n")).toContain("LR_INVALID_CONFIG");
  });

  it("is reproducible across runs", async () => {
    const first = capture();
    const second = capture();
    await runBenchmark(first.io, { evalsRoot, runId: "a", conformancePassed: true });
    await runBenchmark(second.io, { evalsRoot, runId: "b", conformancePassed: true });
    const strip = (lines: string[]) => lines.join("\n").replace(/run-[a-z0-9]+/g, "run");
    expect(strip(first.lines)).toBe(strip(second.lines));
  });
});
