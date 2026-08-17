import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LeanRigorError } from "@leanrigor/core";
import { TokenLeafEngine } from "../src/index.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "leanrigor-ledger-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function engine(projectId = "proj-a") {
  return new TokenLeafEngine({ dataDir: dir, projectId });
}

function event(overrides: Record<string, unknown> = {}) {
  return {
    eventId: `evt-${Math.random().toString(16).slice(2)}`,
    sessionId: "session-1",
    operation: "tool-result" as const,
    baselineBytes: 1000,
    optimizedBytes: 200,
    measurementMode: "byte-only" as const,
    passed: true,
    createdAt: "2026-08-17T09:00:00.000Z",
    ...overrides,
  };
}

describe("TokenLeafEngine.record", () => {
  it("validates before persisting and rejects an invalid event", async () => {
    const e = engine();
    await expect(e.record(event({ baselineBytes: -5 }) as never)).rejects.toBeInstanceOf(
      LeanRigorError,
    );
    expect(await e.readAll()).toEqual([]);
  });

  it("rejects an event carrying an unknown field", async () => {
    const e = engine();
    await expect(e.record(event({ prompt: "leak" }) as never)).rejects.toMatchObject({
      code: "LR_INVALID_EVENT",
    });
  });

  it("appends one JSON line per event", async () => {
    const e = engine();
    await e.record(event({ eventId: "a" }) as never);
    await e.record(event({ eventId: "b" }) as never);
    const raw = await readFile(e.ledgerPath, "utf8");
    expect(raw.trimEnd().split("\n")).toHaveLength(2);
    expect(raw.endsWith("\n")).toBe(true);
  });

  it("rejects a duplicate eventId", async () => {
    const e = engine();
    await e.record(event({ eventId: "dup" }) as never);
    await expect(e.record(event({ eventId: "dup" }) as never)).rejects.toMatchObject({
      code: "LR_INVALID_EVENT",
    });
    expect(await e.readAll()).toHaveLength(1);
  });

  it("scopes the ledger by project", async () => {
    const a = engine("proj-a");
    const b = engine("proj-b");
    await a.record(event({ eventId: "only-a" }) as never);
    expect(await a.readAll()).toHaveLength(1);
    expect(await b.readAll()).toHaveLength(0);
    expect(a.ledgerPath).not.toBe(b.ledgerPath);
  });

  it("survives a restart", async () => {
    await engine().record(event({ eventId: "persisted" }) as never);
    const reopened = engine();
    const events = await reopened.readAll();
    expect(events.map((x) => x.eventId)).toEqual(["persisted"]);
  });

  it("loses no event under concurrent appends", async () => {
    const e = engine();
    await Promise.all(
      Array.from({ length: 64 }, (_, i) => e.record(event({ eventId: `evt-${i}` }) as never)),
    );
    const events = await e.readAll();
    expect(events).toHaveLength(64);
    expect(new Set(events.map((x) => x.eventId)).size).toBe(64);
  });

  it("writes no raw payload to disk", async () => {
    const e = engine();
    await e.record(event({ eventId: "clean" }) as never);
    const raw = await readFile(e.ledgerPath, "utf8");
    for (const field of ["payload", "prompt", "content", "path", "repository"]) {
      expect(raw).not.toContain(field);
    }
  });
});

describe("TokenLeafEngine.readAll", () => {
  it("reports a corrupt line with its offset instead of skipping it silently", async () => {
    const e = engine();
    await e.record(event({ eventId: "good-1" }) as never);
    await writeFile(e.ledgerPath, "{not json\n", { flag: "a" });
    await e.record(event({ eventId: "good-2" }) as never);

    await expect(e.readAll()).rejects.toMatchObject({ code: "LR_INVALID_EVENT" });

    try {
      await e.readAll();
    } catch (error) {
      expect((error as LeanRigorError).details.line).toBe(2);
      expect((error as LeanRigorError).details.byteOffset).toBeTypeOf("number");
    }
  });

  it("skips corrupt lines only in explicit recovery mode and reports them", async () => {
    const e = engine();
    await e.record(event({ eventId: "good-1" }) as never);
    await writeFile(e.ledgerPath, "{not json\n", { flag: "a" });
    await e.record(event({ eventId: "good-2" }) as never);

    const recovered = await e.readAllWithRecovery();
    expect(recovered.events.map((x) => x.eventId)).toEqual(["good-1", "good-2"]);
    expect(recovered.corrupt).toHaveLength(1);
    expect(recovered.corrupt[0]?.line).toBe(2);
  });

  it("returns an empty ledger before the first write", async () => {
    expect(await engine().readAll()).toEqual([]);
  });

  it("ignores trailing blank lines", async () => {
    const e = engine();
    await e.record(event({ eventId: "one" }) as never);
    await writeFile(e.ledgerPath, "\n\n", { flag: "a" });
    expect(await e.readAll()).toHaveLength(1);
  });
});
