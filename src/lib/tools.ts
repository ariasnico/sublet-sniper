import { parseCriteria } from "./criteria";
import { searchListings } from "./search";
import { fetchListingPage, snapshotListings } from "./sources/craigslist";
import { normalizeHeuristic } from "./normalize";
import { rankListings } from "./rank";
import { llmNormalize } from "./llm-normalize";
import { llmProvider } from "./config";
import { proposeSlots, bookViewing, slotInWindow, type Slot } from "./calendar";
import { sendMail } from "./mail";
import { syncThreads } from "./mailsync";
import { emailAllowed, firstContact, parseWindow, planReply, writeReply, detectRedFlags, acceptsOffer, rentIn, stripQuoted } from "./landlord";
import { CONSENT_NO, CONSENT_YES, autopilotView, markNarrated, narrate } from "./autopilot";
import { fmtLA } from "./time";
import { findListing, log, now, state, uid, type Approval, type Thread } from "./store";
import { PLACES } from "./geo";
import type { Criteria, ListingType, RankedListing, RawListing } from "./types";
import type { ToolDef } from "./llm";

export const TOOL_DEFS: ToolDef[] = [
  { name: "analyze_listing_url", description: "Fetch ONE Craigslist listing URL the user pasted and scam-check it (price vs neighborhood median, keywords, duplicate text/photos). Always use this when the user sends a listing link.", parameters: { type: "object", properties: { url: { type: "string" } }, required: ["url"] } },
  { name: "search_listings", description: "Search live Craigslist SF (sublets, rooms, apartments; snapshot fallback) plus the X snapshot and demo fixtures. Normalizes, scam-scores and ranks. Returns top results and red-flagged listings.",
    parameters: { type: "object", properties: {
      query: { type: "string", description: "The user's request in their own words" },
      maxBudget: { type: "number" }, types: { type: "array", items: { type: "string", enum: ["room", "studio", "1br", "2br", "3br+"] } },
      furnished: { type: "boolean" }, from: { type: "string", description: "YYYY-MM-DD" }, to: { type: "string" },
      near: { type: "array", items: { type: "string" }, description: `Places, e.g. ${PLACES.map((p) => p.name).join(", ")}` }, maxKm: { type: "number" } }, required: ["query"] } },
  { name: "normalize_listing", description: "Re-normalize one listing with the LLM (price period, type, dates) when the heuristic looks off.", parameters: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },
  { name: "rank_listings", description: "Re-rank the current results with changed criteria (budget, type, furnished, dates, near, maxKm).", parameters: { type: "object", properties: { maxBudget: { type: "number" }, furnished: { type: "boolean" }, near: { type: "array", items: { type: "string" } }, maxKm: { type: "number" } } } },
  { name: "score_scam", description: "Explain the scam traffic light (green/yellow/red) and reasons for one listing.", parameters: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },
  { name: "draft_contact", description: "Contact one listing's landlord. With autopilot ON an allowlisted demo landlord is emailed right away; otherwise the message goes to the approvals queue. Craigslist/X listings always become a draft the human sends via Reply.", parameters: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },
  { name: "propose_slots", description: "Get the next free viewing slots from the user's calendar.", parameters: { type: "object", properties: {} } },
  { name: "book_viewing", description: "Request approval to book a viewing for a landlord thread at a slot (ISO start).", parameters: { type: "object", properties: { threadId: { type: "string" }, start: { type: "string" } }, required: ["threadId", "start"] } },
  { name: "ask_owner_decision", description: "Ask the owner a decision question (only for real decisions). Appears in the approvals queue.", parameters: { type: "object", properties: { question: { type: "string" }, options: { type: "array", items: { type: "string" } } }, required: ["question"] } },
  { name: "get_status", description: "Current threads, pending approvals, booked viewings and the autopilot state (stage, now, next, needsYou).", parameters: { type: "object", properties: {} } },
  { name: "set_autopilot", description: "Turn autopilot on/off when the user asks (e.g. 'encargate de todo' = on, 'apagá el piloto automático' / 'I'll approve each step' = off). On: emails allowlisted demo landlords, negotiates and books without per-message approval; Craigslist stays human-sent.", parameters: { type: "object", properties: { on: { type: "boolean" } }, required: ["on"] } },
];

export function brief(r: RankedListing) {
  return { id: r.id, title: r.title, source: r.source, price: r.priceMonthly, type: r.type, hood: r.neighborhood ?? r.hood, furnished: r.furnished,
    dates: [r.availableFrom, r.availableTo], km: r.distanceKm == null ? null : Math.round(r.distanceKm * 10) / 10, score: r.score, light: r.scam.light,
    scamReasons: r.scam.reasons.slice(0, 3), fit: r.fit.slice(0, 4), demo: r.demo?.kind ?? null, url: r.url };
}

function str(x: unknown): string | null { return typeof x === "string" && x.trim() ? x : null; }
function num(x: unknown): number | null { return typeof x === "number" && Number.isFinite(x) ? x : null; }

function mergeCriteria(base: Criteria, input: Record<string, unknown>): Criteria {
  const c = { ...base };
  const b = num(input.maxBudget); if (b) c.maxBudget = b;
  if (Array.isArray(input.types) && input.types.length) c.types = input.types.filter((t): t is ListingType => typeof t === "string" && ["room", "studio", "1br", "2br", "3br+"].includes(t));
  if (typeof input.furnished === "boolean") c.furnished = input.furnished;
  c.from = str(input.from) ?? c.from; c.to = str(input.to) ?? c.to;
  if (Array.isArray(input.near) && input.near.length) {
    const near = input.near.map((n) => parseCriteria(`near ${String(n)}`).near).flat();
    if (near.length) c.near = near;
  }
  const k = num(input.maxKm); if (k) c.maxKm = k;
  return c;
}

export async function toolSearch(input: Record<string, unknown>) {
  const s = state();
  const c = mergeCriteria(parseCriteria(str(input.query) ?? ""), input);
  // The LLM sometimes drops the budget on follow-up searches: keep the last known one.
  if (!c.maxBudget) c.maxBudget = s.criteria?.maxBudget ?? [...s.chat].reverse().map((m) => m.role === "user" ? parseCriteria(m.text).maxBudget : null).find((b) => b) ?? null;
  if (c.maxBudget) s.profile.maxBudget = c.maxBudget;
  if (c.from) s.profile.moveIn = c.from;
  if (c.to) s.profile.moveOut = c.to;
  const out = await searchListings(c);
  const { flagged, report } = out;
  const results = out.results.filter((r) => !c.maxBudget || r.priceMonthly == null || r.priceMonthly <= c.maxBudget * 1.1);
  s.criteria = c; s.results = results; s.flagged = flagged; s.searchReport = report;
  log("search", `Searched ${report.total} listings (Craigslist ${report.mode}, ${report.x} X posts, ${report.demo} demo). ${results.length} shown, ${flagged.length} flagged red.`);
  for (const f of flagged.slice(0, 2)) log("scam", `RED: "${f.title}" ${f.scam.reasons.slice(0, 2).join("; ")}`);
  return { criteria: c, mode: report.mode, top: results.slice(0, 6).map(brief), flagged: flagged.slice(0, 3).map(brief), safeCount: results.length, scamsBlocked: flagged.length,
    replyGuide: "The cards already show the listings: do NOT list them. Reply in at most 2 short lines: how many safe places, how many scams blocked, and one next step." };
}

export const CL_URL = /https?:\/\/[a-z.]*craigslist\.org\/[^\s)>"']+/i;

/** Fetches and scam-scores one pasted Craigslist listing; pins it on top of the board with its score. */
export async function toolAnalyzeUrl(input: Record<string, unknown>, fetcher: (url: string) => Promise<RawListing> = fetchListingPage) {
  const s = state();
  const url = str(input.url)?.match(CL_URL)?.[0];
  if (!url) return { error: "not a Craigslist listing URL" };
  let raw: RawListing;
  try { raw = await fetcher(url); } catch (e) { log("info", `Couldn't fetch ${url}: ${(e as Error).message}`); return { error: `couldn't fetch listing (${(e as Error).message})` }; }
  const corpus = [...s.results, ...s.flagged, ...snapshotListings().map(normalizeHeuristic)];
  const [ranked] = rankListings([normalizeHeuristic(raw), ...corpus.filter((x) => x.id !== raw.id)], parseCriteria("")).filter((x) => x.id === raw.id);
  if (!ranked) return { error: "listing is outside San Francisco" };
  const l: RankedListing = { ...ranked, fit: [`analyzed from your link${raw.address ? ` · ${raw.address}` : ""}`, ...(raw.images?.length ? [`${raw.images.length} photos checked`] : [])] };
  s.results = [l, ...s.results.filter((x) => x.id !== l.id)];
  if (l.scam.light === "red") s.flagged = [l, ...s.flagged.filter((x) => x.id !== l.id)];
  s.analyzedId = l.id;
  log(l.scam.light === "red" ? "flag" : "scam", `Analyzed link "${l.title}": ${l.scam.light.toUpperCase()} ${l.scam.score}/100. ${l.scam.reasons[0]}`);
  return { ...brief(l), address: raw.address ?? null, scamScore: l.scam.score, photos: raw.images?.length ?? 0 };
}

async function toolNormalize(input: Record<string, unknown>) {
  const l = findListing(str(input.id) ?? "");
  if (!l) return { error: "unknown id" };
  if (llmProvider() === "mock") return { note: "LLM not configured; heuristic normalization kept", listing: brief(l) };
  const n = await llmNormalize(l);
  Object.assign(l, n);
  log("info", `LLM re-normalized "${l.title}": $${l.priceMonthly}/mo, ${l.type}`);
  return brief(l);
}

async function toolRank(input: Record<string, unknown>) {
  const s = state();
  if (!s.criteria) return { error: "search first" };
  return toolSearch({ ...input, query: s.criteria.text });
}

function toolScam(input: Record<string, unknown>) {
  const l = findListing(str(input.id) ?? "");
  if (!l) return { error: "unknown id" };
  return { id: l.id, title: l.title, light: l.scam.light, score: l.scam.score, reasons: l.scam.reasons };
}

export function toolDraftContact(input: Record<string, unknown>, auto = false) {
  const s = state();
  const l = findListing(str(input.id) ?? "");
  if (!l) return { error: "unknown id" };
  if (l.scam.light === "red") {
    log("flag", `Refused to contact red listing "${l.title}"`);
    return { refused: true, reason: "Listing is red-flagged: " + l.scam.reasons.slice(0, 2).join("; ") };
  }
  const dup = s.approvals.find((a) => a.listingId === l.id && a.status === "pending" && (a.kind === "send_contact" || a.kind === "open_craigslist_reply"));
  if (dup) return { approvalId: dup.id, kind: dup.kind, preview: dup.body.slice(0, 200) };
  const { subject, text } = firstContact(s.profile, l.title, l.priceMonthly);
  const email = l.source === "craigslist" || l.source === "x" ? undefined : l.demo?.landlordEmail;
  if (email && !emailAllowed(email)) {
    log("flag", `Won't draft an email to ${email}: not on the demo allowlist`);
    return { refused: true, reason: "Landlord email is not on the demo allowlist" };
  }
  const a: Approval = email
    ? { id: uid("ap"), at: now(), kind: "send_contact", listingId: l.id, title: `Send first email to ${email}`, body: text, status: "pending", payload: { to: email, subject } }
    : { id: uid("ap"), at: now(), kind: "open_craigslist_reply", listingId: l.id, title: `Reply on ${l.source === "x" ? "X" : "Craigslist"} (you send it)`, body: text, status: "pending",
        payload: { url: l.url, note: l.source === "craigslist" ? "Open the listing, click Reply (solve the captcha yourself), paste this message." : "Open the post and reply/DM manually." } };
  if (auto) a.payload = { ...a.payload, autopilot: true };
  s.approvals.unshift(a);
  log("draft", auto ? `Autopilot prepared a ${l.source === "x" ? "X" : "Craigslist"} reply for "${l.title}" (you click Reply)` : `Drafted contact for "${l.title}" (waiting for your approval)`);
  return { approvalId: a.id, kind: a.kind, preview: text.slice(0, 200) };
}

/** Can autopilot email this listing's landlord directly? Only allowlisted demo landlords, never Craigslist/X, never red. */
export function autoEmailable(l: RankedListing): string | null {
  const email = l.demo?.landlordEmail;
  if (l.source !== "demo" || !email || l.scam.light === "red") return null;
  return emailAllowed(email) ? email : null;
}

/** Sends a first contact email and opens the thread. The allowlist gates every send; autopilot can never hit Craigslist/X. */
export async function sendContact(listingId: string | undefined, to: string, subject: string, body: string, auto = false) {
  const s = state();
  if (!emailAllowed(to)) { log("flag", `Blocked email to ${to}: not on the demo allowlist`); return { error: "recipient not allowlisted" as const }; }
  const l = listingId ? findListing(listingId) : undefined;
  if (auto && (!l || !autoEmailable(l))) { log("flag", `Autopilot will not email "${l?.title ?? listingId}": only allowlisted demo landlords`); return { error: "not auto-contactable" as const }; }
  const sent = await sendMail(to, subject, body);
  const t: Thread = { id: uid("th"), listingId: listingId ?? "", listingTitle: l?.title ?? "listing", landlordEmail: to, subject,
    messages: [{ id: sent.messageId, from: "agent", text: body, at: now() }], status: "awaiting_landlord", agentmailThreadId: sent.threadId, lastMessageId: sent.messageId, askedProof: true, auto };
  s.threads.unshift(t);
  log("email_out", `${auto ? "Autopilot emailed" : "Emailed"} ${to} (${sent.mode}) about "${t.listingTitle}"`);
  return { ok: true as const, threadId: t.id };
}

/** draft_contact tool: with autopilot on, an allowlisted demo landlord is emailed right away; anything else is a draft. */
export async function contactListing(input: Record<string, unknown>) {
  const s = state();
  const l = findListing(str(input.id) ?? "");
  if (l && s.autopilot.on && autoEmailable(l)) {
    const existing = s.threads.find((t) => t.listingId === l.id);
    if (existing) return { alreadyContacted: true, threadId: existing.id };
    const { subject, text } = firstContact(s.profile, l.title, l.priceMonthly);
    const r = await sendContact(l.id, autoEmailable(l)!, subject, text, true);
    narrate(s);
    return { ...r, sent: "ok" in r };
  }
  return toolDraftContact(input);
}

/** Top safe matches: green first, then yellow. Red never. */
export function safeMatches(max = 3): RankedListing[] {
  const r = state().results;
  return [...r.filter((x) => x.scam.light === "green"), ...r.filter((x) => x.scam.light === "yellow")].slice(0, max);
}

/**
 * Autopilot outreach for the top safe matches: emails allowlisted demo landlords (no per-message approval, consent
 * was given once) and batches Craigslist/X reply drafts for the human. Never contacts the same listing twice.
 */
export async function autopilotOutreach(max = 3) {
  const s = state();
  const emailed: string[] = [], drafts: string[] = [];
  if (!s.autopilot.on) return { emailed, drafts };
  for (const l of safeMatches(max)) {
    if (s.threads.some((t) => t.listingId === l.id) || s.approvals.some((a) => a.listingId === l.id && a.kind !== "decision")) continue;
    const email = autoEmailable(l);
    if (email) {
      const { subject, text } = firstContact(s.profile, l.title, l.priceMonthly);
      if ("ok" in (await sendContact(l.id, email, subject, text, true))) emailed.push(l.id);
    } else if (l.source === "craigslist" || l.source === "x") {
      const r = toolDraftContact({ id: l.id }, true);
      if ("approvalId" in r) drafts.push(l.id);
    }
  }
  if (emailed.length || drafts.length) log("info", `Autopilot: emailed ${emailed.length} demo landlord(s), prepared ${drafts.length} Craigslist repl${drafts.length === 1 ? "y" : "ies"} for you`);
  narrate(s);
  return { emailed, drafts };
}

/** The one up-front consent, shown after the first search while autopilot is undecided. */
export function requestAutopilotConsent() {
  const s = state();
  if (s.autopilot.decided || s.approvals.some((a) => a.kind === "autopilot_consent")) return null;
  const a: Approval = { id: uid("ap"), at: now(), kind: "autopilot_consent", title: "Let me handle it end to end?", options: [CONSENT_YES, CONSENT_NO], status: "pending",
    body: "I'll email the landlords I'm allowed to, negotiate within your budget, ask for proof, refuse any payment before a viewing and book the first free slot. Craigslist replies stay yours: I prepare them, you click Reply." };
  s.approvals.unshift(a);
  log("decision", "Asked once: handle everything end to end?");
  return a.id;
}

/** Off switch / consent. Turning it on starts outreach on the current results immediately. */
export async function setAutopilot(on: boolean) {
  const s = state();
  const was = s.autopilot.on;
  s.autopilot = { ...s.autopilot, on, decided: true, consentAt: on ? (s.autopilot.consentAt ?? now()) : s.autopilot.consentAt };
  for (const a of s.approvals) if (a.kind === "autopilot_consent" && a.status === "pending") { a.status = "answered"; a.answer = on ? CONSENT_YES : CONSENT_NO; }
  if (on && !was) markNarrated(s); // don't replay old milestones
  log("decision", on ? "Autopilot ON: I'll handle outreach, negotiation and booking. Craigslist replies stay yours." : "Autopilot OFF: I'll ask before every message.");
  const outreach = on && s.results.length ? await autopilotOutreach() : { emailed: [], drafts: [] };
  return { ok: true, on, ...outreach };
}

/** Marks every pending Craigslist draft as handed to the human and returns what to open/paste (the one human step). */
export function takeCraigslistDrafts() {
  const s = state();
  const out = s.approvals.filter((a) => a.kind === "open_craigslist_reply" && a.status === "pending").map((a) => { a.status = "approved"; return { approvalId: a.id, listingId: a.listingId, url: String(a.payload?.url ?? ""), message: a.body }; });
  if (out.length) log("draft", `You took ${out.length} Craigslist repl${out.length === 1 ? "y" : "ies"} to send yourself (we never auto-contact Craigslist).`);
  return out;
}

async function toolProposeSlots() {
  const slots = await proposeSlots(3);
  return slots.map((s) => ({ ...s, label: fmtLA(s.start) }));
}

function toolBookRequest(input: Record<string, unknown>) {
  const s = state();
  const t = s.threads.find((x) => x.id === str(input.threadId));
  const start = str(input.start);
  if (!t || !start) return { error: "unknown thread or start" };
  return requestBooking(t, { start, end: new Date(Date.parse(start) + 45 * 60000).toISOString() });
}

/** Books the viewing on the (mock or Google) calendar. Sends no email: the caller's reply is the single confirmation. */
export async function bookOnCalendar(t: Thread, slot: Slot) {
  const s = state();
  const ev = await bookViewing(slot, `Viewing: ${t.listingTitle}`, `Booked by Sublet Sniper. Landlord: ${t.landlordEmail}. Bring ID; pay nothing before seeing the unit and signing.`, [t.landlordEmail]);
  s.events.unshift({ id: ev.id, title: `Viewing: ${t.listingTitle}`, start: slot.start, end: slot.end, link: ev.link });
  t.status = "booked";
  log("calendar", `Booked ${fmtLA(slot.start)} on ${ev.mode === "google" ? "Google Calendar" : "mock calendar"}`);
  return ev;
}

export function requestBooking(t: Thread, slot: Slot) {
  const s = state();
  const a: Approval = { id: uid("ap"), at: now(), kind: "book_viewing", listingId: t.listingId, title: `Book viewing: ${t.listingTitle}`, body: `${fmtLA(slot.start)} with ${t.landlordEmail}`, status: "pending", payload: { threadId: t.id, amThreadId: t.agentmailThreadId, slot } };
  s.approvals.unshift(a);
  log("decision", `Landlord accepted ${fmtLA(slot.start)}. Asking you to confirm the booking.`);
  return { approvalId: a.id };
}

export function toolAsk(input: Record<string, unknown>) {
  const s = state();
  const options = Array.isArray(input.options) ? input.options.map(String) : ["Yes", "No"];
  const a: Approval = { id: uid("ap"), at: now(), kind: "decision", title: str(input.question) ?? "Decision needed", body: "", options, status: "pending" };
  s.approvals.unshift(a);
  log("decision", `Asked you: ${a.title}`);
  return { approvalId: a.id };
}

function toolStatus() {
  const s = state();
  return { threads: s.threads.map((t) => ({ id: t.id, listing: t.listingTitle, status: t.status, last: t.messages.at(-1)?.text.slice(0, 160) })),
    pending: s.approvals.filter((a) => a.status === "pending").map((a) => ({ id: a.id, kind: a.kind, title: a.title })), events: s.events,
    autopilot: (({ on, stage, now: doing, next, needsYou, stats }) => ({ on, stage, now: doing, next, needsYou: needsYou.map((n) => n.kind), stats }))(autopilotView(s)) };
}

export async function execTool(name: string, input: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case "analyze_listing_url": return toolAnalyzeUrl(input);
    case "search_listings": return toolSearch(input);
    case "normalize_listing": return toolNormalize(input);
    case "rank_listings": return toolRank(input);
    case "score_scam": return toolScam(input);
    case "draft_contact": return contactListing(input);
    case "propose_slots": return toolProposeSlots();
    case "book_viewing": return toolBookRequest(input);
    case "ask_owner_decision": return toolAsk(input);
    case "get_status": return toolStatus();
    case "set_autopilot": return setAutopilot(input.on !== false);
    default: return { error: `unknown tool ${name}` };
  }
}

// ---------------- approvals ----------------
export async function resolveApproval(id: string, approve: boolean, answer?: string, carried?: Approval) {
  const s = state();
  // Serverless: the approval may have been created on another instance; the client carries it back.
  // Safety rules (allowlist, Craigslist human-send) are re-checked below regardless of origin.
  if (carried && carried.id === id && !s.approvals.some((x) => x.id === id)) s.approvals.unshift({ ...carried, status: "pending" });
  const a = s.approvals.find((x) => x.id === id);
  if (!a || a.status !== "pending") return { error: "not pending" };
  if (a.kind === "decision") { a.status = "answered"; a.answer = answer ?? (approve ? "Yes" : "No"); log("decision", `You answered "${a.title}": ${a.answer}`); return { ok: true }; }
  if (a.kind === "autopilot_consent") {
    const yes = approve && !(answer && /approve each|cada paso|^no\b/i.test(answer));
    const r = await setAutopilot(yes);
    a.status = "answered"; a.answer = yes ? CONSENT_YES : CONSENT_NO;
    return r;
  }
  if (!approve) { a.status = "rejected"; log("info", `You rejected: ${a.title}`); return { ok: true }; }
  a.status = "approved";
  const payload = a.payload ?? {};
  switch (a.kind) {
    case "open_craigslist_reply":
      log("draft", `You approved the message. Open ${String(payload.url)} and send it yourself (we never auto-contact Craigslist).`);
      return { ok: true, openUrl: payload.url };
    case "send_contact": {
      const r = await sendContact(a.listingId, String(payload.to), String(payload.subject), a.body);
      narrate(s);
      return r;
    }
    case "book_viewing": {
      const find = () => s.threads.find((x) => x.id === payload.threadId || (!!payload.amThreadId && x.agentmailThreadId === payload.amThreadId));
      if (!find()) await syncThreads(true).catch(() => []);
      const t = find();
      const slot = payload.slot as Slot;
      if (!t) return { error: "thread gone" };
      await bookOnCalendar(t, slot);
      const msg = `Confirmed: see you ${fmtLA(slot.start)}. Please reply with the exact address and unit.\n\n${s.profile.name}`;
      if (!emailAllowed(t.landlordEmail)) { log("flag", `Blocked email to ${t.landlordEmail}: not on the demo allowlist`); return { ok: true, emailed: false }; }
      const sent = await sendMail(t.landlordEmail, t.subject, msg, t.lastMessageId);
      t.messages.push({ id: sent.messageId, from: "agent", text: msg, at: now() });
      narrate(s);
      return { ok: true };
    }
    default: {
      const never: never = a.kind;
      return never;
    }
  }
}

// ---------------- inbound landlord mail ----------------
export async function handleInbound(m: { from: string; text: string; messageId?: string; threadId?: string }) {
  const s = state();
  if (m.messageId && s.seenMessageIds.includes(m.messageId)) return { skipped: "seen" };
  if (m.messageId) s.seenMessageIds.push(m.messageId);
  const t = s.threads.find((x) => (m.threadId && x.agentmailThreadId === m.threadId) || x.landlordEmail === m.from.toLowerCase());
  if (!t) { log("email_in", `Ignored email from unknown sender ${m.from}`); return { skipped: "unknown sender" }; }
  const flags = detectRedFlags(m.text);
  const known = m.messageId ? t.messages.find((x) => x.id === m.messageId) : undefined;
  if (known) known.flagged = flags.length ? flags : undefined;
  else t.messages.push({ id: m.messageId, from: "landlord", text: m.text, at: now(), flagged: flags.length ? flags : undefined });
  if (m.messageId) t.lastMessageId = m.messageId;
  log("email_in", `Landlord replied on "${t.listingTitle}"`);
  if (!emailAllowed(t.landlordEmail)) { toolAsk({ question: `New reply on "${t.listingTitle}". Want me to answer?`, options: ["Yes", "No"] }); return { ok: true, autoReply: false }; }

  const slots = await proposeSlots(3);
  const win = parseWindow(m.text);
  const windowSlot = win ? await slotInWindow(win) : null;
  const plan = planReply(m.text, t, s.profile, slots, windowSlot);
  let text = await writeReply(plan, m.text, s.profile);
  // Negotiation bookkeeping (budget cap enforced in planReply): our counter, and the landlord accepting it.
  const clean = stripQuoted(m.text);
  if (plan.counter) t.deal = { asked: Math.max(t.deal?.asked ?? 0, rentIn(clean) ?? plan.counter), offered: plan.counter };
  if (plan.accepted) t.deal = { asked: Math.max(t.deal?.asked ?? 0, plan.accepted), offered: t.deal?.offered ?? plan.accepted, agreed: plan.accepted };
  else if (plan.intent !== "safety" && t.deal?.offered && t.deal.agreed == null && acceptsOffer(clean, t.deal.offered)) {
    t.deal.agreed = t.deal.offered;
    text = `Deal at $${t.deal.offered.toLocaleString("en-US")}/mo, thank you! ${text}`;
    log("decision", `Landlord accepted $${t.deal.offered}/mo (asked $${t.deal.asked})`);
  }
  // A booked viewing stays visible: later messages (even a scam one) only flag the message, never un-book.
  const wasBooked = t.status === "booked";
  if (plan.intent === "safety") {
    if (!wasBooked) t.status = "flagged";
    const l = findListing(t.listingId);
    // Severity: the classic scam script (away abroad, wire, gift cards, keys by mail) is red. A pushy deposit/Zelle
    // ask alone is caution: refused, and the deal can continue if the landlord backs down.
    const severe = flags.some((f) => /out of the country|wire|gift cards|keys by mail/i.test(f));
    if (l) {
      const reasons = [...flags.map((f) => `Landlord email: ${f}`), ...l.scam.reasons.filter((r) => !r.startsWith("Landlord email:"))];
      l.scam = severe || l.scam.light === "red"
        ? { light: "red", score: Math.max(l.scam.score, 80), reasons, signals: l.scam.signals }
        : { light: "yellow", score: Math.min(49, Math.max(l.scam.score, 35)), reasons, signals: l.scam.signals };
    }
    log("flag", `${severe ? "RED FLAG" : "Caution"} in landlord email: ${flags.join("; ")}. Refused${severe ? " and flagged" : ""}.`);
    // Autopilot decides this itself (refuse, mark red, keep no-payment stance); otherwise ask the owner.
    if (!s.autopilot.on) toolAsk({ question: `"${t.listingTitle}" landlord asked for money before a viewing (${flags[0]}). Drop this listing?`, options: ["Drop it", "Keep talking (no payment)"] });
  } else if (plan.proposeSlots) {
    t.offeredSlots = slots.map((x) => JSON.stringify(x)); if (!wasBooked) t.status = "viewing_proposed";
    log("calendar", `Offered ${slots.length} viewing slots from your calendar`);
  } else if ((plan.intent === "pick_slot" || plan.intent === "landlord_time") && plan.slot) {
    if (process.env.REQUIRE_BOOKING_APPROVAL === "1") requestBooking(t, plan.slot);
    else await bookOnCalendar(t, plan.slot).catch((e: unknown) => { log("info", `Calendar booking failed: ${String(e)}`); requestBooking(t, plan.slot!); });
  } else if (!wasBooked) t.status = "active";
  t.askedProof = plan.askedProof;
  const sent = await sendMail(t.landlordEmail, t.subject, text, t.lastMessageId);
  t.messages.push({ from: "agent", text, at: now() });
  t.messages[t.messages.length - 1].id = sent.messageId;
  log("email_out", `Replied to landlord (${sent.mode}): ${plan.intent}`);
  narrate(s);
  return { ok: true, intent: plan.intent };
}
