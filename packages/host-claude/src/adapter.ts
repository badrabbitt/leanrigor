import { appendFile, copyFile, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  AUDIT_FILE,
  BACKUP_SUFFIX,
  LeanRigorError,
  type FileChange,
  type HostAdapter,
  type HostCapability,
  type HostDetection,
  type InstallPlan,
  type InstallResult,
  type UninstallResult,
} from "@leanrigor/core";

export interface ClaudeAdapterOptions {
  /** Project root whose `.mcp.json` is edited. */
  readonly projectDir: string;
  /** User home, used only for detection. */
  readonly homeDir: string;
  /** Command the host will launch. */
  readonly command?: string;
  readonly args?: readonly string[];
}

const SERVER_KEY = "leanrigor";

interface McpConfig {
  mcpServers?: Record<string, unknown>;
  [key: string]: unknown;
}

async function readIfExists(filePath: string): Promise<string | undefined> {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Installs LeanRigor into Claude Code.
 *
 * Claude Code reads project-scoped MCP servers from `.mcp.json`, so that is the
 * single file this adapter owns. It does not write hooks or settings: Claude
 * Code's hook system is host-specific and LeanRigor has nothing to put there
 * yet, and a install that touches files it does not need is a install that is
 * harder to reverse.
 */
export class ClaudeCodeAdapter implements HostAdapter {
  readonly host = "claude-code";

  readonly #projectDir: string;
  readonly #homeDir: string;
  readonly #command: string;
  readonly #args: readonly string[];

  constructor(options: ClaudeAdapterOptions) {
    this.#projectDir = options.projectDir;
    this.#homeDir = options.homeDir;
    this.#command = options.command ?? "npx";
    this.#args = options.args ?? ["-y", "leanrigor", "mcp", "serve"];
  }

  get configPath(): string {
    return path.join(this.#projectDir, ".mcp.json");
  }

  get auditPath(): string {
    return path.join(this.#projectDir, ".leanrigor", AUDIT_FILE);
  }

  async detect(): Promise<HostDetection> {
    const candidates = [
      path.join(this.#homeDir, ".claude"),
      path.join(this.#homeDir, ".claude.json"),
      path.join(this.#projectDir, ".claude"),
      this.configPath,
    ];
    const evidence: string[] = [];
    for (const candidate of candidates) {
      if (await exists(candidate)) evidence.push(candidate);
    }
    const capabilities: HostCapability[] = ["mcp-servers", "project-skills", "user-skills"];
    return { host: this.host, detected: evidence.length > 0, evidence, capabilities };
  }

  async planInstall(): Promise<InstallPlan> {
    const current = await readIfExists(this.configPath);
    const warnings: string[] = [];

    let config: McpConfig = {};
    if (current !== undefined) {
      try {
        const parsed = JSON.parse(current) as unknown;
        if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
          throw new Error("not an object");
        }
        config = parsed as McpConfig;
      } catch {
        throw new LeanRigorError(
          "LR_INVALID_CONFIG",
          `${this.configPath} is not valid JSON; fix or move it before installing`,
          { details: { path: this.configPath } },
        );
      }
    }

    if (config.mcpServers && SERVER_KEY in config.mcpServers) {
      warnings.push(`an existing "${SERVER_KEY}" server entry will be replaced`);
    }

    const next: McpConfig = {
      ...config,
      mcpServers: {
        ...(config.mcpServers ?? {}),
        [SERVER_KEY]: { command: this.#command, args: [...this.#args] },
      },
    };

    const after = `${JSON.stringify(next, null, 2)}\n`;
    const change: FileChange = {
      kind: current === undefined ? "create" : "modify",
      path: this.configPath,
      summary:
        current === undefined
          ? "create .mcp.json with the leanrigor MCP server"
          : `add the "${SERVER_KEY}" MCP server, preserving every other entry`,
      after,
      ...(current === undefined ? {} : { before: current }),
    };

    return {
      host: this.host,
      changes: [change],
      backups: current === undefined ? [] : [`${this.configPath}${BACKUP_SUFFIX}`],
      warnings,
    };
  }

  async applyInstall(plan: InstallPlan): Promise<InstallResult> {
    if (plan.host !== this.host) {
      throw new LeanRigorError("LR_INVALID_CONFIG", `plan targets ${plan.host}, not ${this.host}`);
    }

    const written: string[] = [];
    const backedUp: string[] = [];

    for (const change of plan.changes) {
      if (change.kind === "modify") {
        // The backup is written before the mutation, never after: a crash in
        // between must leave the original recoverable.
        await copyFile(change.path, `${change.path}${BACKUP_SUFFIX}`);
        backedUp.push(`${change.path}${BACKUP_SUFFIX}`);
      }
      await mkdir(path.dirname(change.path), { recursive: true });
      await writeFile(change.path, change.after, "utf8");
      written.push(change.path);
    }

    await this.#audit(`install ${written.join(" ")}`);
    return { host: this.host, written, backedUp };
  }

  async uninstall(): Promise<UninstallResult> {
    const restored: string[] = [];
    const removed: string[] = [];
    const backup = `${this.configPath}${BACKUP_SUFFIX}`;

    if (await exists(backup)) {
      await copyFile(backup, this.configPath);
      await rm(backup, { force: true });
      restored.push(this.configPath);
    } else if (await exists(this.configPath)) {
      // LeanRigor created the file, so removing our entry may empty it.
      const config = JSON.parse(await readFile(this.configPath, "utf8")) as McpConfig;
      const servers = { ...(config.mcpServers ?? {}) };
      delete servers[SERVER_KEY];
      const otherKeys = Object.keys(config).filter((key) => key !== "mcpServers");

      if (Object.keys(servers).length === 0 && otherKeys.length === 0) {
        await rm(this.configPath, { force: true });
        removed.push(this.configPath);
      } else {
        await writeFile(
          this.configPath,
          `${JSON.stringify({ ...config, mcpServers: servers }, null, 2)}\n`,
          "utf8",
        );
        restored.push(this.configPath);
      }
    }

    await this.#audit(`uninstall ${[...restored, ...removed].join(" ")}`);
    return { host: this.host, restored, removed };
  }

  async #audit(line: string): Promise<void> {
    await mkdir(path.dirname(this.auditPath), { recursive: true });
    await appendFile(this.auditPath, `${new Date().toISOString()} ${this.host} ${line}\n`, "utf8");
  }
}
