import type { RiskLevel } from "@leanrigor/workflow-runtime";
import type { SkillManifest } from "./manifest.js";

export interface RouteOptions {
  readonly risk: RiskLevel;
  /** Total declared context budget the selection may consume. */
  readonly budgetTokens: number;
}

export interface ExcludedSkill {
  readonly name: string;
  readonly reason: string;
}

export interface SkillConflict {
  readonly skills: readonly string[];
  readonly reason: string;
}

export interface RouteResult {
  /** Selected skills in dependency order. */
  readonly selected: readonly SkillManifest[];
  readonly excluded: readonly ExcludedSkill[];
  readonly conflicts: readonly SkillConflict[];
  readonly totalContextBudgetTokens: number;
}

function appliesToRisk(skill: SkillManifest, risk: RiskLevel): boolean {
  // A skill with no sidecar declares nothing about risk, so it stays available:
  // portable Agent Skills must not be silently dropped by a LeanRigor policy.
  const levels = skill.sidecar?.riskLevels;
  return levels === undefined || levels.includes(risk);
}

function budgetOf(skill: SkillManifest): number {
  return skill.sidecar?.contextBudgetTokens ?? 0;
}

/**
 * Resolves a skill's dependencies depth-first, detecting cycles.
 * Returns `undefined` when the closure cannot be satisfied.
 */
function resolve(
  skill: SkillManifest,
  byName: ReadonlyMap<string, SkillManifest>,
  seen: Set<string>,
  problems: { missing?: string; cycle?: string[] },
): SkillManifest[] | undefined {
  if (seen.has(skill.name)) {
    problems.cycle = [...seen, skill.name];
    return undefined;
  }
  seen.add(skill.name);

  const closure: SkillManifest[] = [];
  for (const required of skill.sidecar?.requires ?? []) {
    const dependency = byName.get(required);
    if (!dependency) {
      problems.missing = required;
      return undefined;
    }
    const nested = resolve(dependency, byName, seen, problems);
    if (!nested) return undefined;
    closure.push(...nested);
  }

  seen.delete(skill.name);
  closure.push(skill);
  return closure;
}

/**
 * Chooses the smallest skill set that fits the task's risk, dependencies and
 * context budget.
 *
 * Two behaviours matter more than the selection itself. A skill is dropped, with
 * a stated reason, rather than loaded over budget — an over-budget skill is how
 * a context-efficiency tool quietly becomes a context problem. And two skills
 * that each insist on a different mandatory workflow produce a *conflict*
 * rather than an arbitrary winner: silently obeying one of them would mean the
 * user's other instruction was discarded without anyone noticing.
 */
export function routeSkills(
  available: readonly SkillManifest[],
  options: RouteOptions,
): RouteResult {
  const byName = new Map(available.map((skill) => [skill.name, skill]));
  const excluded: ExcludedSkill[] = [];
  const conflicts: SkillConflict[] = [];

  const candidates = [...available]
    .filter((skill) => {
      if (appliesToRisk(skill, options.risk)) return true;
      excluded.push({
        name: skill.name,
        reason: `declared for ${skill.sidecar?.riskLevels?.join(", ") ?? "no"} risk, not ${options.risk}`,
      });
      return false;
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const selected: SkillManifest[] = [];
  const selectedNames = new Set<string>();
  let total = 0;

  for (const candidate of candidates) {
    if (selectedNames.has(candidate.name)) continue;

    const problems: { missing?: string; cycle?: string[] } = {};
    const closure = resolve(candidate, byName, new Set(), problems);

    if (!closure) {
      if (problems.cycle) {
        conflicts.push({
          skills: [...new Set(problems.cycle)].sort(),
          reason: `dependency cycle: ${problems.cycle.join(" → ")}`,
        });
      } else {
        excluded.push({
          name: candidate.name,
          reason: `requires "${problems.missing}", which is not available`,
        });
      }
      continue;
    }

    const additions = closure.filter((skill) => !selectedNames.has(skill.name));
    const cost = additions.reduce((sum, skill) => sum + budgetOf(skill), 0);

    if (total + cost > options.budgetTokens) {
      excluded.push({
        name: candidate.name,
        reason:
          `declared context budget of ${cost} tokens does not fit the remaining `
          + `${options.budgetTokens - total} token budget`,
      });
      continue;
    }

    for (const skill of additions) {
      selected.push(skill);
      selectedNames.add(skill.name);
    }
    total += cost;
  }

  // Mandatory workflows are checked against the final selection, so a skill
  // excluded for budget cannot cause a phantom conflict.
  const workflows = new Map<string, string[]>();
  for (const skill of selected) {
    const workflow = skill.sidecar?.mandatoryWorkflow;
    if (!workflow) continue;
    workflows.set(workflow, [...(workflows.get(workflow) ?? []), skill.name]);
  }

  if (workflows.size > 1) {
    conflicts.push({
      skills: [...workflows.values()].flat().sort(),
      reason:
        "these skills declare a different mandatory workflow "
        + `(${[...workflows.keys()].sort().join(" vs ")}); loading both would disobey one of them`,
    });
  }

  if (conflicts.length > 0) {
    return { selected: [], excluded, conflicts, totalContextBudgetTokens: 0 };
  }

  return { selected, excluded, conflicts, totalContextBudgetTokens: total };
}
