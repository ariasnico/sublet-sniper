import { NextResponse } from "next/server";
import { state } from "@/lib/store";
import { modes } from "@/lib/config";
import { syncThreads } from "@/lib/mailsync";
export const dynamic = "force-dynamic";
export async function GET() {
  await syncThreads().catch(() => []); // threads live in AgentMail; cached 10s per instance
  const s = state();
  return NextResponse.json({ ...s, seenMessageIds: undefined, modes: modes() });
}
