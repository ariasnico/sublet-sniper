"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { GlareCard } from "./GlareCard";
import s from "./LiveDemos.module.css";

/**
 * Four mini replays of the agent at work, each played once when its card
 * scrolls into view. Server render, no-JS and reduced-motion all show the
 * finished state, so nothing is ever hidden by default. Example data only.
 */

const QUERY = "Furnished 1BR, under $4,000, Nov 1 to Dec 15";
const RESULTS = [
  { title: "Furnished 1BR near Caltrain", price: "$3,650", risk: 8, bad: false },
  { title: "Top-floor 1BR in Noe Valley", price: "$3,900", risk: 11, bad: false },
  { title: "Sunny 1BR on Ortega St", price: "$1,100", risk: 91, bad: true },
];

const SIGNALS = [
  "Rent is a fraction of the SF median for a 1BR",
  "Owner says he’s “out of the country”",
  "Keys would be sent by mail",
  "Asks for Zelle to hold it",
];
const SCORE_STEPS = [0, 38, 62, 79, 91];

const LANDLORD = "Can you Zelle $500 today to hold it? Lots of interest.";
const REPLY = "I don’t send money before a viewing. Happy to do a live video tour today, and if it checks out I can move fast.";
const CHIPS = ["Zelle refused", "Video tour requested"];

const CALL = "check_listing_scam({ url: \"sfbay.craigslist.org/sfc/apa/…\" })";
const RESPONSE = [
  ["light", "\"red\""],
  ["scamScore", "91"],
  ["signals", "[4 items]"],
  ["verdict", "\"RED 91/100. HIGH scam risk: do not send money or personal info.\""],
];

type State = {
  qChars: number; results: number;
  signals: number;
  replyChars: number; chips: number; landlord: boolean;
  callChars: number; lines: number;
};

const DONE: State = {
  qChars: QUERY.length, results: RESULTS.length,
  signals: SIGNALS.length,
  replyChars: REPLY.length, chips: CHIPS.length, landlord: true,
  callChars: CALL.length, lines: RESPONSE.length,
};

function Shown({ on, children, className = "" }: { on: boolean; children: ReactNode; className?: string }) {
  return <li className={`${s.appear} ${className}`} data-on={on || undefined}>{children}</li>;
}

function Head({ icon, title }: { icon: ReactNode; title: string }) {
  return (
    <header className={s.head}>
      <span className={s.icon} aria-hidden="true">{icon}</span>
      <h3>{title}</h3>
    </header>
  );
}

function Typed({ text, chars }: { text: string; chars: number }) {
  const typing = chars > 0 && chars < text.length;
  return (
    <span className={s.typewrap}>
      <span className={s.ghost}>{text}</span>
      <span className={s.typed}>{text.slice(0, chars)}{typing && <span className={s.caret} />}</span>
    </span>
  );
}

const stroke = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" } as const;

export function LiveDemos() {
  const [st, setSt] = useState<State>(DONE);
  const searchRef = useRef<HTMLElement>(null);
  const xrayRef = useRef<HTMLElement>(null);
  const autoRef = useRef<HTMLElement>(null);
  const mcpRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const at = (ms: number, fn: () => void) => timers.push(setTimeout(() => { if (!cancelled) fn(); }, ms));
    const set = (patch: Partial<State>) => setSt((p) => ({ ...p, ...patch }));

    const playSearch = () => {
      set({ qChars: 0, results: 0 });
      for (let c = 1; c <= QUERY.length; c++) at(250 + c * 34, () => set({ qChars: c }));
      const end = 250 + QUERY.length * 34;
      RESULTS.forEach((_, i) => at(end + 260 + i * 260, () => set({ results: i + 1 })));
    };
    const playXray = () => {
      set({ signals: 0 });
      SIGNALS.forEach((_, i) => at(300 + i * 420, () => set({ signals: i + 1 })));
    };
    const playAuto = () => {
      set({ landlord: false, replyChars: 0, chips: 0 });
      at(200, () => set({ landlord: true }));
      for (let c = 1; c <= REPLY.length; c++) at(800 + c * 22, () => set({ replyChars: c }));
      const end = 800 + REPLY.length * 22;
      CHIPS.forEach((_, i) => at(end + 220 + i * 220, () => set({ chips: i + 1 })));
    };
    const playMcp = () => {
      set({ callChars: 0, lines: 0 });
      for (let c = 1; c <= CALL.length; c++) at(250 + c * 30, () => set({ callChars: c }));
      const end = 250 + CALL.length * 30;
      RESPONSE.forEach((_, i) => at(end + 300 + i * 160, () => set({ lines: i + 1 })));
    };

    const observers: IntersectionObserver[] = [];
    const arm = (el: Element | null, play: () => void) => {
      if (!el) return;
      // Already scrolled past: leave the finished state.
      if (el.getBoundingClientRect().bottom < 0) return;
      const io = new IntersectionObserver((entries) => {
        if (entries.some((e) => e.isIntersecting)) { play(); io.disconnect(); }
      }, { threshold: 0.5 });
      io.observe(el);
      observers.push(io);
    };
    arm(searchRef.current, playSearch);
    arm(xrayRef.current, playXray);
    arm(autoRef.current, playAuto);
    arm(mcpRef.current, playMcp);

    return () => {
      cancelled = true;
      observers.forEach((io) => io.disconnect());
      timers.forEach(clearTimeout);
    };
  }, []);

  const score = SCORE_STEPS[st.signals];

  return (
    <section className={s.section} aria-labelledby="demos-title">
      <div className={s.inner}>
        <h2 id="demos-title" className={s.h2}>Watch it work</h2>
        <p className={s.sub}>Four short replays of what the agent does while you get on with your day. The listings are examples.</p>

        <div className={s.grid}>
          {/* Search */}
          <GlareCard>
            <article ref={searchRef} className={s.demo}>
              <Head title="Search, ranked and screened" icon={<svg viewBox="0 0 24 24" width="20" height="20"><circle cx="11" cy="11" r="6.5" {...stroke} /><path d="M16 16l4 4" {...stroke} /></svg>} />
              <div className={s.body} role="img" aria-label={`Query: ${QUERY}. Results: ${RESULTS.map((r) => `${r.title}, ${r.price}, scam risk ${r.risk} out of 100`).join("; ")}.`}>
                <div aria-hidden="true">
                  <p className={s.input}>
                    <svg viewBox="0 0 24 24" width="15" height="15"><circle cx="11" cy="11" r="6.5" {...stroke} /><path d="M16 16l4 4" {...stroke} /></svg>
                    <Typed text={QUERY} chars={st.qChars} />
                  </p>
                  <ul className={s.list}>
                    {RESULTS.map((r, i) => (
                      <Shown key={r.title} on={i < st.results} className={`${s.result} ${r.bad ? s.resultBad : ""}`}>
                        <span className={s.resultTitle}>{r.title}</span>
                        <b>{r.price}</b>
                        <span className={r.bad ? s.riskBad : s.riskOk}><i />{r.bad ? "Blocked" : `Risk ${r.risk}`}</span>
                      </Shown>
                    ))}
                  </ul>
                </div>
              </div>
              <p className={s.foot}>Live Craigslist results, priced against SF medians and X-rayed before you see them.</p>
            </article>
          </GlareCard>

          {/* Scam X-ray */}
          <GlareCard>
            <article ref={xrayRef} className={s.demo}>
              <Head title="Scam X-ray" icon={<svg viewBox="0 0 24 24" width="20" height="20"><path d="M12 3l7 3v5c0 4.5-3 8.2-7 10-4-1.8-7-5.5-7-10V6l7-3z" {...stroke} /><path d="M9.5 9.5l5 5M14.5 9.5l-5 5" {...stroke} /></svg>} />
              <div className={s.body} role="img" aria-label={`Sunny 1BR on Ortega St, $1,100 a month. Signals: ${SIGNALS.join("; ")}. Scam risk 91 out of 100, blocked.`}>
                <div aria-hidden="true">
                  <p className={s.listing}><span>Sunny 1BR on Ortega St</span><b>$1,100/mo</b></p>
                  <ul className={s.list}>
                    {SIGNALS.map((sig, i) => (
                      <Shown key={sig} on={i < st.signals} className={s.signal}><i />{sig}</Shown>
                    ))}
                  </ul>
                  <div className={s.meter}>
                    <div className={s.meterTop}>
                      <span>Scam risk</span>
                      <b>{score}<small>/100</small></b>
                      <span className={s.blocked} data-on={st.signals === SIGNALS.length || undefined}>Blocked</span>
                    </div>
                    <div className={s.track}><span style={{ transform: `scaleX(${score / 100})` }} /></div>
                  </div>
                </div>
              </div>
              <p className={s.foot}>Every listing gets a score out of 100 and the reasons behind it.</p>
            </article>
          </GlareCard>

          {/* Autopilot */}
          <GlareCard>
            <article ref={autoRef} className={s.demo}>
              <Head title="Autopilot that never pays first" icon={<svg viewBox="0 0 24 24" width="20" height="20"><rect x="3.5" y="5.5" width="17" height="13" rx="3" {...stroke} /><path d="M4 7l8 6 8-6" {...stroke} /></svg>} />
              <div className={s.body} role="img" aria-label={`Landlord: ${LANDLORD} Your agent replies: ${REPLY} Outcome: ${CHIPS.join(", ")}.`}>
                <ul className={s.thread} aria-hidden="true">
                  <Shown on={st.landlord} className={s.them}><small>Landlord</small>{LANDLORD}</Shown>
                  <li className={s.me}><small>Your agent, as you</small><Typed text={REPLY} chars={st.replyChars} /></li>
                </ul>
                <ul className={s.chips} aria-hidden="true">
                  {CHIPS.map((c, i) => <Shown key={c} on={i < st.chips}>{c}</Shown>)}
                </ul>
              </div>
              <p className={s.foot}>Writes in your name, only to landlords you approved.</p>
            </article>
          </GlareCard>

          {/* MCP */}
          <GlareCard>
            <article ref={mcpRef} className={s.demo}>
              <Head title="Callable from your own agent" icon={<svg viewBox="0 0 24 24" width="20" height="20"><path d="M9 4v4M15 4v4M7 8h10v3a5 5 0 0 1-10 0V8zM12 16v4" {...stroke} /></svg>} />
              <div className={s.body} role="img" aria-label="An MCP client calls check_listing_scam on the Ortega St listing and gets back light red, scam score 91, four signals, and the verdict: high scam risk, do not send money or personal info.">
                <div className={s.code} aria-hidden="true">
                  <p className={s.codeCall}><span className={s.codeDim}>MCP tool call</span><Typed text={CALL} chars={st.callChars} /></p>
                  <ul className={s.codeOut}>
                    {RESPONSE.map(([k, v], i) => (
                      <Shown key={k} on={i < st.lines}><span className={s.codeKey}>{k}</span><span className={k === "light" ? s.codeRed : undefined}>{v}</span></Shown>
                    ))}
                  </ul>
                </div>
              </div>
              <p className={s.foot}>The same tools over MCP, with the same guardrails, for Claude Code or any MCP client.</p>
            </article>
          </GlareCard>
        </div>
      </div>
    </section>
  );
}
