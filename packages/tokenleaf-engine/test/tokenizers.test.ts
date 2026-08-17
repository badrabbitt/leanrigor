import { describe, expect, it, vi } from "vitest";
import { LeanRigorError } from "@leanrigor/core";
import {
  AnthropicCountApiEstimator,
  ByteFallbackEstimator,
  Cl100kEstimator,
  fromProviderUsage,
  withByteOnlyFallback,
} from "../src/index.js";

const TEXT = "The quick brown fox jumps over the lazy dog. ".repeat(4);

describe("Cl100kEstimator", () => {
  const estimator = new Cl100kEstimator();

  it("labels its result as a tokenizer estimate", async () => {
    const result = await estimator.count(TEXT);
    expect(result.mode).toBe("tokenizer-estimate");
  });

  it("names and versions itself so a report can attribute the number", async () => {
    const result = await estimator.count(TEXT);
    expect(result.estimator).toMatch(/^cl100k@/);
    expect(estimator.version).toBeTruthy();
  });

  it("counts a known string correctly", async () => {
    // "hello world" is two cl100k tokens.
    expect((await estimator.count("hello world")).tokens).toBe(2);
  });

  it("counts fewer tokens than bytes for ordinary English", async () => {
    const result = await estimator.count(TEXT);
    expect(result.tokens).toBeGreaterThan(0);
    expect(result.tokens!).toBeLessThan(result.bytes);
  });

  it("returns zero tokens for empty input", async () => {
    expect((await estimator.count("")).tokens).toBe(0);
  });

  it("is deterministic", async () => {
    const a = await estimator.count(TEXT);
    const b = await estimator.count(TEXT);
    expect(a.tokens).toBe(b.tokens);
  });

  it("reports byte length alongside the token count", async () => {
    const result = await estimator.count("héllo");
    expect(result.bytes).toBe(Buffer.byteLength("héllo", "utf8"));
  });
});

describe("ByteFallbackEstimator", () => {
  const estimator = new ByteFallbackEstimator();

  it("labels its result byte-only", async () => {
    expect((await estimator.count(TEXT)).mode).toBe("byte-only");
  });

  it("reports no token count at all rather than guessing one", async () => {
    expect((await estimator.count(TEXT)).tokens).toBeUndefined();
  });

  it("carries no estimator label, because it estimated nothing", async () => {
    expect((await estimator.count(TEXT)).estimator).toBeUndefined();
  });
});

describe("fromProviderUsage", () => {
  it("labels provider-returned usage as provider usage", () => {
    const result = fromProviderUsage({ tokens: 1234, bytes: 5000 });
    expect(result.mode).toBe("provider-usage");
    expect(result.tokens).toBe(1234);
  });

  it("carries no estimator label", () => {
    expect(fromProviderUsage({ tokens: 10, bytes: 20 }).estimator).toBeUndefined();
  });
});

describe("AnthropicCountApiEstimator", () => {
  const okResponse = () =>
    new Response(JSON.stringify({ input_tokens: 42 }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });

  it("labels its result as the provider count API", async () => {
    const estimator = new AnthropicCountApiEstimator({
      apiKey: "test-key",
      model: "claude-opus-5",
      fetch: async () => okResponse(),
    });
    const result = await estimator.count(TEXT);
    expect(result.mode).toBe("provider-count-api");
    expect(result.tokens).toBe(42);
  });

  it("carries no estimator label, because the provider counted", async () => {
    const estimator = new AnthropicCountApiEstimator({
      apiKey: "test-key",
      model: "claude-opus-5",
      fetch: async () => okResponse(),
    });
    expect((await estimator.count(TEXT)).estimator).toBeUndefined();
  });

  it("sends the credential only in the documented header", async () => {
    const fetchMock = vi.fn(async () => okResponse());
    const estimator = new AnthropicCountApiEstimator({
      apiKey: "test-key",
      model: "claude-opus-5",
      fetch: fetchMock as unknown as typeof fetch,
    });
    await estimator.count("x");
    const [url, init] = fetchMock.mock.calls[0]! as unknown as [string, RequestInit];
    expect(String(url)).not.toContain("test-key");
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe("test-key");
  });

  it("refuses to construct without an explicit credential", () => {
    expect(
      () => new AnthropicCountApiEstimator({ apiKey: "", model: "claude-opus-5" }),
    ).toThrow(LeanRigorError);
  });

  it("reads its credential only from the documented environment variable", () => {
    const estimator = AnthropicCountApiEstimator.fromEnvironment(
      { LEANRIGOR_ANTHROPIC_API_KEY: "env-key" },
      { model: "claude-opus-5" },
    );
    expect(estimator).not.toBeNull();
    expect(
      AnthropicCountApiEstimator.fromEnvironment(
        { SOME_OTHER_KEY: "env-key" },
        { model: "claude-opus-5" },
      ),
    ).toBeNull();
  });

  it("raises a typed measurement error on an HTTP failure", async () => {
    const estimator = new AnthropicCountApiEstimator({
      apiKey: "k",
      model: "claude-opus-5",
      fetch: async () => new Response("nope", { status: 500 }),
    });
    await expect(estimator.count("x")).rejects.toMatchObject({
      code: "LR_MEASUREMENT_UNAVAILABLE",
    });
  });

  it("raises a typed measurement error on a network failure", async () => {
    const estimator = new AnthropicCountApiEstimator({
      apiKey: "k",
      model: "claude-opus-5",
      fetch: async () => {
        throw new TypeError("network down");
      },
    });
    await expect(estimator.count("x")).rejects.toMatchObject({
      code: "LR_MEASUREMENT_UNAVAILABLE",
    });
  });

  it("never leaks the credential into the error message", async () => {
    const estimator = new AnthropicCountApiEstimator({
      apiKey: "super-secret-key",
      model: "claude-opus-5",
      fetch: async () => new Response("nope", { status: 500 }),
    });
    await expect(estimator.count("x")).rejects.toSatisfy(
      (error: LeanRigorError) => !JSON.stringify({ m: error.message, d: error.details }).includes("super-secret-key"),
    );
  });
});

describe("withByteOnlyFallback", () => {
  const failing = {
    name: "failing",
    version: "1",
    mode: "provider-count-api" as const,
    count: async () => {
      throw new LeanRigorError("LR_MEASUREMENT_UNAVAILABLE", "upstream is down");
    },
  };

  it("downgrades to byte-only when the fallback is enabled", async () => {
    const estimator = withByteOnlyFallback(failing, { allowByteOnlyFallback: true });
    const result = await estimator.count("hello");
    expect(result.mode).toBe("byte-only");
    expect(result.tokens).toBeUndefined();
    expect(result.bytes).toBe(5);
  });

  it("propagates the typed error when the fallback is disabled", async () => {
    const estimator = withByteOnlyFallback(failing, { allowByteOnlyFallback: false });
    await expect(estimator.count("hello")).rejects.toMatchObject({
      code: "LR_MEASUREMENT_UNAVAILABLE",
    });
  });

  it("passes a successful measurement through unchanged", async () => {
    const estimator = withByteOnlyFallback(new Cl100kEstimator(), {
      allowByteOnlyFallback: true,
    });
    expect((await estimator.count("hello world")).mode).toBe("tokenizer-estimate");
  });
});
