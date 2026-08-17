import { createHash } from "node:crypto";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LeanRigorError } from "@leanrigor/core";
import { ResultStore } from "../src/index.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "leanrigor-store-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const store = (projectId = "proj-a") => new ResultStore({ dataDir: dir, projectId });
const bytes = (text: string) => Buffer.from(text, "utf8");

describe("ResultStore.put", () => {
  it("derives the handle from the content hash", async () => {
    const s = store();
    const record = await s.put(bytes("hello"), { schema: "text/plain" });
    const expected = createHash("sha256").update(bytes("hello")).digest("hex");
    expect(record.handle).toBe(`lr_sha256_${expected}`);
  });

  it("returns the same handle for the same bytes", async () => {
    const s = store();
    const a = await s.put(bytes("same"), { schema: "text/plain" });
    const b = await s.put(bytes("same"), { schema: "text/plain" });
    expect(a.handle).toBe(b.handle);
  });

  it("returns different handles for different bytes", async () => {
    const s = store();
    const a = await s.put(bytes("one"), { schema: "text/plain" });
    const b = await s.put(bytes("two"), { schema: "text/plain" });
    expect(a.handle).not.toBe(b.handle);
  });

  it("records the byte length and creation time", async () => {
    const s = store();
    const record = await s.put(bytes("hello"), { schema: "text/plain" });
    expect(record.byteLength).toBe(5);
    expect(Date.parse(record.createdAt)).not.toBeNaN();
  });

  it("stores metadata separately from content", async () => {
    const s = store();
    const record = await s.put(bytes("payload-bytes"), { schema: "github.issue[]" });
    const contents = await readdir(path.join(s.projectDir, "objects"));
    const stem = record.handle.replace("lr_sha256_", "");
    expect(contents).toContain(`${stem}.bin`);
    expect(contents).toContain(`${stem}.json`);
  });

  it("leaves no temporary file behind", async () => {
    const s = store();
    await s.put(bytes("hello"), { schema: "text/plain" });
    const contents = await readdir(path.join(s.projectDir, "objects"));
    expect(contents.filter((f) => f.includes(".tmp"))).toEqual([]);
  });
});

describe("project isolation", () => {
  it("cannot read another project's handle", async () => {
    const a = store("proj-a");
    const b = store("proj-b");
    const record = await a.put(bytes("private"), { schema: "text/plain" });
    await expect(b.get(record.handle)).rejects.toMatchObject({ code: "LR_HANDLE_NOT_FOUND" });
  });

  it("uses a separate directory per project", () => {
    expect(store("proj-a").projectDir).not.toBe(store("proj-b").projectDir);
  });

  it("rejects a project id that is not a safe directory name", () => {
    expect(() => new ResultStore({ dataDir: dir, projectId: "../escape" })).toThrow(LeanRigorError);
  });
});

describe("ResultStore.get", () => {
  it("returns the exact original bytes", async () => {
    const s = store();
    const payload = bytes(JSON.stringify({ a: 1, b: "é中" }));
    const record = await s.put(payload, { schema: "application/json" });
    expect(Buffer.compare(await s.get(record.handle), payload)).toBe(0);
  });

  it("rejects a handle that is not the documented shape", async () => {
    const s = store();
    for (const bad of ["", "sha256_abc", "lr_sha256_zz", "lr_sha256_" + "A".repeat(64)]) {
      await expect(s.get(bad)).rejects.toMatchObject({ code: "LR_INVALID_HANDLE" });
    }
  });

  it("rejects a traversal attempt inside a handle", async () => {
    const s = store();
    for (const bad of [
      "lr_sha256_../../../../etc/passwd",
      "lr_sha256_" + "a".repeat(63) + "/",
      "../../etc/passwd",
    ]) {
      await expect(s.get(bad)).rejects.toMatchObject({ code: "LR_INVALID_HANDLE" });
    }
  });

  it("reports a well-formed but unknown handle as not found", async () => {
    const s = store();
    await expect(s.get(`lr_sha256_${"a".repeat(64)}`)).rejects.toMatchObject({
      code: "LR_HANDLE_NOT_FOUND",
    });
  });

  it("does not return the content of an interrupted write", async () => {
    const s = store();
    const stem = "b".repeat(64);
    await s.put(bytes("unrelated"), { schema: "text/plain" });
    await writeFile(path.join(s.projectDir, "objects", `${stem}.bin.tmp-partial`), "half");
    await expect(s.get(`lr_sha256_${stem}`)).rejects.toMatchObject({
      code: "LR_HANDLE_NOT_FOUND",
    });
  });

  it("refuses content whose hash no longer matches its handle", async () => {
    const s = store();
    const record = await s.put(bytes("original"), { schema: "text/plain" });
    const stem = record.handle.replace("lr_sha256_", "");
    await writeFile(path.join(s.projectDir, "objects", `${stem}.bin`), "tampered");
    await expect(s.get(record.handle)).rejects.toMatchObject({ code: "LR_INVALID_HANDLE" });
  });
});

describe("ResultStore.slice", () => {
  it("returns a byte range", async () => {
    const s = store();
    const record = await s.put(bytes("0123456789"), { schema: "text/plain" });
    expect((await s.slice(record.handle, { start: 2, end: 5 })).toString("utf8")).toBe("234");
  });

  it("clamps a range that runs past the end", async () => {
    const s = store();
    const record = await s.put(bytes("0123456789"), { schema: "text/plain" });
    expect((await s.slice(record.handle, { start: 8, end: 999 })).toString("utf8")).toBe("89");
  });

  it("rejects a negative or inverted range", async () => {
    const s = store();
    const record = await s.put(bytes("0123456789"), { schema: "text/plain" });
    await expect(s.slice(record.handle, { start: -1, end: 5 })).rejects.toBeInstanceOf(
      LeanRigorError,
    );
    await expect(s.slice(record.handle, { start: 5, end: 2 })).rejects.toBeInstanceOf(
      LeanRigorError,
    );
  });
});

describe("ResultStore.remove", () => {
  it("removes content and metadata", async () => {
    const s = store();
    const record = await s.put(bytes("temporary"), { schema: "text/plain" });
    expect(await s.remove(record.handle)).toBe(true);
    await expect(s.get(record.handle)).rejects.toMatchObject({ code: "LR_HANDLE_NOT_FOUND" });
  });

  it("reports removal of an unknown handle as false", async () => {
    const s = store();
    expect(await s.remove(`lr_sha256_${"c".repeat(64)}`)).toBe(false);
  });
});
