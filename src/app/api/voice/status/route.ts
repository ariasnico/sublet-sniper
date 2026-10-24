import { NextResponse } from "next/server";
import { z } from "zod";
import { modes } from "@/lib/config";
import { hydrate, publicState, state } from "@/lib/store";
import { pollCalls } from "@/lib/voice";
import { indexCall } from "@/lib/tenant-ctx";
import { withUser } from "@/lib/session";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** UI poll while a call is live: reads it from ElevenLabs (works on any instance). { callId, conversationId } registers a browser session. */
const Body = z.object({ callId: z.string().optional(), conversationId: z.string().optional(), snapshot: z.unknown().optional() });
export const POST = withUser(async (req: Request) => {
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: "bad body" }, { status: 400 });
  hydrate(p.data.snapshot);
  const call = p.data.callId ? state().calls.find((c) => c.id === p.data.callId) : undefined;
  if (call && p.data.conversationId && !call.conversationId) { call.conversationId = p.data.conversationId; indexCall(call.conversationId); }
  await pollCalls();
  return NextResponse.json({ ok: true, state: { ...publicState(), modes: modes() } });
});
