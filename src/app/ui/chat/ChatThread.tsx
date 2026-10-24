"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Bot } from "../../Bot";
import { Rich, RichInline, plainText, splitIcon } from "../Rich";
import type { ChatMsg } from "@/lib/store";
import type { FollowUp } from "./followups";

/** claude.ai-style thread: user pills on the right, agent replies as plain text, autopilot narration as quiet status lines. */
type Block = { kind: "user"; m: ChatMsg; i: number } | { kind: "agent"; m: ChatMsg; i: number } | { kind: "status"; ms: ChatMsg[]; i: number };

function blocksOf(chat: ChatMsg[]): Block[] {
  const out: Block[] = [];
  chat.forEach((m, i) => {
    const prev = out[out.length - 1];
    if (m.role === "user") out.push({ kind: "user", m, i });
    else if (m.auto && prev?.kind === "status") prev.ms.push(m);
    else if (m.auto) out.push({ kind: "status", ms: [m], i });
    else out.push({ kind: "agent", m, i });
  });
  return out;
}

const svg = (d: ReactNode, size = 16) => <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>;
const I = {
  copy: svg(<><rect x="9" y="9" width="11" height="11" rx="2.5" /><path d="M5 15V6.5A1.5 1.5 0 0 1 6.5 5H15" /></>),
  check: svg(<path d="M5 12.5l4.5 4.5L19 7.5" />),
  up: svg(<path d="M7 11v9H4.5A1.5 1.5 0 0 1 3 18.5v-6A1.5 1.5 0 0 1 4.5 11H7zm0 0l4-7.5a2 2 0 0 1 3.7 1.3L14 9h4.6a2 2 0 0 1 2 2.4l-1.4 7A2 2 0 0 1 17.2 20H7" />),
  down: svg(<path d="M17 13V4h2.5A1.5 1.5 0 0 1 21 5.5v6a1.5 1.5 0 0 1-1.5 1.5H17zm0 0l-4 7.5a2 2 0 0 1-3.7-1.3L10 15H5.4a2 2 0 0 1-2-2.4l1.4-7A2 2 0 0 1 6.8 4H17" />),
  retry: svg(<><path d="M20 11a8 8 0 1 0-2.3 5.7" /><path d="M20 4.5V11h-6.5" /></>),
  more: svg(<><circle cx="5.5" cy="12" r=".9" fill="currentColor" /><circle cx="12" cy="12" r=".9" fill="currentColor" /><circle cx="18.5" cy="12" r=".9" fill="currentColor" /></>),
  arrow: svg(<path d="M7 7l10 10M17 9v8H9" />, 15),
};

/** Narration emoji to a small line icon, so status lines stay calm. */
const ST_ICON: Record<string, [string, ReactNode]> = {
  "🚩": ["red", <path key="f" d="M5 21V4m0 0h11l-2 4 2 4H5" />],
  "✉": ["", <><rect key="a" x="3.5" y="5.5" width="17" height="13" rx="2" /><path key="b" d="M4 7l8 6 8-6" /></>],
  "💬": ["", <path key="c" d="M5 18.5V7a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H8.5L5 18.5z" />],
  "💸": ["green", <><path key="d" d="M12 3.5v17" /><path key="e" d="M16.5 7.5c-.8-1.3-2.4-2-4.5-2-2.5 0-4 1.2-4 3s1.6 2.6 4 3.2 4 1.3 4 3.3-1.7 3-4.2 3c-2.2 0-3.8-.8-4.6-2.2" /></>],
  "🤝": ["green", <path key="g" d="M5 12.5l4.5 4.5L19 7.5" />],
  "🗓": ["", <><rect key="h" x="4" y="5.5" width="16" height="14.5" rx="2" /><path key="i" d="M4 10h16M8.5 3.5v4M15.5 3.5v4" /></>],
  "📅": ["green", <><rect key="j" x="4" y="5.5" width="16" height="14.5" rx="2" /><path key="k" d="M4 10h16M8.5 3.5v4M15.5 3.5v4M9 15l2 2 4-4" /></>],
  "✅": ["green", <path key="l" d="M5 12.5l4.5 4.5L19 7.5" />],
  "📋": ["", <><rect key="m" x="5.5" y="4.5" width="13" height="16" rx="2" /><path key="n" d="M9 4.5h6v2.5H9zM9 12h6M9 15.5h4" /></>],
};
function StatusLine({ line }: { line: string }) {
  const [emoji, text] = splitIcon(line);
  const ic = emoji ? ST_ICON[emoji.replace(/️/g, "")] : undefined;
  return <li className={`c-st${ic?.[0] ? ` ${ic[0]}` : ""}`}>
    <span className="c-st-ico" aria-hidden="true">{ic ? svg(ic[1], 14) : <i />}</span>
    <span className="c-st-t"><RichInline text={text} /></span>
  </li>;
}

function Act({ label, onClick, pressed, disabled, children }: { label: string; onClick: () => void; pressed?: boolean; disabled?: boolean; children: ReactNode }) {
  return <button type="button" className={`c-act${pressed ? " on" : ""}`} aria-label={label} data-tip={label} aria-pressed={pressed} disabled={disabled} onClick={onClick}>{children}</button>;
}

async function copy(text: string) {
  try { await navigator.clipboard.writeText(text); toast.success("Copied"); }
  catch { toast.error("Couldn't copy", { description: "Your browser blocked the clipboard." }); }
}

type Votes = Record<string, "up" | "down">;
function Actions({ text, id, canRetry, onRetry, vote, setVote }: { text: string; id: string; canRetry: boolean; onRetry: () => void; vote: Votes; setVote: (f: (v: Votes) => Votes) => void }) {
  const [copied, setCopied] = useState(false);
  const [menu, setMenu] = useState(false);
  const wrap = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!menu) return;
    const off = (e: PointerEvent) => { if (!wrap.current?.contains(e.target as Node)) setMenu(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setMenu(false); };
    document.addEventListener("pointerdown", off); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", off); document.removeEventListener("keydown", esc); };
  }, [menu]);
  useEffect(() => { if (!copied) return; const t = setTimeout(() => setCopied(false), 1400); return () => clearTimeout(t); }, [copied]);
  const v = vote[id];
  const toggle = (d: "up" | "down") => setVote((x) => { const n = { ...x }; if (n[id] === d) delete n[id]; else n[id] = d; return n; });
  return <div className="c-acts" role="toolbar" aria-label="Message actions" ref={wrap}>
    <Act label={copied ? "Copied" : "Copy"} onClick={() => { void copy(text); setCopied(true); }}><span className="c-swap" data-on={copied || undefined}>{I.copy}{I.check}</span></Act>
    <Act label="Good response" pressed={v === "up"} onClick={() => toggle("up")}>{I.up}</Act>
    <Act label="Bad response" pressed={v === "down"} onClick={() => toggle("down")}>{I.down}</Act>
    <Act label="Retry" disabled={!canRetry} onClick={onRetry}>{I.retry}</Act>
    <span className="c-more">
      <Act label="More" pressed={menu} onClick={() => setMenu((x) => !x)}>{I.more}</Act>
      {menu && <div className="c-menu" role="menu">
        <button type="button" role="menuitem" autoFocus onClick={() => { void copy(plainText(text)); setMenu(false); }}>{I.copy}Copy as text</button>
      </div>}
    </span>
  </div>;
}

/** The full autopilot narration, oldest first (shown in the Activity tab). */
export function Narration({ chat }: { chat: ChatMsg[] }) {
  const lines = chat.filter((m) => m.role === "assistant" && m.auto).flatMap((m) => m.text.split("\n").filter((l) => l.trim()));
  if (!lines.length) return null;
  return <ul className="c-status narr">{lines.map((l, i) => <StatusLine key={i} line={l} />)}</ul>;
}

export interface ChatThreadProps {
  chat: ChatMsg[];
  greeting: string;
  typing: boolean;
  /** Show the action row and follow-ups (nothing is in flight). */
  idle: boolean;
  consent?: { options: string[]; onPick: (option: string, index: number) => void };
  followUps: FollowUp[];
  onFollowUp: (f: FollowUp) => void;
  onRetry: (text: string) => void;
}

export function ChatThread({ chat, greeting, typing, idle, consent, followUps, onFollowUp, onRetry }: ChatThreadProps) {
  const blocks = blocksOf(chat);
  const last = blocks[blocks.length - 1];
  const endsWithAgent = !last || last.kind !== "user";
  // The latest agent run: every assistant message since the last user message.
  const lastUser = [...chat].reverse().find((m) => m.role === "user");
  const runStart = chat.length - [...chat].reverse().findIndex((m) => m.role === "user");
  const run = lastUser ? chat.slice(runStart) : chat;
  const runText = run.map((m) => m.text).join("\n\n");
  const showTail = idle && !typing && endsWithAgent;
  const [vote, setVote] = useState<Votes>({});

  const row = (first: boolean, body: ReactNode, key: string | number, cls = "") =>
    <div key={key} className={`c-row c-agent-row${first ? " c-head" : ""}${cls}`}>
      <span className="c-ava" aria-hidden="true">{first && <Bot size={18} />}</span>
      <div className="c-body">{body}</div>
    </div>;

  return <div className="c-thread" aria-live="polite" aria-relevant="additions">
    {chat.length === 0 && row(true, <div className="c-agent"><Rich text={greeting} /></div>, "hello")}
    {blocks.map((b, k) => {
      const first = blocks[k - 1]?.kind !== "agent" && blocks[k - 1]?.kind !== "status";
      if (b.kind === "user") return <div key={b.i} className="c-row c-user-row"><div className="c-user">{b.m.text}</div></div>;
      if (b.kind === "agent") return row(first, <div className="c-agent"><Rich text={b.m.text} /></div>, b.i);
      // The narration log lives in Activity; the chat keeps only the newest autopilot line, and only while it is the latest beat.
      if (k !== blocks.length - 1) return null;
      const latest = b.ms.flatMap((m) => m.text.split("\n").filter((l) => l.trim())).at(-1);
      return latest ? row(first, <div className="c-status" role="status" aria-label="Latest autopilot update">
        <ul><StatusLine key={latest} line={latest} /></ul>
      </div>, b.i, " c-strow") : null;
    })}
    {typing && row(!endsWithAgent || chat.length === 0, <div className="c-typing" aria-label="Your agent is typing"><i /><i /><i /></div>, "typing")}
    {showTail && <div className="c-tail">
      {consent && <div className="c-cta" role="group" aria-label="Let your agent run on autopilot?">
        {consent.options.map((o, k) => <button key={o} type="button" className={k === 0 ? "c-btn primary" : "c-btn"} onClick={() => consent.onPick(o, k)}>{o}</button>)}
      </div>}
      {chat.length > 0 && <Actions text={runText} id={run[run.length - 1]?.at ?? "x"} canRetry={!!lastUser} onRetry={() => lastUser && onRetry(lastUser.text)} vote={vote} setVote={setVote} />}
      {followUps.length > 0 && <ul className="c-follow" aria-label="Suggested follow-ups">
        {followUps.slice(0, 2).map((f, k) => <li key={f.label} style={{ "--i": k } as React.CSSProperties}>
          <button type="button" className="c-fu" onClick={() => onFollowUp(f)}><span className="c-fu-ico">{I.arrow}</span><span>{f.label}</span></button>
        </li>)}
      </ul>}
    </div>}
  </div>;
}
