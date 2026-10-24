import { NextResponse } from "next/server";
import { z } from "zod";
import { handleInbound } from "@/lib/tools";
import { ensureEpoch, state } from "@/lib/store";
import { syncThreads } from "@/lib/mailsync";
import { withUser } from "@/lib/session";
export const dynamic = "force-dynamic";

/** DEMO ONLY: simulates the accomplice landlord replying (mock mail mode, or for rehearsal). */
const PRESETS: Record<string, string> = {
  hello: "Hi Nicolás! Yes, it's still available. It's $3,800/mo, fully furnished, 5 min walk to Caltrain. Tell me a bit about yourself?",
  video: "Sure, here's a quick video walkthrough I recorded this morning: https://example.com/demo-tour (DEMO). I'm the leaseholder, happy to show my lease. When can you come see it?",
  slot: "Option 2 works for me, see you then!",
  scam: "Great news, but I'm currently out of the country on a missionary trip. To hold it, please send the deposit and first month ($7,200) via Zelle today and I'll mail you the keys.",
};
const Body = z.object({ preset: z.string().optional(), text: z.string().optional(), threadId: z.string().optional(), resetAt: z.string().optional() });

export const POST = withUser(async (req: Request) => {
  const p = Body.safeParse(await req.json().catch(() => ({})));
  if (!p.success) return NextResponse.json({ error: "bad body" }, { status: 400 });
  ensureEpoch(p.data.resetAt);
  await syncThreads().catch(() => []);
  const s = state();
  const t = s.threads.find((x) => x.id === p.data.threadId) ?? s.threads[s.threads.length - 1];
  if (!t) return NextResponse.json({ error: "no thread yet: approve a contact for the DEMO listing first" }, { status: 400 });
  const text = p.data.text ?? PRESETS[p.data.preset ?? "hello"] ?? PRESETS.hello;
  try {
    return NextResponse.json(await handleInbound({ from: t.landlordEmail, text, messageId: `demo-${Date.now()}`, threadId: t.agentmailThreadId }));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message.slice(0, 300) }, { status: 500 });
  }
});
