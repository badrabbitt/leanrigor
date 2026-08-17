import { LeanRigorError } from "@leanrigor/core";
import { ProvenanceSchema, type Provenance } from "./manifest.js";

/**
 * Validates a provenance record.
 *
 * The rule the project holds itself to: anything copied or adapted from a third
 * party must name its source, its license and the notice file that retains the
 * required attribution. Independently authored work may record influences
 * freely — being influenced by public engineering writing is normal, and saying
 * so costs nothing.
 */
export function parseProvenance(raw: unknown, artifactPath: string): Provenance {
  const result = ProvenanceSchema.safeParse(raw);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new LeanRigorError(
      "LR_PROVENANCE_MISSING",
      `invalid provenance for ${artifactPath} at ${issue?.path.join(".") ?? "<root>"}: ${issue?.message ?? "unknown issue"}`,
      { details: { artifact: artifactPath } },
    );
  }

  const record = result.data;
  const copiedFiles = record.copied_files ?? [];
  const claimsReuse = copiedFiles.length > 0 || record.implementation !== "independently-authored";

  if (claimsReuse) {
    const missing: string[] = [];
    if (!record.source_url) missing.push("source_url");
    if (!record.license) missing.push("license");
    if (!record.notice) missing.push("notice");
    if (missing.length > 0) {
      throw new LeanRigorError(
        "LR_PROVENANCE_MISSING",
        `${artifactPath} declares reused material but omits ${missing.join(", ")}; `
        + "copied or adapted work must name its source, license and retained notice",
        { details: { artifact: artifactPath, missing: missing.join(",") } },
      );
    }
  }

  if (record.implementation === "independently-authored" && copiedFiles.length > 0) {
    throw new LeanRigorError(
      "LR_PROVENANCE_MISSING",
      `${artifactPath} claims to be independently authored but lists copied files`,
      { details: { artifact: artifactPath } },
    );
  }

  return {
    artifact: record.artifact,
    implementation: record.implementation,
    influences: record.influences ?? [],
    copiedFiles,
    ...(record.source_url === undefined ? {} : { sourceUrl: record.source_url }),
    ...(record.license === undefined ? {} : { license: record.license }),
    ...(record.notice === undefined ? {} : { notice: record.notice }),
    ...(record.reviewed_by === undefined ? {} : { reviewedBy: record.reviewed_by }),
  };
}
