"use client";
import { createElement, useCallback, useEffect, useRef, useState } from "react";
import Script from "next/script";
import type { RankedListing } from "@/lib/types";
import type { Approval, ChatMsg, Thread, TimelineItem } from "@/lib/store";

interface Modes { llm: string; mail: string; calendar: string; craigslist: string; voice: string; agentInbox: string }
interface S { version?: string; results: RankedListing[]; flagged: RankedListing[]; timeline: TimelineItem[]; approvals: Approval[]; threads: Thread[]; chat: ChatMsg[];
  events: { id: string; title: string; start: string; link?: string }[]; modes: Modes; searchReport: { mode: string; total: number } | null }

interface SR { lang: string; interimResults: boolean; onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null; onend: (() => void) | null; start(): void; stop(): void }
type SRCtor = new () => SR;

const fmt = (iso: string) => new Date(iso).toLocaleString("en-US", { timeZone: "America/Los_Angeles", weekday: "short", hour: "numeric", minute: "2-digit" }) + " PT";
const SUGGEST = "Busco depto amoblado cerca de Caltrain, menos de $4k, del 1/11 al 15/12";

async function post<T>(url: string, body?: unknown): Promise<T> {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) });
  return (await r.json()) as T;
}

function ListingCard({ l, i, onContact }: { l: RankedListing; i?: number; onContact?: (id: string) => void }) {
  return (
    <div className="card">
      <div className="t"><span className={`light ${l.scam.light}`} />{i != null ? `#${i + 1} ` : ""}<a href={l.url} target="_blank" rel="noreferrer">{l.title}</a>
        {l.demo && <span className="tag">DEMO DATA</span>}</div>
      <div className="m">${l.priceMonthly?.toLocaleString("en-US") ?? "?"}/mo · {l.type} · {l.neighborhood ?? l.hood ?? "SF"}{l.distanceKm != null ? ` · ${l.distanceKm.toFixed(1)} km` : ""} · {l.source} · score {l.score}{l.furnished ? " · furnished" : ""}</div>
      {l.fit.length > 0 && <div className="m">✓ {l.fit.slice(0, 4).join(" · ")}</div>}
      {l.scam.reasons.length > 0 && <ul className="reasons">{l.scam.reasons.slice(0, 4).map((r) => <li key={r}>{r}</li>)}</ul>}
      {onContact && l.scam.light !== "red" && <div className="row" style={{ marginTop: 6 }}><button onClick={() => onContact(l.id)}>Draft contact</button></div>}
    </div>
  );
}

export default function Dashboard({ elevenLabsAgentId }: { elevenLabsAgentId: string | null }) {
  const [s, setS] = useState<S | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [speak, setSpeak] = useState(true);
  const [lang, setLang] = useState("es-AR");
  const [tab, setTab] = useState<"ranked" | "flagged">("ranked");
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
  useEffect(() => { chatEnd.current?.scrollIntoView({ behavior: "smooth" }); }, [s?.chat.length]);

  const say = (text: string) => {
    if (!speak || typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const u = new SpeechSynthesisUtterance(text.replace(/https?:\S+/g, "")); u.lang = lang; window.speechSynthesis.cancel(); window.speechSynthesis.speak(u);
  };
  const send = async (text: string) => {
    if (!text.trim()) return;
    setBusy(true); setInput("");
    try { const r = await call<{ reply: string }>("/api/agent", { text }); say(r.reply); } finally { setBusy(false); void refresh(); }
  };
  const mic = () => {
    const w = window as unknown as { SpeechRecognition?: SRCtor; webkitSpeechRecognition?: SRCtor };
    const C = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!C) { alert("Speech recognition not supported in this browser. Use Chrome, or type."); return; }
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
    if (r.error) alert(r.error);
    void refresh();
  };
  const contact = async (id: string) => { await send(`Contactá el listing ${id}`).catch(() => undefined); };
  const landlord = async (preset: string) => { const r = await post<{ error?: string }>("/api/demo/landlord", { preset }); if (r.error) alert(r.error); void refresh(); };

  const m = s?.modes;
  const pending = s?.approvals.filter((a) => a.status === "pending") ?? [];
  return (
    <>
      {elevenLabsAgentId && <Script src="https://unpkg.com/@elevenlabs/convai-widget-embed" strategy="afterInteractive" />}
      <div className="top">
        <h1>🎯 Sublet Sniper</h1>
        {m && <>
          <span className={`pill ${m.llm !== "mock" ? "live" : ""}`}>LLM: {m.llm}</span>
          <span className={`pill ${m.craigslist === "live" ? "live" : ""}`}>Craigslist: {m.craigslist}</span>
          <span className={`pill ${m.mail !== "mock" ? "live" : ""}`}>Mail: {m.mail}</span>
          <span className={`pill ${m.calendar !== "mock" ? "live" : ""}`}>Calendar: {m.calendar}</span>
          <span className="pill">Voice: {m.voice}</span>
        </>}
        <span style={{ flex: 1 }} />
        <button onClick={() => void call("/api/mail/poll")}>Check mail</button>
        <button onClick={async () => { await post("/api/reset"); best.current = null; void refresh(); }}>Reset</button>
      </div>
      <div className="grid">
        <div className="col">
          <div className="panel" style={{ flex: 1 }}>
            <h2>Agent</h2>
            <div className="scroll">
              {(s?.chat ?? []).length === 0 && <div className="m" style={{ color: "var(--mute)" }}>Try: <a href="#" onClick={(e) => { e.preventDefault(); void send(SUGGEST); }}>{SUGGEST}</a></div>}
              {s?.chat.map((c, i) => <div key={i} className={`msg ${c.role}`}>{c.text}</div>)}
              {busy && <div className="msg assistant typing"><i /><i /><i /></div>}
              <div ref={chatEnd} />
            </div>
            <form className="row" style={{ marginTop: 8 }} onSubmit={(e) => { e.preventDefault(); void send(input); }}>
              <button type="button" className={`mic ${listening ? "on" : ""}`} onClick={mic} title="Talk">{listening ? "■" : "🎤"}</button>
              <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask in Spanish or English…" disabled={busy} />
              <button className="primary" disabled={busy}>Send</button>
            </form>
            <div className="row" style={{ marginTop: 6, fontSize: 12, color: "var(--mute)" }}>
              <label><input type="checkbox" style={{ width: "auto" }} checked={speak} onChange={(e) => setSpeak(e.target.checked)} /> speak replies</label>
              <select value={lang} onChange={(e) => setLang(e.target.value)} style={{ background: "#0f1216", color: "var(--text)", border: "1px solid var(--line)", borderRadius: 6 }}>
                <option value="es-AR">Español</option><option value="en-US">English</option>
              </select>
            </div>
            {elevenLabsAgentId && createElement("elevenlabs-convai", { "agent-id": elevenLabsAgentId })}
          </div>
          <div className="panel" style={{ maxHeight: "34%" }}>
            <h2>Timeline</h2>
            <div className="scroll">{s?.timeline.map((t) => <div key={t.id} className={`tl ${t.kind}`}><span className="k">{t.kind}</span>{t.text}<div className="m" style={{ color: "var(--mute)" }}>{fmt(t.at)}</div></div>)}</div>
          </div>
        </div>
        <div className="col">
          <div className="panel" style={{ flex: 1 }}>
            <div className="tabs">
              <button className={tab === "ranked" ? "on" : ""} onClick={() => setTab("ranked")}>Ranked ({s?.results.length ?? 0})</button>
              <button className={tab === "flagged" ? "on" : ""} onClick={() => setTab("flagged")}>🚩 Flagged ({s?.flagged.length ?? 0})</button>
              {s?.searchReport && <span className="pill">{s.searchReport.total} scanned · {s.searchReport.mode}</span>}
            </div>
            <div className="scroll">
              {tab === "ranked" ? s?.results.map((l, i) => <ListingCard key={l.id} l={l} i={i} onContact={contact} />) : s?.flagged.map((l) => <ListingCard key={l.id} l={l} />)}
              {s && !s.results.length && <div style={{ color: "var(--mute)" }}>No search yet. Talk to the agent.</div>}
            </div>
          </div>
        </div>
        <div className="col">
          <div className="panel" style={{ maxHeight: "45%" }}>
            <h2>Approvals ({pending.length})</h2>
            <div className="scroll">
              {pending.map((a) => (
                <div key={a.id} className="ap">
                  <div className="t" style={{ fontWeight: 600 }}>{a.title}</div>
                  {a.body && <pre>{a.body}</pre>}
                  {a.kind === "open_craigslist_reply" && <div className="m" style={{ fontSize: 12, color: "var(--mute)" }}>We never auto-contact Craigslist. Approving copies the text and opens the listing; you click Reply.</div>}
                  <div className="row" style={{ marginTop: 6, flexWrap: "wrap" }}>
                    {a.kind === "decision" ? (a.options ?? ["Yes", "No"]).map((o) => <button key={o} onClick={() => void approve(a.id, true, o)}>{o}</button>) : <>
                      <button className="primary" onClick={() => { if (a.kind === "open_craigslist_reply") void navigator.clipboard?.writeText(a.body); void approve(a.id, true); }}>Approve</button>
                      <button onClick={() => void approve(a.id, false)}>Reject</button></>}
                  </div>
                </div>))}
              {!pending.length && <div style={{ color: "var(--mute)" }}>Nothing needs you right now.</div>}
              {s?.events.map((e) => <div key={e.id} className="card booked"><div className="bk">✅ Viewing booked</div><div className="t">{e.title.replace(/^Viewing: /, "")}</div><div className="when">{fmt(e.start)}</div>{e.link ? <a href={e.link} target="_blank" rel="noreferrer">Open in Google Calendar</a> : <div className="m">On your calendar · pay nothing before seeing it</div>}</div>)}
            </div>
          </div>
          <div className="panel" style={{ flex: 1 }}>
            <h2>Landlord threads</h2>
            {m?.mail === "mock" && s?.threads.length ? <div className="row" style={{ flexWrap: "wrap", marginBottom: 6, fontSize: 12 }}>
              <span style={{ color: "var(--mute)" }}>Simulate DEMO landlord:</span>
              {["hello", "video", "slot", "scam"].map((p) => <button key={p} onClick={() => void landlord(p)}>{p}</button>)}</div> : null}
            <div className="scroll">
              {s?.threads.map((t) => (
                <div key={t.id} className="card thread">
                  <div className="t">{t.listingTitle} <span className={`pill st-${t.status}`}>{({ awaiting_landlord: "⏳ waiting on landlord", active: "💬 talking", viewing_proposed: "🗓 slots offered", booked: "✅ viewing booked", flagged: "🚩 scam refused" } as Record<string, string>)[t.status] ?? t.status}</span></div>
                  <div className="m">{t.landlordEmail} · agent inbox {m?.agentInbox}</div>
                  {t.messages.map((x, i) => <div key={i} className={`msg ${x.from === "landlord" ? "lm" : "am"}`}><b>{x.from === "landlord" ? "Landlord" : "Agent"}:</b> {x.text}
                    {x.flagged && <div className="flagnote">🚩 {x.flagged.join(" · ")}</div>}</div>)}
                </div>))}
              {!s?.threads.length && <div style={{ color: "var(--mute)" }}>No conversations yet. Approve a contact for the DEMO listing.</div>}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
