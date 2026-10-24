/** Craigslist serves several sizes of every photo. Cards use the 300x300 variant (~3x smaller); the X-ray keeps 600x450. */
export function cardThumb(src: string): string {
  return /^https:\/\/images\.craigslist\.org\//.test(src) ? src.replace(/_600x450\.jpg$/, "_300x300.jpg") : src;
}

/** Only Craigslist listing pages may be proxied by /api/photo(s). */
export function isCraigslistUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return /^https?:$/.test(u.protocol) && /(^|\.)craigslist\.org$/.test(u.hostname);
  } catch { return false; }
}
