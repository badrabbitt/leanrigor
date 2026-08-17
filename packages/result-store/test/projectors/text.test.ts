import { describe, expect, it } from "vitest";
import { DiffProjector, TextProjector, handleFor, unifiedDiff } from "../../src/index.js";

function input(text: string) {
  const bytes = Buffer.from(text, "utf8");
  return { bytes, handle: handleFor(bytes), schema: "text/plain" };
}

describe("TextProjector", () => {
  const projector = new TextProjector();
  const long = Array.from({ length: 500 }, (_, i) => `line ${i + 1}`).join("\n");

  it("returns the whole text losslessly when it fits", () => {
    const result = projector.project(input("short"), { maxBytes: 1000 });
    expect(result.lossPolicy).toBe("lossless");
    expect(result.view).toBe("short");
  });

  it("returns bounded head and tail sections with line numbers", () => {
    const result = projector.project(input(long), { maxBytes: 400 });
    expect(result.view).toContain("1: line 1");
    expect(result.view).toContain("500: line 500");
    expect(result.view).toContain("omitted");
    expect(Buffer.byteLength(result.view, "utf8")).toBeLessThanOrEqual(400);
  });

  it("states how many lines it omitted", () => {
    const result = projector.project(input(long), { maxBytes: 400 });
    expect(result.summary).toMatch(/500 lines/);
    expect(result.lossPolicy).toBe("reversible-lossy");
  });

  it("keeps the original handle so the full text can be fetched", () => {
    const source = input(long);
    expect(projector.project(source, { maxBytes: 400 }).originalHandle).toBe(source.handle);
  });

  it("is deterministic", () => {
    const source = input(long);
    expect(projector.project(source, { maxBytes: 400 }).view).toBe(
      projector.project(source, { maxBytes: 400 }).view,
    );
  });
});

describe("unifiedDiff", () => {
  it("preserves line numbers in hunk headers", () => {
    const before = ["a", "b", "c", "d", "e", "f", "g", "h"].join("\n");
    const after = ["a", "b", "c", "D", "e", "f", "g", "h"].join("\n");
    const diff = unifiedDiff(before, after, { context: 2 });
    expect(diff).toContain("@@ -2,5 +2,5 @@");
    expect(diff).toContain("-d");
    expect(diff).toContain("+D");
  });

  it("returns an empty diff for identical input", () => {
    expect(unifiedDiff("same\ntext", "same\ntext")).toBe("");
  });

  it("marks pure additions and deletions", () => {
    expect(unifiedDiff("a", "a\nb")).toContain("+b");
    expect(unifiedDiff("a\nb", "a")).toContain("-b");
  });
});

describe("DiffProjector", () => {
  const projector = new DiffProjector();
  const before = Array.from({ length: 300 }, (_, i) => `line ${i + 1}`).join("\n");
  const after = before.replace("line 150", "line 150 changed");

  function diffInput() {
    const bytes = Buffer.from(after, "utf8");
    return {
      bytes,
      handle: handleFor(bytes),
      previous: Buffer.from(before, "utf8"),
      schema: "text/plain",
    };
  }

  it("supports input only when a previous revision is present", () => {
    expect(projector.supports(diffInput())).toBe(true);
    expect(projector.supports(input(after))).toBe(false);
  });

  it("returns only the changed region", () => {
    const result = projector.project(diffInput(), { maxBytes: 8000 });
    expect(result.view).toContain("+line 150 changed");
    expect(result.view).not.toContain("line 10\n");
    expect(result.bytes.optimized).toBeLessThan(result.bytes.baseline);
  });

  it("keeps line numbers in the hunk header", () => {
    const result = projector.project(diffInput(), { maxBytes: 8000 });
    expect(result.view).toMatch(/@@ -\d+,\d+ \+\d+,\d+ @@/);
  });

  it("is reversible-lossy against the new revision", () => {
    const source = diffInput();
    const result = projector.project(source, { maxBytes: 8000 });
    expect(result.lossPolicy).toBe("reversible-lossy");
    expect(result.originalHandle).toBe(source.handle);
  });

  it("reports an unchanged revision without emitting a diff body", () => {
    const bytes = Buffer.from(before, "utf8");
    const result = projector.project(
      { bytes, handle: handleFor(bytes), previous: Buffer.from(before, "utf8") },
      { maxBytes: 8000 },
    );
    expect(result.view).toBe("");
    expect(result.summary).toContain("unchanged");
  });
});
