import { NextResponse } from "next/server";
import { voiceLive } from "@/lib/config";
import { handleWebhook, verifySignature } from "@/lib/voice";
import { asTenant } from "@/lib/session";
import { tenantForCall } from "@/lib/supabase/server";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const s = (x: unknown) => (typeof x === "string" && x ? x : undefined);

/**
 * ElevenLabs post-call webhook (post_call_transcription, call_initiation_failure). HMAC-verified with
 * ELEVENLABS_WEBHOOK_SECRET (ElevenLabs-Signature: t=..,v0=..). Without a secret it only accepts events in mock mode.
 * Multi-tenant: routed to the user that placed the call (call index by conversation/call id, else user_id variable).
 */
export async function POST(req: Request) {
  const raw = await req.text();
  const secret = process.env.ELEVENLABS_WEBHOOK_SECRET;
  if (secret) { if (!verifySignature(raw, req.headers.get("elevenlabs-signature"), secret)) return NextResponse.json({ error: "invalid signature" }, { status: 401 }); }
  else if (voiceLive() || (process.env.ELEVENLABS_API_KEY && process.env.VOICE_MODE !== "mock")) return NextResponse.json({ error: "ELEVENLABS_WEBHOOK_SECRET not set" }, { status: 403 });
  let body: { type?: string; data?: Record<string, unknown> };
  try { body = JSON.parse(raw) as typeof body; } catch { return NextResponse.json({ error: "bad json" }, { status: 400 }); }
  const data = (body.data ?? {}) as { conversation_id?: unknown; conversation_initiation_client_data?: { dynamic_variables?: Record<string, unknown> } };
  const dv = data.conversation_initiation_client_data?.dynamic_variables ?? {};
  const uid = s(dv.user_id);
  const owner = (await tenantForCall(s(data.conversation_id), s(dv.call_id)).catch(() => null)) ?? (uid && UUID.test(uid) ? uid : null);
  // Always 200 once verified, so ElevenLabs never auto-disables the webhook.
  try { return NextResponse.json(await asTenant(owner, () => handleWebhook(body))); }
  catch { return NextResponse.json({ ok: false }); }
}
