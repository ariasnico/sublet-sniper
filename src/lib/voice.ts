import { createHmac, timingSafeEqual } from "node:crypto";
import { mailLive, voiceLive } from "./config";
import { bookViewing, proposeSlots, slotInWindow, type Slot } from "./calendar";
import { demoListings } from "./demo";
import { detectRedFlags, emailAllowed, parseWindow, phoneAllowed, rentIn } from "./landlord";
import { sendMail } from "./mail";
import { syncThreads } from "./mailsync";
import { fmtLA, TZ } from "./time";
import { findListing, log, now, state, uid, type CallRecord, type State, type Thread, type ThreadMsg } from "./store";

/**
 * VOICE: the agent phones the DEMO landlord through an ElevenLabs Agent (outbound call over a Twilio/SIP number
 * imported in ElevenLabs) and negotiates by voice. Safety: only allowlisted phones (DEMO_LANDLORD_PHONE /
 * DEMO_ALLOWED_PHONES) and only the seeded demo listing; Craigslist/X landlords are never called.
 *
 * Serverless: ElevenLabs is the source of truth for the conversation. The call record rides in the browser snapshot;
 * the UI polls /api/voice/status, which reads the conversation from ElevenLabs on whatever instance it lands; the
 * post-call webhook finalizes it and replies on the AgentMail thread with a recap ("... on my calendar"), so every
 * instance rebuilds the agreed rent and the booking from the mail thread (mailsync).
 */

const API = () => process.env.ELEVENLABS_API_BASE || "https://api.elevenlabs.io";
const usd = (n: number) => `$${n.toLocaleString("en-US")}`;
const clean = (t: string) => t.replace(/^\[DEMO DATA\]\s*/, "").replace(/\s*,\s*(Nov|Dec|Oct)\b.*$/, "");
const longLA = (iso: string) => new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso));
const shortLA = (iso: string) => new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short", hour: "numeric", minute: "2-digit" }).format(new Date(iso));
const humanDate = (ymd: string) => { const d = new Date(`${ymd}T12:00:00Z`); return Number.isNaN(d.getTime()) ? ymd : d.toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" }); };
const ACTIVE_MS = 15 * 60e3;

async function el(path: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
  const res = await fetch(`${API()}${path}`, { ...init, headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY ?? "", "content-type": "application/json" }, signal: AbortSignal.timeout(20000) });
  const j: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = j && typeof j === "object" ? JSON.stringify((j as { detail?: unknown }).detail ?? j).slice(0, 200) : "";
    throw new Error(`ElevenLabs ${res.status} ${detail}`);
  }
  return (j && typeof j === "object" ? j : {}) as Record<string, unknown>;
}

// ---------------- who may be called ----------------
/** The number to dial for a thread, or why not. Only the seeded demo listing, only allowlisted phones. */
export function callTarget(t: Thread, browser = false): { to: string } | { error: string } {
  const l = findListing(t.listingId) ?? demoListings().find((x) => x.id === t.listingId);
  if (!l || l.source !== "demo" || l.demo?.kind !== "accomplice") return { error: "Only the demo listing can be called" };
  if (!emailAllowed(t.landlordEmail)) return { error: "Landlord is not the allowlisted demo landlord" };
  if (browser) return { to: "browser" };
  const to = process.env.DEMO_LANDLORD_PHONE ?? "";
  if (!phoneAllowed(to)) return { error: "DEMO_LANDLORD_PHONE is not set" };
  return { to };
}

export const activeCall = (s: State, t: Thread) => s.calls.find((c) => c.threadId === t.id && c.status === "calling" && Date.now() - Date.parse(c.startedAt) < ACTIVE_MS);
export const callsFor = (s: State, t: Thread) => s.calls.filter((c) => c.threadId === t.id || (!!c.amThreadId && c.amThreadId === t.agentmailThreadId));

/** Chat line from the agent (deduped by key; independent of autopilot so manual calls are narrated too). */
function say(s: State, key: string, text: string) {
  if (s.autopilot.narrated.includes(key)) return;
  s.autopilot.narrated = [...s.autopilot.narrated, key].slice(-300);
  s.chat.push({ role: "assistant", text, at: now(), auto: true });
}

// ---------------- dynamic variables ----------------
export type Vars = Record<string, string | number>;
export async function callVars(t: Thread, call: CallRecord): Promise<Vars> {
  const s = state();
  const l = findListing(t.listingId);
  const raw = demoListings().find((x) => x.id === t.listingId);
  const listed = l?.priceMonthly ?? (raw?.priceText ? rentIn(raw.priceText) : null) ?? 0;
  const max = s.profile.maxBudget;
  const target = Math.min(max, listed ? Math.round((listed * 0.95) / 50) * 50 : Math.round((max * 0.875) / 50) * 50);
  const slots = await proposeSlots(3).catch(() => [] as Slot[]);
  return {
    landlord_name: process.env.DEMO_LANDLORD_NAME || "the landlord", listing_title: clean(t.listingTitle), listed_rent: listed || max,
    target_rent: target, max_budget: max, renter_name: s.profile.name, renter_first_name: s.profile.name.split(" ")[0],
    move_in: humanDate(s.profile.moveIn), move_out: humanDate(s.profile.moveOut),
    free_slots: slots.map((x) => fmtLA(x.start)).join("; ") || "weekday evenings after 5 PM",
    today: new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "long", month: "long", day: "numeric", year: "numeric" }).format(new Date()),
    renter_profile: `- ${s.profile.occupation}. ${s.profile.about} ${s.profile.smoker ? "Smoker" : "Non-smoker"}, ${s.profile.pets}. ${s.profile.references}.`,
    callback_number: process.env.VOICE_CALLBACK_NUMBER || "+1 415 582 1858", renter_email: s.profile.email,
    call_id: call.id, thread_id: t.id, am_thread_id: t.agentmailThreadId ?? "", listing_id: t.listingId,
  };
}

// ---------------- start ----------------
export interface StartedCall { call: CallRecord; vars: Vars }
/**
 * Starts a call to the demo landlord of a thread. mode "phone" dials through ElevenLabs (or the simulator with
 * VOICE_MODE=mock); "browser" only registers the call: the presenter talks to the agent from the laptop mic.
 */
export async function startCall(t: Thread, mode: "phone" | "browser" = "phone"): Promise<StartedCall | { error: string }> {
  const s = state();
  const target = callTarget(t, mode === "browser");
  if ("error" in target) { log("flag", `Won't call about "${t.listingTitle}": ${target.error}`); return target; }
  const busy = activeCall(s, t);
  if (busy) return { call: busy, vars: await callVars(t, busy) };
  const sim = mode === "phone" && !voiceLive();
  if (sim && process.env.VOICE_MODE !== "mock") return { error: "Voice calls are not configured" };
  const call: CallRecord = { id: uid("call"), threadId: t.id, amThreadId: t.agentmailThreadId, listingId: t.listingId, listingTitle: t.listingTitle, to: target.to,
    mode: mode === "browser" ? "browser" : sim ? "mock" : "elevenlabs", status: "calling", startedAt: now(), transcript: [] };
  s.calls.push(call);
  s.calls = s.calls.slice(-10);
  const vars = await callVars(t, call);
  log("call", `📞 Calling the landlord about "${clean(t.listingTitle)}"${call.mode === "mock" ? " (simulated)" : call.mode === "browser" ? " (browser)" : ""}`);
  say(s, `call:start:${call.id}`, "📞 Calling the landlord…");
  if (call.mode === "elevenlabs") {
    try {
      const sip = process.env.ELEVENLABS_TELEPHONY === "sip";
      const r = await el(`/v1/convai/${sip ? "sip-trunk" : "twilio"}/outbound-call`, { method: "POST", body: JSON.stringify({
        agent_id: process.env.ELEVENLABS_AGENT_ID, agent_phone_number_id: process.env.ELEVENLABS_PHONE_NUMBER_ID, to_number: target.to,
        conversation_initiation_client_data: { dynamic_variables: vars }, telephony_call_config: { ringing_timeout_secs: 30 } }) });
      if (r.success === false) throw new Error(String(r.message ?? "call not started"));
      call.conversationId = typeof r.conversation_id === "string" ? r.conversation_id : undefined;
    } catch (e) {
      failCall(call, e instanceof Error ? e.message : "call failed");
      return { error: call.error ?? "call failed" };
    }
  } else if (call.mode === "mock") {
    call.conversationId = `mock-conv-${call.id}`;
    void runMock(call, vars, Number(process.env.VOICE_MOCK_STEP_MS ?? 1600));
  }
  return { call, vars };
}

function failCall(call: CallRecord, error: string, status: CallRecord["status"] = "failed") {
  if (call.status !== "calling") return;
  call.status = status; call.error = error; call.endedAt = now();
  const s = state();
  log("call", status === "no_answer" ? "📞 No answer from the landlord" : `📞 Call failed: ${error}`);
  say(s, `call:end:${call.id}`, status === "no_answer" ? "📞 No answer. I'll keep going by email." : "📞 Couldn't place the call. I'll keep going by email.");
}

/** Signed URL for an in-browser session with the agent (presenter plays the landlord from the laptop mic). */
export async function signedUrl(): Promise<string> {
  const r = await el(`/v1/convai/conversation/get-signed-url?agent_id=${encodeURIComponent(process.env.ELEVENLABS_AGENT_ID ?? "")}`);
  const u = r.signed_url;
  if (typeof u !== "string") throw new Error("no signed url");
  return u;
}

// ---------------- tools (called by the ElevenLabs agent mid-call) ----------------
function findThread(threadId?: string, amThreadId?: string): Thread | undefined {
  const s = state();
  return s.threads.find((t) => (!!threadId && t.id === threadId) || (!!amThreadId && t.agentmailThreadId === amThreadId));
}

const str = (x: unknown) => (typeof x === "string" && x.trim() ? x.trim() : undefined);

/** Resolves the agreed time: an ISO start if given and in the future, else the spoken day/time ("Monday 5:30 PM"). */
export async function slotFrom(startIso?: string, spoken?: string): Promise<Slot | null> {
  // The spoken wall-clock time wins (LLMs often get UTC offsets wrong); the ISO start is the fallback.
  const win = spoken ? parseWindow(spoken) : null;
  const fromWin = win ? await slotInWindow(win) : null;
  if (fromWin) return fromWin;
  const t = startIso ? Date.parse(startIso) : NaN;
  return !Number.isNaN(t) && t > Date.now() + 30 * 60e3 ? { start: new Date(t).toISOString(), end: new Date(t + 45 * 60e3).toISOString() } : null;
}

export interface ToolResult { ok: boolean; result: string }
export async function handleTool(b: Record<string, unknown>): Promise<ToolResult> {
  const s = state();
  const tool = str(b.tool) ?? "book_viewing";
  const call = s.calls.find((c) => c.id === str(b.call_id));
  if (tool === "get_free_slots") {
    const slots = await proposeSlots(3);
    return { ok: true, result: slots.length ? `Free times for ${s.profile.name.split(" ")[0]} (Pacific): ${slots.map((x) => longLA(x.start)).join("; ")}.` : "No free slots this week; ask what works for them." };
  }
  if (tool !== "book_viewing") return { ok: false, result: "Unknown tool." };
  let t = findThread(str(b.thread_id) ?? call?.threadId, str(b.am_thread_id) ?? call?.amThreadId);
  if (!t && mailLive()) { await syncThreads(true).catch(() => []); t = findThread(str(b.thread_id) ?? call?.threadId, str(b.am_thread_id) ?? call?.amThreadId); }
  const rent = Number(b.agreed_rent);
  const max = s.profile.maxBudget;
  // Server-side price ceiling: the agent can never agree above the budget, whatever the model says.
  if (Number.isFinite(rent) && rent > max) {
    log("flag", `Voice agent tried to book at ${usd(rent)}/mo, above the ${usd(max)} budget. Refused.`);
    return { ok: false, result: `Do not agree to ${usd(rent)}. ${s.profile.name.split(" ")[0]}'s budget tops out at ${usd(max)} a month. Ask if they can do ${usd(max)} or less; otherwise thank them and end the call.` };
  }
  const slot = await slotFrom(str(b.start_iso), str(b.spoken_time));
  if (!slot) {
    const free = await proposeSlots(3).catch(() => [] as Slot[]);
    return { ok: false, result: `Couldn't place that time. Offer one of these instead: ${free.map((x) => longLA(x.start)).join("; ")}.` };
  }
  const agreed = Number.isFinite(rent) && rent > 0 ? rent : undefined;
  if (call) { call.agreed = agreed ?? call.agreed; call.viewingStart = slot.start; }
  const when = longLA(slot.start);
  const price = agreed ? ` at ${usd(agreed)} a month` : "";
  // Same viewing already on the calendar (a second call, or a tool retry): confirm without double-booking.
  if (s.events.some((e) => e.start === slot.start)) {
    if (t && agreed) t.deal = { asked: Math.max(t.deal?.asked ?? 0, agreed), offered: t.deal?.offered ?? agreed, agreed };
    return { ok: true, result: `Already booked: ${when} Pacific${price}. Read it back to them and confirm.` };
  }
  if (t) {
    if (agreed) t.deal = { asked: Math.max(t.deal?.asked ?? 0, agreed), offered: t.deal?.offered ?? agreed, agreed };
    const { bookOnCalendar, requestBooking } = await import("./tools");
    if (process.env.REQUIRE_BOOKING_APPROVAL === "1") {
      requestBooking(t, slot);
      return { ok: true, result: `Penciled in for ${when} Pacific${price}. Tell them ${s.profile.name.split(" ")[0]} confirms by email shortly. Read the time back.` };
    }
    await bookOnCalendar(t, slot);
  } else {
    // Cold instance without the mail thread: still book; the post-call recap email persists it.
    const ev = await bookViewing(slot, `Viewing: ${str(b.listing_title) ?? call?.listingTitle ?? "demo listing"}`, "Booked by Sublet Sniper on a call.");
    s.events.unshift({ id: ev.id, title: `Viewing: ${call?.listingTitle ?? str(b.listing_title) ?? "demo listing"}`, start: slot.start, end: slot.end, link: ev.link });
  }
  log("calendar", `📞 Booked on the call: ${fmtLA(slot.start)}${price}`);
  return { ok: true, result: `Booked: ${when} Pacific${price}. Read it back to them and confirm. A confirmation email follows.` };
}

// ---------------- post-call ----------------
export interface ElTurn { role?: string; message?: string | null; time_in_call_secs?: number }
export interface ElConversation {
  conversation_id?: string; status?: string; transcript?: ElTurn[];
  analysis?: { transcript_summary?: string; call_successful?: string; data_collection_results?: Record<string, { value?: unknown }> };
  conversation_initiation_client_data?: { dynamic_variables?: Record<string, unknown> };
  metadata?: { start_time_unix_secs?: number };
}

/** HMAC check of the ElevenLabs-Signature header ("t=<unix>,v0=<hex sha256 of `${t}.${rawBody}`>"), 30 min tolerance. */
export function verifySignature(raw: string, header: string | null | undefined, secret: string, nowMs = Date.now()): boolean {
  if (!header || !secret) return false;
  const parts = header.split(",").map((p) => p.trim());
  const ts = parts.find((p) => p.startsWith("t="))?.slice(2);
  const sig = parts.find((p) => p.startsWith("v0="));
  if (!ts || !sig || !/^\d+$/.test(ts)) return false;
  if (Number(ts) * 1000 < nowMs - 30 * 60e3) return false;
  const want = Buffer.from(`v0=${createHmac("sha256", secret).update(`${ts}.${raw}`).digest("hex")}`);
  const got = Buffer.from(sig);
  return want.length === got.length && timingSafeEqual(want, got);
}

/** Finds the call a webhook/poll is about, or rebuilds it from the dynamic variables (cold instance). */
export function callForConversation(c: ElConversation): CallRecord {
  const s = state();
  const dv = c.conversation_initiation_client_data?.dynamic_variables ?? {};
  const id = str(dv.call_id);
  const found = s.calls.find((x) => (!!id && x.id === id) || (!!c.conversation_id && x.conversationId === c.conversation_id));
  if (found) { found.conversationId ??= c.conversation_id; return found; }
  const call: CallRecord = { id: id ?? uid("call"), threadId: str(dv.thread_id) ?? "", amThreadId: str(dv.am_thread_id), listingId: str(dv.listing_id) ?? "demo-mission-bay",
    listingTitle: str(dv.listing_title) ?? "demo listing", to: "", mode: "elevenlabs", status: "calling", conversationId: c.conversation_id,
    startedAt: c.metadata?.start_time_unix_secs ? new Date(c.metadata.start_time_unix_secs * 1000).toISOString() : now(), transcript: [] };
  s.calls.push(call);
  return call;
}

const MONEY = /\$\s?(\d[\d,]{2,6})|\b(\d{1,2}),?(\d{3})\s*(?:dollars|a month|per month|\/mo)/gi;
/** Dollar amounts in a spoken turn ("$3,800", "3,600 a month"). */
export function spokenPrices(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(MONEY)) {
    const n = m[1] ? Number(m[1].replace(/,/g, "")) : Number(`${m[2]}${m[3]}`);
    if (n >= 500 && n < 20000) out.push(n);
  }
  return out;
}

/** Expressive voice tags ("[warm]", "[friendly]") are for the TTS, not for people reading the transcript. */
const firstSentence = (t: string) => { const x = t.replace(/^The (AI )?agent[^,.]*?(,|\.)\s*/i, "").split(/(?<=\.)\s/)[0] ?? t; return x.length > 140 ? `${x.slice(0, 137)}…` : x; };
export const stripTags = (t: string) => t.replace(/\[[a-z][a-z \-]{0,24}\]\s*/gi, "").replace(/\s{2,}/g, " ").trim();

/** Applies a finished conversation: transcript on the thread (channel "call"), deal, flags, narration, recap email. */
export async function finishCall(call: CallRecord, c: ElConversation, opts: { recap: boolean } = { recap: true }) {
  const s = state();
  if (call.status !== "calling" && call.endedAt) return call;
  const t0 = Date.parse(call.startedAt) || Date.now();
  const turns = (c.transcript ?? []).filter((x) => typeof x.message === "string" && x.message.trim());
  const transcript: ThreadMsg[] = turns.length
    ? turns.map((x, i) => ({ id: `${call.id}-${i}`, from: x.role === "agent" ? "agent" : "landlord", text: stripTags(String(x.message)), at: new Date(t0 + (x.time_in_call_secs ?? i * 5) * 1000).toISOString(), channel: "call" }))
    : call.transcript;
  for (const m of transcript) if (m.from === "landlord") { const f = detectRedFlags(m.text); m.flagged = f.length ? f : undefined; }
  call.transcript = transcript;
  const landlordTurns = transcript.filter((m) => m.from === "landlord");
  const asked = Math.max(0, ...landlordTurns.flatMap((m) => spokenPrices(m.text)));
  const counter = transcript.filter((m) => m.from === "agent").map((m) => m.text.match(/would you (?:do|take|consider) \$?\s?(\d[\d,]{2,6})/i)).find(Boolean);
  const dc = c.analysis?.data_collection_results?.agreed_rent?.value;
  let agreed = call.agreed ?? (typeof dc === "number" ? dc : typeof dc === "string" && /^\d+$/.test(dc) ? Number(dc) : undefined);
  if (agreed && agreed > s.profile.maxBudget) { log("flag", `Ignored ${usd(agreed)}/mo from the call: above the ${usd(s.profile.maxBudget)} budget`); agreed = undefined; }
  call.agreed = agreed; call.asked = asked || undefined; call.offered = counter ? Number(counter[1].replace(/,/g, "")) : undefined;
  call.flags = [...new Set(landlordTurns.flatMap((m) => m.flagged ?? []))];
  call.summary = c.analysis?.transcript_summary?.trim() || undefined;
  call.status = landlordTurns.length ? "done" : "no_answer";
  call.endedAt = now();

  let t = findThread(call.threadId, call.amThreadId);
  if (!t && mailLive()) { await syncThreads(true).catch(() => []); t = findThread(call.threadId, call.amThreadId); }
  if (t) {
    const ids = new Set(t.messages.map((m) => m.id));
    t.messages = [...t.messages, ...transcript.filter((m) => !ids.has(m.id))].sort((a, b) => a.at.localeCompare(b.at));
    if (asked || agreed) t.deal = { asked: Math.max(t.deal?.asked ?? 0, asked, agreed ?? 0), offered: call.offered ?? t.deal?.offered ?? agreed ?? null, agreed: agreed ?? t.deal?.agreed };
    if (call.viewingStart && t.status !== "booked" && process.env.REQUIRE_BOOKING_APPROVAL !== "1") t.status = "booked";
    else if (t.status === "awaiting_landlord" && landlordTurns.length) t.status = "active";
  }

  const ev = call.viewingStart ?? s.events.find((e) => t && e.title.includes(t.listingTitle))?.start;
  const parts = [agreed ? `${usd(agreed)} agreed` : null, ev ? `viewing ${shortLA(ev)}` : null].filter(Boolean);
  const refused = call.flags.some((f) => /zelle|wire|gift|money before/i.test(f)) ? ` Refused a ${/zelle/i.test(call.flags.join(" ")) ? "Zelle " : ""}deposit.` : "";
  if (call.status === "no_answer") {
    log("call", "📞 No answer: left a short voicemail");
    say(s, `call:end:${call.id}`, "📞 No answer. Left a short voicemail; I'll keep going by email.");
  } else {
    // No deal? Still tell the renter what happened, in one line (the call summary from ElevenLabs).
    const gist = !parts.length && call.summary ? ` ${firstSentence(call.summary)}` : "";
    log("call", `📞 Call done${parts.length ? `: ${parts.join(", ")}` : ""}${gist}`);
    say(s, `call:end:${call.id}`, `📞 Call done${parts.length ? `: ${parts.join(", ")}.` : "."}${refused}${gist}`);
  }

  // Persist the essentials where every instance looks: a recap reply on the AgentMail thread (rebuilt by mailsync).
  if (opts.recap && t && call.status === "done" && (agreed || call.viewingStart) && emailAllowed(t.landlordEmail)) {
    const p = s.profile;
    const text = `Thanks for the call! Confirming what we agreed${agreed ? `: ${usd(agreed)}/mo for ${p.moveIn} to ${p.moveOut}` : ""}.` +
      `${call.viewingStart ? ` Viewing: ${fmtLA(call.viewingStart)} works for me, it's on my calendar.` : ""}` +
      ` As discussed, no deposit or payment before the viewing and a written sublease.\n\n${p.name}`;
    try {
      const sent = await sendMail(t.landlordEmail, t.subject, text, t.lastMessageId);
      t.messages.push({ id: sent.messageId, from: "agent", text, at: now(), channel: "email" });
      t.lastMessageId = sent.messageId || t.lastMessageId;
      log("email_out", `Emailed the call recap to the landlord (${sent.mode})`);
    } catch (e) { log("info", `Call recap email failed: ${String(e)}`); }
  }
  return call;
}

/** Called by the UI poll: reads in-flight calls from ElevenLabs (any instance) and finalizes finished ones. */
export async function pollCalls(): Promise<number> {
  const s = state();
  let changed = 0;
  for (const call of s.calls.filter((c) => c.status === "calling")) {
    if (Date.now() - Date.parse(call.startedAt) > ACTIVE_MS) { failCall(call, "timed out"); changed++; continue; }
    if (call.mode === "mock" || !call.conversationId || !process.env.ELEVENLABS_API_KEY || process.env.VOICE_MODE === "mock") continue;
    try {
      const c = (await el(`/v1/convai/conversations/${encodeURIComponent(call.conversationId)}`)) as ElConversation;
      if (c.status === "done") { await finishCall(call, c, { recap: !process.env.ELEVENLABS_WEBHOOK_SECRET }); changed++; }
      else if (c.status === "failed") { failCall(call, "the call did not connect", "no_answer"); changed++; }
      else if (c.transcript?.length) {
        const t0 = Date.parse(call.startedAt) || Date.now();
        call.transcript = c.transcript.filter((x) => x.message).map((x, i) => ({ id: `${call.id}-${i}`, from: x.role === "agent" ? "agent" : "landlord", text: String(x.message), at: new Date(t0 + (x.time_in_call_secs ?? 0) * 1000).toISOString(), channel: "call" }));
      }
    } catch { /* keep polling */ }
  }
  return changed;
}

/** Post-call webhook body (already signature-checked). */
export async function handleWebhook(body: { type?: string; data?: Record<string, unknown> }): Promise<{ ok: boolean; ignored?: string }> {
  const data = (body.data ?? {}) as ElConversation & { failure_reason?: string };
  if (body.type === "call_initiation_failure") {
    const call = callForConversation(data);
    failCall(call, String(data.failure_reason ?? "no answer"), "no_answer");
    return { ok: true };
  }
  if (body.type !== "post_call_transcription") return { ok: true, ignored: String(body.type ?? "unknown") };
  const call = callForConversation(data);
  await finishCall(call, data, { recap: true });
  return { ok: true };
}

// ---------------- mock ----------------
export interface ScriptTurn { from: "agent" | "landlord"; text: string; tool?: { spoken_time: string; agreed_rent: number } }
/** Scripted demo call: landlord raises the price and asks for a Zelle deposit; the agent refuses, counters, books Monday 5:30 PM. */
export function mockScript(v: Vars): ScriptTurn[] {
  const first = String(v.renter_first_name ?? "Nicolás");
  return [
    { from: "agent", text: `Hi, is this ${v.landlord_name}? I'm an AI assistant calling on behalf of ${v.renter_name} about your ${v.listing_title}. This call may be recorded. Do you have two minutes?` },
    { from: "landlord", text: "Sure. Yes, it's still available." },
    { from: "agent", text: `Great. ${first} needs it from ${v.move_in} to ${v.move_out}. Does that work?` },
    { from: "landlord", text: "That works. But it's $3,800 a month now, and I need a $1,000 Zelle deposit today to hold it." },
    { from: "agent", text: `I understand. ${first} doesn't send any deposit, Zelle or wire before a live viewing and a written sublease. On price, would you do $${Number(v.target_rent).toLocaleString("en-US")} a month?` },
    { from: "landlord", text: "Okay, no deposit then. $3,400 is too low. I can do $3,600." },
    { from: "agent", text: "$3,600 a month works. Could we do a live video tour, and can you confirm you're the leaseholder?" },
    { from: "landlord", text: "Yes, I'm the leaseholder. Monday after 5 works for a video tour." },
    { from: "agent", text: "One moment, I'm booking it.", tool: { spoken_time: "Monday 5:30 PM", agreed_rent: 3600 } },
    { from: "landlord", text: "Perfect, see you then." },
    { from: "agent", text: `Thank you! ${first} will get a confirmation by email. Have a great day.` },
  ];
}

export async function runMock(call: CallRecord, vars: Vars, stepMs = 1600) {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const turns: ElTurn[] = [];
  const t0 = Date.parse(call.startedAt) || Date.now();
  for (const turn of mockScript(vars)) {
    await sleep(stepMs);
    if (call.status !== "calling") return;
    let text = turn.text;
    if (turn.tool) {
      const r = await handleTool({ tool: "book_viewing", call_id: call.id, thread_id: call.threadId, am_thread_id: call.amThreadId, ...turn.tool });
      text = r.ok && call.viewingStart ? `Booked: ${longLA(call.viewingStart)}, live video tour, at $${turn.tool.agreed_rent.toLocaleString("en-US")} a month. Did I get that right?` : `I'll confirm the time by email.`;
    }
    const secs = (Date.now() - t0) / 1000;
    turns.push({ role: turn.from === "agent" ? "agent" : "user", message: text, time_in_call_secs: secs });
    call.transcript.push({ id: `${call.id}-${turns.length - 1}`, from: turn.from, text, at: now(), channel: "call" });
  }
  await sleep(stepMs);
  await finishCall(call, { conversation_id: call.conversationId, transcript: turns, analysis: { transcript_summary: "Landlord confirmed availability, dropped a Zelle deposit request, agreed to $3,600/mo and a live video tour Monday 5:30 PM.", call_successful: "success" } }, { recap: true });
}
