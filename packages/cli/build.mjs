#!/usr/bin/env node
/**
 * Bundles the CLI into a single published artifact.
 *
 * The MVP publishes one user-facing package, so the internal `@leanrigor/*`
 * workspaces are bundled in rather than published separately with unstable
 * APIs. Third-party dependencies stay external: they are declared in
 * package.json and resolved by npm, so their licenses and provenance travel
 * with them instead of being silently vendored into our tarball.
 */
import { build } from "esbuild";
import { cpSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(path.join(here, "package.json"), "utf8"));

const external = Object.keys(manifest.dependencies ?? {}).filter(
  (name) => !name.startsWith("@leanrigor/"),
);

// The three shipped skills travel with the package so `leanrigor skills install`
// works from a clean npm install. They are copied from the repository root at
// build time rather than duplicated in the package, so there is one source of
// truth for their content.
// A full clean keeps stale output from a previous layout out of the tarball.
rmSync(path.join(here, "dist"), { recursive: true, force: true });

const skillsSource = path.resolve(here, "..", "..", "skills");
const skillsTarget = path.join(here, "skills");
rmSync(skillsTarget, { recursive: true, force: true });
cpSync(skillsSource, skillsTarget, { recursive: true });

const result = await build({
  entryPoints: [path.join(here, "src", "bin.ts"), path.join(here, "src", "index.ts")],
  outdir: path.join(here, "dist"),
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  sourcemap: false,
  minify: false,
  external,
  banner: { js: "" },
  metafile: true,
  logLevel: "warning",
});

const bytes = Object.values(result.metafile.outputs).reduce((sum, out) => sum + out.bytes, 0);
process.stderr.write(`bundled ${(bytes / 1024).toFixed(1)} KiB, external: ${external.join(", ")}\n`);
