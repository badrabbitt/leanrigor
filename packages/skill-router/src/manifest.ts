import { z } from "zod";
import { LeanRigorError } from "@leanrigor/core";
import { RISK_LEVELS, type RiskLevel } from "@leanrigor/workflow-runtime";

/** Capabilities a skill's scripts must declare before they may be run. */
export const CAPABILITIES = ["network", "shell", "filesystem", "secrets"] as const;
export type Capability = (typeof CAPABILITIES)[number];

/**
 * The LeanRigor sidecar.
 *
 * The portable `SKILL.md` stays standard Agent Skills; everything LeanRigor
 * needs for routing, budgeting and provenance lives here, so a skill remains
 * usable by other agents that know nothing about LeanRigor.
 */
export const SidecarSchema = z.strictObject({
  schema_version: z.literal(1),
  skill: z.string().min(1),
  version: z.string().min(1),
  risk_levels: z.array(z.enum(RISK_LEVELS)).min(1).optional(),
  context_budget_tokens: z.number().int().min(0).optional(),
  outputs: z.array(z.string().min(1)).optional(),
  requires: z.array(z.string().min(1)).optional(),
  capabilities: z.array(z.enum(CAPABILITIES)).optional(),
  /**
   * Names a workflow the skill insists on. Two skills naming different
   * workflows cannot be loaded together — one of them would be disobeyed.
   */
  mandatory_workflow: z.string().min(1).optional(),
  verification: z.strictObject({ suite: z.string().min(1) }).optional(),
  provenance: z.strictObject({ manifest: z.string().min(1) }).optional(),
});

export type SidecarInput = z.infer<typeof SidecarSchema>;

export interface Sidecar {
  readonly skill: string;
  readonly version: string;
  readonly riskLevels: readonly RiskLevel[] | undefined;
  readonly contextBudgetTokens: number;
  readonly outputs: readonly string[];
  readonly requires: readonly string[];
  readonly capabilities: readonly Capability[];
  readonly mandatoryWorkflow: string | undefined;
  readonly verificationSuite: string | undefined;
  readonly provenanceManifest: string | undefined;
}

export const InfluenceSchema = z.object({
  project: z.string().min(1).optional(),
  source: z.string().min(1).optional(),
  license: z.string().min(1).optional(),
  use: z.string().min(1).optional(),
  concepts: z.array(z.string()).optional(),
});

export const ProvenanceSchema = z.object({
  artifact: z.string().min(1),
  implementation: z.enum(["independently-authored", "adapted", "copied"]),
  influences: z.array(InfluenceSchema).optional(),
  copied_files: z.array(z.string()).optional(),
  source_url: z.string().url().optional(),
  license: z.string().min(1).optional(),
  notice: z.string().min(1).optional(),
  reviewed_by: z.string().min(1).optional(),
});

export interface Influence {
  readonly project?: string | undefined;
  readonly source?: string | undefined;
  readonly license?: string | undefined;
  /** How the source was used, e.g. "research-only". */
  readonly use?: string | undefined;
  readonly concepts?: readonly string[] | undefined;
}

export interface Provenance {
  readonly artifact: string;
  readonly implementation: "independently-authored" | "adapted" | "copied";
  readonly influences: readonly Influence[];
  readonly copiedFiles: readonly string[];
  readonly sourceUrl?: string;
  readonly license?: string;
  readonly notice?: string;
  readonly reviewedBy?: string;
}

export interface SkillManifest {
  readonly name: string;
  readonly description: string;
  readonly directory: string;
  readonly license: string;
  readonly sidecar?: Sidecar;
  readonly provenance?: Provenance;
  readonly scriptFiles: readonly string[];
}

export function invalid(message: string, details: Record<string, string | number> = {}): never {
  throw new LeanRigorError("LR_SKILL_INVALID", message, { details });
}

export function normalizeSidecar(input: SidecarInput): Sidecar {
  return {
    skill: input.skill,
    version: input.version,
    riskLevels: input.risk_levels,
    contextBudgetTokens: input.context_budget_tokens ?? 0,
    outputs: input.outputs ?? [],
    requires: input.requires ?? [],
    capabilities: input.capabilities ?? [],
    mandatoryWorkflow: input.mandatory_workflow,
    verificationSuite: input.verification?.suite,
    provenanceManifest: input.provenance?.manifest,
  };
}
