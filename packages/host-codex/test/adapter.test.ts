import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parse as parseToml } from "smol-toml";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BACKUP_SUFFIX, LeanRigorError } from "@leanrigor/core";
import { CodexAdapter } from "../src/index.js";

let codexDir: string;
let project: string;
let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "leanrigor-codex-"));
  codexDir = path.join(root, "home", ".codex");
  project = path.join(root, "project");
  await mkdir(project, { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const adapter = () => new CodexAdapter({ codexDir, projectDir: project });

async function snapshot(dir: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const walk = async (current: string) => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(full);
      else out[path.relative(dir, full)] = await readFile(full, "utf8");
    }
  };
  await walk(dir);
  return out;
}

describe("detect", () => {
  it("reports not detected when there is no Codex home", async () => {
    expect((await adapter().detect()).detected).toBe(false);
  });

  it("detects an existing Codex home", async () => {
    await mkdir(codexDir, { recursive: true });
    expect((await adapter().detect()).detected).toBe(true);
  });

  it("does not claim a project-skills capability Codex lacks", async () => {
    const detection = await adapter().detect();
    expect(detection.capabilities).toEqual(["mcp-servers"]);
  });
});

describe("planInstall", () => {
  it("plans a creation when no config exists", async () => {
    const plan = await adapter().planInstall();
    expect(plan.changes[0]!.kind).toBe("create");
    const parsed = parseToml(plan.changes[0]!.after) as {
      mcp_servers: Record<string, { command: string; args: string[] }>;
    };
    expect(parsed.mcp_servers.leanrigor!.command).toBe("npx");
  });

  it("preserves unrelated settings", async () => {
    await mkdir(codexDir, { recursive: true });
    await writeFile(
      path.join(codexDir, "config.toml"),
      'model = "gpt-5"\n\n[mcp_servers.github]\ncommand = "gh-mcp"\n',
    );
    const plan = await adapter().planInstall();
    const parsed = parseToml(plan.changes[0]!.after) as {
      model: string;
      mcp_servers: Record<string, unknown>;
    };
    expect(parsed.model).toBe("gpt-5");
    expect(Object.keys(parsed.mcp_servers).sort()).toEqual(["github", "leanrigor"]);
  });

  it("warns that rewriting the file drops TOML comments", async () => {
    await mkdir(codexDir, { recursive: true });
    await writeFile(path.join(codexDir, "config.toml"), '# my notes\nmodel = "gpt-5"\n');
    const plan = await adapter().planInstall();
    expect(plan.warnings.join(" ")).toMatch(/comments/);
  });

  it("refuses to plan against unparseable TOML", async () => {
    await mkdir(codexDir, { recursive: true });
    await writeFile(path.join(codexDir, "config.toml"), "this is [not toml");
    await expect(adapter().planInstall()).rejects.toBeInstanceOf(LeanRigorError);
  });

  it("changes nothing on disk", async () => {
    await mkdir(codexDir, { recursive: true });
    await writeFile(path.join(codexDir, "config.toml"), 'model = "gpt-5"\n');
    const before = await snapshot(codexDir);
    await adapter().planInstall();
    expect(await snapshot(codexDir)).toEqual(before);
  });
});

describe("install and uninstall round trip", () => {
  it("restores an existing config byte-identically", async () => {
    await mkdir(codexDir, { recursive: true });
    const original = '# keep me\nmodel = "gpt-5"\n\n[mcp_servers.github]\ncommand = "gh-mcp"\n';
    await writeFile(path.join(codexDir, "config.toml"), original);

    const a = adapter();
    await a.applyInstall(await a.planInstall());
    expect(await readFile(a.configPath, "utf8")).not.toBe(original);

    await a.uninstall();
    expect(await readFile(a.configPath, "utf8")).toBe(original);
  });

  it("removes a config it created", async () => {
    const a = adapter();
    await a.applyInstall(await a.planInstall());
    await a.uninstall();
    await expect(readFile(a.configPath, "utf8")).rejects.toThrow();
  });

  it("leaves only the audit record in the project", async () => {
    const a = adapter();
    await a.applyInstall(await a.planInstall());
    await a.uninstall();
    expect(Object.keys(await snapshot(project))).toEqual([
      path.join(".leanrigor", "leanrigor-audit.log"),
    ]);
  });

  it("leaves no backup behind", async () => {
    await mkdir(codexDir, { recursive: true });
    await writeFile(path.join(codexDir, "config.toml"), 'model = "gpt-5"\n');
    const a = adapter();
    await a.applyInstall(await a.planInstall());
    await a.uninstall();
    expect(
      Object.keys(await snapshot(codexDir)).filter((name) => name.includes(BACKUP_SUFFIX)),
    ).toEqual([]);
  });

  it("is safe to uninstall when nothing was installed", async () => {
    const result = await adapter().uninstall();
    expect(result.restored).toEqual([]);
    expect(result.removed).toEqual([]);
  });
});
