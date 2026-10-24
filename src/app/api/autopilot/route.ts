import { NextResponse } from "next/server";
import { z } from "zod";
import { setAutopilot, takeCraigslistDrafts } from "@/lib/tools";
import { hydrate, publicState } from "@/lib/store";
import { modes } from "@/lib/config";
import { withUser } from "@/lib/session";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Autopilot switch + the one human step.
 * { on: true|false }                 consent / off switch (on starts outreach on the current results right away)
 * { action: "take_craigslist_drafts" } returns every pending Craigslist draft { url, message } for the human to send via Reply
 */
const Body = z.object({ on: z.boolean().optional(), action: z.enum(["take_craigslist_drafts"]).optional(), snapshot: z.unknown().optional() });
export const POST = withUser(async (req: Request) => {
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: "bad body" }, { status: 400 });
  hydrate(p.data.snapshot);
  const out: Record<string, unknown> = {};
  if (p.data.on !== undefined) Object.assign(out, await setAutopilot(p.data.on));
  if (p.data.action === "take_craigslist_drafts") out.drafts = takeCraigslistDrafts();
  const state = { ...publicState(), modes: modes() };
  return NextResponse.json({ ...out, autopilot: state.autopilot, state });
});
