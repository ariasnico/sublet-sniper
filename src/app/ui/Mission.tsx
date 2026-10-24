"use client";
import type { Criteria } from "@/lib/types";
import type { Thread } from "@/lib/store";

const TYPE: Record<string, string> = { room: "Room", studio: "Studio", "1br": "1BR", "2br": "2BR", "3br+": "3BR+" };
const day = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

export interface MissionInput { criteria: Criteria | null | undefined; scanned: number; shown: number; flagged: number; threads: Thread[]; booked: boolean; searching: boolean }

/** The whole job on one line: what you asked for, and how far the agent has taken it. */
export function Mission({ criteria: c, scanned, shown, flagged, threads, booked, searching }: MissionInput) {
  const contacted = threads.length > 0;
  const replied = threads.some((t) => t.messages.some((m) => m.from === "landlord"));
  const steps = [
    { k: "Search", done: scanned > 0, live: searching, note: scanned ? `${scanned.toLocaleString("en-US")} listings` : "Craigslist, live" },
    { k: "Vet", done: scanned > 0, live: false, note: scanned ? `${flagged} scams caught` : "Scam score 0-100" },
    { k: "Contact", done: contacted, live: false, note: contacted ? `${threads.length} landlord${threads.length > 1 ? "s" : ""} emailed` : `${shown || "Best"} safe matches` },
    { k: "Negotiate", done: replied, live: contacted && !replied, note: replied ? "Landlord replied" : contacted ? "Waiting on reply" : "Price, proof, terms" },
    { k: "Book", done: booked, live: replied && !booked, note: booked ? "Viewing on calendar" : "First free slot" },
  ];
  // A later step implies the earlier ones (a booked viewing means we searched and contacted).
  const last = steps.map((s) => s.done).lastIndexOf(true);
  steps.forEach((s, i) => { if (i < last) s.done = true; });
  const current = steps.findIndex((s) => !s.done);
  const progress = current === -1 ? 1 : current / (steps.length - 1);
  const want = c ? [
    c.furnished ? "Furnished" : null,
    c.types.length ? c.types.map((t) => TYPE[t] ?? t).join(" or ") : "Any place",
    c.maxBudget ? `under $${c.maxBudget.toLocaleString("en-US")}` : null,
    c.from && c.to ? `${day(c.from)} to ${day(c.to)}` : c.from ? `from ${day(c.from)}` : null,
    c.near.length ? `near ${c.near.map((n) => n.name).join(", ")}` : null,
  ].filter(Boolean).join(", ") : null;

  return (
    <div className="mission">
      <div className="mission-ask">
        <span>Mission</span>
        <b>{want ?? "Tell your agent what you need"}</b>
      </div>
      <ol className="track" style={{ "--p": progress } as React.CSSProperties}>
        {steps.map((s, i) => (
          <li key={s.k} className={s.done ? "done" : i === current ? (s.live || i === current ? "now" : "") : ""}>
            <i>{s.done ? <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="m3.5 8.5 3 3 6-7" stroke="currentColor" strokeWidth="2.2" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg> : i + 1}</i>
            <div><strong>{s.k}</strong><small>{s.note}</small></div>
          </li>
        ))}
      </ol>
    </div>
  );
}
