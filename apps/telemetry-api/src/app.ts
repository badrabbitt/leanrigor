import { Hono } from "hono";
import { Aggregator } from "./aggregate.js";
import { EventBatchSchema } from "./schema.js";

export interface AppOptions {
  readonly aggregator?: Aggregator;
  /** Requests allowed per install id and per source address, per window. */
  readonly rateLimit?: number;
  readonly rateWindowMs?: number;
  readonly now?: () => number;
}

interface Counter {
  count: number;
  resetAt: number;
}

/**
 * The optional collector.
 *
 * It accepts nothing but the documented aggregate schema, retains no raw event,
 * and drops the source address as soon as rate limiting is done with it. It is
 * not required to use LeanRigor and is off by default in the client.
 */
export function createApp(options: AppOptions = {}) {
  const aggregator = options.aggregator ?? new Aggregator();
  const limit = options.rateLimit ?? 60;
  const windowMs = options.rateWindowMs ?? 60_000;
  const now = options.now ?? (() => Date.now());
  const counters = new Map<string, Counter>();

  function overLimit(key: string): boolean {
    const current = now();
    const counter = counters.get(key);
    if (!counter || counter.resetAt <= current) {
      counters.set(key, { count: 1, resetAt: current + windowMs });
      return false;
    }
    counter.count += 1;
    return counter.count > limit;
  }

  const app = new Hono();

  app.post("/v1/events", async (context) => {
    // The source address is used for abuse control and then dropped: it is
    // never stored alongside an event and never written to an aggregate.
    const source =
      context.req.header("x-forwarded-for")?.split(",")[0]?.trim()
      ?? context.req.header("x-real-ip")
      ?? "unknown";

    let body: unknown;
    try {
      body = await context.req.json();
    } catch {
      return context.json({ error: "invalid JSON" }, 400);
    }

    const parsed = EventBatchSchema.safeParse(Array.isArray(body) ? body : [body]);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return context.json(
        {
          error: "invalid event",
          path: issue?.path.join("."),
          message: issue?.message,
        },
        400,
      );
    }

    for (const event of parsed.data) {
      if (overLimit(`install:${event.anonymousInstallId}`) || overLimit(`source:${source}`)) {
        return context.json({ error: "rate limited" }, 429);
      }
    }

    let accepted = 0;
    let duplicates = 0;
    for (const event of parsed.data) {
      if (aggregator.add(event)) accepted += 1;
      else duplicates += 1;
    }

    return context.json({ accepted, duplicates }, 202);
  });

  app.get("/v1/totals", (context) => {
    aggregator.prune(now());
    return context.json(aggregator.totals(new Date(now())));
  });

  app.get("/v1/methodology", (context) =>
    context.json({
      label: "community-reported",
      retentionDays: aggregator.retentionDays,
      retained: "daily aggregates only; raw events are folded in and discarded",
      neverCollected: [
        "prompts",
        "source code",
        "file paths",
        "repository names",
        "tool payloads",
        "free-form metadata",
      ],
      note:
        "Totals are reported by installs that opted in. No provider verified them, "
        + "and LeanRigor does not present them as provider-verified.",
    }),
  );

  return { app, aggregator };
}
