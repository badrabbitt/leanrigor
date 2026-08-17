import { LeanRigorError } from "@leanrigor/core";
import {
  mandatoryGates,
  requiresEvidence,
  selectGates,
  type GateId,
} from "./gates.js";
import type { RiskAssessment } from "./risk.js";
import {
  deserializeState,
  type GateRecord,
  type GateStatus,
  type WorkflowState,
} from "./state.js";

export interface WorkflowRuntimeOptions {
  readonly taskId: string;
  readonly assessment: RiskAssessment;
}

export interface PassOptions {
  readonly evidence?: string;
}

/**
 * Tracks which Rigor Gates a task requires and what actually happened to each.
 *
 * `required`, `executed`, `passed` and `skipped` are tracked separately and
 * deliberately: a workflow that ran three gates out of seven must not be able
 * to present itself as complete. Invalid transitions fail closed.
 */
export class WorkflowRuntime {
  readonly #taskId: string;
  readonly #assessment: RiskAssessment;
  readonly #gates = new Map<GateId, GateRecord>();

  constructor(options: WorkflowRuntimeOptions) {
    this.#taskId = options.taskId;
    this.#assessment = options.assessment;
    for (const id of selectGates(options.assessment)) {
      this.#gates.set(id, { id, status: "required" });
    }
  }

  static fromSerialized(serialized: string): WorkflowRuntime {
    const state = deserializeState(serialized);
    const runtime = new WorkflowRuntime({
      taskId: state.taskId,
      assessment: {
        risk: state.risk,
        baseRisk: state.baseRisk,
        matchedRules: state.matchedRules,
        overridden: state.risk !== state.baseRisk,
      },
    });
    runtime.#gates.clear();
    for (const gate of state.gates) runtime.#gates.set(gate.id, gate);
    return runtime;
  }

  #require(gate: GateId): GateRecord {
    const record = this.#gates.get(gate);
    if (!record) {
      throw new LeanRigorError(
        "LR_INVALID_TRANSITION",
        `gate "${gate}" is not required for a ${this.#assessment.risk}-risk task`,
        { details: { gate, risk: this.#assessment.risk } },
      );
    }
    return record;
  }

  statusOf(gate: GateId): GateStatus {
    return this.#require(gate).status;
  }

  markExecuted(gate: GateId): void {
    const record = this.#require(gate);
    if (record.status !== "required") {
      throw new LeanRigorError(
        "LR_INVALID_TRANSITION",
        `gate "${gate}" cannot move from ${record.status} to executed`,
        { details: { gate, from: record.status } },
      );
    }
    this.#gates.set(gate, { id: gate, status: "executed" });
  }

  markPassed(gate: GateId, options: PassOptions = {}): void {
    const record = this.#require(gate);
    if (record.status !== "executed") {
      throw new LeanRigorError(
        "LR_INVALID_TRANSITION",
        `gate "${gate}" cannot move from ${record.status} to passed; it must be executed first`,
        { details: { gate, from: record.status } },
      );
    }

    const evidence = options.evidence?.trim() ?? "";
    if (requiresEvidence(gate, this.#assessment.risk) && evidence === "") {
      throw new LeanRigorError(
        "LR_GATE_INCOMPLETE",
        `gate "${gate}" cannot pass without an evidence identifier`,
        { details: { gate, risk: this.#assessment.risk } },
      );
    }

    this.#gates.set(gate, {
      id: gate,
      status: "passed",
      ...(evidence === "" ? {} : { evidence }),
    });
  }

  /**
   * Skips a gate. A reason is always required, and a mandatory gate can never
   * be skipped — not for a token budget, not for a deadline.
   */
  markSkipped(gate: GateId, reason: string): void {
    this.#require(gate);
    const stated = reason.trim();
    if (stated === "") {
      throw new LeanRigorError(
        "LR_GATE_INCOMPLETE",
        `skipping gate "${gate}" requires a stated reason`,
        { details: { gate } },
      );
    }
    if (mandatoryGates(this.#assessment.risk).includes(gate)) {
      throw new LeanRigorError(
        "LR_GATE_INCOMPLETE",
        `gate "${gate}" is mandatory for a ${this.#assessment.risk}-risk task and cannot be skipped`,
        { details: { gate, risk: this.#assessment.risk } },
      );
    }
    this.#gates.set(gate, { id: gate, status: "skipped", reason: stated });
  }

  outstandingMandatoryGates(): readonly GateId[] {
    return mandatoryGates(this.#assessment.risk).filter(
      (gate) => this.#gates.get(gate)?.status !== "passed",
    );
  }

  isComplete(): boolean {
    return this.outstandingMandatoryGates().length === 0;
  }

  snapshot(): WorkflowState {
    return {
      taskId: this.#taskId,
      risk: this.#assessment.risk,
      baseRisk: this.#assessment.baseRisk,
      matchedRules: this.#assessment.matchedRules,
      gates: [...this.#gates.values()],
    };
  }
}
