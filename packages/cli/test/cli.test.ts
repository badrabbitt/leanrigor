import { describe, expect, it } from "vitest";
import { runCli } from "../src/cli.js";

function capture() {
  const lines: string[] = [];
  return {
    lines,
    io: {
      out: (line: string) => lines.push(line),
      err: (line: string) => lines.push(line),
    },
  };
}

describe("leanrigor CLI", () => {
  it("returns zero for --version", async () => {
    await expect(runCli(["--version"])).resolves.toBe(0);
  });

  it("prints a semver version string", async () => {
    const { lines, io } = capture();
    await runCli(["--version"], io);
    expect(lines.join("\n")).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("returns zero for help and lists every top-level command", async () => {
    const { lines, io } = capture();
    await expect(runCli(["help"], io)).resolves.toBe(0);
    const text = lines.join("\n");
    for (const command of [
      "init",
      "doctor",
      "mcp",
      "benchmark",
      "report",
      "skills",
      "telemetry",
    ]) {
      expect(text).toContain(command);
    }
  });

  it("prints help when invoked with no arguments", async () => {
    const { lines, io } = capture();
    await expect(runCli([], io)).resolves.toBe(0);
    expect(lines.join("\n")).toContain("Less context. Full engineering rigor.");
  });

  it("returns exit code 2 and a stable error code for an unknown command", async () => {
    const { lines, io } = capture();
    await expect(runCli(["not-a-command"], io)).resolves.toBe(2);
    expect(lines.join("\n")).toContain("LR_UNKNOWN_COMMAND");
  });

  it("returns exit code 2 and a stable error code for a known but unimplemented command", async () => {
    const { COMMANDS } = await import("../src/cli.js");
    const pending = COMMANDS.find((spec) => !spec.implemented);
    if (!pending) return;
    const { lines, io } = capture();
    await expect(runCli([pending.name], io)).resolves.toBe(2);
    expect(lines.join("\n")).toContain("LR_NOT_IMPLEMENTED");
  });

  it("never exits zero merely because a subcommand is recognized", async () => {
    const { COMMANDS } = await import("../src/cli.js");
    for (const command of COMMANDS.filter((spec) => !spec.implemented)) {
      const { lines, io } = capture();
      const code = await runCli([command.name], io);
      expect(code, command.name).toBe(2);
      expect(lines.join("\n")).toContain("LR_NOT_IMPLEMENTED");
    }
  });

  it("keeps at least one command still unimplemented, and says so honestly", async () => {
    const { COMMANDS } = await import("../src/cli.js");
    const pending = COMMANDS.filter((spec) => !spec.implemented);
    if (pending.length === 0) return;
    const { lines, io } = capture();
    await runCli(["help"], io);
    expect(lines.join("\n")).toContain("not implemented yet");
  });
});
