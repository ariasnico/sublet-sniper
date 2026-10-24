import listSnap from "../../../data/list_snapshot.json";
import detailSnap from "../../../data/detail_snapshot.json";
import phash from "../../../data/phash_results.json";
import type { RawListing } from "../types";
import { createPool } from "../pool";

type Cat = "sub" | "roo" | "apa";
const CATS: Cat[] = ["sub", "roo", "apa"];
export const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const MIN_GAP_MS = 3000;
// Listing detail pages (photos, body) use their own small pool, independent of the search chain:
// at most 4 in flight, starts spaced 250 ms apart. Low volume (top results only), still polite.
const DETAIL_CONCURRENCY = 4;
const DETAIL_GAP_MS = 250;

export function postId(url: string): string {
  return url.match(/\/([A-Za-z0-9]+)(?:\.html)?$/)?.[1] ?? url;
}

const hashesByListing = new Map<string, string[]>();
for (const h of phash.hashes) {
  if (!("phash" in h) || !h.phash) continue;
  const id = postId(h.listing);
  hashesByListing.set(id, [...(hashesByListing.get(id) ?? []), h.phash]);
}
const details = new Map(detailSnap.map((d) => [postId(d.url), d]));

function decode(s: string) {
  return s.replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

function enrich(r: { title: string; url: string; price: string | null; hood: string | null }, cat: Cat): RawListing {
  const id = postId(r.url);
  const d = details.get(id);
  return {
    id: `cl-${id}`, source: "craigslist", url: r.url, title: decode(r.title), priceText: r.price, hood: r.hood ? decode(r.hood) : null, category: cat,
    ...(d && {
      body: d.body ?? undefined, attrs: d.attrs, images: d.images, posted: d.posted ?? undefined,
      lat: d.lat ? Number(d.lat) : undefined, lon: d.lon ? Number(d.lon) : undefined,
    }),
    imageHashes: hashesByListing.get(id),
  };
}

export function snapshotListings(): RawListing[] {
  const snap: Record<Cat, { title: string; url: string; price: string | null; hood: string | null }[]> = listSnap;
  return CATS.flatMap((c) => snap[c].map((r) => enrich(r, c)));
}

/** Parse Craigslist static search HTML (li.cl-static-search-result). */
export function parseListHtml(html: string) {
  const items = [...html.matchAll(/<li class="cl-static-search-result" title="([^"]*)">\s*<a href="([^"]*)">([\s\S]*?)<\/a>/g)];
  return items.map(([, title, url, inner]) => ({
    title, url,
    price: inner.match(/<div class="price">([^<]*)/)?.[1] ?? null,
    hood: inner.match(/<div class="location">\s*([^<]*)/)?.[1]?.trim() ?? null,
  }));
}

/** Parse a detail page (same selectors as research cl_fetch.py). */
export function parseDetailHtml(b: string) {
  const g = (re: RegExp) => b.match(re)?.[1]?.trim();
  const body = g(/<section id="postingbody">([\s\S]*?)<\/section>/)?.replace(/<[^>]+>/g, " ").replace("QR Code Link to This Post", "").replace(/\s+/g, " ").trim();
  return {
    body, posted: g(/class="date timeago"[^>]*datetime="([^"]+)"/),
    lat: g(/data-latitude="([^"]+)"/), lon: g(/data-longitude="([^"]+)"/),
    attrs: [...b.matchAll(/<div class="attr[^"]*">([\s\S]*?)<\/div>/g)].slice(0, 12).map((m) => m[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()),
    images: [...new Set(b.match(/https:\/\/images\.craigslist\.org\/[^"' ]+_600x450\.jpg/g) ?? [])].slice(0, 8),
  };
}

/** Parses one Craigslist listing page (title, price, housing, address, hood, body, photos). */
export function parseListingPage(html: string, url: string): RawListing {
  const g = (re: RegExp) => html.match(re)?.[1]?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const d = parseDetailHtml(html);
  const housing = g(/<span class="housing">([\s\S]*?)<\/span>/)?.replace(/[\s/-]+$/, "").replace(/^[\s/-]+/, "");
  const address = g(/<h2 class="street-address">([\s\S]*?)<\/h2>/);
  const hood = g(/<span id="titletextonly">[\s\S]*?<\/span>\s*<span>\s*\(([^)]*)\)/);
  const title = decode(g(/<span id="titletextonly">([\s\S]*?)<\/span>/) ?? g(/<title>([\s\S]*?)<\/title>/) ?? "Craigslist listing");
  const id = postId(url.replace(/\?.*$/, ""));
  return {
    id: `cl-${id}`, source: "craigslist", url, title: [title, housing].filter(Boolean).join(" · "), priceText: g(/<span class="price">([^<]*)/) ?? null,
    hood: hood ? decode(hood) : null, category: /\/(sub|roo|apa)\//.exec(url)?.[1] as Cat | undefined ?? "apa",
    body: [address ? `Address: ${address}.` : "", d.body ?? ""].join(" ").trim(), attrs: [housing ?? "", ...d.attrs].filter(Boolean), images: d.images, posted: d.posted ?? undefined,
    lat: d.lat ? Number(d.lat) : undefined, lon: d.lon ? Number(d.lon) : undefined, imageHashes: hashesByListing.get(id), address,
  } as RawListing;
}

export async function fetchListingPage(url: string): Promise<RawListing> {
  return parseListingPage(await fetchDetailHtml(url), url);
}

async function get(url: string, timeoutMs = 15000): Promise<string> {
  const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "en-US" }, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`craigslist ${res.status}`);
  return res.text();
}

// ---- detail pages: small parallel pool + 10 min cache that also dedupes concurrent requests ----
const detailRun = createPool(DETAIL_CONCURRENCY, DETAIL_GAP_MS);
const pages = new Map<string, { at: number; html: Promise<string> }>();
export function fetchDetailHtml(url: string): Promise<string> {
  const hit = pages.get(url);
  if (hit && Date.now() - hit.at < 10 * 60e3) return hit.html;
  const entry = { at: Date.now(), html: detailRun(() => get(url, 10000)) };
  pages.set(url, entry);
  entry.html.catch(() => { if (pages.get(url) === entry) pages.delete(url); });
  if (pages.size > 60) pages.delete(pages.keys().next().value!);
  return entry.html;
}

// ---- polite search fetching: one request at a time, >=3s apart, 10 min cache ----
let last = 0;
let chain: Promise<unknown> = Promise.resolve();
async function politeGet(url: string): Promise<string> {
  const run = async () => {
    const wait = last + MIN_GAP_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    last = Date.now();
    return get(url);
  };
  const p = chain.then(run, run);
  chain = p.catch(() => undefined);
  return p;
}

const cache = new Map<string, { at: number; rows: RawListing[] }>();
export interface FetchReport { mode: "live" | "snapshot"; perCategory: Record<string, number | string>; fetchedAt: string }

export async function fetchListings(cats: Cat[] = CATS): Promise<{ rows: RawListing[]; report: FetchReport }> {
  if (process.env.CRAIGSLIST_LIVE === "0") {
    const rows = snapshotListings().filter((r) => cats.includes(r.category!));
    return { rows, report: { mode: "snapshot", perCategory: { note: "CRAIGSLIST_LIVE=0" }, fetchedAt: "2026-10-24 snapshot" } };
  }
  const per: Record<string, number | string> = {};
  const rows: RawListing[] = [];
  let anyLive = false;
  for (const c of cats) {
    const hit = cache.get(c);
    if (hit && Date.now() - hit.at < 10 * 60e3) { rows.push(...hit.rows); per[c] = hit.rows.length; anyLive = true; continue; }
    try {
      const html = await politeGet(`https://sfbay.craigslist.org/search/sfc/${c}`);
      const parsed = parseListHtml(html).map((r) => enrich(r, c));
      if (!parsed.length) throw new Error("0 results parsed");
      cache.set(c, { at: Date.now(), rows: parsed });
      rows.push(...parsed); per[c] = parsed.length; anyLive = true;
    } catch (e) {
      const snap = snapshotListings().filter((r) => r.category === c);
      rows.push(...snap); per[c] = `snapshot (${(e as Error).message})`;
    }
  }
  return { rows, report: { mode: anyLive ? "live" : "snapshot", perCategory: per, fetchedAt: new Date().toISOString() } };
}

/** Fetch details for up to `max` listings lacking a body (in parallel through the detail pool). */
export async function hydrateDetails(rows: RawListing[], max = 4): Promise<number> {
  if (process.env.CRAIGSLIST_LIVE === "0") return 0;
  const todo = rows.filter((r) => r.source === "craigslist" && !r.body).slice(0, max);
  const ok = await Promise.all(todo.map(async (r) => {
    try {
      const d = parseDetailHtml(await fetchDetailHtml(r.url));
      Object.assign(r, { body: d.body, posted: d.posted, attrs: d.attrs, images: d.images, lat: d.lat ? Number(d.lat) : undefined, lon: d.lon ? Number(d.lon) : undefined });
      details.set(postId(r.url), { ...r, ...d } as never);
      return 1;
    } catch { return 0; }
  }));
  return ok.reduce<number>((a, b) => a + b, 0);
}
