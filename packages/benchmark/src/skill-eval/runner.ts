import { cp, mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import type { AgentRunOutput, EvalAgent } from "./agent.js";
import { runChecks, type CheckResult, type CheckSpec } from "./checks.js";

export interface EvalCase {
  readonly id: string;
  readonly prompt: string;
  readonly checks: readonly CheckSpec[];
  /** Fixture directory copied into the work directory before the run. */
  readonly fixture?: string;
}

export interface EvalSuite {
  readonly skill: string;
  readonly positive: readonly EvalCase[];
  readonly nonTrigger: readonly EvalCase[];
  readonly ablationSections: readonly string[];
}

export type EvalCondition = "baseline" | "with-skill" | "ablation" | "routing";

export interface CaseOutcome {
  readonly skill: string;
  readonly caseId: string;
  readonly condition: EvalCondition;
  /** Which section was removed, for ablation runs. */
  readonly removedSection?: string;
  readonly passed: boolean;
  readonly checks: readonly CheckResult[];
  readonly agentOk: boolean;
  readonly agentError?: string;
  readonly durationMs: number;
  /**
   * What the agent actually produced. Kept so a failed check can be audited —
   * a result nobody can inspect is not evidence, and a check that is itself
   * wrong is the most likely explanation for a surprising number.
   */
  readonly transcript: string;
  readonly commands: readonly string[];
  /** Provider-reported usage, when the agent exposes it. */
  readonly usage?: { inputTokens: number; cachedInputTokens: number; outputTokens: number };
}

export function parseSuite(source: string): EvalSuite {
  const raw = parseYaml(source) as {
    skill: string;
    positive?: EvalCase[];
    non_trigger?: EvalCase[];
    ablation?: { sections?: string[] };
  };
  return {
    skill: raw.skill,
    positive: raw.positive ?? [],
    nonTrigger: raw.non_trigger ?? [],
    ablationSections: raw.ablation?.sections ?? [],
  };
}

/** Strips the YAML frontmatter, leaving the instructions the model sees. */
export function skillBody(source: string): string {
  return source.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").trim();
}

/**
 * Removes one section from a skill body, for ablation.
 *
 * The heading and its content go; everything else is untouched. If the heading
 * is not found the body is returned unchanged, and the caller should treat that
 * as a broken ablation spec rather than a null result.
 */
export function removeSection(body: string, heading: string): string {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `^(#{1,6})\\s*(?:\\d+[.)]\\s*)?${escaped}\\s*$[\\s\\S]*?(?=^#{1,6}\\s|$(?![\\s\\S]))`,
    "mi",
  );
  return body.replace(pattern, "").replace(/\n{3,}/g, "\n\n").trim();
}

export interface RunnerDeps {
  readonly agent: EvalAgent;
  readonly skillsRoot: string;
  readonly evalsRoot: string;
  readonly workRoot: string;
  readonly onProgress?: (message: string) => void;
}

/**
 * Creates an isolated directory for one run.
 *
 * Each run gets its own parent, not a sibling under a shared root. An agent
 * whose own directory looks empty will look around, and with siblings in place
 * it can find another case's fixture and answer from that — which silently
 * contaminates both cases.
 */
async function prepareWorkDir(deps: RunnerDeps, key: string, fixture?: string): Promise<string> {
  const safe = key.replace(/[^a-z0-9-]/gi, "_");
  const workDir = path.join(deps.workRoot, safe, "workspace");
  await rm(path.join(deps.workRoot, safe), { recursive: true, force: true });
  await mkdir(workDir, { recursive: true });
  if (fixture) {
    const source = path.join(deps.evalsRoot, "fixtures", fixture);
    await cp(source, workDir, { recursive: true });
  }
  return workDir;
}

async function evaluate(
  deps: RunnerDeps,
  suite: EvalSuite,
  testCase: EvalCase,
  condition: EvalCondition,
  instructions: string | undefined,
  loadedSkills: readonly string[],
  removedSection?: string,
): Promise<CaseOutcome> {
  const key = `${suite.skill}-${testCase.id}-${condition}${removedSection ? `-${removedSection}` : ""}`;
  const workDir = await prepareWorkDir(deps, key, testCase.fixture);
  const startedAt = Date.now();

  deps.onProgress?.(`  ${condition.padEnd(11)} ${suite.skill}/${testCase.id}`);

  const output: AgentRunOutput = await deps.agent.run({
    prompt: testCase.prompt,
    ...(instructions ? { instructions } : {}),
    workDir,
  });

  const checks = await runChecks(
    testCase.checks,
    {
      transcript: output.transcript,
      commands: output.commands,
      workDir,
      loadedSkills,
    },
    suite.skill,
  );

  return {
    skill: suite.skill,
    caseId: testCase.id,
    condition,
    ...(removedSection ? { removedSection } : {}),
    passed: output.ok && checks.every((check) => check.passed),
    checks,
    agentOk: output.ok,
    ...(output.error ? { agentError: output.error } : {}),
    durationMs: Date.now() - startedAt,
    transcript: output.transcript,
    commands: output.commands,
    ...(output.usage ? { usage: output.usage } : {}),
  };
}

export interface RunSuiteOptions {
  readonly includeBaseline?: boolean;
  readonly includeWithSkill?: boolean;
  readonly includeNonTrigger?: boolean;
  readonly includeAblation?: boolean;
  /** Restrict ablation to these sections, to bound cost. */
  readonly ablationSections?: readonly string[];
}

/**
 * Runs one skill's evaluation suite.
 *
 * The baseline condition runs the same prompt with the skill removed. Without
 * it there is no uplift claim to make — only an assertion that the output looks
 * good, which is what this project exists to stop people publishing.
 */
export async function runSkillSuite(
  deps: RunnerDeps,
  skill: string,
  options: RunSuiteOptions = {},
): Promise<CaseOutcome[]> {
  const suite = parseSuite(
    await readFile(path.join(deps.evalsRoot, "skills", `${skill}.yaml`), "utf8"),
  );
  const body = skillBody(
    await readFile(path.join(deps.skillsRoot, skill, "SKILL.md"), "utf8"),
  );

  const outcomes: CaseOutcome[] = [];

  if (options.includeBaseline !== false) {
    for (const testCase of suite.positive) {
      outcomes.push(await evaluate(deps, suite, testCase, "baseline", undefined, []));
    }
  }

  if (options.includeWithSkill !== false) {
    for (const testCase of suite.positive) {
      outcomes.push(await evaluate(deps, suite, testCase, "with-skill", body, [skill]));
    }
  }

  if (options.includeNonTrigger !== false) {
    for (const testCase of suite.nonTrigger) {
      // Routing is decided before the skill body is loaded, so the non-trigger
      // condition tests the trigger description, not the skill's content.
      const selected = await selectSkills(deps, testCase.prompt);
      const checks = await runChecks(
        testCase.checks,
        { transcript: selected.transcript, commands: [], workDir: deps.workRoot, loadedSkills: selected.skills },
        skill,
      );
      outcomes.push({
        skill,
        caseId: testCase.id,
        condition: "routing",
        passed: checks.every((check) => check.passed),
        checks,
        agentOk: true,
        durationMs: 0,
        transcript: selected.transcript,
        commands: [],
      });
    }
  }

  if (options.includeAblation) {
    const sections = options.ablationSections ?? suite.ablationSections;
    for (const section of sections) {
      const ablated = removeSection(body, section);
      for (const testCase of suite.positive) {
        outcomes.push(
          await evaluate(deps, suite, testCase, "ablation", ablated, [skill], section),
        );
      }
    }
  }

  return outcomes;
}

interface RoutingDecision {
  readonly skills: readonly string[];
  readonly transcript: string;
}

let routingCache: Map<string, RoutingDecision> | undefined;

/**
 * Asks the agent which skills apply, given only their trigger descriptions.
 *
 * This is how a host actually routes Agent Skills, so it is the honest way to
 * test whether a description is bounded. Decisions are cached per prompt
 * because the same prompt is asked once per skill under test.
 */
async function selectSkills(deps: RunnerDeps, prompt: string): Promise<RoutingDecision> {
  routingCache ??= new Map();
  const cached = routingCache.get(prompt);
  if (cached) return cached;

  const descriptions = await loadDescriptions(deps.skillsRoot);
  const catalogue = descriptions
    .map((entry) => `- ${entry.name}: ${entry.description}`)
    .join("\n");

  const workDir = await prepareWorkDir(deps, `routing-${prompt.slice(0, 24)}`);
  const output = await deps.agent.run({
    workDir,
    prompt:
      "You are the skill router for a coding agent. Given the available skills and "
      + "the user's request, decide which skills apply.\n\nAvailable skills:\n"
      + `${catalogue}\n\nUser request:\n${prompt}\n\n`
      + "Reply with a single line: SELECTED: <comma-separated skill names, or NONE>. "
      + "Select a skill only if its stated trigger clearly covers this request.",
  });

  const match = /SELECTED:\s*(.+)/i.exec(output.transcript);
  const raw = match?.[1]?.trim() ?? "NONE";
  const skills =
    /^none$/i.test(raw) || raw === ""
      ? []
      : raw
          .split(",")
          .map((name) => name.trim().replace(/[.`*]/g, ""))
          .filter((name) => descriptions.some((entry) => entry.name === name));

  const decision: RoutingDecision = { skills, transcript: output.transcript };
  routingCache.set(prompt, decision);
  return decision;
}

async function loadDescriptions(
  skillsRoot: string,
): Promise<{ name: string; description: string }[]> {
  const { readdir } = await import("node:fs/promises");
  const names = (await readdir(skillsRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  const out: { name: string; description: string }[] = [];
  for (const name of names) {
    const source = await readFile(path.join(skillsRoot, name, "SKILL.md"), "utf8");
    const description = /^description:\s*(.+)$/m.exec(source)?.[1]?.trim() ?? "";
    out.push({ name, description });
  }
  return out;
}
