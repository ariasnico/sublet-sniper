"use client";
import { useEffect, useRef, useState } from "react";
import type { Thread } from "@/lib/store";
import type { RankedListing } from "@/lib/types";

const STATUS: Record<Thread["status"], string> = { awaiting_landlord: "Emailed, waiting", active: "Talking", viewing_proposed: "Slots offered", booked: "Viewing booked", flagged: "Scam refused" };
const ago = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  return m < 1 ? "now" : m < 60 ? `${m}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`;
};
// Messages newer than page load are "live": they get the typing treatment.
const PAGE_LOAD = typeof window === "undefined" ? "" : new Date().toISOString();

type Check = { k: string; state: "ok" | "wait" | "blocked" };
function protocol(t: Thread, l?: RankedListing): Check[] {
  const landlord = t.messages.filter((m) => m.from === "landlord").map((m) => m.text).join("\n");
  const flagged = t.messages.some((m) => m.flagged);
  return [
    { k: !l || l.scam.light === "green" ? "Passed scam check" : `Scam score ${l.scam.score}`, state: !l || l.scam.light === "green" ? "ok" : "blocked" },
    { k: "Live video tour", state: /video (tour|walkthrough|call)|facetime|zoom/i.test(landlord) ? "ok" : "wait" },
    { k: "Leaseholder confirmed", state: /\b(i(?:'m| am) the (owner|leaseholder|tenant on the lease)|my name is on the lease|landlord (approved|approval|is ok)|sublease (addendum|agreement))\b/i.test(landlord) ? "ok" : "wait" },
    { k: flagged ? "Money request refused" : "No money before viewing", state: flagged ? "blocked" : "ok" },
    { k: "Viewing booked", state: t.status === "booked" ? "ok" : "wait" },
  ];
}

const money = (t: string) => [...t.replace(/,/g, "").matchAll(/\$\s?(\d{3,5})(?!\d)/g)].map((m) => Number(m[1]));
/** Price negotiation read from the thread itself: what was listed, what the landlord asked, what the agent offered. */
export function deal(t: Thread, l?: RankedListing) {
  let asked: number | null = null, offered: number | null = null;
  for (const m of t.messages) {
    if (m.from === "landlord" && !m.flagged) { const a = money(m.text).filter((x) => x >= 500 && x < 20000); if (a.length) { asked = a[0]; offered = null; } }
    if (m.from === "agent" && asked) { const o = m.text.replace(/,/g, "").match(/would you do \$(\d{3,5})|(?:offer|counter)[^$]{0,20}\$(\d{3,5})/i); const below = money(m.text).filter((x) => x < asked! && x >= 500); if (o) offered = Number(o[1] ?? o[2]); else if (below.length) offered = Math.min(...below); }
  }
  if (!asked) return null;
  return { listed: l?.priceMonthly ?? null, asked, offered };
}

function Typed({ text, live }: { text: string; live: boolean }) {
  const [n, setN] = useState(live ? 0 : text.length);
  useEffect(() => {
    if (!live || window.matchMedia("(prefers-reduced-motion: reduce)").matches) { setN(text.length); return; }
    const step = Math.max(2, Math.ceil(text.length / 120)); // ~2s regardless of length
    const id = setInterval(() => setN((x) => { if (x >= text.length) { clearInterval(id); return x; } return x + step; }), 16);
    return () => clearInterval(id);
  }, [text, live]);
  return <>{text.slice(0, n)}{n < text.length && <span className="caret" />}</>;
}

function Bubble({ x }: { x: Thread["messages"][number] }) {
  const [open, setOpen] = useState(false);
  const live = x.from === "agent" && !!PAGE_LOAD && x.at > PAGE_LOAD;
  const long = x.text.length > 220;
  return (
    <div className={`bub ${x.from === "landlord" ? "ll" : "ag"}${x.flagged ? " flagged" : ""}${live ? " live" : ""}`}>
      <div className="bub-who">{x.from === "landlord" ? "Landlord" : "Your agent, as you"}<span>{ago(x.at)}</span></div>
      <div className={`bub-text${long && !open && !live ? " clamp" : ""}`} onClick={() => long && setOpen(!open)}><Typed text={x.text} live={live} /></div>
      {x.flagged && <div className="bub-flag">Blocked: {x.flagged.join(", ")}</div>}
    </div>
  );
}

function ThreadCard({ t, listing }: { t: Thread; listing?: RankedListing }) {
  const [all, setAll] = useState(false);
  const msgs = all ? t.messages : t.messages.slice(-3);
  const last = t.messages[t.messages.length - 1];
  // The landlord just wrote and the agent hasn't answered yet: show it working.
  const replying = last?.from === "landlord" && !last.flagged && t.status !== "booked" && Date.now() - new Date(last.at).getTime() < 3 * 60e3;
  const fresh = useRef(last?.at);
  const [pulse, setPulse] = useState(false);
  useEffect(() => {
    if (last?.at && fresh.current && last.at !== fresh.current) { setPulse(true); const id = setTimeout(() => setPulse(false), 1600); fresh.current = last.at; return () => clearTimeout(id); }
    fresh.current = last?.at;
  }, [last?.at]);
  return (
    <div className={`th st-${t.status}${pulse ? " pulse" : ""}`}>
      <div className="th-head">
        <div className="th-title">{t.listingTitle.replace(/^\[DEMO DATA\]\s*/, "")}</div>
        <span className={`st st-${t.status}`}>{STATUS[t.status] ?? t.status}</span>
      </div>
      <div className="th-k">Safety checks</div>
      <ul className="proto" aria-label="Safety checks">
        {protocol(t, listing).map((c) => <li key={c.k} className={c.state}>
          <i aria-hidden="true">{c.state === "ok" ? "✓" : c.state === "blocked" ? "!" : ""}</i>{c.k}</li>)}
      </ul>
      {(() => { const d = deal(t, listing); if (!d) return null; const save = d.offered ? d.asked - d.offered : 0; return (
        <div className="deal">
          {d.listed && <div><span>Listed</span><b>${d.listed.toLocaleString("en-US")}</b></div>}
          <div className="asked"><span>They asked</span><b>${d.asked.toLocaleString("en-US")}</b></div>
          <div className={d.offered ? "offer" : "pending"}><span>{t.status === "booked" ? "Agent got" : "Agent offered"}</span><b>{d.offered ? `$${d.offered.toLocaleString("en-US")}` : "…"}</b></div>
          {save > 0 && <div className="save"><span>You save</span><b>${save.toLocaleString("en-US")}/mo</b></div>}
        </div>); })()}
      {t.messages.length > 3 && <button className="th-more" onClick={() => setAll(!all)}>{all ? "Show latest only" : `Show ${t.messages.length - 3} earlier`}</button>}
      <div className="th-msgs">
        {msgs.map((x, i) => <Bubble key={x.id ?? `${x.at}-${i}`} x={x} />)}
        {replying && <div className="bub ag replying"><div className="bub-who">Your agent, as you</div><div className="typing"><i /><i /><i /></div><span className="replying-t">Reading the reply and checking your calendar</span></div>}
      </div>
    </div>
  );
}

export function Inbox({ threads, listings = [] }: { threads: Thread[]; listings?: RankedListing[] }) {
  return <>{threads.map((t) => <ThreadCard key={t.id} t={t} listing={listings.find((l) => l.id === t.listingId)} />)}</>;
}
