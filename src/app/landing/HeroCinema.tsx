"use client";

import { useRef, type CSSProperties } from "react";
import { Bot } from "../Bot";
import { Typed, useOnScreen, useReducedMotion, useTimeline } from "./motion";
import s from "./HeroCinema.module.css";

/*
 * Autoplaying ~14s loop of the agent at work. Phases:
 * 0 ask · 1 scanning · 2 listings · 3 scam stamp · 4 call starts
 * 5 landlord · 6 agent · 7 landlord · 8 booked (final) · 9 fade out
 */
const DELAYS = [700, 650, 1250, 1700, 450, 1500, 2100, 1300, 4200, 450] as const;
const FINAL = 8;

const LISTINGS = [
  { title: "Furnished 1BR near Caltrain", price: "$3,800", risk: "4/100", bad: false },
  { title: "Top-floor 1BR, Noe Valley", price: "$3,950", risk: "9/100", bad: false },
  { title: "Sunny 1BR, Ortega St", price: "$1,100", risk: "91/100", bad: true },
];
const CALL = [
  { who: "Landlord", text: "Need a $7,600 Zelle deposit.", at: 5 },
  { who: "Sniper", text: "No payments before a viewing. Would you do $3,600?", at: 6 },
  { who: "Landlord", text: "Deal. Monday 5pm?", at: 7 },
];
const BARS = 44;

export function HeroCinema({ className }: { className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const onScreen = useOnScreen(ref, 0.2);
  const reduced = useReducedMotion();
  const p = useTimeline(DELAYS, { playing: onScreen, loop: true, final: FINAL });
  const scene = p >= 4 ? "call" : "search";
  const speaker = p >= 5 && p < 8 ? CALL[Math.min(p - 5, 2)].who : "";

  return (
    <div
      ref={ref}
      className={`${s.cinema} ${className ?? ""}`}
      data-phase={p}
      data-scene={scene}
      data-out={p === 9 || undefined}
      data-paused={!onScreen || reduced || undefined}
      role="img"
      aria-label="Demo: you ask for a furnished 1BR in SF under $4,000. The agent scans listings, stamps a scam, calls the landlord, refuses a Zelle deposit, negotiates to $3,600 and books a viewing for Monday 5:30 PM."
    >
      <div className={s.chrome} aria-hidden="true">
        <Bot size={22} />
        <b>Sniper</b>
        <span className={s.live} data-on={p < 8 || undefined}>{p >= 8 ? "Done" : "Working"}</span>
      </div>

      <div className={s.stage} aria-hidden="true">
        {/* Scene 1: ask + search */}
        <div className={s.scene} data-show={scene === "search" || undefined}>
          <div className={s.ask}>Furnished 1BR in SF under $4,000</div>
          <div className={s.status} data-show={p >= 1 || undefined}>
            <span className={s.scan} data-done={p >= 3 || undefined} />
            {p >= 3 ? "774 listings scanned · 6 scams blocked" : "Scanning Craigslist…"}
          </div>
          <ul className={s.list}>
            {LISTINGS.map((l, i) => (
              <li key={l.title} className={s.row} data-show={p >= 2 || undefined} data-bad={(l.bad && p >= 3) || undefined} style={{ "--i": i } as CSSProperties}>
                <i className={l.bad ? s.dotRed : s.dotGreen} />
                <span className={s.rowTitle}>{l.title}</span>
                <b>{l.price}</b>
                {l.bad && <span className={s.stamp} data-show={p >= 3 || undefined}>Scam</span>}
              </li>
            ))}
          </ul>
        </div>

        {/* Scene 2: phone call + booking */}
        <div className={s.scene} data-show={scene === "call" || undefined}>
          <div className={s.call} data-ended={p >= 8 || undefined}>
            <div className={s.callHead}>
              <span className={s.phone}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /></svg>
              </span>
              <div>
                <b>{p >= 8 ? "Call ended · 0:42" : "Calling landlord"}</b>
                <span>Furnished 1BR near Caltrain</span>
              </div>
            </div>
            <div className={s.wave} data-speaker={speaker || undefined}>
              {Array.from({ length: BARS }, (_, i) => <i key={i} style={{ "--i": i } as CSSProperties} />)}
            </div>
            <div className={s.lines}>
              {CALL.map((l) => (
                <p key={l.text} className={s.line} data-who={l.who} data-show={p >= l.at || undefined}>
                  <span>{l.who}</span>
                  <span className={s.lineText}><Typed text={l.text} run={p >= l.at} speed={24} /></span>
                </p>
              ))}
            </div>
          </div>
          <div className={s.ticket} data-show={p >= 8 || undefined}>
            <span className={s.check}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M5 12.5l4.5 4.5L19 7.5" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </span>
            <div>
              <b>Viewing booked</b>
              <span>Mon 5:30 PM</span>
            </div>
            <span className={s.saved}>Saved $200/mo</span>
          </div>
        </div>
      </div>
    </div>
  );
}
