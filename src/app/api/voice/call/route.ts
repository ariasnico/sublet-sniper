import { NextResponse } from "next/server";
import { z } from "zod";
import { callsEnabled, mailLive, modes } from "@/lib/config";
import { firstContact } from "@/lib/landlord";
import { syncThreads } from "@/lib/mailsync";
import { findListing, hydrate, publicState, state } from "@/lib/store";
import { autoEmailable, sendContact } from "@/lib/tools";
import { signedUrl, startCall } from "@/lib/voice";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Phone the demo landlord about a thread (or a demo listing: emails first so the deal has an AgentMail thread).
 * { threadId | listingId, mode?: "phone" | "browser" }. Only allowlisted numbers; never Craigslist/X landlords.
 * mode "browser" returns a signed URL so the presenter can play the landlord from the laptop mic.
 */
const Body = z.object({ threadId: z.string().optional(), listingId: z.string().optional(), mode: z.enum(["phone", "browser"]).optional(), snapshot: z.unknown().optional() });
export async function POST(req: Request) {
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success || (!p.data.threadId && !p.data.listingId)) return NextResponse.json({ error: "threadId or listingId required" }, { status: 400 });
  const browser = p.data.mode === "browser";
  if (browser ? !(process.env.ELEVENLABS_API_KEY && process.env.ELEVENLABS_AGENT_ID && process.env.VOICE_MODE !== "mock") : !callsEnabled())
    return NextResponse.json({ error: "Voice calls are not configured" }, { status: 409 });
  hydrate(p.data.snapshot);
  const s = state();
  if (mailLive()) await syncThreads().catch(() => []);
  let t = s.threads.find((x) => x.id === p.data.threadId) ?? (p.data.listingId ? s.threads.find((x) => x.listingId === p.data.listingId) : undefined);
  if (!t && p.data.listingId) {
    const l = findListing(p.data.listingId);
    const to = l ? autoEmailable(l) : null;
    if (!l || !to) return NextResponse.json({ error: "Only the demo listing can be called" }, { status: 403 });
    const { subject, text } = firstContact(s.profile, l.title, l.priceMonthly);
    const r = await sendContact(l.id, to, subject, text);
    if ("error" in r) return NextResponse.json({ error: r.error }, { status: 403 });
    t = s.threads.find((x) => x.id === r.threadId);
  }
  if (!t) return NextResponse.json({ error: "unknown thread" }, { status: 404 });
  const r = await startCall(t, browser ? "browser" : "phone");
  if ("error" in r) return NextResponse.json({ error: r.error, state: { ...publicState(), modes: modes() } }, { status: 403 });
  let url: string | undefined;
  if (browser) {
    try { url = await signedUrl(); }
    catch { r.call.status = "failed"; r.call.error = "signed url"; return NextResponse.json({ error: "Couldn't start the browser session" }, { status: 502 }); }
  }
  return NextResponse.json({ ok: true, callId: r.call.id, status: r.call.status, ...(browser ? { signedUrl: url, dynamicVariables: r.vars } : {}), state: { ...publicState(), modes: modes() } });
}
