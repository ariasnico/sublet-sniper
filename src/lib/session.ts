import { NextResponse, after } from "next/server";
import { runAsTenant } from "./tenant";
import { GUEST_NAME, defaultProfile, state } from "./store";
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
    return runAsTenant(user.id, sessionsStore(sb), () => { if (user.guest) anonymize(); return handler(...args); }, { onBackground: (p) => after(p) });
  };
}

/** Guests are anonymous: the renter profile never carries the owner's name (landlords hear a neutral renter name). */
function anonymize() {
  const p = state().profile;
  if (p.name === defaultProfile().name) p.name = GUEST_NAME;
}

/** Webhooks: run as the tenant that owns the email/call (service role), or the global session when unknown. */
export async function asTenant<T>(userId: string | null, fn: () => Promise<T>): Promise<T> {
  if (!userId || !supabaseConfigured()) return fn();
  return runAsTenant(userId, sessionsStore(adminSupabase()), fn, { onBackground: (p) => after(p) });
}
