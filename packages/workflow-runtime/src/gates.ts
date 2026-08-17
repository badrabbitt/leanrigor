import { isAtLeast, type RiskAssessment, type RiskLevel } from "./risk.js";

export const GATE_IDS = [
  "scope-check",
  "clarify",
  "reproduce",
  "discovery",
  "threat-model",
  "design",
  "plan",
  "isolation",
  "regression-test",
  "tests",
  "implementation",
  "review",
  "independent-review",
  "approval",
  "rollback-plan",
  "rollout",
  "verification",
] as const;

export type GateId = (typeof GATE_IDS)[number];

/**
 * Gates required at each risk level, in execution order.
 *
 * The list grows with risk rather than being a fixed pipeline: applying a
 * design and review gate to a typo wastes context, and skipping a threat model
 * on an auth change is a defect. Verification closes every level.
 */
const GATES_BY_RISK: Readonly<Record<RiskLevel, readonly GateId[]>> = {
  trivial: ["scope-check", "implementation", "verification"],
  low: ["scope-check", "reproduce", "implementation", "regression-test", "verification"],
  medium: [
    "scope-check",
    "clarify",
    "design",
    "implementation",
    "tests",
    "review",
    "verification",
  ],
  high: [
    "scope-check",
    "discovery",
    "design",
    "plan",
    "isolation",
    "implementation",
    "tests",
    "review",
    "rollout",
    "verification",
  ],
  critical: [
    "scope-check",
    "discovery",
    "threat-model",
    "design",
    "plan",
    "isolation",
    "implementation",
    "tests",
    "review",
    "independent-review",
    "approval",
    "rollback-plan",
    "rollout",
    "verification",
  ],
};

/**
 * Gates that cannot be skipped, whatever the token cost.
 *
 * This is the line the product will not cross: a shorter workflow may drop a
 * design discussion, but it may never drop verification, and it may never drop
 * a critical task's threat model, approval or rollback plan.
 */
export const MANDATORY_GATES: Readonly<Record<RiskLevel, readonly GateId[]>> = {
  trivial: ["verification"],
  low: ["verification"],
  medium: ["verification"],
  high: ["verification", "review"],
  critical: [
    "verification",
    "review",
    "independent-review",
    "threat-model",
    "approval",
    "rollback-plan",
  ],
};

/** Gates whose completion must be backed by an evidence identifier. */
export const EVIDENCE_REQUIRED: readonly GateId[] = [
  "verification",
  "approval",
  "independent-review",
  "rollback-plan",
  "threat-model",
];

export function selectGates(assessment: RiskAssessment): readonly GateId[] {
  return GATES_BY_RISK[assessment.risk];
}

export function mandatoryGates(risk: RiskLevel): readonly GateId[] {
  return MANDATORY_GATES[risk];
}

export function requiresEvidence(gate: GateId, risk: RiskLevel): boolean {
  if (!EVIDENCE_REQUIRED.includes(gate)) return false;
  // Below high risk only verification carries a hard evidence requirement.
  if (gate === "verification") return true;
  return isAtLeast(risk, "high");
}
