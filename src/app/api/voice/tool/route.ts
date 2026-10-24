import { NextResponse } from "next/server";
import { voiceLive } from "@/lib/config";
import { handleTool } from "@/lib/voice";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * ElevenLabs webhook tools (book_viewing, get_free_slots), called mid-call. Auth: ?token=WEBHOOK_TOKEN or the
 * x-voice-token header. Returns { ok, result } for the agent to speak.
 */
export async function POST(req: Request) {
  const url = new URL(req.url);
  const token = process.env.WEBHOOK_TOKEN;
  if ((voiceLive() || (process.env.ELEVENLABS_API_KEY && process.env.VOICE_MODE !== "mock")) && !token) return NextResponse.json({ error: "WEBHOOK_TOKEN not set" }, { status: 403 });
  const got = url.searchParams.get("token") ?? req.headers.get("x-voice-token");
  if (token && got !== token) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const tool = url.searchParams.get("tool");
  try { return NextResponse.json(await handleTool({ ...body, ...(tool && !body.tool ? { tool } : {}) })); }
  catch { return NextResponse.json({ ok: false, result: "I couldn't book it right now. Say the time will be confirmed by email." }); }
}
