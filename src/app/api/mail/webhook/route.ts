import { NextResponse } from "next/server";
import { parseInbound } from "@/lib/mail";
import { handleInbound } from "@/lib/tools";
import { processMail } from "@/lib/inbox";
import { mailLive } from "@/lib/config";
export const dynamic = "force-dynamic";
/** AgentMail webhook (event message.received). Protect with ?token=WEBHOOK_TOKEN. */
export async function POST(req: Request) {
  const token = process.env.WEBHOOK_TOKEN;
  if (mailLive() && !token) return NextResponse.json({ error: "WEBHOOK_TOKEN not set" }, { status: 403 });
  if (token && new URL(req.url).searchParams.get("token") !== token) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const body = (await req.json().catch(() => ({}))) as { event_type?: string; message?: Record<string, unknown> };
  if (body.event_type !== "message.received" || !body.message) return NextResponse.json({ ignored: true });
  // Live: same label-claimed path as polling, so webhook + poll never double-reply.
  if (mailLive()) return NextResponse.json(await processMail());
  const m = parseInbound(body.message);
  return NextResponse.json(await handleInbound(m));
}
