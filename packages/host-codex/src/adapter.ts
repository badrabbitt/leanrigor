import { appendFile, copyFile, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
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

export interface CodexAdapterOptions {
  /** Codex home, normally `~/.codex`. */
  readonly codexDir: string;
  readonly projectDir: string;
  readonly command?: string;
  readonly args?: readonly string[];
}

const SERVER_KEY = "leanrigor";

interface CodexConfig {
  mcp_servers?: Record<string, unknown>;
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
 * Installs LeanRigor into Codex.
 *
 * Codex keeps its configuration in TOML under `~/.codex/config.toml`, and MCP
 * servers live under `[mcp_servers.<name>]`. The file is parsed and re-emitted
 * rather than appended to, so an existing entry cannot be duplicated — but that
 * also means TOML comments are not preserved, which the plan warns about
 * instead of quietly discarding them.
 *
 * Codex has no project-scoped skill directory equivalent to Claude Code's, so
 * this adapter does not advertise one.
 */
export class CodexAdapter implements HostAdapter {
  readonly host = "codex";

  readonly #codexDir: string;
  readonly #projectDir: string;
  readonly #command: string;
  readonly #args: readonly string[];

  constructor(options: CodexAdapterOptions) {
    this.#codexDir = options.codexDir;
    this.#projectDir = options.projectDir;
    this.#command = options.command ?? "npx";
    this.#args = options.args ?? ["-y", "leanrigor", "mcp", "serve"];
  }

  get configPath(): string {
    return path.join(this.#codexDir, "config.toml");
  }

  get auditPath(): string {
    return path.join(this.#projectDir, ".leanrigor", AUDIT_FILE);
  }

  async detect(): Promise<HostDetection> {
    const candidates = [this.#codexDir, this.configPath, path.join(this.#codexDir, "auth.json")];
    const evidence: string[] = [];
    for (const candidate of candidates) {
      if (await exists(candidate)) evidence.push(candidate);
    }
    const capabilities: HostCapability[] = ["mcp-servers"];
    return { host: this.host, detected: evidence.length > 0, evidence, capabilities };
  }

  async planInstall(): Promise<InstallPlan> {
    const current = await readIfExists(this.configPath);
    const warnings: string[] = [];

    let config: CodexConfig = {};
    if (current !== undefined) {
      try {
        config = parseToml(current) as CodexConfig;
      } catch {
        throw new LeanRigorError(
          "LR_INVALID_CONFIG",
          `${this.configPath} is not valid TOML; fix or move it before installing`,
          { details: { path: this.configPath } },
        );
      }
      if (/^\s*#/m.test(current)) {
        warnings.push(
          "config.toml contains comments; rewriting the file will drop them. "
          + `The original is kept at config.toml${BACKUP_SUFFIX}.`,
        );
      }
      if (config.mcp_servers && SERVER_KEY in config.mcp_servers) {
        warnings.push(`an existing "${SERVER_KEY}" server entry will be replaced`);
      }
    }

    const next: CodexConfig = {
      ...config,
      mcp_servers: {
        ...(config.mcp_servers ?? {}),
        [SERVER_KEY]: { command: this.#command, args: [...this.#args] },
      },
    };

    const after = `${stringifyToml(next)}\n`;
    const change: FileChange = {
      kind: current === undefined ? "create" : "modify",
      path: this.configPath,
      summary:
        current === undefined
          ? "create config.toml with the leanrigor MCP server"
          : `add [mcp_servers.${SERVER_KEY}], preserving every other setting`,
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
      const config = parseToml(await readFile(this.configPath, "utf8")) as CodexConfig;
      const servers = { ...(config.mcp_servers ?? {}) };
      delete servers[SERVER_KEY];
      const otherKeys = Object.keys(config).filter((key) => key !== "mcp_servers");

      if (Object.keys(servers).length === 0 && otherKeys.length === 0) {
        await rm(this.configPath, { force: true });
        removed.push(this.configPath);
      } else {
        await writeFile(
          this.configPath,
          `${stringifyToml({ ...config, mcp_servers: servers })}\n`,
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
