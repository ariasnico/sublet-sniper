import { mailLive } from "./config";

const BASE = "https://api.agentmail.to/v0";
export const inboxId = () => process.env.AGENTMAIL_INBOX_ID ?? "";

export async function am(path: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
  const res = await fetch(`${BASE}${path}`, { ...init, headers: { authorization: `Bearer ${process.env.AGENTMAIL_API_KEY ?? ""}`, "content-type": "application/json" }, signal: AbortSignal.timeout(20000) });
  const j: unknown = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`AgentMail ${res.status}`);
  return (j && typeof j === "object" ? j : {}) as Record<string, unknown>;
}

export interface SentMail { mode: "agentmail" | "mock"; messageId: string; threadId: string }

/** Sends from the agent inbox. Mock mode only records it. Callers must enforce the approval/allowlist rule. */
export async function sendMail(to: string, subject: string, text: string, replyToMessageId?: string): Promise<SentMail> {
  if (!mailLive()) return { mode: "mock", messageId: `mock-${Date.now()}`, threadId: `mock-thread-${to}` };
  const enc = encodeURIComponent(inboxId());
  const r = replyToMessageId
    ? await am(`/inboxes/${enc}/messages/${encodeURIComponent(replyToMessageId)}/reply`, { method: "POST", body: JSON.stringify({ text }) })
    : await am(`/inboxes/${enc}/messages/send`, { method: "POST", body: JSON.stringify({ to: [to], subject, text }) });
  return { mode: "agentmail", messageId: String(r.message_id ?? ""), threadId: String(r.thread_id ?? "") };
}

export interface InboundMail { messageId: string; threadId: string; from: string; subject: string; text: string }

export function fromAddress(from: string): string {
  const m = from.match(/<([^>]+)>/);
  return (m ? m[1] : from).trim().toLowerCase();
}

export function parseInbound(m: Record<string, unknown>): InboundMail {
  return { messageId: String(m.message_id ?? ""), threadId: String(m.thread_id ?? ""), from: fromAddress(String(m.from ?? "")),
    subject: String(m.subject ?? ""), text: String(m.extracted_text ?? m.text ?? m.preview ?? "") };
}

/** Polls recent inbound messages (used when no public webhook URL is available, e.g. localhost). */
export async function listInbound(seen: Set<string> = new Set(), limit = 20): Promise<InboundMail[]> {
  if (!mailLive()) return [];
  const enc = encodeURIComponent(inboxId());
  const r = await am(`/inboxes/${enc}/messages?limit=${limit}&labels=received`);
  const msgs = (Array.isArray(r.messages) ? r.messages : []) as Record<string, unknown>[];
  const own = inboxId().toLowerCase();
  const out: InboundMail[] = [];
  for (const m of msgs) {
    const labels = Array.isArray(m.labels) ? m.labels.map(String) : [];
    if (labels.includes("sent") || fromAddress(String(m.from ?? "")) === own || seen.has(String(m.message_id))) continue;
    const full = await am(`/inboxes/${enc}/messages/${encodeURIComponent(String(m.message_id))}`);
    out.push(parseInbound(full));
  }
  return out;
}
