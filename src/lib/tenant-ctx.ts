import { AsyncLocalStorage } from "node:async_hooks";
import type { State } from "./store";

/** Per-request tenant: whose State `state()` returns. Absent (tests, MCP demo tenant) → the global in-memory state. */
export interface TenantCtx {
  userId: string;
  state: State;
  /** Time of the tenant's last Reset (epoch): mail threads older than it are not part of the session. */
  bornAt: string;
  /** Background work started during the request (mock call simulator); the state is saved again when it settles. */
  background: Promise<unknown>[];
  /** Saves the tenant's state now (long-running background work calls it between steps). */
  persist: () => Promise<void>;
}

const g = globalThis as unknown as { __sniperTenantAls?: AsyncLocalStorage<TenantCtx>; __sniperTenantHooks?: TenantHooks };
export const tenantAls = (g.__sniperTenantAls ??= new AsyncLocalStorage<TenantCtx>());
export const currentTenant = (): TenantCtx | undefined => tenantAls.getStore();
/** Short public tag for a tenant (mail subjects): first 8 hex chars of the user id. */
export const shortId = (userId: string) => userId.replace(/-/g, "").slice(0, 8).toLowerCase();
/** "#1a2b3c4d" at the end of a subject: which tenant a shared-inbox thread belongs to. */
export const TENANT_TAG = /\s*#([0-9a-f]{8})\b/;
export const tenantTagOf = (subject: string): string | null => subject.match(TENANT_TAG)?.[1] ?? null;
/** Adds the current tenant's tag to an outgoing subject (no tenant → unchanged). */
export function tagSubject(subject: string): string {
  const t = currentTenant();
  if (!t || tenantTagOf(subject)) return subject;
  return `${subject} #${shortId(t.userId)}`;
}
/** Does this AgentMail subject belong to the current tenant? Untagged threads belong to the global (no-tenant) session. */
export function ownsSubject(subject: string): boolean {
  const t = currentTenant(), tag = tenantTagOf(subject);
  return t ? tag === shortId(t.userId) : !tag;
}

/** Routing indexes for webhooks (registered by the Supabase layer; no-ops in tests). */
export interface TenantHooks {
  onThread?: (userId: string, agentmailThreadId: string) => Promise<void>;
  onCall?: (userId: string, keys: string[]) => Promise<void>;
}
export const tenantHooks = (): TenantHooks => g.__sniperTenantHooks ?? {};
export function setTenantHooks(h: TenantHooks) { g.__sniperTenantHooks = h; }

/** Records that the current tenant owns an AgentMail thread (so the mail webhook can route replies). */
export function indexThread(agentmailThreadId: string | undefined) {
  const t = currentTenant(), h = tenantHooks().onThread;
  if (!t || !h || !agentmailThreadId || agentmailThreadId.startsWith("mock-")) return;
  void h(t.userId, agentmailThreadId).catch(() => {});
}
/** Records that the current tenant owns a call (call id / ElevenLabs conversation id), for the voice webhooks. */
export function indexCall(...keys: (string | undefined)[]) {
  const t = currentTenant(), h = tenantHooks().onCall;
  const ks = keys.filter((k): k is string => !!k);
  if (!t || !h || !ks.length) return;
  void h(t.userId, ks).catch(() => {});
}
/** Keeps background work tied to the request's tenant (saved when it settles). Without a tenant: fire and forget. */
export function inBackground(p: Promise<unknown>) {
  currentTenant()?.background.push(p.catch(() => {}));
}
