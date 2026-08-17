import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_RETENTION, ResultStore } from "../src/index.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "leanrigor-gc-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const store = () => new ResultStore({ dataDir: dir, projectId: "proj" });
const bytes = (text: string) => Buffer.from(text, "utf8");

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-08-17T09:00:00.000Z");
const at = (daysAgo: number) => new Date(NOW - daysAgo * DAY).toISOString();

describe("DEFAULT_RETENTION", () => {
  it("expires after seven days and one gibibyte", () => {
    expect(DEFAULT_RETENTION.ttlDays).toBe(7);
    expect(DEFAULT_RETENTION.maxBytes).toBe(1024 * 1024 * 1024);
  });
});

describe("ResultStore.gc by age", () => {
  it("removes content older than the ttl", async () => {
    const s = store();
    const old = await s.put(bytes("stale"), { schema: "text/plain", createdAt: at(10) });
    const fresh = await s.put(bytes("fresh"), { schema: "text/plain", createdAt: at(1) });

    const result = await s.gc({ ttlDays: 7, maxBytes: Infinity, now: NOW });

    expect(result.removed).toContain(old.handle);
    expect(result.removed).not.toContain(fresh.handle);
    await expect(s.get(fresh.handle)).resolves.toBeInstanceOf(Buffer);
  });

  it("keeps everything when the ttl is zero", async () => {
    const s = store();
    const old = await s.put(bytes("ancient"), { schema: "text/plain", createdAt: at(400) });
    const result = await s.gc({ ttlDays: 0, maxBytes: Infinity, now: NOW });
    expect(result.removed).toEqual([]);
    await expect(s.get(old.handle)).resolves.toBeInstanceOf(Buffer);
  });

  it("never removes pinned content", async () => {
    const s = store();
    const pinned = await s.put(bytes("benchmark fixture"), {
      schema: "text/plain",
      createdAt: at(400),
      pinned: true,
    });
    const result = await s.gc({ ttlDays: 1, maxBytes: Infinity, now: NOW });
    expect(result.removed).toEqual([]);
    expect(result.pinnedRetainedBytes).toBeGreaterThan(0);
    await expect(s.get(pinned.handle)).resolves.toBeInstanceOf(Buffer);
  });
});

describe("ResultStore.gc by size", () => {
  it("evicts the oldest content first until the store fits", async () => {
    const s = store();
    const oldest = await s.put(bytes("a".repeat(100)), { schema: "text/plain", createdAt: at(3) });
    const middle = await s.put(bytes("b".repeat(100)), { schema: "text/plain", createdAt: at(2) });
    const newest = await s.put(bytes("c".repeat(100)), { schema: "text/plain", createdAt: at(1) });

    const result = await s.gc({ ttlDays: 0, maxBytes: 250, now: NOW });

    expect(result.removed).toEqual([oldest.handle]);
    expect(result.retainedBytes).toBe(200);
    await expect(s.get(middle.handle)).resolves.toBeInstanceOf(Buffer);
    await expect(s.get(newest.handle)).resolves.toBeInstanceOf(Buffer);
  });

  it("does not evict pinned content to satisfy a size budget", async () => {
    const s = store();
    const pinned = await s.put(bytes("p".repeat(300)), {
      schema: "text/plain",
      createdAt: at(9),
      pinned: true,
    });
    const evictable = await s.put(bytes("e".repeat(100)), {
      schema: "text/plain",
      createdAt: at(1),
    });

    const result = await s.gc({ ttlDays: 0, maxBytes: 200, now: NOW });

    expect(result.removed).toEqual([evictable.handle]);
    await expect(s.get(pinned.handle)).resolves.toBeInstanceOf(Buffer);
  });

  it("reports how many bytes it reclaimed", async () => {
    const s = store();
    await s.put(bytes("x".repeat(500)), { schema: "text/plain", createdAt: at(30) });
    const result = await s.gc({ ttlDays: 7, maxBytes: Infinity, now: NOW });
    expect(result.reclaimedBytes).toBe(500);
  });

  it("is a no-op on an empty store", async () => {
    const result = await store().gc({ ttlDays: 7, maxBytes: 10, now: NOW });
    expect(result).toMatchObject({ removed: [], reclaimedBytes: 0, retainedBytes: 0 });
  });
});
