import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { Aggregator, createApp } from "../src/index.js";

function validEvent(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    eventId: randomUUID(),
    anonymousInstallId: randomUUID(),
    day: "2026-08-17",
    host: "claude-code",
    measurementMode: "tokenizer-estimate",
    baselineTokens: 1000,
    optimizedTokens: 200,
    baselineBytes: 40_000,
    optimizedBytes: 8000,
    verifiedTasks: 4,
    passedTasks: 4,
    clientVersion: "0.1.0",
    ...overrides,
  };
}

async function post(app: ReturnType<typeof createApp>["app"], body: unknown, headers = {}) {
  return app.request("/v1/events", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

describe("POST /v1/events", () => {
  it("accepts a well-formed event", async () => {
    const { app } = createApp();
    const response = await post(app, validEvent());
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ accepted: 1, duplicates: 0 });
  });

  it("accepts a batch", async () => {
    const { app } = createApp();
    const response = await post(app, [validEvent(), validEvent()]);
    expect((await response.json()).accepted).toBe(2);
  });

  it("rejects malformed JSON", async () => {
    const { app } = createApp();
    const response = await app.request("/v1/events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not json",
    });
    expect(response.status).toBe(400);
  });
});

describe("rejected content", () => {
  const rejected: [string, Record<string, unknown>][] = [
    ["a prompt", { prompt: "how do I fix this" }],
    ["source code", { code: "function f() {}" }],
    ["a file path", { path: "/Users/me/project/src/auth.ts" }],
    ["a repository name", { repository: "acme/private-service" }],
    ["free-form metadata", { metadata: { anything: "at all" } }],
    ["tags", { tags: ["a", "b"] }],
    ["a tool payload", { payload: "…" }],
  ];

  it.each(rejected)("rejects %s", async (_label, extra) => {
    const { app } = createApp();
    const response = await post(app, validEvent(extra));
    expect(response.status).toBe(400);
  });

  it("rejects a negative value", async () => {
    const { app } = createApp();
    expect((await post(app, validEvent({ baselineBytes: -1 }))).status).toBe(400);
  });

  it("rejects a value over the documented cap", async () => {
    const { app } = createApp();
    expect((await post(app, validEvent({ baselineTokens: 999_999_999_999 }))).status).toBe(400);
  });

  it("rejects more passed tasks than verified tasks", async () => {
    const { app } = createApp();
    expect((await post(app, validEvent({ verifiedTasks: 1, passedTasks: 5 }))).status).toBe(400);
  });

  it("rejects token counts on a byte-only event", async () => {
    const { app } = createApp();
    const response = await post(app, validEvent({ measurementMode: "byte-only" }));
    expect(response.status).toBe(400);
  });

  it("rejects an unknown schema version", async () => {
    const { app } = createApp();
    expect((await post(app, validEvent({ schemaVersion: 2 }))).status).toBe(400);
  });

  it("rejects a non-uuid install id", async () => {
    const { app } = createApp();
    expect((await post(app, validEvent({ anonymousInstallId: "me@example.com" }))).status).toBe(400);
  });

  it("rejects an unknown host", async () => {
    const { app } = createApp();
    expect((await post(app, validEvent({ host: "my-secret-tool" }))).status).toBe(400);
  });

  it("names the offending field without echoing its value", async () => {
    const { app } = createApp();
    const response = await post(app, validEvent({ prompt: "SECRET-VALUE-12345" }));
    const text = await response.text();
    expect(text).not.toContain("SECRET-VALUE-12345");
  });
});

describe("deduplication and rate limiting", () => {
  it("counts a repeated eventId once", async () => {
    const { app } = createApp();
    const event = validEvent();
    await post(app, event);
    const second = await post(app, event);
    expect(await second.json()).toEqual({ accepted: 0, duplicates: 1 });
  });

  it("rate limits a single install", async () => {
    const { app } = createApp({ rateLimit: 2 });
    const install = randomUUID();
    await post(app, validEvent({ anonymousInstallId: install }));
    await post(app, validEvent({ anonymousInstallId: install }));
    const third = await post(app, validEvent({ anonymousInstallId: install }));
    expect(third.status).toBe(429);
  });

  it("rate limits a single source address", async () => {
    const { app } = createApp({ rateLimit: 2 });
    const headers = { "x-forwarded-for": "203.0.113.9" };
    await post(app, validEvent(), headers);
    await post(app, validEvent(), headers);
    expect((await post(app, validEvent(), headers)).status).toBe(429);
  });
});

describe("GET /v1/totals", () => {
  it("labels totals as community-reported", async () => {
    const { app } = createApp();
    await post(app, validEvent());
    const totals = await (await app.request("/v1/totals")).json();
    expect(totals.label).toBe("community-reported");
  });

  it("keeps measurement modes in separate buckets", async () => {
    const { app } = createApp();
    await post(app, validEvent({ measurementMode: "tokenizer-estimate" }));
    await post(
      app,
      validEvent({ measurementMode: "provider-usage", baselineTokens: 10, optimizedTokens: 5 }),
    );
    const totals = await (await app.request("/v1/totals")).json();
    expect(totals.aggregates).toHaveLength(2);
    expect(totals.aggregates.map((a: { measurementMode: string }) => a.measurementMode).sort()).toEqual(
      ["provider-usage", "tokenizer-estimate"],
    );
  });

  it("counts distinct installs rather than events", async () => {
    const { app } = createApp();
    const install = randomUUID();
    await post(app, validEvent({ anonymousInstallId: install }));
    await post(app, validEvent({ anonymousInstallId: install }));
    const totals = await (await app.request("/v1/totals")).json();
    expect(totals.aggregates[0].installs).toBe(1);
    expect(totals.aggregates[0].events).toBe(2);
  });

  it("retains no source address in the aggregate", async () => {
    const { app } = createApp();
    await post(app, validEvent(), { "x-forwarded-for": "203.0.113.9" });
    const text = await (await app.request("/v1/totals")).text();
    expect(text).not.toContain("203.0.113.9");
  });
});

describe("GET /v1/methodology", () => {
  it("publishes what is never collected", async () => {
    const { app } = createApp();
    const body = await (await app.request("/v1/methodology")).json();
    expect(body.neverCollected).toContain("prompts");
    expect(body.neverCollected).toContain("file paths");
    expect(body.retentionDays).toBeGreaterThan(0);
  });
});

describe("retention", () => {
  it("prunes aggregates older than the window", () => {
    const aggregator = new Aggregator(30);
    aggregator.add(
      validEvent({ day: "2026-01-01" }) as never,
    );
    expect(aggregator.prune(Date.parse("2026-08-17T00:00:00Z"))).toBe(1);
    expect(aggregator.totals().aggregates).toEqual([]);
  });

  it("keeps aggregates inside the window", () => {
    const aggregator = new Aggregator(30);
    aggregator.add(validEvent({ day: "2026-08-16" }) as never);
    expect(aggregator.prune(Date.parse("2026-08-17T00:00:00Z"))).toBe(0);
  });
});

describe("privacy regression", () => {
  it("never reflects a random secret back in any response", async () => {
    const { app } = createApp();
    const secrets = Array.from({ length: 20 }, () => randomUUID().replace(/-/g, ""));

    for (const secret of secrets) {
      const responses = [
        await post(app, validEvent({ note: secret })),
        await post(app, validEvent({ clientVersion: secret })),
        await post(app, validEvent({ host: secret })),
      ];
      for (const response of responses) {
        expect(await response.text()).not.toContain(secret);
      }
    }

    const totals = await (await app.request("/v1/totals")).text();
    for (const secret of secrets) expect(totals).not.toContain(secret);
  });

  it("never reflects a filesystem path back", async () => {
    const { app } = createApp();
    const path = "/Users/someone/private/repo/src/secrets.ts";
    const response = await post(app, validEvent({ path }));
    expect(await response.text()).not.toContain(path);
  });
});
