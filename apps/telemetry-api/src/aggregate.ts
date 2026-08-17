import type { MeasurementMode } from "@leanrigor/core";
import type { AggregateTelemetryEvent } from "./schema.js";

export interface DailyAggregate {
  readonly day: string;
  readonly host: string;
  readonly measurementMode: MeasurementMode;
  installs: number;
  events: number;
  baselineBytes: number;
  optimizedBytes: number;
  baselineTokens: number;
  optimizedTokens: number;
  verifiedTasks: number;
  passedTasks: number;
}

export interface PublicTotals {
  /**
   * Always "community-reported". These numbers come from installs that opted
   * in; no provider verified them and LeanRigor does not present them as if one
   * had.
   */
  readonly label: "community-reported";
  readonly aggregates: readonly DailyAggregate[];
  readonly generatedAt: string;
}

const DEDUP_LIMIT = 100_000;

/**
 * In-memory aggregation.
 *
 * Raw events are never retained: each one is folded into a daily bucket keyed
 * by day, host and measurement mode, and then discarded. Measurement modes are
 * separate buckets, so a public total can never silently add a local estimate
 * to provider-reported usage.
 */
export class Aggregator {
  readonly #buckets = new Map<string, DailyAggregate>();
  readonly #seenEvents = new Set<string>();
  readonly #installsPerBucket = new Map<string, Set<string>>();
  readonly #retentionDays: number;

  constructor(retentionDays = 30) {
    this.#retentionDays = retentionDays;
  }

  get retentionDays(): number {
    return this.#retentionDays;
  }

  /** Returns false when the event is a duplicate and was not counted. */
  add(event: AggregateTelemetryEvent): boolean {
    if (this.#seenEvents.has(event.eventId)) return false;

    // The dedup set is bounded: an unbounded one is a memory leak that an
    // attacker can drive.
    if (this.#seenEvents.size >= DEDUP_LIMIT) this.#seenEvents.clear();
    this.#seenEvents.add(event.eventId);

    const key = `${event.day}|${event.host}|${event.measurementMode}`;
    const bucket = this.#buckets.get(key) ?? {
      day: event.day,
      host: event.host,
      measurementMode: event.measurementMode,
      installs: 0,
      events: 0,
      baselineBytes: 0,
      optimizedBytes: 0,
      baselineTokens: 0,
      optimizedTokens: 0,
      verifiedTasks: 0,
      passedTasks: 0,
    };

    const installs = this.#installsPerBucket.get(key) ?? new Set<string>();
    installs.add(event.anonymousInstallId);
    this.#installsPerBucket.set(key, installs);

    bucket.installs = installs.size;
    bucket.events += 1;
    bucket.baselineBytes += event.baselineBytes;
    bucket.optimizedBytes += event.optimizedBytes;
    bucket.baselineTokens += event.baselineTokens ?? 0;
    bucket.optimizedTokens += event.optimizedTokens ?? 0;
    bucket.verifiedTasks += event.verifiedTasks;
    bucket.passedTasks += event.passedTasks;

    this.#buckets.set(key, bucket);
    return true;
  }

  /** Drops buckets older than the retention window. */
  prune(now = Date.now()): number {
    const cutoff = now - this.#retentionDays * 24 * 60 * 60 * 1000;
    let dropped = 0;
    for (const [key, bucket] of this.#buckets) {
      if (Date.parse(bucket.day) < cutoff) {
        this.#buckets.delete(key);
        this.#installsPerBucket.delete(key);
        dropped += 1;
      }
    }
    return dropped;
  }

  totals(now = new Date()): PublicTotals {
    return {
      label: "community-reported",
      aggregates: [...this.#buckets.values()].sort(
        (a, b) => a.day.localeCompare(b.day) || a.host.localeCompare(b.host),
      ),
      generatedAt: now.toISOString(),
    };
  }
}
