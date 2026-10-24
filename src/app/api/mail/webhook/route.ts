import { NextResponse } from "next/server";
import { parseInbound } from "@/lib/mail";
import { handleInbound } from "@/lib/tools";
import { processMail } from "@/lib/inbox";
import { mailLive } from "@/lib/config";
import { asTenant } from "@/lib/session";
import { tenantForThread } from "@/lib/supabase/server";
export const dynamic = "force-dynamic";
/** AgentMail webhook (event message.received). Protect with ?token=WEBHOOK_TOKEN. */
export async function POST(req: Request) {
  const token = process.env.WEBHOOK_TOKEN;
  if (mailLive() && !token) return NextResponse.json({ error: "WEBHOOK_TOKEN not set" }, { status: 403 });
  if (token && new URL(req.url).searchParams.get("token") !== token) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const body = (await req.json().catch(() => ({}))) as { event_type?: string; message?: Record<string, unknown> };
  if (body.event_type !== "message.received" || !body.message) return NextResponse.json({ ignored: true });
  const m = parseInbound(body.message);
  // Shared inbox: the thread index (service role) says which tenant owns this conversation; unknown → global session.
  const owner = await tenantForThread(m.threadId).catch(() => null);
  // Live: same label-claimed path as polling, so webhook + poll never double-reply.
  return NextResponse.json(await asTenant(owner, async () => (mailLive() ? processMail() : handleInbound(m))));
}
