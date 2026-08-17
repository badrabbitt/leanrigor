import { describe, expect, it } from "vitest";
import { LeanRigorError } from "@leanrigor/core";
import {
  MANDATORY_GATES,
  WorkflowRuntime,
  classifyTask,
  selectGates,
  serializeState,
} from "../src/index.js";

const assess = (intent: string, paths: string[] = []) =>
  classifyTask({ intent, changedPaths: paths });

const trivial = () => assess("fix a typo in the README", ["README.md"]);
const low = () => assess("fix an off-by-one bug in the parser", ["src/parse/lexer.ts"]);
const medium = () => assess("add a --json flag to the report command", ["src/report/render.ts"]);
const critical = () => assess("fix the login session check", ["src/auth/session.ts"]);

describe("selectGates", () => {
  it("gives a trivial task a scope check, an edit and a verification", () => {
    expect(selectGates(trivial())).toEqual(["scope-check", "implementation", "verification"]);
  });

  it("gives a low-risk task reproduction and a regression test", () => {
    const gates = selectGates(low());
    expect(gates).toContain("reproduce");
    expect(gates).toContain("regression-test");
    expect(gates).toContain("verification");
  });

  it("gives a medium task a short design and a review", () => {
    const gates = selectGates(medium());
    expect(gates).toContain("design");
    expect(gates).toContain("review");
  });

  it("gives a critical task a threat model, approval, rollback and independent review", () => {
    const gates = selectGates(critical());
    for (const gate of ["threat-model", "approval", "rollback-plan", "independent-review"]) {
      expect(gates, gate).toContain(gate);
    }
  });

  it("always ends with verification", () => {
    for (const assessment of [trivial(), low(), medium(), critical()]) {
      expect(selectGates(assessment).at(-1)).toBe("verification");
    }
  });

  it("selects strictly more gates as risk rises", () => {
    const counts = [trivial(), low(), medium(), critical()].map(
      (assessment) => selectGates(assessment).length,
    );
    expect(counts).toEqual([...counts].sort((a, b) => a - b));
    expect(new Set(counts).size).toBe(counts.length);
  });

  it("never returns a duplicate gate", () => {
    const gates = selectGates(critical());
    expect(new Set(gates).size).toBe(gates.length);
  });
});

describe("MANDATORY_GATES", () => {
  it("includes verification at every risk level", () => {
    expect(MANDATORY_GATES.trivial).toContain("verification");
    expect(MANDATORY_GATES.critical).toContain("verification");
  });

  it("makes the critical safety gates non-skippable", () => {
    for (const gate of ["threat-model", "approval", "rollback-plan"]) {
      expect(MANDATORY_GATES.critical, gate).toContain(gate);
    }
  });
});

describe("WorkflowRuntime transitions", () => {
  const runtime = () => new WorkflowRuntime({ taskId: "task-1", assessment: medium() });

  it("starts with every selected gate required and nothing executed", () => {
    const state = runtime().snapshot();
    expect(state.gates.every((gate) => gate.status === "required")).toBe(true);
    expect(state.gates.length).toBeGreaterThan(0);
  });

  it("records executed and passed as distinct states", () => {
    const r = runtime();
    r.markExecuted("design");
    expect(r.statusOf("design")).toBe("executed");
    r.markPassed("design", { evidence: "lr_evidence_design" });
    expect(r.statusOf("design")).toBe("passed");
  });

  it("fails closed on an invalid transition", () => {
    const r = runtime();
    expect(() => r.markPassed("design", { evidence: "e" })).toThrow(LeanRigorError);
  });

  it("refuses to mark a gate that was never required", () => {
    const r = runtime();
    expect(() => r.markExecuted("threat-model")).toThrow(LeanRigorError);
  });

  it("refuses to pass verification without an evidence identifier", () => {
    const r = new WorkflowRuntime({ taskId: "t", assessment: trivial() });
    r.markExecuted("scope-check");
    r.markPassed("scope-check");
    r.markExecuted("implementation");
    r.markPassed("implementation");
    r.markExecuted("verification");
    expect(() => r.markPassed("verification")).toThrow(
      expect.objectContaining({ code: "LR_GATE_INCOMPLETE" }),
    );
    r.markPassed("verification", { evidence: "lr_sha256_test_run" });
    expect(r.statusOf("verification")).toBe("passed");
  });

  it("refuses to pass a critical approval without evidence", () => {
    const r = new WorkflowRuntime({ taskId: "t", assessment: critical() });
    r.markExecuted("approval");
    expect(() => r.markPassed("approval")).toThrow(LeanRigorError);
  });

  it("records a skip with its reason instead of silently dropping the gate", () => {
    const r = runtime();
    r.markSkipped("design", "the change is a one-line rename inside an existing design");
    expect(r.statusOf("design")).toBe("skipped");
    expect(r.snapshot().gates.find((g) => g.id === "design")?.reason).toContain("one-line rename");
  });

  it("refuses to skip a gate without a reason", () => {
    expect(() => runtime().markSkipped("design", "")).toThrow(LeanRigorError);
  });

  it("refuses to skip a mandatory gate at any risk level", () => {
    const r = runtime();
    expect(() => r.markSkipped("verification", "we are in a hurry")).toThrow(
      expect.objectContaining({ code: "LR_GATE_INCOMPLETE" }),
    );
  });

  it("refuses to skip a critical safety gate even with a reason", () => {
    const r = new WorkflowRuntime({ taskId: "t", assessment: critical() });
    for (const gate of ["threat-model", "approval", "rollback-plan"] as const) {
      expect(() => r.markSkipped(gate, "token budget"), gate).toThrow(LeanRigorError);
    }
  });
});

describe("completion", () => {
  function complete(runtime: WorkflowRuntime, gates: readonly string[]) {
    for (const gate of gates) {
      runtime.markExecuted(gate as never);
      runtime.markPassed(gate as never, { evidence: `lr_evidence_${gate}` });
    }
  }

  it("is incomplete until every mandatory gate has passed", () => {
    const r = new WorkflowRuntime({ taskId: "t", assessment: trivial() });
    expect(r.isComplete()).toBe(false);
    complete(r, ["scope-check", "implementation", "verification"]);
    expect(r.isComplete()).toBe(true);
  });

  it("is not complete when a mandatory gate is merely executed", () => {
    const r = new WorkflowRuntime({ taskId: "t", assessment: trivial() });
    complete(r, ["scope-check", "implementation"]);
    r.markExecuted("verification");
    expect(r.isComplete()).toBe(false);
  });

  it("stays complete when a non-mandatory gate was skipped with a reason", () => {
    const r = new WorkflowRuntime({ taskId: "t", assessment: medium() });
    const gates = r.snapshot().gates.map((gate) => gate.id);
    for (const gate of gates) {
      if (gate === "design") r.markSkipped(gate, "covered by an existing design document");
      else complete(r, [gate]);
    }
    expect(r.isComplete()).toBe(true);
  });

  it("reports which mandatory gates are still outstanding", () => {
    const r = new WorkflowRuntime({ taskId: "t", assessment: trivial() });
    expect(r.outstandingMandatoryGates()).toContain("verification");
  });
});

describe("serializeState", () => {
  it("carries decisions, statuses and evidence handles only", () => {
    const r = new WorkflowRuntime({ taskId: "task-9", assessment: medium() });
    r.markExecuted("design");
    r.markPassed("design", { evidence: "lr_sha256_design_doc" });
    const serialized = serializeState(r.snapshot());
    const parsed = JSON.parse(serialized) as Record<string, unknown>;

    expect(Object.keys(parsed).sort()).toEqual([
      "baseRisk",
      "gates",
      "matchedRules",
      "risk",
      "taskId",
    ]);
    expect(serialized).toContain("lr_sha256_design_doc");
  });

  it("contains no conversation transcript or free text beyond stated reasons", () => {
    const r = new WorkflowRuntime({ taskId: "task-9", assessment: medium() });
    const serialized = serializeState(r.snapshot());
    for (const field of ["transcript", "messages", "prompt", "conversation", "intent"]) {
      expect(serialized).not.toContain(field);
    }
  });

  it("stays small", () => {
    const r = new WorkflowRuntime({ taskId: "task-9", assessment: critical() });
    expect(Buffer.byteLength(serializeState(r.snapshot()), "utf8")).toBeLessThan(2048);
  });

  it("round-trips through JSON", () => {
    const r = new WorkflowRuntime({ taskId: "task-9", assessment: medium() });
    const restored = WorkflowRuntime.fromSerialized(serializeState(r.snapshot()));
    expect(restored.snapshot()).toEqual(r.snapshot());
  });
});
