"use client";

import { useEffect, useRef, type CSSProperties, type RefObject } from "react";
import { Bot } from "../Bot";
import { useReducedMotion } from "./motion";
import s from "./ScrollStory.module.css";

/*
 * Scroll-driven story. A tall section pins a 100vh stage; scroll progress
 * (not time) scrubs five beats. One passive scroll listener schedules a rAF
 * that eases toward the target progress and writes CSS custom properties
 * (--t0..--t4, each 0..1 within its beat). Everything visual reads those
 * vars and only touches transform/opacity. Reduced motion renders the five
 * beats as a static vertical sequence in their finished state.
 */

const BEATS = [
  { cap: "Tell it", sub: "Text or voice, English or Spanish.", status: "Listening" },
  { cap: "It searches", sub: "Every SF listing, ranked against city medians.", status: "Searching" },
  { cap: "It blocks scams", sub: "Zelle asks, absent owners, fake prices.", status: "Checking" },
  { cap: "It negotiates", sub: "It calls the landlord. It never pays first.", status: "On a call" },
  { cap: "You show up", sub: "Viewing booked. Nothing paid upfront.", status: "Booked" },
] as const;
const N = BEATS.length;

const ASK = "Furnished 1BR in SF under $4,000, Nov 1–Dec 15";
const ASK_CHARS = Array.from(ASK);
const CRITERIA = ["Furnished", "1BR", "≤ $4,000", "Nov 1 – Dec 15", "San Francisco"];

const LISTINGS = [
  { t: "Furnished 1BR near Caltrain", p: "$3,800", h: 24 },
  { t: "Top-floor 1BR, Noe Valley", p: "$3,950", h: 200 },
  { t: "Studio, Hayes Valley", p: "$2,900", h: 150 },
  { t: "1BR + office, Mission", p: "$3,700", h: 330 },
  { t: "Sunny 1BR, Ortega St", p: "$1,100", h: 8, bad: true },
  { t: "Garden 1BR, Bernal", p: "$3,450", h: 110 },
  { t: "Loft, SoMa", p: "$3,990", h: 260 },
  { t: "1BR, Inner Richmond", p: "$3,300", h: 40 },
  { t: "Furnished 1BR, Russian Hill", p: "$3,850", h: 190 },
];
const SCANNED = 774;
/** Share of the scroll span before pinning during which beat 1 already plays. */
const PRE = 0.1;

const CALL = [
  { who: "Landlord", text: "Need a $7,600 Zelle deposit.", at: 0.06 },
  { who: "Sniper", text: "No payments before a viewing. Would you do $3,600?", at: 0.3 },
  { who: "Landlord", text: "Deal. Monday 5pm?", at: 0.56 },
] as const;
const CALL_SECONDS = 42;
const BARS = 36;

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const v = (o: Record<string, string | number>) => o as CSSProperties;

type Live = {
  status: RefObject<HTMLSpanElement | null>;
  typed: RefObject<HTMLSpanElement | null>;
  ghost: RefObject<HTMLSpanElement | null>;
  count: RefObject<HTMLElement | null>;
  timer: RefObject<HTMLElement | null>;
};

/* ── scenes (shared by the scrolled and the static version) ───────── */

function SceneAsk({ live }: { live?: Live }) {
  return (
    <div className={s.askScene}>
      <div className={`${s.you} ${s.in}`} style={v({ "--s": 0, "--len": 0.05 })}>
        <span ref={live?.typed}>{live ? "" : ASK}</span>
        <span ref={live?.ghost} className={s.ghost}>{live ? ASK : ""}</span>
      </div>
      <div className={`${s.agentMsg} ${s.in}`} style={v({ "--s": 0.62, "--len": 0.1 })}>
        <Bot size={26} />
        <div>
          <p>Got it. Searching all of SF.</p>
          <ul className={s.criteria}>
            {CRITERIA.map((c, i) => (
              <li key={c} className={s.pop} style={v({ "--s": 0.68 + i * 0.045, "--len": 0.08 })}>{c}</li>
            ))}
          </ul>
        </div>
      </div>
      <div className={s.composer} aria-hidden="true">
        <span>Message Sniper</span>
        <i className={s.mic}>
          <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none"><rect x="9" y="3" width="6" height="11" rx="3" stroke="currentColor" strokeWidth="2" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
        </i>
      </div>
    </div>
  );
}

function SceneSearch({ live }: { live?: Live }) {
  return (
    <div className={s.searchScene}>
      <div className={s.searchHead}>
        <div>
          <b ref={live?.count} className={s.count}>{live ? 0 : SCANNED}</b>
          <span>listings scanned</span>
        </div>
        <span className={s.source}>Craigslist · live</span>
      </div>
      <div className={s.bar}><i /></div>
      <ul className={s.grid}>
        {LISTINGS.map((l, i) => (
          <li key={l.t} className={`${s.card} ${s.in}`} data-bad={l.bad || undefined} style={v({ "--s": 0.04 + i * 0.07, "--len": 0.12, "--h": l.h })}>
            <div className={s.thumb}>
              <svg viewBox="0 0 40 28" aria-hidden="true"><path d="M8 26V14l12-9 12 9v12z" fill="rgba(255,255,255,.55)" /><rect x="17" y="17" width="6" height="9" fill="rgba(255,255,255,.75)" /></svg>
            </div>
            <b>{l.p}</b>
            <span>{l.t}</span>
            <i className={s.risk} />
          </li>
        ))}
      </ul>
      <p className={`${s.searchFoot} ${s.in}`} style={v({ "--s": 0.84, "--len": 0.08 })}>
        <span><b>12</b> match your dates</span>
        <span className={s.footBad}><b>6</b> look like scams</span>
      </p>
    </div>
  );
}

function SceneScam() {
  return (
    <div className={s.scamScene}>
      <div className={s.listing}>
        <div className={s.photo}>
          <svg viewBox="0 0 40 28" aria-hidden="true"><path d="M8 26V14l12-9 12 9v12z" fill="rgba(255,255,255,.55)" /><rect x="17" y="17" width="6" height="9" fill="rgba(255,255,255,.75)" /></svg>
        </div>
        <div className={s.listingBody}>
          <div className={s.listingTop}>
            <b>Sunny 1BR, Ortega St</b>
            <b className={s.mark} style={v({ "--s": 0.2 })}>$1,100</b>
          </div>
          <p>
            Furnished, all utilities included. I&rsquo;m <span className={s.mark} style={v({ "--s": 0.34 })}>out of the country</span>, so
            I can&rsquo;t show it. Send the deposit by <span className={s.mark} style={v({ "--s": 0.46 })}>Zelle</span> and I&rsquo;ll mail you the keys.
          </p>
        </div>
        <div className={s.scan} aria-hidden="true" />
        <span className={s.stamp}>Scam</span>
      </div>
      <ul className={s.flags}>
        <li className={s.in} style={v({ "--s": 0.22, "--len": 0.08 })}><span><b>$1,100</b> = 28% of median</span></li>
        <li className={s.in} style={v({ "--s": 0.36, "--len": 0.08 })}>Owner &ldquo;out of the country&rdquo;</li>
        <li className={s.in} style={v({ "--s": 0.48, "--len": 0.08 })}>Deposit by Zelle</li>
      </ul>
      <div className={`${s.score} ${s.in}`} style={v({ "--s": 0.74, "--len": 0.1 })}>
        <span>Scam risk</span>
        <div className={s.meter}><i /></div>
        <b>91/100</b>
      </div>
    </div>
  );
}

function SceneCall({ live }: { live?: Live }) {
  return (
    <div className={s.callScene}>
      <div className={s.call}>
        <div className={s.callHead}>
          <span className={s.phone}>
            <svg width="1.1em" height="1.1em" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /></svg>
          </span>
          <div>
            <b>Landlord</b>
            <span>Furnished 1BR near Caltrain</span>
          </div>
          <b ref={live?.timer} className={s.timer}>{live ? "0:00" : `0:${CALL_SECONDS}`}</b>
        </div>
        <div className={s.wave} aria-hidden="true">
          {Array.from({ length: BARS }, (_, i) => <i key={i} style={v({ "--i": i })} />)}
        </div>
        <div className={s.lines}>
          {CALL.map((l) => (
            <p key={l.text} className={`${s.line} ${s.in}`} data-who={l.who} style={v({ "--s": l.at, "--len": 0.08 })}>
              <span>{l.who}</span>
              <span>{l.text}</span>
            </p>
          ))}
        </div>
      </div>
      <div className={s.chips}>
        <span className={`${s.chip} ${s.chipRed} ${s.pop}`} style={v({ "--s": 0.4, "--len": 0.08 })}>
          <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M7 7l10 10M17 7 7 17" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" /></svg>
          Zelle refused
        </span>
        <span className={`${s.chip} ${s.chipGreen} ${s.pop}`} style={v({ "--s": 0.68, "--len": 0.08 })}>
          <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
          Saved $200/mo
        </span>
      </div>
    </div>
  );
}

function SceneBooked() {
  return (
    <div className={s.bookedScene}>
      <div className={s.glow} aria-hidden="true" />
      <div className={s.ticket}>
        <div className={s.ticketMain}>
          <div className={s.date}>
            <span>Oct</span>
            <b>26</b>
            <span>Mon</span>
          </div>
          <div className={s.ticketInfo}>
            <span className={s.booked}>
              <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg>
              Viewing booked
            </span>
            <b>Mon Oct 26 · 5:30 PM</b>
            <span>Video tour · Furnished 1BR near Caltrain</span>
          </div>
        </div>
        <div className={s.ticketFoot}>
          <span>$3,600/mo</span>
          <span>$0 paid upfront</span>
        </div>
      </div>
      <p className={`${s.showUp} ${s.in}`} style={v({ "--s": 0.36, "--len": 0.12 })}>You just show up.</p>
      <ul className={s.stats}>
        <li className={s.pop} style={v({ "--s": 0.5, "--len": 0.08 })}><b>774</b> scanned</li>
        <li className={s.pop} style={v({ "--s": 0.56, "--len": 0.08 })}><b>6</b> scams blocked</li>
        <li className={s.pop} style={v({ "--s": 0.62, "--len": 0.08 })}><b>$200</b>/mo saved</li>
      </ul>
    </div>
  );
}

function Scene({ i, live }: { i: number; live?: Live }) {
  if (i === 0) return <SceneAsk live={live} />;
  if (i === 1) return <SceneSearch live={live} />;
  if (i === 2) return <SceneScam />;
  if (i === 3) return <SceneCall live={live} />;
  return <SceneBooked />;
}

function Chrome({ status, statusRef }: { status: string; statusRef?: RefObject<HTMLSpanElement | null> }) {
  return (
    <div className={s.chrome} aria-hidden="true">
      <Bot size={22} />
      <b>Sniper</b>
      <span ref={statusRef} className={s.status}>{status}</span>
    </div>
  );
}

function Caption({ i }: { i: number }) {
  return (
    <>
      <h3 className={s.cap}>{BEATS[i].cap}<span className={s.dot}>.</span></h3>
      <p className={s.capSub}>{BEATS[i].sub}</p>
    </>
  );
}

/* ── static (reduced motion) ──────────────────────────────────────── */

function StaticStory() {
  const done = v({ "--t0": 1, "--t1": 1, "--t2": 1, "--t3": 1, "--t4": 1 });
  return (
    <section id="how" className={s.staticStory} aria-labelledby="story-title" style={done}>
      <h2 id="story-title" className={s.eyebrow}>How it works</h2>
      <ol className={s.staticList}>
        {BEATS.map((b, i) => (
          <li key={b.cap} className={s.staticBeat}>
            <div className={s.staticCap}><Caption i={i} /></div>
            <div className={s.screen}>
              <Chrome status={b.status} />
              <div className={s.body}>
                <div className={s.scene} data-i={i} data-state="active"><Scene i={i} /></div>
              </div>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

/* ── scrolled ─────────────────────────────────────────────────────── */

function AnimatedStory() {
  const root = useRef<HTMLElement>(null);
  const status = useRef<HTMLSpanElement>(null);
  const typed = useRef<HTMLSpanElement>(null);
  const ghost = useRef<HTMLSpanElement>(null);
  const count = useRef<HTMLElement>(null);
  const timer = useRef<HTMLElement>(null);
  const live: Live = { status, typed, ghost, count, timer };

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const beatEls = Array.from(el.querySelectorAll<HTMLElement>("[data-beat]"));
    let raf = 0;
    let cur = Number.NaN;
    let beat = -1;
    let typedN = -1;
    let scanned = -1;
    let secs = -1;
    let speaker = "";

    const write = (p: number) => {
      // p dips below 0 while the section scrolls in, so the first beat
      // already starts typing before the stage pins.
      const seg = p * N;
      const ts = BEATS.map((_, i) => clamp01(seg - i));
      ts[0] = clamp01((seg + PRE * N) / (1 + PRE * N));
      for (let i = 0; i < N; i++) el.style.setProperty(`--t${i}`, ts[i].toFixed(4));
      el.style.setProperty("--p", clamp01(p).toFixed(4));

      const b = Math.max(0, Math.min(N - 1, Math.floor(seg)));
      if (b !== beat) {
        beat = b;
        el.dataset.beat = String(b);
        for (const node of beatEls) {
          const k = Number(node.dataset.beat);
          node.dataset.state = k < b ? "past" : k === b ? "active" : "future";
        }
        if (status.current) status.current.textContent = BEATS[b].status;
      }

      const n = Math.round(ASK_CHARS.length * clamp01(ts[0] / 0.55));
      if (n !== typedN && typed.current && ghost.current) {
        typedN = n;
        typed.current.textContent = ASK_CHARS.slice(0, n).join("");
        ghost.current.textContent = ASK_CHARS.slice(n).join("");
      }
      const c = Math.round(SCANNED * clamp01(ts[1] / 0.78));
      if (c !== scanned && count.current) { scanned = c; count.current.textContent = String(c); }
      const sec = Math.round(CALL_SECONDS * clamp01(ts[3] / 0.85));
      if (sec !== secs && timer.current) { secs = sec; timer.current.textContent = `0:${String(sec).padStart(2, "0")}`; }

      const t3 = ts[3];
      const who = b !== 3 ? "" : t3 >= 0.06 && t3 < 0.26 ? "Landlord" : t3 >= 0.3 && t3 < 0.52 ? "Sniper" : t3 >= 0.56 && t3 < 0.76 ? "Landlord" : "";
      if (who !== speaker) { speaker = who; if (who) el.dataset.speaker = who; else delete el.dataset.speaker; }
    };

    const html = document.documentElement;
    const target = () => {
      const r = el.getBoundingClientRect();
      // Dark header while the story sits under it.
      const under = r.top <= 64 && r.bottom > 64;
      if (under !== (html.dataset.story === "on")) { if (under) html.dataset.story = "on"; else delete html.dataset.story; }
      const span = r.height - window.innerHeight;
      return span > 0 ? Math.max(-PRE, Math.min(1, -r.top / span)) : 0;
    };

    const frame = () => {
      raf = 0;
      const goal = target();
      cur = Number.isNaN(cur) ? goal : cur + (goal - cur) * 0.22;
      if (Math.abs(goal - cur) < 0.0004) cur = goal;
      write(cur);
      if (cur !== goal) raf = requestAnimationFrame(frame);
    };
    const kick = () => { if (!raf) raf = requestAnimationFrame(frame); };

    kick();
    window.addEventListener("scroll", kick, { passive: true });
    window.addEventListener("resize", kick);
    return () => {
      cancelAnimationFrame(raf);
      delete html.dataset.story;
      window.removeEventListener("scroll", kick);
      window.removeEventListener("resize", kick);
    };
  }, []);

  const jump = (i: number) => {
    const el = root.current;
    if (!el) return;
    const span = el.offsetHeight - window.innerHeight;
    const top = el.getBoundingClientRect().top + window.scrollY;
    window.scrollTo({ top: top + span * ((i + 0.72) / N), behavior: "smooth" });
  };

  return (
    <section ref={root} id="how" className={s.story} data-beat="0" aria-labelledby="story-title">
      <div className={s.sticky}>
        <div className={s.side}>
          <h2 id="story-title" className={s.eyebrow}>How it works</h2>
          <ol className={s.caps}>
            {BEATS.map((b, i) => (
              <li key={b.cap} className={s.capItem} data-beat={i} data-state={i === 0 ? "active" : "future"}>
                <Caption i={i} />
              </li>
            ))}
          </ol>
          <nav className={s.rail} aria-label="Story steps">
            <span className={s.railTrack} aria-hidden="true"><i /></span>
            {BEATS.map((b, i) => (
              <button key={b.cap} type="button" className={s.railDot} data-beat={i} data-state={i === 0 ? "active" : "future"} onClick={() => jump(i)} aria-label={`Step ${i + 1}: ${b.cap}`} />
            ))}
          </nav>
        </div>
        <div className={s.slot}>
          <div className={s.screen}>
            <Chrome status={BEATS[0].status} statusRef={live.status} />
            <div className={s.body}>
              {BEATS.map((b, i) => (
                <div key={b.cap} className={s.scene} data-i={i} data-beat={i} data-state={i === 0 ? "active" : "future"}>
                  <Scene i={i} live={live} />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export function ScrollStory() {
  const reduced = useReducedMotion();
  return reduced ? <StaticStory /> : <AnimatedStory />;
}
