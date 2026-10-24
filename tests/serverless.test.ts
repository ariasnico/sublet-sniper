import { describe, it, expect, beforeEach } from "vitest";
import { resetState, state } from "@/lib/store";
import { resolveApproval } from "@/lib/tools";
import type { Approval } from "@/lib/store";

describe("serverless approvals", () => {
  beforeEach(() => resetState());
  it("an approval created on another instance can be resolved when the client carries it back", async () => {
    const a: Approval = { id: "ap-x", at: new Date().toISOString(), kind: "send_contact", listingId: "demo-mission-bay", title: "t", body: "hi", status: "pending", payload: { to: "landlord-demo@example.com", subject: "[Sublet Sniper demo] x" } };
    const r = await resolveApproval("ap-x", true, undefined, a);
    expect(r).toMatchObject({ ok: true });
    expect(state().threads).toHaveLength(1);
  });
  it("a carried approval still cannot email a non-allowlisted address", async () => {
    const a: Approval = { id: "ap-y", at: new Date().toISOString(), kind: "send_contact", title: "t", body: "hi", status: "pending", payload: { to: "real.landlord@gmail.com", subject: "x" } };
    expect(await resolveApproval("ap-y", true, undefined, a)).toMatchObject({ error: "recipient not allowlisted" });
    expect(state().threads).toHaveLength(0);
  });
});

import { hydrate, version } from "@/lib/store";
describe("session hydrate", () => {
  it("a cold instance adopts a newer client snapshot, but never an older one", () => {
    resetState();
    const snap = { criteria: null, results: [], flagged: [], approvals: [], searchReport: null, events: [], chat: [{ role: "user", text: "hi", at: "2026-10-24T18:00:00.000Z" }], timeline: [{ id: "t1", at: "2026-10-24T18:00:01.000Z", kind: "info", text: "x" }] };
    hydrate(snap);
    expect(state().chat).toHaveLength(1);
    expect(version(state())).toBe("2026-10-24T18:00:01.000Z");
    hydrate({ ...snap, chat: [], timeline: [{ id: "t0", at: "2026-10-24T17:00:00.000Z", kind: "info", text: "old" }] });
    expect(state().chat).toHaveLength(1);
  });
});
