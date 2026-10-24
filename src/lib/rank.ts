import { haversineKm, hoodCoords } from "./geo";
import { scoreScam, type ScamContext } from "./scam";
import type { Criteria, Listing, RankedListing } from "./types";

export function distanceTo(l: Listing, c: Criteria): number | null {
  if (!c.near.length) return null;
  const p: [number, number] | null = l.lat && l.lon ? [l.lat, l.lon] : hoodCoords(l.neighborhood ?? l.hood);
  if (!p) return null;
  return Math.min(...c.near.map((n) => haversineKm(p, [n.lat, n.lon])));
}

/** Score 0-100: budget fit, type, furnished, dates overlap, distance; scam light gates the order. */
export function rankListings(listings: Listing[], c: Criteria, ctx: Omit<ScamContext, "corpus"> = {}): RankedListing[] {
  const out: RankedListing[] = [];
  for (const l of listings) {
    if (!l.inSF) continue;
    const fit: string[] = [];
    let s = 50;
    if (l.priceMonthly == null) s -= 15;
    else if (c.maxBudget) {
      if (l.priceMonthly > c.maxBudget * 1.1) continue; // hard filter: >10% over budget
      if (l.priceMonthly > c.maxBudget) { s -= 10; fit.push(`$${l.priceMonthly}/mo, slightly over budget (negotiable?)`); }
      else { s += 15 + Math.round(10 * (1 - l.priceMonthly / c.maxBudget)); fit.push(`$${l.priceMonthly}/mo, within budget`); }
    }
    if (c.types.length) {
      if (c.types.includes(l.type)) { s += 15; fit.push(`type ${l.type} matches`); }
      else if (l.type === "studio" && c.types.includes("1br")) { s += 5; fit.push("studio (close to 1BR)"); }
      else s -= 20;
    }
    if (c.furnished !== null) {
      if (l.furnished === c.furnished) { s += 10; fit.push(c.furnished ? "furnished" : "unfurnished"); }
      else if (l.furnished === null) s -= 2;
      else s -= 15;
    }
    if (c.from && l.availableFrom) {
      const gap = (Date.parse(l.availableFrom) - Date.parse(c.from)) / 864e5;
      if (gap <= 3) { s += 8; fit.push(`available ${l.availableFrom}`); }
      else if (gap <= 14) s += 2;
      else s -= 10;
      if (c.to && l.availableTo && Date.parse(l.availableTo) < Date.parse(c.to) - 3 * 864e5) s -= 8;
    }
    const d = distanceTo(l, c);
    if (d != null) {
      if (d <= c.maxKm) { s += Math.round(12 * (1 - d / c.maxKm)); fit.push(`${d.toFixed(1)} km to ${c.near[0].name}`); }
      else s -= Math.min(15, Math.round((d - c.maxKm) * 3));
    }
    const scam = scoreScam(l, { ...ctx, corpus: listings });
    if (scam.light === "red") s -= 40;
    else if (scam.light === "yellow") s -= 10;
    out.push({ ...l, scam, score: Math.max(0, Math.min(100, s)), distanceKm: d, fit });
  }
  return out.sort((a, b) => b.score - a.score);
}
