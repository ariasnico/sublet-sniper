// Client side card photos: cards that mount together share a few batched /api/photos requests
// (chunks of 4 in rank order, so the top cards resolve first) and the answers are remembered per URL.
const CHUNK = 4;
const WINDOW_MS = 30;
const known = new Map<string, string[]>();
const pending = new Map<string, Promise<string[]>>();
let queue: { url: string; resolve: (imgs: string[]) => void }[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

/** Photos already loaded for a listing in this tab, if any (sync, for first render). */
export function peekPhotos(url: string): string[] | undefined {
  return known.get(url);
}

export function loadPhotos(url: string): Promise<string[]> {
  const hit = known.get(url);
  if (hit) return Promise.resolve(hit);
  let p = pending.get(url);
  if (!p) {
    p = new Promise<string[]>((resolve) => { queue.push({ url, resolve }); });
    pending.set(url, p);
    timer ??= setTimeout(flush, WINDOW_MS);
  }
  return p;
}

function flush() {
  const batch = queue;
  queue = []; timer = null;
  for (let i = 0; i < batch.length; i += CHUNK) {
    const chunk = batch.slice(i, i + CHUNK);
    fetch(`/api/photos?${chunk.map((c) => `u=${encodeURIComponent(c.url)}`).join("&")}`)
      .then((r) => r.json() as Promise<{ photos?: Record<string, string[]> }>)
      .then((j) => chunk.forEach((c) => {
        const imgs = j.photos?.[c.url] ?? [];
        if (imgs.length) known.set(c.url, imgs);
        pending.delete(c.url); c.resolve(imgs);
      }))
      .catch(() => chunk.forEach((c) => { pending.delete(c.url); c.resolve([]); }));
  }
}
