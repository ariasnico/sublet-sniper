import { detectRedFlags, flagShort, rentIn, stripQuoted } from "./landlord";
import { fmtLA } from "./time";
import type { Approval, State, Thread } from "./store";

/**
 * AUTOPILOT: once the user consents (one approval, or AUTOPILOT=1), the agent searches, emails allowlisted demo
 * landlords without per-message approval, negotiates, asks for proof, refuses money-before-viewing and books the
 * first free slot. Real Craigslist/X landlords are NEVER contacted automatically: their drafts are batched into one
 * "open Craigslist and click Reply" step for the human. This module only derives the UI view and the short English
 * narration from state; it never sends anything.
 */

/** Persisted part (rides in the session snapshot so it survives serverless). */
export interface AutopilotStore {
  on: boolean;
  /** false until the user answered the one-time consent (or AUTOPILOT=1/0 decided it up front). */
  decided: boolean;
  consentAt: string | null;
  /** Session start: only activity after this is narrated / counted (AgentMail keeps older demo threads). */
  since: string;
  /** Milestone keys already narrated in chat (dedupe across instances and catch-up). */
  narrated: string[];
}

export type AutopilotStage = "idle" | "consent" | "outreach" | "waiting" | "negotiating" | "scheduling" | "booked" | "paused";

export interface CraigslistDraft { approvalId: string; listingId?: string; title: string; url: string; message: string }
export type NeedsYouItem =
  | { kind: "autopilot_consent"; approvalId: string; title: string; options: string[] }
  | { kind: "craigslist_replies"; title: string; body: string; approvalIds: string[]; items: CraigslistDraft[] }
  | { kind: "confirm_booking"; approvalId: string; title: string; body: string }
  | { kind: "approve_send"; approvalId: string; title: string; body: string }
  | { kind: "decision"; approvalId: string; title: string; options: string[] };

export interface AutopilotView extends AutopilotStore {
  stage: AutopilotStage;
  /** What the agent is doing right now (one short line). */
  now: string;
  /** What happens next (one short line). */
  next: string;
  needsYou: NeedsYouItem[];
  stats: { contacted: number; replies: number; craigslistDrafts: number; booked: number; scamsBlocked: number; savedPerMonth: number };
}

export const CONSENT_YES = "Yes, go";
export const CONSENT_NO = "I'll approve each step";

export function defaultAutopilot(): AutopilotStore {
  const env = process.env.AUTOPILOT; // "1" on (consent given up front), "0" off, unset: ask once after the first search
  const at = new Date().toISOString();
  return { on: env === "1", decided: env === "1" || env === "0", consentAt: env === "1" ? at : null, since: at, narrated: [] };
}

export function sanitizeAutopilot(x: unknown): AutopilotStore | null {
  if (!x || typeof x !== "object") return null;
  const a = x as Partial<AutopilotStore>;
  if (typeof a.on !== "boolean") return null;
  return { on: a.on, decided: typeof a.decided === "boolean" ? a.decided : true, consentAt: typeof a.consentAt === "string" ? a.consentAt : null,
    since: typeof a.since === "string" ? a.since : new Date(0).toISOString(), narrated: Array.isArray(a.narrated) ? a.narrated.map(String).slice(-300) : [] };
}

// ---------------- helpers ----------------
const LABEL = /\b(Sun|Mon|Tue|Wed|Thu|Fri|Sat), (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{1,2}), (\d{1,2}:\d\d)\s?([AP]M) PT/;
/** "Mon, Oct 26, 5:30 PM PT" (anywhere in text) -> "Mon Oct 26, 5:30 PM". */
export function shortWhen(text: string): string | null {
  const m = text.match(LABEL);
  return m ? `${m[1]} ${m[2]} ${m[3]}, ${m[4]} ${m[5]}` : null;
}
const usd = (n: number) => `$${n.toLocaleString("en-US")}`;
const tkey = (t: Thread) => t.agentmailThreadId ?? t.id;
const after = (at: string | undefined, since: string) => { const a = Date.parse(at ?? ""), b = Date.parse(since); return Number.isNaN(a) || Number.isNaN(b) || a >= b - 1000; };
const COUNTER = /would you do \$([\d,]+)\/mo/i;
const DEAL = /\bDeal(?:,| at) \$([\d,]+)\/mo/;
const SLOTS = /\n1\) /;
const BOOKED = /on my calendar|Confirmed: see you/i;
const num = (s: string) => Number(s.replace(/,/g, ""));

/** Threads with activity in this session. */
export function liveThreads(s: State): Thread[] {
  return s.threads.filter((t) => t.messages.some((m) => after(m.at, s.autopilot.since)));
}

/** Negotiation outcome: stored on the thread, else re-derived from the email text (cold serverless instance). */
export function dealOf(t: Thread): { asked: number; offered: number | null; agreed?: number } | null {
  if (t.deal) return t.deal;
  let asked = 0, offered: number | null = null, agreed: number | undefined;
  for (const m of t.messages) {
    if (m.from === "landlord") { const p = rentIn(stripQuoted(m.text)); if (p && agreed == null) asked = Math.max(asked, p); }
    else if (m.from === "agent") {
      const c = m.text.match(COUNTER); if (c) offered = num(c[1]);
      const d = m.text.match(DEAL); if (d) agreed = num(d[1]);
    }
  }
  return asked || offered ? { asked: asked || (agreed ?? offered ?? 0), offered, agreed } : null;
}

const pendingOf = (s: State, kind: Approval["kind"]) => s.approvals.filter((a) => a.status === "pending" && a.kind === kind);
const bookingApproval = (s: State, t: Thread) => pendingOf(s, "book_viewing").find((a) => a.payload?.threadId === t.id || (!!t.agentmailThreadId && a.payload?.amThreadId === t.agentmailThreadId));

// ---------------- milestones + narration ----------------
export interface Milestone { key: string; text: string }

/** Every narratable milestone, derived from state only (so a cold instance can catch up from AgentMail threads). */
export function milestones(s: State): Milestone[] {
  const out: Milestone[] = [];
  const since = s.autopilot.since;
  for (const t of liveThreads(s)) {
    const k = tkey(t);
    const deal = dealOf(t);
    let firstAgent = true;
    t.messages.forEach((m, i) => {
      const mid = m.id ?? String(i);
      if (m.channel === "call") return; // phone turns are narrated by voice.ts ("📞 Call done: ...")
      if (!after(m.at, since)) { if (m.from === "agent") firstAgent = false; return; }
      if (m.from === "landlord") {
        const flags = detectRedFlags(stripQuoted(m.text));
        if (flags.length) out.push({ key: `flag:${k}:${mid}`, text: `🚩 ${flagShort(flags[0])}. Refused${flags.some((f) => /out of the country|wire|gift cards|keys by mail/i.test(f)) ? ", dropped it" : ""}.` });
        return;
      }
      if (m.from !== "agent") return;
      if (firstAgent) { firstAgent = false; out.push({ key: `contact:${k}`, text: "✉️ Emailed the landlord." }); return; }
      const c = m.text.match(COUNTER);
      if (c) out.push({ key: `counter:${k}:${num(c[1])}`, text: `💬 Offered ${usd(num(c[1]))}/mo (asked ${usd(deal?.asked ?? num(c[1]))}).` });
      const d = m.text.match(DEAL);
      if (d) {
        const agreed = num(d[1]), saved = Math.max(0, (deal?.asked ?? agreed) - agreed);
        out.push({ key: `deal:${k}`, text: saved > 0 ? `💸 Saved ${usd(saved)}/mo.` : `🤝 Deal at ${usd(agreed)}/mo.` });
      }
      if (SLOTS.test(m.text)) out.push({ key: `slots:${k}:${mid}`, text: "🗓️ Sent viewing times." });
      if (BOOKED.test(m.text) && !/^Thanks for the call!/.test(m.text)) {
        const when = shortWhen(m.text) ?? "";
        if (bookingApproval(s, t)) out.push({ key: `accept:${k}`, text: `✅ Landlord picked ${when || "a time"}. Confirm to book.` });
        else if (t.status === "booked" || process.env.REQUIRE_BOOKING_APPROVAL !== "1") {
          const ev = s.events.find((e) => e.title.includes(t.listingTitle));
          out.push({ key: `booked:${k}`, text: `📅 Viewing: ${(ev ? shortWhen(fmtLA(ev.start)) : null) ?? when}.` });
        }
      }
    });
  }
  const drafts = pendingOf(s, "open_craigslist_reply").filter((a) => a.payload?.autopilot && after(a.at, since));
  if (drafts.length) out.push({ key: `cl:${drafts.map((a) => a.id).sort().join(",")}`,
    text: `📋 ${drafts.length} Craigslist ${drafts.length === 1 ? "reply" : "replies"} ready (optional).` });
  return out;
}

/**
 * Posts one proactive chat message with every milestone not narrated yet. Skips when autopilot is off or when this
 * instance has no session (cold serverless instance: the hydrated poll instance catches up later).
 */
export function narrate(s: State): string | null {
  if (!s.autopilot.on || !s.criteria) return null;
  const fresh = milestones(s).filter((m) => !s.autopilot.narrated.includes(m.key));
  if (!fresh.length) return null;
  s.autopilot.narrated = [...s.autopilot.narrated, ...fresh.map((m) => m.key)].slice(-300);
  const text = fresh.map((m) => m.text).join("\n");
  s.chat.push({ role: "assistant", text, at: new Date().toISOString(), auto: true });
  return text;
}

/** Marks every current milestone as told (used when autopilot is switched on mid-session, so it doesn't replay history). */
export function markNarrated(s: State) {
  s.autopilot.narrated = [...new Set([...s.autopilot.narrated, ...milestones(s).map((m) => m.key)])].slice(-300);
}

// ---------------- UI view ----------------
export function needsYou(s: State): NeedsYouItem[] {
  const out: NeedsYouItem[] = [];
  for (const a of pendingOf(s, "autopilot_consent")) out.push({ kind: "autopilot_consent", approvalId: a.id, title: a.title, options: a.options ?? [CONSENT_YES, CONSENT_NO] });
  const cl = pendingOf(s, "open_craigslist_reply");
  if (cl.length) out.push({ kind: "craigslist_replies", title: "Reply on Craigslist",
    body: `${cl.length} ${cl.length === 1 ? "draft" : "drafts"} ready.`,
    approvalIds: cl.map((a) => a.id), items: cl.map((a) => ({ approvalId: a.id, listingId: a.listingId, title: a.title, url: String(a.payload?.url ?? ""), message: a.body })) });
  for (const a of pendingOf(s, "book_viewing")) out.push({ kind: "confirm_booking", approvalId: a.id, title: a.title, body: a.body });
  for (const a of pendingOf(s, "send_contact")) out.push({ kind: "approve_send", approvalId: a.id, title: a.title, body: a.body });
  for (const a of pendingOf(s, "decision")) out.push({ kind: "decision", approvalId: a.id, title: a.title, options: a.options ?? ["Yes", "No"] });
  return out;
}

export function autopilotView(s: State): AutopilotView {
  const ap = s.autopilot;
  const threads = liveThreads(s);
  const deals = threads.map(dealOf).filter((d): d is NonNullable<typeof d> => !!d);
  const stats = {
    contacted: threads.length, replies: threads.reduce((n, t) => n + t.messages.filter((m) => m.from === "landlord" && after(m.at, ap.since)).length, 0),
    craigslistDrafts: pendingOf(s, "open_craigslist_reply").length, booked: Math.max(s.events.length, threads.filter((t) => t.status === "booked").length),
    scamsBlocked: s.flagged.length + threads.filter((t) => t.status === "flagged" || t.messages.some((m) => m.from === "landlord" && detectRedFlags(stripQuoted(m.text)).length)).length,
    savedPerMonth: deals.reduce((n, d) => n + (d.agreed != null ? Math.max(0, d.asked - d.agreed) : 0), 0),
  };
  const ny = needsYou(s);
  const base = { ...ap, needsYou: ny, stats };
  const live = threads.filter((t) => t.status !== "flagged");
  const v = (stage: AutopilotStage, now: string, next: string): AutopilotView => ({ ...base, stage, now, next });

  // Now/Next stay at 8 words or fewer: the mission strip shows counts, the deal card shows the listing.
  if (!s.criteria && !s.results.length) return v(ap.on ? "idle" : ap.decided ? "paused" : "idle", "Waiting for your request.", "Tell me area, budget and dates.");
  if (ny.some((x) => x.kind === "autopilot_consent")) return v("consent", "Pick one to go after.", "Email, negotiate and book for you.");
  if (!ap.on) return v("paused", "Autopilot off. I ask first.", "Turn it on to go hands-free.");
  const booked = threads.find((t) => t.status === "booked") ?? (s.events.length ? threads[0] : undefined);
  if (booked || s.events.length) {
    const ev = s.events[0];
    return v("booked", `Viewing booked${ev ? `: ${shortWhen(fmtLA(ev.start)) ?? fmtLA(ev.start)}` : ""}.`, "Pay nothing before you see it.");
  }
  const toConfirm = live.find((t) => bookingApproval(s, t));
  if (toConfirm) return v("scheduling", "Landlord picked a time.", "Confirm to book it.");
  const proposed = live.find((t) => t.status === "viewing_proposed");
  if (proposed) return v("scheduling", "Sent viewing times.", "Book the one they pick.");
  const talking = live.find((t) => t.status === "active");
  if (talking) {
    const d = dealOf(talking);
    return v("negotiating", d?.offered && d.agreed == null ? `Offered ${usd(d.offered)}/mo. Waiting on landlord.` : "Talking with the landlord.", "Get proof, then book.");
  }
  const waiting = live.filter((t) => t.status === "awaiting_landlord");
  if (waiting.length) return v("waiting", `Waiting on ${waiting.length === 1 ? "the landlord" : `${waiting.length} landlords`}.`, `Negotiate under ${usd(s.profile.maxBudget)}, then book.`);
  const refused = threads.find((t) => t.status === "flagged" && t.messages[t.messages.length - 1]?.from === "agent");
  if (refused) {
    const d = dealOf(refused);
    return v("negotiating", `Refused deposit${d?.offered ? `, offered ${usd(d.offered)}` : ""}. Waiting.`, "Book if they drop the deposit.");
  }
  if (stats.craigslistDrafts) return v("outreach", `${stats.craigslistDrafts} Craigslist replies drafted.`, "Click Reply on each.");
  if (threads.some((t) => t.status === "flagged")) return v("outreach", "Dropped a scammy landlord.", "Widen area or budget?");
  return v("outreach", `${s.results.length} safe options ready.`, "Say go and I email them.");
}
