import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BACKUP_SUFFIX, LeanRigorError } from "@leanrigor/core";
import { GeminiAdapter } from "../src/index.js";

let home: string;
let project: string;
let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "leanrigor-gemini-"));
  home = path.join(root, "home");
  project = path.join(root, "project");
  await mkdir(home, { recursive: true });
  await mkdir(project, { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const adapter = () =>
  new GeminiAdapter({ geminiDir: path.join(home, ".gemini"), projectDir: project });

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
  it("reports not detected in an empty home and project", async () => {
    const detection = await adapter().detect();
    expect(detection.detected).toBe(false);
    expect(detection.evidence).toEqual([]);
  });

  it("detects a Gemini CLI home directory", async () => {
    await mkdir(path.join(home, ".gemini"), { recursive: true });
    const detection = await adapter().detect();
    expect(detection.detected).toBe(true);
    expect(detection.evidence[0]).toContain(".gemini");
  });

  it("advertises only MCP servers", async () => {
    const detection = await adapter().detect();
    expect(detection.capabilities).toEqual(["mcp-servers"]);
  });
});

describe("planInstall", () => {
  it("plans a creation when no user settings exist", async () => {
    const plan = await adapter().planInstall();
    expect(plan.changes[0]!.kind).toBe("create");
    expect(plan.backups).toEqual([]);
  });

  it("shows the exact resulting file contents", async () => {
    const plan = await adapter().planInstall();
    const parsed = JSON.parse(plan.changes[0]!.after) as {
      mcpServers: Record<string, { command: string; args: string[] }>;
    };
    expect(parsed.mcpServers.leanrigor).toEqual({
      command: "npx",
      args: ["-y", "leanrigor", "mcp", "serve"],
    });
  });

  it("plans a modification that preserves unrelated settings", async () => {
    await mkdir(path.join(home, ".gemini"), { recursive: true });
    await writeFile(
      path.join(home, ".gemini", "settings.json"),
      JSON.stringify(
        { mcpServers: { github: { command: "gh-mcp" } }, selectedAuthType: "oauth-personal" },
        null,
        2,
      ),
    );
    const plan = await adapter().planInstall();
    expect(plan.changes[0]!.kind).toBe("modify");
    const parsed = JSON.parse(plan.changes[0]!.after) as {
      selectedAuthType: string;
      mcpServers: Record<string, unknown>;
    };
    expect(parsed.selectedAuthType).toBe("oauth-personal");
    expect(Object.keys(parsed.mcpServers).sort()).toEqual(["github", "leanrigor"]);
  });

  it("plans a backup before any modification", async () => {
    await mkdir(path.join(home, ".gemini"), { recursive: true });
    await writeFile(path.join(home, ".gemini", "settings.json"), "{}");
    const plan = await adapter().planInstall();
    expect(plan.backups[0]).toContain(BACKUP_SUFFIX);
  });

  it("warns when it would replace an existing entry", async () => {
    await mkdir(path.join(home, ".gemini"), { recursive: true });
    await writeFile(
      path.join(home, ".gemini", "settings.json"),
      JSON.stringify({ mcpServers: { leanrigor: { command: "old" } } }),
    );
    const plan = await adapter().planInstall();
    expect(plan.warnings[0]).toMatch(/replaced/);
  });

  it("refuses to plan against unparseable settings", async () => {
    await mkdir(path.join(home, ".gemini"), { recursive: true });
    await writeFile(path.join(home, ".gemini", "settings.json"), "{ this is not json");
    await expect(adapter().planInstall()).rejects.toBeInstanceOf(LeanRigorError);
  });

  it("changes nothing on disk", async () => {
    await mkdir(path.join(home, ".gemini"), { recursive: true });
    await writeFile(path.join(home, ".gemini", "settings.json"), '{"selectedAuthType":"oauth"}');
    const before = await snapshot(home);
    await adapter().planInstall();
    expect(await snapshot(home)).toEqual(before);
  });
});

describe("applyInstall", () => {
  it("writes exactly what the plan showed", async () => {
    const a = adapter();
    const plan = await a.planInstall();
    await a.applyInstall(plan);
    expect(await readFile(a.configPath, "utf8")).toBe(plan.changes[0]!.after);
  });

  it("writes the backup before mutating", async () => {
    await mkdir(path.join(home, ".gemini"), { recursive: true });
    await writeFile(path.join(home, ".gemini", "settings.json"), '{"mcpServers":{"github":{}}}');
    const a = adapter();
    const result = await a.applyInstall(await a.planInstall());
    expect(await readFile(result.backedUp[0]!, "utf8")).toBe('{"mcpServers":{"github":{}}}');
  });

  it("records the install in an audit log", async () => {
    const a = adapter();
    await a.applyInstall(await a.planInstall());
    expect(await readFile(a.auditPath, "utf8")).toContain("install");
  });

  it("refuses a plan built for another host", async () => {
    const a = adapter();
    const plan = { ...(await a.planInstall()), host: "codex" };
    await expect(a.applyInstall(plan)).rejects.toBeInstanceOf(LeanRigorError);
  });
});

describe("install and uninstall round trip", () => {
  it("leaves an existing settings file byte-identical", async () => {
    const settingsPath = path.join(home, ".gemini", "settings.json");
    await mkdir(path.dirname(settingsPath), { recursive: true });
    const original = `${JSON.stringify(
      { mcpServers: { github: { command: "gh-mcp", args: ["stdio"] } }, theme: "Default" },
      null,
      2,
    )}\n`;
    await writeFile(settingsPath, original);

    const a = adapter();
    await a.applyInstall(await a.planInstall());
    expect(await readFile(a.configPath, "utf8")).not.toBe(original);

    await a.uninstall();
    expect(await readFile(a.configPath, "utf8")).toBe(original);
  });

  it("removes settings it created, leaving only the audit record", async () => {
    const a = adapter();
    await a.applyInstall(await a.planInstall());
    await a.uninstall();

    await expect(readFile(a.configPath, "utf8")).rejects.toThrow();
    const remaining = await snapshot(project);
    expect(Object.keys(remaining)).toEqual([path.join(".leanrigor", "leanrigor-audit.log")]);
  });

  it("leaves no backup file behind", async () => {
    const settingsPath = path.join(home, ".gemini", "settings.json");
    await mkdir(path.dirname(settingsPath), { recursive: true });
    await writeFile(settingsPath, "{}\n");
    const a = adapter();
    await a.applyInstall(await a.planInstall());
    await a.uninstall();
    const remaining = Object.keys(await snapshot(home));
    expect(remaining.filter((name) => name.includes(BACKUP_SUFFIX))).toEqual([]);
  });

  it("is safe to uninstall when nothing was installed", async () => {
    const result = await adapter().uninstall();
    expect(result.restored).toEqual([]);
    expect(result.removed).toEqual([]);
  });
});
