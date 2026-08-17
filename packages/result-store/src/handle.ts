import { createHash } from "node:crypto";
import { CONTENT_HANDLE_PATTERN, LeanRigorError, type ContentHandle } from "@leanrigor/core";

export const HANDLE_PREFIX = "lr_sha256_";

/** Computes the canonical handle for a payload. */
export function handleFor(bytes: Uint8Array): ContentHandle {
  const digest = createHash("sha256").update(bytes).digest("hex");
  return `${HANDLE_PREFIX}${digest}` as ContentHandle;
}

/**
 * Validates a caller-supplied handle.
 *
 * The pattern admits only 64 lowercase hex characters, so a validated handle
 * can never contain a path separator, `..`, or any other filesystem-meaningful
 * fragment. Callers must route every filesystem lookup through `hashOf`.
 */
export function assertHandle(value: string): ContentHandle {
  if (!CONTENT_HANDLE_PATTERN.test(value)) {
    throw new LeanRigorError(
      "LR_INVALID_HANDLE",
      `"${value.slice(0, 32)}" is not a valid content handle`,
      { details: { expected: "lr_sha256_<64 lowercase hex>" } },
    );
  }
  return value as ContentHandle;
}

/** Returns the hex digest of a validated handle. */
export function hashOf(handle: string): string {
  return assertHandle(handle).slice(HANDLE_PREFIX.length);
}
