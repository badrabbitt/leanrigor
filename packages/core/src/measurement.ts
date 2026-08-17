import { z } from "zod";

/**
 * How a token count was obtained. LeanRigor never merges these into an
 * unlabelled total, and never describes an estimate as provider usage.
 *
 * - `provider-usage`      usage fields returned by a provider SDK response
 * - `provider-count-api`  an official pre-request counting endpoint
 * - `tokenizer-estimate`  a local tokenizer, named and versioned
 * - `byte-only`           no token measurement was possible
 */
export const MEASUREMENT_MODES = [
  "provider-usage",
  "provider-count-api",
  "tokenizer-estimate",
  "byte-only",
] as const;

export const MeasurementModeSchema = z.enum(MEASUREMENT_MODES);
export type MeasurementMode = z.infer<typeof MeasurementModeSchema>;

/** True only for counts a provider actually returned. */
export function isProviderReported(mode: MeasurementMode): boolean {
  return mode === "provider-usage" || mode === "provider-count-api";
}

/** True when the mode carries a token count at all. */
export function hasTokenCounts(mode: MeasurementMode): boolean {
  return mode !== "byte-only";
}

export const LEDGER_OPERATIONS = [
  "tool-schema",
  "tool-result",
  "resource",
  "skill",
  "workflow",
] as const;

export const LedgerOperationSchema = z.enum(LEDGER_OPERATIONS);
export type LedgerOperation = z.infer<typeof LedgerOperationSchema>;

const NonEmptyString = z.string().min(1);

export const EventIdSchema = NonEmptyString.max(128).brand<"EventId">();
export const SessionIdSchema = NonEmptyString.max(128).brand<"SessionId">();

export type EventId = z.infer<typeof EventIdSchema>;
export type SessionId = z.infer<typeof SessionIdSchema>;

/** A content handle: `lr_sha256_<64 lowercase hex chars>`. */
export const CONTENT_HANDLE_PATTERN = /^lr_sha256_[0-9a-f]{64}$/;
export const ContentHandleSchema = z
  .string()
  .regex(CONTENT_HANDLE_PATTERN, "handle must match lr_sha256_<64 hex>")
  .brand<"ContentHandle">();
export type ContentHandle = z.infer<typeof ContentHandleSchema>;

const ByteCount = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const TokenCount = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

const IsoTimestamp = z
  .string()
  .refine(
    (value) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/.test(value)
      && !Number.isNaN(Date.parse(value)),
    "createdAt must be an ISO-8601 UTC timestamp",
  );

/**
 * One measured optimization. The schema is strict and carries no payload,
 * prompt, path or repository field, so a ledger file cannot accumulate user
 * content even by accident.
 */
export const LedgerEventSchema = z
  .strictObject({
    eventId: EventIdSchema,
    sessionId: SessionIdSchema,
    operation: LedgerOperationSchema,
    baselineBytes: ByteCount,
    optimizedBytes: ByteCount,
    /**
     * Optional, redundant-by-design claim. It exists so a wrong claim fails
     * validation instead of silently reaching a report.
     */
    bytesAvoided: z.number().int().optional(),
    baselineTokens: TokenCount.optional(),
    optimizedTokens: TokenCount.optional(),
    measurementMode: MeasurementModeSchema,
    estimator: NonEmptyString.max(128).optional(),
    /** Whether the task this event belongs to passed its deterministic verifier. */
    passed: z.boolean().optional(),
    /** Whether every mandatory Rigor Gate for the task produced evidence. */
    requiredGatesPassed: z.boolean().optional(),
    createdAt: IsoTimestamp,
  })
  .superRefine((event, ctx) => {
    if (event.bytesAvoided !== undefined) {
      const actual = event.baselineBytes - event.optimizedBytes;
      if (event.bytesAvoided !== actual) {
        ctx.addIssue({
          code: "custom",
          path: ["bytesAvoided"],
          message: `claimed saving ${event.bytesAvoided} does not match ${event.baselineBytes} - ${event.optimizedBytes} = ${actual}`,
        });
      }
    }

    const tokensPresent =
      event.baselineTokens !== undefined || event.optimizedTokens !== undefined;

    if (!hasTokenCounts(event.measurementMode) && tokensPresent) {
      ctx.addIssue({
        code: "custom",
        path: ["measurementMode"],
        message: "byte-only events must not carry token counts",
      });
    }

    if (hasTokenCounts(event.measurementMode) && !tokensPresent) {
      ctx.addIssue({
        code: "custom",
        path: ["measurementMode"],
        message: `${event.measurementMode} events must carry at least one token count`,
      });
    }

    if (event.measurementMode === "tokenizer-estimate" && event.estimator === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["estimator"],
        message: "tokenizer estimates must name the estimator and its version",
      });
    }

    if (isProviderReported(event.measurementMode) && event.estimator !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["estimator"],
        message: "provider-reported usage must not be labelled with a local estimator",
      });
    }
  });

export type LedgerEvent = z.infer<typeof LedgerEventSchema>;

/** Derived saving. Negative when an optimization expanded the payload. */
export function bytesAvoided(event: Pick<LedgerEvent, "baselineBytes" | "optimizedBytes">): number {
  return event.baselineBytes - event.optimizedBytes;
}

/**
 * Derived token saving, or `undefined` when the event has no token measurement.
 * Negative results are returned unchanged; the caller decides how to present an
 * expansion, and must not clamp it to zero.
 */
export function tokensAvoided(event: LedgerEvent): number | undefined {
  if (event.baselineTokens === undefined || event.optimizedTokens === undefined) return undefined;
  return event.baselineTokens - event.optimizedTokens;
}

/**
 * An event's savings may be counted only when the task passed its verifier and
 * every mandatory gate produced evidence. Unknown status is treated as not
 * counted: a missing verdict is never optimistic.
 */
export function countsTowardSavings(event: LedgerEvent): boolean {
  return event.passed === true && event.requiredGatesPassed !== false;
}
