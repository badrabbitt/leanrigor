import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  DiffProjector,
  JsonProjector,
  LogProjector,
  TextProjector,
  handleFor,
  type Projector,
} from "@leanrigor/result-store";
import type { BenchmarkCase, CaseResult, Condition, RunEnvironment } from "./case.js";

export interface RunnerOptions {
  /** Root holding `evals/context` fixtures. */
  readonly evalsRoot: string;
  readonly runId: string;
  readonly maxProjectedBytes?: number;
  readonly now?: () => number;
}

const PROJECTORS: readonly Projector[] = [
  new DiffProjector(),
  new JsonProjector(),
  new LogProjector(),
  new TextProjector(),
];

function syntheticCatalog(toolCount: number): string {
  return JSON.stringify(
    Array.from({ length: toolCount }, (_, index) => ({
      name: `tool_${index}`,
      description:
        `Tool number ${index}. `
        + "A description long enough that a catalog of these costs real context. ".repeat(3),
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query." },
          limit: { type: "number", description: "Result limit." },
        },
        required: ["query"],
      },
    })),
  );
}

/**
 * Runs the deterministic fixture cases.
 *
 * These cases involve no model: they measure exactly what LeanRigor's own
 * transformations do to a payload. That makes the numbers reproducible on any
 * machine, which is the point — a benchmark nobody else can re-run is marketing.
 */
export class BenchmarkRunner {
  readonly #options: RunnerOptions;

  constructor(options: RunnerOptions) {
    this.#options = options;
  }

  async #payload(testCase: BenchmarkCase): Promise<Buffer> {
    if (testCase.kind === "tool-catalog") {
      return Buffer.from(syntheticCatalog(testCase.toolCount ?? 50), "utf8");
    }
    if (!testCase.fixture) {
      throw new Error(`case "${testCase.id}" has no fixture`);
    }
    return readFile(path.join(this.#options.evalsRoot, testCase.fixture));
  }

  async runCase(testCase: BenchmarkCase, condition: Condition): Promise<CaseResult> {
    const now = this.#options.now ?? (() => Date.now());
    const startedAt = now();
    const bytes = await this.#payload(testCase);
    const handle = handleFor(bytes);

    const base = {
      caseId: testCase.id,
      runId: this.#options.runId,
      condition,
      completed: true,
      requiredGatesPassed: true,
      baselineBytes: bytes.byteLength,
      measurementMode: "byte-only" as const,
      toolCalls: 1,
      retries: 0,
      errors: 0,
    };

    // The baseline condition is the honest control: the whole payload reaches
    // the model, so optimized equals baseline.
    if (condition === "baseline") {
      return {
        ...base,
        passed: true,
        optimizedBytes: bytes.byteLength,
        durationMs: now() - startedAt,
      };
    }

    const input = { bytes, handle, schema: testCase.kind };
    const projector = PROJECTORS.find((candidate) => candidate.supports(input)) ?? new TextProjector();
    const projection = projector.project(input, {
      maxBytes: this.#options.maxProjectedBytes ?? 16 * 1024,
    });

    return {
      ...base,
      // The deterministic verifier for a projection case: the projection must
      // stay within budget and remain reversible through its handle.
      passed:
        projection.originalHandle === handle
        && Buffer.byteLength(projection.view, "utf8")
          <= (this.#options.maxProjectedBytes ?? 16 * 1024),
      optimizedBytes: projection.bytes.optimized,
      durationMs: now() - startedAt,
    };
  }

  async runAll(
    cases: readonly BenchmarkCase[],
    condition: Condition,
  ): Promise<CaseResult[]> {
    const results: CaseResult[] = [];
    for (const testCase of cases) {
      try {
        results.push(await this.runCase(testCase, condition));
      } catch (error) {
        results.push({
          caseId: testCase.id,
          runId: this.#options.runId,
          condition,
          completed: false,
          passed: false,
          requiredGatesPassed: false,
          baselineBytes: 0,
          optimizedBytes: 0,
          measurementMode: "byte-only",
          durationMs: 0,
          toolCalls: 0,
          retries: 0,
          errors: 1,
        });
        void error;
      }
    }
    return results;
  }
}

export function describeEnvironment(runId: string, versions: Record<string, string>): RunEnvironment {
  return {
    runId,
    nodeVersion: process.version,
    platform: `${process.platform}-${process.arch}`,
    packageVersions: versions,
    startedAt: new Date().toISOString(),
  };
}
