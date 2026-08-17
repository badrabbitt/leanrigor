/**
 * Stable, machine-readable error codes. These appear in CLI output, logs and
 * tests, so a code is part of the public contract: rename it only with a
 * documented migration.
 */
export const ERROR_CODES = [
  "LR_INVALID_CONFIG",
  "LR_INVALID_EVENT",
  "LR_INVALID_HANDLE",
  "LR_HANDLE_NOT_FOUND",
  "LR_MEASUREMENT_UNAVAILABLE",
  "LR_UPSTREAM_UNAVAILABLE",
  "LR_UPSTREAM_TIMEOUT",
  "LR_LIMIT_EXCEEDED",
  "LR_NAME_COLLISION",
  "LR_GATE_INCOMPLETE",
  "LR_INVALID_TRANSITION",
  "LR_SKILL_INVALID",
  "LR_SKILL_CONFLICT",
  "LR_PROVENANCE_MISSING",
  "LR_HOST_NOT_DETECTED",
  "LR_TELEMETRY_DISABLED",
  "LR_RELEASE_GATE_FAILED",
  "LR_NOT_IMPLEMENTED",
  "LR_UNKNOWN_COMMAND",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export interface LeanRigorErrorOptions {
  /** Underlying error, preserved for diagnostics. */
  readonly cause?: unknown;
  /**
   * Structured, non-sensitive detail. Never place prompts, source code, file
   * contents or credentials here — error objects are rendered to users and may
   * be attached to bug reports.
   */
  readonly details?: Readonly<Record<string, string | number | boolean>>;
}

export class LeanRigorError extends Error {
  readonly code: ErrorCode;
  readonly details: Readonly<Record<string, string | number | boolean>>;

  constructor(code: ErrorCode, message: string, options: LeanRigorErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "LeanRigorError";
    this.code = code;
    this.details = options.details ?? {};
  }
}

export function isLeanRigorError(value: unknown): value is LeanRigorError {
  return value instanceof LeanRigorError;
}
