import { describe, expect, it } from "vitest";
import { detectRedFlags, planReply, emailAllowed, pickSlot } from "@/lib/landlord";
import { defaultProfile, type Thread } from "@/lib/store";

const thread = (): Thread => ({ id: "t", listingId: "demo-mission-bay", listingTitle: "x", landlordEmail: "landlord-demo@example.com", subject: "s", messages: [], status: "active", askedProof: false });
const slots = [0, 1, 2].map((d) => ({ start: new Date(Date.UTC(2026, 9, 25 + d, 21)).toISOString(), end: new Date(Date.UTC(2026, 9, 25 + d, 22)).toISOString() }));

describe("landlord safety", () => {
  it("flags the Duboce-style message: out of country + Zelle + deposit before viewing", () => {
    const f = detectRedFlags("I'm currently out of the country. Please send the deposit via Zelle today to hold it and I'll mail you the keys.");
    expect(f.length).toBeGreaterThanOrEqual(3);
    const plan = planReply("I'm out of the country, wire the deposit first", thread(), defaultProfile(), slots);
    expect(plan.intent).toBe("safety");
    expect(plan.text).toMatch(/don't send any deposit/);
  });
  it("does not flag a normal reply", () => {
    expect(detectRedFlags("Yes it's available, furnished, near Caltrain. Tell me about yourself?")).toEqual([]);
  });
  it("negotiates down to budget and asks for proof", () => {
    const p = { ...defaultProfile(), maxBudget: 3600 };
    const plan = planReply("It's $3,800/mo, still available.", thread(), p, slots);
    expect(plan.intent).toBe("price");
    expect(plan.text).toContain("$3,600");
    expect(plan.text).toMatch(/video walkthrough/);
  });
  it("one reply refuses money-before-viewing AND counters the rent AND asks for the live tour", async () => {
    const msg = "It's $3,800/mo, available now. Please send a $7,600 deposit via Zelle to hold it before the viewing.";
    const plan = planReply(msg, thread(), defaultProfile(), slots);
    expect(plan.intent).toBe("safety");
    expect(plan.counter).toBe(3600); // ~95% of $3,800, rounded to $50, never the $7,600 deposit
    expect(plan.text).toMatch(/don't send any deposit/);
    expect(plan.text).toMatch(/would you do \$3,600\/mo/);
    expect(plan.text).toMatch(/live video walkthrough/);
    const { writeReply } = await import("@/lib/landlord");
    expect(await writeReply(plan, msg, defaultProfile())).toBe(plan.text); // safety replies are never rewritten
    // Over budget: the counter is capped at the budget.
    expect(planReply("Rent is $4,500/month, wire the deposit today", thread(), defaultProfile(), slots).counter).toBe(4000);
  });
  it("proposes slots after a video tour and picks the chosen one", () => {
    expect(planReply("here's a video walkthrough, when can you come?", thread(), defaultProfile(), slots).proposeSlots).toBe(true);
    expect(pickSlot("Option 2 works for me", slots)).toEqual(slots[1]);
  });
  it("only allowlisted demo addresses can be emailed", () => {
    expect(emailAllowed("landlord-demo@example.com")).toBe(true);
    expect(emailAllowed("real.landlord@gmail.com")).toBe(false);
  });
});

describe("landlord-proposed times", () => {
  it("accepts 'Video tour Monday after 5pm' inside the window, no fake tour claim", async () => {
    const { parseWindow } = await import("@/lib/landlord");
    const now = new Date("2026-10-24T19:00:00Z");
    const w = parseWindow("Yes it's available! Video tour Monday after 5pm?\n\nOn Sat, Oct 24 Nicolás wrote:\n> Sunday 11am?", now)!;
    expect(w).toEqual({ day: "2026-10-26", startMin: 17 * 60, endMin: 20 * 60 });
    const slot = { start: "2026-10-27T00:30:00.000Z", end: "2026-10-27T01:15:00.000Z" };
    const plan = planReply("Yes it's available! Video tour Monday after 5pm?", thread(), defaultProfile(), slots, slot);
    expect(plan.intent).toBe("landlord_time");
    expect(plan.slot).toEqual(slot);
    expect(plan.text).toMatch(/Mon, Oct 26, 5:30 PM PT works/);
    expect(plan.text).not.toMatch(/thanks for the tour/i);
  });
  it("ignores quoted text when classifying", () => {
    const plan = planReply("Sounds good\n> please send the deposit via zelle", thread(), defaultProfile(), slots);
    expect(plan.intent).not.toBe("safety");
  });
});

describe("signature", () => {
  it("replaces LLM sign-offs with exactly one 'Nicolás Arias'", async () => {
    const { withSignature } = await import("@/lib/landlord");
    const out = withSignature("Hi! Would $3,400 work?\n\nBest regards,\n[Your Name]", "Nicolás Arias");
    expect(out).toBe("Hi! Would $3,400 work?\n\nBest,\nNicolás Arias");
  });
});
