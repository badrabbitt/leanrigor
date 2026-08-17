import type { LedgerEvent } from "@leanrigor/core";
import { Ledger, type LedgerOptions } from "./ledger.js";
import { buildSessionReport, type SessionReport } from "./report.js";
import type { CorruptLine } from "./jsonl-store.js";

/**
 * TokenLeaf Engine: the measurement subsystem inside LeanRigor.
 *
 * It records what LeanRigor actually transformed and reports savings that are
 * conditioned on verified outcomes. It holds no payloads and makes no network
 * calls.
 */
export class TokenLeafEngine {
  readonly #ledger: Ledger;

  constructor(options: LedgerOptions) {
    this.#ledger = new Ledger(options);
  }

  get ledgerPath(): string {
    return this.#ledger.ledgerPath;
  }

  async record(event: unknown): Promise<LedgerEvent> {
    return this.#ledger.record(event);
  }

  async readAll(): Promise<LedgerEvent[]> {
    return this.#ledger.readAll();
  }

  async readAllWithRecovery(): Promise<{ events: LedgerEvent[]; corrupt: CorruptLine[] }> {
    return this.#ledger.readAllWithRecovery();
  }

  async sessionReport(sessionId: string): Promise<SessionReport> {
    return buildSessionReport(sessionId, await this.readAll());
  }
}
