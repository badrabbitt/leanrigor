import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import {
  BenchmarkCaseSchema,
  BenchmarkRunner,
  compareRuns,
  describeEnvironment,
  evaluateReleaseGate,
  renderComparison,
  renderReleaseGate,
  type BenchmarkCase,
  type CaseResult,
} from "@leanrigor/benchmark";
import type { CliIo } from "../cli.js";
import { EXIT_FAILURE, EXIT_OK } from "../cli.js";

export interface BenchmarkOptions {
  /** Root containing `context/` fixtures and `workflows/` suites. */
  readonly evalsRoot?: string;
  readonly suite?: string;
  /** Write the machine-readable result here. */
  readonly json?: string;
  /** Write the release-report Markdown here. */
  readonly markdown?: string;
  readonly runId?: string;
  /** Whether MCP conformance passed; the release gate needs to know. */
  readonly conformancePassed?: boolean;
}

interface SuiteFile {
  suite: string;
  cases: unknown[];
  notes?: string;
}

function toMarkdown(
  comparison: ReturnType<typeof compareRuns>,
  gate: ReturnType<typeof evaluateReleaseGate>,
  results: readonly CaseResult[],
): string {
  const pct = (value: number) => `${(value * 100).toFixed(1)}%`;
  const lines = [
    "# LeanRigor benchmark",
    "",
    "## Result",
    "",
    "| Metric | Value | Cases | Measurement |",
    "|---|---|---|---|",
    `| Baseline pass rate | ${pct(comparison.baselinePassRate)} | ${comparison.pairedCaseIds.length} | deterministic verifier |`,
    `| Candidate pass rate | ${pct(comparison.candidatePassRate)} | ${comparison.pairedCaseIds.length} | deterministic verifier |`,
    `| Pass-rate delta | ${(comparison.passRateDelta * 100).toFixed(1)} points | ${comparison.pairedCaseIds.length} | deterministic verifier |`,
    `| Median context reduction | ${pct(comparison.medianContextReduction)} | ${comparison.candidate.filter((r) => r.passed).length} passing | byte-only |`,
    "",
    "## Per case",
    "",
    "| Case | Baseline bytes | Optimized bytes | Reduction | Passed |",
    "|---|---:|---:|---:|---|",
  ];

  for (const result of results) {
    const reduction =
      result.baselineBytes === 0
        ? 0
        : (result.baselineBytes - result.optimizedBytes) / result.baselineBytes;
    lines.push(
      `| ${result.caseId} | ${result.baselineBytes.toLocaleString("en-US")} | `
      + `${result.optimizedBytes.toLocaleString("en-US")} | ${pct(reduction)} | `
      + `${result.passed ? "yes" : "no"} |`,
    );
  }

  lines.push("", "## Release gate", "", "```text", renderReleaseGate(gate), "```", "");
  lines.push(
    "Every percentage above states the case count and the measurement mode it came",
    "from. Savings are counted only for cases that passed their deterministic",
    "verifier with all mandatory gates satisfied.",
  );
  return lines.join("\n");
}

/**
 * Runs the deterministic benchmark suite and evaluates the release gate.
 *
 * The command always prints the comparison *and* the gate, because a reduction
 * figure without its quality verdict is exactly the number this project exists
 * to stop people publishing.
 */
export async function runBenchmark(io: CliIo, options: BenchmarkOptions = {}): Promise<number> {
  const evalsRoot = options.evalsRoot ?? path.join(process.cwd(), "evals");
  const suiteName = options.suite ?? "mvp-suite";
  const suitePath = path.join(evalsRoot, "workflows", `${suiteName}.yaml`);

  let suite: SuiteFile;
  try {
    suite = parseYaml(await readFile(suitePath, "utf8")) as SuiteFile;
  } catch {
    io.err(`LR_INVALID_CONFIG: could not read the benchmark suite at ${suitePath}`);
    return EXIT_FAILURE;
  }

  const cases: BenchmarkCase[] = [];
  for (const raw of suite.cases) {
    const parsed = BenchmarkCaseSchema.safeParse(raw);
    if (!parsed.success) {
      io.err(`LR_INVALID_CONFIG: invalid benchmark case: ${parsed.error.issues[0]?.message}`);
      return EXIT_FAILURE;
    }
    cases.push(parsed.data);
  }

  const runId = options.runId ?? `run-${Date.now()}`;
  const runner = new BenchmarkRunner({ evalsRoot, runId });

  const baseline = await runner.runAll(cases, "baseline");
  const candidate = await runner.runAll(cases, "gateway");
  const comparison = compareRuns(baseline, candidate);

  const gate = evaluateReleaseGate({
    comparison,
    // Conformance is a separate command; the gate is told the truth about
    // whether it ran rather than assuming it passed.
    conformancePassed: options.conformancePassed ?? false,
  });

  io.out(renderComparison(comparison));
  io.out("");
  io.out(renderReleaseGate(gate));

  const environment = describeEnvironment(runId, { leanrigor: "0.1.0" });

  if (options.json) {
    await writeFile(
      options.json,
      `${JSON.stringify({ environment, baseline, candidate, comparison, gate }, null, 2)}\n`,
      "utf8",
    );
    io.out("");
    io.out(`Wrote ${options.json}`);
  }

  if (options.markdown) {
    await writeFile(options.markdown, `${toMarkdown(comparison, gate, candidate)}\n`, "utf8");
    io.out(`Wrote ${options.markdown}`);
  }

  return gate.passed ? EXIT_OK : EXIT_FAILURE;
}
