// Applies supabase/migrations/*.sql to the database in POSTGRES_URL_NON_POOLING (idempotent SQL).
// Usage: node --env-file=.env.local scripts/migrate.mjs
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";

const url = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
if (!url) { console.error("POSTGRES_URL_NON_POOLING not set"); process.exit(1); }
const dir = join(import.meta.dirname, "..", "supabase", "migrations");
// Supabase poolers present a cert chain node doesn't trust by default; the connection is still TLS.
const client = new pg.Client({ connectionString: url.replace(/[?&]sslmode=[^&]*/g, ""), ssl: { rejectUnauthorized: false } });
await client.connect();
for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) {
  await client.query(readFileSync(join(dir, f), "utf8"));
  console.log("applied", f);
}
const { rows } = await client.query(`select tablename, rowsecurity from pg_tables where schemaname = 'public' and tablename in ('sessions','thread_index','call_index') order by 1`);
console.log(rows);
const pol = await client.query(`select policyname, cmd from pg_policies where schemaname = 'public' and tablename = 'sessions' order by 1`);
console.log(pol.rows);
await client.end();
