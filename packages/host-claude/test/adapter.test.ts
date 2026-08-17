import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BACKUP_SUFFIX, LeanRigorError } from "@leanrigor/core";
import { ClaudeCodeAdapter } from "../src/index.js";

let home: string;
let project: string;

beforeEach(async () => {
  const root = await mkdtemp(path.join(tmpdir(), "leanrigor-claude-"));
  home = path.join(root, "home");
  project = path.join(root, "project");
  await mkdir(home, { recursive: true });
  await mkdir(project, { recursive: true });
});

afterEach(async () => {
  await rm(path.dirname(home), { recursive: true, force: true });
});

const adapter = () => new ClaudeCodeAdapter({ projectDir: project, homeDir: home });

/** Snapshot of every file under a directory, for round-trip comparison. */
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
  it("reports not detected in an empty home", async () => {
    const detection = await adapter().detect();
    expect(detection.detected).toBe(false);
    expect(detection.evidence).toEqual([]);
  });

  it("detects a Claude Code home directory and says what it found", async () => {
    await mkdir(path.join(home, ".claude"), { recursive: true });
    const detection = await adapter().detect();
    expect(detection.detected).toBe(true);
    expect(detection.evidence[0]).toContain(".claude");
  });

  it("advertises only capabilities this host really has", async () => {
    const detection = await adapter().detect();
    expect([...detection.capabilities].sort()).toEqual([
      "mcp-servers",
      "project-skills",
      "user-skills",
    ]);
    expect(detection.capabilities).not.toContain("hooks");
  });
});

describe("planInstall", () => {
  it("plans a creation when no config exists", async () => {
    const plan = await adapter().planInstall();
    expect(plan.changes).toHaveLength(1);
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
    await writeFile(
      path.join(project, ".mcp.json"),
      JSON.stringify({ mcpServers: { github: { command: "gh-mcp" } }, other: { a: 1 } }, null, 2),
    );
    const plan = await adapter().planInstall();
    expect(plan.changes[0]!.kind).toBe("modify");
    const parsed = JSON.parse(plan.changes[0]!.after) as Record<string, never>;
    expect(parsed).toHaveProperty("other");
    expect(Object.keys(parsed.mcpServers).sort()).toEqual(["github", "leanrigor"]);
  });

  it("plans a backup before any modification", async () => {
    await writeFile(path.join(project, ".mcp.json"), "{}");
    const plan = await adapter().planInstall();
    expect(plan.backups[0]).toContain(BACKUP_SUFFIX);
  });

  it("warns when it would replace an existing entry", async () => {
    await writeFile(
      path.join(project, ".mcp.json"),
      JSON.stringify({ mcpServers: { leanrigor: { command: "old" } } }),
    );
    const plan = await adapter().planInstall();
    expect(plan.warnings[0]).toMatch(/replaced/);
  });

  it("refuses to plan against an unparseable config rather than overwriting it", async () => {
    await writeFile(path.join(project, ".mcp.json"), "{ this is not json");
    await expect(adapter().planInstall()).rejects.toBeInstanceOf(LeanRigorError);
  });

  it("changes nothing on disk", async () => {
    const before = await snapshot(project);
    await adapter().planInstall();
    expect(await snapshot(project)).toEqual(before);
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
    await writeFile(path.join(project, ".mcp.json"), '{"mcpServers":{"github":{}}}');
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
  it("leaves an existing config byte-identical", async () => {
    const original = `${JSON.stringify(
      { mcpServers: { github: { command: "gh-mcp", args: ["--stdio"] } }, extra: true },
      null,
      2,
    )}\n`;
    await writeFile(path.join(project, ".mcp.json"), original);

    const a = adapter();
    await a.applyInstall(await a.planInstall());
    expect(await readFile(a.configPath, "utf8")).not.toBe(original);

    await a.uninstall();
    expect(await readFile(a.configPath, "utf8")).toBe(original);
  });

  it("removes a config it created, leaving only the audit record", async () => {
    const a = adapter();
    await a.applyInstall(await a.planInstall());
    await a.uninstall();

    const remaining = await snapshot(project);
    expect(Object.keys(remaining)).toEqual([path.join(".leanrigor", "leanrigor-audit.log")]);
  });

  it("leaves no backup file behind", async () => {
    await writeFile(path.join(project, ".mcp.json"), "{}\n");
    const a = adapter();
    await a.applyInstall(await a.planInstall());
    await a.uninstall();
    const remaining = Object.keys(await snapshot(project));
    expect(remaining.filter((name) => name.includes(BACKUP_SUFFIX))).toEqual([]);
  });

  it("keeps the audit record append-only across a second cycle", async () => {
    const a = adapter();
    await a.applyInstall(await a.planInstall());
    await a.uninstall();
    await a.applyInstall(await a.planInstall());
    await a.uninstall();
    const lines = (await readFile(a.auditPath, "utf8")).trim().split("\n");
    expect(lines).toHaveLength(4);
  });

  it("is safe to uninstall when nothing was installed", async () => {
    const result = await adapter().uninstall();
    expect(result.restored).toEqual([]);
    expect(result.removed).toEqual([]);
  });
});
