import { describe, expect, it } from "vitest";
import { parseCriteria } from "@/lib/criteria";
import { searchListings } from "@/lib/search";

describe("criteria + ranking on real snapshot", () => {
  const c = parseCriteria("Busco un 1BR amoblado del 1/11 al 15/12, menos de USD 4k, cerca de Caltrain");
  it("parses the Spanish request", () => {
    expect(c.maxBudget).toBe(4000);
    expect(c.types).toEqual(["1br"]);
    expect(c.furnished).toBe(true);
    expect(c.from).toBe("2026-11-01");
    expect(c.to).toBe("2026-12-15");
    expect(c.near[0].name).toMatch(/Caltrain/);
  });
  it("returns ranked SF listings within budget, demo match near the top, scam fixture flagged", async () => {
    const { results, flagged, report } = await searchListings(c);
    expect(report.mode).toBe("snapshot");
    expect(results.length).toBeGreaterThan(5);
    for (const r of results) {
      expect(r.inSF).toBe(true);
      if (r.priceMonthly) expect(r.priceMonthly).toBeLessThanOrEqual(4400);
    }
    for (let i = 1; i < results.length; i++) expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
    expect(results.findIndex((r) => r.id === "demo-mission-bay")).toBeLessThan(3);
    expect(results.some((r) => r.source === "craigslist")).toBe(true);
    expect(flagged.find((r) => r.id === "demo-duboce-scam")?.scam.light).toBe("red");
  });
  it("parses English budgets", () => {
    expect(parseCriteria("room under $1,500 near BART").maxBudget).toBe(1500);
  });
});
