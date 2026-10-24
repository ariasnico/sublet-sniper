import { NextResponse } from "next/server";
import { serverSupabase, supabaseConfigured } from "@/lib/supabase/server";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (supabaseConfigured()) await (await serverSupabase()).auth.signOut();
  return NextResponse.redirect(new URL("/login", req.url), { status: 303 });
}
