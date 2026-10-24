import { fetchListings, hydrateDetails } from "./sources/craigslist";
import { xListings } from "./sources/x";
import { demoListings } from "./demo";
import { normalizeHeuristic } from "./normalize";
import { rankListings } from "./rank";
import { attachPhotos, prefetchPhotos } from "./photos";
import type { Criteria, RankedListing } from "./types";
import type { FetchReport } from "./sources/craigslist";

export async function searchListings(c: Criteria, opts: { includeDemo?: boolean; limit?: number } = {}): Promise<{ results: RankedListing[]; flagged: RankedListing[]; report: FetchReport & { x: number; demo: number; total: number } }> {
  const cats: ("sub" | "roo" | "apa")[] = c.types.length && c.types.every((t) => t === "room") ? ["roo", "sub"] : ["sub", "apa", "roo"];
  const { rows, report } = await fetchListings(cats);
  const xs = xListings();
  const demo = opts.includeDemo === false ? [] : demoListings();
  let ranked = rankListings([...rows, ...xs, ...demo].map(normalizeHeuristic), c);
  // fetch details for the top live results without a body (max 3, parallel detail pool), then re-rank.
  // Photos for the next cards are queued right behind them so they are usually ready when results render.
  const top = ranked.slice(0, 6);
  const raws = rows.filter((r) => top.some((t) => t.id === r.id));
  const hydrating = hydrateDetails(raws, 3);
  prefetchPhotos(ranked.filter((r) => r.scam.light !== "red"));
  if (await hydrating) ranked = rankListings([...rows, ...xs, ...demo].map(normalizeHeuristic), c);
  const all = [...rows, ...xs, ...demo].map(normalizeHeuristic);
  const flagged = rankListings(all, { ...c, maxBudget: null, types: [], furnished: null, from: null, near: [] })
    .filter((r) => r.scam.light === "red")
    .sort((a, b) => (b.source === "demo" ? 1 : 0) - (a.source === "demo" ? 1 : 0) || b.scam.score - a.scam.score)
    .slice(0, 6);
  const shown = ranked.filter((r) => r.scam.light !== "red").slice(0, opts.limit ?? 12);
  prefetchPhotos(shown);
  await attachPhotos(shown);
  return { results: shown, flagged, report: { ...report, x: xs.length, demo: demo.length, total: rows.length + xs.length + demo.length } };
}
