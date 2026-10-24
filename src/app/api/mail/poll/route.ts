import { NextResponse } from "next/server";
import { processMail } from "@/lib/inbox";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
/** "Check mail" and the 15s UI poll: rebuild threads from AgentMail and answer new landlord replies. */
export async function POST() {
  try { return NextResponse.json(await processMail()); }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : "mail error" }, { status: 502 }); }
}
