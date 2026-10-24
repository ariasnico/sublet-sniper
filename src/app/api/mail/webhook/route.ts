import { NextResponse } from "next/server";
import { parseInbound } from "@/lib/mail";
import { handleInbound } from "@/lib/tools";
export const dynamic = "force-dynamic";
/** AgentMail webhook (event message.received). Protect with ?token=WEBHOOK_TOKEN. */
export async function POST(req: Request) {
  const token = process.env.WEBHOOK_TOKEN;
  if (token && new URL(req.url).searchParams.get("token") !== token) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const body = (await req.json().catch(() => ({}))) as { event_type?: string; message?: Record<string, unknown> };
  if (body.event_type !== "message.received" || !body.message) return NextResponse.json({ ignored: true });
  const m = parseInbound(body.message);
  return NextResponse.json(await handleInbound(m));
}
