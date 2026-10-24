import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { setTenantHooks } from "../tenant-ctx";
import type { TenantStore } from "../tenant";
import { supabaseAnonKey, supabaseConfigured, supabaseUrl } from "./env";

export { supabaseConfigured };

/** User-scoped server client (route handlers / server components): reads and refreshes the auth cookies. RLS applies. */
export async function serverSupabase(): Promise<SupabaseClient> {
  const jar = await cookies();
  return createServerClient(supabaseUrl(), supabaseAnonKey(), {
    cookies: {
      getAll: () => jar.getAll(),
      setAll: (list) => { try { for (const { name, value, options } of list) jar.set(name, value, options); } catch { /* server component: middleware refreshes */ } },
    },
  });
}

let admin: SupabaseClient | null = null;
/** Service-role client: webhooks only (routing indexes, a tenant's row for an inbound email/call). Bypasses RLS. */
export function adminSupabase(): SupabaseClient {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY not set");
  return (admin ??= createClient(supabaseUrl(), key, { auth: { persistSession: false, autoRefreshToken: false } }));
}

export interface SessionUser { id: string; email: string | null; guest: boolean }
/** Signed-in user from the session cookie (JWT verified by Supabase), or null. */
export async function currentUser(sb?: SupabaseClient): Promise<SessionUser | null> {
  const c = sb ?? (await serverSupabase());
  const { data } = await c.auth.getUser();
  const u = data.user;
  if (!u) return null;
  const email = u.email || null;
  return { id: u.id, email, guest: !!u.is_anonymous || !!email?.endsWith("@guest.sublet-sniper.app") };
}

/** public.sessions as a TenantStore through the given client (user client: RLS; admin client: webhooks). */
export function sessionsStore(sb: SupabaseClient): TenantStore {
  return {
    async load(userId) {
      const { data, error } = await sb.from("sessions").select("state, updated_at").eq("user_id", userId).maybeSingle();
      if (error) throw new Error(`session load: ${error.message}`);
      return data ? { record: data.state, updatedAt: String(data.updated_at) } : null;
    },
    async save(userId, record, updatedAt) {
      const { error } = await sb.from("sessions").upsert({ user_id: userId, state: record, updated_at: updatedAt });
      if (error) throw new Error(`session save: ${error.message}`);
    },
  };
}

/** Which tenant owns an AgentMail thread / a call (service role). */
export async function tenantForThread(agentmailThreadId: string | undefined): Promise<string | null> {
  if (!agentmailThreadId || !supabaseConfigured()) return null;
  const { data } = await adminSupabase().from("thread_index").select("user_id").eq("agentmail_thread_id", agentmailThreadId).maybeSingle();
  return (data?.user_id as string | undefined) ?? null;
}
export async function tenantForCall(...keys: (string | undefined)[]): Promise<string | null> {
  const ks = keys.filter((k): k is string => !!k);
  if (!ks.length || !supabaseConfigured()) return null;
  const { data } = await adminSupabase().from("call_index").select("user_id").in("conversation_id", ks).limit(1);
  return (data?.[0]?.user_id as string | undefined) ?? null;
}

if (supabaseConfigured()) {
  setTenantHooks({
    onThread: async (userId, tid) => { await adminSupabase().from("thread_index").upsert({ agentmail_thread_id: tid, user_id: userId }); },
    onCall: async (userId, keys) => { await adminSupabase().from("call_index").upsert(keys.map((k) => ({ conversation_id: k, user_id: userId }))); },
  });
}
