"use client";
import { createElement, useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Script from "next/script";
import Link from "next/link";
import { Toaster, toast } from "sonner";
import { Bot } from "./Bot";
import { ListingCard } from "./ui/ListingCard";
import { Moment, type MomentData } from "./ui/Moment";
import { CallStage } from "./ui/CallStage";
import type { LiveCall } from "@/lib/voice";
import { deal } from "./ui/Inbox";
import { StatusBar, type StatusInput } from "./ui/Mission";
import { Activity, callOf, lastAt } from "./ui/Activity";
import { BookedHero, MatchHero, MatchRow, WorkHero, shortTitle } from "./ui/Hero";
import type { AutopilotView, CraigslistDraft, NeedsYouItem } from "@/lib/autopilot";
import { XRay } from "./ui/XRay";
import { ChatThread } from "./ui/chat/ChatThread";
import { followUpsFor, type FollowUp } from "./ui/chat/followups";
import type { Criteria, RankedListing } from "@/lib/types";
import type { Approval, CallRecord, ChatMsg, Thread, TimelineItem } from "@/lib/store";

const MapView = dynamic(() => import("./ui/MapView"), { ssr: false, loading: () => <div className="map map-loading" /> });

interface Modes { llm: string; mail: string; calendar: string; craigslist: string; voice: string; calls?: boolean; browserVoice?: boolean; agentInbox: string }
interface S { profile?: { name: string }; version?: string; analyzedId?: string | null; criteria?: Criteria | null; results: RankedListing[]; flagged: RankedListing[]; timeline: TimelineItem[]; approvals: Approval[]; threads: Thread[]; chat: ChatMsg[];
  events: { id: string; title: string; start: string; end?: string; link?: string }[]; modes: Modes; searchReport: { mode: string; total: number } | null; autopilot?: Partial<AutopilotView>; calls?: CallRecord[] }

/** One "needs you" card: from s.autopilot.needsYou when the backend reports it, else built from pending approvals. */
type Need = { key: string; kind: NeedsYouItem["kind"]; approvalId?: string; title: string; body?: string; options?: string[]; items?: CraigslistDraft[] };
const NEED_KIND: Record<string, NeedsYouItem["kind"]> = { autopilot_consent: "autopilot_consent", book_viewing: "confirm_booking", send_contact: "approve_send", decision: "decision" };
function needsOf(s: S | null, pending: Approval[]): Need[] {
  const ny = s?.autopilot?.needsYou;
  if (Array.isArray(ny)) return ny.map((n) => n.kind === "craigslist_replies"
    ? { key: `cl:${n.approvalIds.join(",")}`, kind: n.kind, title: n.title, body: n.body, items: n.items }
    : { key: n.approvalId, kind: n.kind, approvalId: n.approvalId, title: n.title, body: "body" in n ? n.body : undefined, options: "options" in n ? n.options : undefined });
  const out: Need[] = [];
  const cl = pending.filter((a) => a.kind === "open_craigslist_reply");
  for (const a of pending) {
    if (a.kind === "open_craigslist_reply") continue;
    out.push({ key: a.id, kind: NEED_KIND[a.kind] ?? "decision", approvalId: a.id, title: a.title, body: a.body || undefined, options: a.options });
  }
  if (cl.length) out.push({ key: `cl:${cl.map((a) => a.id).join(",")}`, kind: "craigslist_replies", title: "", items: cl.map((a) => ({ approvalId: a.id, listingId: a.listingId, title: a.title, url: String(a.payload?.url ?? ""), message: a.body })) });
  return out.sort((a, b) => Number(b.kind === "autopilot_consent") - Number(a.kind === "autopilot_consent"));
}
/** Autopilot stage to the step that is live on the track. */
const STAGE_STEP: Record<string, string> = { consent: "Contact", outreach: "Contact", waiting: "Negotiate", negotiating: "Negotiate", scheduling: "Book" };

interface SR { lang: string; interimResults: boolean; continuous?: boolean; onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null; onend: (() => void) | null; start(): void; stop(): void }
type SRCtor = new () => SR;

const LA = "America/Los_Angeles";
const fmtLong = (iso: string) => new Date(iso).toLocaleString("en-US", { timeZone: LA, weekday: "long", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) + " PT";
const clean = (t: string) => t.replace(/^Viewing: /, "").replace(/^\[DEMO DATA\]\s*/, "");
const short = (t: string, n = 38) => { const c = clean(t); return c.length > n ? `${c.slice(0, n - 1).trimEnd()}…` : c; };
const GREETING = "Tell me what you need and I'll handle the rest.";
const SCAN_STEPS = ["Scanning Craigslist", "Normalizing prices", "Comparing to SF medians", "Checking reused photos", "Checking payment red flags", "Ranking"];
const CONSENT = ["Yes, go", "I'll approve each step"];
const AP_TIP = "Emails, negotiates and books for you.";
const kindOf = (a: Approval) => a.kind as string;
/** In-browser ElevenLabs session (fallback when telephony isn't ready): loaded from the CDN only when used. */
const EL_CLIENT = "https://cdn.jsdelivr.net/npm/@elevenlabs/client@1.27.0/+esm";
interface ElSession { endSession(): Promise<void> }
interface ElClient { Conversation: { startSession(o: { signedUrl: string; dynamicVariables?: Record<string, string | number>; onConnect?: (p: { conversationId: string }) => void; onDisconnect?: () => void; onError?: (m: string) => void }): Promise<ElSession> } }

/** Time of the last Reset in this browser; servers drop sessions older than it (see ensureEpoch). */
/** Per-user key: a Reset by one account in this browser must not hide another account's threads. */
let RESET_KEY = "sniper-reset-at";
const resetMark = () => { try { return localStorage.getItem(RESET_KEY) ?? ""; } catch { return ""; } };
const withMark = <X extends object>(snap: X | null) => ({ ...(snap ?? {}), resetAt: resetMark() });

type CallLite = { id: string; status: string; transcript: unknown[] };
function mergeCallLists<C extends CallLite>(a: C[] | undefined, b: C[] | undefined): C[] {
  const out = new Map<string, C>();
  for (const c of [...(a ?? []), ...(b ?? [])]) {
    const o = out.get(c.id);
    if (!o || (o.status === "calling" && c.status !== "calling") || (o.status === c.status && c.transcript.length >= o.transcript.length)) out.set(c.id, c); // ties: the newer copy (live chips)
  }
  return [...out.values()];
}

/** Session expired (multi-tenant): back to the login page. */
const signedOut = (r: Response) => { if (r.status === 401) location.assign("/login"); };
async function post<T>(url: string, body?: unknown, timeoutMs = 60000): Promise<T> {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}), signal: AbortSignal.timeout(timeoutMs) });
  signedOut(r);
  return (await r.json()) as T;
}

function Scanning() {
  const [i, setI] = useState(0);
  useEffect(() => { const id = setInterval(() => setI((x) => Math.min(x + 1, SCAN_STEPS.length - 1)), 1400); return () => clearInterval(id); }, []);
  return (
    <div className="scanning">
      <div className="radar"><i /><Bot size={44} /></div>
      <ul>{SCAN_STEPS.map((t, k) => <li key={t} className={k < i ? "done" : k === i ? "now" : ""} style={{ "--i": k } as React.CSSProperties}>{k < i ? "✓" : k === i ? <span className="spin" /> : "·"} {t}</li>)}</ul>
    </div>
  );
}

const usd = (n: number) => `$${n.toLocaleString("en-US")}`;
type Status = Pick<StatusInput, "label" | "detail" | "tone">;
/** The status bar's one headline ("Negotiating · offered $3,600 (asked $3,800)"), read from the state itself. */
function deriveStatus(s: S | null, threads: Thread[], pending: Approval[], calling: boolean, autopilot: boolean): Status {
  if (!s) return { label: "Getting ready", tone: "wait" };
  if (calling) return { label: "On the phone", detail: "negotiating for you", tone: "live" };
  const ordered = [...threads].sort((a, b) => (b.messages.at(-1)?.at ?? "").localeCompare(a.messages.at(-1)?.at ?? ""));
  const booked = ordered.find((x) => x.status === "booked");
  if (booked || s.events.length) {
    // The ticket below carries the date; the bar only says the job is done.
    return { label: "Booked", tone: "ok" };
  }
  const p = pending.find((x) => kindOf(x) !== "open_craigslist_reply");
  if (p) {
    const k = kindOf(p);
    return { label: k === "autopilot_consent" ? "Pick one to go after" : "Waiting for your OK", detail: k === "send_contact" ? "to email" : k === "book_viewing" ? "to book" : undefined, tone: "wait" };
  }
  const t = ordered[0];
  if (t) {
    const d = deal(t);
    if (t.deal?.agreed) return { label: "Booking", detail: `agreed ${usd(t.deal.agreed)}`, tone: "live" };
    if (d?.offered) return { label: "Negotiating", detail: `offered ${usd(d.offered)} (asked ${usd(d.asked)})`, tone: "live" };
    if (t.status === "flagged") return { label: "Guarding", detail: "refused money before a viewing", tone: "guard" };
    if (t.status === "viewing_proposed") return { label: "Scheduling", detail: "sent viewing times", tone: "live" };
    if (t.messages.at(-1)?.from === "landlord") return { label: "Negotiating", detail: "reading the reply", tone: "live" };
    if (t.status === "active") return { label: "Negotiating", detail: "asked for a video tour", tone: "live" };
    return { label: "Contacting", detail: "emailed the landlord", tone: "wait" };
  }
  if (s.results.length) return { label: "Matches ready", detail: autopilot ? "contacting the best one" : "pick one", tone: "wait" };
  if (s.searchReport || s.flagged.length) return { label: "No safe matches", detail: "try a bigger budget", tone: "guard" };
  return { label: "Waiting for your request", tone: "wait" };
}

/** Header account menu: who you are, system status, Check mail, Reset, sign out. */
function Account({ user, modes, onCheck, onReset }: { user: { email: string | null; guest: boolean } | null; modes?: Modes; onCheck: () => void; onReset: () => void }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const off = (e: PointerEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", off); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", off); document.removeEventListener("keydown", esc); };
  }, [open]);
  const m = modes;
  const live = m ? [m.llm !== "mock" && "OpenAI", m.craigslist === "live" && "Craigslist", m.mail !== "mock" && "AgentMail", m.calendar !== "mock" && "Calendar"].filter(Boolean) as string[] : [];
  const name = user ? (user.guest ? "Guest" : user.email ?? "Account") : "Local session";
  return <div className="acct" ref={wrap}>
    <button type="button" className="acct-btn" aria-haspopup="menu" aria-expanded={open} aria-label={`Account: ${name}`} onClick={() => setOpen((x) => !x)}>
      {name[0]?.toUpperCase() ?? "?"}<i className={live.length ? "on" : ""} aria-hidden="true" /></button>
    {open && <div className="acct-pop" role="menu">
      <div className="acct-who" title={name}>{name}</div>
      {m && <details className="acct-sys">
        <summary>{live.length ? `${live.length} live: ${live.join(", ")}` : "Running on mock backends"}</summary>
        {([["LLM", m.llm, m.llm !== "mock"], ["Craigslist", m.craigslist, m.craigslist === "live"], ["Mail", m.mail, m.mail !== "mock"], ["Calendar", m.calendar, m.calendar !== "mock"], ["Voice", m.voice, true]] as [string, string, boolean][])
          .map(([k, v, on]) => <div key={k}><i className={on ? "on" : ""} />{k}<b>{v}</b></div>)}
        {m.agentInbox && <div className="acct-inbox">Agent inbox: {m.agentInbox}</div>}
      </details>}
      <button type="button" role="menuitem" onClick={() => { onCheck(); setOpen(false); }}>Check mail</button>
      <button type="button" role="menuitem" onClick={() => { onReset(); setOpen(false); }}>Reset</button>
      <Link role="menuitem" className="acct-link" href="/#agents">Use from your AI agent</Link>
      {user && <form action="/auth/signout" method="post"><button type="submit" role="menuitem">Sign out</button></form>}
    </div>}
  </div>;
}

export default function Dashboard({ elevenLabsAgentId, user = null }: { elevenLabsAgentId: string | null; user?: { id: string; email: string | null; guest: boolean } | null }) {
  if (user) RESET_KEY = `sniper-reset-at:${user.id}`;
  const [s, setS] = useState<S | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [searching, setSearching] = useState(false);
  const [listening, setListening] = useState(false);
  const [heard, setHeard] = useState("");
  const speak = false; // Reading chat replies aloud added noise to the demo; the phone call is the voice moment.
  const [lang, setLang] = useState("en-US");
  const [tab, setTab] = useState<"ranked" | "flagged">("ranked");
  const [view, setView] = useState<"list" | "map">("list");
  const [mobile, setMobile] = useState<"home" | "places" | "activity">("home");
  const [pane, setPane] = useState<"home" | "activity">("home");
  const [openThread, setOpenThread] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);
  const [moment, setMoment] = useState<MomentData | null>(null);
  const [xray, setXray] = useState<string | null>(null);
  const [demo, setDemo] = useState(false);
  const [apLocal, setApLocal] = useState<boolean | null>(null);
  // Stable callbacks: the 2.5s poll re-renders, and a fresh onDone would restart the moment's auto-dismiss timer.
  const closeMoment = useCallback(() => setMoment(null), []);
  const closeXray = useCallback(() => setXray(null), []);
  const recRef = useRef<SR | null>(null);
  const chatEnd = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  // Serverless: requests can hit different instances. Keep the newest session we have seen and carry it back.
  const best = useRef<S | null>(null);
  const adopt = useCallback((next: S | undefined) => {
    if (!next) return;
    const b = best.current;
    // A call can be known to only some instances: keep the most advanced copy of each call across responses.
    const calls = mergeCallLists(b?.calls, next.calls);
    if (b && (b.version ?? "") > (next.version ?? "")) { const merged = { ...b, threads: next.threads, modes: next.modes, autopilot: next.autopilot ?? b.autopilot, calls }; best.current = merged; setS(merged); return; }
    best.current = { ...next, calls }; setS(best.current);
  }, []);
  const refresh = useCallback(async () => { const r = await fetch(`/api/state?resetAt=${encodeURIComponent(resetMark())}`, { cache: "no-store" }); signedOut(r); adopt((await r.json()) as S); }, [adopt]);
  const call = useCallback(async <T,>(url: string, body: Record<string, unknown> = {}) => {
    const r = await post<T & { state?: S }>(url, { ...body, snapshot: withMark(best.current) });
    adopt(r.state);
    return r;
  }, [adopt]);
  useEffect(() => { void refresh(); const id = setInterval(() => void refresh(), 2500); return () => clearInterval(id); }, [refresh]);
  useEffect(() => { setDemo(new URLSearchParams(window.location.search).get("demo") === "1"); }, []);
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const q = window.matchMedia("(max-width: 1000px)");
    const on = () => setNarrow(q.matches); on();
    q.addEventListener("change", on); return () => q.removeEventListener("change", on);
  }, []);
  const mailLive = s?.modes.mail === "agentmail";
  useEffect(() => {
    if (!mailLive) return;
    const id = setInterval(() => { void call("/api/mail/poll"); }, 15000);
    return () => clearInterval(id);
  }, [mailLive, call]);

  // Reset hides AgentMail threads with no activity after the reset (they're rebuilt from the inbox).
  const [resetAt, setResetAt] = useState("");
  useEffect(() => { setResetAt(resetMark()); }, []);
  const threads = useMemo(() => (s?.threads ?? []).filter((t) => !resetAt || t.messages.some((x) => x.at > resetAt)), [s?.threads, resetAt]);
  const pending = useMemo(() => (s?.approvals ?? []).filter((a) => a.status === "pending")
    .sort((a, b) => Number(kindOf(b) === "autopilot_consent") - Number(kindOf(a) === "autopilot_consent")), [s?.approvals]);
  const needs = useMemo(() => needsOf(s, pending), [s, pending]);

  // Moments: fire once per new scam refusal / booking. Mail can be processed on another instance (webhook),
  // so we watch the threads themselves, not only this instance's timeline.
  const seen = useRef<Set<string> | null>(null);
  const lastMoment = useRef(0);
  // While the call stage is up, moments wait: the booking lands mid-call, but VIEWING BOOKED plays after the stage collapses.
  const staged = useRef(false);
  const heldMoment = useRef<MomentData | null>(null);
  const fire = useCallback((m: MomentData) => {
    if (staged.current) { if (heldMoment.current?.kind !== "booked") heldMoment.current = m; return; }
    if (Date.now() - lastMoment.current < 5000) return;
    lastMoment.current = Date.now(); setMoment(m);
  }, []);
  useEffect(() => {
    if (!s) return;
    const keys: [string, () => MomentData | null][] = [];
    for (const t of threads) {
      t.messages.forEach((x, i) => {
        if (!x.flagged) return;
        const asked = Math.max(0, ...[...x.text.replace(/,/g, "").matchAll(/\$\s?(\d{3,6})(?!\d)/g)].map((m) => Number(m[1])));
        keys.push([`flag:${t.id}:${i}`, () => ({ kind: "scam", title: clean(t.listingTitle), detail: x.flagged![0].replace(/\s*\(.*\)$/, ""), saved: asked || undefined })]);
      });
      if (t.status === "booked") keys.push([`booked:${t.id}`, () => {
        const ev = s.events.find((e) => e.title.includes(t.listingTitle)) ?? s.events[0];
        return ev ? bookedMoment(t.listingTitle, ev.start) : { kind: "booked", title: clean(t.listingTitle), when: "Confirmed with the landlord", day: "✓", month: "Booked" };
      }]);
    }
    for (const e of s.events) keys.push([`ev:${e.start}`, () => bookedMoment(clean(e.title), e.start)]); // by start: instances rebuild the same booking under different ids
    for (const t of s.timeline) if (t.kind === "flag" && /^Refused/.test(t.text)) keys.push([`tl:${t.id}`, () => ({ kind: "scam", title: t.text.replace(/^Refused to contact red listing /, "").replace(/"/g, ""), detail: "Won't contact it" })]);
    if (!seen.current) { seen.current = new Set(keys.map(([k]) => k)); return; }
    for (const [k, make] of keys) {
      if (seen.current.has(k)) continue;
      seen.current.add(k);
      const m = make(); if (m) fire(m);
    }
  }, [s, threads, fire]);

  // A new "needs you" card gets a toast so it can't be missed.
  const seenNeeds = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!s) return;
    const ids = (n: Need) => n.approvalId ? [n.approvalId] : (n.items ?? []).map((x) => x.approvalId);
    if (!seenNeeds.current) { seenNeeds.current = new Set(needs.flatMap(ids)); return; }
    let fresh = false;
    for (const n of needs) {
      const nu = ids(n).filter((id) => !seenNeeds.current!.has(id));
      if (!nu.length) continue;
      nu.forEach((id) => seenNeeds.current!.add(id));
      if (n.kind === "craigslist_replies") continue; // optional, never interrupt for it
      if (n.kind === "autopilot_consent" && !window.matchMedia("(max-width: 1000px)").matches) continue; // already asked in the chat
      fresh = true;
      toast.warning("Your agent needs you", { description: needCopy(n).title });
    }
    // On a phone, jump straight to the card that needs a tap.
    if (fresh && window.matchMedia("(max-width: 1000px)").matches) setMobile("home");
  }, [s, needs]);

  // A pasted link that scores risky opens its X-ray right away.
  const lastAnalyzed = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (!s) return;
    const id = s.analyzedId ?? null;
    if (lastAnalyzed.current !== undefined && id && id !== lastAnalyzed.current) {
      const l = [...s.results, ...s.flagged].find((x) => x.id === id);
      if (l && l.scam.light !== "green") { setXray(id); setTab(l.scam.light === "red" ? "flagged" : "ranked"); setView("list"); setShowAll(true); setPane("home"); }
    }
    lastAnalyzed.current = id;
  }, [s]);

  // Rehearsal: ?preview=scam or ?preview=booked shows a moment without sending any email.
  useEffect(() => {
    const p = new URLSearchParams(window.location.search).get("preview");
    if (p === "scam") setMoment({ kind: "scam", title: "Furnished 1BR sublet near Caltrain", detail: "Asks for Zelle", saved: 7200 });
    if (p === "booked") setMoment(bookedMoment("Furnished 1BR sublet near Caltrain", new Date(Date.now() + 2 * 864e5).toISOString()));
  }, []);

  // Toast every new agent action exactly once.
  const seenTl = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!s) return;
    const tl = s.timeline;
    if (!seenTl.current) { seenTl.current = new Set(tl.map((t) => t.id)); return; }
    for (const t of [...tl].reverse()) {
      if (seenTl.current.has(t.id)) continue;
      seenTl.current.add(t.id);
      if (t.kind === "email_out") toast.success("Email sent", { description: t.text });
      else if (t.kind === "call") toast(t.text);
      else if (t.kind === "email_in") toast("Landlord replied", { description: t.text });
      // No "search done" toast: the hero and its counts already say it.
    }
  }, [s]);
  const scrolledOnce = useRef(false);
  useEffect(() => {
    if (!s?.chat.length && !busy) return;
    chatEnd.current?.scrollIntoView({ behavior: scrolledOnce.current ? "smooth" : "auto", block: "end" });
    scrolledOnce.current = true;
  }, [s?.chat.length, busy, pending.length]);

  const say = (text: string) => {
    if (!speak || typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const u = new SpeechSynthesisUtterance(text.replace(/https?:\S+/g, "")); u.lang = lang; window.speechSynthesis.cancel(); window.speechSynthesis.speak(u);
  };
  const sentAt = useRef("");
  const send = async (text: string) => {
    if (!text.trim()) return;
    sentAt.current = new Date().toISOString(); setBusy(true); setInput("");
    const isSearch = /busc|search|looking|find|encontr|1br|studio|room|depto|amobl|furnish|\$\d/i.test(text) && !/https?:\/\//.test(text);
    if (isSearch) { setSearching(true); setMobile("home"); setTab("ranked"); }
    const t0 = Date.now();
    try { const r = await call<{ reply: string }>("/api/agent", { text }); if (r.reply) say(r.reply); }
    catch { toast.error("The agent took too long", { description: "Try again in a moment." }); }
    finally {
      // Let the Now line finish its scan beats even when the search comes back instantly (snapshot mode).
      if (isSearch) await new Promise((r) => setTimeout(r, Math.max(0, 1700 - (Date.now() - t0))));
      setBusy(false); setSearching(false); void refresh();
    }
  };
  const lastMsg = s?.chat[s.chat.length - 1];
  const typing = busy && !(lastMsg?.role === "assistant" && lastMsg.at > sentAt.current);
  const mic = () => {
    const w = window as unknown as { SpeechRecognition?: SRCtor; webkitSpeechRecognition?: SRCtor };
    const C = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!C) { toast.error("Voice needs Chrome", { description: "Type instead." }); return; }
    if (listening) { recRef.current?.stop(); return; }
    const rec = new C(); rec.lang = lang; rec.interimResults = true;
    let sent = false; setHeard("");
    rec.onresult = (e) => {
      const rs = Array.from(e.results);
      const t = rs.map((r) => r[0].transcript).join(" ").trim();
      setHeard(t);
      if (!sent && rs.length && rs.every((r) => r.isFinal)) { sent = true; rec.stop(); void send(t); }
    };
    rec.onend = () => { setListening(false); setTimeout(() => setHeard(""), 400); };
    recRef.current = rec; setListening(true); rec.start();
  };
  const approve = async (id: string, ok: boolean, answer?: string, opened = false) => {
    const approval = s?.approvals.find((x) => x.id === id);
    let r = await call<{ openUrl?: string; error?: string }>("/api/approve", { id, approve: ok, answer, approval });
    // Older backends validate the approval kind strictly; retry without carrying it.
    if (r.error === "bad body") r = await call<{ openUrl?: string; error?: string }>("/api/approve", { id, approve: ok, answer });
    if (r.openUrl && !opened) window.open(r.openUrl, "_blank", "noopener");
    if (r.error) toast.error("Couldn't do that", { description: r.error });
    if (ok && approval?.kind === "send_contact") setMobile("home");
    void refresh();
  };
  // The one human step: copy the drafted message, open the real listing (in the click, so popup blockers allow it), mark it taken.
  const openAndPaste = (d: CraigslistDraft) => {
    void navigator.clipboard?.writeText(d.message).catch(() => undefined);
    if (d.url) window.open(d.url, "_blank", "noopener");
    toast.success("Message copied", { description: "Click Reply and paste." });
    void approve(d.approvalId, true, undefined, !!d.url);
  };
  // Phone the demo landlord (ElevenLabs outbound call, or the simulator in VOICE_MODE=mock).
  const callLandlord = async (threadId: string) => {
    const r = await call<{ error?: string }>("/api/voice/call", { threadId });
    if (r.error) toast.error("Couldn't call", { description: r.error });
  };
  const elSession = useRef<ElSession | null>(null);
  const [browserLive, setBrowserLive] = useState(false);
  const talkAsLandlord = async (threadId: string) => {
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
      const r = await call<{ error?: string; signedUrl?: string; callId?: string; dynamicVariables?: Record<string, string | number> }>("/api/voice/call", { threadId, mode: "browser" });
      if (!r.signedUrl) { toast.error("Couldn't start", { description: r.error ?? "No session" }); return; }
      const el = (await import(/* webpackIgnore: true */ EL_CLIENT)) as ElClient;
      elSession.current = await el.Conversation.startSession({ signedUrl: r.signedUrl, dynamicVariables: r.dynamicVariables,
        onConnect: ({ conversationId }) => { setBrowserLive(true); void call("/api/voice/status", { callId: r.callId, conversationId }); },
        onDisconnect: () => { setBrowserLive(false); elSession.current = null; void call("/api/voice/status", { callId: r.callId }); },
        onError: (msg) => toast.error("Voice error", { description: msg }) });
    } catch { toast.error("Couldn't start the browser call", { description: "Check mic permission." }); }
  };
  const endBrowserCall = () => { void elSession.current?.endSession(); };
  const calling = (s?.calls ?? []).some((c) => c.status === "calling");
  // Call stage: the newest live call takes the stage; it stays until it has played its ending.
  const [stageId, setStageId] = useState<string | null>(null);
  const liveCallId = [...(s?.calls ?? [])].reverse().find((c) => c.status === "calling" && Date.now() - Date.parse(c.startedAt) < 15 * 60e3)?.id;
  useEffect(() => { if (liveCallId && !stageId) { setStageId(liveCallId); staged.current = true; } }, [liveCallId, stageId]);
  const stageCall = stageId ? (s?.calls ?? []).find((c) => c.id === stageId) as LiveCall | undefined : undefined;
  const settleStage = useCallback(() => {
    setStageId(null); staged.current = false;
    const m = heldMoment.current; heldMoment.current = null;
    if (m) { lastMoment.current = Date.now(); setMoment(m); }
    if (window.matchMedia("(max-width: 1000px)").matches) setMobile("home");
  }, []);
  useEffect(() => {
    if (!calling) return;
    const id = setInterval(() => { void call("/api/voice/status"); }, 1500);
    return () => clearInterval(id);
  }, [calling, call]);
  const contact = async (id: string) => { setMobile("home"); await send(`Contact listing ${id}`).catch(() => undefined); };
  const landlord = async (preset: string) => { const r = await post<{ error?: string }>("/api/demo/landlord", { preset }); if (r.error) toast.error(r.error); void refresh(); };
  const reset = async () => { const at = new Date().toISOString(); try { localStorage.setItem(RESET_KEY, at); } catch { /* private mode */ } setResetAt(at); await post("/api/reset"); best.current = null; seen.current = null; seenNeeds.current = null; setView("list"); void refresh(); toast("Fresh start", { description: "Session cleared." }); };

  // Autopilot: the backend owns it when it reports s.autopilot; until then the toggle is optimistic and reverts on failure.
  const apOn = apLocal ?? s?.autopilot?.on ?? false;
  useEffect(() => { if (apLocal !== null && s?.autopilot?.on === apLocal) setApLocal(null); }, [s?.autopilot?.on, apLocal]);
  const toggleAutopilot = async () => {
    const on = !apOn; setApLocal(on);
    try {
      const r = await fetch("/api/autopilot", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ on, snapshot: withMark(best.current) }), signal: AbortSignal.timeout(15000) });
      if (!r.ok) throw new Error(String(r.status));
      const j = (await r.json().catch(() => ({}))) as { state?: S };
      adopt(j.state);
      toast.success(on ? "Autopilot on" : "Autopilot off", { description: on ? "Hands-free from here." : "I'll ask before each step." });
    } catch {
      setApLocal(null);
      toast.error("Autopilot isn't available yet", { description: "Approve each step for now." });
    }
  };

  const m = s?.modes;
  const scanned = s?.searchReport?.total ?? 0;
  const stats = useMemo(() => {
    const flaggedMsgs = threads.flatMap((t) => t.messages).filter((x) => x.flagged).length;
    const emails = threads.flatMap((t) => t.messages).filter((x) => x.from === "agent").length;
    const blocked = (s?.flagged.length ?? 0) + flaggedMsgs;
    const booked = (s?.events.length ?? 0) || threads.filter((t) => t.status === "booked").length;
    // Rough, stated assumptions: ~30 s to skim a listing, ~12 min per email exchanged, ~20 min to vet a scam, ~25 min to book.
    const minutes = scanned * 0.5 + emails * 12 + blocked * 20 + booked * 25;
    return { blocked, minutes };
  }, [scanned, s?.flagged, s?.events, threads]);
  // The backend reports the autopilot stage; it lights the matching step dot.
  const ap = s?.autopilot;
  const stage = ap?.stage && !busy && ap.stage !== "paused" ? STAGE_STEP[ap.stage] : undefined;
  const status = deriveStatus(s, threads, pending, calling, apOn);
  const list = tab === "ranked" ? s?.results ?? [] : s?.flagged ?? [];
  const mapListings = useMemo(() => [...(s?.results ?? []), ...(s?.flagged ?? [])], [s?.results, s?.flagged]);
  const hasResults = (s?.results.length ?? 0) + (s?.flagged.length ?? 0) > 0;
  const chat = s?.chat ?? [];
  const consent = needs.find((n) => n.kind === "autopilot_consent");
  const consentOpts = consent?.options?.length ? consent.options : CONSENT;
  // Consent = picking a listing: each chip maps to a listing id (approval payload), so any card can be the one.
  const pickIds = (s?.approvals.find((a) => a.id === consent?.approvalId)?.payload?.ids ?? []) as string[];
  const pickFor = (id: string) => { const k = pickIds.indexOf(id); return consent?.approvalId && k >= 0 && consentOpts[k] ? () => void approve(consent.approvalId!, true, consentOpts[k]) : undefined; };
  const followUps = useMemo(() => followUpsFor({ stage: s?.autopilot?.stage, results: s?.results ?? [], flagged: s?.flagged ?? [], threads, events: s?.events ?? [], consentPending: !!consent?.approvalId }),
    [s?.autopilot?.stage, s?.results, s?.flagged, s?.events, threads, consent?.approvalId]);
  const showList = (t: "ranked" | "flagged") => { setTab(t); setView("list"); setShowAll(true); setPane("home"); setMobile("places"); };
  const pickFollowUp = (f: FollowUp) => {
    if (f.consent && consent?.approvalId) { void approve(consent.approvalId, true, consentOpts[0]); return; }
    if (f.prefill !== undefined) { setInput(f.prefill); requestAnimationFrame(() => { const el = inputRef.current; if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } }); return; }
    if (f.tab) showList(f.tab);
    void send(f.text ?? f.label);
  };
  const events = s?.events ?? [];
  const calls = useMemo(() => s?.calls ?? [], [s?.calls]);
  // Decisions that need a tap (not the consent, which sits on the hero and in the chat; Craigslist drafts live in Activity).
  const homeNeeds = needs.filter((n) => n.kind !== "autopilot_consent" && n.kind !== "craigslist_replies");
  const clNeeds = needs.filter((n) => n.kind === "craigslist_replies");
  const listingOf = (approvalId?: string, listingId?: string) => {
    const lid = listingId ?? s?.approvals.find((a) => a.id === approvalId)?.listingId;
    return lid ? mapListings.find((l) => l.id === lid) : undefined;
  };

  // Which hero the Home pane shows.
  const bookedThread = threads.find((t) => t.status === "booked");
  const ui: "empty" | "searching" | "results" | "working" | "booked" =
    events.length || bookedThread ? "booked" : threads.length ? "working" : hasResults ? "results" : searching || busy ? "searching" : "empty";
  const focus = useMemo(() => [...threads].sort((a, b) => lastAt(b, callOf(b, calls)).localeCompare(lastAt(a, callOf(a, calls))))[0], [threads, calls]);

  // Activity badge: events (emails, calls) since the Activity tab was last looked at.
  const [seenAt, setSeenAt] = useState(() => new Date().toISOString());
  const stamps = useMemo(() => [...threads.flatMap((t) => t.messages.filter((x) => x.channel !== "call").map((x) => x.at)), ...calls.map((c) => c.startedAt)], [threads, calls]);
  const activityOn = narrow ? mobile === "activity" : pane === "activity";
  const newest = stamps.reduce((a, b) => (b > a ? b : a), "");
  useEffect(() => { if (activityOn && newest > seenAt) setSeenAt(newest); }, [activityOn, newest, seenAt]);
  const unread = activityOn ? 0 : stamps.filter((x) => x > seenAt).length;
  const openDeal = (id: string) => { setOpenThread(id); setPane("activity"); setMobile("activity"); };

  const needCards = homeNeeds.map((n) => <NeedCard key={n.key} n={n} listingOf={listingOf} onApprove={(id, ok, ans) => void approve(id, ok, ans)} onPaste={openAndPaste} />);
  const top = s?.results[0];
  const receipt = [scanned ? `${scanned.toLocaleString("en-US")} scanned` : null, `${stats.blocked} scam${stats.blocked === 1 ? "" : "s"} blocked`,
    `~${stats.minutes < 60 ? `${Math.max(1, Math.round(stats.minutes))} min` : `${Math.round(stats.minutes / 60)}h`} saved`].filter(Boolean).join(" · ");
  const ev = events.find((e) => bookedThread && e.title.includes(bookedThread.listingTitle)) ?? events[0];
  const bookedDeal = bookedThread ? deal(bookedThread, listingOf(undefined, bookedThread.listingId)) : null;
  const hero = ui === "searching" ? <div className="hero hx-scan"><Scanning /></div>
    : ui === "results" ? (top ? <MatchHero l={top} onXray={() => setXray(top.id)} onContact={() => void contact(top.id)} onPick={pickFor(top.id)} />
      : <div className="hero hx-none"><b>No safe matches</b></div>)
    : ui === "working" && focus ? <WorkHero t={focus} l={listingOf(undefined, focus.listingId)} call={callOf(focus, calls)} onOpen={() => openDeal(focus.id)} />
    : ui === "booked" && ev ? <BookedHero e={ev} title={bookedThread?.listingTitle ?? ev.title} receipt={receipt} gcal={gcalLink(ev)} ics={icsHref(ev)}
        saved={bookedDeal?.offered && bookedDeal.asked > bookedDeal.offered ? bookedDeal.asked - bookedDeal.offered : undefined} />
    : ui === "booked" && bookedThread ? <WorkHero t={bookedThread} l={listingOf(undefined, bookedThread.listingId)} call={callOf(bookedThread, calls)} onOpen={() => openDeal(bookedThread.id)} />
    : null;
  // A pending "Email this landlord?" already names the place: it stands in for the #1 card.
  const heroShown = ui === "results" && homeNeeds.length ? null : hero;

  const nSafe = s?.results.length ?? 0, nScam = s?.flagged.length ?? 0;
  const fullList = <>
    <div className="homes-bar">
      <div className="seg">
        <button className={tab === "ranked" ? "on" : ""} onClick={() => setTab("ranked")}>Matches <span>{nSafe}</span></button>
        <button className={`${tab === "flagged" ? "on" : ""} red`} onClick={() => setTab("flagged")}>Scams <span>{nScam}</span></button>
      </div>
      <span className="grow" />
      <div className="seg sm">
        <button className={view === "list" ? "on" : ""} onClick={() => setView("list")}>List</button>
        <button className={view === "map" ? "on" : ""} onClick={() => setView("map")}>Map</button>
      </div>
      {!narrow && <button className="ghost xs more-less" onClick={() => setShowAll(false)}>Less</button>}
    </div>
    {view === "map" ? (
      <div className="map-wrap">
        <MapView listings={mapListings} near={s?.criteria?.near ?? []} hovered={hovered} />
        <div className="map-legend"><span><i className="g" />Looks safe</span><span><i className="y" />Caution</span><span><i className="r" />Likely scam</span></div>
      </div>
    ) : (
      <div className="scroll listings">
        {searching && <div className="refreshing"><span className="spin" />Searching again…</div>}
        {list.map((l, i) => <ListingCard key={l.id} l={l} i={tab === "ranked" ? i : undefined} onContact={tab === "ranked" ? (id) => { const p = pickFor(id); if (p) p(); else void contact(id); } : undefined} pinned={l.id === s?.analyzedId} onHover={setHovered} onXray={setXray} />)}
        {!list.length && <div className="empty">{tab === "ranked" ? "No safe matches." : "No scams found."}</div>}
      </div>
    )}
  </>;
  const more = ui === "booked" ? Math.max(0, nSafe - 1) : nSafe;
  const collapsed = <div className="more">
    {ui === "results" && s?.results.slice(1, 3).map((l, i) => <MatchRow key={l.id} l={l} rank={i + 2} onHover={setHovered} onPick={pickFor(l.id)} />)}
    {hasResults && (ui === "booked"
      ? <button type="button" className="more-link" onClick={() => showList("ranked")}>{more} more if this falls through<span aria-hidden="true">▸</span></button>
      : <div className="more-links">
        <button type="button" className="more-link" onClick={() => showList("ranked")}>See all {nSafe}</button>
        {nScam > 0 && <><span aria-hidden="true">·</span><button type="button" className="more-link red" onClick={() => showList("flagged")}>{nScam} scam{nScam === 1 ? "" : "s"} blocked</button></>}
      </div>)}
  </div>;
  const listOpen = narrow || showAll;

  return (
    <>
      {elevenLabsAgentId && <Script src="https://unpkg.com/@elevenlabs/convai-widget-embed" strategy="afterInteractive" />}
      <Toaster position={narrow ? "top-center" : "bottom-right"} richColors theme="light" closeButton={!narrow} />
      <Moment m={moment} onDone={closeMoment} />
      <XRay l={xray ? mapListings.find((x) => x.id === xray) ?? null : null} onClose={closeXray} />
      <header className="top">
        <Link className="brand" href="/" aria-label="Sublet Sniper home"><Bot size={36} className="bot-wave" /><h1>Sublet Sniper</h1></Link>
        <span className="grow" />
        <div className="tip-wrap">
          <button className={`ap-toggle${apOn ? " on" : ""}`} role="switch" aria-checked={apOn} aria-describedby="ap-tip" onClick={() => void toggleAutopilot()}>
            <span className="ap-track" aria-hidden="true"><i /></span>Autopilot {apOn ? "on" : "off"}
          </button>
          <span id="ap-tip" role="tooltip" className="tip">{AP_TIP}</span>
        </div>
        <Account user={user} modes={m} onCheck={() => { void call("/api/mail/poll"); toast("Checking mail…"); }} onReset={() => void reset()} />
      </header>

      {ui !== "empty" && <StatusBar {...status} scanned={scanned} flagged={nScam} threads={threads} booked={ui === "booked"} searching={searching} stage={stage} />}
      <main className={`grid${ui === "empty" ? " solo" : ""}`} data-m={mobile} data-ui={ui} data-loading={s ? undefined : ""}>
        <section className="col col-chat">
          {narrow && ui !== "empty" && <div className="m-hero">{needCards}{heroShown}</div>}
          <div className="panel chat">
            <div className="scroll chat-scroll">
              <ChatThread chat={chat} greeting={user?.guest || !s?.profile?.name ? `Hi! ${GREETING}` : `Hi ${s.profile.name.split(" ")[0]}! ${GREETING}`} typing={typing} idle={!busy && !listening}
                consent={consent?.approvalId && narrow ? { options: consentOpts, onPick: (o) => void approve(consent.approvalId!, true, o) } : undefined}
                followUps={followUps} onFollowUp={pickFollowUp} onRetry={(t) => void send(t)} />
              <div ref={chatEnd} />
            </div>
            {(listening || heard) && <div className={`listen${listening ? " on" : ""}`} aria-live="polite">
              <div className="wave" aria-hidden="true">{Array.from({ length: 24 }, (_, i) => <i key={i} style={{ animationDelay: `${(i * 73) % 600}ms` }} />)}</div>
              <p>{heard || (lang.startsWith("es") ? "Te escucho…" : "Listening…")}</p>
            </div>}
            <form className="composer c-composer" onSubmit={(e) => { e.preventDefault(); void send(input); }}>
              <textarea ref={inputRef} rows={2} value={input} onChange={(e) => setInput(e.target.value)} aria-label="Message your agent"
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(input); } }}
                placeholder={listening ? "Listening…" : narrow ? "Describe the place, or paste a Craigslist link" : "Describe the place you want, or paste a Craigslist link"} disabled={busy} />
              <div className="c-tools">
                <button type="button" className={`mic ${listening ? "on" : ""}`} onClick={mic} data-tip={listening ? "Stop" : "Talk"} aria-label={listening ? "Stop listening" : "Talk"}>
                  {listening ? <span className="bars"><i /><i /><i /><i /></span> : <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" /></svg>}
                </button>
                <select className="c-lang" value={lang} onChange={(e) => setLang(e.target.value)} aria-label="Voice language"><option value="en-US">English</option><option value="es-AR">Español</option></select>
                <span className="grow" />
                <button className="send" disabled={busy || !input.trim()} aria-label="Send"><svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><path d="M12 19V5M6 11l6-6 6 6" stroke="currentColor" strokeWidth="2.2" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg></button>
              </div>
            </form>
            {elevenLabsAgentId && createElement("elevenlabs-convai", { "agent-id": elevenLabsAgentId })}
          </div>
        </section>

        {ui !== "empty" && <section className="col col-main" data-pane={narrow ? (mobile === "activity" ? "activity" : "home") : pane}>
          {!narrow && <div className="pane-tabs" role="tablist" aria-label="Views">
            <button role="tab" aria-selected={pane === "home"} className={pane === "home" ? "on" : ""} onClick={() => setPane("home")}>Home</button>
            <button role="tab" aria-selected={pane === "activity"} className={pane === "activity" ? "on" : ""} onClick={() => setPane("activity")} aria-label={unread ? `Activity, ${unread} new` : "Activity"}>
              Activity{unread > 0 && <span className="badge" key={unread}>{unread}</span>}</button>
          </div>}
          {(narrow ? mobile === "activity" : pane === "activity") ? (
            <div className="panel pane-act">
              <Activity threads={threads} listings={mapListings} calls={calls} chat={chat} open={openThread} onOpen={setOpenThread}
                canCall={!!m?.calls} onCall={(id) => void callLandlord(id)} onBrowser={demo && m?.browserVoice ? (id) => void talkAsLandlord(id) : undefined} onEnd={endBrowserCall} browserLive={browserLive}
                sim={demo && threads.length > 0 ? <div className="sim"><span>Simulate landlord</span>
                  {["hello", "video", "slot", "scam"].map((p) => <button key={p} className="ghost xs" onClick={() => void landlord(p)}>{p}</button>)}</div> : undefined}
                extra={clNeeds.map((n) => <NeedCard key={n.key} n={n} listingOf={listingOf} onApprove={(id, ok, ans) => void approve(id, ok, ans)} onPaste={openAndPaste} />)} />
            </div>
          ) : (
            <div className="home-pane">
              {!narrow && <>{needCards}{heroShown}</>}
              {hasResults && (listOpen ? <div className="panel homes">{fullList}</div> : collapsed)}
            </div>
          )}
        </section>}
        {/* The live call overlays the main pane (the chat stays); on a phone it is a full-screen sheet. */}
        {stageCall && <CallStage key={stageCall.id} call={stageCall} onSettled={settleStage}
          onTakeOver={() => openDeal(stageCall.threadId)}
          onEnd={stageCall.mode === "browser" && browserLive ? endBrowserCall : undefined} />}
      </main>

      {ui !== "empty" && <nav className="mnav" aria-label="Sections">
        <button className={mobile === "home" ? "on" : ""} onClick={() => setMobile("home")}>Home</button>
        <button className={mobile === "places" ? "on" : ""} onClick={() => setMobile("places")}>Places{nSafe > 0 && <span>{nSafe}</span>}</button>
        <button className={mobile === "activity" ? "on" : ""} onClick={() => setMobile("activity")} aria-label={unread ? `Activity, ${unread} new` : "Activity"}>
          Activity{unread > 0 && <span className="hot">{unread}</span>}</button>
      </nav>}
    </>
  );
}


function needCopy(n: Need): { title: string; body?: string; draft?: string } {
  switch (n.kind) {
    case "autopilot_consent": return { title: "Handle it end to end?", body: "Email, negotiate, book. No money upfront." };
    case "craigslist_replies": return { title: "Reply on Craigslist" };
    case "approve_send": return { title: "Email this landlord?", draft: n.body };
    case "confirm_booking": return { title: "Book this viewing?", body: n.body };
    // Backend questions quote the whole listing title and a reason in parentheses; the card already names the place.
    default: { const t = n.title.replace(/"[^"]*"\s*/g, "").replace(/\s*\([^)]*\)/g, "").trim(); return { title: t ? t[0].toUpperCase() + t.slice(1) : n.title, body: n.body }; }
  }
}

function Draft({ text, hidden = false }: { text: string; hidden?: boolean }) {
  const [open, setOpen] = useState(false);
  return <>
    {(!hidden || open) && <pre className={open ? "" : "clamp"}>{text}</pre>}
    <button className="th-more" onClick={() => setOpen(!open)}>{open ? "Less" : hidden ? "Preview" : "Full message"}</button>
  </>;
}

function NeedCard({ n, listingOf, onApprove, onPaste }: { n: Need; listingOf: (approvalId?: string, listingId?: string) => RankedListing | undefined; onApprove: (id: string, ok: boolean, answer?: string) => void; onPaste: (d: CraigslistDraft) => void }) {
  const c = needCopy(n);
  const listing = n.approvalId ? listingOf(n.approvalId) : undefined;
  const id = n.approvalId;
  const choices = (opts: string[]) => opts.map((o, i) => <button key={o} className={i === 0 ? "primary sm" : "ghost sm"} onClick={() => id && onApprove(id, true, o)}>{o}</button>);
  const [open, setOpen] = useState(false);
  // Craigslist hand-offs are optional extra reach, never the job: one quiet collapsed row at the bottom.
  if (n.kind === "craigslist_replies") {
    const items = n.items ?? [];
    return (
      <div className={`cl-opt${open ? " open" : ""}`}>
        <div className="cl-row">
          <span className="cl-k">Optional</span>
          <p><b>{items.length} Craigslist draft{items.length === 1 ? "" : "s"}</b></p>
          <button className="ghost xs" aria-expanded={open} aria-label={open ? "Hide Craigslist drafts" : "Open Craigslist drafts (Craigslist only lets a human click Reply)"} onClick={() => setOpen(!open)}>{open ? "Hide" : "Open"}</button>
        </div>
        {open && <ul className="cl-items">
          {items.map((d) => { const l = listingOf(d.approvalId, d.listingId); return (
            <li key={d.approvalId}>
              <div className="cl-t">{l ? short(l.title, 60) : "Craigslist listing"}{l?.priceMonthly ? <span>${l.priceMonthly.toLocaleString("en-US")}/mo</span> : null}</div>
              <Draft text={d.message} hidden />
              <div className="ap-actions"><button className="primary sm" onClick={() => onPaste(d)} aria-label="Open listing and paste the message">Open & paste</button><button className="ghost sm" onClick={() => onApprove(d.approvalId, false)}>Skip</button></div>
            </li>); })}
        </ul>}
      </div>
    );
  }
  return (
    <div className={`ap need k-${n.kind}`}>
      <div className="ap-who" aria-label="Your agent needs you"><span className="avatar sm"><Bot size={16} /></span>{listing && <em>{shortTitle(listing.title)}</em>}</div>
      <div className="ap-t">{c.title}</div>
      {c.body && <p className="ap-b">{c.body}</p>}
      {c.draft && <Draft text={c.draft} hidden />}
      <div className="ap-actions">
        {n.kind === "autopilot_consent" ? choices(n.options?.length ? n.options : CONSENT)
          : n.kind === "decision" ? choices(n.options?.length ? n.options : ["Yes", "No"])
          : <><button className="primary sm" onClick={() => id && onApprove(id, true)}>{n.kind === "approve_send" ? "Approve & send" : n.kind === "confirm_booking" ? "Book it" : "Approve"}</button>
            <button className="ghost sm" onClick={() => id && onApprove(id, false)}>Not now</button></>}
      </div>
    </div>
  );
}

const gcalStamp = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const endOf = (e: { start: string; end?: string }) => e.end ?? new Date(new Date(e.start).getTime() + 45 * 60e3).toISOString();
const NOTE = "Booked by Sublet Sniper. Pay nothing before you see the place in person.";
function gcalLink(e: { title: string; start: string; end?: string }) {
  const q = new URLSearchParams({ action: "TEMPLATE", text: e.title.replace(/\[DEMO DATA\]\s*/, ""), dates: `${gcalStamp(e.start)}/${gcalStamp(endOf(e))}`, details: NOTE, ctz: LA });
  return `https://calendar.google.com/calendar/render?${q}`;
}
function icsHref(e: { id: string; title: string; start: string; end?: string }) {
  const ics = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Sublet Sniper//EN", "BEGIN:VEVENT", `UID:${e.id}@sublet-sniper`, `DTSTAMP:${gcalStamp(new Date().toISOString())}`,
    `DTSTART:${gcalStamp(e.start)}`, `DTEND:${gcalStamp(endOf(e))}`, `SUMMARY:${e.title.replace(/\[DEMO DATA\]\s*/, "")}`, `DESCRIPTION:${NOTE}`, "END:VEVENT", "END:VCALENDAR"].join("\r\n");
  return `data:text/calendar;charset=utf-8,${encodeURIComponent(ics)}`;
}

function bookedMoment(title: string, startIso: string): MomentData {
  const d = new Date(startIso);
  return { kind: "booked", title: clean(title), when: fmtLong(startIso),
    day: d.toLocaleString("en-US", { timeZone: LA, day: "numeric" }), month: d.toLocaleString("en-US", { timeZone: LA, month: "short" }) };
}
