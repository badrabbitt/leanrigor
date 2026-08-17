import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TokenLeafEngine } from "@leanrigor/tokenleaf";
import { runReport } from "../src/commands/report.js";
import { escapeXml, renderShareCard, type ShareCard } from "../src/render/share-svg.js";

let dataDir: string;

function capture() {
  const lines: string[] = [];
  return { lines, io: { out: (l: string) => lines.push(l), err: (l: string) => lines.push(l) } };
}

function card(overrides: Partial<ShareCard> = {}): ShareCard {
  return {
    operations: 42,
    baselineBytes: 2_804_112,
    optimizedBytes: 611_420,
    tokensAvoided: 478_900,
    measurementLabel: "Measured with cl100k@1",
    passedEvents: 8,
    verifiedEvents: 8,
    clientVersion: "0.1.0",
    ...overrides,
  };
}

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), "leanrigor-share-"));
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

describe("escapeXml", () => {
  it("escapes every special character", () => {
    expect(escapeXml(`<&>"'`)).toBe("&lt;&amp;&gt;&quot;&apos;");
  });
});

describe("renderShareCard", () => {
  it("produces a well-formed standalone SVG", () => {
    const svg = renderShareCard(card());
    expect(svg.startsWith("<svg xmlns=")).toBe(true);
    expect(svg.trimEnd().endsWith("</svg>")).toBe(true);
  });

  it("fetches no remote asset and runs no script", () => {
    const svg = renderShareCard(card());
    expect(svg).not.toContain("<image");
    expect(svg).not.toContain("@import");
    expect(svg).not.toContain("xlink:href");
    expect(svg).not.toContain("<script");
    expect(svg).not.toContain("foreignObject");
    expect(svg).not.toMatch(/url\(\s*['"]?https?:/);
    expect(svg).not.toMatch(/href\s*=\s*['"]https?:/);
  });

  it("carries no URL other than the SVG namespace declaration", () => {
    const urls = renderShareCard(card()).match(/https?:\/\/[^"'\s)]+/g) ?? [];
    expect(urls).toEqual(["http://www.w3.org/2000/svg"]);
  });

  it("uses a system-safe font stack rather than a downloaded font", () => {
    expect(renderShareCard(card())).toContain("ui-monospace");
  });

  it("shows the verified outcome before the savings", () => {
    const svg = renderShareCard(card());
    expect(svg.indexOf("Verified passed")).toBeLessThan(svg.indexOf("Context reduction"));
  });

  it("labels the measurement", () => {
    expect(renderShareCard(card())).toContain("Measured with cl100k@1");
  });

  it("omits the token row when nothing was measured", () => {
    expect(renderShareCard(card({ tokensAvoided: undefined }))).not.toContain("tokens avoided");
  });

  it("shows gate coverage when supplied", () => {
    const svg = renderShareCard(card({ gatesPassed: 24, gatesRequired: 24 }));
    expect(svg).toContain("Required gates passed");
    expect(svg).toContain("24 / 24");
  });

  it("escapes a hostile measurement label instead of emitting raw markup", () => {
    const svg = renderShareCard(
      card({ measurementLabel: `</text><script>alert("x")</script>` }),
    );
    expect(svg).not.toContain("<script>");
    expect(svg).toContain("&lt;script&gt;");
  });

  it("is deterministic", () => {
    expect(renderShareCard(card())).toBe(renderShareCard(card()));
  });

  it("handles a zero-byte session without dividing by zero", () => {
    const svg = renderShareCard(card({ baselineBytes: 0, optimizedBytes: 0 }));
    expect(svg).toContain("0.0%");
    expect(svg).not.toContain("NaN");
  });
});

describe("the written share artifact", () => {
  it("contains no filesystem path or session identifier", async () => {
    const engine = new TokenLeafEngine({ dataDir, projectId: "default" });
    await engine.record({
      eventId: "e1",
      sessionId: "a-very-identifying-session-name",
      operation: "tool-result",
      baselineBytes: 1000,
      optimizedBytes: 100,
      measurementMode: "byte-only",
      passed: true,
      requiredGatesPassed: true,
      createdAt: "2026-08-17T09:00:00.000Z",
    } as never);

    const target = path.join(dataDir, "share.svg");
    const { io } = capture();
    await runReport(io, { dataDir, sessionId: "a-very-identifying-session-name", share: target });

    const svg = await readFile(target, "utf8");
    expect(svg).not.toContain("a-very-identifying-session-name");
    expect(svg).not.toContain(dataDir);
    expect(svg).not.toContain(process.cwd());
    expect(svg).not.toContain("lr_sha256_");
  });

  it("tells the user what the card does and does not contain", async () => {
    const engine = new TokenLeafEngine({ dataDir, projectId: "default" });
    await engine.record({
      eventId: "e1",
      sessionId: "s",
      operation: "tool-result",
      baselineBytes: 10,
      optimizedBytes: 1,
      measurementMode: "byte-only",
      passed: true,
      createdAt: "2026-08-17T09:00:00.000Z",
    } as never);

    const { lines, io } = capture();
    await runReport(io, { dataDir, sessionId: "s", share: path.join(dataDir, "card.svg") });
    expect(lines.join("\n")).toContain("no prompt, path or repository name");
  });
});
