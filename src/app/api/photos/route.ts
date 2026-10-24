import { NextResponse } from "next/server";
import { listingPhotos } from "@/lib/photos";
import { isCraigslistUrl } from "@/lib/photo-url";

// Batched card photos: GET /api/photos?u=<listing>&u=<listing>... -> { photos: { [listing]: string[] } }.
// Fetched in parallel through the detail pool. GET so the CDN can cache it (a day when every page loaded).
const MAX = 12;
export async function GET(req: Request) {
  const urls = [...new Set(new URL(req.url).searchParams.getAll("u"))].filter(isCraigslistUrl).slice(0, MAX);
  if (!urls.length) return NextResponse.json({ error: "craigslist urls only" }, { status: 400 });
  const found = await Promise.all(urls.map((u) => listingPhotos(u)));
  const photos = Object.fromEntries(urls.map((u, i) => [u, found[i] ?? []]));
  const cache = found.every((f) => f !== null) ? "public, s-maxage=86400, stale-while-revalidate=604800" : "public, s-maxage=300";
  return NextResponse.json({ photos }, { headers: { "cache-control": cache } });
}
