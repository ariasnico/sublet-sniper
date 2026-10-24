import { medianFor, SCAM_RATIO } from "./baselines";
import type { Light, Listing, ScamResult } from "./types";

export const SCAM_KEYWORDS: { re: RegExp; label: string; weight: number }[] = [
  { re: /\bwire (transfer|the money|me|it|to|into|\$)|\bwiring\b|\bwired? (the )?(money|funds|payment)/i, label: "asks for a wire transfer", weight: 35 },
  { re: /\bzelle\b/i, label: "asks for Zelle (no buyer protection)", weight: 30 },
  { re: /western union|moneygram|cashier.?s check|gift card|crypto|bitcoin/i, label: "untraceable payment method", weight: 35 },
  { re: /deposit to hold|holding (fee|deposit)|hold (it|the (unit|place|room)) (for you )?(with|if you send)|send (a )?deposit before/i, label: "deposit to hold before viewing", weight: 30 },
  { re: /out of (the )?(country|town|state)|overseas|missionary|deployed|military assignment|working abroad/i, label: "landlord claims to be away (classic remote-landlord scam)", weight: 30 },
  { re: /keys? (by|via|through) (mail|courier|fedex|ups)|ship (you )?the keys|mail (you )?the keys/i, label: "keys by mail", weight: 30 },
  { re: /background check (link|form)|credit (report|check) (link|site)|fill (out )?this (link|form) .*(ssn|social)/i, label: "background/credit check via external link", weight: 25 },
  { re: /no (viewing|showing|tour)s?|can'?t show|cannot show|drive by only/i, label: "refuses viewings", weight: 25 },
  { re: /god bless|honest and god.?fearing/i, label: "scam-script phrasing", weight: 10 },
  { re: /google voice/i, label: "Google Voice number only", weight: 10 },
];

export interface ScamContext {
  corpus: Listing[]; // other listings for duplicate detection
  messages?: string[]; // landlord messages in the thread, if any
  now?: Date;
}

export function shingles(text: string, k = 5): Set<string> {
  const w = text.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter(Boolean);
  const s = new Set<string>();
  for (let i = 0; i + k <= w.length; i++) s.add(w.slice(i, i + k).join(" "));
  return s;
}
export function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}
export function hamming(a: string, b: string): number {
  if (a.length !== b.length) return 64;
  let d = 0;
  for (let i = 0; i < a.length; i++) {
    let x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    while (x) { d += x & 1; x >>= 1; }
  }
  return d;
}

function moneyAmounts(text: string): number[] {
  return [...text.replace(/,/g, "").matchAll(/\$\s?(\d{3,6})/g)].map((m) => Number(m[1]));
}

export function lightFor(score: number): Light {
  return score >= 50 ? "red" : score >= 20 ? "yellow" : "green";
}

export function scoreScam(l: Listing, ctx: ScamContext): ScamResult {
  const reasons: string[] = [];
  let score = 0;
  const add = (w: number, r: string) => { score += w; reasons.push(r); };
  const text = [l.title, l.body ?? "", ...(ctx.messages ?? [])].join("\n");

  // 1. Price far below market after normalization to monthly
  if (l.priceMonthly != null) {
    if (l.priceMonthly < 100) add(20, `price $${l.priceMonthly} looks like a placeholder`);
    else {
      const med = medianFor(l.type);
      if (l.priceMonthly < med * SCAM_RATIO)
        add(40, `$${l.priceMonthly}/mo is ${Math.round((l.priceMonthly / med) * 100)}% of the SF ${l.type === "unknown" ? "sublet" : l.type} median ($${med}); threshold 60%`);
    }
    if (l.pricePeriod !== "month") reasons.push(`info: price was per ${l.pricePeriod}, normalized to $${l.priceMonthly}/mo`);
  }
  // 2. Keywords in listing body or landlord messages
  for (const k of SCAM_KEYWORDS) if (k.re.test(text)) add(k.weight, `${k.label} ("${text.match(k.re)?.[0]}")`);
  // 3. Upfront money above CA AB 12 cap (2x monthly rent)
  if (l.priceMonthly && l.priceMonthly >= 100) {
    const big = moneyAmounts([l.body ?? "", ...(ctx.messages ?? [])].join(" ")).filter((a) => a > 2 * l.priceMonthly! && a < 100000);
    if (big.length && /deposit|first|last|upfront|secure|hold/i.test(text))
      add(35, `asks $${big[0].toLocaleString("en-US")} upfront, more than 2x monthly rent (CA AB 12 cap)`);
  }
  // 4. Duplicate text across different listings (copied ad)
  const mine = shingles(`${l.title} ${l.body ?? ""}`);
  if (mine.size >= 8) {
    for (const o of ctx.corpus) {
      if (o.id === l.id || !o.body) continue;
      const j = jaccard(mine, shingles(`${o.title} ${o.body}`));
      if (j >= 0.35) { add(30, `description ${Math.round(j * 100)}% identical to another listing (${o.source}: "${o.title.slice(0, 50)}")`); break; }
    }
  }
  // 5. Duplicate photos (perceptual hash, Hamming <= 6) across different listings
  if (l.imageHashes?.length) {
    outer: for (const o of ctx.corpus) {
      if (o.id === l.id || !o.imageHashes?.length) continue;
      for (const a of l.imageHashes) for (const b of o.imageHashes) {
        const d = hamming(a, b);
        if (d <= 6) { add(30, `photo matches another listing's photo (pHash distance ${d}): "${o.title.slice(0, 50)}"`); break outer; }
      }
    }
  }
  // 6. Brand-new X account
  if (l.author) {
    const days = ((ctx.now ?? new Date()).getTime() - Date.parse(l.author.createdAt)) / 864e5;
    if (days < 90) add(25, `X account @${l.author.handle} is only ${Math.round(days)} days old`);
    if (l.author.followers < 20) add(5, `X account has ${l.author.followers} followers`);
  }
  // 7. Thin listing
  if (l.source === "craigslist" && l.body !== undefined && (l.body ?? "").length < 80) add(10, "very short description");

  const core = reasons.filter((r) => !r.startsWith("info:"));
  if (!core.length) reasons.unshift("no scam signals found (price in market range, no risky payment keywords, no duplicates)");
  return { light: lightFor(score), score, reasons };
}
