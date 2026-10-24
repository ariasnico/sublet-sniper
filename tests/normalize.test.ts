import { describe, expect, it } from "vitest";
import { detectDates, detectPeriod, detectType, isInSF, normalizeHeuristic, parsePrice, toMonthly } from "@/lib/normalize";
import { snapshotListings } from "@/lib/sources/craigslist";

const snap = snapshotListings();

describe("normalization on the real 2026-10-24 Craigslist snapshot", () => {
  it("loads all 765 snapshot listings", () => {
    expect(snap.length).toBe(765);
  });
  it("parses prices", () => {
    expect(parsePrice("$2,300")).toBe(2300);
    expect(parsePrice(null)).toBeNull();
  });
  it("normalizes weekly prices to monthly (real listing: '$700/wk Beautiful... Edwardian Room')", () => {
    const wk = snap.find((r) => r.title.startsWith("$700/wk"))!;
    const n = normalizeHeuristic(wk);
    expect(n.pricePeriod).toBe("week");
    expect(n.priceMonthly).toBe(3033);
    expect(n.type).toBe("room");
  });
  it("converts periods", () => {
    expect(toMonthly(100, "night")).toBe(3000);
    expect(toMonthly(9000, "total", 45)).toBe(6000);
    expect(detectPeriod("rent period: weekly")).toBe("week");
  });
  it("detects types", () => {
    expect(detectType("Prime Noe Valley location, small 1 BR apt. furnished sublet")).toBe("1br");
    expect(detectType("Large Furnished 2 Bedroom 2 Bathroom Edwardian Home")).toBe("2br");
    expect(detectType("New large Furnished Studio - 1 Br (lower Pac Hts)")).toBe("studio");
    expect(detectType("XL.ROOM  Near Google/Apple shuttle")).toBe("room");
  });
  it("uses detail attrs: furnished, dates and lat/lon from the real detail snapshot", () => {
    const suite = snap.find((r) => r.title === "Private suite with separate entrance" && r.body)!;
    const n = normalizeHeuristic(suite);
    expect(n.furnished).toBe(true);
    expect(n.availableFrom).toBe("2026-10-27");
    expect(n.inSF).toBe(true);
  });
  it("filters non-SF listings that Craigslist mixes into sfc/apa", () => {
    const santaClara = snap.find((r) => r.title.includes("Santa Clara"))!;
    expect(isInSF(santaClara)).toBe(false);
    const nonSf = snap.map(normalizeHeuristic).filter((l) => !l.inSF).length;
    expect(nonSf).toBeGreaterThan(10);
  });
  it("parses date ranges", () => {
    expect(detectDates("available 11/1 - 12/15")).toEqual({ from: "2026-11-01", to: "2026-12-15" });
    expect(detectDates("Nov 1 to Jan 5")).toEqual({ from: "2026-11-01", to: "2027-01-05" });
  });
});
