import { parseCriteria } from "./criteria";
import { searchListings } from "./search";
import { llmNormalize } from "./llm-normalize";
import { llmProvider } from "./config";
import { proposeSlots, bookViewing, type Slot } from "./calendar";
import { sendMail } from "./mail";
import { emailAllowed, firstContact, planReply, writeReply, detectRedFlags } from "./landlord";
import { fmtLA } from "./time";
import { findListing, log, now, state, uid, type Approval, type Thread } from "./store";
import { PLACES } from "./geo";
import type { Criteria, ListingType, RankedListing } from "./types";
import type { ToolDef } from "./llm";

export const TOOL_DEFS: ToolDef[] = [
  { name: "search_listings", description: "Search live Craigslist SF (sublets, rooms, apartments; snapshot fallback) plus the X snapshot and demo fixtures. Normalizes, scam-scores and ranks. Returns top results and red-flagged listings.",
    parameters: { type: "object", properties: {
      query: { type: "string", description: "The user's request in their own words" },
      maxBudget: { type: "number" }, types: { type: "array", items: { type: "string", enum: ["room", "studio", "1br", "2br", "3br+"] } },
      furnished: { type: "boolean" }, from: { type: "string", description: "YYYY-MM-DD" }, to: { type: "string" },
      near: { type: "array", items: { type: "string" }, description: `Places, e.g. ${PLACES.map((p) => p.name).join(", ")}` }, maxKm: { type: "number" } }, required: ["query"] } },
  { name: "normalize_listing", description: "Re-normalize one listing with the LLM (price period, type, dates) when the heuristic looks off.", parameters: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },
  { name: "rank_listings", description: "Re-rank the current results with changed criteria (budget, type, furnished, dates, near, maxKm).", parameters: { type: "object", properties: { maxBudget: { type: "number" }, furnished: { type: "boolean" }, near: { type: "array", items: { type: "string" } }, maxKm: { type: "number" } } } },
  { name: "score_scam", description: "Explain the scam traffic light (green/yellow/red) and reasons for one listing.", parameters: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },
  { name: "draft_contact", description: "Draft a first message to a listing's landlord and put it in the approvals queue. The human approves; for Craigslist the human opens the reply page and sends it.", parameters: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },
  { name: "propose_slots", description: "Get the next free viewing slots from the user's calendar.", parameters: { type: "object", properties: {} } },
  { name: "book_viewing", description: "Request approval to book a viewing for a landlord thread at a slot (ISO start).", parameters: { type: "object", properties: { threadId: { type: "string" }, start: { type: "string" } }, required: ["threadId", "start"] } },
  { name: "ask_owner_decision", description: "Ask the owner a decision question (only for real decisions). Appears in the approvals queue.", parameters: { type: "object", properties: { question: { type: "string" }, options: { type: "array", items: { type: "string" } } }, required: ["question"] } },
  { name: "get_status", description: "Current threads, pending approvals and booked viewings.", parameters: { type: "object", properties: {} } },
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
  if (c.maxBudget) s.profile.maxBudget = c.maxBudget;
  if (c.from) s.profile.moveIn = c.from;
  if (c.to) s.profile.moveOut = c.to;
  const { results, flagged, report } = await searchListings(c);
  s.criteria = c; s.results = results; s.flagged = flagged; s.searchReport = report;
  log("search", `Searched ${report.total} listings (Craigslist ${report.mode}, ${report.x} X posts, ${report.demo} demo). ${results.length} shown, ${flagged.length} flagged red.`);
  for (const f of flagged.slice(0, 2)) log("scam", `RED: "${f.title}" ${f.scam.reasons.slice(0, 2).join("; ")}`);
  return { criteria: c, mode: report.mode, top: results.slice(0, 6).map(brief), flagged: flagged.slice(0, 3).map(brief) };
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

export function toolDraftContact(input: Record<string, unknown>) {
  const s = state();
  const l = findListing(str(input.id) ?? "");
  if (!l) return { error: "unknown id" };
  if (l.scam.light === "red") {
    log("flag", `Refused to contact red listing "${l.title}"`);
    return { refused: true, reason: "Listing is red-flagged: " + l.scam.reasons.slice(0, 2).join("; ") };
  }
  const { subject, text } = firstContact(s.profile, l.title, l.priceMonthly);
  const email = l.demo?.landlordEmail;
  const a: Approval = email
    ? { id: uid("ap"), at: now(), kind: "send_contact", listingId: l.id, title: `Send first email to ${email}`, body: text, status: "pending", payload: { to: email, subject } }
    : { id: uid("ap"), at: now(), kind: "open_craigslist_reply", listingId: l.id, title: `Reply on ${l.source === "x" ? "X" : "Craigslist"} (you send it)`, body: text, status: "pending",
        payload: { url: l.url, note: l.source === "craigslist" ? "Open the listing, click Reply (solve the captcha yourself), paste this message." : "Open the post and reply/DM manually." } };
  s.approvals.unshift(a);
  log("draft", `Drafted contact for "${l.title}" (waiting for your approval)`);
  return { approvalId: a.id, kind: a.kind, preview: text.slice(0, 200) };
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

export function requestBooking(t: Thread, slot: Slot) {
  const s = state();
  const a: Approval = { id: uid("ap"), at: now(), kind: "book_viewing", listingId: t.listingId, title: `Book viewing: ${t.listingTitle}`, body: `${fmtLA(slot.start)} with ${t.landlordEmail}`, status: "pending", payload: { threadId: t.id, slot } };
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
    pending: s.approvals.filter((a) => a.status === "pending").map((a) => ({ id: a.id, kind: a.kind, title: a.title })), events: s.events };
}

export async function execTool(name: string, input: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case "search_listings": return toolSearch(input);
    case "normalize_listing": return toolNormalize(input);
    case "rank_listings": return toolRank(input);
    case "score_scam": return toolScam(input);
    case "draft_contact": return toolDraftContact(input);
    case "propose_slots": return toolProposeSlots();
    case "book_viewing": return toolBookRequest(input);
    case "ask_owner_decision": return toolAsk(input);
    case "get_status": return toolStatus();
    default: return { error: `unknown tool ${name}` };
  }
}

// ---------------- approvals ----------------
export async function resolveApproval(id: string, approve: boolean, answer?: string) {
  const s = state();
  const a = s.approvals.find((x) => x.id === id);
  if (!a || a.status !== "pending") return { error: "not pending" };
  if (a.kind === "decision") { a.status = "answered"; a.answer = answer ?? (approve ? "Yes" : "No"); log("decision", `You answered "${a.title}": ${a.answer}`); return { ok: true }; }
  if (!approve) { a.status = "rejected"; log("info", `You rejected: ${a.title}`); return { ok: true }; }
  a.status = "approved";
  const payload = a.payload ?? {};
  switch (a.kind) {
    case "open_craigslist_reply":
      log("draft", `You approved the message. Open ${String(payload.url)} and send it yourself (we never auto-contact Craigslist).`);
      return { ok: true, openUrl: payload.url };
    case "send_contact": {
      const to = String(payload.to);
      if (!emailAllowed(to)) { log("flag", `Blocked email to ${to}: not on the demo allowlist`); return { error: "recipient not allowlisted" }; }
      const l = a.listingId ? findListing(a.listingId) : undefined;
      const sent = await sendMail(to, String(payload.subject), a.body);
      const t: Thread = { id: uid("th"), listingId: a.listingId ?? "", listingTitle: l?.title ?? "listing", landlordEmail: to, subject: String(payload.subject),
        messages: [{ from: "agent", text: a.body, at: now() }], status: "awaiting_landlord", agentmailThreadId: sent.threadId, lastMessageId: sent.messageId, askedProof: true };
      s.threads.unshift(t);
      log("email_out", `Emailed ${to} (${sent.mode}) about "${t.listingTitle}"`);
      return { ok: true, threadId: t.id };
    }
    case "book_viewing": {
      const t = s.threads.find((x) => x.id === payload.threadId);
      const slot = payload.slot as Slot;
      if (!t) return { error: "thread gone" };
      const ev = await bookViewing(slot, `Viewing: ${t.listingTitle}`, `Booked by Sublet Sniper. Landlord: ${t.landlordEmail}. Bring ID; pay nothing before seeing the unit and signing.`, [t.landlordEmail]);
      s.events.unshift({ id: ev.id, title: `Viewing: ${t.listingTitle}`, start: slot.start, end: slot.end, link: ev.link });
      t.status = "booked";
      log("calendar", `Booked ${fmtLA(slot.start)} on ${ev.mode === "google" ? "Google Calendar" : "mock calendar"}`);
      const msg = `Confirmed: see you ${fmtLA(slot.start)}. Please reply with the exact address and unit.\n\n${s.profile.name}`;
      await sendMail(t.landlordEmail, t.subject, msg, t.lastMessageId);
      t.messages.push({ from: "agent", text: msg, at: now() });
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
  t.messages.push({ from: "landlord", text: m.text, at: now(), flagged: flags.length ? flags : undefined });
  if (m.messageId) t.lastMessageId = m.messageId;
  log("email_in", `Landlord replied on "${t.listingTitle}"`);
  if (!emailAllowed(t.landlordEmail)) { toolAsk({ question: `New reply on "${t.listingTitle}". Want me to answer?`, options: ["Yes", "No"] }); return { ok: true, autoReply: false }; }

  const slots = await proposeSlots(3);
  const plan = planReply(m.text, t, s.profile, slots);
  const text = await writeReply(plan, m.text, s.profile);
  if (plan.intent === "safety") {
    t.status = "flagged";
    const l = findListing(t.listingId);
    if (l) { l.scam = { light: "red", score: Math.max(l.scam.score, 80), reasons: [...flags.map((f) => `Landlord email: ${f}`), ...l.scam.reasons] }; }
    log("flag", `RED FLAG in landlord email: ${flags.join("; ")}. Refused and flagged.`);
    toolAsk({ question: `"${t.listingTitle}" landlord asked for money before a viewing (${flags[0]}). Drop this listing?`, options: ["Drop it", "Keep talking (no payment)"] });
  } else if (plan.proposeSlots) {
    t.offeredSlots = slots.map((x) => JSON.stringify(x)); t.status = "viewing_proposed";
    log("calendar", `Offered ${slots.length} viewing slots from your calendar`);
  } else if (plan.intent === "pick_slot" && plan.slot) {
    requestBooking(t, plan.slot);
  } else t.status = "active";
  t.askedProof = plan.askedProof;
  const sent = await sendMail(t.landlordEmail, t.subject, text, t.lastMessageId);
  t.messages.push({ from: "agent", text, at: now() });
  log("email_out", `Replied to landlord (${sent.mode}): ${plan.intent}`);
  return { ok: true, intent: plan.intent };
}
