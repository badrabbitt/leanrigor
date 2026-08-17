import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { discoverSkills, validateSkill } from "../src/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const skills = path.join(here, "fixtures", "skills");
const at = (name: string) => path.join(skills, name);

describe("Agent Skills compatibility", () => {
  it("accepts a plain skill folder with no leanrigor.yaml", async () => {
    const manifest = await validateSkill(at("verification"));
    expect(manifest.name).toBe("verification");
    expect(manifest.sidecar).toBeUndefined();
  });

  it("reads the standard frontmatter fields", async () => {
    const manifest = await validateSkill(at("verification"));
    expect(manifest.description.length).toBeGreaterThan(20);
    expect(manifest.license).toBe("Apache-2.0");
  });

  it("validates the sidecar only when one is present", async () => {
    const manifest = await validateSkill(at("senior-system-design"));
    expect(manifest.sidecar?.contextBudgetTokens).toBe(8000);
    expect(manifest.sidecar?.riskLevels).toEqual(["medium", "high", "critical"]);
  });

  it("rejects a skill with no license, because distribution cannot be reviewed", async () => {
    await expect(validateSkill(at("no-license"))).rejects.toMatchObject({
      code: "LR_SKILL_INVALID",
    });
  });

  it("rejects a frontmatter name that disagrees with its directory", async () => {
    await expect(validateSkill(at("mismatched-name"))).rejects.toMatchObject({
      code: "LR_SKILL_INVALID",
    });
  });

  it("rejects a missing SKILL.md", async () => {
    await expect(validateSkill(at("does-not-exist"))).rejects.toMatchObject({
      code: "LR_SKILL_INVALID",
    });
  });
});

describe("provenance validation", () => {
  it("accepts an independently authored skill that records influences", async () => {
    const manifest = await validateSkill(at("senior-system-design"));
    expect(manifest.provenance?.implementation).toBe("independently-authored");
    expect(manifest.provenance?.influences?.[0]?.project).toBe("obra/superpowers");
    expect(manifest.provenance?.copiedFiles).toEqual([]);
  });

  it("rejects claimed copied files without a source, license and notice", async () => {
    await expect(validateSkill(at("copied-without-notice"))).rejects.toMatchObject({
      code: "LR_PROVENANCE_MISSING",
    });
  });

  it("names the missing provenance fields in the error", async () => {
    await expect(validateSkill(at("copied-without-notice"))).rejects.toThrow(/source|license|notice/i);
  });
});

describe("script capability declarations", () => {
  it("rejects a script that reaches the network without declaring it", async () => {
    await expect(validateSkill(at("undeclared-network"))).rejects.toMatchObject({
      code: "LR_SKILL_INVALID",
    });
  });

  it("says which capability was undeclared", async () => {
    await expect(validateSkill(at("undeclared-network"))).rejects.toThrow(/network/i);
  });
});

describe("discoverSkills", () => {
  it("finds every skill folder under a root", async () => {
    const found = await discoverSkills(skills);
    expect(found.map((entry) => entry.name).sort()).toEqual([
      "copied-without-notice",
      "mismatched-name",
      "no-license",
      "product-brainstorming",
      "senior-system-design",
      "undeclared-network",
      "verification",
    ]);
  });

  it("reports invalid skills instead of throwing on the whole root", async () => {
    const found = await discoverSkills(skills);
    const broken = found.find((entry) => entry.name === "no-license");
    expect(broken?.valid).toBe(false);
    expect(broken?.error).toBeTruthy();
  });

  it("returns an empty list for a root that does not exist", async () => {
    expect(await discoverSkills(path.join(here, "nope"))).toEqual([]);
  });

  it("is idempotent when the same root is scanned twice", async () => {
    const { collectSkills } = await import("../src/index.js");
    const collected = await collectSkills([skills, skills], { ignoreInvalid: true });
    expect(collected.filter((skill) => skill.name === "verification")).toHaveLength(1);
  });

  it("rejects the same skill name coming from two different roots", async () => {
    const { collectSkills } = await import("../src/index.js");
    await expect(
      collectSkills([skills, path.join(here, "fixtures", "duplicate")], { ignoreInvalid: true }),
    ).rejects.toMatchObject({ code: "LR_SKILL_CONFLICT" });
  });
});
