import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { LeanRigorError } from "@leanrigor/core";
import {
  CAPABILITIES,
  SidecarSchema,
  invalid,
  normalizeSidecar,
  type Capability,
  type SkillManifest,
} from "./manifest.js";
import { parseProvenance } from "./provenance.js";

interface Frontmatter {
  readonly name?: string;
  readonly description?: string;
  readonly license?: string;
}

/** Splits `SKILL.md` into its YAML frontmatter and body. */
export function parseFrontmatter(source: string): { data: Frontmatter; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(source);
  if (!match) invalid("SKILL.md must start with a YAML frontmatter block");
  const data = parseYaml(match[1]!) as Frontmatter | null;
  if (data === null || typeof data !== "object") invalid("SKILL.md frontmatter must be a mapping");
  return { data, body: match[2] ?? "" };
}

/**
 * Static capability detection for bundled scripts.
 *
 * This is intentionally conservative and syntactic: it flags what a script
 * *appears* to do so an author must declare it. It is a review aid, not a
 * sandbox, and LeanRigor does not execute skill scripts on the strength of it.
 */
export function detectCapabilities(source: string): Capability[] {
  const found = new Set<Capability>();
  if (/\bfetch\s*\(|https?\.request|axios|node:https?|XMLHttpRequest|WebSocket\b/.test(source)) {
    found.add("network");
  }
  if (/child_process|execSync|spawnSync|\bexec\s*\(|\bspawn\s*\(/.test(source)) found.add("shell");
  if (/node:fs|require\(["']fs["']\)|writeFileSync|readFileSync|rmSync/.test(source)) {
    found.add("filesystem");
  }
  if (/process\.env\.[A-Z0-9_]*(KEY|TOKEN|SECRET|PASSWORD)/.test(source)) found.add("secrets");
  return CAPABILITIES.filter((capability) => found.has(capability));
}

async function listScripts(directory: string): Promise<string[]> {
  const scriptsDir = path.join(directory, "scripts");
  try {
    const names = await readdir(scriptsDir);
    return names
      .filter((name) => /\.(mjs|cjs|js|ts|sh|py)$/.test(name))
      .map((name) => path.join(scriptsDir, name))
      .sort();
  } catch {
    return [];
  }
}

async function readOptionalYaml(filePath: string): Promise<unknown | undefined> {
  try {
    return parseYaml(await readFile(filePath, "utf8")) as unknown;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

/**
 * Validates one skill folder.
 *
 * A standard Agent Skills folder validates on its own; `leanrigor.yaml` and
 * `provenance.yaml` are checked only when present, so LeanRigor never makes a
 * portable skill non-portable.
 */
export async function validateSkill(directory: string): Promise<SkillManifest> {
  const name = path.basename(directory);

  let source: string;
  try {
    source = await readFile(path.join(directory, "SKILL.md"), "utf8");
  } catch {
    return invalid(`${name} has no SKILL.md`, { skill: name });
  }

  const { data } = parseFrontmatter(source);

  if (!data.name) invalid(`${name} declares no name in its frontmatter`, { skill: name });
  if (data.name !== name) {
    invalid(
      `${name} declares the name "${data.name}"; the folder and the declared name must match`,
      { skill: name },
    );
  }
  if (!data.description || data.description.trim().length < 20) {
    invalid(`${name} needs a description that states when the skill applies`, { skill: name });
  }
  if (!data.license) {
    invalid(
      `${name} declares no license; a skill cannot be distributed without one`,
      { skill: name },
    );
  }

  const rawSidecar = await readOptionalYaml(path.join(directory, "leanrigor.yaml"));
  let sidecar: SkillManifest["sidecar"];
  if (rawSidecar !== undefined) {
    const parsed = SidecarSchema.safeParse(rawSidecar);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      invalid(
        `${name} has an invalid leanrigor.yaml at ${issue?.path.join(".") ?? "<root>"}: ${issue?.message ?? "unknown issue"}`,
        { skill: name },
      );
    }
    if (parsed.data.skill !== name) {
      invalid(`${name} has a leanrigor.yaml naming a different skill`, { skill: name });
    }
    sidecar = normalizeSidecar(parsed.data);
  }

  const scriptFiles = await listScripts(directory);
  const declared = new Set(sidecar?.capabilities ?? []);
  for (const script of scriptFiles) {
    const detected = detectCapabilities(await readFile(script, "utf8"));
    const undeclared = detected.filter((capability) => !declared.has(capability));
    if (undeclared.length > 0) {
      invalid(
        `${name} ships ${path.basename(script)}, which uses ${undeclared.join(", ")} `
        + "without declaring the capability in leanrigor.yaml",
        { skill: name, undeclared: undeclared.join(",") },
      );
    }
  }

  let provenance: SkillManifest["provenance"];
  const provenanceFile = sidecar?.provenanceManifest ?? "provenance.yaml";
  const rawProvenance = await readOptionalYaml(path.join(directory, provenanceFile));
  if (rawProvenance !== undefined) {
    provenance = parseProvenance(rawProvenance, `skills/${name}`);
  }

  return {
    name,
    description: data.description!,
    directory,
    license: data.license!,
    ...(sidecar === undefined ? {} : { sidecar }),
    ...(provenance === undefined ? {} : { provenance }),
    scriptFiles,
  };
}

export interface DiscoveredSkill {
  readonly name: string;
  readonly directory: string;
  readonly valid: boolean;
  readonly manifest?: SkillManifest;
  readonly error?: string;
}

/**
 * Validates every skill folder under a root, reporting failures per skill.
 *
 * One broken skill must not hide the rest — a user with twenty skills should
 * still be told which one is wrong.
 */
export async function discoverSkills(root: string): Promise<DiscoveredSkill[]> {
  let names: string[];
  try {
    names = (await readdir(root, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }

  const discovered: DiscoveredSkill[] = [];
  for (const name of names) {
    const directory = path.join(root, name);
    if (!(await stat(directory)).isDirectory()) continue;
    try {
      discovered.push({ name, directory, valid: true, manifest: await validateSkill(directory) });
    } catch (error) {
      discovered.push({
        name,
        directory,
        valid: false,
        error: error instanceof Error ? error.message : "unknown error",
      });
    }
  }
  return discovered;
}

export interface CollectOptions {
  /** Skip invalid skills instead of failing the whole collection. */
  readonly ignoreInvalid?: boolean;
}

/** Collects validated skills across roots, rejecting duplicate names. */
export async function collectSkills(
  roots: readonly string[],
  options: CollectOptions = {},
): Promise<SkillManifest[]> {
  const byName = new Map<string, SkillManifest>();

  for (const root of roots) {
    for (const entry of await discoverSkills(root)) {
      if (!entry.valid || !entry.manifest) {
        if (options.ignoreInvalid) continue;
        throw new LeanRigorError("LR_SKILL_INVALID", entry.error ?? `${entry.name} is invalid`, {
          details: { skill: entry.name },
        });
      }
      const existing = byName.get(entry.name);
      if (existing && existing.directory !== entry.manifest.directory) {
        throw new LeanRigorError(
          "LR_SKILL_CONFLICT",
          `two skills are named "${entry.name}"; skill names must be unique across roots`,
          { details: { skill: entry.name } },
        );
      }
      byName.set(entry.name, entry.manifest);
    }
  }

  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}
