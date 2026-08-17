import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  CodexAgent,
  renderSkillReport,
  runSkillSuite,
  summarize,
  type CaseOutcome,
} from "@leanrigor/benchmark";
import type { CliIo } from "../cli.js";
import { EXIT_FAILURE, EXIT_OK } from "../cli.js";

export interface SkillEvalOptions {
  readonly skillsRoot?: string;
  readonly evalsRoot?: string;
  readonly skills?: readonly string[];
  readonly model?: string;
  readonly codexHome?: string;
  readonly workRoot?: string;
  readonly json?: string;
  readonly markdown?: string;
  readonly ablation?: boolean;
  readonly ablationSections?: readonly string[];
  readonly baseline?: boolean;
  readonly nonTrigger?: boolean;
  readonly repeat?: number;
}

/**
 * Runs the model-backed skill evaluations.
 *
 * This is the command `evals/README.md` promises. Until it has been run, the
 * project makes no claim that its skills improve outcomes — so the output here
 * is the difference between a documented intention and evidence.
 */
export async function runSkillEval(io: CliIo, options: SkillEvalOptions = {}): Promise<number> {
  const repoRoot = process.cwd();
  const skillsRoot = options.skillsRoot ?? path.join(repoRoot, "skills");
  const evalsRoot = options.evalsRoot ?? path.join(repoRoot, "evals");
  const skills = options.skills ?? [
    "verification",
    "product-brainstorming",
    "senior-system-design",
  ];

  const agent = new CodexAgent({
    ...(options.model ? { model: options.model } : {}),
    ...(options.codexHome ? { codexHome: options.codexHome } : {}),
  });

  const workRoot = options.workRoot ?? (await mkdtemp(path.join(tmpdir(), "leanrigor-skilleval-")));

  io.out(`Skill evaluation — agent ${agent.name}, model ${agent.model}`);
  io.out(`Work directory: ${workRoot}`);
  io.out("");

  const outcomes: CaseOutcome[] = [];
  for (const skill of skills) {
    io.out(`${skill}:`);
    outcomes.push(
      ...(await runSkillSuite(
        { agent, skillsRoot, evalsRoot, workRoot, onProgress: (message) => io.out(message) },
        skill,
        {
          includeBaseline: options.baseline !== false,
          includeNonTrigger: options.nonTrigger !== false,
          ...(options.ablation ? { includeAblation: true } : {}),
          ...(options.ablationSections ? { ablationSections: options.ablationSections } : {}),
          ...(options.repeat ? { repeat: options.repeat } : {}),
        },
      )),
    );
    io.out("");
  }

  const report = renderSkillReport(outcomes, agent);
  io.out(report);

  if (options.json) {
    await writeFile(
      options.json,
      `${JSON.stringify({ agent: { name: agent.name, model: agent.model }, outcomes }, null, 2)}\n`,
      "utf8",
    );
    io.out("");
    io.out(`Wrote ${options.json}`);
  }

  if (options.markdown) {
    await writeFile(options.markdown, `${report}\n`, "utf8");
    io.out(`Wrote ${options.markdown}`);
  }

  // A run where every provider call failed proves nothing and must not look
  // like a clean result.
  const usable = outcomes.filter((outcome) => outcome.agentOk);
  if (usable.length === 0) {
    io.err("Every run failed at the provider; no conclusion can be drawn.");
    return EXIT_FAILURE;
  }

  const anyNegative = summarize(outcomes).some((uplift) => uplift.upliftPoints < 0);
  return anyNegative ? EXIT_FAILURE : EXIT_OK;
}
