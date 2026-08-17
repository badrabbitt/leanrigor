import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildPendingPayload,
  readState,
  runTelemetry,
  sendIfEnabled,
} from "../src/commands/telemetry.js";

let dataDir: string;

function capture() {
  const lines: string[] = [];
  return { lines, io: { out: (l: string) => lines.push(l), err: (l: string) => lines.push(l) } };
}

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), "leanrigor-telemetry-"));
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

describe("default state", () => {
  it("is disabled before anything is written", async () => {
    expect((await readState({ dataDir })).enabled).toBe(false);
  });

  it("generates no install id until the user enables telemetry", async () => {
    expect((await readState({ dataDir })).anonymousInstallId).toBe("not-yet-generated");
  });

  it("reports disabled in status", async () => {
    const { lines, io } = capture();
    expect(await runTelemetry("status", io, { dataDir })).toBe(0);
    expect(lines.join("\n")).toContain("Telemetry: disabled");
  });
});

describe("consent", () => {
  it("enables only on an explicit command", async () => {
    const { io } = capture();
    await runTelemetry("enable", io, { dataDir });
    expect((await readState({ dataDir })).enabled).toBe(true);
  });

  it("generates a random install id on enable", async () => {
    const { io } = capture();
    await runTelemetry("enable", io, { dataDir });
    const state = await readState({ dataDir });
    expect(state.anonymousInstallId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it("keeps the same install id across a disable and re-enable", async () => {
    const { io } = capture();
    await runTelemetry("enable", io, { dataDir });
    const first = (await readState({ dataDir })).anonymousInstallId;
    await runTelemetry("disable", io, { dataDir });
    await runTelemetry("enable", io, { dataDir });
    expect((await readState({ dataDir })).anonymousInstallId).toBe(first);
  });

  it("disables on command", async () => {
    const { io } = capture();
    await runTelemetry("enable", io, { dataDir });
    await runTelemetry("disable", io, { dataDir });
    expect((await readState({ dataDir })).enabled).toBe(false);
  });

  it("rejects an unknown action", async () => {
    const { lines, io } = capture();
    expect(await runTelemetry("send-everything", io, { dataDir })).toBe(1);
    expect(lines.join("\n")).toContain("LR_UNKNOWN_COMMAND");
  });
});

describe("no network before consent", () => {
  it("sends nothing while disabled", async () => {
    const transport = vi.fn(async () => undefined);
    const payload = buildPendingPayload(await readState({ dataDir }), { dataDir }, {
      baselineBytes: 1,
      optimizedBytes: 1,
      verifiedTasks: 1,
      passedTasks: 1,
      measurementMode: "byte-only",
    });
    expect(await sendIfEnabled({ dataDir, transport }, payload)).toBe("disabled");
    expect(transport).not.toHaveBeenCalled();
  });

  it("makes no network call for status, inspect or disable", async () => {
    const transport = vi.fn(async () => undefined);
    const { io } = capture();
    for (const action of ["status", "inspect", "disable"]) {
      await runTelemetry(action, io, { dataDir, transport });
    }
    expect(transport).not.toHaveBeenCalled();
  });

  it("makes no network call when enabling", async () => {
    const transport = vi.fn(async () => undefined);
    const { io } = capture();
    await runTelemetry("enable", io, { dataDir, transport });
    expect(transport).not.toHaveBeenCalled();
  });

  it("sends only after consent is recorded", async () => {
    const transport = vi.fn(async () => undefined);
    const { io } = capture();
    await runTelemetry("enable", io, { dataDir });
    const payload = buildPendingPayload(await readState({ dataDir }), { dataDir }, {
      baselineBytes: 1,
      optimizedBytes: 1,
      verifiedTasks: 1,
      passedTasks: 1,
      measurementMode: "byte-only",
    });
    expect(await sendIfEnabled({ dataDir, transport }, payload)).toBe("sent");
    expect(transport).toHaveBeenCalledOnce();
  });
});

describe("inspect", () => {
  it("prints the exact payload shape", async () => {
    const { lines, io } = capture();
    await runTelemetry("inspect", io, { dataDir });
    const json = lines.join("\n").match(/\{[\s\S]*\}/)![0];
    expect(Object.keys(JSON.parse(json) as object).sort()).toEqual([
      "anonymousInstallId",
      "baselineBytes",
      "clientVersion",
      "day",
      "eventId",
      "host",
      "measurementMode",
      "optimizedBytes",
      "passedTasks",
      "schemaVersion",
      "verifiedTasks",
    ]);
  });

  it("says nothing will be sent while disabled", async () => {
    const { lines, io } = capture();
    await runTelemetry("inspect", io, { dataDir });
    expect(lines.join("\n")).toContain("nothing will be sent");
  });
});

describe("payload contents", () => {
  it("carries no prompt, path, repository or free-form field", async () => {
    const payload = buildPendingPayload(await readState({ dataDir }), { dataDir }, {
      baselineBytes: 100,
      optimizedBytes: 10,
      verifiedTasks: 1,
      passedTasks: 1,
      measurementMode: "byte-only",
    });
    const serialized = JSON.stringify(payload);
    for (const field of ["prompt", "path", "repository", "metadata", "code", "payload", "tags"]) {
      expect(serialized).not.toContain(`"${field}"`);
    }
  });

  it("carries no absolute path from this machine", async () => {
    const payload = buildPendingPayload(await readState({ dataDir }), { dataDir }, {
      baselineBytes: 100,
      optimizedBytes: 10,
      verifiedTasks: 1,
      passedTasks: 1,
      measurementMode: "byte-only",
    });
    expect(JSON.stringify(payload)).not.toContain(dataDir);
    expect(JSON.stringify(payload)).not.toContain(process.cwd());
  });

  it("writes consent state that does not contain the endpoint credential", async () => {
    const { io } = capture();
    await runTelemetry("enable", io, { dataDir });
    const raw = await readFile(path.join(dataDir, "telemetry.json"), "utf8");
    expect(raw.toLowerCase()).not.toContain("token");
    expect(raw.toLowerCase()).not.toContain("apikey");
  });
});
