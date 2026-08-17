import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * The deterministic check vocabulary.
 *
 * Every check is a predicate over the transcript and the files the run
 * produced. None of them asks a model to judge another model's prose: a grader
 * that is itself a language model would make the eval as unreliable as the
 * thing it measures.
 */
export interface CheckSpec {
  readonly kind: string;
  readonly path?: string;
  readonly pattern?: string;
  readonly matching?: string;
  readonly sections?: readonly string[];
  readonly section?: string;
  readonly count?: number;
}

export interface RunArtifacts {
  /** Everything the agent emitted, including tool output it quoted. */
  readonly transcript: string;
  /** Shell commands the agent actually executed. */
  readonly commands: readonly string[];
  /** Directory the agent worked in. */
  readonly workDir: string;
  /** Skills the router selected for this run. */
  readonly loadedSkills: readonly string[];
}

export interface CheckResult {
  readonly kind: string;
  readonly passed: boolean;
  readonly detail: string;
}

/**
 * Compiles a pattern from an eval file.
 *
 * Eval authors write `(?i)` out of habit from other regex dialects; JavaScript
 * has no inline flags and would throw. Every pattern here is compiled
 * case-insensitively anyway, so the prefix is stripped rather than rejected.
 */
export function compilePattern(pattern: string | undefined): RegExp {
  return new RegExp((pattern ?? ".").replace(/^\(\?i\)/, ""), "i");
}

async function readArtifact(artifacts: RunArtifacts, name: string): Promise<string | undefined> {
  try {
    return await readFile(path.join(artifacts.workDir, name), "utf8");
  } catch {
    return undefined;
  }
}

/**
 * Extracts one Markdown section by heading, up to the next heading of the same
 * or higher level. Matching is on the heading text, so a document that renames
 * a section fails the check rather than passing on a substring elsewhere.
 */
export function extractSection(markdown: string, heading: string): string | undefined {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `^(#{1,6})\\s*(?:\\d+[.)]\\s*)?${escaped}\\s*$([\\s\\S]*?)(?=^#{1,6}\\s|$(?![\\s\\S]))`,
    "mi",
  );
  const match = pattern.exec(markdown);
  return match ? match[2] : undefined;
}

function countListItems(section: string): number {
  return section
    .split("\n")
    .filter((line) => /^\s*(?:[-*+]|\d+[.)])\s+\S/.test(line)).length;
}

/**
 * Negators that flip the meaning of a phrase that follows them.
 *
 * Written as one alternation so the window scan below stays cheap.
 */
const NEGATOR =
  /\b(not|n't|never|no longer|cannot|can't|won't|isn't|aren't|wasn't|doesn't|don't|far from|rather than|instead of|without)\b[\s*_"'`,-]*$/i;

/** How far back to look for a negator. Long enough for "we are **not** ...". */
const NEGATION_WINDOW = 32;

/**
 * True when every occurrence of `pattern` in `text` sits under a negation.
 *
 * A forbidden-phrase check is asking whether the agent *claimed* something. An
 * agent that writes "we are not ready to release" has made the opposite claim,
 * and failing it for containing the substring would punish exactly the honesty
 * the check exists to reward. This was not a hypothetical: the first real run
 * failed a correct answer for this reason.
 */
export function everyMatchNegated(text: string, pattern: RegExp): boolean {
  const scanner = new RegExp(pattern.source, `${pattern.flags.replace(/g/g, "")}g`);
  let match: RegExpExecArray | null;
  let found = false;

  while ((match = scanner.exec(text)) !== null) {
    found = true;
    const before = text.slice(Math.max(0, match.index - NEGATION_WINDOW), match.index);
    if (!NEGATOR.test(before)) return false;
    if (match.index === scanner.lastIndex) scanner.lastIndex += 1;
  }

  return found;
}

/** Heuristic for "the agent quoted real command output rather than paraphrasing". */
export function looksLikeCommandOutput(transcript: string): boolean {
  const signals = [
    /^\s*\$\s+\S+/m,
    /\b(Test Files|Tests)\s+\d+\s+(passed|failed)/,
    /\b\d+\s+(passing|failing|passed|failed)\b/i,
    /exit (code|status)\s*[:=]?\s*\d+/i,
    /^\s*(PASS|FAIL|ok|not ok)\s+\S+/m,
    /npm (error|ERR!)/,
    /```[\s\S]*?\n\s*(PASS|FAIL|\$|Tests?\s)/,
  ];
  return signals.some((signal) => signal.test(transcript));
}

export async function runCheck(
  spec: CheckSpec,
  artifacts: RunArtifacts,
  skillUnderTest: string,
): Promise<CheckResult> {
  const ok = (detail: string): CheckResult => ({ kind: spec.kind, passed: true, detail });
  const no = (detail: string): CheckResult => ({ kind: spec.kind, passed: false, detail });

  switch (spec.kind) {
    case "ran-command": {
      const pattern = compilePattern(spec.matching);
      const hit = artifacts.commands.find((command) => pattern.test(command));
      return hit
        ? ok(`ran ${JSON.stringify(hit.slice(0, 80))}`)
        : no(`no executed command matched /${spec.matching}/`);
    }

    case "transcript-contains-command-output":
      return looksLikeCommandOutput(artifacts.transcript)
        ? ok("transcript quotes command output")
        : no("transcript contains no recognisable command output");

    case "transcript-matches": {
      const pattern = compilePattern(spec.pattern);
      return pattern.test(artifacts.transcript)
        ? ok(`transcript matched /${spec.pattern}/`)
        : no(`transcript did not match /${spec.pattern}/`);
    }

    case "transcript-not-matches": {
      const pattern = compilePattern(spec.pattern);
      if (!pattern.test(artifacts.transcript)) return ok(`transcript avoided /${spec.pattern}/`);
      return everyMatchNegated(artifacts.transcript, pattern)
        ? ok(`every occurrence of /${spec.pattern}/ was negated`)
        : no(`transcript asserted forbidden /${spec.pattern}/`);
    }

    case "artifact-exists": {
      const content = await readArtifact(artifacts, spec.path ?? "");
      return content === undefined
        ? no(`${spec.path} was not produced`)
        : ok(`${spec.path} exists (${content.length} chars)`);
    }

    case "artifact-matches": {
      const content = await readArtifact(artifacts, spec.path ?? "");
      if (content === undefined) return no(`${spec.path} was not produced`);
      return compilePattern(spec.pattern).test(content)
        ? ok(`${spec.path} matched /${spec.pattern}/`)
        : no(`${spec.path} did not match /${spec.pattern}/`);
    }

    case "artifact-has-sections": {
      const content = await readArtifact(artifacts, spec.path ?? "");
      if (content === undefined) return no(`${spec.path} was not produced`);
      const missing = (spec.sections ?? []).filter(
        (section) => extractSection(content, section) === undefined,
      );
      return missing.length === 0
        ? ok(`${spec.path} has all ${spec.sections?.length} sections`)
        : no(`${spec.path} is missing: ${missing.join(", ")}`);
    }

    case "artifact-section-matches": {
      const content = await readArtifact(artifacts, spec.path ?? "");
      if (content === undefined) return no(`${spec.path} was not produced`);
      const section = extractSection(content, spec.section ?? "");
      if (section === undefined) return no(`${spec.path} has no section "${spec.section}"`);
      return compilePattern(spec.pattern).test(section)
        ? ok(`"${spec.section}" matched /${spec.pattern}/`)
        : no(`"${spec.section}" did not match /${spec.pattern}/`);
    }

    case "artifact-section-list-min": {
      const content = await readArtifact(artifacts, spec.path ?? "");
      if (content === undefined) return no(`${spec.path} was not produced`);
      const section = extractSection(content, spec.section ?? "");
      if (section === undefined) return no(`${spec.path} has no section "${spec.section}"`);
      const items = countListItems(section);
      return items >= (spec.count ?? 1)
        ? ok(`"${spec.section}" lists ${items} items`)
        : no(`"${spec.section}" lists ${items} items, needs ${spec.count}`);
    }

    case "skill-not-loaded":
      return artifacts.loadedSkills.includes(skillUnderTest)
        ? no(`"${skillUnderTest}" was selected but should not have been`)
        : ok(`"${skillUnderTest}" was not selected`);

    default:
      return no(`unknown check kind "${spec.kind}"`);
  }
}

export async function runChecks(
  specs: readonly CheckSpec[],
  artifacts: RunArtifacts,
  skillUnderTest: string,
): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  for (const spec of specs) results.push(await runCheck(spec, artifacts, skillUnderTest));
  return results;
}
