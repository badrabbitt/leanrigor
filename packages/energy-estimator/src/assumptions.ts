import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Methodology } from "./model.js";

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Loads the versioned coefficient file.
 *
 * Every constant lives in that file with a citation and a retrieval date. Code
 * carries no unexplained numbers: an unexplained constant is how an estimate
 * quietly becomes a claim nobody can check.
 */
export function loadMethodology(version = "v1"): Methodology {
  const candidates = [
    path.join(here, "..", "data", `methodology-${version}.json`),
    path.join(here, "..", "..", "data", `methodology-${version}.json`),
  ];

  for (const candidate of candidates) {
    try {
      return JSON.parse(readFileSync(candidate, "utf8")) as Methodology;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
  }

  throw new Error(`no methodology data file for version "${version}"`);
}

/** Human-readable citation lines for the report footer. */
export function citations(methodology: Methodology): string[] {
  return methodology.sources.map(
    (source) => `${source.title} — ${source.url} (retrieved ${source.retrievedAt})`,
  );
}
