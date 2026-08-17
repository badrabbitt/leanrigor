import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { collectChecks, parseFlags, runCli, runDoctor, runInit, runUninstall } from "../src/index.js";

let root: string;
let home: string;
let project: string;

function capture() {
  const lines: string[] = [];
  return { lines, io: { out: (l: string) => lines.push(l), err: (l: string) => lines.push(l) } };
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "leanrigor-init-"));
  home = path.join(root, "home");
  project = path.join(root, "project");
  await mkdir(home, { recursive: true });
  await mkdir(project, { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const withClaude = async () => mkdir(path.join(home, ".claude"), { recursive: true });

async function tree(dir: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (current: string) => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(full);
      else out.push(path.relative(dir, full));
    }
  };
  await walk(dir);
  return out.sort();
}

describe("parseFlags", () => {
  it("parses bare flags, key=value and key value", () => {
    const parsed = parseFlags(["--yes", "--host=codex", "--project", "/tmp/p", "extra"]);
    expect(parsed.flags).toEqual({ yes: true, host: "codex", project: "/tmp/p" });
    expect(parsed.positionals).toEqual(["extra"]);
  });

  it("parses --no-x as false", () => {
    expect(parseFlags(["--no-telemetry"]).flags).toEqual({ telemetry: false });
  });
});

describe("init", () => {
  it("reports when no host is detected and writes nothing", async () => {
    const { lines, io } = capture();
    const code = await runInit(io, { projectDir: project, homeDir: home, yes: true });
    expect(code).toBe(2);
    expect(lines.join("\n")).toContain("LR_HOST_NOT_DETECTED");
    expect(await tree(project)).toEqual([]);
  });

  it("previews every change before writing anything", async () => {
    await withClaude();
    const { lines, io } = capture();
    const code = await runInit(io, {
      projectDir: project,
      homeDir: home,
      hosts: ["claude-code"],
      dryRun: true,
    });
    expect(code).toBe(0);
    const text = lines.join("\n");
    expect(text).toContain("Planned changes:");
    expect(text).toContain(".mcp.json");
    expect(text).toContain("Dry run: nothing was written.");
    expect(await tree(project)).toEqual([]);
  });

  it("refuses to apply without confirmation", async () => {
    await withClaude();
    const { lines, io } = capture();
    const code = await runInit(io, { projectDir: project, homeDir: home, hosts: ["claude-code"] });
    expect(code).toBe(2);
    expect(lines.join("\n")).toContain("Aborted");
    expect(await tree(project)).toEqual([]);
  });

  it("applies when the user confirms", async () => {
    await withClaude();
    const { io } = capture();
    const code = await runInit(io, {
      projectDir: project,
      homeDir: home,
      hosts: ["claude-code"],
      confirm: async () => true,
    });
    expect(code).toBe(0);
    expect(await tree(project)).toContain(".mcp.json");
  });

  it("does not apply when the user declines", async () => {
    await withClaude();
    const { io } = capture();
    await runInit(io, {
      projectDir: project,
      homeDir: home,
      hosts: ["claude-code"],
      confirm: async () => false,
    });
    expect(await tree(project)).toEqual([]);
  });

  it("applies non-interactively with --yes", async () => {
    await withClaude();
    const { io } = capture();
    expect(
      await runInit(io, { projectDir: project, homeDir: home, hosts: ["claude-code"], yes: true }),
    ).toBe(0);
    const config = JSON.parse(await readFile(path.join(project, ".mcp.json"), "utf8")) as {
      mcpServers: Record<string, unknown>;
    };
    expect(config.mcpServers).toHaveProperty("leanrigor");
  });

  it("restores the original file on uninstall", async () => {
    await withClaude();
    const original = `${JSON.stringify({ mcpServers: { github: {} } }, null, 2)}\n`;
    await writeFile(path.join(project, ".mcp.json"), original);

    const { io } = capture();
    await runInit(io, { projectDir: project, homeDir: home, hosts: ["claude-code"], yes: true });
    await runUninstall(io, { projectDir: project, homeDir: home, hosts: ["claude-code"] });

    expect(await readFile(path.join(project, ".mcp.json"), "utf8")).toBe(original);
  });

  it("says so when there is nothing to uninstall", async () => {
    const { lines, io } = capture();
    expect(await runUninstall(io, { projectDir: project, homeDir: home })).toBe(0);
    expect(lines.join("\n")).toContain("Nothing to uninstall.");
  });
});

describe("doctor", () => {
  it("reports every documented check", async () => {
    const checks = await collectChecks({ projectDir: project, homeDir: home });
    expect(checks.map((check) => check.name)).toEqual([
      "node version",
      "data directory",
      "configuration",
      "mcp gateway",
      "skills",
      "hosts",
      "telemetry",
    ]);
  });

  it("fails on an unsupported Node version rather than warning", async () => {
    const checks = await collectChecks({
      projectDir: project,
      homeDir: home,
      nodeVersion: "v18.20.0",
    });
    expect(checks.find((check) => check.name === "node version")?.status).toBe("fail");
  });

  it("confirms the MCP gateway can be constructed", async () => {
    const checks = await collectChecks({ projectDir: project, homeDir: home });
    expect(checks.find((check) => check.name === "mcp gateway")?.status).toBe("ok");
  });

  it("reports telemetry as disabled by default", async () => {
    const checks = await collectChecks({ projectDir: project, homeDir: home });
    const telemetry = checks.find((check) => check.name === "telemetry");
    expect(telemetry?.detail).toContain("disabled");
  });

  it("fails on a configuration file it cannot parse", async () => {
    await mkdir(path.join(project, ".leanrigor"), { recursive: true });
    await writeFile(path.join(project, ".leanrigor", "config.json"), "{ not json");
    const checks = await collectChecks({ projectDir: project, homeDir: home });
    expect(checks.find((check) => check.name === "configuration")?.status).toBe("fail");
  });

  it("warns rather than fails when no host is present", async () => {
    const checks = await collectChecks({ projectDir: project, homeDir: home });
    expect(checks.find((check) => check.name === "hosts")?.status).toBe("warn");
  });

  it("exits non-zero when a check fails", async () => {
    await mkdir(path.join(project, ".leanrigor"), { recursive: true });
    await writeFile(path.join(project, ".leanrigor", "config.json"), "{ not json");
    const { io } = capture();
    expect(await runDoctor(io, { projectDir: project, homeDir: home })).toBe(1);
  });

  it("exits zero when everything passes", async () => {
    const { io } = capture();
    expect(await runDoctor(io, { projectDir: project, homeDir: home })).toBe(0);
  });
});

describe("dispatch", () => {
  it("routes doctor through the CLI", async () => {
    const { lines, io } = capture();
    const code = await runCli(["doctor", "--project", project, "--home", home], io);
    expect(code).toBe(0);
    expect(lines.join("\n")).toContain("LeanRigor doctor");
  });

  it("routes init --dry-run through the CLI without writing", async () => {
    await withClaude();
    const { lines, io } = capture();
    await runCli(["init", "--project", project, "--home", home, "--dry-run"], io);
    expect(lines.join("\n")).toContain("Dry run");
    expect(await tree(project)).toEqual([]);
  });
});
