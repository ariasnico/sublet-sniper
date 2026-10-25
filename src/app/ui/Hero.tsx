"use client";
/* eslint-disable @next/next/no-img-element */
import { useEffect, useRef, useState } from "react";
import type { RankedListing } from "@/lib/types";
import type { CallRecord, Thread } from "@/lib/store";
import { cardThumb } from "@/lib/photo-url";
import { loadPhotos, peekPhotos } from "./photos";
import { deal } from "./Inbox";

const LABEL = { green: "Looks safe", yellow: "Caution", red: "Likely scam" } as const;
const usd = (n: number) => `$${n.toLocaleString("en-US")}`;
export const cleanTitle = (t: string) => t.replace(/^Viewing: /, "").replace(/^\[DEMO DATA\]\s*/i, "").replace(/[\s\-–—]+$/, "");
/** Few words, enough to recognize the place: cut at the first separator, else the first n words. The full title rides in the tooltip. */
export const shortTitle = (t: string, n = 5) => {
  const c = cleanTitle(t).split(/\s+[-–—|]\s+|,\s*|\s*\(/)[0].replace(/[.!]+$/, "").trim();
  const w = c.split(/\s+/);
  return w.length > n ? `${w.slice(0, n).join(" ")}…` : c;
};

/** First photo of a listing: inline when the search prefetched it, else one batched fetch. */
function usePhoto(l?: RankedListing) {
  const inline = l?.images?.[0] ?? (l ? peekPhotos(l.url)?.[0] : undefined);
  const [fetched, setFetched] = useState<string | null>(null);
  useEffect(() => {
    if (!l || inline || l.source !== "craigslist") return;
    let alive = true;
    void loadPhotos(l.url).then((x) => { if (alive) setFetched(x[0] ?? null); });
    return () => { alive = false; };
  }, [l, inline]);
  return inline ?? fetched ?? undefined;
}

function Photo({ l, big }: { l?: RankedListing; big?: boolean }) {
  const src = usePhoto(l);
  const [ok, setOk] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const ref = useRef<HTMLImageElement | null>(null);
  useEffect(() => { if (ref.current?.complete && ref.current.naturalWidth) setLoaded(true); }, [src]);
  return <div className={`hx-photo${big ? " big" : ""}`} aria-hidden="true">
    {src && ok ? <img ref={ref} src={big ? src : cardThumb(src)} alt="" className={loaded ? "in" : ""} onLoad={() => setLoaded(true)} onError={() => setOk(false)} />
      : <svg viewBox="0 0 24 24" width="28" height="28"><path d="M3.5 11 12 4l8.5 7M6 9.5V20h4.5v-5h3v5H18V9.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>}
  </div>;
}

/** Results: the #1 match, with the one decision (consent) inline. */
export function MatchHero({ l, consent, onContact, onXray }: { l: RankedListing; consent?: { options: string[]; onPick: (o: string) => void }; onContact: () => void; onXray: () => void }) {
  return <article className="hero hx-match" aria-label="Best match">
    <div className="hx-pwrap"><Photo l={l} big /><span className="hx-rank" aria-label="Best match">#1</span></div>
    <div className="hx-body">
      <a className="hx-title" href={l.url} target="_blank" rel="noreferrer" title={cleanTitle(l.title)}>{shortTitle(l.title)}</a>
      <div className="hx-price"><b>{l.priceMonthly ? usd(l.priceMonthly) : "?"}</b><span>/mo</span>
        <button type="button" className={`hx-risk ${l.scam.light}`} onClick={onXray} aria-label={`Scam X-ray: risk ${l.scam.score} of 100`}><i aria-hidden="true" />{LABEL[l.scam.light]}</button></div>
      <div className="hx-acts">
        {consent ? consent.options.map((o, i) => <button key={o} type="button" className={i === 0 ? "primary" : "ghost"} onClick={() => consent.onPick(o)}>{o}</button>)
          : <button type="button" className="primary" onClick={onContact}>Reach out</button>}
      </div>
    </div>
  </article>;
}

type Step = { k: string; state: "ok" | "now" | "wait" | "guard" };
/** Agent working: the deal in one line of three checks. */
function stepsOf(t: Thread, call?: CallRecord, l?: RankedListing): Step[] {
  const flagged = t.messages.filter((m) => m.flagged);
  const via = flagged.map((m) => m.text).join(" ").match(/zelle|wire|venmo|cash ?app|gift ?card|bitcoin|crypto|western union/i)?.[0];
  const callFlag = call?.flags?.length || call?.transcript.some((m) => m.flagged);
  const refused = flagged.length > 0 || !!callFlag;
  const replied = t.messages.some((m) => m.from === "landlord") || (call?.transcript.length ?? 0) > 1;
  const d = deal(t, l);
  const got = t.deal?.agreed;
  return [
    { k: call?.status === "calling" ? "Calling" : t.messages.some((m) => m.channel === "call") || call ? "Called" : "Emailed", state: call?.status === "calling" ? "now" : "ok" },
    refused ? { k: `${via ? via[0].toUpperCase() + via.slice(1).toLowerCase() : "Deposit"} refused`, state: "guard" } : { k: replied ? "No money asked" : "Waiting reply", state: replied ? "ok" : "wait" },
    got ? { k: `Got ${usd(got)}`, state: "ok" } : d?.offered ? { k: `Offered ${usd(d.offered)}`, state: "now" } : { k: "Negotiating", state: replied ? "now" : "wait" },
  ];
}

export function WorkHero({ t, l, call, onOpen }: { t: Thread; l?: RankedListing; call?: CallRecord; onOpen: () => void }) {
  const steps = stepsOf(t, call, l);
  return <article className="hero hx-work" aria-label="Deal in progress">
    <Photo l={l} />
    <div className="hx-body">
      {/* The status bar already says what the agent is doing; the hero shows where. */}
      <div className="hx-title" title={cleanTitle(t.listingTitle)}>{shortTitle(t.listingTitle)}</div>
      <ol className="hx-steps">{steps.map((s, i) => <li key={i} className={s.state} style={{ "--i": i } as React.CSSProperties}>
        <i aria-hidden="true">{s.state === "ok" || s.state === "guard" ? "✓" : ""}</i><span key={s.k}>{s.k}</span></li>)}</ol>
    </div>
    <button type="button" className="hx-more" onClick={onOpen} aria-label="Open this deal in Activity">Details</button>
  </article>;
}

const LA = "America/Los_Angeles";
function dayDiff(iso: string) {
  const ymd = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: LA });
  const a = Date.parse(`${ymd(new Date())}T00:00:00Z`), b = Date.parse(`${ymd(new Date(iso))}T00:00:00Z`);
  return Math.round((b - a) / 864e5);
}
export function whenLine(iso: string) {
  const d = new Date(iso);
  const day = d.toLocaleString("en-US", { timeZone: LA, weekday: "short", month: "short", day: "numeric" }).replace(",", "");
  const time = d.toLocaleString("en-US", { timeZone: LA, hour: "numeric", minute: "2-digit" });
  const n = dayDiff(iso);
  const rel = n === 0 ? "today" : n === 1 ? "tomorrow" : n > 1 ? `in ${n} days` : null;
  return [day, time, rel].filter(Boolean).join(" · ");
}

/** Booked: the ticket, what it saved, the receipt, one action. */
export function BookedHero({ e, title, saved, receipt, gcal, ics }: { e: { id: string; start: string; link?: string }; title: string; saved?: number; receipt: string; gcal: string; ics: string }) {
  const [menu, setMenu] = useState(false);
  const wrap = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!menu) return;
    const off = (ev: PointerEvent) => { if (!wrap.current?.contains(ev.target as Node)) setMenu(false); };
    const esc = (ev: KeyboardEvent) => { if (ev.key === "Escape") setMenu(false); };
    document.addEventListener("pointerdown", off); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", off); document.removeEventListener("keydown", esc); };
  }, [menu]);
  // The human's part, in order: the first undone step is "your next step". Calendar is checked once clicked (per viewing).
  const key = `cal-added:${e.id}`;
  const [added, setAdded] = useState(false);
  useEffect(() => { try { setAdded(localStorage.getItem(key) === "1"); } catch { /* storage blocked */ } }, [key]);
  const markAdded = () => { setAdded(true); setMenu(false); try { localStorage.setItem(key, "1"); } catch { /* storage blocked */ } };
  const time = new Date(e.start).toLocaleString("en-US", { timeZone: LA, weekday: "short", hour: "numeric", minute: "2-digit" });
  const steps = [
    { t: "Add it to your calendar", done: added },
    { t: `Join the video tour, ${time}`, done: false },
    { t: "Sign the sublease, then pay", done: false },
  ];
  const cur = steps.findIndex((x) => !x.done);
  const d = new Date(e.start);
  return <article className="hero hx-booked ticket-card" aria-label="Viewing booked">
    <div className="cal" aria-hidden="true"><span>{d.toLocaleString("en-US", { timeZone: LA, month: "short" })}</span><b>{d.toLocaleString("en-US", { timeZone: LA, day: "numeric" })}</b></div>
    <div className="tk-body">
      <div className="tw"><i className="tk-ok" aria-hidden="true">✓</i>Viewing {whenLine(e.start)}</div>
      <div className="tt" title={cleanTitle(title)}>{shortTitle(title)}</div>
      {saved ? <div className="hx-saved">Saved <b>{usd(saved)}/mo</b></div> : null}
      <div className="hx-receipt">{receipt}</div>
      <div className="tk-actions" ref={wrap}>
        <a className="tk-primary" href={e.link ?? gcal} target="_blank" rel="noreferrer" onClick={markAdded}>Add to calendar</a>
        <button type="button" className="hx-cal-more" aria-label="More calendar options" aria-expanded={menu} onClick={() => setMenu((x) => !x)}>
          <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="m7 10 5 5 5-5" stroke="currentColor" strokeWidth="2.2" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg></button>
        {menu && <div className="hx-menu" role="menu">
          <a role="menuitem" href={ics} download="viewing.ics" onClick={markAdded}>Apple / Outlook (.ics)</a>
          <a role="menuitem" href={gcal} target="_blank" rel="noreferrer" onClick={markAdded}>Google Calendar</a>
        </div>}
      </div>
      <div className="hx-you" aria-label="What you do next">
        <div className="hx-you-h">Your next step</div>
        <ol>{steps.map((x, i) => <li key={x.t} className={x.done ? "done" : i === cur ? "now" : undefined} aria-current={i === cur ? "step" : undefined}>
          <i aria-hidden="true">{x.done ? "✓" : i + 1}</i>{x.t}</li>)}</ol>
      </div>
    </div>
  </article>;
}

/** A compact ranked row under the hero: thumb, title, price. */
export function MatchRow({ l, rank, onHover }: { l: RankedListing; rank: number; onHover?: (id: string | null) => void }) {
  return <a className={`mrow ${l.scam.light}`} href={l.url} target="_blank" rel="noreferrer" onMouseEnter={() => onHover?.(l.id)} onMouseLeave={() => onHover?.(null)}>
    <Photo l={l} />
    <span className="mrow-t" title={`#${rank} · ${cleanTitle(l.title)}`}>{shortTitle(l.title, 4)}</span>
    <b className="mrow-p">{l.priceMonthly ? usd(l.priceMonthly) : "?"}</b>
  </a>;
}
