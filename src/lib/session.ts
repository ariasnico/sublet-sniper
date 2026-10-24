import { NextResponse, after } from "next/server";
import { runAsTenant } from "./tenant";
import { adminSupabase, currentUser, serverSupabase, sessionsStore, supabaseConfigured } from "./supabase/server";

/**
 * API route wrapper: resolves the signed-in user from the Supabase cookie, loads their session row (user-scoped
 * client, so RLS applies), runs the handler as that tenant and saves the row. No Supabase configured → the old
 * single-tenant behavior (global in-memory state).
 */
export function withUser<A extends unknown[]>(handler: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    if (!supabaseConfigured()) return handler(...args);
    const sb = await serverSupabase();
    const user = await currentUser(sb);
    if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
    return runAsTenant(user.id, sessionsStore(sb), () => handler(...args), { onBackground: (p) => after(p) });
  };
}

/** Webhooks: run as the tenant that owns the email/call (service role), or the global session when unknown. */
export async function asTenant<T>(userId: string | null, fn: () => Promise<T>): Promise<T> {
  if (!userId || !supabaseConfigured()) return fn();
  return runAsTenant(userId, sessionsStore(adminSupabase()), fn, { onBackground: (p) => after(p) });
}
