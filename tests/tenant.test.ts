import { describe, it, expect, beforeEach } from "vitest";
import { resetState, state, sessionStart, ensureEpoch, log } from "@/lib/store";
import { clearTenantCache, memoryStore, runAsTenant, restoreState, type TenantStore } from "@/lib/tenant";
import { currentTenant, ownsSubject, setTenantHooks, tagSubject, shortId } from "@/lib/tenant-ctx";
import { chat } from "@/lib/agent";
import { resolveApproval } from "@/lib/tools";

const A = "aaaaaaaa-1111-4111-8111-111111111111";
const B = "bbbbbbbb-2222-4222-8222-222222222222";

describe("tenant context", () => {
  beforeEach(() => { clearTenantCache(); resetState(); setTenantHooks({}); });

  it("two tenants never see each other's state, and the global session is untouched", async () => {
    const db = memoryStore();
    await runAsTenant(A, db, async () => { await chat("furnished 1br in SF under $4000"); });
    await runAsTenant(B, db, async () => { state().chat.push({ role: "user", text: "B only", at: new Date().toISOString() }); });
    const a = await runAsTenant(A, db, async () => state().chat.map((c) => c.text));
    const b = await runAsTenant(B, db, async () => state().chat.map((c) => c.text));
    expect(a[0]).toMatch(/furnished/);
    expect(a).not.toContain("B only");
    expect(b).toEqual(["B only"]);
    expect(state().chat).toHaveLength(0); // no tenant → global state
    expect(db.rows.size).toBe(2);
  });

  it("the DB is the source of truth: a cold instance (no cache) restores the tenant from its row", async () => {
    const db = memoryStore();
    await runAsTenant(A, db, async () => { await chat("furnished 1br in SF under $4000"); });
    const results = await runAsTenant(A, db, async () => state().results.length);
    clearTenantCache();
    const again = await runAsTenant(A, db, async () => state().results.length);
    expect(results).toBeGreaterThan(0);
    expect(again).toBe(results);
  });

  it("a newer row written by another instance wins over this instance's cache", async () => {
    const db = memoryStore();
    await runAsTenant(A, db, async () => { log("info", "mine"); });
    // Another instance writes later.
    const later = new Date(Date.now() + 5000).toISOString();
    await db.save(A, { v: 1, bornAt: "", state: { ...restoreState({}).state, timeline: [{ id: "x", at: later, kind: "info", text: "theirs" }] } }, later);
    const tl = await runAsTenant(A, db, async () => state().timeline.map((t) => t.text));
    expect(tl).toEqual(["theirs"]);
  });

  it("Reset and the epoch are per tenant", async () => {
    const globalBorn = sessionStart();
    const db = memoryStore();
    await runAsTenant(A, db, async () => { log("info", "a"); resetState(); });
    const bornA = await runAsTenant(A, db, async () => sessionStart());
    const bornB = await runAsTenant(B, db, async () => { ensureEpoch("2026-10-24T00:00:00.000Z"); return sessionStart(); });
    expect(bornA).not.toBe("");
    expect(bornB).toBe("2026-10-24T00:00:00.000Z");
    expect(await runAsTenant(A, db, async () => state().timeline.length)).toBe(0);
    expect(sessionStart()).toBe(globalBorn); // global epoch untouched
  });

  it("outgoing subjects carry the tenant tag; mail sync only claims own threads", async () => {
    const db = memoryStore();
    const indexed: [string, string][] = [];
    setTenantHooks({ onThread: async (u, t) => { indexed.push([u, t]); } });
    const subj = await runAsTenant(A, db, async () => tagSubject("[Sublet Sniper demo] Furnished 1BR"));
    expect(subj).toBe(`[Sublet Sniper demo] Furnished 1BR #${shortId(A)}`);
    expect(await runAsTenant(A, db, async () => ownsSubject(`Re: ${subj}`))).toBe(true);
    expect(await runAsTenant(B, db, async () => ownsSubject(`Re: ${subj}`))).toBe(false);
    expect(ownsSubject(subj)).toBe(false); // global session ignores tenant threads
    expect(ownsSubject("[Sublet Sniper demo] Furnished 1BR")).toBe(true);
    expect(tagSubject("x")).toBe("x");
    // Sending a first contact as A records the thread for webhook routing (mock threads are skipped).
    await runAsTenant(A, db, async () => {
      await resolveApproval("ap-x", true, undefined, { id: "ap-x", at: new Date().toISOString(), kind: "send_contact", listingId: "demo-mission-bay", title: "t", body: "hi", status: "pending", payload: { to: "landlord-demo@example.com", subject: "[Sublet Sniper demo] x" } });
      expect(state().threads[0].subject).toContain(`#${shortId(A)}`);
    });
    expect(indexed).toEqual([]); // mock mail: no AgentMail thread id to index
  });

  it("background work (mock call simulator) is saved when it settles", async () => {
    const db = memoryStore();
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    let settled!: Promise<void>;
    await runAsTenant(A, db, async () => {
      currentTenant()!.background.push(gate.then(() => { log("call", "call done"); }));
    }, { onBackground: (p) => { settled = p; } });
    expect(JSON.stringify(db.rows.get(A)?.record)).not.toContain("call done");
    release();
    await settled;
    expect(JSON.stringify(db.rows.get(A)?.record)).toContain("call done");
  });

  it("a failing store does not break the request", async () => {
    const bad: TenantStore = { load: async () => null, save: async () => { throw new Error("db down"); } };
    expect(await runAsTenant(A, bad, async () => 42)).toBe(42);
  });
});
