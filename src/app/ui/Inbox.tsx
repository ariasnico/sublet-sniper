"use client";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { Thread } from "@/lib/store";
import type { RankedListing } from "@/lib/types";

const STATUS: Record<Thread["status"], string> = { awaiting_landlord: "Emailed, waiting", active: "Talking", viewing_proposed: "Slots offered", booked: "Viewing booked", flagged: "Scam refused" };
const ago = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  return m < 1 ? "now" : m < 60 ? `${m}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`;
};
// Messages newer than page load are "live": they get the typing treatment.
const PAGE_LOAD = typeof window === "undefined" ? "" : new Date().toISOString();
const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

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
    if (m.from === "landlord") {
      // A flagged message can still quote the rent ("$3,800/mo ... Zelle a $7,600 deposit"): read only the monthly figure.
      const rent = m.text.replace(/,/g, "").match(/\$\s?(\d{3,5})\s*(?:\/\s*mo|\/month|a month|per month)/i);
      const a = m.flagged ? (rent ? [Number(rent[1])] : []) : money(m.text).filter((x) => x >= 500 && x < 20000);
      // Accepting our counter ("$3,600 works") is not a new ask.
      if (a.length && !(offered && a[0] === offered)) { asked = a[0]; offered = null; }
    }
    if (m.from === "agent" && asked) { const o = m.text.replace(/,/g, "").match(/would you do \$(\d{3,5})|(?:offer|counter)[^$]{0,20}\$(\d{3,5})/i); const below = money(m.text).filter((x) => x < asked! && x >= 500); if (o) offered = Number(o[1] ?? o[2]); else if (below.length) offered = Math.min(...below); }
  }
  if (!asked) return null;
  return { listed: l?.priceMonthly ?? null, asked, offered };
}

function Typed({ text, live, onDone }: { text: string; live: boolean; onDone?: () => void }) {
  const [n, setN] = useState(live ? 0 : text.length);
  const done = useRef(onDone);
  useEffect(() => { done.current = onDone; }, [onDone]);
  useEffect(() => {
    if (!live || reduced()) { setN(text.length); if (live) done.current?.(); return; }
    const step = Math.max(2, Math.ceil(text.length / 120)); // ~2s regardless of length
    let fired = false;
    const id = setInterval(() => setN((x) => {
      if (x >= text.length) { clearInterval(id); if (!fired) { fired = true; setTimeout(() => done.current?.(), 0); } return x; }
      return Math.min(text.length, x + step);
    }), 16);
    return () => clearInterval(id);
  }, [text, live]);
  return <>{text.slice(0, n)}{n < text.length && <span className="caret" aria-hidden="true" />}</>;
}

function Bubble({ x, last, onTyped }: { x: Thread["messages"][number]; last: boolean; onTyped?: () => void }) {
  const [open, setOpen] = useState(false);
  // Newer than page load = arrived while you watched: it slides in from its own side and glows once.
  const fresh = !!PAGE_LOAD && x.at > PAGE_LOAD;
  const live = x.from === "agent" && fresh;
  const [typing, setTyping] = useState(live);
  const long = x.text.length > 220;
  // Only the newest live reply stays open while it types; older long ones collapse so the latest beat stays in view.
  const clamp = long && !open && !(live && last);
  return (
    <div className={`bub ${x.from === "landlord" ? "ll" : "ag"}${x.flagged ? " flagged" : ""}${fresh ? " fresh" : ""}${typing ? " live" : ""}`}>
      <div className="bub-who">{x.from === "landlord" ? "Landlord" : "Your agent, as you"}<span>{ago(x.at)}</span></div>
      <div className={`bub-text${clamp ? " clamp" : ""}`} onClick={() => long && setOpen(!open)}>
        <Typed text={x.text} live={live} onDone={() => { setTyping(false); onTyped?.(); }} /></div>
      {x.flagged && <div className="bub-flag"><i aria-hidden="true">!</i>Blocked: {x.flagged.join(", ")}</div>}
    </div>
  );
}

const usd = (n: number) => `$${n.toLocaleString("en-US")}`;

function ThreadCard({ t, listing }: { t: Thread; listing?: RankedListing }) {
  const [all, setAll] = useState(false);
  const msgs = all ? t.messages : t.messages.slice(-3);
  const last = t.messages[t.messages.length - 1];
  // The landlord just wrote and the agent hasn't answered yet: show it working.
  const replying = last?.from === "landlord" && !last.flagged && t.status !== "booked" && Date.now() - new Date(last.at).getTime() < 3 * 60e3;
  const card = useRef<HTMLDivElement>(null);
  const fresh = useRef(last?.at);
  const [pulse, setPulse] = useState(false);
  // Keep the newest beat on screen so the presenter never has to scroll. "nearest" means no jump when it already fits.
  const reveal = useRef(() => requestAnimationFrame(() => {
    const el = card.current; if (!el || !el.offsetParent) return;
    const box = el.closest(".scroll");
    el.scrollIntoView({ block: box && el.offsetHeight > box.clientHeight ? "end" : "nearest", behavior: reduced() ? "auto" : "smooth" });
  })).current;
  useEffect(() => {
    if (last?.at && fresh.current && last.at !== fresh.current) { setPulse(true); reveal(); const id = setTimeout(() => setPulse(false), 1400); fresh.current = last.at; return () => clearTimeout(id); }
    fresh.current = last?.at;
  }, [last?.at, reveal]);
  const d = deal(t, listing);
  const save = d?.offered ? d.asked - d.offered : 0;
  return (
    <div ref={card} className={`th st-${t.status}${pulse ? " pulse" : ""}`}>
      <div className="th-head">
        <div className="th-title">{t.listingTitle.replace(/^\[DEMO DATA\]\s*/, "")}</div>
        <span key={t.status} className={`st st-${t.status}`}>{STATUS[t.status] ?? t.status}</span>
      </div>
      <div className="th-k">Safety checks</div>
      <ul className="proto" aria-label="Safety checks">
        {/* Keyed by position so a chip keeps its node and cross-fades when its state flips; the dot remounts to replay its tick. */}
        {protocol(t, listing).map((c, i) => <li key={i} className={c.state} style={{ "--i": i } as CSSProperties}>
          <i key={c.state} aria-hidden="true">{c.state === "ok" ? "✓" : c.state === "blocked" ? "!" : ""}</i>{c.k}</li>)}
      </ul>
      {d && <div className="deal">
        {d.listed && <div className="listed"><span>Listed</span><b>{usd(d.listed)}</b></div>}
        <div className={`asked${d.offered ? " struck" : ""}`}><span>They asked</span><b>{usd(d.asked)}</b></div>
        <div className={d.offered ? "offer" : "pending"}><span>{t.status === "booked" ? "Agent got" : "Agent offered"}</span><b key={d.offered ?? "p"}>{d.offered ? usd(d.offered) : "…"}</b></div>
        {/* Always rendered so the bar never reflows when the saving lands. */}
        <div className={save > 0 ? "save" : "save pending"}><span>You save</span><b key={save}>{save > 0 ? `${usd(save)}/mo` : "…"}</b></div>
      </div>}
      {t.messages.length > 3 && <button className="th-more" onClick={() => setAll(!all)}>{all ? "Show latest only" : `Show ${t.messages.length - 3} earlier`}</button>}
      <div className="th-msgs">
        {msgs.map((x, i) => <Bubble key={x.id ?? `${x.at}-${i}`} x={x} last={i === msgs.length - 1} onTyped={i === msgs.length - 1 ? reveal : undefined} />)}
        {replying && <div className="bub ag replying"><div className="bub-who">Your agent, as you</div><div className="typing"><i /><i /><i /></div><span className="replying-t">Reading the reply and checking your calendar</span></div>}
      </div>
    </div>
  );
}

export function Inbox({ threads, listings = [] }: { threads: Thread[]; listings?: RankedListing[] }) {
  return <>{threads.map((t) => <ThreadCard key={t.id} t={t} listing={listings.find((l) => l.id === t.listingId)} />)}</>;
}
