import { describe, expect, it } from "vitest";
import { LogProjector, handleFor } from "../../src/index.js";

const projector = new LogProjector();

function input(text: string) {
  const bytes = Buffer.from(text, "utf8");
  return { bytes, handle: handleFor(bytes), schema: "text/plain" };
}

const repetitive = [
  ...Array.from({ length: 200 }, (_, i) => `2026-08-17T09:00:${String(i % 60).padStart(2, "0")}Z INFO fetching module ${i}`),
  "2026-08-17T09:05:00Z ERROR Cannot find module 'left-pad'",
  ...Array.from({ length: 50 }, () => "2026-08-17T09:05:01Z WARN retrying"),
].join("\n");

describe("LogProjector", () => {
  it("accepts line-oriented text", () => {
    expect(projector.supports(input(repetitive))).toBe(true);
  });

  it("groups repeated lines and keeps an exact repetition count", () => {
    const result = projector.project(input(repetitive), { maxBytes: 8000 });
    const view = JSON.parse(result.view) as { groups: { count: number; sample: string }[] };
    const retry = view.groups.find((g) => g.sample.includes("retrying"));
    expect(retry?.count).toBe(50);
  });

  it("normalizes timestamps and numbers so near-identical lines collapse", () => {
    const result = projector.project(input(repetitive), { maxBytes: 8000 });
    const view = JSON.parse(result.view) as { groups: { count: number; sample: string }[] };
    const fetching = view.groups.find((g) => g.sample.includes("fetching module"));
    expect(fetching?.count).toBe(200);
  });

  it("reports the first error with its original line number", () => {
    const result = projector.project(input(repetitive), { maxBytes: 8000 });
    const view = JSON.parse(result.view) as {
      firstError: { line: number; text: string } | null;
    };
    expect(view.firstError?.line).toBe(201);
    expect(view.firstError?.text).toContain("Cannot find module 'left-pad'");
  });

  it("reports no error when the log is clean", () => {
    const result = projector.project(input("INFO ok\nINFO ok\n"), { maxBytes: 8000 });
    const view = JSON.parse(result.view) as { firstError: unknown };
    expect(view.firstError).toBeNull();
  });

  it("counts total and distinct lines", () => {
    const result = projector.project(input(repetitive), { maxBytes: 8000 });
    const view = JSON.parse(result.view) as { totalLines: number; distinctGroups: number };
    expect(view.totalLines).toBe(251);
    expect(view.distinctGroups).toBe(3);
  });

  it("reduces the payload and stays reversible", () => {
    const source = input(repetitive);
    const result = projector.project(source, { maxBytes: 8000 });
    expect(result.bytes.optimized).toBeLessThan(result.bytes.baseline);
    expect(result.originalHandle).toBe(source.handle);
    expect(result.lossPolicy).toBe("reversible-lossy");
  });

  it("emits valid JSON with fewer groups when over budget", () => {
    const alphabet = "abcdefghijklmnopqrstuvwxyz";
    const many = Array.from(
      { length: 400 },
      (_, i) =>
        `INFO distinct subsystem ${alphabet[i % 26]}${alphabet[(i * 7) % 26]}${alphabet[(i * 13) % 26]} reported a unique condition`,
    ).join("\n");
    const result = projector.project(input(many), { maxBytes: 400 });
    expect(() => JSON.parse(result.view)).not.toThrow();
    expect(Buffer.byteLength(result.view, "utf8")).toBeLessThanOrEqual(400);
    expect(result.lossPolicy).toBe("summary-only");
  });

  it("orders groups by descending count deterministically", () => {
    const result = projector.project(input(repetitive), { maxBytes: 8000 });
    const view = JSON.parse(result.view) as { groups: { count: number }[] };
    const counts = view.groups.map((g) => g.count);
    expect([...counts].sort((a, b) => b - a)).toEqual(counts);
  });
});
