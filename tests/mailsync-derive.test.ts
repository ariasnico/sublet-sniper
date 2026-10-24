import { describe, expect, it } from "vitest";
import { bookedStartFrom, derivedStatus } from "../src/lib/mailsync";
import type { ThreadMsg } from "../src/lib/store";

const now = new Date("2026-10-24T21:00:00Z");
describe("rebuild deal state from AgentMail text (cross-instance)", () => {
  it("reads the confirmed viewing from the agent's email", () => {
    const iso = bookedStartFrom("Deal at $3,600/mo, thank you! Mon, Oct 26, 5:30 PM PT works for me for the video tour. I've put it on my calendar.", now);
    expect(iso).toBe("2026-10-27T00:30:00.000Z");
  });
  it("ignores slot offers that are not confirmed", () => {
    expect(bookedStartFrom("I can do any of these (Pacific time):\n1) Mon, Oct 26, 5:30 PM PT", now)).toBeNull();
  });
  it("derives flagged, then booked, from the conversation", () => {
    const msgs: ThreadMsg[] = [
      { from: "agent", text: "Hi! I'm Nicolás…", at: "1" },
      { from: "landlord", text: "Can you Zelle me a $7,600 deposit today?", at: "2", flagged: ["Asks for Zelle (no buyer protection)"] },
      { from: "agent", text: "I don't send any deposit…", at: "3" },
    ];
    expect(derivedStatus(msgs).status).toBe("flagged");
    msgs.push({ from: "landlord", text: "Ok, $3,600 works. Video tour Monday after 5pm?", at: "4" },
      { id: "m5", from: "agent", text: "Mon, Oct 26, 5:30 PM PT works for me. I've put it on my calendar.", at: "5" });
    expect(derivedStatus(msgs)).toMatchObject({ status: "booked", bookedId: "m5" });
  });
});
