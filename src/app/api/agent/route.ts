import { NextResponse } from "next/server";
import { z } from "zod";
import { chat } from "@/lib/agent";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const Body = z.object({ text: z.string().min(1).max(2000) });
export async function POST(req: Request) {
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: "text required" }, { status: 400 });
  return NextResponse.json({ reply: await chat(p.data.text) });
}
