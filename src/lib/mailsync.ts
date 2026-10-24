import { mailLive } from "./config";
import { am, fromAddress, inboxId } from "./mail";
import { demoListings } from "./demo";
import { sessionStart, state, uid, type Thread, type ThreadMsg } from "./store";

export const SUBJECT_TAG = "[Sublet Sniper demo]";
export const HANDLED = "sniper-handled";

export interface PendingInbound { messageId: string; threadId: string; from: string; text: string }

interface AmMsg { message_id?: string; from?: string; to?: string[]; labels?: string[]; text?: string; extracted_text?: string; timestamp?: string; subject?: string }

let lastSync = 0;
let pending: PendingInbound[] = [];
let inflight: Promise<PendingInbound[]> | null = null;
/** Per-instance cache: short so a reply handled by the webhook shows on the UI's next 2.5s /api/state poll. */
const TTL_MS = 3_000;

/** Forces the next syncThreads() to hit AgentMail (call after handling a message). */
export function bustSync() { lastSync = 0; }

/**
 * Rebuilds mail threads from AgentMail itself so they survive serverless cold starts and
 * multiple instances. Only threads whose subject carries SUBJECT_TAG are ours.
 * Returns landlord messages that no instance has handled yet (no HANDLED label).
 */
export async function syncThreads(force = false): Promise<PendingInbound[]> {
  if (!mailLive()) return [];
  if (!force && Date.now() - lastSync < TTL_MS) return pending;
  // Concurrent non-forced callers on one instance share a single AgentMail round-trip.
  if (!force && inflight) return inflight;
  const run = doSync().finally(() => { if (inflight === run) inflight = null; });
  if (!force) inflight = run;
  return run;
}

async function doSync(): Promise<PendingInbound[]> {
  lastSync = Date.now();
  const enc = encodeURIComponent(inboxId());
  const own = inboxId().toLowerCase();
  const list = await am(`/inboxes/${enc}/threads?limit=20`);
  const items = (Array.isArray(list.threads) ? list.threads : []) as Record<string, unknown>[];
  const s = state();
  const next: PendingInbound[] = [];
  for (const it of items) {
    if (!String(it.subject ?? "").includes(SUBJECT_TAG)) continue;
    // After a Reset, conversations from earlier sessions stay in AgentMail but are not part of this one
    // (otherwise the agent thinks it already wrote to that landlord and never starts the new deal).
    const since = sessionStart(); const touched = String(it.updated_at ?? it.timestamp ?? "");
    if (since && touched && touched < since) continue;
    const tid = String(it.thread_id);
    const full = await am(`/inboxes/${enc}/threads/${encodeURIComponent(tid)}`);
    const msgs = (Array.isArray(full.messages) ? full.messages : []) as AmMsg[];
    const firstOut = msgs.find((m) => fromAddress(String(m.from ?? "")) === own);
    const landlordEmail = fromAddress(String(firstOut?.to?.[0] ?? msgs.find((m) => fromAddress(String(m.from ?? "")) !== own)?.from ?? ""));
    const subject = String(full.subject ?? it.subject ?? "");
    const bare = subject.replace(SUBJECT_TAG, "").replace(/^re:\s*/i, "").trim();
    const listing = demoListings().find((l) => l.title.includes(bare));
    const tmsgs: ThreadMsg[] = msgs.map((m) => {
      const mine = fromAddress(String(m.from ?? "")) === own;
      const text = String((mine ? m.text : m.extracted_text ?? m.text) ?? "").trim();
      return { id: m.message_id, from: mine ? "agent" : "landlord", text, at: String(m.timestamp ?? "") };
    });
    for (const m of msgs) {
      const from = fromAddress(String(m.from ?? ""));
      if (from !== own && !(m.labels ?? []).includes(HANDLED) && m.message_id)
        next.push({ messageId: m.message_id, threadId: tid, from, text: String(m.extracted_text ?? m.text ?? "") });
    }
    const existing = s.threads.find((t) => t.agentmailThreadId === tid);
    const last = msgs[msgs.length - 1];
    const derived: Thread = {
      id: existing?.id ?? uid("th"), listingId: existing?.listingId ?? listing?.id ?? "demo-mission-bay",
      listingTitle: existing?.listingTitle ?? listing?.title ?? bare, landlordEmail, subject,
      messages: tmsgs, agentmailThreadId: tid, lastMessageId: last?.message_id,
      status: existing?.status ?? (tmsgs.some((m) => m.from === "landlord") ? "active" : "awaiting_landlord"),
      askedProof: existing?.askedProof ?? true, offeredSlots: existing?.offeredSlots,
    };
    if (existing) Object.assign(existing, derived); else s.threads.push(derived);
  }
  pending = next;
  return next;
}

/** Claims a landlord message across instances by labeling it before replying. Returns false if already claimed. */
export async function claim(messageId: string): Promise<boolean> {
  const enc = encodeURIComponent(inboxId());
  const cur = await am(`/inboxes/${enc}/messages/${encodeURIComponent(messageId)}`);
  if ((Array.isArray(cur.labels) ? cur.labels.map(String) : []).includes(HANDLED)) return false;
  await am(`/inboxes/${enc}/messages/${encodeURIComponent(messageId)}`, { method: "PATCH", body: JSON.stringify({ add_labels: [HANDLED] }) });
  pending = pending.filter((p) => p.messageId !== messageId);
  return true;
}
