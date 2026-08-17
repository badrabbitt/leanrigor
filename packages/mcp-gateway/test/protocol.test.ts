import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ResultStore } from "@leanrigor/result-store";
import { TokenLeafEngine } from "@leanrigor/tokenleaf";
import { Gateway, createGatewayServer } from "../src/index.js";
import { FakeUpstream } from "./fake-upstream.js";

let dir: string;
let client: Client;
let gateway: Gateway;

/**
 * Drives the gateway over a real MCP session using the official SDK on both
 * ends, so protocol behaviour is exercised rather than the class API alone.
 */
async function connect() {
  const store = new ResultStore({ dataDir: dir, projectId: "proj" });
  const engine = new TokenLeafEngine({ dataDir: dir, projectId: "proj" });
  gateway = new Gateway({
    upstreams: [new FakeUpstream({ id: "github" })],
    store,
    engine,
    sessionId: "session-1",
    maxProjectedResultBytes: 4096,
  });
  await gateway.refreshCatalog();

  const server = await createGatewayServer({ gateway });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "test-host", version: "1.0.0" }, { capabilities: {} });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
}

async function callJson(name: string, args: Record<string, unknown>) {
  const response = await client.callTool({ name, arguments: args });
  const content = response.content as { type: string; text: string }[];
  return {
    isError: response.isError === true,
    value: JSON.parse(content[0]!.text) as Record<string, unknown>,
  };
}

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "leanrigor-protocol-"));
  await connect();
});

afterEach(async () => {
  await client.close();
  await rm(dir, { recursive: true, force: true });
});

describe("MCP protocol surface", () => {
  it("advertises exactly the four gateway tools", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      "describe_tool",
      "fetch_result",
      "invoke_tool",
      "search_tools",
    ]);
  });

  it("keeps the advertised surface constant no matter how many upstream tools exist", async () => {
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(4);
    expect(gateway.catalog.size).toBe(50);
  });

  it("gives every tool a description and an object input schema", async () => {
    const { tools } = await client.listTools();
    for (const tool of tools) {
      expect(tool.description?.length ?? 0).toBeGreaterThan(20);
      expect(tool.inputSchema).toMatchObject({ type: "object" });
    }
  });

  it("advertises no capability it does not implement", async () => {
    expect(client.getServerCapabilities()).toEqual({ tools: {} });
  });

  it("reports its server identity", async () => {
    expect(client.getServerVersion()).toMatchObject({ name: "leanrigor" });
  });
});

describe("tool calls over the protocol", () => {
  it("searches tools and returns summaries only", async () => {
    const { value } = await callJson("search_tools", { query: "issues", limit: 3 });
    const tools = value.tools as { name: string; summary: string }[];
    expect(tools.length).toBeGreaterThan(0);
    expect(tools[0]).not.toHaveProperty("inputSchema");
  });

  it("describes one tool with its full schema", async () => {
    const { value } = await callJson("describe_tool", { tool: "github.list_issues" });
    expect(value.inputSchema).toMatchObject({ type: "object" });
  });

  it("invokes a tool and returns a handle-backed projection", async () => {
    const { value } = await callJson("invoke_tool", { tool: "github.list_issues" });
    expect(String(value.handle)).toMatch(/^lr_sha256_[0-9a-f]{64}$/);
    expect(Buffer.byteLength(String(value.view), "utf8")).toBeLessThanOrEqual(4096);
  });

  it("fetches another page of a stored result", async () => {
    const invoked = await callJson("invoke_tool", { tool: "github.list_issues" });
    const fetched = await callJson("fetch_result", {
      handle: invoked.value.handle,
      page: 2,
      pageSize: 2,
    });
    const view = JSON.parse(String(fetched.value.view)) as { items: { number: number }[] };
    expect(view.items[0]!.number).toBe(5);
  });

  it("returns a stable error code as a tool error rather than a transport failure", async () => {
    const { isError, value } = await callJson("invoke_tool", { tool: "github.does_not_exist" });
    expect(isError).toBe(true);
    expect(value.error).toBe("LR_UNKNOWN_COMMAND");
  });

  it("reports a malformed handle as a tool error", async () => {
    const { isError, value } = await callJson("fetch_result", { handle: "../../etc/passwd" });
    expect(isError).toBe(true);
    expect(value.error).toBe("LR_INVALID_HANDLE");
  });

  it("reports an unknown gateway tool as an error", async () => {
    const { isError } = await callJson("not_a_gateway_tool", {});
    expect(isError).toBe(true);
  });

  it("never places a payload in an error message", async () => {
    const { value } = await callJson("invoke_tool", { tool: "github.does_not_exist" });
    expect(JSON.stringify(value).length).toBeLessThan(500);
  });
});
