import { NextResponse } from "next/server";
import { ensureEpoch, publicState } from "@/lib/store";
import { modes } from "@/lib/config";
import { syncThreads } from "@/lib/mailsync";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  ensureEpoch(new URL(req.url).searchParams.get("resetAt"));
  await syncThreads().catch(() => []); // threads live in AgentMail; cached 10s per instance
  return NextResponse.json({ ...publicState(), modes: modes() });
}
