"use client";
import { useEffect, useRef, useState } from "react";
import type { RankedListing } from "@/lib/types";
import { cardThumb } from "@/lib/photo-url";
import { loadPhotos, peekPhotos } from "./photos";

const LABEL = { green: "Looks safe", yellow: "Caution", red: "Likely scam" } as const;
const TYPE: Record<string, string> = { room: "Room", studio: "Studio", "1br": "1 BR", "2br": "2 BR", "3br+": "3+ BR", unknown: "Rental" };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Cards enter once. Tab switches (a frequent action) remount them, so remember who already made their entrance. */
const entered = new Set<string>();

/** Short, non redundant fit reasons: price, type and furnished are already on the card. */
function fitLabels(fit: string[]): string[] {
  const out: string[] = [];
  for (const f of fit) {
    if (/within budget/.test(f)) out.push("Within budget");
    else if (/over budget/.test(f)) out.push("Slightly over budget");
    else if (/^type |^(un)?furnished$/.test(f)) continue;
    else if (f.startsWith("studio")) out.push("Studio, close to 1BR");
    else if (f.startsWith("available ")) {
      const m = /^available (\d{4})-(\d{2})-(\d{2})/.exec(f);
      out.push(m ? `Free ${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}` : f.replace(/^a/, "A"));
    } else out.push(f);
  }
  return out.slice(0, 3);
}

export function RiskRing({ score, light, size = 46 }: { score: number; light: RankedListing["scam"]["light"]; size?: number }) {
  const r = (size - 6) / 2, c = 2 * Math.PI * r;
  // --c lets the stroke draw in from empty on mount only; later score changes use the CSS transition.
  return (
    <div className={`ring ${light}`} style={{ width: size, height: size, ["--c" as string]: `${c}` }} role="img" aria-label={`Scam risk ${score} out of 100`} title={`Scam risk ${score}/100`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} className="ring-bg" />
        <circle cx={size / 2} cy={size / 2} r={r} className="ring-fg" strokeDasharray={c} strokeDashoffset={c * (1 - Math.max(4, score) / 100)} />
      </svg>
      <b>{score}</b>
    </div>
  );
}

export function ListingCard({ l, i, onContact, pinned, onHover, onXray }: { l: RankedListing; i?: number; onContact?: (id: string) => void; pinned?: boolean; onHover?: (id: string | null) => void; onXray?: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [imgOk, setImgOk] = useState(true);
  const [useFull, setUseFull] = useState(false);
  const needsPhoto = !l.images?.length && l.source === "craigslist";
  // Photos usually arrive inline (prefetched by the search); otherwise one batched request for all cards.
  const [fetched, setFetched] = useState<string | null | undefined>(() => (needsPhoto ? peekPhotos(l.url)?.[0] : undefined));
  const [loaded, setLoaded] = useState(false);
  const [fresh] = useState(() => !entered.has(l.id));
  useEffect(() => { entered.add(l.id); }, [l.id]);
  const imgRef = useRef<HTMLImageElement | null>(null);
  useEffect(() => {
    if (!needsPhoto || fetched !== undefined) return;
    let alive = true;
    void loadPhotos(l.url).then((imgs) => { if (alive) setFetched(imgs[0] ?? null); });
    return () => { alive = false; };
  }, [needsPhoto, fetched, l.url]);
  const full = l.images?.[0] ?? fetched ?? undefined;
  // Cards show the small 300x300 variant; fall back to the full size if it is missing.
  const img = full && (useFull ? full : cardThumb(full));
  const pendingPhoto = needsPhoto && fetched === undefined;
  // A cached image can finish before React attaches onLoad.
  useEffect(() => { if (imgRef.current?.complete && imgRef.current.naturalWidth) setLoaded(true); }, [img, pendingPhoto]);
  const hood = l.neighborhood ?? l.hood ?? "San Francisco";
  const title = l.title.replace(/^\[DEMO DATA\]\s*/i, "");
  const fit = l.scam.light === "red" ? [] : fitLabels(l.fit);
  const showImg = !pendingPhoto && img && imgOk;
  return (
    <article className={`lc ${l.scam.light}${pinned ? " pinned" : ""}${fresh ? " fresh" : ""}`} onMouseEnter={() => onHover?.(l.id)} onMouseLeave={() => onHover?.(null)}>
      {pinned && <div className="pin-banner">The link you pasted: scam risk {l.scam.score}/100{l.scam.light === "red" ? ". Do not pay anything." : ""}</div>}
      <div className="lc-main">
        <a className="lc-photo" href={l.url} target="_blank" rel="noreferrer" tabIndex={-1} aria-hidden="true">
          {(pendingPhoto || (showImg && !loaded)) && <div className="lc-shimmer" />}
          {pendingPhoto ? null : showImg
            // eslint-disable-next-line @next/next/no-img-element
            ? <img ref={imgRef} src={img} alt="" loading={i != null && i < 8 ? "eager" : "lazy"} decoding="async" className={loaded ? "in" : ""} onLoad={() => setLoaded(true)} onError={() => (img !== full ? setUseFull(true) : setImgOk(false))} />
            : <div className="lc-ph"><svg viewBox="0 0 24 24" width="30" height="30" aria-hidden="true"><path d="M3.5 11 12 4l8.5 7M6 9.5V20h4.5v-5h3v5H18V9.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg><span>{hood}</span></div>}
          {i != null && <span className="lc-rank">#{i + 1}</span>}
          {l.scam.light === "red" && <span className="lc-stamp"><b>Scam</b></span>}
        </a>
        <div className="lc-body">
          <div className="lc-top">
            <a className="lc-title" href={l.url} target="_blank" rel="noreferrer">{title}</a>
            {l.scam.light !== "green" && <RiskRing score={l.scam.score} light={l.scam.light} />}
          </div>
          <div className="lc-price"><b>${l.priceMonthly?.toLocaleString("en-US") ?? "?"}</b><span>/mo</span>
            <em className={`risk-label ${l.scam.light}`}>{l.scam.light === "green" && <i aria-hidden="true" />}{LABEL[l.scam.light]}</em></div>
          <div className="chips">
            <span>{TYPE[l.type] ?? l.type}</span><span>{hood}</span>
            {l.distanceKm != null && <span>{l.distanceKm.toFixed(1)} km</span>}
            {l.furnished && <span>Furnished</span>}
            {l.demo && <span className="demo">Demo data</span>}
            {!l.demo && <span className="src">{l.source}</span>}
          </div>
          {fit.length > 0 && <div className="lc-fit">{fit.map((f) => <span key={f}><svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="M2.5 6.2 4.9 8.5 9.5 3.6" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>{f}</span>)}</div>}
        </div>
      </div>
      {l.scam.light !== "green" && onXray ? <div className="lc-xr">
        <span>{l.scam.reasons.filter((r) => !r.startsWith("info:"))[0]?.replace(/\s*\(pHash.*$/, "")}</span>
        <button className="xr-btn primary sm" onClick={() => onXray(l.id)}>Scam X-ray<em>{(l.scam.signals ?? []).length || l.scam.reasons.length} signal{((l.scam.signals ?? []).length || l.scam.reasons.length) > 1 ? "s" : ""}</em></button>
      </div> : l.scam.light !== "green" && l.scam.reasons.length > 0 && <>
        <button className="lc-why" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? "Hide" : "Show"} {l.scam.reasons.length} risk signal{l.scam.reasons.length > 1 ? "s" : ""}</button>
        {open && <ul className="lc-reasons">{l.scam.reasons.slice(0, 4).map((r) => <li key={r}>{r}</li>)}</ul>}
      </>}
      {onContact && l.scam.light !== "red" && <div className="lc-actions">
        <button className={`sm ${i === 0 && l.scam.light === "green" ? "primary" : l.scam.light === "green" ? "soft" : "ghost"}`} onClick={() => onContact(l.id)}>Let my agent reach out</button>
        <a href={l.url} target="_blank" rel="noreferrer">View on Craigslist</a>
      </div>}
    </article>
  );
}
