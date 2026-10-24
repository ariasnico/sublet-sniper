"use client";
import { useEffect, useRef, useState } from "react";
import type { Criteria } from "@/lib/types";
import type { Thread } from "@/lib/store";
import { useCountUp } from "./Stats";

const TYPE: Record<string, string> = { room: "Room", studio: "Studio", "1br": "1BR", "2br": "2BR", "3br+": "3BR+" };
const day = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

export interface MissionInput {
  criteria: Criteria | null | undefined; scanned: number; shown: number; flagged: number; threads: Thread[]; booked: boolean; searching: boolean;
  now: string; next: string; stage?: string; blocked: number; minutes: number;
}

/** While a search runs, the Now line walks through what the agent is doing (~400ms a beat). */
function useSearchBeat(searching: boolean, caught: number) {
  const beats = ["Scanning listings…", "Scoring for scams…", caught > 0 ? `${caught} caught…` : "Catching scams…", "Ranking…"];
  const [i, setI] = useState(0);
  useEffect(() => {
    if (!searching) { setI(0); return; }
    const id = setInterval(() => setI((x) => x + 1), 400);
    return () => clearInterval(id);
  }, [searching]);
  return searching ? beats[i % beats.length] : null;
}

/** Crossfade a line of text when it changes: the old copy slides up and out (150ms) while the new one rises in (200ms).
 *  Both sit in the same grid cell, so the strip never jumps; each copy truncates on its own. */
function Swap({ text, className }: { text: string; className: string }) {
  const [items, setItems] = useState<{ id: number; text: string; out?: boolean }[]>([{ id: 0, text }]);
  const last = useRef(text);
  const seq = useRef(0);
  useEffect(() => {
    if (text === last.current) return;
    last.current = text;
    const id = ++seq.current;
    setItems((xs) => [...xs.slice(-1).map((x) => ({ ...x, out: true })), { id, text }]);
    const t = setTimeout(() => setItems((xs) => xs.filter((x) => x.id === id)), 160);
    return () => clearTimeout(t);
  }, [text]);
  return (
    <span className={`${className} swap`}>
      {items.map((x) => <span key={x.id} className={x.out ? "out" : x.id ? "in" : undefined} aria-hidden={x.out || undefined} title={x.out ? undefined : x.text}>{x.text}</span>)}
    </span>
  );
}

function Num({ v, f }: { v: number; f: (n: number) => string }) { return <b>{f(useCountUp(v))}</b>; }

/** The whole job in one strip: what you asked for, how far the agent took it, what it is doing now and next. */
export function Mission({ criteria: c, scanned, shown, flagged, threads, booked, searching, now, next, stage, blocked, minutes }: MissionInput) {
  const contacted = threads.length > 0;
  const replied = threads.some((t) => t.messages.some((m) => m.from === "landlord"));
  const steps = [
    { k: "Search", done: scanned > 0, note: scanned ? `${scanned.toLocaleString("en-US")} listings` : "Craigslist, live" },
    { k: "Vet", done: scanned > 0, note: scanned ? `${flagged} scam${flagged === 1 ? "" : "s"} caught` : "Scam score 0-100" },
    { k: "Contact", done: contacted, note: contacted ? `${threads.length} landlord${threads.length > 1 ? "s" : ""} emailed` : shown ? `${shown} safe matches` : "As you, by email" },
    { k: "Negotiate", done: replied, note: replied ? "Landlord replied" : contacted ? "Waiting on reply" : "Price, proof, terms" },
    { k: "Book", done: booked, note: booked ? "Viewing on calendar" : "First free slot" },
  ];
  // A later step implies the earlier ones (a booked viewing means we searched and contacted).
  const last = steps.map((s) => s.done).lastIndexOf(true);
  steps.forEach((s, i) => { if (i < last) s.done = true; });
  const byStage = stage ? steps.findIndex((s) => s.k.toLowerCase() === stage.toLowerCase()) : -1;
  const current = searching ? 0 : byStage >= 0 ? byStage : steps.findIndex((s) => !s.done);
  const progress = current === -1 ? 1 : Math.max(0, current) / (steps.length - 1);
  const want = c ? [
    c.furnished ? "Furnished" : null,
    c.types.length ? c.types.map((t) => TYPE[t] ?? t).join(" or ") : "Any place",
    c.maxBudget ? `under $${c.maxBudget.toLocaleString("en-US")}` : null,
    c.from && c.to ? `${day(c.from)} to ${day(c.to)}` : c.from ? `from ${day(c.from)}` : null,
    c.near.length ? `near ${c.near.map((n) => n.name).join(", ")}` : null,
  ].filter(Boolean).join(", ") : null;
  const beat = useSearchBeat(searching, flagged);
  const nowText = beat ?? now;
  const int = (n: number) => Math.round(n).toLocaleString("en-US");
  const hrs = (n: number) => n < 60 ? `${Math.max(1, Math.round(n))} min` : `${(n / 60).toFixed(1)}h`;

  return (
    <div className="mission">
      <div className="mission-row">
        <div className="mission-ask">
          <span>Your search</span>
          <b title={want ?? undefined}>{want ?? "Not set yet"}</b>
        </div>
        <ol className="track" style={{ "--p": progress } as React.CSSProperties}>
          {steps.map((s, i) => {
            const live = (i === current && !s.done) || (searching && i === 0);
            return (
              <li key={s.k} className={live ? "now" : s.done ? "done" : ""} aria-current={live ? "step" : undefined}>
                <i>{s.done && !live ? <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="m3.5 8.5 3 3 6-7" stroke="currentColor" strokeWidth="2.2" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg> : i + 1}</i>
                <div><strong>{s.k}</strong><small>{s.note}</small></div>
              </li>
            );
          })}
        </ol>
      </div>
      <div className="mission-live" aria-live="polite">
        <div className="nn now"><span className="nn-dot" aria-hidden="true" /><span className="nn-k">Now</span><Swap className="nn-v" text={nowText} /></div>
        {!searching && next && <div className="nn next"><span className="nn-k">Next</span><Swap className="nn-v" text={next} /></div>}
        <span className="grow" />
        {scanned > 0 && <div className="mstats">
          <span><Num v={scanned} f={int} /> scanned</span>
          <span className="red"><Num v={blocked} f={int} /> scam{blocked === 1 ? "" : "s"} blocked</span>
          <span className="acc" title="Estimated time saved"><Num v={minutes} f={hrs} /> saved</span>
        </div>}
      </div>
    </div>
  );
}
