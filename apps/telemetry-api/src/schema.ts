import { z } from "zod";
import { MeasurementModeSchema } from "@leanrigor/core";

/**
 * Documented caps. A single install cannot report a billion tokens in a day, so
 * a value above these is either a bug or an attempt to distort public totals.
 * Rejecting is better than storing a number nobody can defend.
 */
export const CAPS = {
  bytes: 1_000_000_000_000,
  tokens: 100_000_000_000,
  tasks: 1_000_000,
} as const;

const Day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "day must be an ISO calendar date")
  .refine((value) => !Number.isNaN(Date.parse(value)), "day must be a real date");

/**
 * The complete telemetry payload.
 *
 * It is a `strictObject`, so an unknown field is rejected rather than stored.
 * There is deliberately no free-form field anywhere: no metadata bag, no tags,
 * no notes. A schema with an open field is a schema that will eventually carry
 * a prompt or a file path, and this one must be provably unable to.
 */
export const AggregateTelemetryEventSchema = z.strictObject({
  schemaVersion: z.literal(1),
  eventId: z.string().uuid(),
  /** Random per-install identifier. Not derived from anything about the user. */
  anonymousInstallId: z.string().uuid(),
  day: Day,
  host: z.enum(["claude-code", "codex", "gemini", "other"]),
  measurementMode: MeasurementModeSchema,
  baselineTokens: z.number().int().min(0).max(CAPS.tokens).optional(),
  optimizedTokens: z.number().int().min(0).max(CAPS.tokens).optional(),
  baselineBytes: z.number().int().min(0).max(CAPS.bytes),
  optimizedBytes: z.number().int().min(0).max(CAPS.bytes),
  verifiedTasks: z.number().int().min(0).max(CAPS.tasks),
  passedTasks: z.number().int().min(0).max(CAPS.tasks),
  clientVersion: z.string().regex(/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/, "clientVersion must be semver"),
}).superRefine((event, ctx) => {
  if (event.passedTasks > event.verifiedTasks) {
    ctx.addIssue({
      code: "custom",
      path: ["passedTasks"],
      message: "passedTasks cannot exceed verifiedTasks",
    });
  }
  const tokensPresent = event.baselineTokens !== undefined || event.optimizedTokens !== undefined;
  if (event.measurementMode === "byte-only" && tokensPresent) {
    ctx.addIssue({
      code: "custom",
      path: ["measurementMode"],
      message: "byte-only events carry no token counts",
    });
  }
});

export type AggregateTelemetryEvent = z.infer<typeof AggregateTelemetryEventSchema>;

export const EventBatchSchema = z.array(AggregateTelemetryEventSchema).min(1).max(100);
