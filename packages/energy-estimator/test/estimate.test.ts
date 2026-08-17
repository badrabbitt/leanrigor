import { describe, expect, it } from "vitest";
import { LeanRigorError } from "@leanrigor/core";
import {
  FORBIDDEN_CLAIMS,
  citations,
  estimateEnergy,
  loadMethodology,
  renderEstimate,
} from "../src/index.js";

const methodology = loadMethodology();

describe("methodology data", () => {
  it("is versioned and dated", () => {
    expect(methodology.methodologyVersion).toBe("v1");
    expect(Date.parse(methodology.retrievedAt)).not.toBeNaN();
  });

  it("cites every source with a URL and a retrieval date", () => {
    expect(methodology.sources.length).toBeGreaterThanOrEqual(4);
    for (const source of methodology.sources) {
      expect(source.url).toMatch(/^https?:\/\//);
      expect(Date.parse(source.retrievedAt)).not.toBeNaN();
      expect(source.usedFor.length).toBeGreaterThan(10);
    }
  });

  it("states that it is not a datacenter measurement", () => {
    expect(methodology.notice.toLowerCase()).toContain("not measurements");
  });

  it("renders citations for a report footer", () => {
    expect(citations(methodology)[0]).toMatch(/retrieved \d{4}-\d{2}-\d{2}/);
  });
});

describe("estimateEnergy", () => {
  it("returns a range, not a single number", () => {
    const estimate = estimateEnergy({ inputTokens: 10_000, outputTokens: 1000 });
    expect(estimate.high).toBeGreaterThan(estimate.low);
    expect(estimate.central).toBeGreaterThan(estimate.low);
    expect(estimate.central).toBeLessThan(estimate.high);
  });

  it("widens the range when the model family is unknown, rather than inventing precision", () => {
    const known = estimateEnergy({ inputTokens: 10_000, outputTokens: 1000, modelClass: "medium" });
    const unknown = estimateEnergy({ inputTokens: 10_000, outputTokens: 1000 });
    const width = (e: { low: number; high: number }) => e.high - e.low;
    expect(width(unknown)).toBeGreaterThan(width(known));
    expect(unknown.modelClass).toBe("unknown");
  });

  it("says out loud that no model family was supplied", () => {
    const estimate = estimateEnergy({ inputTokens: 100, outputTokens: 100 });
    expect(estimate.assumptions.join(" ")).toMatch(/no model family was supplied/i);
  });

  it("charges decode more than prefill for the same token count", () => {
    const prefillHeavy = estimateEnergy({
      inputTokens: 10_000,
      outputTokens: 0,
      modelClass: "large",
    });
    const decodeHeavy = estimateEnergy({
      inputTokens: 0,
      outputTokens: 10_000,
      modelClass: "large",
    });
    expect(decodeHeavy.central).toBeGreaterThan(prefillHeavy.central);
  });

  it("charges cache reads less than fresh input, but not zero", () => {
    const fresh = estimateEnergy({ inputTokens: 10_000, outputTokens: 0, modelClass: "medium" });
    const cached = estimateEnergy({
      inputTokens: 0,
      cachedInputTokens: 10_000,
      outputTokens: 0,
      modelClass: "medium",
    });
    expect(cached.central).toBeGreaterThan(0);
    expect(cached.central).toBeLessThan(fresh.central);
  });

  it("returns zero for zero tokens", () => {
    const estimate = estimateEnergy({ inputTokens: 0, outputTokens: 0 });
    expect(estimate.low).toBe(0);
    expect(estimate.high).toBe(0);
  });

  it("scales linearly with token count", () => {
    const single = estimateEnergy({ inputTokens: 1000, outputTokens: 1000, modelClass: "small" });
    const double = estimateEnergy({ inputTokens: 2000, outputTokens: 2000, modelClass: "small" });
    expect(double.central).toBeCloseTo(single.central * 2, 10);
  });

  it("rejects negative token counts", () => {
    expect(() => estimateEnergy({ inputTokens: -1, outputTokens: 0 })).toThrow(LeanRigorError);
  });

  it("lists the assumptions that produced the number", () => {
    const estimate = estimateEnergy({ inputTokens: 1000, outputTokens: 100, modelClass: "large" });
    expect(estimate.assumptions.length).toBeGreaterThanOrEqual(4);
    expect(estimate.assumptions.join(" ")).toContain("Infrastructure overhead");
  });

  it("names the methodology version it used", () => {
    expect(estimateEnergy({ inputTokens: 1, outputTokens: 1 }).methodologyVersion).toBe("v1");
  });
});

describe("carbon", () => {
  it("produces no carbon figure without a grid intensity", () => {
    expect(estimateEnergy({ inputTokens: 10_000, outputTokens: 1000 }).carbon).toBeUndefined();
  });

  it("produces a carbon range only from a supplied grid intensity", () => {
    const estimate = estimateEnergy({
      inputTokens: 10_000,
      outputTokens: 1000,
      modelClass: "medium",
      gridIntensityGramsPerKwh: 400,
    });
    expect(estimate.carbon?.gridIntensityGramsPerKwh).toBe(400);
    expect(estimate.carbon!.high).toBeGreaterThan(estimate.carbon!.low);
  });

  it("converts watt-hours to grams using the supplied intensity", () => {
    const estimate = estimateEnergy({
      inputTokens: 0,
      outputTokens: 10_000,
      modelClass: "medium",
      gridIntensityGramsPerKwh: 1000,
    });
    expect(estimate.carbon!.central).toBeCloseTo(estimate.central, 10);
  });

  it("attributes the grid intensity to the caller, not to LeanRigor", () => {
    const estimate = estimateEnergy({
      inputTokens: 100,
      outputTokens: 100,
      gridIntensityGramsPerKwh: 400,
    });
    expect(estimate.assumptions.join(" ")).toMatch(/you supplied/i);
    expect(estimate.assumptions.join(" ")).toMatch(/does not assume a grid/i);
  });
});

describe("copy safety", () => {
  const samples = [
    renderEstimate(estimateEnergy({ inputTokens: 10_000, outputTokens: 1000 })),
    renderEstimate(
      estimateEnergy({
        inputTokens: 10_000,
        outputTokens: 1000,
        modelClass: "large",
        gridIntensityGramsPerKwh: 400,
      }),
    ),
    methodology.notice,
    citations(methodology).join("\n"),
  ];

  it.each(FORBIDDEN_CLAIMS)("never claims %s", (phrase) => {
    for (const sample of samples) {
      expect(sample.toLowerCase()).not.toContain(phrase);
    }
  });

  it("labels the output as an estimate rather than a measurement", () => {
    expect(samples[0]).toContain("Environmental estimate (not a measurement)");
  });

  it("shows a range rather than one number", () => {
    expect(samples[0]).toMatch(/\d+\.\d+–\d+\.\d+ Wh/);
  });

  it("says carbon was not estimated when no grid intensity was given", () => {
    expect(samples[0]).toContain("not estimated");
  });

  it("prints every assumption", () => {
    expect(samples[0]).toContain("Assumptions:");
    expect(samples[0]).toContain("Infrastructure overhead");
  });
});

describe("snapshot of user-visible labels", () => {
  it("matches the reviewed wording", () => {
    const estimate = estimateEnergy({
      inputTokens: 100_000,
      outputTokens: 10_000,
      modelClass: "medium",
    });
    const labels = renderEstimate(estimate)
      .split("\n")
      .filter((line) => line.trim().length > 0 && !line.trim().startsWith("-"))
      .map((line) => line.replace(/[\d.]+–[\d.]+/g, "<range>").trimEnd());
    expect(labels).toMatchInlineSnapshot(`
      [
        "Environmental estimate (not a measurement)",
        "  Estimated energy range      <range> Wh",
        "  Methodology                 v1",
        "  Model class assumed         medium",
        "  Carbon                      not estimated; supply a grid intensity to compute it",
        "Assumptions:",
      ]
    `);
  });
});
