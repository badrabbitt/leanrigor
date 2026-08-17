import path from "node:path";
import { LeanRigorError, LedgerEventSchema, type LedgerEvent } from "@leanrigor/core";
import { JsonlStore, type CorruptLine } from "./jsonl-store.js";

export interface LedgerOptions {
  /** Absolute root directory for LeanRigor local data. */
  readonly dataDir: string;
  /** Scopes the ledger so two projects never share measurements. */
  readonly projectId: string;
}

function parseEvent(value: unknown): LedgerEvent {
  const result = LedgerEventSchema.safeParse(value);
  if (!result.success) {
    const issue = result.error.issues[0];
    const where = issue?.path.join(".") ?? "<root>";
    throw new LeanRigorError(
      "LR_INVALID_EVENT",
      `invalid ledger event at ${where}: ${issue?.message ?? "unknown issue"}`,
      { details: { path: where, issues: result.error.issues.length } },
    );
  }
  return result.data;
}

/**
 * Append-only local ledger of measured optimizations.
 *
 * Validation happens before persistence, so an invalid or payload-carrying
 * event can never reach disk.
 */
export class Ledger {
  readonly ledgerPath: string;
  readonly projectId: string;
  readonly #store: JsonlStore<LedgerEvent>;
  #seen: Promise<Set<string>> | undefined;

  constructor(options: LedgerOptions) {
    if (!path.isAbsolute(options.dataDir)) {
      throw new LeanRigorError("LR_INVALID_CONFIG", "dataDir must be an absolute path", {
        details: { dataDir: options.dataDir },
      });
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(options.projectId)) {
      throw new LeanRigorError(
        "LR_INVALID_CONFIG",
        `projectId "${options.projectId}" must be a safe directory name`,
        { details: { projectId: options.projectId } },
      );
    }
    this.projectId = options.projectId;
    this.ledgerPath = path.join(options.dataDir, "projects", options.projectId, "ledger.jsonl");
    this.#store = new JsonlStore<LedgerEvent>(this.ledgerPath);
  }

  async #seenIds(): Promise<Set<string>> {
    this.#seen ??= this.readAll().then((events) => new Set(events.map((e) => e.eventId)));
    return this.#seen;
  }

  /** Validates and appends one event. Rejects duplicates and invalid input. */
  async record(event: unknown): Promise<LedgerEvent> {
    const parsed = parseEvent(event);
    const seen = await this.#seenIds();
    if (seen.has(parsed.eventId)) {
      throw new LeanRigorError(
        "LR_INVALID_EVENT",
        `duplicate eventId "${parsed.eventId}" is already recorded`,
        { details: { eventId: parsed.eventId } },
      );
    }
    seen.add(parsed.eventId);
    try {
      await this.#store.append(parsed);
    } catch (error) {
      seen.delete(parsed.eventId);
      throw error;
    }
    return parsed;
  }

  /** Reads every event. Throws on the first damaged line, reporting its offset. */
  async readAll(): Promise<LedgerEvent[]> {
    return this.#store.readAll(parseEvent);
  }

  /** Explicit recovery mode: damaged lines are reported and skipped. */
  async readAllWithRecovery(): Promise<{ events: LedgerEvent[]; corrupt: CorruptLine[] }> {
    return this.#store.readAllWithRecovery(parseEvent);
  }
}
