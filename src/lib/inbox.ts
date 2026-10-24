import { claim, syncThreads } from "./mailsync";
import { handleInbound } from "./tools";

/** Pulls threads from AgentMail and answers each unhandled landlord message exactly once (label-claimed). */
export async function processMail() {
  const pending = await syncThreads(true);
  const out: unknown[] = [];
  for (const p of pending) {
    if (!(await claim(p.messageId))) continue;
    out.push(await handleInbound(p));
  }
  if (out.length) await syncThreads(true);
  return { processed: out.length, out };
}
