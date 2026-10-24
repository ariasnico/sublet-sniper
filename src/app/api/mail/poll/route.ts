import { NextResponse } from "next/server";
import { listInbound } from "@/lib/mail";
import { handleInbound } from "@/lib/tools";
import { state } from "@/lib/store";
export const dynamic = "force-dynamic";
/** Pull new landlord replies from AgentMail (for localhost demos without a public webhook). */
export async function POST() {
  const seen = new Set(state().seenMessageIds);
  const msgs = (await listInbound(seen).catch(() => [])).filter((m) => !seen.has(m.messageId)).reverse();
  const out = [];
  for (const m of msgs) out.push(await handleInbound(m));
  return NextResponse.json({ processed: out.length, out });
}
