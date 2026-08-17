import type { ContentHandle } from "@leanrigor/core";

export interface RetentionPolicy {
  /** Maximum age in days. `0` disables age-based expiry. */
  readonly ttlDays: number;
  /** Maximum total bytes of evictable content. `Infinity` disables size eviction. */
  readonly maxBytes: number;
  /** Injected clock, in epoch milliseconds, so retention is testable. */
  readonly now?: number;
}

export const DEFAULT_RETENTION: RetentionPolicy = {
  ttlDays: 7,
  maxBytes: 1024 * 1024 * 1024,
};

export interface GcResult {
  readonly removed: readonly ContentHandle[];
  readonly reclaimedBytes: number;
  /** Bytes still held by evictable content after collection. */
  readonly retainedBytes: number;
  /** Bytes held by pinned content, which is never evicted. */
  readonly pinnedRetainedBytes: number;
}

export interface RetainedItem {
  readonly handle: ContentHandle;
  readonly byteLength: number;
  readonly createdAt: string;
  readonly pinned: boolean;
}

/**
 * Decides what to evict.
 *
 * Pinned content — benchmark fixtures above all — is never selected, even when
 * that leaves the store above its size budget: a reproducible benchmark matters
 * more than a disk-usage target. Eviction is oldest-first.
 */
export function planEviction(
  items: readonly RetainedItem[],
  policy: RetentionPolicy,
): { evict: RetainedItem[]; retainedBytes: number; pinnedRetainedBytes: number } {
  const now = policy.now ?? Date.now();
  const pinned = items.filter((item) => item.pinned);
  const evictable = [...items.filter((item) => !item.pinned)].sort(
    (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt),
  );

  const evict: RetainedItem[] = [];
  const keep: RetainedItem[] = [];

  const ttlMs = policy.ttlDays * 24 * 60 * 60 * 1000;
  for (const item of evictable) {
    const expired = policy.ttlDays > 0 && now - Date.parse(item.createdAt) > ttlMs;
    if (expired) evict.push(item);
    else keep.push(item);
  }

  const pinnedBytes = pinned.reduce((sum, item) => sum + item.byteLength, 0);
  let evictableBytes = keep.reduce((sum, item) => sum + item.byteLength, 0);

  // Pinned content counts against the budget but is never a candidate, so the
  // store can legitimately finish above `maxBytes` with nothing left to evict.
  while (pinnedBytes + evictableBytes > policy.maxBytes && keep.length > 0) {
    const oldest = keep.shift()!;
    evict.push(oldest);
    evictableBytes -= oldest.byteLength;
  }

  return { evict, retainedBytes: evictableBytes, pinnedRetainedBytes: pinnedBytes };
}
