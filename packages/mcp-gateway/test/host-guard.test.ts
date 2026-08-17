import { describe, expect, it } from "vitest";
import { isLoopbackHostname, isRequestAllowed } from "../src/index.js";

describe("isLoopbackHostname", () => {
  it("accepts the loopback names, with or without a port", () => {
    for (const value of [
      "localhost",
      "localhost:8931",
      "127.0.0.1",
      "127.0.0.1:8931",
      "[::1]",
      "[::1]:8931",
      "http://localhost:8931",
    ]) {
      expect(isLoopbackHostname(value), value).toBe(true);
    }
  });

  it("rejects any other host", () => {
    for (const value of [
      "evil.com",
      "evil.com:8931",
      "http://evil.com",
      "127.0.0.1.evil.com",
      "localhost.evil.com",
      "192.168.1.10",
      "",
    ]) {
      expect(isLoopbackHostname(value), value).toBe(false);
    }
  });

  it("rejects a missing value", () => {
    expect(isLoopbackHostname(undefined)).toBe(false);
  });
});

describe("isRequestAllowed", () => {
  it("allows a loopback Host with no Origin", () => {
    expect(isRequestAllowed({ host: "127.0.0.1:8931" })).toBe(true);
  });

  it("allows a loopback Host with a loopback Origin", () => {
    expect(isRequestAllowed({ host: "localhost:8931", origin: "http://localhost:8931" })).toBe(true);
  });

  it("rejects a rebound Host", () => {
    expect(isRequestAllowed({ host: "evil.com" })).toBe(false);
  });

  it("rejects a foreign Origin even when the Host is loopback", () => {
    expect(isRequestAllowed({ host: "127.0.0.1:8931", origin: "https://evil.com" })).toBe(false);
  });

  it("rejects a missing Host header", () => {
    expect(isRequestAllowed({})).toBe(false);
  });

  it("rejects a host that merely contains a loopback name", () => {
    expect(isRequestAllowed({ host: "localhost.evil.com" })).toBe(false);
    expect(isRequestAllowed({ host: "evil.com", origin: "http://127.0.0.1" })).toBe(false);
  });

  it("honours an explicit extra allowed host", () => {
    expect(isRequestAllowed({ host: "dev.internal:8931" }, ["dev.internal"])).toBe(true);
    expect(isRequestAllowed({ host: "other.internal" }, ["dev.internal"])).toBe(false);
  });

  it("uses only the first value of a repeated header", () => {
    expect(isRequestAllowed({ host: ["evil.com", "127.0.0.1"] })).toBe(false);
  });
});
