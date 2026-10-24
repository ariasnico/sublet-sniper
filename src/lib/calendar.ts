import { calendarLive } from "./config";
import { laDay, laInstant } from "./time";

export interface Slot { start: string; end: string }
export interface Booked { mode: "google" | "mock"; id: string; link?: string }

async function token(): Promise<string> {
  const res = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID ?? "", client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "", refresh_token: process.env.GOOGLE_REFRESH_TOKEN ?? "", grant_type: "refresh_token" }) });
  const j = (await res.json()) as { access_token?: string };
  if (!j.access_token) throw new Error("Google token refresh failed");
  return j.access_token;
}
const calId = () => encodeURIComponent(process.env.GOOGLE_CALENDAR_ID || "primary");

async function busy(timeMin: string, timeMax: string): Promise<Slot[]> {
  if (!calendarLive()) return [];
  const res = await fetch("https://www.googleapis.com/calendar/v3/freeBusy", { method: "POST", headers: { authorization: `Bearer ${await token()}`, "content-type": "application/json" },
    body: JSON.stringify({ timeMin, timeMax, items: [{ id: process.env.GOOGLE_CALENDAR_ID || "primary" }] }) });
  const j = (await res.json()) as { calendars?: Record<string, { busy?: Slot[] }> };
  return Object.values(j.calendars ?? {}).flatMap((c) => c.busy ?? []);
}

/** Next free 45-minute viewing slots (weekday evenings / weekend daytime, LA time), avoiding busy blocks. */
export async function proposeSlots(count = 3, from = new Date()): Promise<Slot[]> {
  const cands: Slot[] = [];
  for (let d = 1; d <= 6; d++) {
    const day = new Date(from.getTime() + d * 864e5);
    const ds = laDay(day);
    const dow = new Date(`${ds}T12:00:00Z`).getUTCDay();
    const hours = dow === 0 || dow === 6 ? [11, 14] : [18];
    for (const h of hours) { const start = laInstant(ds, h); cands.push({ start, end: new Date(Date.parse(start) + 45 * 60000).toISOString() }); }
  }
  let blocks: Slot[] = [];
  try { blocks = await busy(cands[0].start, cands[cands.length - 1].end); } catch { blocks = []; }
  const free = cands.filter((c) => !blocks.some((b) => Date.parse(b.start) < Date.parse(c.end) && Date.parse(b.end) > Date.parse(c.start)));
  return free.slice(0, count);
}

export async function bookViewing(slot: Slot, title: string, description: string, attendees: string[] = []): Promise<Booked> {
  if (!calendarLive()) return { mode: "mock", id: `mock-evt-${Date.now()}` };
  const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${calId()}/events`, { method: "POST", headers: { authorization: `Bearer ${await token()}`, "content-type": "application/json" },
    // attendees intentionally not invited automatically (no outbound mail to real people); listed in description instead
    body: JSON.stringify({ summary: title, description: `${description}\n\nContacts: ${attendees.join(", ")}`, start: { dateTime: slot.start }, end: { dateTime: slot.end } }) });
  const j = (await res.json()) as { id?: string; htmlLink?: string };
  if (!j.id) throw new Error("Calendar insert failed");
  return { mode: "google", id: j.id, link: j.htmlLink };
}

/** First free 45-min slot inside a landlord-proposed window (prefers :30 after a "after X" start). */
export async function slotInWindow(w: { day: string; startMin: number; endMin: number }): Promise<Slot | null> {
  const cands: Slot[] = [];
  for (let m = w.startMin === w.endMin - 45 ? w.startMin : w.startMin + 30; m + 45 <= Math.max(w.endMin, w.startMin + 45); m += 30) {
    const start = laInstant(w.day, Math.floor(m / 60), m % 60);
    if (Date.parse(start) < Date.now() + 3600e3) continue;
    cands.push({ start, end: new Date(Date.parse(start) + 45 * 60000).toISOString() });
  }
  if (!cands.length) return null;
  let blocks: Slot[] = [];
  try { blocks = await busy(cands[0].start, cands[cands.length - 1].end); } catch { blocks = []; }
  return cands.find((c) => !blocks.some((b) => Date.parse(b.start) < Date.parse(c.end) && Date.parse(b.end) > Date.parse(c.start))) ?? null;
}
