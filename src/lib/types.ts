export type ListingType = "room" | "studio" | "1br" | "2br" | "3br+" | "unknown";
export type Source = "craigslist" | "x" | "demo";
export type PricePeriod = "month" | "week" | "night" | "total";

export interface RawListing {
  id: string;
  source: Source;
  url: string;
  title: string;
  priceText: string | null;
  hood: string | null;
  category?: "sub" | "roo" | "apa";
  body?: string;
  address?: string;
  attrs?: string[];
  lat?: number;
  lon?: number;
  images?: string[];
  imageHashes?: string[];
  posted?: string;
  author?: { handle: string; createdAt: string; followers: number };
  demo?: { kind: "accomplice" | "scam_fixture"; landlordEmail?: string; note: string };
}

export interface Listing extends RawListing {
  priceMonthly: number | null;
  pricePeriod: PricePeriod;
  type: ListingType;
  furnished: boolean | null;
  availableFrom: string | null; // ISO date
  availableTo: string | null;
  neighborhood: string | null;
  inSF: boolean;
  normalizedBy: "heuristic" | "llm";
}

export type Light = "green" | "yellow" | "red";
/** One scoring signal, kept structured so the UI can explain the score. */
export interface ScamSignal { w: number; label: string; quote?: string; median?: number; price?: number; match?: { title: string; image?: string; distance: number } }
export interface ScamResult { light: Light; score: number; reasons: string[]; signals?: ScamSignal[] }

export interface Criteria {
  maxBudget: number | null;
  types: ListingType[];
  furnished: boolean | null;
  from: string | null;
  to: string | null;
  near: { name: string; lat: number; lon: number }[];
  maxKm: number;
  text: string;
}

export interface RankedListing extends Listing {
  scam: ScamResult;
  score: number;
  distanceKm: number | null;
  fit: string[];
}
