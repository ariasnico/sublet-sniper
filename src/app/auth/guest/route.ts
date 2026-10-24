import { NextResponse } from "next/server";
import { adminSupabase, serverSupabase } from "@/lib/supabase/server";
export const dynamic = "force-dynamic";

/**
 * "Continue as guest": a Supabase anonymous sign-in (own tenant, no email). If anonymous sign-ins are disabled in the
 * project, falls back to a throwaway confirmed user created with the service role, so the demo never waits on email.
 */
export async function POST() {
  const sb = await serverSupabase();
  const anon = await sb.auth.signInAnonymously();
  if (!anon.error) return NextResponse.json({ ok: true });
  try {
    const email = `guest-${crypto.randomUUID().slice(0, 12)}@guest.sublet-sniper.app`;
    const password = `${crypto.randomUUID()}-${crypto.randomUUID()}`;
    const { error } = await adminSupabase().auth.admin.createUser({ email, password, email_confirm: true, app_metadata: { guest: true } });
    if (error) throw error;
    const r = await sb.auth.signInWithPassword({ email, password });
    if (r.error) throw r.error;
    return NextResponse.json({ ok: true, fallback: true });
  } catch {
    return NextResponse.json({ error: "Guest sign-in is unavailable right now" }, { status: 503 });
  }
}
