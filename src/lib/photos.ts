import { fetchDetailHtml, parseDetailHtml } from "./sources/craigslist";
import { isCraigslistUrl } from "./photo-url";

// Listing photos for cards. The Craigslist search page has no images, so we read each detail page
// through the detail pool (parallel, independent of the search chain) and remember the answer per URL.
export const PREFETCH_TOP = 8;
const memo = new Map<string, string[]>();
const inflight = new Map<string, Promise<string[] | null>>();

type PhotoRow = { source: string; url: string; images?: string[] };

export function needsPhoto(r: PhotoRow): boolean {
  return r.source === "craigslist" && !r.images?.length && isCraigslistUrl(r.url);
}

/** Up to 4 photo URLs for a listing; [] when it has none, null when the page could not be fetched. */
export function listingPhotos(url: string): Promise<string[] | null> {
  const hit = memo.get(url);
  if (hit) return Promise.resolve(hit);
  const running = inflight.get(url);
  if (running) return running;
  const p = fetchDetailHtml(url)
    .then((html) => {
      const imgs = parseDetailHtml(html).images.slice(0, 4);
      memo.set(url, imgs);
      if (memo.size > 500) memo.delete(memo.keys().next().value!);
      return imgs;
    }, () => null)
    .finally(() => inflight.delete(url));
  inflight.set(url, p);
  return p;
}

/** Kicks off photo fetches for the top rows without waiting (live mode only). */
export function prefetchPhotos(rows: PhotoRow[], n = PREFETCH_TOP): void {
  if (process.env.CRAIGSLIST_LIVE === "0") return;
  for (const r of rows.slice(0, n)) if (needsPhoto(r)) void listingPhotos(r.url);
}

/** Copies known photos into rows. Waits up to `waitMs` for fetches already in flight; never starts new ones. */
export async function attachPhotos(rows: PhotoRow[], waitMs = 0): Promise<number> {
  const todo = rows.filter(needsPhoto);
  const pending = todo.map((r) => inflight.get(r.url)).filter((p): p is Promise<string[] | null> => !!p);
  if (pending.length && waitMs > 0) {
    let t: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([Promise.allSettled(pending), new Promise((r) => { t = setTimeout(r, waitMs); })]);
    clearTimeout(t);
  }
  let n = 0;
  for (const r of todo) {
    const imgs = memo.get(r.url);
    if (imgs?.length) { r.images = imgs; n++; }
  }
  return n;
}

/** Settles when every photo fetch in flight is done (to keep a serverless instance alive via after()). */
export function photosInFlight(): Promise<unknown> {
  return Promise.allSettled([...inflight.values()]);
}
