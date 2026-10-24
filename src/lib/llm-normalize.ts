import { z } from "zod";
import { completeJson } from "./llm";
import { toMonthly } from "./normalize";
import type { Listing } from "./types";

const Schema = z.object({
  price: z.number().nullable(), period: z.enum(["month", "week", "night", "total"]),
  type: z.enum(["room", "studio", "1br", "2br", "3br+", "unknown"]), furnished: z.boolean().nullable(),
  availableFrom: z.string().nullable(), availableTo: z.string().nullable(), neighborhood: z.string().nullable(),
});

const SYSTEM = `You normalize San Francisco rental listings into JSON with keys: price (number as written), period ("month"|"week"|"night"|"total"),
type ("room"|"studio"|"1br"|"2br"|"3br+"|"unknown"), furnished (bool|null), availableFrom/availableTo (YYYY-MM-DD or null; today is 2026-10-24),
neighborhood (SF neighborhood or null). Watch for weekly prices posted as monthly and totals for a stay.`;

/** LLM pass over the top listings (validated with zod at the boundary). Falls back to the heuristic listing. */
export async function llmNormalize(l: Listing): Promise<Listing> {
  const raw = await completeJson(SYSTEM, JSON.stringify({ title: l.title, price: l.priceText, hood: l.hood, attrs: l.attrs, body: (l.body ?? "").slice(0, 1500) }));
  const p = Schema.safeParse(raw);
  if (!p.success) return l;
  const v = p.data;
  const nights = v.availableFrom && v.availableTo ? (Date.parse(v.availableTo) - Date.parse(v.availableFrom)) / 864e5 : undefined;
  return { ...l, priceMonthly: toMonthly(v.price ?? null, v.period, nights) ?? l.priceMonthly, pricePeriod: v.period, type: v.type === "unknown" ? l.type : v.type,
    furnished: v.furnished ?? l.furnished, availableFrom: v.availableFrom ?? l.availableFrom, availableTo: v.availableTo ?? l.availableTo,
    neighborhood: v.neighborhood ?? l.neighborhood, normalizedBy: "llm" };
}
