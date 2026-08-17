import { isLeanRigorError } from "@leanrigor/core";
import type { Gateway } from "./gateway.js";
import { GATEWAY_TOOLS } from "./tools/definitions.js";

export interface GatewayServerOptions {
  readonly gateway: Gateway;
  readonly name?: string;
  readonly version?: string;
}

interface CallResult {
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

function ok(value: unknown): CallResult {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 0) }] };
}

/**
 * Errors reach the model as tool results, not transport failures, so the agent
 * can react to them. The stable error code is included; internal detail is not.
 */
function failed(error: unknown): CallResult {
  const code = isLeanRigorError(error) ? error.code : "LR_UPSTREAM_UNAVAILABLE";
  const message = error instanceof Error ? error.message : "unknown error";
  return { content: [{ type: "text", text: JSON.stringify({ error: code, message }) }], isError: true };
}

async function dispatch(gateway: Gateway, name: string, args: Record<string, unknown>) {
  switch (name) {
    case "search_tools": {
      const result = await gateway.searchTools({
        query: String(args.query ?? ""),
        ...(typeof args.limit === "number" ? { limit: args.limit } : {}),
      });
      return ok({ tools: result.tools, totalMatched: result.totalMatched });
    }
    case "describe_tool": {
      const entry = await gateway.describeTool(String(args.tool ?? ""));
      return ok({
        name: entry.name,
        description: entry.description,
        inputSchema: entry.inputSchema,
      });
    }
    case "invoke_tool": {
      const result = await gateway.invokeTool({
        tool: String(args.tool ?? ""),
        arguments: args.arguments ?? {},
      });
      return ok({
        handle: result.handle,
        summary: result.summary,
        schema: result.schema,
        lossPolicy: result.lossPolicy,
        availableViews: result.availableViews,
        view: result.view,
        isError: result.isError,
      });
    }
    case "fetch_result": {
      const result = await gateway.fetchResult({
        handle: String(args.handle ?? ""),
        ...(typeof args.page === "number" ? { page: args.page } : {}),
        ...(typeof args.pageSize === "number" ? { pageSize: args.pageSize } : {}),
        ...(Array.isArray(args.fields) ? { fields: args.fields as string[] } : {}),
      });
      return ok({
        summary: result.summary,
        lossPolicy: result.lossPolicy,
        availableViews: result.availableViews,
        view: result.view,
      });
    }
    default:
      return failed(new Error(`unknown tool "${name}"`));
  }
}

/**
 * Wraps a gateway in an MCP server.
 *
 * The server advertises exactly four tools regardless of how many upstream
 * tools exist — that constant, small surface is the point: a host pays for four
 * schemas instead of two hundred.
 *
 * Only capabilities that are actually implemented are advertised.
 */
export async function createGatewayServer(options: GatewayServerOptions) {
  const { Server } = await import("@modelcontextprotocol/sdk/server/index.js");
  const { CallToolRequestSchema, ListToolsRequestSchema } = await import(
    "@modelcontextprotocol/sdk/types.js"
  );

  const server = new Server(
    { name: options.name ?? "leanrigor", version: options.version ?? "0.1.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: GATEWAY_TOOLS.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    })),
  }));

  // `CallToolResult` in the SDK is a union that also covers task-augmented
  // responses; LeanRigor only ever returns the plain content form.
  const callToolHandler = async (request: {
    params: { name: string; arguments?: Record<string, unknown> };
  }): Promise<CallResult> => {
    const args = request.params.arguments ?? {};
    try {
      return await dispatch(options.gateway, request.params.name, args);
    } catch (error) {
      return failed(error);
    }
  };

  server.setRequestHandler(
    CallToolRequestSchema,
    callToolHandler as unknown as Parameters<typeof server.setRequestHandler>[1],
  );

  return server;
}
