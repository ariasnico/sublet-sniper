import { NextResponse } from "next/server";
import { listingPhotos } from "@/lib/photos";
import { isCraigslistUrl } from "@/lib/photo-url";

// Photos for one listing card (the cards use the batched /api/photos). Read through the parallel
// detail pool, independent of the search chain. The CDN caches answers for a day, failures for 5 min.
export async function GET(req: Request) {
  const url = new URL(req.url).searchParams.get("url") ?? "";
  if (!isCraigslistUrl(url)) return NextResponse.json({ error: "craigslist urls only" }, { status: 400 });
  const images = await listingPhotos(url);
  if (!images) return NextResponse.json({ images: [] }, { headers: { "cache-control": "public, s-maxage=300" } });
  return NextResponse.json({ images }, { headers: { "cache-control": "public, s-maxage=86400, stale-while-revalidate=604800" } });
}
