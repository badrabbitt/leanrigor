import { createHash, randomBytes } from "node:crypto";
import { open, mkdir, readFile, readdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { LeanRigorError, type ContentHandle } from "@leanrigor/core";
import { handleFor, hashOf } from "./handle.js";
import {
  DEFAULT_RETENTION,
  planEviction,
  type GcResult,
  type RetainedItem,
  type RetentionPolicy,
} from "./retention.js";

export interface ResultStoreOptions {
  readonly dataDir: string;
  readonly projectId: string;
}

export interface PutMetadata {
  /** Shape label shown to the model, e.g. `github.issue[]`. */
  readonly schema: string;
  /** Optional human-readable summary shown instead of the payload. */
  readonly summary?: string;
  /** Overrides the creation timestamp. Used by tests and benchmark fixtures. */
  readonly createdAt?: string;
  /** Pinned content is exempt from garbage collection. */
  readonly pinned?: boolean;
}

export interface StoredRecord {
  readonly handle: ContentHandle;
  readonly byteLength: number;
  readonly schema: string;
  readonly summary?: string;
  readonly createdAt: string;
  readonly pinned: boolean;
}

export interface ByteRange {
  readonly start: number;
  readonly end: number;
}

const SAFE_PROJECT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * Local, content-addressed store for payloads that must stay out of model
 * context.
 *
 * Content is keyed by its own SHA-256 digest, so a handle is both an identifier
 * and an integrity check. Every read re-verifies the digest: a truncated or
 * tampered object is reported rather than returned. Content is scoped per
 * project and never leaves the machine.
 */
export class ResultStore {
  readonly projectDir: string;
  readonly #objectsDir: string;

  constructor(options: ResultStoreOptions) {
    if (!path.isAbsolute(options.dataDir)) {
      throw new LeanRigorError("LR_INVALID_CONFIG", "dataDir must be an absolute path", {
        details: { dataDir: options.dataDir },
      });
    }
    if (!SAFE_PROJECT_ID.test(options.projectId)) {
      throw new LeanRigorError(
        "LR_INVALID_CONFIG",
        `projectId "${options.projectId}" must be a safe directory name`,
        { details: { projectId: options.projectId } },
      );
    }
    this.projectDir = path.join(options.dataDir, "projects", options.projectId);
    this.#objectsDir = path.join(this.projectDir, "objects");
  }

  #binPath(hash: string): string {
    return path.join(this.#objectsDir, `${hash}.bin`);
  }

  #metaPath(hash: string): string {
    return path.join(this.#objectsDir, `${hash}.json`);
  }

  /**
   * Writes content atomically: a uniquely named temporary file in the same
   * directory is fsynced and then renamed into place, so a crash can leave a
   * temporary file but never a half-written object under a valid handle.
   */
  async #writeAtomic(target: string, data: Uint8Array | string): Promise<void> {
    const temp = `${target}.tmp-${randomBytes(8).toString("hex")}`;
    const file = await open(temp, "wx");
    try {
      await file.writeFile(data);
      await file.sync();
    } finally {
      await file.close();
    }
    try {
      await rename(temp, target);
    } catch (error) {
      await rm(temp, { force: true });
      throw error;
    }
  }

  async put(bytes: Uint8Array, metadata: PutMetadata): Promise<StoredRecord> {
    await mkdir(this.#objectsDir, { recursive: true });

    const handle = handleFor(bytes);
    const hash = hashOf(handle);
    const record: StoredRecord = {
      handle,
      byteLength: bytes.byteLength,
      schema: metadata.schema,
      ...(metadata.summary === undefined ? {} : { summary: metadata.summary }),
      createdAt: metadata.createdAt ?? new Date().toISOString(),
      pinned: metadata.pinned ?? false,
    };

    // Identical content may already be stored; rewriting it would be wasted IO
    // but re-pinning must still take effect.
    let exists = false;
    try {
      await stat(this.#binPath(hash));
      exists = true;
    } catch {
      exists = false;
    }

    if (!exists) await this.#writeAtomic(this.#binPath(hash), bytes);
    await this.#writeAtomic(this.#metaPath(hash), `${JSON.stringify(record)}\n`);
    return record;
  }

  async metadata(handle: string): Promise<StoredRecord> {
    const hash = hashOf(handle);
    try {
      return JSON.parse(await readFile(this.#metaPath(hash), "utf8")) as StoredRecord;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new LeanRigorError("LR_HANDLE_NOT_FOUND", `no stored result for handle ${handle}`, {
          details: { handle },
        });
      }
      throw error;
    }
  }

  async get(handle: string): Promise<Buffer> {
    const hash = hashOf(handle);
    let content: Buffer;
    try {
      content = await readFile(this.#binPath(hash));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new LeanRigorError("LR_HANDLE_NOT_FOUND", `no stored result for handle ${handle}`, {
          details: { handle },
        });
      }
      throw error;
    }

    const actual = createHash("sha256").update(content).digest("hex");
    if (actual !== hash) {
      throw new LeanRigorError(
        "LR_INVALID_HANDLE",
        `stored content for ${handle} does not match its hash; the object is damaged`,
        { details: { handle } },
      );
    }
    return content;
  }

  /** Reads a byte range. The range is clamped to the content, never wrapped. */
  async slice(handle: string, range: ByteRange): Promise<Buffer> {
    if (!Number.isInteger(range.start) || !Number.isInteger(range.end)) {
      throw new LeanRigorError("LR_LIMIT_EXCEEDED", "byte range bounds must be integers");
    }
    if (range.start < 0 || range.end < range.start) {
      throw new LeanRigorError(
        "LR_LIMIT_EXCEEDED",
        `invalid byte range ${range.start}..${range.end}`,
        { details: { start: range.start, end: range.end } },
      );
    }
    const content = await this.get(handle);
    return content.subarray(range.start, Math.min(range.end, content.byteLength));
  }

  async remove(handle: string): Promise<boolean> {
    const hash = hashOf(handle);
    try {
      await stat(this.#metaPath(hash));
    } catch {
      return false;
    }
    await rm(this.#binPath(hash), { force: true });
    await rm(this.#metaPath(hash), { force: true });
    return true;
  }

  /** Lists stored records. Damaged metadata is skipped rather than fatal. */
  async list(): Promise<StoredRecord[]> {
    let names: string[];
    try {
      names = await readdir(this.#objectsDir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }

    const records: StoredRecord[] = [];
    for (const name of names) {
      if (!name.endsWith(".json") || name.includes(".tmp-")) continue;
      try {
        records.push(
          JSON.parse(await readFile(path.join(this.#objectsDir, name), "utf8")) as StoredRecord,
        );
      } catch {
        continue;
      }
    }
    return records;
  }

  async gc(policy: RetentionPolicy = DEFAULT_RETENTION): Promise<GcResult> {
    const items: RetainedItem[] = (await this.list()).map((record) => ({
      handle: record.handle,
      byteLength: record.byteLength,
      createdAt: record.createdAt,
      pinned: record.pinned,
    }));

    const plan = planEviction(items, policy);
    const removed: ContentHandle[] = [];
    let reclaimed = 0;

    for (const item of plan.evict) {
      if (await this.remove(item.handle)) {
        removed.push(item.handle);
        reclaimed += item.byteLength;
      }
    }

    return {
      removed,
      reclaimedBytes: reclaimed,
      retainedBytes: plan.retainedBytes,
      pinnedRetainedBytes: plan.pinnedRetainedBytes,
    };
  }

  /** Removes leftover temporary files from interrupted writes. */
  async sweepTemporaryFiles(): Promise<number> {
    let names: string[];
    try {
      names = await readdir(this.#objectsDir);
    } catch {
      return 0;
    }
    let swept = 0;
    for (const name of names) {
      if (!name.includes(".tmp-")) continue;
      await rm(path.join(this.#objectsDir, name), { force: true });
      swept += 1;
    }
    return swept;
  }
}
