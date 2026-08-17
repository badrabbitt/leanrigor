import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ablationFindings,
  parseCodexStream,
  everyMatchNegated,
  extractSection,
  looksLikeCommandOutput,
  removeSection,
  renderSkillReport,
  runCheck,
  skillBody,
  summarize,
  type CaseOutcome,
  type RunArtifacts,
} from "../src/index.js";

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(path.join(tmpdir(), "leanrigor-skilleval-"));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

function artifacts(overrides: Partial<RunArtifacts> = {}): RunArtifacts {
  return { transcript: "", commands: [], workDir, loadedSkills: [], ...overrides };
}

describe("extractSection", () => {
  const doc = [
    "# Design",
    "intro",
    "## Non-functional requirements",
    "p95 latency 200ms",
    "## Capacity assumptions",
    "5000 rps measured",
    "# Other",
    "tail",
  ].join("\n");

  it("extracts a section up to the next heading", () => {
    expect(extractSection(doc, "Non-functional requirements")?.trim()).toBe("p95 latency 200ms");
  });

  it("matches a numbered heading", () => {
    expect(extractSection("## 2. Capacity assumptions\nbody", "Capacity assumptions")?.trim()).toBe(
      "body",
    );
  });

  it("returns undefined for a heading that is not there", () => {
    expect(extractSection(doc, "Rollout and rollback")).toBeUndefined();
  });

  it("does not match a mention of the heading in body text", () => {
    expect(extractSection("# Design\nwe considered Capacity assumptions here", "Capacity assumptions"))
      .toBeUndefined();
  });
});

describe("looksLikeCommandOutput", () => {
  it("recognises test runner output", () => {
    expect(looksLikeCommandOutput("Tests  4 passed (4)")).toBe(true);
    expect(looksLikeCommandOutput("✔ parses a list\n# pass 4")).toBe(false);
    expect(looksLikeCommandOutput("PASS  src/parser.test.js")).toBe(true);
  });

  it("recognises a shell prompt and an exit status", () => {
    expect(looksLikeCommandOutput("$ npm test")).toBe(true);
    expect(looksLikeCommandOutput("exit code 1")).toBe(true);
  });

  it("rejects a paraphrase", () => {
    expect(looksLikeCommandOutput("The tests should pass now that the fix is in.")).toBe(false);
  });
});

describe("checks", () => {
  it("artifact-exists fails when nothing was produced", async () => {
    const result = await runCheck({ kind: "artifact-exists", path: "architecture.md" }, artifacts(), "s");
    expect(result.passed).toBe(false);
  });

  it("artifact-has-sections names what is missing", async () => {
    await writeFile(path.join(workDir, "architecture.md"), "## Data\nbody\n");
    const result = await runCheck(
      { kind: "artifact-has-sections", path: "architecture.md", sections: ["Data", "Cost"] },
      artifacts(),
      "s",
    );
    expect(result.passed).toBe(false);
    expect(result.detail).toContain("Cost");
  });

  it("artifact-section-list-min counts list items in one section", async () => {
    await writeFile(
      path.join(workDir, "brief.md"),
      "## Alternatives\n- do nothing\n- smallest change\n- the request\n\n## Scope\n- x\n",
    );
    const pass = await runCheck(
      { kind: "artifact-section-list-min", path: "brief.md", section: "Alternatives", count: 3 },
      artifacts(),
      "s",
    );
    const fail = await runCheck(
      { kind: "artifact-section-list-min", path: "brief.md", section: "Scope", count: 3 },
      artifacts(),
      "s",
    );
    expect(pass.passed).toBe(true);
    expect(fail.passed).toBe(false);
  });

  it("ran-command matches an executed command", async () => {
    const result = await runCheck(
      { kind: "ran-command", matching: "npm (run )?test" },
      artifacts({ commands: ["ls -la", "npm test"] }),
      "s",
    );
    expect(result.passed).toBe(true);
  });

  it("transcript-not-matches fails on an asserted forbidden phrase", async () => {
    const result = await runCheck(
      { kind: "transcript-not-matches", pattern: "(?i)(should pass)" },
      artifacts({ transcript: "It should pass now." }),
      "s",
    );
    expect(result.passed).toBe(false);
  });

  it("transcript-not-matches passes when the forbidden phrase is negated", async () => {
    // A real run failed this check for answering correctly: the agent wrote
    // "We are **not ready to release**", which is the honest answer.
    const result = await runCheck(
      { kind: "transcript-not-matches", pattern: "(?i)(ready to release|all green)" },
      artifacts({ transcript: "We are **not ready to release**. npm test failed: 2 passed, 1 failed." }),
      "s",
    );
    expect(result.passed).toBe(true);
  });

  it("transcript-not-matches still fails when only some occurrences are negated", async () => {
    const result = await runCheck(
      { kind: "transcript-not-matches", pattern: "(?i)(ready to release)" },
      artifacts({ transcript: "We are not ready to release yet. Actually we are ready to release." }),
      "s",
    );
    expect(result.passed).toBe(false);
  });

  it("skill-not-loaded checks the router's decision", async () => {
    const loaded = await runCheck({ kind: "skill-not-loaded" }, artifacts({ loadedSkills: ["verification"] }), "verification");
    const notLoaded = await runCheck({ kind: "skill-not-loaded" }, artifacts({ loadedSkills: [] }), "verification");
    expect(loaded.passed).toBe(false);
    expect(notLoaded.passed).toBe(true);
  });

  it("reports an unknown check kind as a failure rather than passing it", async () => {
    const result = await runCheck({ kind: "vibes" }, artifacts(), "s");
    expect(result.passed).toBe(false);
  });
});

describe("skillBody and removeSection", () => {
  const source = [
    "---",
    "name: demo",
    "description: A demo skill.",
    "---",
    "",
    "# Demo",
    "",
    "## Keep me",
    "kept",
    "",
    "## Remove me",
    "removed",
    "",
    "## Also keep",
    "kept too",
  ].join("\n");

  it("strips the frontmatter", () => {
    expect(skillBody(source).startsWith("# Demo")).toBe(true);
    expect(skillBody(source)).not.toContain("description:");
  });

  it("removes one section and leaves the rest", () => {
    const ablated = removeSection(skillBody(source), "Remove me");
    expect(ablated).not.toContain("removed");
    expect(ablated).toContain("kept");
    expect(ablated).toContain("kept too");
  });

  it("leaves the body unchanged when the heading is not found", () => {
    const body = skillBody(source);
    expect(removeSection(body, "Nonexistent")).toBe(body);
  });
});

describe("everyMatchNegated", () => {
  const forbidden = /ready to release/i;

  it("recognises a plain negation", () => {
    expect(everyMatchNegated("We are not ready to release.", forbidden)).toBe(true);
  });

  it("recognises a negation through markdown emphasis", () => {
    expect(everyMatchNegated("We are **not ready to release**.", forbidden)).toBe(true);
  });

  it("recognises a contraction", () => {
    expect(everyMatchNegated("It isn't ready to release.", forbidden)).toBe(true);
  });

  it("rejects a bare assertion", () => {
    expect(everyMatchNegated("We are ready to release.", forbidden)).toBe(false);
  });

  it("rejects a negation that is too far away to apply", () => {
    const text = "This is not the point I was making earlier in a long aside; ready to release.";
    expect(everyMatchNegated(text, forbidden)).toBe(false);
  });

  it("returns false when the phrase never appears", () => {
    expect(everyMatchNegated("nothing relevant here", forbidden)).toBe(false);
  });
});

describe("parseCodexStream", () => {
  const stream = [
    JSON.stringify({ type: "thread.started", thread_id: "t" }),
    JSON.stringify({
      type: "item.completed",
      item: { type: "agent_message", text: "Running the suite." },
    }),
    JSON.stringify({
      type: "item.completed",
      item: {
        type: "command_execution",
        command: "npm test",
        aggregated_output: "Tests 4 passed (4)",
        exit_code: 0,
      },
    }),
    JSON.stringify({
      type: "turn.completed",
      usage: { input_tokens: 100, cached_input_tokens: 40, output_tokens: 20 },
    }),
  ].join("\n");

  it("collects the commands the agent executed", () => {
    expect(parseCodexStream(stream).commands).toEqual(["npm test"]);
  });

  it("folds real command output into the transcript", () => {
    const transcript = parseCodexStream(stream).transcript;
    expect(transcript).toContain("Running the suite.");
    expect(transcript).toContain("Tests 4 passed (4)");
    expect(transcript).toContain("exit code 0");
  });

  it("captures provider-reported token usage", () => {
    expect(parseCodexStream(stream).usage).toEqual({
      inputTokens: 100,
      cachedInputTokens: 40,
      outputTokens: 20,
    });
  });

  it("flags a provider error rather than returning an empty success", () => {
    const failing = JSON.stringify({
      type: "error",
      error: { type: "invalid_request_error", message: "nope" },
    });
    expect(parseCodexStream(failing).providerError).toBe(true);
  });

  it("ignores non-JSON noise", () => {
    expect(parseCodexStream("some log line\n").transcript).toBe("");
  });
});

function outcome(overrides: Partial<CaseOutcome> = {}): CaseOutcome {
  return {
    skill: "verification",
    caseId: "c1",
    condition: "with-skill",
    passed: true,
    checks: [],
    agentOk: true,
    durationMs: 1,
    transcript: "",
    commands: [],
    ...overrides,
  };
}

describe("summarize", () => {
  it("computes uplift in percentage points", () => {
    const outcomes = [
      outcome({ condition: "baseline", caseId: "a", passed: false }),
      outcome({ condition: "baseline", caseId: "b", passed: false }),
      outcome({ condition: "with-skill", caseId: "a", passed: true }),
      outcome({ condition: "with-skill", caseId: "b", passed: true }),
    ];
    expect(summarize(outcomes)[0]!.upliftPoints).toBe(100);
  });

  it("reports a negative uplift honestly", () => {
    const outcomes = [
      outcome({ condition: "baseline", caseId: "a", passed: true }),
      outcome({ condition: "with-skill", caseId: "a", passed: false }),
    ];
    expect(summarize(outcomes)[0]!.upliftPoints).toBe(-100);
  });

  it("excludes provider failures from the rates and counts them separately", () => {
    const outcomes = [
      outcome({ condition: "with-skill", caseId: "a", passed: true }),
      outcome({ condition: "with-skill", caseId: "b", passed: false, agentOk: false }),
    ];
    const summary = summarize(outcomes)[0]!;
    expect(summary.withSkillTotal).toBe(1);
    expect(summary.agentFailures).toBe(1);
  });
});

describe("ablationFindings", () => {
  it("scores a section whose removal costs nothing as zero", () => {
    const outcomes = [
      outcome({ condition: "with-skill", caseId: "a", passed: true }),
      outcome({ condition: "ablation", caseId: "a", passed: true, removedSection: "Anti-patterns" }),
    ];
    expect(ablationFindings(outcomes)[0]).toMatchObject({
      section: "Anti-patterns",
      costOfRemovalPoints: 0,
    });
  });

  it("scores a section that carries the skill", () => {
    const outcomes = [
      outcome({ condition: "with-skill", caseId: "a", passed: true }),
      outcome({ condition: "ablation", caseId: "a", passed: false, removedSection: "The rule" }),
    ];
    expect(ablationFindings(outcomes)[0]!.costOfRemovalPoints).toBe(100);
  });
});

describe("renderSkillReport", () => {
  it("names the agent and model that produced the numbers", () => {
    const text = renderSkillReport([outcome()], { name: "codex", model: "gpt-5.5" });
    expect(text).toContain("codex");
    expect(text).toContain("gpt-5.5");
  });

  it("says when a section is not earning its context", () => {
    const text = renderSkillReport(
      [
        outcome({ condition: "with-skill", caseId: "a", passed: true }),
        outcome({ condition: "ablation", caseId: "a", passed: true, removedSection: "Anti-patterns" }),
      ],
      { name: "codex", model: "gpt-5.5" },
    );
    expect(text).toContain("not earning its context");
  });
});
