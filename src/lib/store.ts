import type { Criteria, RankedListing } from "./types";

export type TimelineKind = "search" | "scam" | "draft" | "email_out" | "email_in" | "calendar" | "decision" | "flag" | "info";
export interface TimelineItem { id: string; at: string; kind: TimelineKind; text: string }
export type ApprovalKind = "send_contact" | "open_craigslist_reply" | "book_viewing" | "decision";
export interface Approval {
  id: string; at: string; kind: ApprovalKind; listingId?: string; title: string; body: string;
  options?: string[]; payload?: Record<string, unknown>; status: "pending" | "approved" | "rejected" | "answered"; answer?: string;
}
export interface ThreadMsg { id?: string; from: "agent" | "landlord" | "system"; text: string; at: string; flagged?: string[] }
export interface Thread {
  id: string; listingId: string; listingTitle: string; landlordEmail: string; subject: string;
  messages: ThreadMsg[]; status: "awaiting_landlord" | "active" | "viewing_proposed" | "booked" | "flagged";
  agentmailThreadId?: string; lastMessageId?: string; askedProof: boolean; offeredSlots?: string[];
}
export interface ChatMsg { role: "user" | "assistant"; text: string; at: string }
export interface RenterProfile {
  name: string; email: string; occupation: string; moveIn: string; moveOut: string; maxBudget: number;
  pets: string; smoker: boolean; references: string; about: string;
}
export interface State {
  profile: RenterProfile; criteria: Criteria | null; results: RankedListing[]; flagged: RankedListing[]; analyzedId?: string | null;
  timeline: TimelineItem[]; approvals: Approval[]; threads: Thread[]; chat: ChatMsg[];
  searchReport: { mode: string; total: number; x: number; demo: number; perCategory: Record<string, number | string> } | null; seenMessageIds: string[]; events: { id: string; title: string; start: string; end: string; link?: string }[];
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
  return { profile: defaultProfile(), criteria: null, results: [], flagged: [], timeline: [], approvals: [], threads: [], chat: [], searchReport: null, seenMessageIds: [], events: [] };
}

const g = globalThis as unknown as { __sniper?: State };
export function state(): State { return (g.__sniper ??= fresh()); }
export function resetState() { g.__sniper = fresh(); }

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

export type SessionSnapshot = Pick<State, "criteria" | "results" | "flagged" | "timeline" | "approvals" | "chat" | "searchReport" | "events" | "analyzedId">;

/**
 * Serverless: each request may land on a fresh instance. The browser carries the newest session
 * snapshot it has seen and we adopt it when it is newer than ours. Mail threads are not part of it
 * (they are rebuilt from AgentMail). Sending is still gated by approvals + the allowlist server-side.
 */
export function hydrate(snap: unknown) {
  if (!snap || typeof snap !== "object") return;
  const x = snap as Partial<SessionSnapshot>;
  if (!Array.isArray(x.timeline) || !Array.isArray(x.chat) || !Array.isArray(x.results) || !Array.isArray(x.flagged) || !Array.isArray(x.approvals)) return;
  const s = state();
  if (version({ timeline: x.timeline, chat: x.chat }) <= version(s)) return;
  Object.assign(s, { criteria: x.criteria ?? null, results: x.results, flagged: x.flagged, timeline: x.timeline.slice(0, 200), approvals: x.approvals.slice(0, 50), chat: x.chat.slice(-60), searchReport: x.searchReport ?? null, events: Array.isArray(x.events) ? x.events : [], analyzedId: x.analyzedId ?? null });
}

export function publicState() {
  const s = state();
  return { ...s, seenMessageIds: undefined, version: version(s) };
}
