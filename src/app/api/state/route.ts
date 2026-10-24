import { NextResponse } from "next/server";
import { state } from "@/lib/store";
import { modes } from "@/lib/config";
export const dynamic = "force-dynamic";
export async function GET() {
  const s = state();
  return NextResponse.json({ ...s, seenMessageIds: undefined, modes: modes() });
}
