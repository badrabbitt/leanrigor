import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ViteUserConfig } from "vitest/config";

const root = path.dirname(fileURLToPath(import.meta.url));

/**
 * Workspace discovery is derived from the filesystem rather than a hand-written
 * list so a new package cannot be silently excluded from the test run.
 */
function workspaceDirs(): string[] {
  return ["packages", "apps"].flatMap((group) => {
    const groupDir = path.join(root, group);
    if (!existsSync(groupDir)) return [];
    return readdirSync(groupDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(groupDir, entry.name))
      .filter((dir) => existsSync(path.join(dir, "package.json")));
  });
}

/**
 * Tests resolve sibling workspaces through their TypeScript sources so the test
 * suite never depends on a stale `dist/` build.
 */
function sourceAliases(dirs: string[]): Record<string, string> {
  const alias: Record<string, string> = {};
  for (const dir of dirs) {
    const manifest = JSON.parse(
      readFileSync(path.join(dir, "package.json"), "utf8"),
    ) as { name?: string };
    const entry = path.join(dir, "src", "index.ts");
    if (manifest.name && existsSync(entry)) alias[manifest.name] = entry;
  }
  return alias;
}

export function defineProjects(): ViteUserConfig[] {
  const dirs = workspaceDirs();
  const alias = sourceAliases(dirs);
  return dirs.map((dir) => ({
    resolve: { alias },
    test: {
      name: path.basename(dir),
      root: dir,
      include: ["test/**/*.test.ts"],
      environment: "node" as const,
    },
  }));
}

export default defineProjects();
