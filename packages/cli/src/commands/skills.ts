import { existsSync } from "node:fs";
import { cp, mkdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { discoverSkills, validateSkill } from "@leanrigor/skill-router";
import type { CliIo } from "../cli.js";
import { EXIT_FAILURE, EXIT_OK, EXIT_UNAVAILABLE } from "../cli.js";

export interface SkillsOptions {
  readonly projectDir?: string;
  readonly homeDir?: string;
  /** Where the skills bundled with this package live. */
  readonly bundledRoot?: string;
  readonly roots?: readonly string[];
}

function bundledSkillsRoot(options: SkillsOptions): string {
  if (options.bundledRoot) return options.bundledRoot;
  const here = path.dirname(fileURLToPath(import.meta.url));
  // Resolves from `src/commands` during development and from `dist/` in the
  // published package, where `skills/` sits beside the compiled bundle.
  for (const candidate of [
    path.resolve(here, "..", "skills"),
    path.resolve(here, "..", "..", "skills"),
    path.resolve(here, "..", "..", "..", "..", "skills"),
  ]) {
    if (existsSync(path.join(candidate, "verification", "SKILL.md"))) return candidate;
  }
  return path.resolve(here, "..", "skills");
}

function installRoots(options: SkillsOptions): string[] {
  if (options.roots) return [...options.roots];
  const projectDir = options.projectDir ?? process.cwd();
  const homeDir = options.homeDir ?? homedir();
  return [
    path.join(projectDir, ".leanrigor", "skills"),
    path.join(homeDir, ".leanrigor", "skills"),
  ];
}

/**
 * Lists installed skills and their validity.
 *
 * An invalid skill is shown with its reason rather than hidden: a user with a
 * skill that never triggers deserves to be told why.
 */
export async function runSkillsList(io: CliIo, options: SkillsOptions = {}): Promise<number> {
  const roots = installRoots(options);
  let total = 0;
  let invalid = 0;

  for (const root of roots) {
    const found = await discoverSkills(root);
    if (found.length === 0) continue;
    io.out(root);
    for (const entry of found) {
      total += 1;
      if (entry.valid) {
        const levels = entry.manifest?.sidecar?.riskLevels?.join(", ") ?? "any risk";
        const budget = entry.manifest?.sidecar?.contextBudgetTokens;
        io.out(
          `  ok    ${entry.name.padEnd(24)} ${levels}`
          + (budget ? `  (${budget} token budget)` : ""),
        );
      } else {
        invalid += 1;
        io.out(`  FAIL  ${entry.name.padEnd(24)} ${entry.error ?? "invalid"}`);
      }
    }
    io.out("");
  }

  if (total === 0) {
    io.out("No skills installed.");
    io.out("Install the skills LeanRigor ships with:");
    io.out("  leanrigor skills install verification");
    return EXIT_OK;
  }

  return invalid > 0 ? EXIT_FAILURE : EXIT_OK;
}

/** Copies a bundled skill into the project's skill directory, after validating it. */
export async function runSkillsInstall(
  name: string,
  io: CliIo,
  options: SkillsOptions = {},
): Promise<number> {
  const source = path.join(bundledSkillsRoot(options), name);

  try {
    await stat(source);
  } catch {
    io.err(`LR_SKILL_INVALID: no bundled skill named "${name}".`);
    return EXIT_UNAVAILABLE;
  }

  try {
    await validateSkill(source);
  } catch (error) {
    io.err(`LR_SKILL_INVALID: "${name}" did not validate: ${(error as Error).message}`);
    return EXIT_FAILURE;
  }

  const target = path.join(installRoots(options)[0]!, name);
  await mkdir(path.dirname(target), { recursive: true });
  await cp(source, target, { recursive: true });

  io.out(`Installed ${name} into ${target}`);
  return EXIT_OK;
}

/** Validates a skill directory without installing it. */
export async function runSkillsValidate(
  directory: string,
  io: CliIo,
): Promise<number> {
  try {
    const manifest = await validateSkill(directory);
    io.out(`ok  ${manifest.name}`);
    io.out(`    license      ${manifest.license}`);
    io.out(`    risk levels  ${manifest.sidecar?.riskLevels?.join(", ") ?? "any"}`);
    io.out(`    budget       ${manifest.sidecar?.contextBudgetTokens ?? "not declared"}`);
    io.out(`    provenance   ${manifest.provenance?.implementation ?? "not recorded"}`);
    return EXIT_OK;
  } catch (error) {
    io.err((error as Error).message);
    return EXIT_FAILURE;
  }
}

export async function runSkills(
  argv: readonly string[],
  io: CliIo,
  options: SkillsOptions = {},
): Promise<number> {
  const [action, argument] = argv;

  switch (action ?? "list") {
    case "list":
      return runSkillsList(io, options);
    case "install":
      if (!argument) {
        io.err("LR_UNKNOWN_COMMAND: `skills install` needs a skill name.");
        return EXIT_UNAVAILABLE;
      }
      return runSkillsInstall(argument, io, options);
    case "validate":
      if (!argument) {
        io.err("LR_UNKNOWN_COMMAND: `skills validate` needs a directory.");
        return EXIT_UNAVAILABLE;
      }
      return runSkillsValidate(argument, io);
    default:
      io.err(`LR_UNKNOWN_COMMAND: unknown skills action "${action}".`);
      io.err("Valid actions: list, install, validate.");
      return EXIT_UNAVAILABLE;
  }
}
