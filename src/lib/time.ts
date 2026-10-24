export const TZ = "America/Los_Angeles";
/** Offset (minutes) of LA at a given instant. */
function laOffset(d: Date): number {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: TZ, timeZoneName: "shortOffset" }).formatToParts(d).find((x) => x.type === "timeZoneName")?.value ?? "GMT-8";
  const m = p.match(/GMT([+-]\d+)/);
  return (m ? Number(m[1]) : -8) * 60;
}
/** ISO instant for a wall-clock time in LA on day (YYYY-MM-DD). */
export function laInstant(day: string, hour: number, minute = 0): string {
  const guess = new Date(`${day}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00Z`);
  return new Date(guess.getTime() - laOffset(guess) * 60000).toISOString();
}
export function laDay(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}
export function fmtLA(iso: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso)) + " PT";
}
