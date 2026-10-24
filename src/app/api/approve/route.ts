import { NextResponse } from "next/server";
import { z } from "zod";
import { resolveApproval } from "@/lib/tools";
import { hydrate, publicState } from "@/lib/store";
import { modes } from "@/lib/config";
export const dynamic = "force-dynamic";
const Body = z.object({ id: z.string(), approve: z.boolean(), answer: z.string().optional(),
  approval: z.object({ id: z.string(), at: z.string(), kind: z.enum(["send_contact", "open_craigslist_reply", "book_viewing", "decision", "autopilot_consent"]), listingId: z.string().optional(), title: z.string(), body: z.string(), options: z.array(z.string()).optional(), payload: z.record(z.string(), z.unknown()).optional(), status: z.string() }).optional(), snapshot: z.unknown().optional() });
export async function POST(req: Request) {
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: "bad body" }, { status: 400 });
  hydrate(p.data.snapshot);
  const r = await resolveApproval(p.data.id, p.data.approve, p.data.answer, p.data.approval ? { ...p.data.approval, status: "pending" } : undefined);
  return NextResponse.json({ ...r, state: { ...publicState(), modes: modes() } });
}
