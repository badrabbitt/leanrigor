import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ResultStore } from "@leanrigor/result-store";
import { TokenLeafEngine } from "@leanrigor/tokenleaf";
import { Catalog, Gateway } from "../src/index.js";
import { FakeUpstream, bigJsonPayload } from "./fake-upstream.js";

let dir: string;
let store: ResultStore;
let engine: TokenLeafEngine;
let upstream: FakeUpstream;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "leanrigor-gateway-"));
  store = new ResultStore({ dataDir: dir, projectId: "proj" });
  engine = new TokenLeafEngine({ dataDir: dir, projectId: "proj" });
  upstream = new FakeUpstream({ id: "github" });
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function gateway(upstreams = [upstream], overrides = {}) {
  return new Gateway({
    upstreams,
    store,
    engine,
    sessionId: "session-1",
    maxProjectedResultBytes: 4096,
    maxCapturedResultBytes: 8 * 1024 * 1024,
    requestTimeoutMs: 5000,
    ...overrides,
  });
}

describe("catalog indexing", () => {
  it("follows pagination until the whole catalog is indexed", async () => {
    const g = gateway();
    await g.refreshCatalog();
    expect(g.catalog.size).toBe(50);
  });

  it("namespaces tools by upstream id", async () => {
    const g = gateway();
    await g.refreshCatalog();
    expect(g.catalog.has("github.list_issues")).toBe(true);
  });

  it("treats a name collision as an error rather than last-write-wins", () => {
    expect(() =>
      gateway([new FakeUpstream({ id: "dup" }), new FakeUpstream({ id: "dup" })]),
    ).toThrow(expect.objectContaining({ code: "LR_NAME_COLLISION" }));
  });

  it("rejects a duplicate tool name inside one catalog", () => {
    const catalog = new Catalog();
    catalog.add("github", [{ name: "same", inputSchema: {} }]);
    expect(() => catalog.add("github", [{ name: "same", inputSchema: {} }])).toThrow(
      expect.objectContaining({ code: "LR_NAME_COLLISION" }),
    );
  });

  it("keeps tools from distinct upstreams separate", async () => {
    const g = gateway([new FakeUpstream({ id: "a" }), new FakeUpstream({ id: "b" })]);
    await g.refreshCatalog();
    expect(g.catalog.size).toBe(100);
  });

  it("reindexes when an upstream announces a changed tool list", async () => {
    const g = gateway();
    await g.refreshCatalog();
    upstream.emitToolListChanged([
      { name: "brand_new", description: "added later", inputSchema: { type: "object" } },
    ]);
    await g.settle();
    expect(g.catalog.has("github.brand_new")).toBe(true);
  });
});

describe("search_tools", () => {
  it("returns compact summaries without input schemas", async () => {
    const g = gateway();
    await g.refreshCatalog();
    const result = await g.searchTools({ query: "issues", limit: 5 });
    expect(result.tools.length).toBeGreaterThan(0);
    for (const tool of result.tools) {
      expect(tool).not.toHaveProperty("inputSchema");
      expect(Object.keys(tool).sort()).toEqual(["name", "summary"]);
    }
  });

  it("ranks an exact name match first", async () => {
    const g = gateway();
    await g.refreshCatalog();
    const result = await g.searchTools({ query: "list_issues", limit: 5 });
    expect(result.tools[0]?.name).toBe("github.list_issues");
  });

  it("respects the requested limit", async () => {
    const g = gateway();
    await g.refreshCatalog();
    expect((await g.searchTools({ query: "tool", limit: 3 })).tools).toHaveLength(3);
  });

  it("returns far fewer bytes than the full catalog", async () => {
    const g = gateway();
    await g.refreshCatalog();
    const result = await g.searchTools({ query: "tool", limit: 5 });
    expect(result.bytes.optimized).toBeLessThan(result.bytes.baseline * 0.2);
  });

  it("records a tool-schema measurement in the ledger", async () => {
    const g = gateway();
    await g.refreshCatalog();
    await g.searchTools({ query: "tool", limit: 5 });
    const events = await engine.readAll();
    const schemaEvent = events.find((event) => event.operation === "tool-schema");
    expect(schemaEvent).toBeDefined();
    expect(schemaEvent!.optimizedBytes).toBeLessThan(schemaEvent!.baselineBytes);
  });

  it("reports the full schema only when explicitly asked for one tool", async () => {
    const g = gateway();
    await g.refreshCatalog();
    const described = await g.describeTool("github.list_issues");
    expect(described.inputSchema).toMatchObject({ type: "object" });
  });

  it("reports an unknown tool by name instead of guessing", async () => {
    const g = gateway();
    await g.refreshCatalog();
    await expect(g.describeTool("github.nope")).rejects.toMatchObject({
      code: "LR_UNKNOWN_COMMAND",
    });
  });
});

describe("invoke_tool", () => {
  it("stores the original result and returns a handle", async () => {
    const g = gateway();
    await g.refreshCatalog();
    const result = await g.invokeTool({ tool: "github.list_issues", arguments: {} });
    expect(result.handle).toMatch(/^lr_sha256_[0-9a-f]{64}$/);
    const original = await store.get(result.handle);
    expect(original.byteLength).toBe(Buffer.byteLength(bigJsonPayload(), "utf8"));
  });

  it("returns a projection far smaller than the original", async () => {
    const g = gateway();
    await g.refreshCatalog();
    const result = await g.invokeTool({ tool: "github.list_issues", arguments: {} });
    expect(result.bytes.optimized).toBeLessThanOrEqual(4096);
    expect(result.bytes.optimized / result.bytes.baseline).toBeLessThan(0.01);
  });

  it("advertises the views the agent can fetch next", async () => {
    const g = gateway();
    await g.refreshCatalog();
    const result = await g.invokeTool({ tool: "github.list_issues", arguments: {} });
    expect(result.availableViews).toContain("page");
  });

  it("records a tool-result measurement in the ledger", async () => {
    const g = gateway();
    await g.refreshCatalog();
    await g.invokeTool({ tool: "github.list_issues", arguments: {} });
    const events = await engine.readAll();
    const resultEvent = events.find((event) => event.operation === "tool-result");
    expect(resultEvent).toBeDefined();
    expect(resultEvent!.baselineBytes).toBeGreaterThan(1_000_000);
  });

  it("rejects a tool outside the configured allowlist", async () => {
    const g = gateway([upstream], { allowedUpstreams: ["other"] });
    await expect(g.refreshCatalog()).resolves.toBeUndefined();
    await expect(
      g.invokeTool({ tool: "github.list_issues", arguments: {} }),
    ).rejects.toMatchObject({ code: "LR_UPSTREAM_UNAVAILABLE" });
  });

  it("rejects oversized arguments before calling upstream", async () => {
    const g = gateway([upstream], { maxArgumentBytes: 100 });
    await g.refreshCatalog();
    await expect(
      g.invokeTool({ tool: "github.tool_1", arguments: { query: "x".repeat(500) } }),
    ).rejects.toMatchObject({ code: "LR_LIMIT_EXCEEDED" });
    expect(upstream.calls).toHaveLength(0);
  });

  it("rejects a result larger than the capture limit", async () => {
    const g = gateway([upstream], { maxCapturedResultBytes: 1024 });
    await g.refreshCatalog();
    await expect(
      g.invokeTool({ tool: "github.list_issues", arguments: {} }),
    ).rejects.toMatchObject({ code: "LR_LIMIT_EXCEEDED" });
  });

  it("times out a slow upstream", async () => {
    const slow = new FakeUpstream({ id: "slow", callDelayMs: 500 });
    const g = gateway([slow], { requestTimeoutMs: 50 });
    await g.refreshCatalog();
    await expect(g.invokeTool({ tool: "slow.tool_1", arguments: {} })).rejects.toMatchObject({
      code: "LR_UPSTREAM_TIMEOUT",
    });
  });

  it("supports caller cancellation", async () => {
    const slow = new FakeUpstream({ id: "slow", callDelayMs: 500 });
    const g = gateway([slow], { requestTimeoutMs: 5000 });
    await g.refreshCatalog();
    const controller = new AbortController();
    const pending = g.invokeTool({ tool: "slow.tool_1", arguments: {} }, controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: "LR_UPSTREAM_UNAVAILABLE" });
  });

  it("chooses the log projector for line-oriented output", async () => {
    const g = gateway();
    await g.refreshCatalog();
    const result = await g.invokeTool({ tool: "github.tool_7", arguments: {} });
    expect(result.projector).toBe("log");
  });
});

describe("fetch_result", () => {
  it("selects a page of a stored result", async () => {
    const g = gateway();
    await g.refreshCatalog();
    const invoked = await g.invokeTool({ tool: "github.list_issues", arguments: {} });
    const fetched = await g.fetchResult({ handle: invoked.handle, page: 1, pageSize: 3 });
    const view = JSON.parse(fetched.view) as { items: { number: number }[] };
    expect(view.items).toHaveLength(3);
    expect(view.items[0]!.number).toBe(4);
  });

  it("applies a field allowlist", async () => {
    const g = gateway();
    await g.refreshCatalog();
    const invoked = await g.invokeTool({ tool: "github.list_issues", arguments: {} });
    const fetched = await g.fetchResult({
      handle: invoked.handle,
      pageSize: 2,
      fields: ["number", "state"],
    });
    const view = JSON.parse(fetched.view) as { items: Record<string, unknown>[] };
    expect(Object.keys(view.items[0]!).sort()).toEqual(["number", "state"]);
  });

  it("never exceeds the configured projection budget", async () => {
    const g = gateway();
    await g.refreshCatalog();
    const invoked = await g.invokeTool({ tool: "github.list_issues", arguments: {} });
    const fetched = await g.fetchResult({ handle: invoked.handle, pageSize: 10_000 });
    expect(Buffer.byteLength(fetched.view, "utf8")).toBeLessThanOrEqual(4096);
  });

  it("rejects an unknown handle", async () => {
    const g = gateway();
    await expect(
      g.fetchResult({ handle: `lr_sha256_${"a".repeat(64)}` }),
    ).rejects.toMatchObject({ code: "LR_HANDLE_NOT_FOUND" });
  });

  it("rejects a malformed handle", async () => {
    const g = gateway();
    await expect(g.fetchResult({ handle: "../../etc/passwd" })).rejects.toMatchObject({
      code: "LR_INVALID_HANDLE",
    });
  });
});
