import { tenantAls, type TenantCtx } from "./tenant-ctx";
import { defaultProfile, fresh, type State } from "./store";
import { sanitizeAutopilot } from "./autopilot";

/**
 * Multi-tenant state. Every signed-in user has one row (public.sessions, RLS: own row only) holding the whole
 * State as jsonb. A request runs inside `runAsTenant`: it loads the row, `state()` returns that tenant's State for
 * the whole async call tree (AsyncLocalStorage), and the row is saved back when the handler (and any background
 * work it started) is done. The DB is the source of truth; a per-instance cache keeps the same object for
 * concurrent requests of one user (e.g. the mock call simulator and the UI poll) as long as no other instance wrote.
 */

export interface SessionRecord { v: 1; bornAt: string; state: Partial<State> }
export interface TenantStore {
  load(userId: string): Promise<{ record: unknown; updatedAt: string } | null>;
  save(userId: string, record: SessionRecord, updatedAt: string): Promise<void>;
}

interface Cached { state: State; bornAt: string; savedAt: number; json: string }
const g = globalThis as unknown as { __sniperTenantCache?: Map<string, Cached>; __sniperSaveQ?: Map<string, Promise<void>> };
const cache = (g.__sniperTenantCache ??= new Map());
const saveQ = (g.__sniperSaveQ ??= new Map());

/** Drops the per-instance cache (tests). */
export function clearTenantCache() { cache.clear(); saveQ.clear(); }

/** Bounded copy for jsonb (same caps as hydrate). */
export function capState(s: State): Partial<State> {
  return {
    ...s,
    timeline: s.timeline.slice(0, 200), approvals: s.approvals.slice(0, 50), chat: s.chat.slice(-60), calls: s.calls.slice(-10),
    threads: s.threads.slice(0, 20), results: s.results.slice(0, 60), flagged: s.flagged.slice(0, 40), events: s.events.slice(0, 30),
    seenMessageIds: s.seenMessageIds.slice(-500),
  };
}

/** State from a stored record, tolerant of missing/old fields. */
export function restoreState(raw: unknown): { state: State; bornAt: string } {
  const base = fresh();
  const rec = (raw && typeof raw === "object" ? raw : {}) as Partial<SessionRecord>;
  const x = (rec.state && typeof rec.state === "object" ? rec.state : {}) as Record<string, unknown>;
  const out = base as unknown as Record<string, unknown>;
  for (const k of Object.keys(base)) {
    const v = x[k], d = out[k];
    if (Array.isArray(d)) { if (Array.isArray(v)) out[k] = v; }
    else if (k === "criteria" || k === "searchReport") { if (v && typeof v === "object") out[k] = v; }
    else if (v !== undefined && v !== null && typeof v === typeof d) out[k] = v;
  }
  if (typeof x.analyzedId === "string") base.analyzedId = x.analyzedId;
  base.profile = { ...defaultProfile(), ...(x.profile && typeof x.profile === "object" ? x.profile : {}) };
  base.autopilot = sanitizeAutopilot(x.autopilot) ?? base.autopilot;
  return { state: base, bornAt: typeof rec.bornAt === "string" ? rec.bornAt : "" };
}

async function open(userId: string, store: TenantStore): Promise<TenantCtx> {
  const row = await store.load(userId);
  const hit = cache.get(userId);
  const fromDb = row ? Date.parse(row.updatedAt) : 0;
  let st: State, bornAt: string;
  if (hit && hit.savedAt >= fromDb) ({ state: st, bornAt } = hit);
  else {
    ({ state: st, bornAt } = restoreState(row?.record));
    cache.set(userId, { state: st, bornAt, savedAt: fromDb, json: "" });
  }
  const ctx: TenantCtx = { userId, state: st, bornAt, background: [], persist: () => save(ctx, store) };
  return ctx;
}

/** Saves a tenant (serialized per user so an older write never lands after a newer one; skipped when unchanged). */
function save(ctx: TenantCtx, store: TenantStore): Promise<void> {
  const prev = saveQ.get(ctx.userId) ?? Promise.resolve();
  const next = prev.catch(() => {}).then(async () => {
    const record: SessionRecord = { v: 1, bornAt: ctx.bornAt, state: capState(ctx.state) };
    const json = JSON.stringify(record);
    const hit = cache.get(ctx.userId);
    if (hit && hit.state === ctx.state && hit.json === json) return;
    const at = new Date();
    await store.save(ctx.userId, JSON.parse(json) as SessionRecord, at.toISOString());
    cache.set(ctx.userId, { state: ctx.state, bornAt: ctx.bornAt, savedAt: at.getTime(), json });
  });
  saveQ.set(ctx.userId, next);
  return next;
}

/** Waits for the request's background work (it may start more), then saves again. */
async function settle(ctx: TenantCtx) {
  while (ctx.background.length) {
    const batch = ctx.background.splice(0);
    await Promise.allSettled(batch);
    await ctx.persist().catch(() => {});
  }
}

export interface RunOpts {
  /** Receives the "background work settled + saved" promise (routes pass it to next/server `after`). */
  onBackground?: (p: Promise<void>) => void;
}

/** Runs `fn` as `userId`: `state()` is that tenant's State; the row is saved afterwards. */
export async function runAsTenant<T>(userId: string, store: TenantStore, fn: () => Promise<T> | T, opts: RunOpts = {}): Promise<T> {
  const ctx = await open(userId, store);
  try {
    return await tenantAls.run(ctx, fn);
  } finally {
    await ctx.persist().catch((e: unknown) => console.error("session save failed", e instanceof Error ? e.message : e));
    if (ctx.background.length) {
      const p = settle(ctx);
      if (opts.onBackground) opts.onBackground(p); else void p;
    }
  }
}

/** In-memory TenantStore (tests, local dev without Supabase). */
export function memoryStore(): TenantStore & { rows: Map<string, { record: unknown; updatedAt: string }> } {
  const rows = new Map<string, { record: unknown; updatedAt: string }>();
  return {
    rows,
    async load(userId) { const r = rows.get(userId); return r ? { record: structuredClone(r.record), updatedAt: r.updatedAt } : null; },
    async save(userId, record, updatedAt) { rows.set(userId, { record: structuredClone(record), updatedAt }); },
  };
}
