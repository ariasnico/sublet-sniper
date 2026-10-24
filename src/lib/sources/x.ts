import posts from "../../../data/x_posts.json";
import type { RawListing } from "../types";

const OFFER = /\b(sublet|sublease|subletting|room (available|for rent)|for rent|available (now|nov|dec|from)|rent(ing)? out|my (apt|apartment|room))\b/i;
const ASK = /\b(need|looking for|searching|anyone (have|know)|iso)\b/i;

/** X posts snapshot (collected 2026-10-24 via X API recent search). Only offers, not requests. */
export function xListings(): RawListing[] {
  return posts
    .filter((p) => OFFER.test(p.text) && !ASK.test(p.text))
    .map((p) => ({
      id: `x-${p.id}`, source: "x" as const, url: p.url, title: p.text.split("\n")[0].slice(0, 90), priceText: p.text.match(/\$\s?[\d,]{3,6}(k)?/i)?.[0] ?? null,
      hood: null, body: p.text, posted: p.created_at,
      author: { handle: p.author.username, createdAt: p.author.created_at, followers: p.author.followers },
    }));
}
