import raw from "../../data/rent_baselines.json";
import type { ListingType } from "./types";

/** Median monthly asking rent by type (Apartment List Oct 2026 + Craigslist-derived room median). */
export const MEDIANS: Record<Exclude<ListingType, "unknown">, number> = {
  room: raw.craigslist_derived_live.room_median_sfc_roo,
  studio: raw.zumper.studio_avg,
  "1br": raw.apartmentlist_live["1br"],
  "2br": raw.apartmentlist_live["2br"],
  "3br+": raw.zumper["2br_median"],
};
export const SUBLET_MEDIAN = raw.craigslist_derived_live.sublet_median_sfc_sub;
export const SCAM_RATIO = 0.6;
export function medianFor(t: ListingType): number {
  return t === "unknown" ? SUBLET_MEDIAN : MEDIANS[t];
}
