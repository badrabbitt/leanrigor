import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { collectSkills, routeSkills, type SkillManifest } from "../src/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) => path.join(here, "fixtures", name);

let valid: SkillManifest[];

beforeAll(async () => {
  const all = await collectSkills([fixture("skills")], { ignoreInvalid: true });
  valid = all;
});

describe("bounded routing", () => {
  it("selects a skill whose declared risk levels include the task risk", () => {
    const routed = routeSkills(valid, { risk: "high", budgetTokens: 50_000 });
    expect(routed.selected.map((skill) => skill.name)).toContain("senior-system-design");
  });

  it("does not select a skill declared for higher risk only", () => {
    const routed = routeSkills(valid, { risk: "trivial", budgetTokens: 50_000 });
    expect(routed.selected.map((skill) => skill.name)).not.toContain("senior-system-design");
  });

  it("treats a skill with no sidecar as available at every risk level", () => {
    const routed = routeSkills(valid, { risk: "trivial", budgetTokens: 50_000 });
    expect(routed.selected.map((skill) => skill.name)).toContain("verification");
  });

  it("pulls in a declared dependency", () => {
    const routed = routeSkills(valid, { risk: "high", budgetTokens: 50_000 });
    const names = routed.selected.map((skill) => skill.name);
    expect(names).toContain("product-brainstorming");
    expect(names.indexOf("product-brainstorming")).toBeLessThan(
      names.indexOf("senior-system-design"),
    );
  });

  it("reports the total declared context budget of the selection", () => {
    const routed = routeSkills(valid, { risk: "high", budgetTokens: 50_000 });
    expect(routed.totalContextBudgetTokens).toBe(11_000);
  });

  it("selects nothing when no skill applies", () => {
    const routed = routeSkills([], { risk: "high", budgetTokens: 50_000 });
    expect(routed.selected).toEqual([]);
    expect(routed.totalContextBudgetTokens).toBe(0);
  });

  it("is deterministic", () => {
    const a = routeSkills(valid, { risk: "high", budgetTokens: 50_000 });
    const b = routeSkills(valid, { risk: "high", budgetTokens: 50_000 });
    expect(a.selected.map((s) => s.name)).toEqual(b.selected.map((s) => s.name));
  });
});

describe("budget enforcement", () => {
  it("excludes a skill that would blow the budget, and says so", async () => {
    const huge = await collectSkills([fixture("budget")]);
    const routed = routeSkills(huge, { risk: "medium", budgetTokens: 8000 });
    expect(routed.selected).toEqual([]);
    expect(routed.excluded[0]?.reason).toMatch(/budget/i);
  });

  it("keeps a selection that exactly fits the budget", () => {
    const routed = routeSkills(valid, { risk: "high", budgetTokens: 11_000 });
    expect(routed.selected.map((s) => s.name)).toContain("senior-system-design");
  });

  it("drops a dependant when its dependency cannot fit", async () => {
    const routed = routeSkills(valid, { risk: "high", budgetTokens: 4000 });
    const names = routed.selected.map((s) => s.name);
    expect(names).not.toContain("senior-system-design");
  });
});

describe("conflicts", () => {
  it("returns a conflict instead of loading two incompatible mandatory workflows", async () => {
    const conflicting = await collectSkills([fixture("conflict")]);
    const routed = routeSkills(conflicting, { risk: "medium", budgetTokens: 50_000 });
    expect(routed.conflicts).toHaveLength(1);
    expect(routed.conflicts[0]?.skills.sort()).toEqual(["spec-first", "tdd-only"]);
    expect(routed.selected).toEqual([]);
  });

  it("names the incompatible workflows in the conflict", async () => {
    const conflicting = await collectSkills([fixture("conflict")]);
    const routed = routeSkills(conflicting, { risk: "medium", budgetTokens: 50_000 });
    expect(routed.conflicts[0]?.reason).toContain("mandatory workflow");
  });

  it("allows a single mandatory workflow", async () => {
    const conflicting = await collectSkills([fixture("conflict")]);
    const routed = routeSkills(
      conflicting.filter((skill) => skill.name === "tdd-only"),
      { risk: "medium", budgetTokens: 50_000 },
    );
    expect(routed.conflicts).toEqual([]);
    expect(routed.selected.map((s) => s.name)).toEqual(["tdd-only"]);
  });
});

describe("dependency cycles", () => {
  it("detects a cycle rather than looping", async () => {
    const cyclic = await collectSkills([fixture("cycle")]);
    const routed = routeSkills(cyclic, { risk: "low", budgetTokens: 50_000 });
    expect(routed.conflicts.some((conflict) => /cycle/i.test(conflict.reason))).toBe(true);
    expect(routed.selected).toEqual([]);
  });

  it("reports a missing dependency instead of selecting a broken set", () => {
    const orphan: SkillManifest[] = [
      {
        ...valid.find((skill) => skill.name === "senior-system-design")!,
      },
    ];
    const routed = routeSkills(orphan, { risk: "high", budgetTokens: 50_000 });
    expect(routed.excluded[0]?.reason).toMatch(/product-brainstorming/);
    expect(routed.selected).toEqual([]);
  });
});
