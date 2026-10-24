import { NextResponse } from "next/server";
import { voiceLive } from "@/lib/config";
import { handleTool } from "@/lib/voice";
import { asTenant } from "@/lib/session";
import { tenantForCall } from "@/lib/supabase/server";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const s = (x: unknown) => (typeof x === "string" && x ? x : undefined);

/**
 * ElevenLabs webhook tools (book_viewing, get_free_slots), called mid-call. Auth: ?token=WEBHOOK_TOKEN or the
 * x-voice-token header. Returns { ok, result } for the agent to speak. Runs as the tenant that placed the call
 * (call index by call id, else the user_id dynamic variable).
 */
export async function POST(req: Request) {
  const url = new URL(req.url);
  const token = process.env.WEBHOOK_TOKEN;
  if ((voiceLive() || (process.env.ELEVENLABS_API_KEY && process.env.VOICE_MODE !== "mock")) && !token) return NextResponse.json({ error: "WEBHOOK_TOKEN not set" }, { status: 403 });
  const got = url.searchParams.get("token") ?? req.headers.get("x-voice-token");
  if (token && got !== token) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const tool = url.searchParams.get("tool");
  const uid = s(body.user_id);
  const owner = (await tenantForCall(s(body.call_id)).catch(() => null)) ?? (uid && UUID.test(uid) ? uid : null);
  try { return NextResponse.json(await asTenant(owner, () => handleTool({ ...body, ...(tool && !body.tool ? { tool } : {}) }))); }
  catch { return NextResponse.json({ ok: false, result: "I couldn't book it right now. Say the time will be confirmed by email." }); }
}
