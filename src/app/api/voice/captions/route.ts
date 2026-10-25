import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { saveCaption } from "@/lib/captions";
export const dynamic = "force-dynamic";

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** Twilio real-time transcription callback (live call captions). Token-checked; always 200 so Twilio keeps sending. */
export async function POST(req: Request) {
  const token = process.env.WEBHOOK_TOKEN;
  if (!token || !same(new URL(req.url).searchParams.get("token") ?? "", token)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try { await saveCaption(new URLSearchParams(await req.text())); } catch { /* keep 200 */ }
  return NextResponse.json({ ok: true });
}
