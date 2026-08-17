/**
 * JSON Schemas for the three tools LeanRigor exposes to a host.
 *
 * These are written as plain JSON Schema rather than generated from a runtime
 * validator, because they are part of the protocol surface: they must not drift
 * with a validation library's version.
 */
export interface ToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
}

export const SEARCH_TOOLS: ToolDefinition = {
  name: "search_tools",
  description:
    "Search the connected MCP servers for tools by name or purpose. Returns compact "
    + "name and one-line summary pairs only. Call describe_tool for a tool's full input schema.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "What the tool should do, or part of its name." },
      limit: {
        type: "integer",
        minimum: 1,
        maximum: 50,
        description: "Maximum tools to return. Defaults to 10.",
      },
    },
    required: ["query"],
    additionalProperties: false,
  },
};

export const DESCRIBE_TOOL: ToolDefinition = {
  name: "describe_tool",
  description: "Return one tool's full description and input schema, by its namespaced name.",
  inputSchema: {
    type: "object",
    properties: {
      tool: { type: "string", description: "Namespaced tool name, e.g. github.list_issues." },
    },
    required: ["tool"],
    additionalProperties: false,
  },
};

export const INVOKE_TOOL: ToolDefinition = {
  name: "invoke_tool",
  description:
    "Call an upstream tool. The full result is stored locally and a compact projection is "
    + "returned together with a handle; use fetch_result to read more of it.",
  inputSchema: {
    type: "object",
    properties: {
      tool: { type: "string", description: "Namespaced tool name." },
      arguments: { type: "object", description: "Arguments for the upstream tool." },
    },
    required: ["tool"],
    additionalProperties: false,
  },
};

export const FETCH_RESULT: ToolDefinition = {
  name: "fetch_result",
  description:
    "Read another view of a stored result by its handle: a different page, or a subset of fields.",
  inputSchema: {
    type: "object",
    properties: {
      handle: { type: "string", description: "Handle returned by invoke_tool." },
      page: { type: "integer", minimum: 0, description: "0-based page number." },
      pageSize: { type: "integer", minimum: 1, description: "Items per page." },
      fields: {
        type: "array",
        items: { type: "string" },
        description: "Only these fields are returned for each item.",
      },
    },
    required: ["handle"],
    additionalProperties: false,
  },
};

export const GATEWAY_TOOLS: readonly ToolDefinition[] = [
  SEARCH_TOOLS,
  DESCRIBE_TOOL,
  INVOKE_TOOL,
  FETCH_RESULT,
];
