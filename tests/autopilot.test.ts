import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";

// Record every outbound email (mail itself stays in mock mode: MAIL_MODE=mock).
const sent = vi.hoisted(() => [] as string[]);
vi.mock("@/lib/mail", async (importOriginal) => {
  const m = await importOriginal<typeof import("@/lib/mail")>();
  return { ...m, sendMail: async (to: string, subject: string, text: string, replyTo?: string) => { sent.push(to); return m.sendMail(to, subject, text, replyTo); } };
});

import { chat } from "@/lib/agent";
import { hydrate, publicState, resetState, state } from "@/lib/store";
import { autopilotOutreach, contactListing, handleInbound, resolveApproval, setAutopilot } from "@/lib/tools";
import { autopilotView } from "@/lib/autopilot";
import { emailAllowed } from "@/lib/landlord";
import type { RankedListing } from "@/lib/types";

const SEARCH = "Busco 1BR amoblado en SF, menos de $4000, del 1/11 al 15/12";
const autoText = () => state().chat.filter((c) => c.auto).map((c) => c.text).join("\n");

describe("autopilot end to end (mock LLM, mail, calendar)", () => {
  beforeEach(() => { resetState(); sent.length = 0; });
  afterEach(() => vi.unstubAllEnvs());

  it("search -> one consent -> auto outreach -> counter -> deal -> booked, narrated in Spanish", async () => {
    const reply = await chat(SEARCH);
    const s = state();
    // Short reply: counts + one next step, never the listings as prose.
    expect(reply.split("\n").length).toBeLessThanOrEqual(2);
    expect(reply).toMatch(/Encontré \d+ lugares seguros y bloqueé \d+ estafas?\./);
    expect(reply).not.toMatch(/DEMO DATA|Caltrain/);
    // Undecided: exactly one consent approval, nothing sent yet.
    const consent = s.approvals.filter((a) => a.kind === "autopilot_consent");
    expect(consent).toHaveLength(1);
    expect(consent[0].options).toEqual(["Yes, go", "I'll approve each step"]);
    expect(autopilotView(s)).toMatchObject({ on: false, decided: false, stage: "consent" });
    expect(sent).toHaveLength(0);

    // "Yes, go": autopilot on and outreach starts immediately.
    await resolveApproval(consent[0].id, true, "Yes, go");
    expect(s.autopilot.on).toBe(true);
    expect(s.threads).toHaveLength(1);
    const t = s.threads[0];
    expect(t.listingId).toBe("demo-mission-bay");
    expect(t.auto).toBe(true);
    expect(sent).toEqual(["landlord-demo@example.com"]);
    expect(s.approvals.some((a) => a.kind === "send_contact")).toBe(false); // no per-message approval
    // Craigslist matches become ONE human step, never an email.
    const view = publicState().autopilot;
    const cl = view.needsYou.filter((n) => n.kind === "craigslist_replies");
    expect(cl).toHaveLength(1);
    const drafts = s.approvals.filter((a) => a.kind === "open_craigslist_reply" && a.status === "pending");
    expect(drafts.length).toBeGreaterThan(0);
    expect(cl[0].kind === "craigslist_replies" && cl[0].items.every((i) => /craigslist\.org/.test(i.url) && i.message.length > 50)).toBe(true);
    expect(view.stage).toBe("waiting");
    expect(view.now).toMatch(/Esperando respuesta/);
    expect(autoText()).toMatch(/Le escribí al dueño de "Furnished 1BR sublet near Caltrain"/);
    expect(autoText()).toMatch(/Craigslist/);

    // Landlord quotes a price: agent counters within budget and keeps asking for proof.
    await handleInbound({ from: t.landlordEmail, text: "Hi Nicolás! Yes, it's still available. It's $3,800/mo, fully furnished. Tell me a bit about yourself?", messageId: "ap1" });
    expect(t.messages.at(-1)!.text).toMatch(/would you do \$3,600\/mo/);
    expect(t.deal).toMatchObject({ asked: 3800, offered: 3600 });
    expect(autopilotView(s).stage).toBe("negotiating");
    expect(autoText()).toMatch(/pide \$3,800\/mes\. Le contraofrecí \$3,600\/mes/);

    // Landlord accepts and proposes a window: first free slot is booked, one confirmation email, no approval.
    const before = sent.length;
    await handleInbound({ from: t.landlordEmail, text: "Ok, $3,600 works. Video tour Monday after 5pm?", messageId: "ap2" });
    expect(sent.length - before).toBe(1);
    expect(t.status).toBe("booked");
    expect(s.events).toHaveLength(1);
    expect(s.approvals.some((a) => a.kind === "book_viewing")).toBe(false);
    expect(t.messages.at(-1)!.text).toMatch(/^Deal at \$3,600\/mo, thank you!/);
    expect(t.messages.at(-1)!.text).toMatch(/Mon, (Oct|Nov) \d+, 5:30\sPM PT works/);
    const v2 = autopilotView(s);
    expect(v2).toMatchObject({ stage: "booked" });
    expect(v2.stats.savedPerMonth).toBe(200);
    expect(autoText()).toMatch(/Te conseguí \$200\/mes de descuento/);
    expect(autoText()).toMatch(/Visita agendada lunes \d+ (oct|nov), 5:30 PM PT/);

    // Later money-before-viewing: refused, flagged, booking stays visible, autopilot decides (no question to the user).
    await handleInbound({ from: t.landlordEmail, text: "Actually I'm out of the country, please Zelle the deposit today to hold it.", messageId: "ap3" });
    expect(t.status).toBe("booked");
    expect(t.messages.at(-1)!.text).toMatch(/don't send any deposit/);
    expect(s.approvals.some((a) => a.kind === "decision" && a.status === "pending")).toBe(false);
    expect(autoText()).toMatch(/🚩 El dueño de "Furnished 1BR sublet near Caltrain" dice que está fuera del país\. Me negué/);

    // Each milestone is narrated exactly once, and every email went to the allowlist.
    expect(autoText().match(/Te conseguí/g)).toHaveLength(1);
    expect(sent.every(emailAllowed)).toBe(true);
  }, 30000);

  it("AUTOPILOT=1: consent given up front, outreach starts with the search and the reply says so", async () => {
    vi.stubEnv("AUTOPILOT", "1");
    resetState();
    const reply = await chat(SEARCH);
    expect(reply).toMatch(/Ya le estoy escribiendo al dueño del #\d\./);
    expect(state().approvals.some((a) => a.kind === "autopilot_consent")).toBe(false);
    expect(state().threads).toHaveLength(1);
    // Off switch: back to per-message approvals.
    await chat("Apagá el piloto automático");
    expect(state().autopilot.on).toBe(false);
    expect(publicState().autopilot.stage).toBe("paused");
  }, 30000);

  it("REQUIRE_BOOKING_APPROVAL=1 still applies under autopilot: one confirm step, then booked", async () => {
    vi.stubEnv("AUTOPILOT", "1");
    vi.stubEnv("REQUIRE_BOOKING_APPROVAL", "1");
    resetState();
    await chat(SEARCH);
    const s = state(), t = s.threads[0];
    await handleInbound({ from: t.landlordEmail, text: "Yes it's available! Video tour Monday after 5pm?", messageId: "rb1" });
    expect(s.events).toHaveLength(0);
    const v = autopilotView(s);
    expect(v.stage).toBe("scheduling");
    const confirm = v.needsYou.find((n) => n.kind === "confirm_booking");
    expect(confirm).toBeTruthy();
    expect(autoText()).toMatch(/aceptó lunes \d+ (oct|nov), 5:30 PM PT\. Confirmalo/);
    await resolveApproval(confirm!.kind === "confirm_booking" ? confirm!.approvalId : "", true);
    expect(t.status).toBe("booked");
    expect(autoText()).toMatch(/Visita agendada/);
  }, 30000);

  it("autopilot survives serverless via the session snapshot", async () => {
    await chat(SEARCH);
    await setAutopilot(true);
    const snap = JSON.parse(JSON.stringify(publicState()));
    resetState();
    expect(state().autopilot.on).toBe(false);
    hydrate(snap);
    expect(state().autopilot.on).toBe(true);
    expect(state().autopilot.narrated.length).toBeGreaterThan(0);
  }, 30000);
});

describe("autopilot safety", () => {
  beforeEach(() => { resetState(); sent.length = 0; });

  it("never emails a non-allowlisted address and never auto-contacts Craigslist", async () => {
    await chat(SEARCH); // undecided: nothing sent
    const s = state();
    const base = s.results.find((r) => r.source === "craigslist")!;
    const demo = s.results.find((r) => r.id === "demo-mission-bay")!;
    const green = { light: "green" as const, score: 0, reasons: [] };
    // A Craigslist listing that (somehow) carries an allowlisted email, and a demo listing with a real person's email.
    const clWithEmail: RankedListing = { ...base, id: "cl-trap", scam: green, demo: { kind: "accomplice", landlordEmail: "landlord-demo@example.com", note: "trap" } };
    const realPerson: RankedListing = { ...demo, id: "demo-real-person", demo: { kind: "accomplice", landlordEmail: "real.landlord@gmail.com", note: "trap" } };
    s.results = [clWithEmail, realPerson];
    s.approvals = [];

    await setAutopilot(true);
    await autopilotOutreach();
    await contactListing({ id: "cl-trap" });
    await contactListing({ id: "demo-real-person" });

    expect(sent).toEqual([]);
    expect(s.threads).toHaveLength(0);
    // Craigslist became a human-send draft; the real person got nothing at all.
    expect(s.approvals.filter((a) => a.listingId === "cl-trap").map((a) => a.kind)).toEqual(["open_craigslist_reply"]);
    expect(s.approvals.some((a) => a.listingId === "demo-real-person" && a.kind === "send_contact")).toBe(false);
    // Approving the Craigslist draft only hands back the URL to open; still no email.
    const d = s.approvals.find((a) => a.listingId === "cl-trap")!;
    expect(await resolveApproval(d.id, true)).toMatchObject({ ok: true, openUrl: base.url });
    expect(sent).toEqual([]);
  }, 30000);
});
