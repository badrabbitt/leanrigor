import {
  byteLength,
  withinBudget,
  type ProjectionBudget,
  type ProjectionInput,
  type ProjectionResult,
  type Projector,
} from "./types.js";

interface Hunk {
  oldStart: number;
  oldLines: string[];
  newStart: number;
  newLines: string[];
  body: string[];
}

/**
 * Longest common subsequence over lines.
 *
 * The quadratic table is bounded by `maxLines`; larger inputs fall back to a
 * whole-file replacement hunk rather than spending unbounded time. Being honest
 * about the fallback is better than a slow projector that stalls a session.
 */
function lcsMatrix(a: string[], b: string[]): number[][] {
  const table: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i]![j] = a[i] === b[j]
        ? table[i + 1]![j + 1]! + 1
        : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
    }
  }
  return table;
}

type Op = { readonly kind: " " | "-" | "+"; readonly text: string };

function diffOps(a: string[], b: string[]): Op[] {
  const table = lcsMatrix(a, b);
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      ops.push({ kind: " ", text: a[i]! });
      i += 1;
      j += 1;
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!) {
      ops.push({ kind: "-", text: a[i]! });
      i += 1;
    } else {
      ops.push({ kind: "+", text: b[j]! });
      j += 1;
    }
  }
  while (i < a.length) ops.push({ kind: "-", text: a[i++]! });
  while (j < b.length) ops.push({ kind: "+", text: b[j++]! });
  return ops;
}

export interface DiffOptions {
  /** Unchanged lines kept around each change. */
  readonly context?: number;
  /** Above this line count the diff degrades to a replacement hunk. */
  readonly maxLines?: number;
}

/**
 * Produces a unified diff. Hunk headers carry original line numbers, so a
 * reader can map every change back to the file it came from.
 */
export function unifiedDiff(before: string, after: string, options: DiffOptions = {}): string {
  if (before === after) return "";

  const context = options.context ?? 3;
  const maxLines = options.maxLines ?? 20_000;
  const a = before.split("\n");
  const b = after.split("\n");

  if (a.length > maxLines || b.length > maxLines) {
    return [
      `@@ -1,${a.length} +1,${b.length} @@`,
      `- <${a.length} lines replaced; input too large for a line diff>`,
      `+ <${b.length} lines>`,
    ].join("\n");
  }

  const ops = diffOps(a, b);

  // Mark which positions are near a change, then emit contiguous runs.
  const interesting = ops.map((op) => op.kind !== " ");
  const keep = ops.map((_, index) =>
    interesting.slice(Math.max(0, index - context), index + context + 1).some(Boolean),
  );

  const hunks: Hunk[] = [];
  let current: Hunk | undefined;
  let oldLine = 1;
  let newLine = 1;

  ops.forEach((op, index) => {
    if (keep[index]) {
      current ??= { oldStart: oldLine, oldLines: [], newStart: newLine, newLines: [], body: [] };
      current.body.push(`${op.kind}${op.text}`);
      if (op.kind !== "+") current.oldLines.push(op.text);
      if (op.kind !== "-") current.newLines.push(op.text);
    } else if (current) {
      hunks.push(current);
      current = undefined;
    }
    if (op.kind !== "+") oldLine += 1;
    if (op.kind !== "-") newLine += 1;
  });
  if (current) hunks.push(current);

  return hunks
    .map((hunk) =>
      [
        `@@ -${hunk.oldStart},${hunk.oldLines.length} +${hunk.newStart},${hunk.newLines.length} @@`,
        ...hunk.body,
      ].join("\n"),
    )
    .join("\n");
}

/**
 * Projects a revision against its predecessor.
 *
 * Re-sending an entire file that changed by one line is the most common avoidable
 * cost in an agent session; this projector sends the change instead.
 */
export class DiffProjector implements Projector {
  readonly name = "diff";

  supports(input: ProjectionInput): boolean {
    return input.previous !== undefined;
  }

  project(input: ProjectionInput, budget: ProjectionBudget): ProjectionResult {
    const baseline = input.bytes.byteLength;
    if (input.previous === undefined) {
      throw new Error("DiffProjector requires a previous revision; call supports() first");
    }

    const before = input.previous.toString("utf8");
    const after = input.bytes.toString("utf8");
    const diff = unifiedDiff(before, after);

    if (diff === "") {
      return {
        projector: this.name,
        originalHandle: input.handle,
        lossPolicy: "lossless",
        summary: "unchanged since the previous revision",
        view: "",
        availableViews: ["raw"],
        bytes: { baseline, optimized: 0 },
      };
    }

    const changed = diff.split("\n").filter((line) => /^[-+]/.test(line)).length;
    const summary = `${changed} changed lines against the previous revision`;

    if (withinBudget(diff, budget)) {
      return {
        projector: this.name,
        originalHandle: input.handle,
        lossPolicy: "reversible-lossy",
        summary,
        view: diff,
        availableViews: ["hunks", "raw"],
        bytes: { baseline, optimized: byteLength(diff) },
      };
    }

    const index = `${summary}; diff is ${byteLength(diff)} bytes, fetch the handle for it`;
    return {
      projector: this.name,
      originalHandle: input.handle,
      lossPolicy: "summary-only",
      summary,
      view: index.slice(0, budget.maxBytes),
      availableViews: ["hunks", "raw"],
      bytes: { baseline, optimized: byteLength(index) },
    };
  }
}
