import { NextResponse, after } from "next/server";
import { z } from "zod";
import { chat } from "@/lib/agent";
import { hydrate, publicState, state } from "@/lib/store";
import { PREFETCH_TOP, attachPhotos, photosInFlight } from "@/lib/photos";
import { modes } from "@/lib/config";
import { withUser } from "@/lib/session";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const Body = z.object({ text: z.string().min(1).max(2000), snapshot: z.unknown().optional() });
export const POST = withUser(async (req: Request) => {
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: "text required" }, { status: 400 });
  hydrate(p.data.snapshot);
  const reply = await chat(p.data.text);
  // Photos prefetched by a search usually finish while the LLM writes its reply; ship them inline.
  await attachPhotos(state().results.slice(0, PREFETCH_TOP), 1500);
  after(photosInFlight);
  return NextResponse.json({ reply, state: { ...publicState(), modes: modes() } });
});
