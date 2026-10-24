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
  it("proposes slots after a video tour and picks the chosen one", () => {
    expect(planReply("here's a video walkthrough, when can you come?", thread(), defaultProfile(), slots).proposeSlots).toBe(true);
    expect(pickSlot("Option 2 works for me", slots)).toEqual(slots[1]);
  });
  it("only allowlisted demo addresses can be emailed", () => {
    expect(emailAllowed("landlord-demo@example.com")).toBe(true);
    expect(emailAllowed("real.landlord@gmail.com")).toBe(false);
  });
});
