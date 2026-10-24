import { NextResponse } from "next/server";
import { z } from "zod";
import { resolveApproval } from "@/lib/tools";
export const dynamic = "force-dynamic";
const Body = z.object({ id: z.string(), approve: z.boolean(), answer: z.string().optional() });
export async function POST(req: Request) {
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: "bad body" }, { status: 400 });
  return NextResponse.json(await resolveApproval(p.data.id, p.data.approve, p.data.answer));
}
