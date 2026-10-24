"use client";
import { useEffect, useRef, useState } from "react";
import type { Thread } from "@/lib/store";

export interface StatusInput {
  /** What the agent is on, e.g. "Negotiating"; the detail follows after a dot. */
  label: string; detail?: string; tone: "live" | "wait" | "ok" | "guard";
  scanned: number; flagged: number; threads: Thread[]; booked: boolean; searching: boolean; stage?: string;
}

/** While a search runs, the headline walks through what the agent is doing (~400ms a beat). */
function useSearchBeat(searching: boolean, caught: number) {
  const beats = ["scanning listings", "scoring for scams", caught > 0 ? `${caught} caught` : "catching scams", "ranking"];
  const [i, setI] = useState(0);
  useEffect(() => {
    if (!searching) { setI(0); return; }
    const id = setInterval(() => setI((x) => x + 1), 400);
    return () => clearInterval(id);
  }, [searching]);
  return searching ? beats[i % beats.length] : null;
}

/** Crossfade a line of text when it changes: the old copy slides up and out (150ms) while the new one rises in (200ms).
 *  Both sit in the same grid cell, so the bar never jumps; each copy truncates on its own. */
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

const STEPS = ["Search", "Vet", "Contact", "Negotiate", "Book"] as const;

/** One status bar for the whole job: a stage dot, one headline ("Negotiating · offered $3,600 (asked $3,800)"),
 *  and the five steps as small dots (labels on hover). Counts live once, in the booked card's receipt. */
export function StatusBar({ label, detail, tone, scanned, flagged, threads, booked, searching, stage }: StatusInput) {
  const contacted = threads.length > 0;
  const replied = threads.some((t) => t.messages.some((m) => m.from === "landlord"));
  const done = [scanned > 0, scanned > 0, contacted, replied, booked];
  // A later step implies the earlier ones (a booked viewing means we searched and contacted).
  const last = done.lastIndexOf(true);
  done.forEach((_, i) => { if (i < last) done[i] = true; });
  const byStage = stage ? STEPS.findIndex((k) => k.toLowerCase() === stage.toLowerCase()) : -1;
  const current = searching ? 0 : byStage >= 0 ? byStage : done.findIndex((d) => !d);
  const beat = useSearchBeat(searching, flagged);
  const text = beat ? `Searching · ${beat}` : detail ? `${label} · ${detail}` : label;
  return (
    <div className={`sbar t-${searching ? "live" : tone}`} aria-live="polite">
      <span className="sbar-dot" aria-hidden="true" />
      <Swap className="nn-v sbar-v" text={text} />
      <ol className="sdots" aria-label="Progress">
        {STEPS.map((k, i) => {
          const live = (i === current && !done[i]) || (searching && i === 0);
          return <li key={k} className={live ? "now" : done[i] ? "done" : ""} aria-current={live ? "step" : undefined}
            data-tip={k} aria-label={`${k}${done[i] && !live ? ", done" : live ? ", in progress" : ""}`} tabIndex={0} />;
        })}
      </ol>
    </div>
  );
}
