"use client";

import { useEffect, useRef, useState } from "react";
import { CopyButton } from "./CopyButton";
import { Typed, useOnScreen, useTimeline } from "./motion";
import s from "./AgentTerminal.module.css";

const PROMPT = "Find me a safe furnished 1BR in SF under $4,000";
/*
 * Phases: 0 type install · 1 added · 2 type prompt · 3 tool 1 · 4 result 1
 * 5 tool 2 · 6 result 2 · 7 answer · 8 done
 */
const SPEED = 22;
const typeMs = (text: string) => text.length * SPEED + 350;

export function AgentTerminal({ command }: { command: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const onScreen = useOnScreen(ref, 0.35);
  const [started, setStarted] = useState(false);
  useEffect(() => { if (onScreen) setStarted(true); }, [onScreen]);
  const delays = useRef([typeMs(command), 650, typeMs(PROMPT), 700, 650, 700, 650, 600]).current;
  const p = useTimeline(delays, { playing: started, loop: false, final: delays.length });
  const on = (n: number) => (p >= n ? true : undefined);

  return (
    <div ref={ref} className={s.term}>
      <div className={s.head}>
        <span className={s.lights} aria-hidden="true"><i /><i /><i /></span>
        <span>Claude Code</span>
        <CopyButton text={command} className={s.copy} />
      </div>
      <div className={s.body}>
        <p className={s.cmd}><span className={s.ps} aria-hidden="true">$</span><span><Typed text={command} run={started} speed={SPEED} /></span></p>
        <p className={s.out} data-on={on(1)}>✓ Added HTTP MCP server <b>sublet-sniper</b></p>
        <p className={s.cmd} data-on={on(1)}><span className={s.ps} aria-hidden="true">&gt;</span><span><Typed text={PROMPT} run={p >= 2} speed={SPEED} /></span></p>
        <p className={s.tool} data-on={on(3)}><span className={s.dot} data-done={on(4)} aria-hidden="true" /><b>search_sublets</b>(maxPrice: 4000, furnished: true)</p>
        <p className={s.res} data-on={on(4)}>⎿ 774 listings scanned · <em>6 scams blocked</em></p>
        <p className={s.tool} data-on={on(5)}><span className={s.dot} data-done={on(6)} aria-hidden="true" /><b>check_listing_scam</b>(url: &quot;sfbay.craigslist.org/…/7791&quot;)</p>
        <p className={s.res} data-on={on(6)}>⎿ 🟢 0/100</p>
        <div className={s.answer} data-on={on(7)}>
          <p>Best match: furnished 1BR near Caltrain, $3,800, scam risk 0/100.</p>
          <p>Want me to call the landlord and book a viewing?</p>
        </div>
      </div>
    </div>
  );
}
