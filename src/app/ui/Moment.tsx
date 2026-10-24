"use client";
import { useEffect } from "react";

export type MomentData = { kind: "scam"; title: string; detail: string; saved?: number } | { kind: "booked"; title: string; when: string; day: string; month: string };

/** Full-screen beat for the two moments that matter in the demo. Auto-dismisses; click anywhere to close. */
export function Moment({ m, onDone }: { m: MomentData | null; onDone: () => void }) {
  useEffect(() => {
    if (!m) return;
    const id = setTimeout(onDone, m.kind === "scam" ? 3200 : 3600);
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") onDone(); };
    window.addEventListener("keydown", key);
    return () => { clearTimeout(id); window.removeEventListener("keydown", key); };
  }, [m, onDone]);
  if (!m) return null;
  return (
    <div className={`moment ${m.kind}`} onClick={onDone} role="alert">
      {m.kind === "scam" ? (
        <div className="moment-card">
          <div className="shield"><svg viewBox="0 0 24 24" width="44" height="44" aria-hidden="true"><path d="M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5l-8-3Z" fill="currentColor" /><path d="M8.5 12.5 11 15l4.5-5" stroke="#fff" strokeWidth="2.2" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg></div>
          <div className="stamp">SCAM BLOCKED</div>
          <p className="moment-title">{m.title}</p>
          <p className="moment-sub">{m.detail}</p>
          {m.saved ? <p className="moment-saved"><b>${m.saved.toLocaleString("en-US")}</b> protected. Your agent refused to pay before a viewing.</p>
            : <p className="moment-foot">Your agent refused. Not a single dollar left your account.</p>}
        </div>
      ) : (
        <div className="moment-card ticket">
          <div className="cal"><span>{m.month}</span><b>{m.day}</b></div>
          <div className="ticket-k">Viewing booked</div>
          <p className="moment-when">{m.when}</p>
          <p className="moment-title">{m.title}</p>
          <p className="moment-foot">On your calendar, confirmation sent to the landlord. Pay nothing before you see it.</p>
        </div>
      )}
    </div>
  );
}
