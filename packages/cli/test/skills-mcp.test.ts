import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig, runMcpServe, runSkills } from "../src/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const bundledRoot = path.resolve(here, "..", "..", "..", "skills");

let project: string;
let home: string;

function capture() {
  const lines: string[] = [];
  return { lines, io: { out: (l: string) => lines.push(l), err: (l: string) => lines.push(l) } };
}

beforeEach(async () => {
  const root = await mkdtemp(path.join(tmpdir(), "leanrigor-skills-"));
  project = path.join(root, "project");
  home = path.join(root, "home");
  await mkdir(project, { recursive: true });
  await mkdir(home, { recursive: true });
});

afterEach(async () => {
  await rm(path.dirname(project), { recursive: true, force: true });
});

const options = () => ({ projectDir: project, homeDir: home, bundledRoot });

describe("skills list", () => {
  it("says nothing is installed, and how to install", async () => {
    const { lines, io } = capture();
    expect(await runSkills(["list"], io, options())).toBe(0);
    expect(lines.join("\n")).toContain("No skills installed.");
  });

  it("defaults to list", async () => {
    const { lines, io } = capture();
    await runSkills([], io, options());
    expect(lines.join("\n")).toContain("No skills installed.");
  });
});

describe("skills install", () => {
  it("installs a bundled skill and then lists it", async () => {
    const install = capture();
    expect(await runSkills(["install", "verification"], install.io, options())).toBe(0);

    const list = capture();
    expect(await runSkills(["list"], list.io, options())).toBe(0);
    const text = list.lines.join("\n");
    expect(text).toContain("verification");
    expect(text).toContain("ok");
  });

  it("shows the declared risk levels and budget", async () => {
    await runSkills(["install", "senior-system-design"], capture().io, options());
    const { lines, io } = capture();
    await runSkills(["list"], io, options());
    expect(lines.join("\n")).toContain("token budget");
  });

  it("reports an unknown skill by name", async () => {
    const { lines, io } = capture();
    expect(await runSkills(["install", "not-a-skill"], io, options())).toBe(2);
    expect(lines.join("\n")).toContain("LR_SKILL_INVALID");
  });

  it("needs a name", async () => {
    const { io } = capture();
    expect(await runSkills(["install"], io, options())).toBe(2);
  });
});

describe("skills validate", () => {
  it("validates a bundled skill directory", async () => {
    const { lines, io } = capture();
    expect(await runSkills(["validate", path.join(bundledRoot, "verification")], io)).toBe(0);
    expect(lines.join("\n")).toContain("Apache-2.0");
  });

  it("reports why an invalid skill failed", async () => {
    const broken = path.join(project, "broken");
    await mkdir(broken, { recursive: true });
    await writeFile(
      path.join(broken, "SKILL.md"),
      "---\nname: broken\ndescription: A skill with no license at all in its frontmatter.\n---\n",
    );
    const { lines, io } = capture();
    expect(await runSkills(["validate", broken], io)).toBe(1);
    expect(lines.join("\n")).toMatch(/license/i);
  });
});

describe("skills unknown action", () => {
  it("lists the valid actions", async () => {
    const { lines, io } = capture();
    expect(await runSkills(["frobnicate"], io, options())).toBe(2);
    expect(lines.join("\n")).toContain("list, install, validate");
  });
});

describe("mcp serve", () => {
  it("falls back to defaults when no config file exists", async () => {
    const config = await loadConfig(project);
    expect(config.upstreamServers).toEqual([]);
    expect(config.telemetry.enabled).toBe(false);
  });

  it("reads a valid config file", async () => {
    await mkdir(path.join(project, ".leanrigor"), { recursive: true });
    const config = { ...(await loadConfig(project)), projectId: "custom" };
    await writeFile(
      path.join(project, ".leanrigor", "config.json"),
      JSON.stringify(config),
      "utf8",
    );
    expect((await loadConfig(project)).projectId).toBe("custom");
  });

  it("starts with no upstreams and reports the empty catalog on stderr", async () => {
    const { lines, io } = capture();
    expect(await runMcpServe(io, { projectDir: project, detach: true })).toBe(0);
    expect(lines.join("\n")).toContain("0 upstream tool(s) indexed");
  });

  it("serves over http on a chosen port", async () => {
    const { lines, io } = capture();
    expect(
      await runMcpServe(io, { projectDir: project, transport: "http", port: 0, detach: true }),
    ).toBe(0);
    expect(lines.join("\n")).toMatch(/listening on http:\/\/127\.0\.0\.1:\d+\/mcp/);
  });
});
