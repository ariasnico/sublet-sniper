import { describe, expect, it, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { parseListingPage } from "../src/lib/sources/craigslist";
import { toolAnalyzeUrl, toolSearch } from "../src/lib/tools";
import { toMonthly } from "../src/lib/normalize";
import { state, resetState } from "../src/lib/store";

const LINK = "https://sfbay.craigslist.org/sfc/apa/d/san-francisco-move-in-ready-and/7989222615.html";
const html = readFileSync(new globalThis.URL("./fixtures/cl-7989222615.html", import.meta.url), "utf8");

describe("pasted Craigslist link", () => {
  beforeEach(() => resetState?.());
  it("parses title, price, address, photos", () => {
    const r = parseListingPage(html, LINK);
    expect(r.priceText).toBe("$1,100");
    expect(r.address).toContain("2218 Ortega St");
    expect(r.hood).toMatch(/sunset/i);
    expect(r.images!.length).toBeGreaterThan(3);
  });
  it("flags the $1,100 Sunset 1BR as red with a price-vs-median reason", async () => {
    const out = await toolAnalyzeUrl({ url: `look at this ${LINK}` }, async (u) => parseListingPage(html, u)) as { scamScore: number };
    const l = state().results[0];
    expect(l.scam.light).toBe("red");
    expect(out.scamScore).toBeGreaterThanOrEqual(50);
    expect(l.scam.reasons.join(" ")).toMatch(/median/);
  });
});

describe("budget", () => {
  it("never returns listings over max budget, even when a follow-up search omits it", async () => {
    await toolSearch({ query: "1br under $4k" });
    const r = await toolSearch({ query: "furnished near caltrain" });
    for (const x of [...state().results.map((y) => y.priceMonthly), ...r.top.map((y) => (y as { price?: number }).price)]) if (x != null) expect(x).toBeLessThanOrEqual(4400);
  });
  it("weekly sanity: $3,000 'per week' is treated as monthly", () => {
    expect(toMonthly(500, "week")).toBe(Math.round((500 * 52) / 12));
    expect(toMonthly(3000, "week")).toBe(3000);
  });
});
