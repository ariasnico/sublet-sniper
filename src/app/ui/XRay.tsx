"use client";
/* eslint-disable @next/next/no-img-element */
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { RankedListing, ScamSignal } from "@/lib/types";
import { RiskRing } from "./ListingCard";
import { peekPhotos } from "./photos";

const VERDICT = { green: "Looks safe", yellow: "Caution", red: "Likely scam" } as const;

/** Wrap every quoted red-flag phrase from the signals in <mark>, case-insensitively. */
function highlight(text: string, quotes: string[]): ReactNode[] {
  const qs = [...new Set(quotes.filter((q) => q && q.length > 2))].map((q) => q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (!qs.length) return [text];
  const re = new RegExp(`(${qs.join("|")})`, "gi");
  return text.split(re).map((part, i) => (i % 2 ? <mark key={i}>{part}</mark> : part));
}

function shortLabel(s: ScamSignal) {
  return s.label.replace(/\s*\(".*"\)$/, "").replace(/\s*\(pHash distance \d+\):.*$/, "").replace(/: far too cheap, classic bait price$/, "");
}

export function XRay({ l: open, onClose }: { l: RankedListing | null; onClose: () => void }) {
  // Keep the last listing on screen while the exit animation plays (exit is faster than enter).
  const [shown, setShown] = useState<RankedListing | null>(open);
  if (open && open !== shown) setShown(open);
  const closing = !open && !!shown;
  const isOpen = !!open;
  const closeBtn = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (!isOpen) return;
    const back = document.activeElement as HTMLElement | null;
    closeBtn.current?.focus({ preventScroll: true });
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", key);
    return () => { window.removeEventListener("keydown", key); back?.focus?.({ preventScroll: true }); };
  }, [isOpen, onClose]);
  // Fallback in case animationend never fires (e.g. the tab is hidden).
  useEffect(() => {
    if (!closing) return;
    const t = setTimeout(() => setShown(null), 260);
    return () => clearTimeout(t);
  }, [closing]);
  const l = open ?? shown;
  if (!l) return null;
  const signals = (l.scam.signals ?? []).slice().sort((a, b) => b.w - a.w);
  const total = signals.reduce((a, s) => a + s.w, 0);
  // Some risk comes from the landlord's emails (no weighted listing signal): show those reasons instead of "none".
  const reasons = l.scam.reasons.filter((r) => !r.startsWith("info:") && !/^no scam signals/i.test(r)).map((r) => r.replace(/\s*\(.*\)$/, "")).slice(0, 4);
  const price = signals.find((s) => s.median);
  const photo = signals.find((s) => s.match);
  const body = l.body?.trim() || "No description on the listing.";
  const img = l.images?.[0] ?? peekPhotos(l.url)?.[0];
  return (
    <div className={`xr-back${closing ? " out" : ""}`} onClick={closing ? undefined : onClose} onAnimationEnd={(e) => { if (closing && e.target === e.currentTarget) setShown(null); }}>
      <div className={`xr ${l.scam.light}`} role="dialog" aria-modal="true" aria-label="Scam analysis" onClick={(e) => e.stopPropagation()}>
        <header className="xr-head">
          <RiskRing score={l.scam.score} light={l.scam.light} size={64} />
          <div className="xr-t">
            <p className={`xr-verdict ${l.scam.light}`}>{VERDICT[l.scam.light]}</p>
            <h3>{l.title.replace(/^\[DEMO DATA\]\s*/, "")}</h3>
            <p className="xr-sub"><b>${l.priceMonthly?.toLocaleString("en-US") ?? "?"}</b>/mo in <span className="xr-hood">{l.neighborhood ?? l.hood ?? "San Francisco"}</span></p>
          </div>
          <button ref={closeBtn} className="ghost sm" onClick={onClose} aria-label="Close">Close</button>
        </header>

        <div className="xr-grid">
          <section>
            <h4>Listing</h4>
            <div className="xr-body">{highlight(body, signals.map((s) => s.quote ?? ""))}</div>
            {price?.median && price.price && <div className="xr-price">
              <h4>vs. SF median</h4>
              <div className="xr-scale">
                <i className="xr-fill" style={{ width: `${Math.min(100, (price.price / (price.median * 1.4)) * 100)}%` }} />
                <span className="xr-med" style={{ left: `${100 / 1.4}%` }}>Median ${price.median.toLocaleString("en-US")}</span>
              </div>
              <p>{Math.round((price.price / price.median) * 100)}% of median.</p>
            </div>}
          </section>
          <section>
            <h4>Signals</h4>
            {signals.length ? <>
              <div className="xr-stack" aria-hidden="true">
                {signals.map((s, i) => <i key={i} style={{ flexGrow: s.w, animationDelay: `${100 + Math.min(i, 5) * 40}ms` }} />)}
                {total < 100 && <b style={{ flexGrow: 100 - total }} />}
              </div>
              <ol className="xr-signals">
                {signals.map((s, i) => <li key={i} style={{ animationDelay: `${120 + Math.min(i, 5) * 40}ms` }}><b>+{s.w}</b><span>{shortLabel(s)}{s.quote && <q>{s.quote}</q>}</span></li>)}
              </ol>
              {total > 100 && <p className="xr-cap">Capped at 100.</p>}
            </> : reasons.length ? <ol className="xr-signals">{reasons.map((r, i) => <li key={i}><b>!</b><span>{r}</span></li>)}</ol>
              : <p className="xr-none">No scam signals.</p>}
          </section>
        </div>

        {photo?.match && <section className="xr-photos">
          <h4>Same photo, different listing</h4>
          <div className="xr-pair">
            <figure>{img ? <img src={img} alt="" /> : <div className="xr-noimg" />}<figcaption>This listing</figcaption></figure>
            <div className="xr-eq"><b>=</b><span>pHash distance {photo.match.distance}</span></div>
            <figure>{photo.match.image ? <img src={photo.match.image} alt="" /> : <div className="xr-noimg" />}<figcaption>{photo.match.title.replace(/^\[DEMO DATA\]\s*/, "")}</figcaption></figure>
          </div>
        </section>}

        <footer className="xr-foot">
          {l.scam.light === "red" ? "Your agent won't contact it." : "No money before a viewing."}
          <a href={l.url} target="_blank" rel="noreferrer">Original listing</a>
        </footer>
      </div>
    </div>
  );
}
