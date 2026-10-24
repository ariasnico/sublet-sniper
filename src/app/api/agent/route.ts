import { NextResponse } from "next/server";
import { z } from "zod";
import { chat } from "@/lib/agent";
import { hydrate, publicState } from "@/lib/store";
import { modes } from "@/lib/config";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const Body = z.object({ text: z.string().min(1).max(2000), snapshot: z.unknown().optional() });
export async function POST(req: Request) {
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: "text required" }, { status: 400 });
  hydrate(p.data.snapshot);
  const reply = await chat(p.data.text);
  return NextResponse.json({ reply, state: { ...publicState(), modes: modes() } });
}
