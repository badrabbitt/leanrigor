import type { GateId } from "./gates.js";
import type { MatchedRule, RiskLevel } from "./risk.js";

export type GateStatus = "required" | "executed" | "passed" | "skipped";

export interface GateRecord {
  readonly id: GateId;
  readonly status: GateStatus;
  /** Identifier of the artifact proving the gate ran: a handle, run id or URL. */
  readonly evidence?: string;
  /** Why a gate was skipped. Required for every skip. */
  readonly reason?: string;
}

/**
 * The persisted workflow state.
 *
 * It holds decisions, statuses and evidence identifiers — never a conversation
 * transcript. State that grows with the conversation would defeat the point of
 * the product.
 */
export interface WorkflowState {
  readonly taskId: string;
  readonly risk: RiskLevel;
  readonly baseRisk: RiskLevel;
  readonly matchedRules: readonly MatchedRule[];
  readonly gates: readonly GateRecord[];
}

export function serializeState(state: WorkflowState): string {
  return JSON.stringify({
    taskId: state.taskId,
    risk: state.risk,
    baseRisk: state.baseRisk,
    matchedRules: state.matchedRules,
    gates: state.gates,
  });
}

export function deserializeState(serialized: string): WorkflowState {
  return JSON.parse(serialized) as WorkflowState;
}
