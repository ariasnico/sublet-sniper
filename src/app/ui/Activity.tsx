"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { CallRecord, ChatMsg, Thread } from "@/lib/store";
import type { RankedListing } from "@/lib/types";
import { ThreadCard, ago, deal, headline } from "./Inbox";
import { Narration } from "./chat/ChatThread";
import { cleanTitle } from "./Hero";

const reduced = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const TONE: Record<Thread["status"], string> = { awaiting_landlord: "wait", active: "live", viewing_proposed: "live", booked: "ok", flagged: "guard" };

export const callOf = (t: Thread, calls: CallRecord[]) => [...calls].reverse().find((c) => c.threadId === t.id || (!!c.amThreadId && c.amThreadId === t.agentmailThreadId));
export const lastAt = (t: Thread, call?: CallRecord) => [t.messages.at(-1)?.at ?? "", call?.endedAt ?? call?.startedAt ?? ""].sort().at(-1) ?? "";

interface CallProps { canCall?: boolean; onCall?: (threadId: string) => void; onBrowser?: (threadId: string) => void; onEnd?: () => void; browserLive?: boolean }

/** Activity: one row per landlord (status dot, name, last event, time). A row opens the drawer with every receipt. */
export function Activity({ threads, listings, calls, chat, open, onOpen, sim, extra, ...cp }: {
  threads: Thread[]; listings: RankedListing[]; calls: CallRecord[]; chat: ChatMsg[]; open: string | null; onOpen: (id: string | null) => void; sim?: ReactNode; extra?: ReactNode;
} & CallProps) {
  const rows = [...threads].sort((a, b) => lastAt(b, callOf(b, calls)).localeCompare(lastAt(a, callOf(a, calls))));
  return <div className="act">
    {sim}
    {rows.length ? <ul className="act-list">
      {rows.map((t) => {
        const call = callOf(t, calls);
        const l = listings.find((x) => x.id === t.listingId);
        const last = t.messages.at(-1);
        const replying = last?.from === "landlord" && !last.flagged && t.status !== "booked" && Date.now() - new Date(last.at).getTime() < 3 * 60e3;
        const line = call?.status === "calling" ? "On the phone now" : headline(t, deal(t, l), replying).text.replace(/\.$/, "");
        const at = lastAt(t, call);
        return <li key={t.id}>
          <button type="button" className={`act-row${open === t.id ? " on" : ""}`} onClick={() => onOpen(t.id)} aria-haspopup="dialog">
            <i className={`act-dot ${call?.status === "calling" ? "live" : TONE[t.status]}`} aria-hidden="true" />
            <span className="act-t">{cleanTitle(t.listingTitle)}</span>
            <span className="act-e">{line}</span>
            <time className="act-at" dateTime={at}>{at ? ago(at) : ""}</time>
          </button>
        </li>;
      })}
    </ul> : <div className="empty act-empty"><b>No landlords yet</b></div>}
    {extra}
    {chat.some((m) => m.auto) && <details className="act-log">
      <summary>Agent log</summary>
      <Narration chat={chat} />
    </details>}
    <Drawer t={threads.find((x) => x.id === open) ?? null} listings={listings} calls={calls} onClose={() => onOpen(null)} {...cp} />
  </div>;
}

/** The receipts for one landlord: deal table, safety checks, scam evidence, call transcript, emails. */
function Drawer({ t: openT, listings, calls, onClose, ...cp }: { t: Thread | null; listings: RankedListing[]; calls: CallRecord[]; onClose: () => void } & CallProps) {
  // Keep the last thread on screen while the exit plays.
  const [shown, setShown] = useState<Thread | null>(openT);
  if (openT && openT !== shown) setShown(openT);
  const closing = !openT && !!shown;
  useEffect(() => {
    if (!closing) return;
    const id = setTimeout(() => setShown(null), reduced() ? 0 : 200);
    return () => clearTimeout(id);
  }, [closing]);
  const closeBtn = useRef<HTMLButtonElement | null>(null);
  const isOpen = !!openT;
  useEffect(() => {
    if (!isOpen) return;
    const back = document.activeElement as HTMLElement | null;
    closeBtn.current?.focus({ preventScroll: true });
    const key = (e: KeyboardEvent) => { if (e.key === "Escape" && !document.querySelector(".xr, .moment")) onClose(); };
    window.addEventListener("keydown", key);
    return () => { window.removeEventListener("keydown", key); back?.focus?.({ preventScroll: true }); };
  }, [isOpen, onClose]);
  const t = openT ?? shown;
  if (!t) return null;
  const l = listings.find((x) => x.id === t.listingId);
  const call = callOf(t, calls);
  const reasons = l ? l.scam.reasons.filter((r) => !r.startsWith("info:") && !/^no scam signals/i.test(r)).map((r) => r.replace(/\s*\(.*\)$/, "")).slice(0, 4) : [];
  const flagged = t.messages.filter((m) => m.flagged).flatMap((m) => m.flagged ?? []).map((f) => f.replace(/\s*\(.*\)$/, ""));
  const evidence = [...new Set([...flagged, ...reasons])];
  return <div className={`dr-back${closing ? " out" : ""}`} onClick={closing ? undefined : onClose}>
    <aside className="dr" role="dialog" aria-modal="true" aria-label={`Deal: ${cleanTitle(t.listingTitle)}`} onClick={(e) => e.stopPropagation()}>
      <header className="dr-head">
        <h3>{cleanTitle(t.listingTitle)}</h3>
        <button ref={closeBtn} type="button" className="ghost sm" onClick={onClose} aria-label="Close">Close</button>
      </header>
      <div className="dr-scroll">
        <ThreadCard key={t.id} t={t} listing={l} call={call} expanded {...cp} />
        {evidence.length > 0 && <section className="dr-sec">
          <h4>Scam evidence{l && l.scam.light !== "green" ? ` · risk ${l.scam.score}/100` : ""}</h4>
          <ul className="dr-ev">{evidence.map((r) => <li key={r}><i aria-hidden="true">!</i>{r}</li>)}</ul>
        </section>}
      </div>
    </aside>
  </div>;
}
