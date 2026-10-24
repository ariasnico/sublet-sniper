"use client";
import { createElement, useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Script from "next/script";
import Link from "next/link";
import { Toaster, toast } from "sonner";
import { Bot } from "./Bot";
import { ListingCard } from "./ui/ListingCard";
import { Moment, type MomentData } from "./ui/Moment";
import { Inbox, deal } from "./ui/Inbox";
import { Mission } from "./ui/Mission";
import type { AutopilotView, CraigslistDraft, NeedsYouItem } from "@/lib/autopilot";
import { XRay } from "./ui/XRay";
import { Rich } from "./ui/Rich";
import type { Criteria, RankedListing } from "@/lib/types";
import type { Approval, ChatMsg, Thread, TimelineItem } from "@/lib/store";

const MapView = dynamic(() => import("./ui/MapView"), { ssr: false, loading: () => <div className="map map-loading" /> });

interface Modes { llm: string; mail: string; calendar: string; craigslist: string; voice: string; agentInbox: string }
interface S { version?: string; analyzedId?: string | null; criteria?: Criteria | null; results: RankedListing[]; flagged: RankedListing[]; timeline: TimelineItem[]; approvals: Approval[]; threads: Thread[]; chat: ChatMsg[];
  events: { id: string; title: string; start: string; end?: string; link?: string }[]; modes: Modes; searchReport: { mode: string; total: number } | null; autopilot?: Partial<AutopilotView> }

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
const fmt = (iso: string) => new Date(iso).toLocaleString("en-US", { timeZone: LA, weekday: "short", hour: "numeric", minute: "2-digit" }) + " PT";
const fmtLong = (iso: string) => new Date(iso).toLocaleString("en-US", { timeZone: LA, weekday: "long", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) + " PT";
const clean = (t: string) => t.replace(/^Viewing: /, "").replace(/^\[DEMO DATA\]\s*/, "");
const short = (t: string, n = 38) => { const c = clean(t); return c.length > n ? `${c.slice(0, n - 1).trimEnd()}…` : c; };
const SUGGEST = "Busco 1BR amoblado en SF, menos de $4000, del 1/11 al 15/12";
const CHIPS = [SUGGEST, "Furnished room near Caltrain under $2,500 for November", "¿Cómo detectás si un aviso es un scam?"];
const SCAN_STEPS = ["Scanning Craigslist sublets, rooms and apartments", "Normalizing prices to monthly", "Comparing every price to SF medians", "Checking photos for reuse across listings", "Looking for wire, Zelle and out-of-country red flags", "Ranking by fit, distance and dates"];
const CONSENT = ["Yes, go", "I'll approve each step"];
const AP_TIP = "On: your agent emails safe landlords, negotiates and books. You only click Reply on real Craigslist listings.";
const kindOf = (a: Approval) => a.kind as string;

/** Time of the last Reset in this browser; servers drop sessions older than it (see ensureEpoch). */
const resetMark = () => { try { return localStorage.getItem("sniper-reset-at") ?? ""; } catch { return ""; } };
const withMark = <X extends object>(snap: X | null) => ({ ...(snap ?? {}), resetAt: resetMark() });

async function post<T>(url: string, body?: unknown, timeoutMs = 60000): Promise<T> {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}), signal: AbortSignal.timeout(timeoutMs) });
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

function FirstRun() {
  return (
    <div className="first">
      <div className="first-bot"><Bot size={104} /></div>
      <h3>Nothing here yet</h3>
      <p>Describe what you need on the left. Your agent searches Craigslist live, scores every listing for scams and ranks the safe ones here.</p>
    </div>
  );
}

/** What the agent is doing right now and what it will do next, read from the state itself (used until the backend reports it). */
function deriveNowNext(s: S | null, threads: Thread[], pending: Approval[], busy: boolean, autopilot: boolean): { now: string; next: string } {
  if (!s) return { now: "Getting ready", next: "Listen for what you need" };
  const safe = s.results.length, scams = s.flagged.length;
  const afterSearch = safe ? (autopilot ? "Email the best safe landlord as you" : "Pick a place and let your agent reach out") : "Search again with a bigger budget";
  const base = ((): { now: string; next: string } => {
    const p = pending[0];
    if (p) {
      const k = kindOf(p);
      if (k === "autopilot_consent") return { now: "Waiting for your OK to run on autopilot", next: "Email the best safe landlord as you" };
      if (k === "open_craigslist_reply") return { now: "Waiting for you to click Reply on Craigslist", next: "Read the landlord's answer and negotiate" };
      if (k === "send_contact") return { now: "Waiting for your OK to email the landlord", next: "Ask for a live video tour and leaseholder proof" };
      if (k === "book_viewing") return { now: `Waiting for your OK to book ${p.body.split(" with ")[0] || "the viewing"}`, next: "Put the viewing on your calendar" };
      return { now: `Waiting for your answer: ${p.title}`, next: "Keep the deal moving" };
    }
    const ordered = [...threads].sort((a, b) => (b.messages.at(-1)?.at ?? "").localeCompare(a.messages.at(-1)?.at ?? ""));
    const t = ordered.find((x) => x.status === "booked") ?? ordered[0];
    if (t) {
      const last = t.messages.at(-1);
      if (t.status === "booked") {
        const ev = s.events.find((e) => e.title.includes(t.listingTitle)) ?? s.events[0];
        return { now: ev ? `Viewing booked for ${fmt(ev.start)}` : "Viewing booked with the landlord", next: "Go see it, and pay nothing before you do" };
      }
      if (t.status === "flagged") return { now: "Refused a request for money before any viewing", next: safe > 1 ? "Move on to the next safe listing" : "Search again for safer options" };
      if (t.status === "viewing_proposed") return { now: "Offered the landlord viewing slots", next: "Book the slot the landlord picks" };
      if (last?.from === "landlord") return { now: "Reading the landlord's reply", next: "Counter under your budget and ask for a viewing" };
      if (t.status === "active") {
        const d = deal(t);
        return { now: d?.offered ? `Countered at $${d.offered.toLocaleString("en-US")}, waiting on the landlord` : "Talking with the landlord", next: "Book the first slot that fits" };
      }
      return { now: "Emailed the landlord, waiting for a reply", next: "Negotiate the price once they reply" };
    }
    if (s.searchReport || safe || scams) return { now: `Ranked ${safe} safe place${safe === 1 ? "" : "s"}, blocked ${scams} scam${scams === 1 ? "" : "s"}`, next: afterSearch };
    return { now: "Waiting for your request", next: "Search Craigslist live and score every listing" };
  })();
  return busy ? { now: "Thinking it through…", next: base.next } : base;
}

export default function Dashboard({ elevenLabsAgentId }: { elevenLabsAgentId: string | null }) {
  const [s, setS] = useState<S | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [searching, setSearching] = useState(false);
  const [listening, setListening] = useState(false);
  const [heard, setHeard] = useState("");
  const [speak, setSpeak] = useState(true);
  const [lang, setLang] = useState("es-AR");
  const [tab, setTab] = useState<"ranked" | "flagged">("ranked");
  const [view, setView] = useState<"list" | "map">("list");
  const [mobile, setMobile] = useState<"chat" | "homes" | "inbox">("chat");
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

  // Serverless: requests can hit different instances. Keep the newest session we have seen and carry it back.
  const best = useRef<S | null>(null);
  const adopt = useCallback((next: S | undefined) => {
    if (!next) return;
    const b = best.current;
    if (b && (b.version ?? "") > (next.version ?? "")) { const merged = { ...b, threads: next.threads, modes: next.modes, autopilot: next.autopilot ?? b.autopilot }; best.current = merged; setS(merged); return; }
    best.current = next; setS(next);
  }, []);
  const refresh = useCallback(async () => { const r = await fetch(`/api/state?resetAt=${encodeURIComponent(resetMark())}`, { cache: "no-store" }); adopt((await r.json()) as S); }, [adopt]);
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
  useEffect(() => { setResetAt(localStorage.getItem("sniper-reset-at") ?? ""); }, []);
  const threads = useMemo(() => (s?.threads ?? []).filter((t) => !resetAt || t.messages.some((x) => x.at > resetAt)), [s?.threads, resetAt]);
  const pending = useMemo(() => (s?.approvals ?? []).filter((a) => a.status === "pending")
    .sort((a, b) => Number(kindOf(b) === "autopilot_consent") - Number(kindOf(a) === "autopilot_consent")), [s?.approvals]);
  const needs = useMemo(() => needsOf(s, pending), [s, pending]);

  // Moments: fire once per new scam refusal / booking. Mail can be processed on another instance (webhook),
  // so we watch the threads themselves, not only this instance's timeline.
  const seen = useRef<Set<string> | null>(null);
  const lastMoment = useRef(0);
  const fire = useCallback((m: MomentData) => {
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
        keys.push([`flag:${t.id}:${i}`, () => ({ kind: "scam", title: clean(t.listingTitle), detail: `Landlord asked for: ${x.flagged!.join(", ")}`, saved: asked || undefined })]);
      });
      if (t.status === "booked") keys.push([`booked:${t.id}`, () => {
        const ev = s.events.find((e) => e.title.includes(t.listingTitle)) ?? s.events[0];
        return ev ? bookedMoment(t.listingTitle, ev.start) : { kind: "booked", title: clean(t.listingTitle), when: "Confirmed with the landlord", day: "✓", month: "Booked" };
      }]);
    }
    for (const e of s.events) keys.push([`ev:${e.id}`, () => bookedMoment(clean(e.title), e.start)]);
    for (const t of s.timeline) if (t.kind === "flag" && /^Refused/.test(t.text)) keys.push([`tl:${t.id}`, () => ({ kind: "scam", title: t.text.replace(/^Refused to contact red listing /, "").replace(/"/g, ""), detail: "Your agent will not contact a listing it scored as a likely scam." })]);
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
      nu.forEach((id) => seenNeeds.current!.add(id)); fresh = true;
      toast.warning("Your agent needs you", { description: needCopy(n).title });
    }
    // On a phone, jump straight to the card that needs a tap.
    if (fresh && window.matchMedia("(max-width: 1000px)").matches) setMobile("inbox");
  }, [s, needs]);

  // A pasted link that scores risky opens its X-ray right away.
  const lastAnalyzed = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (!s) return;
    const id = s.analyzedId ?? null;
    if (lastAnalyzed.current !== undefined && id && id !== lastAnalyzed.current) {
      const l = [...s.results, ...s.flagged].find((x) => x.id === id);
      if (l && l.scam.light !== "green") { setXray(id); setTab(l.scam.light === "red" ? "flagged" : "ranked"); setView("list"); }
    }
    lastAnalyzed.current = id;
  }, [s]);

  // Rehearsal: ?preview=scam or ?preview=booked shows a moment without sending any email.
  useEffect(() => {
    const p = new URLSearchParams(window.location.search).get("preview");
    if (p === "scam") setMoment({ kind: "scam", title: "Furnished 1BR sublet near Caltrain", detail: "Landlord asked for: Zelle deposit before any viewing", saved: 7200 });
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
      else if (t.kind === "email_in") toast("Landlord replied", { description: t.text });
      else if (t.kind === "search") toast.success("Search done", { description: t.text });
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
    if (isSearch) { setSearching(true); setMobile("homes"); setTab("ranked"); }
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
    if (!C) { toast.error("Voice needs Chrome", { description: "Speech recognition isn't supported in this browser. Type instead." }); return; }
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
    if (ok && approval?.kind === "send_contact") setMobile("inbox");
    void refresh();
  };
  // The one human step: copy the drafted message, open the real listing (in the click, so popup blockers allow it), mark it taken.
  const openAndPaste = (d: CraigslistDraft) => {
    void navigator.clipboard?.writeText(d.message).catch(() => undefined);
    if (d.url) window.open(d.url, "_blank", "noopener");
    toast.success("Message copied", { description: "Click Reply on Craigslist and paste it." });
    void approve(d.approvalId, true, undefined, !!d.url);
  };
  const contact = async (id: string) => { setMobile("chat"); await send(`Contactá el listing ${id}`).catch(() => undefined); };
  const landlord = async (preset: string) => { const r = await post<{ error?: string }>("/api/demo/landlord", { preset }); if (r.error) toast.error(r.error); void refresh(); };
  const reset = async () => { const at = new Date().toISOString(); localStorage.setItem("sniper-reset-at", at); setResetAt(at); await post("/api/reset"); best.current = null; seen.current = null; seenNeeds.current = null; setView("list"); void refresh(); toast("Fresh start", { description: "Session cleared." }); };

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
      toast.success(on ? "Autopilot on" : "Autopilot off", { description: on ? "Your agent takes it from here. You only click Reply on real Craigslist listings." : "Your agent will ask before each step." });
    } catch {
      setApLocal(null);
      toast.error("Autopilot isn't available yet", { description: "Approve each step from Deals in progress for now." });
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
  const derived = deriveNowNext(s, threads, pending, busy && !searching, apOn);
  // The backend narrates Now/Next while autopilot runs; with autopilot paused, the per-step view is more useful.
  const ap = s?.autopilot;
  const fromBackend = !!ap?.now && !busy && ap.stage !== "paused";
  const nowNext = fromBackend ? { now: ap!.now!, next: ap!.next || derived.next } : derived;
  const stage = fromBackend && ap?.stage ? STAGE_STEP[ap.stage] : undefined;
  const savedPerMonth = ap?.stats?.savedPerMonth ?? 0;
  const liveModes = m ? [m.llm !== "mock" && "OpenAI", m.craigslist === "live" && "Craigslist", m.mail !== "mock" && "AgentMail", m.calendar !== "mock" && "Calendar"].filter(Boolean) as string[] : [];
  const list = tab === "ranked" ? s?.results ?? [] : s?.flagged ?? [];
  const mapListings = useMemo(() => [...(s?.results ?? []), ...(s?.flagged ?? [])], [s?.results, s?.flagged]);
  const hasResults = (s?.results.length ?? 0) + (s?.flagged.length ?? 0) > 0;
  const chat = s?.chat ?? [];
  const consent = needs.find((n) => n.kind === "autopilot_consent");
  const events = s?.events ?? [];
  const dealsEmpty = !needs.length && !events.length && !threads.length;
  const needCount = needs.reduce((n, x) => n + (x.items?.length ?? 1), 0);
  const listingOf = (approvalId?: string, listingId?: string) => {
    const lid = listingId ?? s?.approvals.find((a) => a.id === approvalId)?.listingId;
    return lid ? mapListings.find((l) => l.id === lid) : undefined;
  };

  const needCards = needs.map((n) => <NeedCard key={n.key} n={n} listingOf={listingOf} onApprove={(id, ok, ans) => void approve(id, ok, ans)} onPaste={openAndPaste} />);
  return (
    <>
      {elevenLabsAgentId && <Script src="https://unpkg.com/@elevenlabs/convai-widget-embed" strategy="afterInteractive" />}
      <Toaster position={narrow ? "top-center" : "bottom-right"} richColors theme="light" closeButton={!narrow} />
      <Moment m={moment} onDone={closeMoment} />
      <XRay l={xray ? mapListings.find((x) => x.id === xray) ?? null : null} onClose={closeXray} />
      <header className="top">
        <Link className="brand" href="/" aria-label="Sublet Sniper home"><Bot size={36} className="bot-wave" /><h1>Sublet Sniper<small>your personal rental agent</small></h1></Link>
        <span className="grow" />
        <div className="tip-wrap">
          <button className={`ap-toggle${apOn ? " on" : ""}`} role="switch" aria-checked={apOn} aria-describedby="ap-tip" onClick={() => void toggleAutopilot()}>
            <span className="ap-track" aria-hidden="true"><i /></span>Autopilot {apOn ? "on" : "off"}
          </button>
          <span id="ap-tip" role="tooltip" className="tip">{AP_TIP}</span>
        </div>
        <button className="ghost" onClick={() => { void call("/api/mail/poll"); toast("Checking mail…"); }}>Check mail</button>
        <button className="ghost" onClick={() => void reset()}>Reset</button>
        {m && <details className="sys">
          <summary aria-label={`System status, ${liveModes.length} live integrations`} title={`${liveModes.length} live`}><span className={liveModes.length ? "live-dot" : "idle-dot"} /></summary>
          <div className="sys-pop">
            <div className="sys-h">{liveModes.length ? `${liveModes.length} live: ${liveModes.join(", ")}` : "Running on mock backends"}</div>
            {([["LLM", m.llm, m.llm !== "mock"], ["Craigslist", m.craigslist, m.craigslist === "live"], ["Mail", m.mail, m.mail !== "mock"], ["Calendar", m.calendar, m.calendar !== "mock"], ["Voice", m.voice, true]] as [string, string, boolean][])
              .map(([k, v, on]) => <div key={k}><i className={on ? "on" : ""} />{k}<b>{v}</b></div>)}
            {m.agentInbox && <div className="sys-inbox">Agent inbox: {m.agentInbox}</div>}
            <Link className="sys-link" href="/#agents">Use Sublet Sniper from your AI agent</Link>
            <div className="sys-actions">
              <button className="ghost sm" onClick={() => { void call("/api/mail/poll"); toast("Checking mail…"); }}>Check mail</button>
              <button className="ghost sm" onClick={() => void reset()}>Reset</button>
            </div>
          </div>
        </details>}
      </header>

      <Mission criteria={s?.criteria} scanned={scanned} shown={s?.results.length ?? 0} flagged={s?.flagged.length ?? 0} threads={threads}
        booked={events.length > 0 || threads.some((t) => t.status === "booked")} searching={searching}
        now={nowNext.now} next={nowNext.next} stage={stage} blocked={stats.blocked} minutes={stats.minutes} />
      <main className="grid" data-m={mobile}>
        <section className="col col-chat">
          <div className="panel chat">
            <div className="ph"><span className="avatar lg"><Bot size={26} /></span><div><h2>Talk to your agent</h2><small>{busy ? <><span className="live-dot" />Working…</> : "Spanish or English, voice or text"}</small></div></div>
            <div className="scroll chat-scroll">
              {chat.length === 0 && <>
                <div className="chatline"><span className="avatar"><Bot size={20} /></span><div className="msg assistant">¡Hola Nicolás! Contame qué buscás y yo me encargo: busco, filtro scams, hablo con los dueños y te agendo la visita.</div></div>
                <div className="chips-col">{CHIPS.map((c, k) => <button key={c} className="suggest" style={{ "--i": k } as React.CSSProperties} onClick={() => void send(c)}>{c}</button>)}</div>
              </>}
              {chat.map((c, i) => {
                // Consecutive messages from one side read as a group: one avatar, on the last bubble, which keeps the tail.
                const side = (x?: ChatMsg) => x && (x.role === "user" ? "user" : "agent");
                const head = side(chat[i - 1]) !== side(c), tail = side(chat[i + 1]) !== side(c) && !(typing && c.role !== "user" && i === chat.length - 1);
                return <div key={i} className={`chatline ${c.role}${c.auto ? " auto" : ""}${head ? "" : " cont"}${tail ? " tail" : ""}`}>{c.role !== "user" && <span className={`avatar${tail ? "" : " hold"}`} aria-hidden={!tail || undefined}>{tail && <Bot size={20} />}</span>}
                <div className={`msg ${c.role}`}>{c.auto && !chat[i - 1]?.auto && <span className="auto-k"><i aria-hidden="true" />Autopilot update</span>}{c.role === "assistant" ? <Rich text={c.text} /> : c.text}</div></div>;
              })}
              {consent?.approvalId && !typing && <div className="chat-cta" role="group" aria-label="Let your agent run on autopilot?">
                {(consent.options?.length ? consent.options : CONSENT).map((o, k) => <button key={o} className={k === 0 ? "primary sm" : "ghost sm"} onClick={() => void approve(consent.approvalId!, true, o)}>{o}</button>)}
              </div>}
              {typing && <div className={`chatline assistant tail${lastMsg && lastMsg.role !== "user" ? " cont" : ""}`} aria-label="Your agent is typing"><span className="avatar"><Bot size={20} /></span><div className="msg assistant typing"><i /><i /><i /></div></div>}
              <div ref={chatEnd} />
            </div>
            {(listening || heard) && <div className={`listen${listening ? " on" : ""}`} aria-live="polite">
              <div className="wave" aria-hidden="true">{Array.from({ length: 24 }, (_, i) => <i key={i} style={{ animationDelay: `${(i * 73) % 600}ms` }} />)}</div>
              <p>{heard || (lang.startsWith("es") ? "Te escucho…" : "Listening…")}</p>
            </div>}
            <form className="composer" onSubmit={(e) => { e.preventDefault(); void send(input); }}>
              <button type="button" className={`mic ${listening ? "on" : ""}`} onClick={mic} title={listening ? "Stop" : "Talk"} aria-label="Talk">
                {listening ? <span className="bars"><i /><i /><i /><i /></span> : <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" /></svg>}
              </button>
              <textarea rows={2} value={input} onChange={(e) => setInput(e.target.value)} aria-label="Message your agent"
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(input); } }}
                placeholder={listening ? "Listening…" : narrow ? "Describe the place, or paste a Craigslist link" : "Describe the place you want, or paste a Craigslist link"} disabled={busy} />
              <button className="primary send" disabled={busy || !input.trim()} aria-label="Send"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M4 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2.2" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg></button>
            </form>
            <div className="chat-opts">
              <label><input type="checkbox" checked={speak} onChange={(e) => setSpeak(e.target.checked)} /> Speak replies</label>
              <select value={lang} onChange={(e) => setLang(e.target.value)} aria-label="Voice language"><option value="es-AR">Español</option><option value="en-US">English</option></select>
            </div>
            {elevenLabsAgentId && createElement("elevenlabs-convai", { "agent-id": elevenLabsAgentId })}
          </div>
        </section>

        <section className="col col-homes">
          <div className="panel homes">
            <div className="ph ph-title"><div><h2>Places found</h2><small>Ranked by fit, every one scored for scams</small></div></div>
            {hasResults && <div className="homes-bar">
              <div className="seg">
                <button className={tab === "ranked" ? "on" : ""} onClick={() => setTab("ranked")}>{narrow ? "Matches" : "Best matches"} <span>{s?.results.length ?? 0}</span></button>
                <button className={`${tab === "flagged" ? "on" : ""} red`} onClick={() => setTab("flagged")}>{narrow ? "Scams" : "Scams caught"} <span>{s?.flagged.length ?? 0}</span></button>
              </div>
              <span className="grow" />
              <div className="seg sm">
                <button className={view === "list" ? "on" : ""} onClick={() => setView("list")}>List</button>
                <button className={view === "map" ? "on" : ""} onClick={() => setView("map")}>Map</button>
              </div>
            </div>}
            {searching && !hasResults ? <Scanning /> : !hasResults ? <FirstRun /> : view === "map" ? (
              <div className="map-wrap">
                <MapView listings={mapListings} near={s?.criteria?.near ?? []} hovered={hovered} />
                <div className="map-legend"><span><i className="g" />Looks safe</span><span><i className="y" />Caution</span><span><i className="r" />Likely scam</span></div>
              </div>
            ) : (
              <div className="scroll listings">
                {searching && <div className="refreshing"><span className="spin" />Searching again…</div>}
                {list.map((l, i) => <ListingCard key={l.id} l={l} i={tab === "ranked" ? i : undefined} onContact={tab === "ranked" ? (id) => void contact(id) : undefined} pinned={l.id === s?.analyzedId} onHover={setHovered} onXray={setXray} />)}
                {!list.length && <div className="empty">{tab === "ranked" ? "Nothing safe matched. Try a bigger budget." : "No scams in this search. Good sign."}</div>}
              </div>
            )}
          </div>
        </section>

        <section className="col col-inbox">
          <div className="panel side">
            <div className="ph"><div><h2>Deals in progress</h2><small>Each landlord your agent is talking to, as you</small></div>
              <span className="grow" />
              {savedPerMonth > 0 && <span className="saved-pill" title="Negotiated off the asking rent">Saving you ${savedPerMonth.toLocaleString("en-US")}/mo</span>}
              {needCount > 0 && <span className="badge" title="Needs you">{needCount}</span>}</div>
            {demo && threads.length > 0 && <div className="sim">
              <span>Simulate landlord</span>
              {["hello", "video", "slot", "scam"].map((p) => <button key={p} className="ghost xs" onClick={() => void landlord(p)}>{p}</button>)}</div>}
            <div className="scroll">
              {/* Once a viewing is booked it is the headline; leftover asks go below it. */}
              {!events.length && needCards}
              {events.map((e) => {
                const d = new Date(e.start);
                return <div key={e.id} className="ticket-card">
                  <div className="cal sm"><span>{d.toLocaleString("en-US", { timeZone: LA, month: "short" })}</span><b>{d.toLocaleString("en-US", { timeZone: LA, day: "numeric" })}</b></div>
                  <div><div className="tk">Viewing booked</div><div className="tw">{fmtLong(e.start)}</div><div className="tt">{clean(e.title)}</div>
                    <div className="tn">Pay nothing before you see it.</div>
                    <div className="tk-actions">{e.link ? <a href={e.link} target="_blank" rel="noreferrer">Open in Google Calendar</a> : <a href={gcalLink(e)} target="_blank" rel="noreferrer">Add to Google Calendar</a>}
                      <a href={icsHref(e)} download="viewing.ics">Download .ics</a></div></div>
                </div>;
              })}
              {events.length > 0 && needCards}
              <Inbox threads={threads} listings={mapListings} />
              {dealsEmpty && <div className="empty deals-empty">
                <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true"><path d="M4 6.5h16v11H4z M4 7l8 6 8-6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /></svg>
                <b>No deals yet</b>When your agent emails a landlord, the conversation, the price and the safety checks show up here.</div>}
            </div>
          </div>
        </section>
      </main>

      <nav className="mnav" aria-label="Sections">
        <button className={mobile === "chat" ? "on" : ""} onClick={() => setMobile("chat")}>Agent</button>
        <button className={mobile === "homes" ? "on" : ""} onClick={() => setMobile("homes")}>Places{hasResults && <span>{s?.results.length}</span>}</button>
        <button className={mobile === "inbox" ? "on" : ""} onClick={() => setMobile("inbox")} aria-label={needCount ? `Deals, ${needCount} need you` : "Deals"}>
          Deals{needCount > 0 ? <span className="hot">{needCount}</span> : threads.length > 0 && <span>{threads.length}</span>}</button>
      </nav>
    </>
  );
}

function needCopy(n: Need): { title: string; body?: string; draft?: string } {
  switch (n.kind) {
    case "autopilot_consent": return { title: "Let me handle it end to end?", body: "I'll email safe landlords as you, negotiate under your budget, refuse any money before a viewing and book the first slot that fits." };
    case "craigslist_replies": return { title: "Click Reply on Craigslist", body: "I wrote the message and copied it. Craigslist only lets a human click Reply." };
    case "approve_send": return { title: "OK to email this landlord as you?", draft: n.body };
    case "confirm_booking": return { title: "Book this viewing?", body: n.body };
    default: return { title: n.title, body: n.body };
  }
}

function Draft({ text, hidden = false }: { text: string; hidden?: boolean }) {
  const [open, setOpen] = useState(false);
  return <>
    {(!hidden || open) && <pre className={open ? "" : "clamp"}>{text}</pre>}
    <button className="th-more" onClick={() => setOpen(!open)}>{open ? "Show less" : hidden ? "Preview the message" : "Read the full message"}</button>
  </>;
}

function NeedCard({ n, listingOf, onApprove, onPaste }: { n: Need; listingOf: (approvalId?: string, listingId?: string) => RankedListing | undefined; onApprove: (id: string, ok: boolean, answer?: string) => void; onPaste: (d: CraigslistDraft) => void }) {
  const c = needCopy(n);
  const listing = n.approvalId ? listingOf(n.approvalId) : undefined;
  const id = n.approvalId;
  const choices = (opts: string[]) => opts.map((o, i) => <button key={o} className={i === 0 ? "primary sm" : "ghost sm"} onClick={() => id && onApprove(id, true, o)}>{o}</button>);
  return (
    <div className={`ap need k-${n.kind}`}>
      <div className="ap-who"><span className="avatar sm"><Bot size={16} /></span>Your agent needs you{listing && <em>{short(listing.title, 44)}</em>}</div>
      <div className="ap-t">{c.title}</div>
      {c.body && <p className="ap-b">{c.body}</p>}
      {c.draft && <Draft text={c.draft} />}
      {n.kind === "craigslist_replies" ? <ul className="cl-items">
        {(n.items ?? []).map((d) => { const l = listingOf(d.approvalId, d.listingId); return (
          <li key={d.approvalId}>
            <div className="cl-t">{l ? short(l.title, 60) : "Craigslist listing"}{l?.priceMonthly ? <span>${l.priceMonthly.toLocaleString("en-US")}/mo</span> : null}</div>
            <Draft text={d.message} hidden />
            <div className="ap-actions"><button className="primary sm" onClick={() => onPaste(d)}>Open listing & paste</button><button className="ghost sm" onClick={() => onApprove(d.approvalId, false)}>Skip this one</button></div>
          </li>); })}
      </ul> : <div className="ap-actions">
        {n.kind === "autopilot_consent" ? choices(n.options?.length ? n.options : CONSENT)
          : n.kind === "decision" ? choices(n.options?.length ? n.options : ["Yes", "No"])
          : <><button className="primary sm" onClick={() => id && onApprove(id, true)}>{n.kind === "approve_send" ? "Approve & send" : n.kind === "confirm_booking" ? "Book it" : "Approve"}</button>
            <button className="ghost sm" onClick={() => id && onApprove(id, false)}>Not now</button></>}
      </div>}
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
