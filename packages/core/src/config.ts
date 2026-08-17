import path from "node:path";
import { z } from "zod";
import { LeanRigorError } from "./errors.js";
import { MeasurementModeSchema } from "./measurement.js";

const AbsolutePath = z
  .string()
  .min(1)
  .refine((value) => path.isAbsolute(value), "path must be absolute");

/**
 * Telemetry endpoints must be https, except on the loopback interface where a
 * self-hosted collector may legitimately be plain http.
 */
const TelemetryEndpoint = z
  .string()
  .url()
  .refine((value) => {
    const url = new URL(value);
    if (url.protocol === "https:") return true;
    if (url.protocol !== "http:") return false;
    return url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1";
  }, "telemetry endpoint must use https, or http on the loopback interface");

export const UpstreamServerSchema = z.strictObject({
  id: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9][a-z0-9_-]*$/, "id must be lowercase alphanumeric with - or _"),
  transport: z.enum(["stdio", "http"]),
  /** Explicitly configured executable. LeanRigor never discovers commands. */
  command: z.string().min(1).optional(),
  args: z.array(z.string()).default([]),
  url: z.string().url().optional(),
  /** Names of environment variables to forward. Values are never stored here. */
  envPassthrough: z.array(z.string().min(1)).default([]),
  enabled: z.boolean().default(true),
}).superRefine((server, ctx) => {
  if (server.transport === "stdio" && !server.command) {
    ctx.addIssue({ code: "custom", path: ["command"], message: "stdio transport requires a command" });
  }
  if (server.transport === "http" && !server.url) {
    ctx.addIssue({ code: "custom", path: ["url"], message: "http transport requires a url" });
  }
});

export type UpstreamServer = z.infer<typeof UpstreamServerSchema>;

export const LeanRigorConfigSchema = z.strictObject({
  schemaVersion: z.literal(1),
  /** Absolute root for the local ledger and result store. */
  dataDir: AbsolutePath,
  /** Stable identifier scoping stored results to one project. */
  projectId: z.string().min(1).max(128),
  telemetry: z.strictObject({
    enabled: z.boolean(),
    endpoint: TelemetryEndpoint.optional(),
  }),
  store: z.strictObject({
    ttlDays: z.number().int().min(0).max(365),
    maxBytes: z.number().int().min(0),
  }),
  measurement: z.strictObject({
    /** Best mode to attempt; LeanRigor downgrades and relabels when unavailable. */
    preferredMode: MeasurementModeSchema,
    estimator: z.string().min(1),
    /** When false, a failed measurement is an error rather than a silent downgrade. */
    allowByteOnlyFallback: z.boolean(),
  }),
  energy: z.strictObject({
    enabled: z.boolean(),
    methodologyVersion: z.string().min(1),
  }),
  gateway: z.strictObject({
    requestTimeoutMs: z.number().int().min(100).max(600_000),
    maxCapturedResultBytes: z.number().int().min(1024),
    maxProjectedResultBytes: z.number().int().min(256),
  }),
  upstreamServers: z.array(UpstreamServerSchema),
});

export type LeanRigorConfig = z.infer<typeof LeanRigorConfigSchema>;

export function defaultConfig(dataDir: string, projectId = "default"): LeanRigorConfig {
  return {
    schemaVersion: 1,
    dataDir,
    projectId,
    telemetry: { enabled: false },
    store: { ttlDays: 7, maxBytes: 1024 * 1024 * 1024 },
    measurement: {
      preferredMode: "tokenizer-estimate",
      estimator: "cl100k-compatible@1",
      allowByteOnlyFallback: true,
    },
    energy: { enabled: false, methodologyVersion: "v1" },
    gateway: {
      requestTimeoutMs: 60_000,
      maxCapturedResultBytes: 64 * 1024 * 1024,
      maxProjectedResultBytes: 16 * 1024,
    },
    upstreamServers: [],
  };
}

/** Parses untrusted configuration input, throwing a typed error with the path. */
export function parseConfig(input: unknown): LeanRigorConfig {
  const result = LeanRigorConfigSchema.safeParse(input);
  if (!result.success) {
    const issue = result.error.issues[0];
    const where = issue?.path.join(".") ?? "<root>";
    throw new LeanRigorError(
      "LR_INVALID_CONFIG",
      `invalid configuration at ${where}: ${issue?.message ?? "unknown issue"}`,
      { details: { path: where, issues: result.error.issues.length } },
    );
  }

  const seen = new Set<string>();
  for (const server of result.data.upstreamServers) {
    if (seen.has(server.id)) {
      throw new LeanRigorError(
        "LR_INVALID_CONFIG",
        `invalid configuration at upstreamServers: duplicate server id "${server.id}"`,
        { details: { path: "upstreamServers", id: server.id } },
      );
    }
    seen.add(server.id);
  }

  return result.data;
}
