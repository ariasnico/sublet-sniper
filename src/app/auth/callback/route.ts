import { NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { serverSupabase } from "@/lib/supabase/server";
export const dynamic = "force-dynamic";

/** Magic link landing: PKCE ?code=… (default email template) or ?token_hash=…&type=… (custom template). */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const next = url.searchParams.get("next");
  const dest = next && next.startsWith("/") && !next.startsWith("//") ? next : "/app";
  const sb = await serverSupabase();
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const { error } = code ? await sb.auth.exchangeCodeForSession(code)
    : tokenHash && type ? await sb.auth.verifyOtp({ token_hash: tokenHash, type })
    : { error: new Error("missing code") };
  if (error) return NextResponse.redirect(new URL("/login?error=link", url.origin));
  return NextResponse.redirect(new URL(dest, url.origin));
}
