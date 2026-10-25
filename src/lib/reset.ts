/** True when a session copy has chat or timeline entries older than the given Reset time. */
export function predatesReset(x: { chat?: { at: string }[]; timeline?: { at: string }[] }, resetAt: unknown): boolean {
  if (typeof resetAt !== "string" || !resetAt) return false;
  return (x.chat ?? []).some((c) => c.at < resetAt) || (x.timeline ?? []).some((t) => t.at < resetAt);
}
