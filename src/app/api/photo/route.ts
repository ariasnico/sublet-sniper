import { NextResponse } from "next/server";
import { fetchListingPage } from "@/lib/sources/craigslist";

// Listing photos for cards. The search page has no images, so we read the detail page lazily
// (same polite, sequential fetcher as search) and let the CDN cache the answer for a day.
const memo = new Map<string, string[]>();

export async function GET(req: Request) {
  const url = new URL(req.url).searchParams.get("url") ?? "";
  let host = "";
  try { host = new URL(url).hostname; } catch { /* invalid */ }
  if (!/(^|\.)craigslist\.org$/.test(host)) return NextResponse.json({ error: "craigslist urls only" }, { status: 400 });
  let images = memo.get(url);
  if (!images) {
    try { images = (await fetchListingPage(url)).images?.slice(0, 4) ?? []; }
    catch { return NextResponse.json({ images: [] }, { headers: { "cache-control": "public, s-maxage=300" } }); }
    memo.set(url, images);
  }
  return NextResponse.json({ images }, { headers: { "cache-control": "public, s-maxage=86400, stale-while-revalidate=604800" } });
}
