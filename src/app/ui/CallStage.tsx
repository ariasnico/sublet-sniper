"use client";
import { Fragment, useEffect, useRef, useState } from "react";
import { Bot } from "../Bot";
import type { CallChip, LiveCall } from "@/lib/voice";

/**
 * The call stage: while the agent is on the phone with the landlord it takes over the homes + deals columns
 * (the chat stays visible). Live timer, both voices on a waveform, the transcript streaming line by line and the
 * negotiation beats as chips. It opens by itself when the call starts (the demo peak); Esc or the collapse button
 * folds it into the island (CallPill, top-center, live timer). When the call ends it holds a beat on the result,
 * folds into the island with a one-line result ("$3,600 agreed · viewing booked") for ~4s, then settles.
 */

const reduced = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const clock = (ms: number) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
const words = (t: string) => t.split(/\s+/).filter(Boolean);
type Side = "agent" | "landlord";
const HOLD_MS = 1700; // the result beat on the stage
const FOLD_MS = 240; // stage folds up into the island
const SUMMARY_MS = 4000; // the island shows the one-line result
const PILL_OUT_MS = 180;

export function CallStage({ call, onSettled, onTakeOver, onEnd }: { call: LiveCall; onSettled: () => void; onTakeOver?: () => void; onEnd?: () => void }) {
  const live = call.status === "calling";
  const lines = call.transcript.filter((m) => m.from !== "system");
  const [min, setMin] = useState(false);
  const [phase, setPhase] = useState<"live" | "result" | "closing" | "summary" | "gone">(live ? "live" : "result");
  const settled = useRef(onSettled);
  useEffect(() => { settled.current = onSettled; }, [onSettled]);

  // ---- timer ----
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { if (!live) return; const id = setInterval(() => setNow(Date.now()), 250); return () => clearInterval(id); }, [live]);
  const t0 = Date.parse(call.startedAt) || now;
  const elapsed = (live ? now : Date.parse(call.endedAt ?? "") || now) - t0;

  // ---- line-by-line streaming: `done` lines fully shown, `w` words of the next one ----
  const [done, setDone] = useState(() => Math.max(0, lines.length - 1));
  const [w, setW] = useState(0);
  const streaming = done < lines.length ? lines[done] : null;
  useEffect(() => {
    if (!streaming) return;
    const total = words(streaming.text).length;
    if (reduced()) { setDone(lines.length); setW(0); return; }
    // Catch up when lines pile up (a slow poll) or the call already ended; otherwise ~1s per line, like speech.
    const behind = lines.length - done > 1 || !live;
    const per = behind ? 28 : Math.min(110, Math.max(48, 1100 / total));
    if (w < total) { const id = setTimeout(() => setW((x) => x + 1), per); return () => clearTimeout(id); }
    const id = setTimeout(() => { setDone((d) => d + 1); setW(0); }, behind ? 60 : 200);
    return () => clearTimeout(id);
  }, [streaming, w, done, lines.length, live]);

  // ---- end of call: result beat on the stage, the stage folds into the island, the island shows the result, then fades ----
  useEffect(() => { if (!live && phase === "live") setPhase(min ? "summary" : "result"); }, [live, phase, min]);
  const caughtUp = done >= lines.length;
  useEffect(() => {
    if (phase !== "result" || !caughtUp) return;
    const id = setTimeout(() => setPhase("closing"), call.status === "done" ? HOLD_MS : 1200);
    return () => clearTimeout(id);
  }, [phase, caughtUp, call.status]);
  useEffect(() => {
    if (phase !== "closing") return;
    const id = setTimeout(() => setPhase("summary"), reduced() ? 0 : FOLD_MS);
    return () => clearTimeout(id);
  }, [phase]);
  useEffect(() => {
    if (phase !== "summary") return;
    const id = setTimeout(() => setPhase("gone"), SUMMARY_MS);
    return () => clearTimeout(id);
  }, [phase]);
  useEffect(() => {
    if (phase !== "gone") return;
    const id = setTimeout(() => {
      // The deal card that now holds the result gets one green pulse, then the VIEWING BOOKED moment plays.
      const card = document.querySelector<HTMLElement>(`.th[data-thread="${CSS.escape(call.threadId)}"]`);
      if (card && call.status === "done" && !reduced()) { card.classList.remove("landed"); void card.offsetWidth; card.classList.add("landed"); setTimeout(() => card.classList.remove("landed"), 1200); }
      settled.current();
    }, reduced() ? 0 : PILL_OUT_MS);
    return () => clearTimeout(id);
  }, [phase, call.threadId, call.status]);

  // ---- Esc folds the stage into the island ----
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === "Escape" && !document.querySelector(".moment, .xr")) setMin(true); };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);

  // ---- keep the newest line in view ----
  const scroller = useRef<HTMLOListElement>(null);
  useEffect(() => { const el = scroller.current; if (el) el.scrollTop = el.scrollHeight; }, [done, w, min]);

  // Who is talking: the line being streamed; between lines, the other side is answering (real calls deliver a turn when it ends).
  const last = lines[lines.length - 1];
  const speaker: Side | null = phase !== "live" ? null : streaming ? (streaming.from as Side) : last ? (last.from === "agent" ? "landlord" : "agent") : null;
  const ringing = live && !lines.length;
  const chips = (call.chips ?? []).filter((c) => c.at < done);
  const asked = chips.find((c) => c.kind === "asked");
  const agreed = chips.find((c) => c.kind === "agreed");
  const price = (c?: CallChip) => c?.label.match(/\$[\d,]+/)?.[0];
  const ok = call.status === "done";
  const title = live ? "Calling the landlord" : ok ? "Call done" : call.status === "no_answer" ? "No answer" : "Call failed";
  const phone = call.to && call.to !== "browser" ? `${call.to.slice(0, -4).replace(/\d/g, (d, i: number) => (i < 2 ? d : "•"))}${call.to.slice(-4)}` : call.mode === "browser" ? "Browser" : "";
  const shown = lines.slice(0, Math.min(lines.length, done + 1));
  const lastDone = lines[done - 1];

  const booked = (call.chips ?? []).find((c) => c.kind === "booked");
  const finalAgreed = (call.chips ?? []).find((c) => c.kind === "agreed");
  const outcome = ok ? [finalAgreed && `${price(finalAgreed)} agreed`, booked && "viewing booked"].filter(Boolean).join(" · ") || "Call done" : title;
  const stageOpen = (phase === "live" && !min) || phase === "result" || phase === "closing";
  const pill = (phase === "live" && min) || phase === "closing" || phase === "summary" || phase === "gone";

  return <>
    {pill && <CallPill live={phase === "live"} title={live ? "Calling landlord" : outcome} time={clock(elapsed)} ok={ok} leaving={phase === "gone"} onOpen={() => setMin(false)} />}
    {stageOpen && <section className={`cs ${phase}${ok && phase !== "live" ? " won" : ""}${!ok && !live ? " lost" : ""}`} aria-label="Live call with the landlord">
      <div className="cs-glow" aria-hidden="true" />
      <header className="cs-head">
        <span className={`cs-live${live ? "" : " off"}`} aria-hidden="true"><i /></span>
        <div className="cs-title">
          <h2>{title}<span className="cs-sep" aria-hidden="true"> · </span><b className="cs-clock" aria-label={`Elapsed ${clock(elapsed)}`}>{clock(elapsed)}</b></h2>
          <p>{call.listingTitle.replace(/^\[DEMO DATA\]\s*/, "").replace(/,\s*(Nov|Dec|Oct)\b.*$/, "")}{phone && <span className="cs-num">{phone}</span>}{call.mode === "mock" && <span className="cs-tag">Simulated</span>}</p>
        </div>
        <span className="grow" />
        {(asked || agreed) && <div className="cs-meter" aria-label={agreed ? `Agreed ${price(agreed)}` : `Asked ${price(asked)}`}>
          {!agreed && <em>Asked</em>}
          {asked && <span className={agreed ? "was" : ""}>{price(asked)}</span>}
          {agreed && <><i aria-hidden="true">→</i><b key={agreed.id}>{price(agreed)}</b></>}
          <small>/mo</small>
        </div>}
        {phase === "live" && <div className="cs-acts">
          <button className="cs-btn" onClick={() => { setMin(true); onTakeOver?.(); }}>Take over</button>
          {onEnd && <button className="cs-btn end" onClick={onEnd}>End</button>}
          <button className="cs-min" onClick={() => setMin(true)} aria-label="Collapse call (Esc)" title="Collapse (Esc)">
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M7 14.5 12 9.5l5 5" stroke="currentColor" strokeWidth="2.2" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg></button>
        </div>}
      </header>

      <div className="cs-duo">
        <div className={`cs-party ll${speaker === "landlord" ? " on" : ""}`}>
          <span className="cs-av" aria-hidden="true"><svg viewBox="0 0 24 24" width="30" height="30"><circle cx="12" cy="9" r="4" fill="currentColor" /><path d="M4.5 20c.9-3.9 3.9-6 7.5-6s6.6 2.1 7.5 6" fill="currentColor" /></svg></span>
          <b>Landlord</b><small>{ringing ? "Ringing…" : speaker === "landlord" ? "Speaking" : phase === "live" ? "Listening" : "Hung up"}</small>
        </div>
        <Wave speaker={speaker} ringing={ringing} />
        <div className={`cs-party ag${speaker === "agent" ? " on" : ""}`}>
          <span className="cs-av" aria-hidden="true"><Bot size={40} /></span>
          <b>Your agent</b><small>{ringing ? "Dialing" : speaker === "agent" ? "Speaking" : phase === "live" ? "Listening" : ok ? "Done" : "Ended"}</small>
        </div>
      </div>

      <ol className="cs-tx" ref={scroller} aria-hidden="true">
        {ringing && <li className="cs-ring">Ringing…</li>}
        {shown.map((m, i) => {
          const isStreaming = i === done;
          const text = isStreaming ? words(m.text).slice(0, w).join(" ") : m.text;
          return <Fragment key={m.id ?? i}>
            <li className={`cs-line ${m.from === "agent" ? "ag" : "ll"}${isStreaming ? " streaming" : ""}`}>
              <span className="cs-who">{m.from === "agent" ? "Agent" : "Landlord"}</span>
              <p>{text}{isStreaming && <i className="cs-caret" />}</p>
            </li>
            {chips.filter((c) => c.at === i).map((c) => {
              const resolved = c.resolvedAt !== undefined && c.resolvedAt < done;
              return <li key={c.id} className={`cs-chip ${resolved ? "good" : c.kind === "money" ? "bad" : c.tone}${resolved ? " resolved" : ""}`}>
                <i aria-hidden="true">{chipIcon(c, resolved)}</i><span>{c.label}</span>{resolved && <b>→ {c.result}</b>}
              </li>;
            })}
          </Fragment>;
        })}
      </ol>
      {/* Screen readers get whole lines, not a word-by-word stream. */}
      <p className="sr-only" aria-live="polite">{lastDone ? `${lastDone.from === "agent" ? "Agent" : "Landlord"}: ${lastDone.text}` : ringing ? "Ringing" : ""}</p>

      {phase !== "live" && ok && <div className="cs-result" role="status">
        <span className="cs-check" aria-hidden="true"><svg viewBox="0 0 24 24" width="22" height="22"><path d="M6 12.5 10.2 16.5 18 8" stroke="currentColor" strokeWidth="2.6" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg></span>
        <b>{finalAgreed ? finalAgreed.label : "Call done"}</b>
        {booked && <span>{booked.label}</span>}
      </div>}
    </section>}
  </>;
}

/** The island: pinned top-center while a call runs (click to open the stage); after the call it carries the one-line result. */
export function CallPill({ live, title, time, ok, leaving, onOpen }: { live: boolean; title: string; time: string; ok: boolean; leaving?: boolean; onOpen: () => void }) {
  if (live) {
    return <button className="cs-pill" onClick={onOpen} aria-label={`${title}, ${time}. Open the call`}>
      <i className="cs-pill-dot" aria-hidden="true" /><span>{title}</span><b>{time}</b>
      <span className="cs-pill-bars" aria-hidden="true"><i /><i /><i /><i /></span>
    </button>;
  }
  return <div className={`cs-pill done${ok ? " ok" : ""}${leaving ? " out" : ""}`} role="status">
    <i className="cs-pill-ok" aria-hidden="true">{ok ? "✓" : "!"}</i><span>{title}</span>
  </div>;
}

function chipIcon(c: CallChip, resolved: boolean) {
  if (resolved) return "✓";
  if (c.kind === "money" || c.kind === "story") return "!";
  if (c.kind === "booked") return "📅";
  if (c.kind === "agreed") return "✓";
  return "$";
}

/** Voice waveform: bars on the landlord half (left, stone) and agent half (right, orange) breathe with whoever speaks. */
function Wave({ speaker, ringing }: { speaker: Side | null; ringing: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const sp = useRef(speaker), ring = useRef(ringing);
  useEffect(() => { sp.current = speaker; ring.current = ringing; }, [speaker, ringing]);
  const N = 56;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const bars = [...el.children] as HTMLElement[];
    if (reduced()) { bars.forEach((b, i) => { b.style.transform = `scaleY(${0.25 + 0.2 * Math.sin(i)})`; }); return; }
    const cur = bars.map(() => 0.1);
    let raf = 0;
    const tick = (t: number) => {
      const s = sp.current;
      for (let i = 0; i < N; i++) {
        const x = i / (N - 1);
        const side: Side = x < 0.5 ? "landlord" : "agent";
        const u = side === "landlord" ? x * 2 : (x - 0.5) * 2; // 0..1 inside its half
        let target = 0.08 + 0.03 * Math.sin(t / 650 + i * 0.9);
        if (ring.current) {
          // Outbound ring: a pulse travels from the agent to the landlord.
          const p = 1 - ((t / 1300) % 1);
          target += 0.55 * Math.exp(-((x - p) ** 2) / 0.006);
        } else if (s === side) {
          const env = 0.35 + 0.65 * Math.sin(Math.PI * u);
          const syl = 0.5 + 0.5 * Math.sin(t / 95 + i * 1.7) * Math.sin(t / 260 + i * 0.55);
          const phrase = 0.55 + 0.45 * Math.max(0, Math.sin(t / 420));
          target = 0.14 + env * (0.2 + 0.8 * syl * phrase);
        }
        cur[i] += (target - cur[i]) * 0.2;
        bars[i].style.transform = `scaleY(${Math.min(1, cur[i]).toFixed(3)})`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return <div ref={ref} className="cs-wave" data-sp={speaker ?? (ringing ? "ring" : "none")} aria-hidden="true">
    {Array.from({ length: N }, (_, i) => <i key={i} className={i < N / 2 ? "ll" : "ag"} />)}
  </div>;
}
