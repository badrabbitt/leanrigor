import { homedir } from "node:os";
import path from "node:path";
import type { HostAdapter, InstallPlan } from "@leanrigor/core";
import { ClaudeCodeAdapter } from "@leanrigor/host-claude";
import { CodexAdapter } from "@leanrigor/host-codex";
import type { CliIo } from "../cli.js";
import { EXIT_FAILURE, EXIT_OK, EXIT_UNAVAILABLE } from "../cli.js";

export interface InitOptions {
  readonly projectDir?: string;
  readonly homeDir?: string;
  /** Apply without asking. Required in a non-interactive session. */
  readonly yes?: boolean;
  /** Show the plan and exit without writing anything. */
  readonly dryRun?: boolean;
  /** Restrict the install to named hosts. */
  readonly hosts?: readonly string[];
  readonly confirm?: (plan: InstallPlan) => Promise<boolean>;
}

export function buildAdapters(projectDir: string, homeDir: string): HostAdapter[] {
  return [
    new ClaudeCodeAdapter({ projectDir, homeDir }),
    new CodexAdapter({ codexDir: path.join(homeDir, ".codex"), projectDir }),
  ];
}

function renderPlan(plan: InstallPlan): string[] {
  const lines = [`Host: ${plan.host}`];
  for (const change of plan.changes) {
    lines.push(`  ${change.kind === "create" ? "create" : "modify"}  ${change.path}`);
    lines.push(`          ${change.summary}`);
  }
  for (const backup of plan.backups) lines.push(`  backup  ${backup}`);
  for (const warning of plan.warnings) lines.push(`  warning ${warning}`);
  return lines;
}

/**
 * Detects supported hosts, previews every file change and applies it only after
 * confirmation.
 *
 * Nothing is written before the preview is shown. An install a user could not
 * inspect is an install they cannot trust, and this command edits files the
 * user's agent depends on.
 */
export async function runInit(io: CliIo, options: InitOptions = {}): Promise<number> {
  const projectDir = options.projectDir ?? process.cwd();
  const homeDir = options.homeDir ?? homedir();

  const adapters = buildAdapters(projectDir, homeDir).filter(
    (adapter) => !options.hosts || options.hosts.includes(adapter.host),
  );

  const detections = await Promise.all(adapters.map((adapter) => adapter.detect()));
  const found = adapters.filter((_, index) => detections[index]!.detected);

  io.out("LeanRigor — Less context. Full engineering rigor.");
  io.out("");
  for (const [index, adapter] of adapters.entries()) {
    const detection = detections[index]!;
    io.out(
      `  ${detection.detected ? "found    " : "not found"}  ${adapter.host}`
      + (detection.detected ? `  (${detection.evidence.length} marker(s))` : ""),
    );
  }
  io.out("");

  if (found.length === 0) {
    io.err("LR_HOST_NOT_DETECTED: no supported coding-agent host was found.");
    io.err("Supported hosts: claude-code, codex.");
    return EXIT_UNAVAILABLE;
  }

  const plans: InstallPlan[] = [];
  for (const adapter of found) plans.push(await adapter.planInstall());

  io.out("Planned changes:");
  io.out("");
  for (const plan of plans) {
    for (const line of renderPlan(plan)) io.out(line);
    io.out("");
  }

  if (options.dryRun) {
    io.out("Dry run: nothing was written.");
    return EXIT_OK;
  }

  if (!options.yes) {
    const confirmed = options.confirm ? await Promise.all(plans.map(options.confirm)) : [];
    if (confirmed.length === 0 || confirmed.some((value) => !value)) {
      io.err("Aborted: no confirmation given. Re-run with --yes to apply this plan.");
      return EXIT_UNAVAILABLE;
    }
  }

  for (const [index, plan] of plans.entries()) {
    try {
      const result = await found[index]!.applyInstall(plan);
      for (const file of result.written) io.out(`  wrote   ${file}`);
      for (const file of result.backedUp) io.out(`  backup  ${file}`);
    } catch (error) {
      io.err(`Failed to install into ${plan.host}: ${(error as Error).message}`);
      return EXIT_FAILURE;
    }
  }

  io.out("");
  io.out("Installed. Run `leanrigor doctor` to check the result.");
  io.out("To reverse every change, run `leanrigor init --uninstall`.");
  return EXIT_OK;
}

/** Reverses whatever `init` installed, restoring the original files. */
export async function runUninstall(io: CliIo, options: InitOptions = {}): Promise<number> {
  const projectDir = options.projectDir ?? process.cwd();
  const homeDir = options.homeDir ?? homedir();

  const adapters = buildAdapters(projectDir, homeDir).filter(
    (adapter) => !options.hosts || options.hosts.includes(adapter.host),
  );

  let touched = 0;
  for (const adapter of adapters) {
    const result = await adapter.uninstall();
    for (const file of result.restored) {
      io.out(`  restored ${file}`);
      touched += 1;
    }
    for (const file of result.removed) {
      io.out(`  removed  ${file}`);
      touched += 1;
    }
  }

  io.out(touched === 0 ? "Nothing to uninstall." : "Uninstalled.");
  return EXIT_OK;
}
