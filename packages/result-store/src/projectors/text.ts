import {
  byteLength,
  withinBudget,
  type ProjectionBudget,
  type ProjectionInput,
  type ProjectionResult,
  type Projector,
} from "./types.js";

/**
 * Projects free text as a bounded head and tail with original line numbers.
 *
 * Line numbers are preserved because a reader who wants the omitted middle must
 * be able to ask for it precisely.
 */
export class TextProjector implements Projector {
  readonly name = "text";

  supports(input: ProjectionInput): boolean {
    return input.bytes.length > 0;
  }

  project(input: ProjectionInput, budget: ProjectionBudget): ProjectionResult {
    const baseline = input.bytes.byteLength;
    const text = input.bytes.toString("utf8");

    if (withinBudget(text, budget)) {
      return {
        projector: this.name,
        originalHandle: input.handle,
        lossPolicy: "lossless",
        summary: `complete text, ${baseline} bytes`,
        view: text,
        availableViews: [],
        bytes: { baseline, optimized: byteLength(text) },
      };
    }

    const lines = text.split("\n");
    const numbered = lines.map((line, index) => `${index + 1}: ${line}`);

    const render = (headCount: number, tailCount: number): string => {
      const head = numbered.slice(0, headCount);
      const tail = tailCount > 0 ? numbered.slice(numbered.length - tailCount) : [];
      const omitted = numbered.length - headCount - tailCount;
      const middle = omitted > 0 ? [`… ${omitted} lines omitted; fetch the handle for the rest`] : [];
      return [...head, ...middle, ...tail].join("\n");
    };

    // Grow the visible window while it still fits, so the projection uses the
    // budget it was given rather than an arbitrary fixed size.
    let best = render(1, 1);
    for (let count = 2; count <= Math.floor(numbered.length / 2); count += 1) {
      const candidate = render(count, count);
      if (!withinBudget(candidate, budget)) break;
      best = candidate;
    }

    if (!withinBudget(best, budget)) {
      const minimal = `${numbered.length} lines, ${baseline} bytes; fetch the handle to read them`;
      return {
        projector: this.name,
        originalHandle: input.handle,
        lossPolicy: "summary-only",
        summary: minimal,
        view: minimal.slice(0, budget.maxBytes),
        availableViews: ["head", "tail", "range", "raw"],
        bytes: { baseline, optimized: byteLength(minimal) },
      };
    }

    return {
      projector: this.name,
      originalHandle: input.handle,
      lossPolicy: "reversible-lossy",
      summary: `${numbered.length} lines, ${baseline} bytes; head and tail shown`,
      view: best,
      availableViews: ["head", "tail", "range", "raw"],
      bytes: { baseline, optimized: byteLength(best) },
    };
  }
}
