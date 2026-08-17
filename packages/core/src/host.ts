/**
 * The contract every host adapter implements.
 *
 * Two properties matter more than convenience. An install is *previewed* before
 * it happens — `planInstall` returns exactly what will be created and edited,
 * so a user can refuse. And it is *reversible* — `uninstall` restores the files
 * to their prior bytes, leaving only an append-only audit record behind.
 */
export interface HostDetection {
  readonly host: string;
  readonly detected: boolean;
  /** Files the adapter found, used to explain the verdict to the user. */
  readonly evidence: readonly string[];
  /** Capabilities this host genuinely supports. Never claimed optimistically. */
  readonly capabilities: readonly HostCapability[];
}

/**
 * Host capabilities are declared per adapter rather than assumed to be
 * portable: hooks, skills and MCP scoping differ between hosts, and pretending
 * otherwise produces installs that silently do nothing.
 */
export type HostCapability = "mcp-servers" | "project-skills" | "user-skills" | "hooks";

export type FileChangeKind = "create" | "modify";

export interface FileChange {
  readonly kind: FileChangeKind;
  readonly path: string;
  /** Human-readable description of the edit, shown in the install preview. */
  readonly summary: string;
  /** Complete file contents after the change, so the preview is exact. */
  readonly after: string;
  /** Contents before the change, absent for a creation. */
  readonly before?: string;
}

export interface InstallPlan {
  readonly host: string;
  readonly changes: readonly FileChange[];
  /** Files copied to `<path>.leanrigor-backup` before being modified. */
  readonly backups: readonly string[];
  readonly warnings: readonly string[];
}

export interface InstallResult {
  readonly host: string;
  readonly written: readonly string[];
  readonly backedUp: readonly string[];
}

export interface UninstallResult {
  readonly host: string;
  readonly restored: readonly string[];
  readonly removed: readonly string[];
}

export interface HostAdapter {
  readonly host: string;
  detect(): Promise<HostDetection>;
  planInstall(): Promise<InstallPlan>;
  applyInstall(plan: InstallPlan): Promise<InstallResult>;
  uninstall(): Promise<UninstallResult>;
}

export const BACKUP_SUFFIX = ".leanrigor-backup";
/** Append-only record of installs and uninstalls; never removed by uninstall. */
export const AUDIT_FILE = "leanrigor-audit.log";
