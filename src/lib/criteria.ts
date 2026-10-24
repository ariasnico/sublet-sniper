import { PLACES } from "./geo";
import { detectDates } from "./normalize";
import type { Criteria, ListingType } from "./types";

const ES_MONTHS: Record<string, string> = { ene: "jan", feb: "feb", mar: "mar", abr: "apr", may: "may", jun: "jun", jul: "jul", ago: "aug", sep: "sep", set: "sep", oct: "oct", nov: "nov", dic: "dec" };

/** Zero-key criteria parser for Spanish/English requests. The LLM can pass structured criteria instead. */
export function parseCriteria(text: string): Criteria {
  const t = text.toLowerCase().replace(/(\d),(\d{3})\b/g, "$1$2");
  let maxBudget: number | null = null;
  const k = t.match(/(?:menos de|under|below|max(?:imo)?|hasta|<|budget(?: of)?|presupuesto(?: de)?)\s*(?:usd|us\$|\$)?\s*(\d+(?:[.,]\d+)?)\s*(k|mil)?/);
  if (k) maxBudget = Math.round(parseFloat(k[1].replace(",", ".")) * (k[2] ? 1000 : 1));
  else { const d = t.match(/\$\s?(\d[\d,]{2,5})/); if (d) maxBudget = Number(d[1].replace(/,/g, "")); }
  if (maxBudget !== null && maxBudget < 20) maxBudget *= 1000;

  const types: ListingType[] = [];
  if (/\b(1\s?br|1 ?bd|1 ?dormitorio|un dormitorio|one bed|1 bedroom|1 ambiente)\b/.test(t)) types.push("1br");
  if (/\b(2\s?br|2 ?bd|2 dormitorios|two bed|2 bedroom)\b/.test(t)) types.push("2br");
  if (/\bstudio|monoambiente|estudio\b/.test(t)) types.push("studio");
  if (/\b(room|habitaci[oó]n|cuarto|pieza)\b/.test(t)) types.push("room");

  const furnished = /amoblad|amueblad|\bfurnished\b/.test(t) ? true : /sin amoblar|unfurnished/.test(t) ? false : null;

  // dates: "del 1/11 al 15/12" is day/month in Spanish
  let from: string | null = null, to: string | null = null;
  const es = [...t.matchAll(/\b(\d{1,2})\/(\d{1,2})\b/g)];
  const spanish = /\b(del|al|desde|hasta|busco|cerca)\b/.test(t);
  if (es.length && spanish) {
    const conv = es.slice(0, 2).map((m) => `${m[2]}/${m[1]}`).join(" ");
    ({ from, to } = detectDates(conv));
  } else {
    let tt = t;
    for (const [es2, en] of Object.entries(ES_MONTHS)) tt = tt.replace(new RegExp(`(\\d{1,2}) de ${es2}[a-z]*`, "g"), `${en} $1`);
    ({ from, to } = detectDates(tt));
  }
  const near = PLACES.filter((p) => p.aliases.some((a) => t.includes(a))).map(({ name, lat, lon }) => ({ name, lat, lon }));
  return { maxBudget, types, furnished, from, to, near, maxKm: 3, text };
}
