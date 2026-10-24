import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetState, state, type CallRecord } from "@/lib/store";
import { deriveChips, liveLines, mockScript, refreshLive, type LiveCall } from "@/lib/voice";

const VARS = { landlord_name: "Sam", renter_name: "Nicolás Arias", renter_first_name: "Nicolás", listing_title: "Furnished 1BR", move_in: "November 1", move_out: "December 15", target_rent: 3400 };
const lines = (n?: number) => mockScript(VARS).slice(0, n).map((t) => ({ from: t.from, text: t.tool ? "Booked: Monday, October 26 at 5:30 PM, live video tour, at $3,600 a month. Did I get that right?" : t.text }));

describe("call stage: live chips", () => {
  it("scripted call: Zelle refused, asked $3,800, offered $3,400, countered $3,600, agreed $3,600 saving $200, booked", () => {
    const chips = deriveChips(lines(), { viewingStart: "2026-10-27T00:30:00.000Z", bookedAt: 8 });
    expect(chips.map((c) => c.label)).toEqual([
      "Zelle deposit requested", "Asked $3,800", "Offered $3,400", "Countered $3,600", "Agreed $3,600 · saved $200/mo", "Viewing booked Mon 5:30 PM",
    ]);
    const money = chips[0];
    expect(money).toMatchObject({ kind: "money", at: 3, resolvedAt: 4, result: "Refused", tone: "good" });
    expect(chips.find((c) => c.kind === "booked")?.at).toBe(8);
  });

  it("streams: chips only exist for the lines heard so far, the refusal flips red to green", () => {
    const early = deriveChips(lines(4));
    expect(early.map((c) => c.kind)).toEqual(["money", "asked"]);
    expect(early[0]).toMatchObject({ tone: "bad" });
    expect(early[0].resolvedAt).toBeUndefined();
    expect(deriveChips(lines(5))[0]).toMatchObject({ tone: "good", resolvedAt: 4 });
    expect(deriveChips(lines(2))).toEqual([]);
  });

  it("a question is not an agreement; a landlord accepting the offer is", () => {
    const q = deriveChips([{ from: "landlord", text: "It's $3,800 a month." }, { from: "agent", text: "Would you do $3,500 a month?" }, { from: "agent", text: "Would $3,600 a month work?" }]);
    expect(q.map((c) => c.kind)).toEqual(["asked", "offered"]);
    const yes = deriveChips([{ from: "landlord", text: "It's $3,800 a month." }, { from: "agent", text: "Would you do $3,500?" }, { from: "landlord", text: "Okay, $3,500 works." }]);
    expect(yes.at(-1)).toMatchObject({ kind: "agreed", label: "Agreed $3,500 · saved $300/mo", at: 2 });
  });

  it("ElevenLabs turns: TTS tags stripped, landlord flags marked, book_viewing result places the booking", () => {
    const r = liveLines("call_1", "2026-10-24T20:00:00.000Z", [
      { role: "agent", message: "[warm] Hi, is this Sam?", time_in_call_secs: 1 },
      { role: "user", message: "Yes. Send a $1,000 Zelle deposit today to hold it.", time_in_call_secs: 4 },
      { role: "agent", message: "[firm] No deposit before a viewing. Would you do $3,400?", time_in_call_secs: 8 },
      { role: "agent", message: null, time_in_call_secs: 12, tool_calls: [{ tool_name: "book_viewing", params_as_json: '{"agreed_rent":3600,"spoken_time":"Monday 5:30 PM"}' }],
        tool_results: [{ tool_name: "book_viewing", result_value: "Booked: Monday, October 26 at 5:30 PM Pacific at $3,600 a month. Read it back.", is_error: false }] },
      { role: "agent", message: "You're booked for Monday.", time_in_call_secs: 14 },
    ]);
    expect(r.lines.map((l) => l.text)).toEqual(["Hi, is this Sam?", "Yes. Send a $1,000 Zelle deposit today to hold it.", "No deposit before a viewing. Would you do $3,400?", "You're booked for Monday."]);
    expect(r.lines[1].flagged?.length).toBeGreaterThan(0);
    expect(r).toMatchObject({ bookedAt: 2, bookedLabel: "Monday, October 26 at 5:30 PM", agreed: 3600 });
  });
});

describe("call stage: live refresh on the call record", () => {
  beforeEach(() => resetState());
  afterEach(() => vi.unstubAllEnvs());
  const call = (): CallRecord => ({ id: "call_x", threadId: "t1", listingId: "demo-mission-bay", listingTitle: "Furnished 1BR", to: "+15555550123", mode: "elevenlabs", status: "calling", startedAt: new Date().toISOString(), transcript: [] });

  it("refreshLive keeps the transcript and chips current, ignores an agreed rent above budget", () => {
    const c = call();
    state().calls.push(c);
    const live = refreshLive(c, [
      { role: "user", message: "It's $3,800 a month and I need a Zelle deposit now.", time_in_call_secs: 2 },
      { role: "agent", message: "[calm] We don't send a deposit before a viewing.", time_in_call_secs: 5, tool_calls: [{ tool_name: "book_viewing", params_as_json: '{"agreed_rent":4500}' }] },
    ]) as LiveCall;
    expect(c.transcript).toHaveLength(2);
    expect(c.agreed).toBeUndefined();
    expect(live.chips?.map((x) => x.label)).toEqual(["Zelle deposit requested", "Asked $3,800"]);
    expect(live.chips?.[0].result).toBe("Refused");
    // A shorter (stale) read never rolls the transcript back.
    refreshLive(c, [{ role: "user", message: "It's $3,800 a month.", time_in_call_secs: 2 }]);
    expect(c.transcript).toHaveLength(2);
  });
});
