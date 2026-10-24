import type { Thread } from "./store";
import type { RankedListing } from "./types";

/**
 * Server-side read of a landlord thread, for the MCP server (and any other non-UI caller).
 * Mirrors the deal bar and safety protocol shown in src/app/ui/Inbox.tsx; the UI can import these
 * instead of keeping its own copy (that file is a client component, so server code can't import it).
 */

export const THREAD_STATUS: Record<Thread["status"], string> = { awaiting_landlord: "Waiting on landlord", active: "Negotiating", viewing_proposed: "Slots offered", booked: "Viewing booked", flagged: "Scam refused" };

export type CheckState = "ok" | "wait" | "blocked";
export interface SafetyCheck { check: string; state: CheckState }

export function safetyChecks(t: Thread, l?: RankedListing): SafetyCheck[] {
  const landlord = t.messages.filter((m) => m.from === "landlord").map((m) => m.text).join("\n");
  const flagged = t.messages.some((m) => m.flagged);
  return [
    { check: l ? `Scam score ${l.scam.score}` : "Scam score checked", state: !l || l.scam.light === "green" ? "ok" : "blocked" },
    { check: "Live video tour", state: /video (tour|walkthrough|call)|facetime|zoom/i.test(landlord) ? "ok" : "wait" },
    { check: "Leaseholder confirmed", state: /\b(i(?:'m| am) the (owner|leaseholder|tenant on the lease)|my name is on the lease|landlord (approved|approval|is ok)|sublease (addendum|agreement))\b/i.test(landlord) ? "ok" : "wait" },
    { check: flagged ? "Money request refused" : "No money before viewing", state: flagged ? "blocked" : "ok" },
    { check: "Viewing booked", state: t.status === "booked" ? "ok" : "wait" },
  ];
}

const money = (t: string) => [...t.replace(/,/g, "").matchAll(/\$\s?(\d{3,5})(?!\d)/g)].map((m) => Number(m[1]));

/** Price negotiation read from the thread itself: listed price, the landlord's ask, the agent's counter. */
export function negotiation(t: Thread, l?: RankedListing): { listed: number | null; asked: number; offered: number | null } | null {
  let asked: number | null = null, offered: number | null = null;
  for (const m of t.messages) {
    if (m.from === "landlord" && !m.flagged) { const a = money(m.text).filter((x) => x >= 500 && x < 20000); if (a.length) { asked = a[0]; offered = null; } }
    if (m.from === "agent" && asked) {
      const o = m.text.replace(/,/g, "").match(/would you do \$(\d{3,5})|(?:offer|counter)[^$]{0,20}\$(\d{3,5})/i);
      const below = money(m.text).filter((x) => x < asked! && x >= 500);
      if (o) offered = Number(o[1] ?? o[2]); else if (below.length) offered = Math.min(...below);
    }
  }
  if (!asked) return null;
  return { listed: l?.priceMonthly ?? null, asked, offered };
}

const stamp = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const NOTE = "Booked by Sublet Sniper. Pay nothing before you see the place in person.";

/** "Add to Google Calendar" template link for a booked viewing (works without OAuth). */
export function gcalTemplateLink(e: { title: string; start: string; end?: string }): string {
  const end = e.end ?? new Date(Date.parse(e.start) + 45 * 60e3).toISOString();
  const q = new URLSearchParams({ action: "TEMPLATE", text: e.title.replace(/\[DEMO DATA\]\s*/, ""), dates: `${stamp(e.start)}/${stamp(end)}`, details: NOTE, ctz: "America/Los_Angeles" });
  return `https://calendar.google.com/calendar/render?${q}`;
}
