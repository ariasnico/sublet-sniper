import type { Criteria, RankedListing } from "./types";
import { autopilotView, defaultAutopilot, sanitizeAutopilot, type AutopilotStore } from "./autopilot";

export type TimelineKind = "search" | "scam" | "draft" | "email_out" | "email_in" | "calendar" | "decision" | "flag" | "info" | "call";
export interface TimelineItem { id: string; at: string; kind: TimelineKind; text: string }
export type ApprovalKind = "send_contact" | "open_craigslist_reply" | "book_viewing" | "decision" | "autopilot_consent";
export interface Approval {
  id: string; at: string; kind: ApprovalKind; listingId?: string; title: string; body: string;
  options?: string[]; payload?: Record<string, unknown>; status: "pending" | "approved" | "rejected" | "answered"; answer?: string;
}
export interface ThreadMsg { id?: string; from: "agent" | "landlord" | "system"; text: string; at: string; flagged?: string[]; channel?: "email" | "call" }
/** One phone call to a demo landlord (ElevenLabs outbound call, browser session, or the mock simulator). */
export interface CallRecord {
  id: string; threadId: string; amThreadId?: string; listingId: string; listingTitle: string; to: string;
  mode: "elevenlabs" | "browser" | "mock"; status: "calling" | "done" | "failed" | "no_answer";
  conversationId?: string; startedAt: string; endedAt?: string;
  /** Live (mock) or final transcript. */
  transcript: ThreadMsg[]; summary?: string;
  /** Set by the book_viewing tool during the call. */
  agreed?: number; viewingStart?: string; asked?: number; offered?: number; flags?: string[]; error?: string;
}
export interface Thread {
  id: string; listingId: string; listingTitle: string; landlordEmail: string; subject: string;
  messages: ThreadMsg[]; status: "awaiting_landlord" | "active" | "viewing_proposed" | "booked" | "flagged";
  agentmailThreadId?: string; lastMessageId?: string; askedProof: boolean; offeredSlots?: string[];
  /** Price negotiation: first/highest asked price, our counter, and the agreed price once the landlord accepts. */
  deal?: { asked: number; offered: number | null; agreed?: number };
  /** True when autopilot (not a per-message approval) sent the first email. */
  auto?: boolean;
}
/** auto: proactive autopilot narration (not a reply to a user message). */
export interface ChatMsg { role: "user" | "assistant"; text: string; at: string; auto?: boolean }
export interface RenterProfile {
  name: string; email: string; occupation: string; moveIn: string; moveOut: string; maxBudget: number;
  pets: string; smoker: boolean; references: string; about: string;
}
export interface State {
  profile: RenterProfile; criteria: Criteria | null; results: RankedListing[]; flagged: RankedListing[]; analyzedId?: string | null;
  timeline: TimelineItem[]; approvals: Approval[]; threads: Thread[]; chat: ChatMsg[];
  searchReport: { mode: string; total: number; x: number; demo: number; perCategory: Record<string, number | string> } | null; seenMessageIds: string[]; events: { id: string; title: string; start: string; end: string; link?: string }[];
  autopilot: AutopilotStore;
  calls: CallRecord[];
}

export function defaultProfile(): RenterProfile {
  return {
    name: process.env.RENTER_NAME || "Nicolás Arias",
    email: process.env.RENTER_EMAIL || process.env.AGENTMAIL_INBOX_ID || "sublet-sniper@agentmail.to",
    occupation: "Software founder in SF for a 6-week work stint (Puentes hackathon + customer meetings)",
    moveIn: "2026-11-01", moveOut: "2026-12-15", maxBudget: 4000, pets: "no pets", smoker: false,
    references: "Previous landlord reference and employer letter available on request",
    about: "Quiet, tidy, works mostly at client offices. Can pay via bank-verifiable methods with a written lease or sublease addendum.",
  };
}

function fresh(): State {
  return { profile: defaultProfile(), criteria: null, results: [], flagged: [], timeline: [], approvals: [], threads: [], chat: [], searchReport: null, seenMessageIds: [], events: [], autopilot: defaultAutopilot(), calls: [] };
}

const g = globalThis as unknown as { __sniper?: State };
export function state(): State { return (g.__sniper ??= fresh()); }
export function resetState() { g.__sniper = fresh(); epoch.bornAt = new Date().toISOString(); }

/**
 * Serverless: Reset only reaches one instance. The browser sends the time of its last Reset with every
 * request; an instance whose session predates it starts fresh instead of serving the old conversation.
 */
const epoch = (globalThis as unknown as { __sniperEpoch?: { bornAt: string } }).__sniperEpoch ??= { bornAt: "" };
(globalThis as unknown as { __sniperEpoch?: { bornAt: string } }).__sniperEpoch = epoch;
/** Start of the current session (last Reset seen by this instance); "" if unknown. */
export const sessionStart = () => epoch.bornAt;
export function ensureEpoch(resetAt: unknown) {
  if (typeof resetAt !== "string" || !resetAt || resetAt <= epoch.bornAt) return;
  const s = state();
  const stale = s.chat.some((c) => c.at < resetAt) || s.timeline.some((t) => t.at < resetAt);
  if (stale) g.__sniper = fresh();
  epoch.bornAt = resetAt;
}

let n = 0;
export const uid = (p: string) => `${p}-${Date.now().toString(36)}-${(n++).toString(36)}`;
export const now = () => new Date().toISOString();
export function log(kind: TimelineKind, text: string) {
  state().timeline.unshift({ id: uid("t"), at: now(), kind, text });
}
export function findListing(id: string): RankedListing | undefined {
  const s = state();
  return s.results.find((r) => r.id === id) ?? s.flagged.find((r) => r.id === id);
}

/** Monotonic-ish version of the session (newest timeline/chat timestamp). */
export function version(s: Pick<State, "timeline" | "chat">): string {
  const a = s.timeline[0]?.at ?? "";
  const b = s.chat[s.chat.length - 1]?.at ?? "";
  return a > b ? a : b;
}

export type SessionSnapshot = Pick<State, "criteria" | "results" | "flagged" | "timeline" | "approvals" | "chat" | "searchReport" | "events" | "analyzedId" | "autopilot" | "calls">;

/**
 * Serverless: each request may land on a fresh instance. The browser carries the newest session
 * snapshot it has seen and we adopt it when it is newer than ours. Mail threads are not part of it
 * (they are rebuilt from AgentMail). Sending is still gated by approvals + the allowlist server-side.
 */
export function hydrate(snap: unknown) {
  if (!snap || typeof snap !== "object") return;
  ensureEpoch((snap as { resetAt?: unknown }).resetAt);
  const x = snap as Partial<SessionSnapshot>;
  if (!Array.isArray(x.timeline) || !Array.isArray(x.chat) || !Array.isArray(x.results) || !Array.isArray(x.flagged) || !Array.isArray(x.approvals)) return;
  const s = state();
  // Calls live on whichever instance started them: always merge the browser's copy so any instance can finish them.
  s.calls = mergeCalls(s.calls, (snap as { calls?: unknown }).calls);
  if (version({ timeline: x.timeline, chat: x.chat }) <= version(s)) return;
  Object.assign(s, { criteria: x.criteria ?? null, results: x.results, flagged: x.flagged, timeline: x.timeline.slice(0, 200), approvals: x.approvals.slice(0, 50), chat: x.chat.slice(-60), searchReport: x.searchReport ?? null, events: Array.isArray(x.events) ? x.events : [], analyzedId: x.analyzedId ?? null, autopilot: sanitizeAutopilot(x.autopilot) ?? s.autopilot, calls: mergeCalls(s.calls, x.calls) });
}

/** Calls ride in the snapshot; a call this instance knows better (finished here) wins over the carried copy. */
export function mergeCalls(mine: CallRecord[], carried: unknown): CallRecord[] {
  if (!Array.isArray(carried)) return mine;
  const out = new Map<string, CallRecord>();
  for (const c of carried as CallRecord[]) if (c && typeof c.id === "string" && Array.isArray(c.transcript)) out.set(c.id, c);
  for (const c of mine) { const o = out.get(c.id); if (!o || o.status === "calling" || c.status !== "calling") out.set(c.id, c); }
  return [...out.values()].slice(-10);
}

export function publicState() {
  const s = state();
  return { ...s, seenMessageIds: undefined, version: version(s), autopilot: autopilotView(s) };
}
