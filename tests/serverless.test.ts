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
