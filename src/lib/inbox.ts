import { bustSync, claim, syncThreads } from "./mailsync";
import { handleInbound } from "./tools";
import { narrate } from "./autopilot";
import { state } from "./store";

/** Pulls threads from AgentMail and answers each unhandled landlord message exactly once (label-claimed). */
export async function processMail() {
  const pending = await syncThreads(true);
  const out: unknown[] = [];
  for (const p of pending) {
    if (!(await claim(p.messageId))) continue;
    out.push(await handleInbound(p));
  }
  if (out.length) { bustSync(); await syncThreads(true); }
  // Catch-up: a reply handled on another instance (webhook) is narrated here, from the AgentMail threads.
  narrate(state());
  return { processed: out.length, out };
}
