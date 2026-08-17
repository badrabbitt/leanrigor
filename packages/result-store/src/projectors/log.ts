import {
  byteLength,
  withinBudget,
  type ProjectionBudget,
  type ProjectionInput,
  type ProjectionResult,
  type Projector,
} from "./types.js";

const ERROR_PATTERN = /\b(error|fatal|exception|traceback|failed|failure)\b/i;

/**
 * Collapses the volatile parts of a log line so lines that differ only by
 * timestamp, counter or identifier group together. The original line is always
 * kept as the group's sample, so nothing is invented.
 */
export function normalizeLine(line: string): string {
  return line
    .replace(/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?Z?/g, "<ts>")
    .replace(/\b[0-9a-f]{7,}\b/gi, "<hex>")
    .replace(/\b\d+(\.\d+)?(ms|s|kb|mb|gb)?\b/gi, "<n>")
    .replace(/\s+/g, " ")
    .trim();
}

interface FirstError {
  readonly line: number;
  readonly text: string;
}

interface Group {
  readonly key: string;
  readonly sample: string;
  readonly firstLine: number;
  count: number;
}

/**
 * Projects line-oriented output.
 *
 * Build and test logs are dominated by repetition, so the projection keeps
 * exact repetition counts and the first error with its original line number —
 * the two things a reader actually needs — instead of a prefix of the text.
 */
export class LogProjector implements Projector {
  readonly name = "log";

  supports(input: ProjectionInput): boolean {
    const text = input.bytes.toString("utf8");
    if (text.trim() === "") return false;
    // Structured payloads belong to the JSON projector, which preserves types.
    try {
      JSON.parse(text);
      return false;
    } catch {
      return text.includes("\n");
    }
  }

  project(input: ProjectionInput, budget: ProjectionBudget): ProjectionResult {
    const baseline = input.bytes.byteLength;
    const lines = input.bytes.toString("utf8").split("\n");

    const groups = new Map<string, Group>();
    let firstError: FirstError | null = null;
    let totalLines = 0;

    // A plain loop, not `forEach`: assignments to `firstError` must stay visible
    // to control-flow analysis below.
    for (let index = 0; index < lines.length; index += 1) {
      const raw = lines[index]!;
      if (raw.trim() === "") continue;
      totalLines += 1;
      const lineNumber = index + 1;

      if (firstError === null && ERROR_PATTERN.test(raw)) {
        firstError = { line: lineNumber, text: raw.trim() };
      }

      const key = normalizeLine(raw);
      const existing = groups.get(key);
      if (existing) existing.count += 1;
      else groups.set(key, { key, sample: raw.trim(), firstLine: lineNumber, count: 1 });
    }

    // Descending count, then first appearance, so the order never depends on
    // Map iteration details.
    const ordered = [...groups.values()].sort(
      (a, b) => b.count - a.count || a.firstLine - b.firstLine,
    );

    const summary =
      `${totalLines} lines, ${ordered.length} distinct`
      + (firstError === null ? "; no error detected" : `; first error at line ${firstError.line}`);

    const render = (limit: number): string =>
      JSON.stringify({
        totalLines,
        distinctGroups: ordered.length,
        firstError,
        groups: ordered.slice(0, limit).map((g) => ({
          count: g.count,
          firstLine: g.firstLine,
          sample: g.sample,
        })),
        omittedGroups: Math.max(0, ordered.length - limit),
      });

    const full = render(ordered.length);
    if (withinBudget(full, budget)) {
      return {
        projector: this.name,
        originalHandle: input.handle,
        lossPolicy: baseline === byteLength(full) ? "lossless" : "reversible-lossy",
        summary,
        view: full,
        availableViews: ["groups", "first-error", "raw"],
        bytes: { baseline, optimized: byteLength(full) },
      };
    }

    // Shrink the group list until the document fits. The result is always a
    // complete JSON document, never a truncated one.
    let limit = ordered.length;
    let view = full;
    while (limit > 0) {
      limit = Math.floor(limit / 2);
      view = render(limit);
      if (withinBudget(view, budget)) break;
    }

    if (!withinBudget(view, budget)) {
      view = JSON.stringify({ totalLines, distinctGroups: ordered.length });
    }

    return {
      projector: this.name,
      originalHandle: input.handle,
      lossPolicy: "summary-only",
      summary,
      view,
      availableViews: ["groups", "first-error", "raw"],
      bytes: { baseline, optimized: byteLength(view) },
    };
  }
}
