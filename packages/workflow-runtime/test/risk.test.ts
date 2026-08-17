import { describe, expect, it } from "vitest";
import { LeanRigorError } from "@leanrigor/core";
import { RISK_LEVELS, classifyTask, isAtLeast } from "../src/index.js";

const classify = (intent: string, changedPaths: string[] = []) =>
  classifyTask({ intent, changedPaths });

describe("RISK_LEVELS", () => {
  it("is ordered from cheapest to most demanding", () => {
    expect([...RISK_LEVELS]).toEqual(["trivial", "low", "medium", "high", "critical"]);
  });

  it("compares levels by that order", () => {
    expect(isAtLeast("high", "medium")).toBe(true);
    expect(isAtLeast("low", "high")).toBe(false);
    expect(isAtLeast("critical", "critical")).toBe(true);
  });
});

describe("critical classification", () => {
  const criticalCases: [string, string, string[]][] = [
    ["authentication", "fix the login session check", ["src/auth/session.ts"]],
    ["authorization", "update the permission model", ["src/authz/policy.ts"]],
    ["payment", "change how we charge the customer card", ["src/billing/charge.ts"]],
    ["secret handling", "rotate the signing key used for tokens", ["src/crypto/keys.ts"]],
    ["destructive migration", "add a migration that drops the orders table", ["db/migrations/007.sql"]],
    ["data deletion", "purge old user records permanently", ["src/jobs/purge.ts"]],
    ["cryptography", "switch the password hashing algorithm", ["src/crypto/hash.ts"]],
  ];

  it.each(criticalCases)("treats %s as critical", (_label, intent, paths) => {
    expect(classifyTask({ intent, changedPaths: paths }).risk).toBe("critical");
  });

  it("explains which rule fired", () => {
    const assessment = classify("fix the login session check", ["src/auth/session.ts"]);
    expect(assessment.matchedRules.length).toBeGreaterThan(0);
    expect(assessment.matchedRules[0]!.because).toBeTruthy();
    expect(assessment.matchedRules.every((rule) => rule.id.length > 0)).toBe(true);
  });

  it("classifies from the changed path even when the intent sounds harmless", () => {
    expect(classify("small tidy-up", ["src/auth/login.ts"]).risk).toBe("critical");
  });
});

describe("trivial classification", () => {
  it("treats a typo fix as trivial", () => {
    expect(classify("fix a typo in the README", ["README.md"]).risk).toBe("trivial");
  });

  it("treats formatting as trivial", () => {
    expect(classify("reformat this file", ["src/utils/format.ts"]).risk).toBe("trivial");
  });

  it("does not stay trivial when the typo is in a security policy", () => {
    expect(classify("fix a typo", ["security/policy.yaml"]).risk).toBe("critical");
  });

  it("does not stay trivial when the change touches release metadata", () => {
    const assessment = classify("fix a typo in the version", ["package.json"]);
    expect(isAtLeast(assessment.risk, "medium")).toBe(true);
  });

  it("does not stay trivial when the change touches CI workflow definitions", () => {
    expect(isAtLeast(classify("fix a typo", [".github/workflows/release.yml"]).risk, "high")).toBe(
      true,
    );
  });
});

describe("low, medium and high classification", () => {
  it("treats an isolated bug fix as low", () => {
    expect(classify("fix an off-by-one bug in the parser", ["src/parse/lexer.ts"]).risk).toBe("low");
  });

  it("treats a feature in one component as medium", () => {
    expect(classify("add a --json flag to the report command", ["src/report/render.ts"]).risk).toBe(
      "medium",
    );
  });

  it("raises a feature spanning several components to high", () => {
    expect(
      classify("add a new export pipeline", [
        "src/report/render.ts",
        "src/store/write.ts",
        "src/api/routes.ts",
        "src/cli/commands.ts",
      ]).risk,
    ).toBe("high");
  });

  it("treats a migration as high even without a destructive verb", () => {
    expect(classify("add a migration adding a column", ["db/migrations/008.sql"]).risk).toBe("high");
  });
});

describe("determinism and repeatability", () => {
  it("returns the same result for the same input", () => {
    expect(classify("add a --json flag", ["src/report/render.ts"])).toEqual(
      classify("add a --json flag", ["src/report/render.ts"]),
    );
  });

  it("ignores the order of changed paths", () => {
    expect(classify("update things", ["src/a.ts", "src/b.ts"]).risk).toBe(
      classify("update things", ["src/b.ts", "src/a.ts"]).risk,
    );
  });

  it("classifies an empty request as trivial rather than guessing upward", () => {
    expect(classify("", []).risk).toBe("trivial");
  });
});

describe("user override", () => {
  it("accepts an upward override without a reason", () => {
    const assessment = classifyTask({
      intent: "fix a typo",
      changedPaths: ["README.md"],
      override: { risk: "high" },
    });
    expect(assessment.risk).toBe("high");
    expect(assessment.baseRisk).toBe("trivial");
    expect(assessment.overridden).toBe(true);
  });

  it("refuses a downward override without an explicit reason", () => {
    expect(() =>
      classifyTask({
        intent: "change the login session check",
        changedPaths: ["src/auth/session.ts"],
        override: { risk: "low" },
      }),
    ).toThrow(LeanRigorError);
  });

  it("accepts a downward override that states a reason, and records it", () => {
    const assessment = classifyTask({
      intent: "change the login session check",
      changedPaths: ["src/auth/session.ts"],
      override: { risk: "low", reason: "documentation-only change to an auth comment" },
    });
    expect(assessment.risk).toBe("low");
    expect(assessment.baseRisk).toBe("critical");
    expect(assessment.overrideReason).toContain("documentation-only");
  });

  it("keeps the computed base risk visible after any override", () => {
    const assessment = classifyTask({
      intent: "fix a typo",
      changedPaths: ["README.md"],
      override: { risk: "critical" },
    });
    expect(assessment.baseRisk).toBe("trivial");
    expect(assessment.risk).toBe("critical");
  });
});
