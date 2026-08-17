import type { CaseOutcome } from "./runner.js";

export interface SkillUplift {
  readonly skill: string;
  readonly baselinePassed: number;
  readonly baselineTotal: number;
  readonly withSkillPassed: number;
  readonly withSkillTotal: number;
  /** Percentage points, candidate minus baseline. */
  readonly upliftPoints: number;
  readonly routingPassed: number;
  readonly routingTotal: number;
  /** Runs where the provider rejected the request; excluded from the rates. */
  readonly agentFailures: number;
}

export interface AblationFinding {
  readonly skill: string;
  readonly section: string;
  readonly passed: number;
  readonly total: number;
  /** Points lost against the full skill. Zero or less means the section is not earning its context. */
  readonly costOfRemovalPoints: number;
}

function rate(outcomes: readonly CaseOutcome[]): { passed: number; total: number } {
  const usable = outcomes.filter((outcome) => outcome.agentOk);
  return { passed: usable.filter((outcome) => outcome.passed).length, total: usable.length };
}

export function summarize(outcomes: readonly CaseOutcome[]): SkillUplift[] {
  const skills = [...new Set(outcomes.map((outcome) => outcome.skill))].sort();

  return skills.map((skill) => {
    const forSkill = outcomes.filter((outcome) => outcome.skill === skill);
    const baseline = rate(forSkill.filter((o) => o.condition === "baseline"));
    const withSkill = rate(forSkill.filter((o) => o.condition === "with-skill"));
    const routing = rate(forSkill.filter((o) => o.condition === "routing"));

    const baselineRate = baseline.total === 0 ? 0 : baseline.passed / baseline.total;
    const withRate = withSkill.total === 0 ? 0 : withSkill.passed / withSkill.total;

    return {
      skill,
      baselinePassed: baseline.passed,
      baselineTotal: baseline.total,
      withSkillPassed: withSkill.passed,
      withSkillTotal: withSkill.total,
      upliftPoints: Number(((withRate - baselineRate) * 100).toFixed(6)),
      routingPassed: routing.passed,
      routingTotal: routing.total,
      agentFailures: forSkill.filter((outcome) => !outcome.agentOk).length,
    };
  });
}

/**
 * Scores each ablated section against the full skill.
 *
 * A section whose removal costs nothing is not earning its context and should
 * be deleted. That is the point of running ablation at all: it is the only way
 * to tell instruction from decoration.
 */
export function ablationFindings(outcomes: readonly CaseOutcome[]): AblationFinding[] {
  const findings: AblationFinding[] = [];
  const skills = [...new Set(outcomes.map((outcome) => outcome.skill))].sort();

  for (const skill of skills) {
    const forSkill = outcomes.filter((outcome) => outcome.skill === skill);
    const full = rate(forSkill.filter((o) => o.condition === "with-skill"));
    const fullRate = full.total === 0 ? 0 : full.passed / full.total;

    const sections = [
      ...new Set(
        forSkill
          .filter((outcome) => outcome.condition === "ablation")
          .map((outcome) => outcome.removedSection!),
      ),
    ].sort();

    for (const section of sections) {
      const ablated = rate(
        forSkill.filter((o) => o.condition === "ablation" && o.removedSection === section),
      );
      const ablatedRate = ablated.total === 0 ? 0 : ablated.passed / ablated.total;
      findings.push({
        skill,
        section,
        passed: ablated.passed,
        total: ablated.total,
        costOfRemovalPoints: Number(((fullRate - ablatedRate) * 100).toFixed(6)),
      });
    }
  }

  return findings;
}

export function renderSkillReport(
  outcomes: readonly CaseOutcome[],
  agent: { name: string; model: string },
): string {
  const uplifts = summarize(outcomes);
  const lines = [
    "Skill evaluation",
    "",
    `Agent: ${agent.name}, model ${agent.model}`,
    "",
    "| Skill | Baseline | With skill | Uplift | Non-trigger |",
    "|---|---|---|---|---|",
  ];

  for (const uplift of uplifts) {
    const sign = uplift.upliftPoints >= 0 ? "+" : "";
    lines.push(
      `| ${uplift.skill} | ${uplift.baselinePassed}/${uplift.baselineTotal} | `
      + `${uplift.withSkillPassed}/${uplift.withSkillTotal} | `
      + `${sign}${uplift.upliftPoints.toFixed(1)} points | `
      + `${uplift.routingPassed}/${uplift.routingTotal} |`,
    );
  }

  const failures = uplifts.reduce((sum, uplift) => sum + uplift.agentFailures, 0);
  if (failures > 0) {
    lines.push("", `${failures} run(s) failed at the provider and are excluded from every rate.`);
  }

  const findings = ablationFindings(outcomes);
  if (findings.length > 0) {
    lines.push("", "Ablation — cost of removing each section:", "");
    lines.push("| Skill | Section removed | Passed | Cost of removal |");
    lines.push("|---|---|---|---|");
    for (const finding of findings) {
      lines.push(
        `| ${finding.skill} | ${finding.section} | ${finding.passed}/${finding.total} | `
        + `${finding.costOfRemovalPoints >= 0 ? "+" : ""}${finding.costOfRemovalPoints.toFixed(1)} points |`,
      );
    }
    lines.push(
      "",
      "A section whose removal costs zero points is not earning its context and",
      "should be deleted from the skill.",
    );
  }

  return lines.join("\n");
}
