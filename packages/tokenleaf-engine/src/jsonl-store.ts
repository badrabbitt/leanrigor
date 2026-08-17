import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { LeanRigorError } from "@leanrigor/core";

export interface CorruptLine {
  /** 1-based line number in the ledger file. */
  readonly line: number;
  /** Byte offset of the line start, for locating the damage in a large file. */
  readonly byteOffset: number;
  readonly reason: string;
}

export interface RecoveredLines<T> {
  readonly events: T[];
  readonly corrupt: CorruptLine[];
}

/**
 * Append-only JSON Lines file.
 *
 * Appends are serialized through an in-process promise chain and issued as a
 * single `appendFile` call per record, so concurrent writers cannot interleave
 * a partial line. Reads are strict by default: a damaged line is an error, not
 * a silently dropped measurement.
 */
export class JsonlStore<T> {
  readonly filePath: string;
  #tail: Promise<void> = Promise.resolve();

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async append(record: T): Promise<void> {
    const line = `${JSON.stringify(record)}\n`;
    if (line.includes("\n", 0) && line.indexOf("\n") !== line.length - 1) {
      throw new LeanRigorError("LR_INVALID_EVENT", "serialized record contains a newline");
    }
    const write = this.#tail.then(async () => {
      await mkdir(path.dirname(this.filePath), { recursive: true });
      await appendFile(this.filePath, line, { encoding: "utf8", flag: "a" });
    });
    // Keep the chain alive even if this write rejects, so one failure does not
    // poison every subsequent append.
    this.#tail = write.then(
      () => undefined,
      () => undefined,
    );
    await write;
  }

  async #readLines(): Promise<{ text: string } | undefined> {
    try {
      return { text: await readFile(this.filePath, "utf8") };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }

  /**
   * Parses every line. `parse` must throw on invalid input. The first damaged
   * line aborts the read with its position.
   */
  async readAll(parse: (value: unknown) => T): Promise<T[]> {
    const { events, corrupt } = await this.readAllWithRecovery(parse);
    const first = corrupt[0];
    if (first) {
      throw new LeanRigorError(
        "LR_INVALID_EVENT",
        `ledger line ${first.line} is not a valid event: ${first.reason}`,
        {
          details: {
            line: first.line,
            byteOffset: first.byteOffset,
            corruptLines: corrupt.length,
            file: path.basename(this.filePath),
          },
        },
      );
    }
    return events;
  }

  /** Parses every line, collecting damaged lines instead of throwing. */
  async readAllWithRecovery(parse: (value: unknown) => T): Promise<RecoveredLines<T>> {
    const file = await this.#readLines();
    if (!file) return { events: [], corrupt: [] };

    const events: T[] = [];
    const corrupt: CorruptLine[] = [];
    let byteOffset = 0;
    let lineNumber = 0;

    for (const raw of file.text.split("\n")) {
      const lineBytes = Buffer.byteLength(raw, "utf8") + 1;
      const start = byteOffset;
      byteOffset += lineBytes;
      if (raw.trim() === "") continue;
      lineNumber += 1;

      try {
        events.push(parse(JSON.parse(raw) as unknown));
      } catch (error) {
        corrupt.push({
          line: lineNumber,
          byteOffset: start,
          reason: error instanceof Error ? error.message.split("\n")[0]! : "unparseable",
        });
      }
    }

    return { events, corrupt };
  }
}
