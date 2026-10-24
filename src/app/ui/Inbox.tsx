"use client";
import { useState } from "react";
import type { Thread } from "@/lib/store";

const STATUS: Record<Thread["status"], string> = { awaiting_landlord: "Waiting on landlord", active: "Negotiating", viewing_proposed: "Slots offered", booked: "Viewing booked", flagged: "Scam refused" };
const ago = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  return m < 1 ? "now" : m < 60 ? `${m}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`;
};

function ThreadCard({ t, inbox }: { t: Thread; inbox?: string }) {
  const [all, setAll] = useState(false);
  const msgs = all ? t.messages : t.messages.slice(-3);
  return (
    <div className={`th st-${t.status}`}>
      <div className="th-head">
        <div className="th-title">{t.listingTitle.replace(/^\[DEMO DATA\]\s*/, "")}</div>
        <span className={`st st-${t.status}`}>{STATUS[t.status] ?? t.status}</span>
      </div>
      <div className="th-meta">Between {inbox ?? "your agent inbox"} and {t.landlordEmail}</div>
      {t.messages.length > 3 && <button className="th-more" onClick={() => setAll(!all)}>{all ? "Show latest only" : `Show ${t.messages.length - 3} earlier`}</button>}
      <div className="th-msgs">
        {msgs.map((x, i) => <Bubble key={x.id ?? `${x.at}-${i}`} x={x} />)}
      </div>
    </div>
  );
}

function Bubble({ x }: { x: Thread["messages"][number] }) {
  const [open, setOpen] = useState(false);
  const long = x.text.length > 220;
  return (
    <div className={`bub ${x.from === "landlord" ? "ll" : "ag"}${x.flagged ? " flagged" : ""}`}>
      <div className="bub-who">{x.from === "landlord" ? "Landlord" : "Your agent, as you"}<span>{ago(x.at)}</span></div>
      <div className={`bub-text${long && !open ? " clamp" : ""}`} onClick={() => long && setOpen(!open)}>{x.text}</div>
      {x.flagged && <div className="bub-flag">Blocked: {x.flagged.join(", ")}</div>}
    </div>
  );
}

export function Inbox({ threads, inbox }: { threads: Thread[]; inbox?: string }) {
  if (!threads.length) return <div className="empty"><b>No conversations yet</b>Approve contact on a listing and your agent emails the landlord, as you.</div>;
  return <>{threads.map((t) => <ThreadCard key={t.id} t={t} inbox={inbox} />)}</>;
}
