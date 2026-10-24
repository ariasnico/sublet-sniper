import { describe, expect, it } from "vitest";
import { deal } from "../src/app/ui/Inbox";
import type { Thread } from "../src/lib/store";

const thread = (messages: Thread["messages"]): Thread => ({ id: "t", listingId: "l", listingTitle: "x", landlordEmail: "a@b.c", subject: "s", messages, status: "active", askedProof: true });

describe("deal bar", () => {
  it("reads the landlord ask and the agent counter", () => {
    const d = deal(thread([
      { from: "agent", text: "Hi, interested", at: "1" },
      { from: "landlord", text: "It's $3,800 a month", at: "2" },
      { from: "agent", text: "My budget tops out at $4,000/mo; would you do $3,600/mo for Nov?", at: "3" },
    ]));
    expect(d).toEqual({ listed: null, asked: 3800, offered: 3600 });
  });
  it("falls back to the lowest amount under the ask when the LLM rewords", () => {
    const d = deal(thread([{ from: "landlord", text: "Price is $3,800", at: "1" }, { from: "agent", text: "Budget is $4,000 max. How about $3,550?", at: "2" }]));
    expect(d?.offered).toBe(3550);
  });
  it("ignores flagged scam messages and threads without prices", () => {
    expect(deal(thread([{ from: "landlord", text: "Zelle me $7,200 deposit", at: "1", flagged: ["Zelle"] }]))).toBeNull();
  });
  it("reads the rent from a flagged Zelle message and treats '$3,600 works' as acceptance", () => {
    const d = deal(thread([
      { from: "landlord", text: "Yes it's available! It's $3,800/mo. Can you Zelle me a $7,600 deposit today to hold it?", at: "1", flagged: ["Asks for Zelle"] },
      { from: "agent", text: "I don't send any deposit... would you do $3,600/mo for Nov 1 to Dec 15?", at: "2" },
      { from: "landlord", text: "Ok fair, no deposit until you see it. $3,600 works. Video tour Monday after 5pm?", at: "3" },
    ]));
    expect(d).toMatchObject({ asked: 3800, offered: 3600 });
  });
});
