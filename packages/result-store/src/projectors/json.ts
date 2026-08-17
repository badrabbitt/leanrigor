import {
  byteLength,
  withinBudget,
  type ProjectionBudget,
  type ProjectionInput,
  type ProjectionResult,
  type Projector,
} from "./types.js";

function parse(input: ProjectionInput): unknown | undefined {
  try {
    return JSON.parse(input.bytes.toString("utf8")) as unknown;
  } catch {
    return undefined;
  }
}

/** Describes a value's type without reproducing it. */
function typeOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return `array[${value.length}]`;
  return typeof value;
}

function pick(item: unknown, fields: readonly string[] | undefined): unknown {
  if (!fields || typeof item !== "object" || item === null || Array.isArray(item)) return item;
  const source = item as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  // Field order follows the allowlist so the view is deterministic.
  for (const field of fields) {
    if (Object.hasOwn(source, field)) out[field] = source[field];
  }
  return out;
}

/**
 * Projects JSON structurally: arrays become a page plus a shape index, objects
 * keep their scalars and describe their nested members.
 *
 * The projector never rewrites values, so a field the model reads has exactly
 * the type and content it had upstream. When the view exceeds its budget the
 * projector falls back to a smaller *valid* document rather than truncating
 * JSON mid-token.
 */
export class JsonProjector implements Projector {
  readonly name = "json";

  supports(input: ProjectionInput): boolean {
    return parse(input) !== undefined;
  }

  project(input: ProjectionInput, budget: ProjectionBudget): ProjectionResult {
    const value = parse(input);
    const baseline = input.bytes.byteLength;
    const whole = input.bytes.toString("utf8");

    const base = {
      projector: this.name,
      originalHandle: input.handle,
    } as const;

    if (value === undefined) {
      const summary = `${baseline} bytes of non-JSON content`;
      return {
        ...base,
        lossPolicy: "summary-only",
        summary,
        view: JSON.stringify({ error: "not-json", byteLength: baseline }),
        availableViews: ["raw"],
        bytes: { baseline, optimized: byteLength(summary) },
      };
    }

    if (withinBudget(whole, budget)) {
      return {
        ...base,
        lossPolicy: "lossless",
        summary: `complete JSON document, ${baseline} bytes`,
        view: whole,
        availableViews: [],
        bytes: { baseline, optimized: byteLength(whole) },
      };
    }

    if (Array.isArray(value)) return this.#projectArray(input, budget, value, baseline);
    return this.#projectObject(input, budget, value as Record<string, unknown>, baseline);
  }

  #projectArray(
    input: ProjectionInput,
    budget: ProjectionBudget,
    items: unknown[],
    baseline: number,
  ): ProjectionResult {
    const size = Math.max(1, budget.pageSize ?? 20);
    const pageIndex = Math.max(0, budget.page ?? 0);
    const start = pageIndex * size;
    const page = items.slice(start, start + size).map((item) => pick(item, budget.fields));

    const first = items[0];
    const fieldNames =
      typeof first === "object" && first !== null && !Array.isArray(first)
        ? Object.keys(first as Record<string, unknown>)
        : [];

    const summary = `${items.length} items; showing ${page.length} from index ${start}`;
    const view = JSON.stringify({
      page: { index: pageIndex, size, start, totalItems: items.length },
      fields: fieldNames,
      items: page,
    });

    if (withinBudget(view, budget)) {
      return {
        projector: this.name,
        originalHandle: input.handle,
        lossPolicy: "reversible-lossy",
        summary,
        view,
        availableViews: ["page", "fields", "raw"],
        bytes: { baseline, optimized: byteLength(view) },
      };
    }

    // Over budget: emit a valid index describing the collection instead of a
    // truncated document.
    const index = JSON.stringify({
      page: { index: pageIndex, size: 0, totalItems: items.length },
      fields: fieldNames,
      items: [],
    });
    return {
      projector: this.name,
      originalHandle: input.handle,
      lossPolicy: "summary-only",
      summary,
      view: withinBudget(index, budget) ? index : JSON.stringify({ totalItems: items.length }),
      availableViews: ["page", "fields", "raw"],
      bytes: { baseline, optimized: byteLength(index) },
    };
  }

  #projectObject(
    input: ProjectionInput,
    budget: ProjectionBudget,
    value: Record<string, unknown>,
    baseline: number,
  ): ProjectionResult {
    const scalars: Record<string, unknown> = {};
    const shape: Record<string, string> = {};

    for (const [key, member] of Object.entries(value)) {
      if (member === null || typeof member !== "object") scalars[key] = member;
      else shape[key] = typeOf(member);
    }

    const summary = `JSON object with ${Object.keys(value).length} keys, ${baseline} bytes`;
    const view = JSON.stringify(
      Object.keys(shape).length === 0 ? scalars : { ...scalars, _shape: shape },
    );

    if (withinBudget(view, budget)) {
      return {
        projector: this.name,
        originalHandle: input.handle,
        lossPolicy: "reversible-lossy",
        summary,
        view,
        availableViews: ["fields", "raw"],
        bytes: { baseline, optimized: byteLength(view) },
      };
    }

    const index = JSON.stringify({ keys: Object.keys(value), byteLength: baseline });
    return {
      projector: this.name,
      originalHandle: input.handle,
      lossPolicy: "summary-only",
      summary,
      view: withinBudget(index, budget) ? index : JSON.stringify({ byteLength: baseline }),
      availableViews: ["fields", "raw"],
      bytes: { baseline, optimized: byteLength(index) },
    };
  }
}
