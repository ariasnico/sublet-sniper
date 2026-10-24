import { NextResponse } from "next/server";
import { processMail } from "@/lib/inbox";
import { hydrate, publicState } from "@/lib/store";
import { modes } from "@/lib/config";
import { withUser } from "@/lib/session";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
/** "Check mail" and the 15s UI poll: rebuild threads from AgentMail and answer new landlord replies. */
export const POST = withUser(async (req: Request) => {
  hydrate(((await req.json().catch(() => ({}))) as { snapshot?: unknown }).snapshot);
  try { const r = await processMail(); return NextResponse.json({ ...r, state: { ...publicState(), modes: modes() } }); }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : "mail error" }, { status: 502 }); }
});
