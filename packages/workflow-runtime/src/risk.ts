import { LeanRigorError } from "@leanrigor/core";

export const RISK_LEVELS = ["trivial", "low", "medium", "high", "critical"] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

export function rank(level: RiskLevel): number {
  return RISK_LEVELS.indexOf(level);
}

export function isAtLeast(level: RiskLevel, floor: RiskLevel): boolean {
  return rank(level) >= rank(floor);
}

export function maxRisk(a: RiskLevel, b: RiskLevel): RiskLevel {
  return rank(a) >= rank(b) ? a : b;
}

export interface MatchedRule {
  readonly id: string;
  readonly risk: RiskLevel;
  readonly because: string;
}

export interface ClassifyInput {
  /** What the user asked for, in their own words. */
  readonly intent: string;
  /** Paths the change is expected to touch. */
  readonly changedPaths?: readonly string[];
  readonly override?: { readonly risk: RiskLevel; readonly reason?: string };
}

export interface RiskAssessment {
  readonly risk: RiskLevel;
  /** What the rules computed, before any user override. */
  readonly baseRisk: RiskLevel;
  readonly matchedRules: readonly MatchedRule[];
  readonly overridden: boolean;
  readonly overrideReason?: string;
}

interface Rule {
  readonly id: string;
  readonly risk: RiskLevel;
  readonly because: string;
  readonly intent?: RegExp;
  readonly path?: RegExp;
  /**
   * When set, both patterns must match. Used where one signal alone is
   * genuinely ambiguous: "drop" is destructive in a migration and harmless in
   * prose.
   */
  readonly requireBoth?: boolean;
  /**
   * Cosmetic rules describe the *whole* change rather than raising a floor, so
   * they can hold a task at trivial — but only when no structural rule fired.
   */
  readonly cosmetic?: boolean;
}

/**
 * Classification rules, in one table so the policy can be read and reviewed as
 * data rather than inferred from branching code.
 *
 * Path rules always raise the floor, which is why a "small tidy-up" inside
 * `src/auth/` is still critical. Wording rules raise it too, unless the request
 * is classified as cosmetic — a typo fix should not inherit the bug-fix floor
 * just because it contains the word "fix".
 */
const RULES: readonly Rule[] = [
  {
    id: "auth",
    risk: "critical",
    because: "authentication or session handling",
    intent: /\b(auth|authentication|login|sign[- ]?in|session|token|oauth|sso)\b/i,
    path: /(^|\/)(auth|authn|login|session)s?(\/|\.)/i,
  },
  {
    id: "authorization",
    risk: "critical",
    because: "authorization or permission policy",
    intent: /\b(authoriz|authoris|permission|access control|rbac|acl|privilege)/i,
    path: /(^|\/)(authz|authorization|permissions?|policy|policies)(\/|\.)/i,
  },
  {
    id: "payment",
    risk: "critical",
    because: "payment or billing",
    intent: /\b(payment|billing|charge|refund|invoice|subscription|card|checkout)\b/i,
    path: /(^|\/)(billing|payments?|checkout|stripe)(\/|\.)/i,
  },
  {
    id: "secrets",
    risk: "critical",
    because: "secret, key or credential handling",
    intent: /\b(secret|credential|api[- ]?key|private key|signing key|password|hash(ing)?)\b/i,
    path: /(^|\/)(secrets?|credentials?|crypto|keys?)(\/|\.)/i,
  },
  {
    id: "security-policy",
    risk: "critical",
    because: "a security policy or its generated output",
    path: /(^|\/)(security|\.well-known)(\/|\.)|(^|\/)(security|threat[- ]model)\.(md|ya?ml|json)$/i,
  },
  {
    id: "destructive-data",
    risk: "critical",
    because: "destructive or irreversible data handling",
    intent: /\b(drops?|truncates?|deletes?|purges?|wipes?|destroys?|erases?)\b.*\b(tables?|columns?|records?|data|users?|rows?)/i,
  },
  {
    id: "destructive-migration",
    risk: "critical",
    because: "a migration that removes data",
    intent: /\b(drops?|removes?|deletes?|truncates?)\b/i,
    path: /(^|\/)migrations?(\/|\.)/i,
    requireBoth: true,
  },
  {
    id: "migration",
    risk: "high",
    because: "a schema migration",
    path: /(^|\/)migrations?(\/|\.)/i,
  },
  {
    id: "release-automation",
    risk: "high",
    because: "release or CI automation",
    path: /(^|\/)\.github\/workflows\/|(^|\/)(Dockerfile|\.gitlab-ci\.ya?ml)$/i,
  },
  {
    id: "release-metadata",
    risk: "medium",
    because: "published package metadata",
    path: /(^|\/)(package\.json|package-lock\.json)$/i,
  },
  {
    id: "cross-component",
    risk: "high",
    because: "a change spanning several components",
  },
  {
    id: "feature",
    risk: "medium",
    because: "new behaviour in one component",
    intent: /\b(add|implement|introduce|support|build|create)\b/i,
  },
  {
    id: "bugfix",
    risk: "low",
    because: "an isolated defect fix",
    intent: /\b(fix|bug|defect|regression|off[- ]by[- ]one|crash|broken)\b/i,
  },
  {
    id: "cosmetic",
    risk: "trivial",
    because: "a typo or formatting change",
    intent: /\b(typos?|spelling|whitespace|format|reformat|prettier|lint|comments?|wording)\b/i,
    cosmetic: true,
  },
];

/** Top-level directory under `src/`, used as a rough component boundary. */
function componentOf(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  const index = parts.indexOf("src");
  if (index >= 0 && parts.length > index + 2) return parts[index + 1]!;
  return parts.slice(0, -1).join("/") || ".";
}

const CROSS_COMPONENT_THRESHOLD = 3;

/** Only low- and medium-risk wording rules can be overridden by a cosmetic match. */
function cosmeticCanOverride(risk: RiskLevel): boolean {
  return risk === "low" || risk === "medium";
}

/**
 * Classifies a task deterministically.
 *
 * No model is called: the MVP classifier reads the request text and the paths
 * the change touches. That keeps classification reproducible, auditable and
 * free, and it means the thing that decides whether a security gate applies
 * cannot itself be talked out of it.
 */
export function classifyTask(input: ClassifyInput): RiskAssessment {
  const intent = input.intent ?? "";
  const paths = [...(input.changedPaths ?? [])].sort();

  const matched: MatchedRule[] = [];
  let base: RiskLevel = "trivial";
  // Floor contributed by wording-only rules, applied unless the change is
  // classified as cosmetic.
  let intentFloor: RiskLevel = "trivial";

  const components = new Set(paths.map(componentOf));
  if (components.size >= CROSS_COMPONENT_THRESHOLD) {
    const rule = RULES.find((r) => r.id === "cross-component")!;
    matched.push({ id: rule.id, risk: rule.risk, because: rule.because });
    base = maxRisk(base, rule.risk);
  }

  let cosmetic = false;

  for (const rule of RULES) {
    if (rule.id === "cross-component") continue;

    const intentHit = rule.intent?.test(intent) ?? false;
    const pathHit = rule.path ? paths.some((p) => rule.path!.test(p)) : false;
    const hit = rule.requireBoth ? intentHit && pathHit : intentHit || pathHit;

    if (!hit) continue;
    matched.push({ id: rule.id, risk: rule.risk, because: rule.because });

    if (rule.cosmetic) {
      cosmetic = true;
      continue;
    }
    // Rules driven purely by the request's wording describe intent, which a
    // cosmetic match can override; rules driven by a path describe what the
    // change actually touches, and those always hold.
    const structural = rule.path !== undefined;
    if (structural || !cosmeticCanOverride(rule.risk)) base = maxRisk(base, rule.risk);
    else intentFloor = maxRisk(intentFloor, rule.risk);
  }

  // A typo fix is a typo fix even though "fix" also reads as a bug fix — but a
  // typo in a security policy or in published package metadata is not trivial,
  // because a path rule fired.
  if (!cosmetic) base = maxRisk(base, intentFloor);

  matched.sort((a, b) => rank(b.risk) - rank(a.risk) || a.id.localeCompare(b.id));

  if (!input.override) {
    return { risk: base, baseRisk: base, matchedRules: matched, overridden: false };
  }

  const target = input.override.risk;
  const lowering = rank(target) < rank(base);
  const reason = input.override.reason?.trim() ?? "";

  if (lowering && reason === "") {
    throw new LeanRigorError(
      "LR_GATE_INCOMPLETE",
      `lowering risk from ${base} to ${target} requires an explicit reason`,
      { details: { baseRisk: base, requested: target } },
    );
  }

  return {
    risk: target,
    baseRisk: base,
    matchedRules: matched,
    overridden: true,
    ...(reason === "" ? {} : { overrideReason: reason }),
  };
}
