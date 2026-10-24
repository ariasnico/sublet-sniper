"use client";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { CallRecord, Thread } from "@/lib/store";
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
  // After a phone negotiation the stored deal is the record (spoken prices don't follow the email patterns).
  if (t.deal && t.messages.some((m) => m.channel === "call")) return { listed: l?.priceMonthly ?? null, asked: t.deal.asked, offered: t.deal.agreed ?? t.deal.offered };
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
      // Hold the caret while a full-screen moment (SCAM BLOCKED) covers the page, so the reply types where people can see it.
      if (document.querySelector(".moment")) return x;
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

type Ev = { title: string; start: string };
const cleanTitle = (s: string) => s.replace(/^Viewing: /, "").replace(/^\[DEMO DATA\]\s*/, "").trim();
const when = (iso: string) => new Date(iso).toLocaleString("en-US", { timeZone: "America/Los_Angeles", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** One plain-English line: what your agent did, and what happens next. You should never need to read the emails. */
function headline(t: Thread, d: ReturnType<typeof deal>, replying: boolean, ev?: Ev): { tone: "ok" | "busy" | "guard" | "wait"; text: string } {
  if (t.status === "booked") return { tone: "ok", text: ev ? `Viewing booked ${when(ev.start)}. You just show up.` : "Viewing booked. You just show up." };
  if (replying) return { tone: "busy", text: "The landlord just replied. Your agent is answering…" };
  const agreed = t.deal?.agreed;
  if (agreed) return { tone: "busy", text: `Landlord agreed to ${usd(agreed)}/mo. Booking the viewing…` };
  if (t.status === "viewing_proposed") return { tone: "wait", text: "Offered viewing times. Waiting for the landlord to pick one." };
  const flagged = t.messages.filter((m) => m.flagged);
  if (flagged.length) {
    const via = flagged.map((m) => m.text).join(" ").match(/zelle|wire|venmo|cash ?app|gift ?card|bitcoin|crypto|western union/i)?.[0];
    return { tone: "guard", text: `Refused to pay${via ? ` by ${via[0].toUpperCase()}${via.slice(1).toLowerCase()}` : ""} before a viewing${d?.offered ? ` and countered ${usd(d.offered)}` : ""}. Waiting for the landlord.` };
  }
  if (d?.offered) return { tone: "wait", text: `Countered ${usd(d.offered)} (they asked ${usd(d.asked)}). Waiting for the landlord.` };
  if (t.status === "active") return { tone: "wait", text: "Asked for a live video tour and proof of the lease. Waiting for the landlord." };
  return { tone: "wait", text: "Emailed the landlord as you. Waiting for a reply." };
}

/** Phone call state on a deal: a live pulsing line while calling, then the transcript behind one toggle. */
function CallBox({ c }: { c: CallRecord }) {
  if (c.status === "calling") {
    const line = c.transcript[c.transcript.length - 1];
    return <div className="call-live" aria-live="polite"><i aria-hidden="true" /><b>📞 Calling…</b>{line && <span key={line.id}>{line.from === "agent" ? "Agent" : "Landlord"}: {line.text}</span>}</div>;
  }
  if (c.status !== "done") return <div className="call-end">📞 {c.status === "no_answer" ? "No answer" : "Call failed"}</div>;
  return (
    <details className="call-tx">
      <summary>Call transcript</summary>
      <ol>{c.transcript.map((m, i) => <li key={m.id ?? i} className={m.from === "agent" ? "ag" : "ll"}><b>{m.from === "agent" ? "Agent" : "Landlord"}</b><span>{m.text}{m.flagged && <em> Refused</em>}</span></li>)}</ol>
    </details>
  );
}

interface CallProps { call?: CallRecord; canCall?: boolean; onCall?: (threadId: string) => void; onBrowser?: (threadId: string) => void; onEnd?: () => void; browserLive?: boolean }

function ThreadCard({ t, listing, ev, call, canCall, onCall, onBrowser, onEnd, browserLive }: { t: Thread; listing?: RankedListing; ev?: Ev } & CallProps) {
  // The emails are the receipts, not the job: collapsed by default. Anything that arrives while you watch peeks in.
  const [open, setOpen] = useState(false);
  const [all, setAll] = useState(false);
  const mail = t.messages.filter((m) => m.channel !== "call");
  const last = mail[mail.length - 1];
  const peek = mail.slice(-2).filter((m) => !!PAGE_LOAD && m.at > PAGE_LOAD);
  const msgs = open ? (all ? mail : mail.slice(-3)) : peek;
  // The landlord just wrote and the agent hasn't answered yet: show it working.
  const replying = last?.from === "landlord" && !last.flagged && t.status !== "booked" && Date.now() - new Date(last.at).getTime() < 3 * 60e3;
  const card = useRef<HTMLDivElement>(null);
  const fresh = useRef(last?.at);
  const [pulse, setPulse] = useState(false);
  // Keep the newest beat on screen so the presenter never has to scroll: bring the card's bottom into view,
  // but never scroll the deal bar (the price story) off the top. Only ever scrolls down, never jumps back.
  const reveal = useRef(() => requestAnimationFrame(() => {
    const el = card.current; const box = el?.closest<HTMLElement>(".scroll");
    if (!el || !box || !el.offsetParent || box.scrollHeight <= box.clientHeight) return;
    const top = (n: Element) => n.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop;
    const anchor = top(el.querySelector(".deal") ?? el) - 8;
    const want = Math.min(top(el) + el.offsetHeight - box.clientHeight + 4, anchor);
    if (want > box.scrollTop + 2) box.scrollTo({ top: want, behavior: reduced() ? "auto" : "smooth" });
  })).current;
  useEffect(() => {
    if (last?.at && fresh.current && last.at !== fresh.current) { setPulse(true); reveal(); const id = setTimeout(() => setPulse(false), 1400); fresh.current = last.at; return () => clearTimeout(id); }
    fresh.current = last?.at;
  }, [last?.at, reveal]);
  const d = deal(t, listing);
  const save = d?.offered ? d.asked - d.offered : 0;
  const now = headline(t, d, replying, ev);
  return (
    <div ref={card} className={`th st-${t.status}${pulse ? " pulse" : ""}`}>
      <div className="th-head">
        <div className="th-title">{t.listingTitle.replace(/^\[DEMO DATA\]\s*/, "")}</div>
        <span key={t.status} className={`st st-${t.status}`}>{STATUS[t.status] ?? t.status}</span>
      </div>
      <p key={now.text} className={`th-now ${now.tone}`} aria-live="polite"><i aria-hidden="true" />{now.text}</p>
      {call && <CallBox c={call} />}
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
      {(msgs.length > 0 || replying) && <div className="th-msgs">
        {msgs.map((x, i) => <Bubble key={x.id ?? `${x.at}-${i}`} x={x} last={i === msgs.length - 1} onTyped={i === msgs.length - 1 ? reveal : undefined} />)}
        {replying && <div className="bub ag replying"><div className="bub-who">Your agent, as you</div><div className="typing"><i /><i /><i /></div><span className="replying-t">Reading the reply and checking your calendar</span></div>}
      </div>}
      <div className="th-foot">
        <button className="th-more" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? "Hide the emails" : `See the emails (${mail.length})`}</button>
        {open && mail.length > 3 && <button className="th-more" onClick={() => setAll(!all)}>{all ? "Latest only" : `${mail.length - 3} earlier`}</button>}
        {canCall && t.listingId.startsWith("demo-") && call?.status !== "calling" && onCall && <button className="th-call" onClick={() => onCall(t.id)}>📞 Call landlord</button>}
        {onBrowser && t.listingId.startsWith("demo-") && call?.status !== "calling" && <button className="th-more" onClick={() => onBrowser(t.id)}>Talk as landlord (browser)</button>}
        {browserLive && call?.status === "calling" && call.mode === "browser" && onEnd && <button className="th-more" onClick={onEnd}>End call</button>}
      </div>
    </div>
  );
}

export function Inbox({ threads, listings = [], events = [], calls = [], ...cp }: { threads: Thread[]; listings?: RankedListing[]; events?: Ev[]; calls?: CallRecord[] } & Omit<CallProps, "call">) {
  return <>{threads.map((t) => {
    const title = cleanTitle(t.listingTitle);
    const call = [...calls].reverse().find((c) => c.threadId === t.id || (!!c.amThreadId && c.amThreadId === t.agentmailThreadId));
    return <ThreadCard key={t.id} t={t} listing={listings.find((l) => l.id === t.listingId)} ev={events.find((e) => cleanTitle(e.title) === title)} call={call} {...cp} />;
  })}</>;
}
