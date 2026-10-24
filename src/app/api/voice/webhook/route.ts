import { NextResponse } from "next/server";
import { voiceLive } from "@/lib/config";
import { handleWebhook, verifySignature } from "@/lib/voice";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * ElevenLabs post-call webhook (post_call_transcription, call_initiation_failure). HMAC-verified with
 * ELEVENLABS_WEBHOOK_SECRET (ElevenLabs-Signature: t=..,v0=..). Without a secret it only accepts events in mock mode.
 */
export async function POST(req: Request) {
  const raw = await req.text();
  const secret = process.env.ELEVENLABS_WEBHOOK_SECRET;
  if (secret) { if (!verifySignature(raw, req.headers.get("elevenlabs-signature"), secret)) return NextResponse.json({ error: "invalid signature" }, { status: 401 }); }
  else if (voiceLive() || (process.env.ELEVENLABS_API_KEY && process.env.VOICE_MODE !== "mock")) return NextResponse.json({ error: "ELEVENLABS_WEBHOOK_SECRET not set" }, { status: 403 });
  let body: { type?: string; data?: Record<string, unknown> };
  try { body = JSON.parse(raw) as typeof body; } catch { return NextResponse.json({ error: "bad json" }, { status: 400 }); }
  // Always 200 once verified, so ElevenLabs never auto-disables the webhook.
  try { return NextResponse.json(await handleWebhook(body)); }
  catch { return NextResponse.json({ ok: false }); }
}
