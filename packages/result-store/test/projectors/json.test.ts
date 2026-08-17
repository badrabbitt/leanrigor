import { describe, expect, it } from "vitest";
import { JsonProjector, handleFor } from "../../src/index.js";

const projector = new JsonProjector();

function input(value: unknown) {
  const bytes = Buffer.from(JSON.stringify(value), "utf8");
  return { bytes, handle: handleFor(bytes), schema: "application/json" };
}

const issues = Array.from({ length: 482 }, (_, i) => ({
  number: i + 1,
  title: `Issue ${i + 1}`,
  state: i < 19 ? "open" : "closed",
  labels: i % 100 === 0 ? ["security"] : [],
  body: "x".repeat(400),
  user: { login: `user-${i}`, id: i },
}));

describe("JsonProjector.supports", () => {
  it("accepts JSON payloads", () => {
    expect(projector.supports(input({ a: 1 }))).toBe(true);
  });

  it("rejects payloads that are not JSON", () => {
    const bytes = Buffer.from("not json at all", "utf8");
    expect(projector.supports({ bytes, handle: handleFor(bytes) })).toBe(false);
  });
});

describe("JsonProjector on arrays", () => {
  it("returns a page rather than the whole array", () => {
    const result = projector.project(input(issues), { maxBytes: 64_000, pageSize: 5 });
    const view = JSON.parse(result.view) as { items: unknown[]; page: unknown };
    expect(view.items).toHaveLength(5);
    expect(view.page).toMatchObject({ index: 0, size: 5, totalItems: 482 });
  });

  it("applies a field allowlist and preserves the original value types", () => {
    const result = projector.project(input(issues), {
      maxBytes: 64_000,
      pageSize: 2,
      fields: ["number", "state", "labels"],
    });
    const view = JSON.parse(result.view) as { items: Record<string, unknown>[] };
    expect(Object.keys(view.items[0]!).sort()).toEqual(["labels", "number", "state"]);
    expect(view.items[0]!.number).toBe(1);
    expect(typeof view.items[0]!.number).toBe("number");
    expect(view.items[0]!.state).toBe("open");
    expect(Array.isArray(view.items[0]!.labels)).toBe(true);
  });

  it("returns a later page", () => {
    const result = projector.project(input(issues), { maxBytes: 64_000, pageSize: 5, page: 2 });
    const view = JSON.parse(result.view) as { items: { number: number }[] };
    expect(view.items[0]!.number).toBe(11);
  });

  it("is reversible-lossy and carries the original handle", () => {
    const source = input(issues);
    const result = projector.project(source, { maxBytes: 64_000, pageSize: 5 });
    expect(result.lossPolicy).toBe("reversible-lossy");
    expect(result.originalHandle).toBe(source.handle);
  });

  it("summarizes the collection without reading the payload back", () => {
    const result = projector.project(input(issues), { maxBytes: 64_000, pageSize: 5 });
    expect(result.summary).toContain("482");
  });

  it("advertises the views the agent can request next", () => {
    const result = projector.project(input(issues), { maxBytes: 64_000, pageSize: 5 });
    expect(result.availableViews).toContain("fields");
    expect(result.availableViews).toContain("page");
  });

  it("emits a smaller valid index instead of truncating JSON when over budget", () => {
    const result = projector.project(input(issues), { maxBytes: 512, pageSize: 100 });
    expect(() => JSON.parse(result.view)).not.toThrow();
    expect(Buffer.byteLength(result.view, "utf8")).toBeLessThanOrEqual(512);
    expect(result.lossPolicy).toBe("summary-only");
  });

  it("reports both byte counts so the saving can be measured", () => {
    const source = input(issues);
    const result = projector.project(source, { maxBytes: 64_000, pageSize: 5 });
    expect(result.bytes.baseline).toBe(source.bytes.byteLength);
    expect(result.bytes.optimized).toBe(Buffer.byteLength(result.view, "utf8"));
    expect(result.bytes.optimized).toBeLessThan(result.bytes.baseline);
  });

  it("is deterministic", () => {
    const source = input(issues);
    const a = projector.project(source, { maxBytes: 64_000, pageSize: 5 });
    const b = projector.project(source, { maxBytes: 64_000, pageSize: 5 });
    expect(a.view).toBe(b.view);
  });
});

describe("JsonProjector on objects", () => {
  it("describes the shape and preserves scalar values that fit", () => {
    const result = projector.project(input({ ok: true, count: 3, name: "abc", nested: { a: 1 } }), {
      maxBytes: 64_000,
    });
    const view = JSON.parse(result.view) as Record<string, unknown>;
    expect(view.ok).toBe(true);
    expect(view.count).toBe(3);
  });

  it("is lossless when the whole payload already fits the budget", () => {
    const result = projector.project(input({ a: 1 }), { maxBytes: 64_000 });
    expect(result.lossPolicy).toBe("lossless");
    expect(JSON.parse(result.view)).toEqual({ a: 1 });
  });

  it("keeps null distinct from missing", () => {
    const result = projector.project(input({ a: null }), { maxBytes: 64_000 });
    expect(JSON.parse(result.view)).toEqual({ a: null });
  });
});
