import type { Listing, ListingType, PricePeriod, RawListing } from "./types";

const NON_SF = /\b(oakland|daly city|san jose|santa clara|alameda|novato|petaluma|mill valley|palo alto|fullerton|escondido|bellflower|berkeley|san mateo|sunnyvale|mountain view|fremont|hayward|richmond, ca|sausalito|redwood city|los angeles|san diego|sacramento|vallejo|concord|walnut creek|south san francisco|burlingame|millbrae|pacifica|san rafael)\b/i;
const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

export function parsePrice(text: string | null | undefined): number | null {
  if (!text) return null;
  const m = text.replace(/,/g, "").match(/\$?\s*(\d{2,6})(?:\.\d+)?/);
  return m ? Number(m[1]) : null;
}

export function detectPeriod(hay: string): PricePeriod {
  const t = hay.toLowerCase();
  if (/rent period:\s*weekly|\/\s*(wk|week)\b|per week|a week|weekly rate|\$\d+\s*(\/|per)?\s*wk/.test(t)) return "week";
  if (/rent period:\s*daily|\/\s*night|per night|nightly|per day|\/day/.test(t)) return "night";
  if (/\btotal\b.*\b(for|stay)\b|for the (whole|entire) (stay|period)|total for/.test(t)) return "total";
  return "month";
}

export function detectType(hay: string, category?: string): ListingType {
  const t = hay.toLowerCase();
  if (/\b([3-9])\s*(br|bd|bed|bedroom|b\/)|three bed|four bed/.test(t)) return "3br+";
  if (/\b2\s*(br|bd|bed|bedroom|b\/|b\b)|two bed|2bd|2b\/|2bed/.test(t)) return "2br";
  if (/\bstudio\b/.test(t)) return "studio";
  if (/\b(private |large |lrg |xl\.?|shared |master |furnished )?(room|rm)\b|bed in|bedroom in|roommate|housemate/.test(t) || category === "roo") return "room";
  if (/\b1\s*(br|bd|bed|bedroom|b\/|b\b)|one bed|1bd|1bed|1 bedroom/.test(t)) return "1br";
  if (/\b(apartment|apt|suite|condo|in-law|inlaw|cottage|flat)\b/.test(t)) return "1br";
  return "unknown";
}

export function detectFurnished(hay: string): boolean | null {
  const t = hay.toLowerCase();
  if (/unfurnished|not furnished/.test(t)) return false;
  if (/furnished|amoblad|amueblad/.test(t)) return true;
  return null;
}

function iso(y: number, m: number, d: number) {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
/** Extract availability window like "available oct 27", "11/1 - 12/15", "Nov 1 to Dec 15". */
export function detectDates(hay: string, refYear = 2026): { from: string | null; to: string | null } {
  const t = hay.toLowerCase();
  const found: string[] = [];
  const re = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b|\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/g;
  for (const m of t.matchAll(re)) {
    let mo: number, d: number, y = refYear;
    if (m[1]) { mo = MONTHS[m[1]]; d = Number(m[2]); }
    else { mo = Number(m[3]); d = Number(m[4]); if (m[5]) y = Number(m[5].length === 2 ? "20" + m[5] : m[5]); }
    if (mo < 1 || mo > 12 || d < 1 || d > 31) continue;
    if (!m[5] && mo < 9 && refYear === 2026) y = 2027; // fall 2026 context: Jan-Aug means next year
    found.push(iso(y, mo, d));
    if (found.length >= 2) break;
  }
  const from = /\b(available )?(now|asap|immediately)\b/.test(t) && !found.length ? "2026-10-24" : found[0] ?? null;
  return { from, to: found[1] ?? null };
}

export function isInSF(r: Pick<RawListing, "hood" | "url" | "title" | "lat" | "lon">): boolean {
  if (r.lat && r.lon) return r.lat > 37.70 && r.lat < 37.83 && r.lon > -122.53 && r.lon < -122.35;
  const hay = `${r.hood ?? ""} ${r.title} ${r.url}`;
  if (NON_SF.test(hay)) return false;
  return true;
}

export function toMonthly(price: number | null, period: PricePeriod, nights?: number): number | null {
  if (price == null) return null;
  switch (period) {
    case "month": return price;
    case "week": return Math.round((price * 52) / 12);
    case "night": return Math.round(price * 30);
    case "total": return nights && nights >= 14 ? Math.round((price / nights) * 30) : price;
    default: { const never: never = period; return never; }
  }
}

/** Deterministic, zero-key normalizer. The LLM normalizer (llm-normalize.ts) can override fields when a key exists. */
export function normalizeHeuristic(r: RawListing): Listing {
  const hay = [r.title, r.priceText ?? "", ...(r.attrs ?? []), r.body ?? ""].join(" \n ");
  const price = parsePrice(r.priceText) ?? parsePrice(r.title.match(/\$\s?[\d,]{3,6}/)?.[0]);
  const period = detectPeriod(`${r.title} ${(r.attrs ?? []).join(" ")} ${(r.body ?? "").slice(0, 400)}`);
  const dates = detectDates(`${(r.attrs ?? []).join(" ")} ${r.title} ${r.body ?? ""}`);
  let nights: number | undefined;
  if (period === "total" && dates.from && dates.to) nights = (Date.parse(dates.to) - Date.parse(dates.from)) / 864e5;
  return {
    ...r,
    priceMonthly: toMonthly(price, period, nights),
    pricePeriod: period,
    type: detectType(`${r.title} ${(r.attrs ?? []).join(" ")}`, r.category),
    furnished: detectFurnished(hay),
    availableFrom: dates.from,
    availableTo: dates.to,
    neighborhood: r.hood && !/^(city of )?san fran|^sf$/i.test(r.hood.trim()) ? r.hood.trim() : null,
    inSF: isInSF(r),
    normalizedBy: "heuristic",
  };
}
