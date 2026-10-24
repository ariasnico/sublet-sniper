import type { ReactNode } from "react";
import s from "./HaloCards.module.css";

/**
 * Four warm-dark "halo" cards: a glow that falls from the top edge plus
 * concentric light bands that follow the card's rounded rim. Pure CSS (no
 * WebGL), no JS; on hover the card lifts and the halo brightens, using
 * transform and opacity only.
 */

const stroke = { fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round", strokeLinejoin: "round" } as const;

const ITEMS: Array<{ title: string; text: string; icon: ReactNode }> = [
  {
    title: "A scam X-ray on every listing",
    text: "Price against SF medians, Zelle and wire requests, owners who are “away”, copied photos and text, upfront asks over California’s cap. You see the score and every reason.",
    icon: <svg viewBox="0 0 24 24" width="22" height="22"><path d="M12 3l7 3v5c0 4.5-3 8.2-7 10-4-1.8-7-5.5-7-10V6l7-3z" {...stroke} /><path d="M8.8 12.2l2.2 2.2 4.2-4.6" {...stroke} /></svg>,
  },
  {
    title: "Autopilot with you in charge",
    text: "Switch it on and the agent follows up, negotiates and books, in your name. New landlords still need your tap, and money before a viewing is always a no.",
    icon: <svg viewBox="0 0 24 24" width="22" height="22"><rect x="3" y="8" width="18" height="8" rx="4" {...stroke} /><circle cx="16.5" cy="12" r="2.2" {...stroke} /></svg>,
  },
  {
    title: "Native to AI agents",
    text: "A remote MCP server with five tools. Add it to Claude Code, or as a custom connector in Claude or ChatGPT, and your agent searches with the same guardrails.",
    icon: <svg viewBox="0 0 24 24" width="22" height="22"><path d="M9 3.5v4M15 3.5v4M7 7.5h10v3.5a5 5 0 0 1-10 0V7.5zM12 16v4.5" {...stroke} /></svg>,
  },
  {
    title: "Made for San Francisco",
    text: "SF rent medians, neighborhoods and California deposit rules are built in. Ask in English or Spanish, by voice or text.",
    icon: <svg viewBox="0 0 24 24" width="22" height="22"><path d="M3 19h18M6 19V8M18 19V8M6 9c3 0 4.5 3 6 6 1.5-3 3-6 6-6M6 13h12" {...stroke} /></svg>,
  },
];

export function HaloCards() {
  return (
    <section className={s.section} aria-labelledby="halo-title">
      <div className={s.inner}>
        <h2 id="halo-title" className={s.h2}>Built for the renter, not the listing site.</h2>
        <ul className={s.grid}>
          {ITEMS.map((it) => (
            <li key={it.title} className={s.card}>
              <span className={s.glow} aria-hidden="true" />
              <span className={s.bands} aria-hidden="true" />
              <span className={s.icon} aria-hidden="true">{it.icon}</span>
              <h3 className={s.title}>{it.title}</h3>
              <p className={s.text}>{it.text}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
