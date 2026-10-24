// RLS smoke test against the real Supabase project: two throwaway users, each writes its own session row,
// then A tries to read / update / delete / insert B's row. Exits 1 if any cross-tenant access works.
// Usage: node --env-file=.env.local scripts/rls-smoke.mjs   (never prints keys)
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
if (!url || !anon || !service) { console.error("Supabase env missing"); process.exit(1); }
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(url, service, opts);

const tag = Math.random().toString(36).slice(2, 8);
const mk = async (who) => {
  const email = `rls-smoke-${who}-${tag}@example.com`, password = `Pw-${crypto.randomUUID()}`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  const c = createClient(url, anon, opts);
  const s = await c.auth.signInWithPassword({ email, password });
  if (s.error) throw s.error;
  return { id: data.user.id, c };
};

const results = [];
const check = (name, ok, detail = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`); };
let A, B;
try {
  A = await mk("a"); B = await mk("b");
  const wa = await A.c.from("sessions").upsert({ user_id: A.id, state: { secret: "A" } }).select();
  check("A writes own row", !wa.error && wa.data?.length === 1, wa.error?.message);
  const wb = await B.c.from("sessions").upsert({ user_id: B.id, state: { secret: "B" } }).select();
  check("B writes own row", !wb.error && wb.data?.length === 1, wb.error?.message);

  const ra = await A.c.from("sessions").select("user_id,state");
  check("A sees only its own row", !ra.error && ra.data.length === 1 && ra.data[0].user_id === A.id, `rows=${ra.data?.length}`);
  const rb = await A.c.from("sessions").select("state").eq("user_id", B.id);
  check("A cannot read B's row", !rb.error && rb.data.length === 0, `rows=${rb.data?.length}`);
  const ub = await A.c.from("sessions").update({ state: { secret: "pwned" } }).eq("user_id", B.id).select();
  check("A cannot update B's row", !ub.error && ub.data.length === 0, `rows=${ub.data?.length}`);
  const db = await A.c.from("sessions").delete().eq("user_id", B.id).select();
  check("A cannot delete B's row", !db.error && db.data.length === 0, `rows=${db.data?.length}`);
  const ib = await A.c.from("sessions").upsert({ user_id: B.id, state: { secret: "pwned" } });
  check("A cannot write a row as B", !!ib.error, ib.error?.code);
  const anonC = createClient(url, anon, opts);
  const ra2 = await anonC.from("sessions").select("user_id");
  check("Signed-out client reads nothing", !!ra2.error || ra2.data.length === 0, ra2.error?.code ?? `rows=${ra2.data?.length}`);
  const ti = await A.c.from("thread_index").select("*");
  check("thread_index not readable by users", !!ti.error || ti.data.length === 0, ti.error?.code ?? `rows=${ti.data?.length}`);
  const still = await admin.from("sessions").select("state").eq("user_id", B.id).single();
  check("B's row intact", still.data?.state?.secret === "B");
} catch (e) {
  check("setup", false, e instanceof Error ? e.message : String(e));
} finally {
  for (const u of [A, B]) if (u) await admin.auth.admin.deleteUser(u.id).catch(() => {});
}
const ok = results.every(Boolean);
console.log(ok ? `RLS smoke: ALL ${results.length} PASS` : "RLS smoke: FAILED");
process.exit(ok ? 0 : 1);
