"use client";
import { useState } from "react";
import type { RankedListing } from "@/lib/types";

const LABEL = { green: "Looks safe", yellow: "Caution", red: "Likely scam" } as const;
const TYPE: Record<string, string> = { room: "Room", studio: "Studio", "1br": "1 BR", "2br": "2 BR", "3br+": "3+ BR", unknown: "Rental" };

export function RiskRing({ score, light, size = 46 }: { score: number; light: RankedListing["scam"]["light"]; size?: number }) {
  const r = (size - 6) / 2, c = 2 * Math.PI * r;
  return (
    <div className={`ring ${light}`} style={{ width: size, height: size }} title={`Scam risk ${score}/100`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} className="ring-bg" />
        <circle cx={size / 2} cy={size / 2} r={r} className="ring-fg" strokeDasharray={c} strokeDashoffset={c * (1 - Math.max(4, score) / 100)} />
      </svg>
      <b>{score}</b>
    </div>
  );
}

export function ListingCard({ l, i, onContact, pinned, onHover }: { l: RankedListing; i?: number; onContact?: (id: string) => void; pinned?: boolean; onHover?: (id: string | null) => void }) {
  const [open, setOpen] = useState(l.scam.light === "red");
  const [imgOk, setImgOk] = useState(true);
  const img = l.images?.[0];
  const hood = l.neighborhood ?? l.hood ?? "San Francisco";
  return (
    <article className={`lc ${l.scam.light}${pinned ? " pinned" : ""}`} onMouseEnter={() => onHover?.(l.id)} onMouseLeave={() => onHover?.(null)}>
      {pinned && <div className="pin-banner">The link you pasted: scam risk {l.scam.score}/100{l.scam.light === "red" ? ". Do not pay anything." : ""}</div>}
      <div className="lc-main">
        <a className="lc-photo" href={l.url} target="_blank" rel="noreferrer">
          {img && imgOk
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={img} alt="" loading="lazy" onError={() => setImgOk(false)} />
            : <div className="lc-ph"><svg viewBox="0 0 24 24" width="30" height="30" aria-hidden="true"><path d="M3.5 11 12 4l8.5 7M6 9.5V20h4.5v-5h3v5H18V9.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg><span>{hood}</span></div>}
          {i != null && <span className="lc-rank">#{i + 1}</span>}
          {l.scam.light === "red" && <span className="lc-stamp">SCAM</span>}
        </a>
        <div className="lc-body">
          <div className="lc-top">
            <a className="lc-title" href={l.url} target="_blank" rel="noreferrer">{l.title}</a>
            <RiskRing score={l.scam.score} light={l.scam.light} />
          </div>
          <div className="lc-price"><b>${l.priceMonthly?.toLocaleString("en-US") ?? "?"}</b><span>/mo</span>
            <em className={`risk-label ${l.scam.light}`}>{LABEL[l.scam.light]}</em></div>
          <div className="chips">
            <span>{TYPE[l.type] ?? l.type}</span><span>{hood}</span>
            {l.distanceKm != null && <span>{l.distanceKm.toFixed(1)} km</span>}
            {l.furnished && <span>Furnished</span>}
            {l.demo && <span className="demo">Demo data</span>}
            {!l.demo && <span className="src">{l.source}</span>}
          </div>
        </div>
      </div>
      {l.fit.length > 0 && l.scam.light !== "red" && <div className="lc-fit">{l.fit.slice(0, 3).map((f) => <span key={f}>✓ {f}</span>)}</div>}
      {l.scam.reasons.length > 0 && <>
        <button className="lc-why" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? "Hide" : "Show"} {l.scam.reasons.length} {l.scam.light === "green" ? "note" : "risk signal"}{l.scam.reasons.length > 1 ? "s" : ""}</button>
        {open && <ul className="lc-reasons">{l.scam.reasons.slice(0, 4).map((r) => <li key={r}>{r}</li>)}</ul>}
      </>}
      {onContact && l.scam.light !== "red" && <div className="lc-actions">
        <button className={`sm ${i === 0 ? "primary" : "soft"}`} onClick={() => onContact(l.id)}>Let my agent reach out</button>
        <a href={l.url} target="_blank" rel="noreferrer">View on Craigslist</a>
      </div>}
    </article>
  );
}
