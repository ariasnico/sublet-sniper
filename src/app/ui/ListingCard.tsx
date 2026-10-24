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
  const details = [TYPE[l.type] ?? l.type, hood, l.distanceKm != null ? `${l.distanceKm.toFixed(1)} km` : null, l.furnished ? "Furnished" : null, ...fit].filter(Boolean).join(" · ");
  const nSignals = (l.scam.signals ?? []).length || l.scam.reasons.length;
  const showImg = !pendingPhoto && img && imgOk;
  return (
    <article className={`lc ${l.scam.light}${pinned ? " pinned" : ""}${fresh ? " fresh" : ""}`} onMouseEnter={() => onHover?.(l.id)} onMouseLeave={() => onHover?.(null)}>
      {pinned && <div className="pin-banner">Your link{l.scam.light === "red" ? ": don't pay" : ""}</div>}
      <div className="lc-main">
        <a className="lc-photo" href={l.url} target="_blank" rel="noreferrer" tabIndex={-1} aria-hidden="true">
          {(pendingPhoto || (showImg && !loaded)) && <div className="lc-shimmer" />}
          {pendingPhoto ? null : showImg
            // eslint-disable-next-line @next/next/no-img-element
            ? <img ref={imgRef} src={img} alt="" loading={i != null && i < 8 ? "eager" : "lazy"} decoding="async" className={loaded ? "in" : ""} onLoad={() => setLoaded(true)} onError={() => (img !== full ? setUseFull(true) : setImgOk(false))} />
            : <div className="lc-ph"><svg viewBox="0 0 24 24" width="30" height="30" aria-hidden="true"><path d="M3.5 11 12 4l8.5 7M6 9.5V20h4.5v-5h3v5H18V9.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg><span>{hood}</span></div>}
          {i != null && <span className="lc-rank">#{i + 1}</span>}
        </a>
        <div className="lc-body">
          <div className="lc-top">
            {/* Details (type, area, distance, fit) ride in the tooltip: the card itself is price, title, verdict, action. */}
            <a className="lc-title" href={l.url} target="_blank" rel="noreferrer" title={details}>{title}</a>
            {l.scam.light !== "green" && <RiskRing score={l.scam.score} light={l.scam.light} />}
          </div>
          <div className="lc-price"><b>${l.priceMonthly?.toLocaleString("en-US") ?? "?"}</b><span>/mo</span>
            <em className={`risk-label ${l.scam.light}`}>{l.scam.light === "green" && <i aria-hidden="true" />}{LABEL[l.scam.light]}</em></div>
        </div>
      </div>
      {!onXray && l.scam.light !== "green" && l.scam.reasons.length > 0 && <>
        <button className="lc-why" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? "Hide" : "Why?"}</button>
        {open && <ul className="lc-reasons">{l.scam.reasons.slice(0, 4).map((r) => <li key={r}>{r}</li>)}</ul>}
      </>}
      {((onContact && l.scam.light !== "red") || (onXray && l.scam.light !== "green")) && <div className="lc-actions">
        {onXray && l.scam.light !== "green" && <button className="xr-btn primary sm" onClick={() => onXray(l.id)} aria-label={`Scam X-ray: ${nSignals} signal${nSignals > 1 ? "s" : ""}`}>Scam X-ray</button>}
        {onContact && l.scam.light !== "red" && <button className={`sm ${i === 0 && l.scam.light === "green" ? "primary" : l.scam.light === "green" ? "soft" : "ghost"}`} onClick={() => onContact(l.id)} aria-label="Let my agent reach out">Reach out</button>}
      </div>}
    </article>
  );
}
