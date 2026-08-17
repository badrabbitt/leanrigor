import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { describe, expect, it } from "vitest";
import { collectSkills, routeSkills, validateSkill } from "../src/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..", "..");
const skillsRoot = path.join(repoRoot, "skills");
const evalsRoot = path.join(repoRoot, "evals", "skills");

const SHIPPED = ["product-brainstorming", "senior-system-design", "verification"] as const;

describe("the skills LeanRigor ships", () => {
  it.each(SHIPPED)("%s validates", async (name) => {
    const manifest = await validateSkill(path.join(skillsRoot, name));
    expect(manifest.name).toBe(name);
  });

  it.each(SHIPPED)("%s declares a license", async (name) => {
    expect((await validateSkill(path.join(skillsRoot, name))).license).toBe("Apache-2.0");
  });

  it.each(SHIPPED)("%s carries a provenance record", async (name) => {
    const manifest = await validateSkill(path.join(skillsRoot, name));
    expect(manifest.provenance?.implementation).toBe("independently-authored");
    expect(manifest.provenance?.copiedFiles).toEqual([]);
  });

  it.each(SHIPPED)("%s declares a bounded context budget", async (name) => {
    const manifest = await validateSkill(path.join(skillsRoot, name));
    expect(manifest.sidecar?.contextBudgetTokens).toBeGreaterThan(0);
    expect(manifest.sidecar?.contextBudgetTokens).toBeLessThanOrEqual(8000);
  });

  it.each(SHIPPED)("%s fits inside its own declared budget", async (name) => {
    const manifest = await validateSkill(path.join(skillsRoot, name));
    const source = await readFile(path.join(skillsRoot, name, "SKILL.md"), "utf8");
    // A conservative 4 bytes per token; the exact estimator lives in TokenLeaf,
    // but a skill that overruns even this generous bound is over budget.
    const upperBound = Math.ceil(Buffer.byteLength(source, "utf8") / 4);
    expect(upperBound).toBeLessThanOrEqual(manifest.sidecar!.contextBudgetTokens);
  });

  it.each(SHIPPED)("%s ships no scripts, so it declares no capabilities", async (name) => {
    const manifest = await validateSkill(path.join(skillsRoot, name));
    expect(manifest.scriptFiles).toEqual([]);
    expect(manifest.sidecar?.capabilities).toEqual([]);
  });

  it("collects all three without a name conflict", async () => {
    const collected = await collectSkills([skillsRoot]);
    expect(collected.map((skill) => skill.name)).toEqual([...SHIPPED]);
  });
});

describe("routing the shipped skills", () => {
  it("loads only verification for a trivial task", async () => {
    const routed = routeSkills(await collectSkills([skillsRoot]), {
      risk: "trivial",
      budgetTokens: 8000,
    });
    expect(routed.selected.map((skill) => skill.name)).toEqual(["verification"]);
  });

  it("loads the design skill and its dependency for a high-risk task", async () => {
    const routed = routeSkills(await collectSkills([skillsRoot]), {
      risk: "high",
      budgetTokens: 8000,
    });
    expect(routed.selected.map((skill) => skill.name)).toEqual([
      "product-brainstorming",
      "senior-system-design",
      "verification",
    ]);
  });

  it("keeps the whole critical-risk selection under 8k tokens", async () => {
    const routed = routeSkills(await collectSkills([skillsRoot]), {
      risk: "critical",
      budgetTokens: 8000,
    });
    expect(routed.totalContextBudgetTokens).toBeLessThanOrEqual(8000);
    expect(routed.conflicts).toEqual([]);
  });

  it("declares no conflicting mandatory workflow", async () => {
    const collected = await collectSkills([skillsRoot]);
    expect(collected.filter((skill) => skill.sidecar?.mandatoryWorkflow)).toEqual([]);
  });
});

interface EvalFile {
  skill: string;
  positive?: { id: string; prompt: string; checks: unknown[] }[];
  non_trigger?: { id: string; prompt: string; checks: unknown[] }[];
  ablation?: { sections?: string[] };
}

describe("the evaluation suites", () => {
  it.each(SHIPPED)("%s has an eval file its sidecar points at", async (name) => {
    const manifest = await validateSkill(path.join(skillsRoot, name));
    expect(manifest.sidecar?.verificationSuite).toBe(`evals/skills/${name}.yaml`);
    const parsed = parseYaml(
      await readFile(path.join(evalsRoot, `${name}.yaml`), "utf8"),
    ) as EvalFile;
    expect(parsed.skill).toBe(name);
  });

  it.each(SHIPPED)("%s has at least five positive cases", async (name) => {
    const parsed = parseYaml(
      await readFile(path.join(evalsRoot, `${name}.yaml`), "utf8"),
    ) as EvalFile;
    expect(parsed.positive?.length ?? 0).toBeGreaterThanOrEqual(5);
  });

  it.each(SHIPPED)("%s has at least three non-trigger cases", async (name) => {
    const parsed = parseYaml(
      await readFile(path.join(evalsRoot, `${name}.yaml`), "utf8"),
    ) as EvalFile;
    expect(parsed.non_trigger?.length ?? 0).toBeGreaterThanOrEqual(3);
  });

  it.each(SHIPPED)("every %s case carries at least one deterministic check", async (name) => {
    const parsed = parseYaml(
      await readFile(path.join(evalsRoot, `${name}.yaml`), "utf8"),
    ) as EvalFile;
    for (const testCase of [...(parsed.positive ?? []), ...(parsed.non_trigger ?? [])]) {
      expect(testCase.checks.length, `${name}/${testCase.id}`).toBeGreaterThan(0);
    }
  });

  it.each(SHIPPED)("%s names the sections its ablation run removes", async (name) => {
    const parsed = parseYaml(
      await readFile(path.join(evalsRoot, `${name}.yaml`), "utf8"),
    ) as EvalFile;
    const sections = parsed.ablation?.sections ?? [];
    expect(sections.length).toBeGreaterThanOrEqual(3);
    const source = await readFile(path.join(skillsRoot, name, "SKILL.md"), "utf8");
    for (const section of sections) {
      expect(source, `${name} has no section "${section}"`).toContain(section);
    }
  });
});
