"use client";
import { createElement, useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Script from "next/script";
import { Toaster, toast } from "sonner";
import { Bot } from "./Bot";
import { ListingCard } from "./ui/ListingCard";
import { Stats, type StatValues } from "./ui/Stats";
import { Moment, type MomentData } from "./ui/Moment";
import { Inbox } from "./ui/Inbox";
import { Mission } from "./ui/Mission";
import { XRay } from "./ui/XRay";
import type { Criteria, RankedListing } from "@/lib/types";
import type { Approval, ChatMsg, Thread, TimelineItem } from "@/lib/store";

const MapView = dynamic(() => import("./ui/MapView"), { ssr: false, loading: () => <div className="map map-loading" /> });

interface Modes { llm: string; mail: string; calendar: string; craigslist: string; voice: string; agentInbox: string }
interface S { version?: string; analyzedId?: string | null; criteria?: Criteria | null; results: RankedListing[]; flagged: RankedListing[]; timeline: TimelineItem[]; approvals: Approval[]; threads: Thread[]; chat: ChatMsg[];
  events: { id: string; title: string; start: string; link?: string }[]; modes: Modes; searchReport: { mode: string; total: number } | null }

interface SR { lang: string; interimResults: boolean; onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null; onend: (() => void) | null; start(): void; stop(): void }
type SRCtor = new () => SR;

const LA = "America/Los_Angeles";
const fmt = (iso: string) => new Date(iso).toLocaleString("en-US", { timeZone: LA, weekday: "short", hour: "numeric", minute: "2-digit" }) + " PT";
const fmtLong = (iso: string) => new Date(iso).toLocaleString("en-US", { timeZone: LA, weekday: "long", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) + " PT";
const ICON: Record<string, string> = { search: "🔎", scam: "🛡️", draft: "✍️", email_out: "📤", email_in: "📩", calendar: "📅", decision: "🤔", flag: "🚩", info: "·" };
const SUGGEST = "Busco 1BR amoblado en SF, menos de $4000, del 1/11 al 15/12";
const CHIPS = [SUGGEST, "Furnished room near Caltrain under $2,500 for November", "¿Cómo detectás si un aviso es un scam?"];
const SCAN_STEPS = ["Scanning Craigslist sublets, rooms and apartments", "Normalizing prices to monthly", "Comparing every price to SF medians", "Checking photos for reuse across listings", "Looking for wire, Zelle and out-of-country red flags", "Ranking by fit, distance and dates"];

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
      <ul>{SCAN_STEPS.map((t, k) => <li key={t} className={k < i ? "done" : k === i ? "now" : ""}>{k < i ? "✓" : k === i ? <span className="spin" /> : "·"} {t}</li>)}</ul>
    </div>
  );
}

function Hero({ onTry }: { onTry: (t: string) => void }) {
  return (
    <div className="hero">
      <h2>Finds the sublet, blocks the scammers, books the viewing.</h2>
      <p>Tell it what you need by voice or text, in Spanish or English. It searches Craigslist live, scores every listing for scams, emails landlords as you and puts the viewing on your calendar. You only approve.</p>
      <div className="specimen" aria-hidden="true">
        <div className="sp sp-bad">
          <div className="sp-photo"><span>SCAM</span></div>
          <div className="sp-body"><b>$1,100<small>/mo</small></b><span>Sunny 1BR on Ortega St</span><em>“I&apos;m abroad, Zelle the deposit and I&apos;ll mail the keys”</em></div>
          <div className="sp-score red">94</div>
        </div>
        <div className="sp sp-good">
          <div className="sp-photo ok" />
          <div className="sp-body"><b>$3,600<small>/mo</small></b><span>Furnished 1BR near Caltrain</span><em>Landlord offered a video tour Monday after 5pm</em></div>
          <div className="sp-score green">8</div>
        </div>
      </div>
      <button className="primary lg" onClick={() => onTry(SUGGEST)}>Search: “{SUGGEST}”</button>
    </div>
  );
}

export default function Dashboard({ elevenLabsAgentId }: { elevenLabsAgentId: string | null }) {
  const [s, setS] = useState<S | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [searching, setSearching] = useState(false);
  const [listening, setListening] = useState(false);
  const [speak, setSpeak] = useState(true);
  const [lang, setLang] = useState("es-AR");
  const [tab, setTab] = useState<"ranked" | "flagged">("ranked");
  const [view, setView] = useState<"list" | "map">("list");
  const [side, setSide] = useState<"inbox" | "activity">("inbox");
  const [mobile, setMobile] = useState<"chat" | "homes" | "inbox">("chat");
  const [hovered, setHovered] = useState<string | null>(null);
  const [moment, setMoment] = useState<MomentData | null>(null);
  const [xray, setXray] = useState<string | null>(null);
  const recRef = useRef<SR | null>(null);
  const chatEnd = useRef<HTMLDivElement | null>(null);

  // Serverless: requests can hit different instances. Keep the newest session we have seen and carry it back.
  const best = useRef<S | null>(null);
  const adopt = useCallback((next: S | undefined) => {
    if (!next) return;
    const b = best.current;
    if (b && (b.version ?? "") > (next.version ?? "")) { const merged = { ...b, threads: next.threads, modes: next.modes }; best.current = merged; setS(merged); return; }
    best.current = next; setS(next);
  }, []);
  const refresh = useCallback(async () => { const r = await fetch("/api/state", { cache: "no-store" }); adopt((await r.json()) as S); }, [adopt]);
  const call = useCallback(async <T,>(url: string, body: Record<string, unknown> = {}) => {
    const r = await post<T & { state?: S }>(url, { ...body, snapshot: best.current ?? undefined });
    adopt(r.state);
    return r;
  }, [adopt]);
  useEffect(() => { void refresh(); const id = setInterval(() => void refresh(), 2500); return () => clearInterval(id); }, [refresh]);
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
      t.messages.forEach((x, i) => { if (x.flagged) keys.push([`flag:${t.id}:${i}`, () => ({ kind: "scam", title: t.listingTitle.replace(/^\[DEMO DATA\]\s*/, ""), detail: `Landlord asked for: ${x.flagged!.join(", ")}` })]); });
      if (t.status === "booked") keys.push([`booked:${t.id}`, () => {
        const ev = s.events.find((e) => e.title.includes(t.listingTitle)) ?? s.events[0];
        return ev ? bookedMoment(t.listingTitle, ev.start) : { kind: "booked", title: t.listingTitle.replace(/^\[DEMO DATA\]\s*/, ""), when: "Confirmed with the landlord", day: "✓", month: "BOOKED" };
      }]);
    }
    for (const e of s.events) keys.push([`ev:${e.id}`, () => bookedMoment(e.title.replace(/^Viewing: /, ""), e.start)]);
    for (const t of s.timeline) if (t.kind === "flag" && /^Refused/.test(t.text)) keys.push([`tl:${t.id}`, () => ({ kind: "scam", title: t.text.replace(/^Refused to contact red listing /, "").replace(/"/g, ""), detail: "Your agent will not contact a listing it scored as a likely scam." })]);
    if (!seen.current) { seen.current = new Set(keys.map(([k]) => k)); return; }
    for (const [k, make] of keys) {
      if (seen.current.has(k)) continue;
      seen.current.add(k);
      const m = make(); if (m) fire(m);
    }
  }, [s, threads, fire]);

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
    if (p === "scam") setMoment({ kind: "scam", title: "Furnished 1BR sublet near Caltrain", detail: "Landlord asked for: Zelle deposit before any viewing" });
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
  useEffect(() => { chatEnd.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [s?.chat.length, busy]);

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
    try { const r = await call<{ reply: string }>("/api/agent", { text }); if (r.reply) say(r.reply); }
    catch { toast.error("The agent took too long", { description: "Try again in a moment." }); }
    finally { setBusy(false); setSearching(false); void refresh(); }
  };
  const lastMsg = s?.chat[s.chat.length - 1];
  const typing = busy && !(lastMsg?.role === "assistant" && lastMsg.at > sentAt.current);
  const mic = () => {
    const w = window as unknown as { SpeechRecognition?: SRCtor; webkitSpeechRecognition?: SRCtor };
    const C = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!C) { toast.error("Voice needs Chrome", { description: "Speech recognition isn't supported in this browser. Type instead." }); return; }
    if (listening) { recRef.current?.stop(); return; }
    const rec = new C(); rec.lang = lang; rec.interimResults = false;
    rec.onresult = (e) => { const t = Array.from(e.results).map((r) => r[0].transcript).join(" "); void send(t); };
    rec.onend = () => setListening(false);
    recRef.current = rec; setListening(true); rec.start();
  };
  const approve = async (id: string, ok: boolean, answer?: string) => {
    const approval = s?.approvals.find((x) => x.id === id);
    const r = await call<{ openUrl?: string; error?: string }>("/api/approve", { id, approve: ok, answer, approval });
    if (r.openUrl) window.open(r.openUrl, "_blank", "noopener");
    if (r.error) toast.error("Couldn't do that", { description: r.error });
    if (ok && approval?.kind === "send_contact") { setSide("inbox"); setMobile("inbox"); }
    void refresh();
  };
  const contact = async (id: string) => { setMobile("chat"); await send(`Contactá el listing ${id}`).catch(() => undefined); };
  const landlord = async (preset: string) => { const r = await post<{ error?: string }>("/api/demo/landlord", { preset }); if (r.error) toast.error(r.error); void refresh(); };
  const reset = async () => { const at = new Date().toISOString(); localStorage.setItem("sniper-reset-at", at); setResetAt(at); await post("/api/reset"); best.current = null; seen.current = null; setView("list"); void refresh(); toast("Fresh start", { description: "Session cleared." }); };

  const m = s?.modes;
  const pending = s?.approvals.filter((a) => a.status === "pending") ?? [];
  const stats: StatValues = useMemo(() => {
    const scanned = s?.searchReport?.total ?? 0;
    const flaggedMsgs = threads.flatMap((t) => t.messages).filter((x) => x.flagged).length;
    const emails = threads.flatMap((t) => t.messages).filter((x) => x.from === "agent").length;
    const blocked = (s?.flagged.length ?? 0) + flaggedMsgs;
    const booked = (s?.events.length ?? 0) || threads.filter((t) => t.status === "booked").length;
    // Rough, stated assumptions: ~30 s to skim a listing, ~12 min per email exchanged, ~20 min to vet a scam, ~25 min to book.
    const minutes = scanned * 0.5 + emails * 12 + (s?.flagged.length ?? 0) * 20 + flaggedMsgs * 20 + booked * 25;
    // First month + deposit a scammer would ask for.
    const protectedUsd = (s?.flagged ?? []).reduce((a, l) => a + Math.min((l.priceMonthly ?? 0) * 2, 20000), 0) + flaggedMsgs * 3600 * 2;
    return { scanned, blocked, emails, minutes, protectedUsd };
  }, [s?.searchReport, s?.flagged, s?.events, threads]);
  const liveModes = m ? [m.llm !== "mock" && "OpenAI", m.craigslist === "live" && "Craigslist", m.mail !== "mock" && "AgentMail", m.calendar !== "mock" && "Calendar"].filter(Boolean) as string[] : [];
  const list = tab === "ranked" ? s?.results ?? [] : s?.flagged ?? [];
  const mapListings = useMemo(() => [...(s?.results ?? []), ...(s?.flagged ?? [])], [s?.results, s?.flagged]);
  const hasResults = (s?.results.length ?? 0) + (s?.flagged.length ?? 0) > 0;
  const chat = s?.chat ?? [];

  return (
    <>
      {elevenLabsAgentId && <Script src="https://unpkg.com/@elevenlabs/convai-widget-embed" strategy="afterInteractive" />}
      <Toaster position="bottom-right" richColors theme="light" closeButton />
      <Moment m={moment} onDone={() => setMoment(null)} />
      <XRay l={xray ? mapListings.find((x) => x.id === xray) ?? null : null} onClose={() => setXray(null)} />
      <header className="top">
        <div className="brand"><Bot size={36} className="bot-wave" /><h1>Sublet Sniper<small>your personal rental agent</small></h1></div>
        <Stats v={stats} />
        <span className="grow" />
        {m && <details className="sys">
          <summary><span className="live-dot" />{liveModes.length} live</summary>
          <div className="sys-pop">
            {([["LLM", m.llm, m.llm !== "mock"], ["Craigslist", m.craigslist, m.craigslist === "live"], ["Mail", m.mail, m.mail !== "mock"], ["Calendar", m.calendar, m.calendar !== "mock"], ["Voice", m.voice, true]] as [string, string, boolean][])
              .map(([k, v, on]) => <div key={k}><i className={on ? "on" : ""} />{k}<b>{v}</b></div>)}
            {m.agentInbox && <div className="sys-inbox">Agent inbox: {m.agentInbox}</div>}
          </div>
        </details>}
        <button className="ghost" onClick={() => { void call("/api/mail/poll"); toast("Checking mail…"); }}>Check mail</button>
        <button className="ghost" onClick={() => void reset()}>Reset</button>
      </header>

      <Mission criteria={s?.criteria} scanned={stats.scanned} shown={s?.results.length ?? 0} flagged={s?.flagged.length ?? 0} threads={threads}
        booked={(s?.events.length ?? 0) > 0 || threads.some((t) => t.status === "booked")} searching={searching} />
      <main className="grid" data-m={mobile}>
        <section className="col col-chat">
          <div className="panel chat">
            <div className="ph"><span className="avatar lg"><Bot size={26} /></span><div><h2>Your agent</h2><small><span className="live-dot" />{busy ? "working…" : "online, speaks Spanish and English"}</small></div></div>
            <div className="scroll chat-scroll">
              {chat.length === 0 && <>
                <div className="chatline"><span className="avatar"><Bot size={20} /></span><div className="msg assistant">¡Hola Nicolás! Contame qué buscás y yo me encargo: busco, filtro scams, hablo con los dueños y te agendo la visita.</div></div>
                <div className="chips-col">{CHIPS.map((c) => <button key={c} className="suggest" onClick={() => void send(c)}>{c}</button>)}</div>
              </>}
              {chat.map((c, i) => <div key={i} className={`chatline ${c.role}`}>{c.role !== "user" && <span className="avatar"><Bot size={20} /></span>}<div className={`msg ${c.role}`}>{c.text}</div></div>)}
              {typing && <div className="chatline"><span className="avatar"><Bot size={20} /></span><div className="msg assistant typing"><i /><i /><i /></div></div>}
              <div ref={chatEnd} />
            </div>
            <form className="composer" onSubmit={(e) => { e.preventDefault(); void send(input); }}>
              <button type="button" className={`mic ${listening ? "on" : ""}`} onClick={mic} title={listening ? "Stop" : "Talk"} aria-label="Talk">
                {listening ? <span className="bars"><i /><i /><i /><i /></span> : <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" /></svg>}
              </button>
              <input value={input} onChange={(e) => setInput(e.target.value)} placeholder={listening ? "Listening…" : "Describe it, or paste a Craigslist link"} disabled={busy} />
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
            {hasResults && <div className="ph homes-ph">
              <div className="seg">
                <button className={tab === "ranked" ? "on" : ""} onClick={() => setTab("ranked")}>Best matches <span>{s?.results.length ?? 0}</span></button>
                <button className={`${tab === "flagged" ? "on" : ""} red`} onClick={() => setTab("flagged")}>Scams caught <span>{s?.flagged.length ?? 0}</span></button>
              </div>
              {s?.searchReport && <span className="scanned">{s.searchReport.total} scanned live</span>}
              <span className="grow" />
              <div className="seg sm">
                <button className={view === "list" ? "on" : ""} onClick={() => setView("list")}>List</button>
                <button className={view === "map" ? "on" : ""} onClick={() => setView("map")}>Map</button>
              </div>
            </div>}
            {searching && !hasResults ? <Scanning /> : !hasResults ? <Hero onTry={(t) => void send(t)} /> : view === "map" ? (
              <div className="map-wrap">
                <MapView listings={mapListings} near={s?.criteria?.near ?? []} hovered={hovered} />
                <div className="map-legend"><span><i className="g" />Looks safe</span><span><i className="y" />Caution</span><span><i className="r" />Likely scam</span></div>
              </div>
            ) : (
              <div className="scroll listings">
                {searching && <div className="refreshing"><span className="spin" />Searching again…</div>}
                {list.map((l, i) => <ListingCard key={l.id} l={l} i={tab === "ranked" ? i : undefined} onContact={tab === "ranked" ? (id) => void contact(id) : undefined} pinned={l.id === s?.analyzedId} onHover={setHovered} onXray={setXray} />)}
                {!list.length && <div className="empty">{tab === "ranked" ? "Nothing safe matched. Try a bigger budget." : "No scams caught in this search."}</div>}
              </div>
            )}
          </div>
        </section>

        <section className="col col-inbox">
          {(pending.length > 0 || (s?.events.length ?? 0) > 0) && <div className="panel needs">
            {pending.length > 0 && <div className="ph"><h2>Needs your OK</h2><span className="badge">{pending.length}</span></div>}
            <div className="scroll">
              {pending.map((a) => (
                <div key={a.id} className="ap">
                  <div className="ap-t">{a.title}</div>
                  {a.body && <pre>{a.body}</pre>}
                  {a.kind === "open_craigslist_reply" && <div className="note">We never auto-contact Craigslist. Approving copies the text and opens the listing; you click Reply.</div>}
                  <div className="ap-actions">
                    {a.kind === "decision" ? (a.options ?? ["Yes", "No"]).map((o) => <button key={o} onClick={() => void approve(a.id, true, o)}>{o}</button>) : <>
                      <button className="primary" onClick={() => { if (a.kind === "open_craigslist_reply") void navigator.clipboard?.writeText(a.body); void approve(a.id, true); }}>{a.kind === "send_contact" ? "Approve & send" : "Approve"}</button>
                      <button className="ghost" onClick={() => void approve(a.id, false)}>Not now</button></>}
                  </div>
                </div>))}
              {s?.events.map((e) => {
                const d = new Date(e.start);
                return <div key={e.id} className="ticket-card">
                  <div className="cal sm"><span>{d.toLocaleString("en-US", { timeZone: LA, month: "short" })}</span><b>{d.toLocaleString("en-US", { timeZone: LA, day: "numeric" })}</b></div>
                  <div><div className="tk">Viewing booked</div><div className="tw">{fmtLong(e.start)}</div><div className="tt">{e.title.replace(/^Viewing: /, "").replace(/^\[DEMO DATA\]\s*/, "")}</div>
                    {e.link ? <a href={e.link} target="_blank" rel="noreferrer">Open in Google Calendar</a> : <div className="tn">On your calendar. Pay nothing before you see it.</div>}</div>
                </div>;
              })}
            </div>
          </div>}
          <div className="panel side">
            <div className="ph">
              <div className="seg">
                <button className={side === "inbox" ? "on" : ""} onClick={() => setSide("inbox")}>Landlords <span>{threads.length}</span></button>
                <button className={side === "activity" ? "on" : ""} onClick={() => setSide("activity")}>Activity <span>{s?.timeline.length ?? 0}</span></button>
              </div>
              <span className="grow" />
              {side === "activity" && <span className="live-dot" />}
            </div>
            {m?.mail === "mock" && side === "inbox" && threads.length > 0 && <div className="sim">
              <span>Simulate landlord:</span>
              {["hello", "video", "slot", "scam"].map((p) => <button key={p} className="ghost xs" onClick={() => void landlord(p)}>{p}</button>)}</div>}
            <div className="scroll">
              {side === "inbox" ? <Inbox threads={threads} inbox={m?.agentInbox} /> : <>
                {s?.timeline.map((t) => <div key={t.id} className={`tl ${t.kind}`}><span className="ic">{ICON[t.kind] ?? "·"}</span><div><div className="txt">{t.text}</div><div className="when">{fmt(t.at)}</div></div></div>)}
                {!s?.timeline.length && <div className="empty"><b>Quiet for now</b>Every search, email and booking your agent makes streams here live.</div>}
              </>}
            </div>
          </div>
        </section>
      </main>

      <nav className="mnav" aria-label="Sections">
        <button className={mobile === "chat" ? "on" : ""} onClick={() => setMobile("chat")}>Agent</button>
        <button className={mobile === "homes" ? "on" : ""} onClick={() => setMobile("homes")}>Homes{hasResults && <span>{s?.results.length}</span>}</button>
        <button className={mobile === "inbox" ? "on" : ""} onClick={() => setMobile("inbox")}>Inbox{pending.length + threads.length > 0 && <span>{pending.length || threads.length}</span>}</button>
      </nav>
    </>
  );
}

function bookedMoment(title: string, startIso: string): MomentData {
  const d = new Date(startIso);
  return { kind: "booked", title: title.replace(/^\[DEMO DATA\]\s*/, ""), when: fmtLong(startIso),
    day: d.toLocaleString("en-US", { timeZone: LA, day: "numeric" }), month: d.toLocaleString("en-US", { timeZone: LA, month: "short" }).toUpperCase() };
}
