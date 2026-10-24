import { describe, expect, it } from "vitest";
import { normalizeHeuristic } from "@/lib/normalize";
import { hamming, scoreScam } from "@/lib/scam";
import { snapshotListings } from "@/lib/sources/craigslist";
import { demoListings } from "@/lib/demo";

const corpus = [...snapshotListings(), ...demoListings()].map(normalizeHeuristic);
const byId = (id: string) => corpus.find((l) => l.id === id)!;

describe("scam scoring", () => {
  it("flags the Duboce $18,600 fixture as RED with explained reasons", () => {
    const r = scoreScam(byId("demo-duboce-scam"), { corpus });
    expect(r.light).toBe("red");
    const all = r.reasons.join(" | ");
    expect(all).toMatch(/wire/);
    expect(all).toMatch(/out of the country/);
    expect(all).toMatch(/AB 12/);
    expect(all).toMatch(/identical to another listing/);
    expect(all).toMatch(/photo matches/);
  });
  it("keeps the accomplice demo listing GREEN", () => {
    expect(scoreScam(byId("demo-mission-bay"), { corpus }).light).toBe("green");
  });
  it("flags landlord messages asking for Zelle deposit to hold", () => {
    const r = scoreScam(byId("demo-mission-bay"), { corpus, messages: ["Please send a deposit to hold via Zelle, I'm out of the country"] });
    expect(r.light).toBe("red");
  });
  it("flags real snapshot listings priced under 60% of median", () => {
    const lows = corpus.filter((l) => l.source === "craigslist" && l.inSF && scoreScam(l, { corpus }).reasons.some((x) => x.includes("threshold 60%")));
    expect(lows.length).toBeGreaterThan(0);
  });
  it("most real snapshot listings are not red", () => {
    const sf = corpus.filter((l) => l.source === "craigslist" && l.inSF);
    const red = sf.filter((l) => scoreScam(l, { corpus }).light === "red").length;
    expect(red / sf.length).toBeLessThan(0.15);
  });
  it("computes pHash hamming distance", () => {
    expect(hamming("ffff", "fffe")).toBe(1);
    expect(hamming("c4d1b38e8e3b1c63", "c4d1b38e8e3b1c67")).toBe(1);
  });
  it("flags brand-new X accounts", () => {
    const l = normalizeHeuristic({ id: "x1", source: "x", url: "u", title: "sublet my room $900", priceText: "$900", hood: null, body: "sublet my room in mission $900",
      author: { handle: "new", createdAt: "2026-10-01T00:00:00Z", followers: 3 } });
    const r = scoreScam(l, { corpus: [], now: new Date("2026-10-24") });
    expect(r.reasons.join()).toMatch(/days old/);
  });
});
