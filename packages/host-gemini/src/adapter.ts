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

export interface GeminiAdapterOptions {
  /** Gemini home, normally `~/.gemini`. */
  readonly geminiDir: string;
  /** Project root whose audit log is written. */
  readonly projectDir: string;
  /** Command the host will launch. */
  readonly command?: string;
  readonly args?: readonly string[];
}

const SERVER_KEY = "leanrigor";

interface GeminiSettings {
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
 * Installs LeanRigor into Gemini CLI.
 *
 * Gemini CLI reads MCP servers from `~/.gemini/settings.json`. This adapter
 * edits that JSON object without claiming Gemini-specific hooks or skill
 * directories that LeanRigor cannot install portably.
 */
export class GeminiAdapter implements HostAdapter {
  readonly host = "gemini";

  readonly #geminiDir: string;
  readonly #projectDir: string;
  readonly #command: string;
  readonly #args: readonly string[];

  constructor(options: GeminiAdapterOptions) {
    this.#geminiDir = options.geminiDir;
    this.#projectDir = options.projectDir;
    this.#command = options.command ?? "npx";
    this.#args = options.args ?? ["-y", "leanrigor", "mcp", "serve"];
  }

  get configPath(): string {
    return path.join(this.#geminiDir, "settings.json");
  }

  get auditPath(): string {
    return path.join(this.#projectDir, ".leanrigor", AUDIT_FILE);
  }

  async detect(): Promise<HostDetection> {
    const candidates = [this.#geminiDir, this.configPath];
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

    let settings: GeminiSettings = {};
    if (current !== undefined) {
      try {
        const parsed = JSON.parse(current) as unknown;
        if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
          throw new Error("not an object");
        }
        settings = parsed as GeminiSettings;
      } catch {
        throw new LeanRigorError(
          "LR_INVALID_CONFIG",
          `${this.configPath} is not valid JSON; fix or move it before installing`,
          { details: { path: this.configPath } },
        );
      }
    }

    if (settings.mcpServers && SERVER_KEY in settings.mcpServers) {
      warnings.push(`an existing "${SERVER_KEY}" server entry will be replaced`);
    }

    const next: GeminiSettings = {
      ...settings,
      mcpServers: {
        ...(settings.mcpServers ?? {}),
        [SERVER_KEY]: { command: this.#command, args: [...this.#args] },
      },
    };

    const after = `${JSON.stringify(next, null, 2)}\n`;
    const change: FileChange = {
      kind: current === undefined ? "create" : "modify",
      path: this.configPath,
      summary:
        current === undefined
          ? "create .gemini/settings.json with the leanrigor MCP server"
          : `add the "${SERVER_KEY}" MCP server, preserving every other setting`,
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
      const settings = JSON.parse(await readFile(this.configPath, "utf8")) as GeminiSettings;
      const servers = { ...(settings.mcpServers ?? {}) };
      delete servers[SERVER_KEY];
      const otherKeys = Object.keys(settings).filter((key) => key !== "mcpServers");

      if (Object.keys(servers).length === 0 && otherKeys.length === 0) {
        await rm(this.configPath, { force: true });
        removed.push(this.configPath);
      } else {
        await writeFile(
          this.configPath,
          `${JSON.stringify({ ...settings, mcpServers: servers }, null, 2)}\n`,
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
