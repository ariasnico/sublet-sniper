/** Supabase is optional: without these env vars the app runs single-tenant (one global in-memory session). */
export const supabaseUrl = () => process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const supabaseAnonKey = () => process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
export const supabaseConfigured = () => process.env.AUTH_MODE !== "off" && !!supabaseUrl() && !!supabaseAnonKey();
