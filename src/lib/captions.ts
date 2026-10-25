import type { ElTurn } from "./voice";
import { adminSupabase } from "./supabase/server";

/**
 * LIVE CAPTIONS: ElevenLabs only exposes a call's transcript after it ends, so while the phone call is live
 * Twilio (the line ElevenLabs dials through) transcribes both sides in parallel. The call itself is untouched:
 * Twilio forks the audio. Final utterances land in public.call_live (service role) and feed the call stage.
 */
const SID = () => process.env.TWILIO_ACCOUNT_SID ?? "";
const TOKEN = () => process.env.TWILIO_AUTH_TOKEN ?? "";
export const captionsConfigured = () => /^AC[0-9a-f]{32}$/.test(SID()) && !!TOKEN() && !!process.env.WEBHOOK_TOKEN && /^https:\/\//.test(process.env.APP_URL ?? "");

/** Starts Twilio real-time transcription on an in-progress call. False while it is still ringing (retry on the next poll). */
export async function startCaptions(callSid: string): Promise<boolean> {
  if (!captionsConfigured() || !/^CA[0-9a-f]{32}$/.test(callSid)) return false;
  const cb = `${process.env.APP_URL!.replace(/\/+$/, "")}/api/voice/captions?token=${encodeURIComponent(process.env.WEBHOOK_TOKEN!)}`;
  const body = new URLSearchParams({ Name: "sniper-captions", Track: "both_tracks", LanguageCode: "en-US", PartialResults: "false", StatusCallbackUrl: cb, StatusCallbackMethod: "POST" });
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${SID()}/Calls/${callSid}/Transcriptions.json`, {
    method: "POST", body,
    headers: { Authorization: `Basic ${Buffer.from(`${SID()}:${TOKEN()}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" },
  });
  return r.ok;
}

/** Twilio status callback (form fields) -> one row per final utterance. */
export async function saveCaption(f: URLSearchParams): Promise<boolean> {
  if (f.get("TranscriptionEvent") !== "transcription-content" || f.get("Final") === "false") return false;
  const callSid = f.get("CallSid") ?? "";
  let text = "";
  try { text = String((JSON.parse(f.get("TranscriptionData") ?? "{}") as { transcript?: unknown }).transcript ?? "").trim(); } catch { /* not JSON */ }
  if (!callSid || !text) return false;
  const { error } = await adminSupabase().from("call_live").upsert({
    call_sid: callSid, seq: Number(f.get("SequenceId") ?? Date.now()), track: f.get("Track") ?? "inbound_track", text,
    at: f.get("Timestamp") || new Date().toISOString(),
  });
  return !error;
}

/** The call so far as ElevenLabs-shaped turns. On an outbound call the inbound track is the landlord, the outbound track is the agent. */
export async function readCaptions(callSid: string, startedAt: string): Promise<ElTurn[]> {
  if (!captionsConfigured()) return [];
  const { data } = await adminSupabase().from("call_live").select("track,text,at").eq("call_sid", callSid).order("at").limit(200);
  const t0 = Date.parse(startedAt) || Date.now();
  return (data ?? []).map((r: { track: string; text: string; at: string }) => ({
    role: r.track === "inbound_track" ? "user" : "agent", message: r.text, time_in_call_secs: Math.max(0, (Date.parse(r.at) - t0) / 1000),
  }));
}
