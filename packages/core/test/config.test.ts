import { describe, expect, it } from "vitest";
import { LeanRigorConfigSchema, defaultConfig, parseConfig } from "../src/config.js";
import { LeanRigorError } from "../src/errors.js";

describe("defaultConfig", () => {
  const config = defaultConfig("/tmp/project");

  it("disables telemetry", () => {
    expect(config.telemetry.enabled).toBe(false);
  });

  it("disables environmental estimates", () => {
    expect(config.energy.enabled).toBe(false);
  });

  it("configures no upstream MCP servers", () => {
    expect(config.upstreamServers).toEqual([]);
  });

  it("defaults result retention to seven days and one gibibyte", () => {
    expect(config.store.ttlDays).toBe(7);
    expect(config.store.maxBytes).toBe(1024 * 1024 * 1024);
  });

  it("validates against its own schema", () => {
    expect(LeanRigorConfigSchema.safeParse(config).success).toBe(true);
  });
});

describe("parseConfig", () => {
  it("rejects unknown top-level fields", () => {
    expect(() => parseConfig({ ...defaultConfig("/tmp/p"), apiKey: "sk-live" })).toThrow(
      LeanRigorError,
    );
  });

  it("rejects an unsupported schema version", () => {
    expect(() => parseConfig({ ...defaultConfig("/tmp/p"), schemaVersion: 2 })).toThrow(
      LeanRigorError,
    );
  });

  it("rejects a non-absolute data directory", () => {
    expect(() => parseConfig({ ...defaultConfig("/tmp/p"), dataDir: "relative/dir" })).toThrow(
      LeanRigorError,
    );
  });

  it("rejects a telemetry endpoint that is not https", () => {
    const config = defaultConfig("/tmp/p");
    expect(() =>
      parseConfig({
        ...config,
        telemetry: { enabled: true, endpoint: "http://collector.example.com/v1/events" },
      }),
    ).toThrow(LeanRigorError);
  });

  it("permits an http telemetry endpoint on the loopback interface for self-hosting", () => {
    const config = defaultConfig("/tmp/p");
    const parsed = parseConfig({
      ...config,
      telemetry: { enabled: true, endpoint: "http://127.0.0.1:8787/v1/events" },
    });
    expect(parsed.telemetry.endpoint).toBe("http://127.0.0.1:8787/v1/events");
  });

  it("rejects an upstream server with an empty command", () => {
    const config = defaultConfig("/tmp/p");
    expect(() =>
      parseConfig({
        ...config,
        upstreamServers: [{ id: "gh", transport: "stdio", command: "", args: [] }],
      }),
    ).toThrow(LeanRigorError);
  });

  it("rejects duplicate upstream server identifiers", () => {
    const config = defaultConfig("/tmp/p");
    expect(() =>
      parseConfig({
        ...config,
        upstreamServers: [
          { id: "gh", transport: "stdio", command: "gh-mcp", args: [] },
          { id: "gh", transport: "stdio", command: "other", args: [] },
        ],
      }),
    ).toThrow(LeanRigorError);
  });

  it("reports a stable error code and the offending path", () => {
    try {
      parseConfig({ ...defaultConfig("/tmp/p"), store: { ttlDays: -1, maxBytes: 10 } });
      expect.unreachable("invalid config must throw");
    } catch (error) {
      expect(error).toBeInstanceOf(LeanRigorError);
      expect((error as LeanRigorError).code).toBe("LR_INVALID_CONFIG");
      expect((error as LeanRigorError).message).toContain("store.ttlDays");
    }
  });
});
