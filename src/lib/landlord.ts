import { complete } from "./llm";
import { fmtLA, laDay } from "./time";
import type { RenterProfile, Thread } from "./store";
import type { Slot } from "./calendar";

export const RED_FLAGS: { re: RegExp; label: string; short: string }[] = [
  { re: /\b(out of (the )?(country|town|state)|overseas|abroad|missionary|deployed|fuera del pa[ií]s)\b/i, label: "Landlord says they are out of the country", short: "Says they're out of the country" },
  { re: /\bzelle\b/i, label: "Asks for Zelle (no buyer protection)", short: "Asked for Zelle" },
  { re: /\b(wire|wiring|western union|moneygram|bank transfer)\b/i, label: "Asks for a wire / money transfer", short: "Asked for a wire" },
  { re: /\b(gift ?cards?|bitcoin|crypto|usdt|cash ?app|venmo)\b/i, label: "Asks for gift cards / crypto / P2P app", short: "Asked for gift cards or crypto" },
  { re: /\b(deposit|first (and|&) last|holding fee|reserve|application fee)\b.{0,80}\b(before|prior|to hold|now|today|first|asap|secure)\b|\b(before|prior to)\b.{0,40}\b(viewing|showing|seeing|tour)\b.{0,60}\b(deposit|pay|send)\b/i, label: "Wants money before an in-person viewing", short: "Wants money before a viewing" },
  { re: /\b(keys? (will be )?(mailed|shipped|sent)|airbnb (will|to) (hold|handle)|courier)\b/i, label: "Keys by mail / third-party escrow story", short: "Offers keys by mail" },
];

/** Short wording of a red-flag label (for the chat narration). */
export const flagShort = (label: string) => RED_FLAGS.find((f) => f.label === label)?.short ?? label;

export function detectRedFlags(text: string): string[] {
  return RED_FLAGS.filter((f) => f.re.test(text)).map((f) => f.label);
}

export function emailAllowed(email: string): boolean {
  const allow = [process.env.DEMO_LANDLORD_EMAIL || "landlord-demo@example.com", ...(process.env.DEMO_ALLOWED_EMAILS ?? "").split(",")]
    .map((s) => s.trim().toLowerCase()).filter(Boolean);
  return allow.includes(email.trim().toLowerCase());
}

export function firstContact(p: RenterProfile, title: string, price: number | null): { subject: string; text: string } {
  return {
    subject: `[Sublet Sniper demo] ${title.replace(/^\[DEMO DATA\]\s*/, "")}`,
    text: `Hi! I'm ${p.name}. I saw your listing "${title}"${price ? ` ($${price.toLocaleString("en-US")}/mo)` : ""} and I'm very interested.\n\n` +
      `About me: ${p.occupation}. ${p.about}\nDates: ${p.moveIn} to ${p.moveOut}. ${p.pets}, ${p.smoker ? "smoker" : "non-smoker"}. ${p.references}.\n\n` +
      `Is it still available? Could we do a quick live video walkthrough or an in-person viewing this week?\n\nThanks,\n${p.name}\n(sent by my rental assistant, I review every message)`,
  };
}

export type Intent = "safety" | "pick_slot" | "landlord_time" | "wants_viewing" | "proof_given" | "price" | "question" | "generic";

export function pickSlot(text: string, slots: Slot[] | undefined): Slot | null {
  if (!slots?.length) return null;
  const n = text.match(/\b(option|slot|#)\s*([1-3])\b|^\s*([1-3])\b/i);
  if (n) return slots[Number(n[2] ?? n[3]) - 1] ?? null;
  const t = text.toLowerCase();
  for (const s of slots) {
    const label = fmtLA(s.start).toLowerCase(); // e.g. "sun, oct 25, 2:00 pm pt"
    const [dow] = label.split(",");
    const hour = label.match(/(\d{1,2}):\d\d\s*(am|pm)/);
    if (t.includes(dow) && (!hour || t.includes(hour[1]))) return s;
  }
  if (/\b(first|works|sounds good|perfect|ok|confirm)\b/i.test(text)) return slots[0];
  return null;
}

export interface TimeWindow { day: string; startMin: number; endMin: number }

const DOWS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const hm = (h: string, m: string | undefined, ap: string | undefined, def: "am" | "pm" = "pm") => {
  let hh = Number(h) % 12; const a = (ap ?? def).toLowerCase();
  if (a.startsWith("p")) hh += 12;
  return hh * 60 + Number(m ?? 0);
};

/** Strip quoted reply text ("On ... wrote:" and "> " lines) so we only read the landlord's new words. */
export function stripQuoted(text: string): string {
  const cut = text.split(/\n\s*On .{0,200}wrote:\s*\n|\n-{2,}\s*Original Message/i)[0];
  return cut.split("\n").filter((l) => !/^\s*>/.test(l)).join("\n").trim();
}

/** Parses a landlord-proposed day + time window ("Monday after 5pm", "tomorrow 2-4pm", "Sat at 11am"). LA dates. */
export function parseWindow(raw: string, now = new Date()): TimeWindow | null {
  const text = stripQuoted(raw).toLowerCase();
  const today = laDay(now);
  const todayDow = new Date(`${today}T12:00:00Z`).getUTCDay();
  let offset: number | null = null;
  const dm = text.match(/\b(sun|mon|tues?|wed(?:nes)?|thu(?:rs)?|fri|sat(?:ur)?)(?:day)?\b/);
  if (/\btomorrow\b/.test(text)) offset = 1;
  else if (/\b(today|tonight|this evening)\b/.test(text)) offset = 0;
  else if (dm) { const d = DOWS.indexOf(dm[1].slice(0, 3)); offset = (d - todayDow + 7) % 7 || 7; }
  if (offset === null) return null;
  const day = laDay(new Date(Date.parse(`${today}T12:00:00Z`) + offset * 864e5));
  let startMin = 9 * 60, endMin = 20 * 60;
  let m: RegExpMatchArray | null;
  if ((m = text.match(/\b(?:between|from)?\s*(\d{1,2})(?::(\d\d))?\s*(am|pm)?\s*(?:-|to|and|–)\s*(\d{1,2})(?::(\d\d))?\s*(am|pm)\b/))) {
    startMin = hm(m[1], m[2], m[3] ?? m[6]); endMin = hm(m[4], m[5], m[6]);
  } else if ((m = text.match(/\b(?:after|from|anytime after|any time after)\s*(\d{1,2})(?::(\d\d))?\s*(am|pm)?/))) {
    startMin = hm(m[1], m[2], m[3]); endMin = Math.max(startMin + 120, 20 * 60);
  } else if ((m = text.match(/\bbefore\s*(\d{1,2})(?::(\d\d))?\s*(am|pm)?/))) {
    endMin = hm(m[1], m[2], m[3]); startMin = Math.min(9 * 60, endMin - 60);
  } else if ((m = text.match(/\b(?:at|@|around)\s*(\d{1,2})(?::(\d\d))?\s*(am|pm)?/)) || (m = text.match(/\b(\d{1,2})(?::(\d\d))?\s*(am|pm)\b/))) {
    startMin = hm(m[1], m[2], m[3]); endMin = startMin + 45;
  } else if (/\bmorning\b/.test(text)) { startMin = 9 * 60; endMin = 12 * 60; }
  else if (/\bafternoon\b/.test(text)) { startMin = 12 * 60; endMin = 17 * 60; }
  else if (/\b(evening|tonight|night)\b/.test(text)) { startMin = 17 * 60; endMin = 20 * 60; }
  return { day, startMin, endMin };
}

export function classify(text: string, thread: Thread): Intent {
  text = stripQuoted(text);
  if (detectRedFlags(text).length) return "safety";
  if (thread.offeredSlots?.length && pickSlot(text, thread.offeredSlots.map((s) => JSON.parse(s) as Slot))) return "pick_slot";
  if (parseWindow(text)) return "landlord_time";
  if (/(video|walkthrough|facetime|tour link|photos? of (the )?(id|lease)|youtube|loom|proof|deed|id attached)/i.test(text)) return "proof_given";
  if (/(when can you|come (see|by)|viewing|showing|visit|stop by)/i.test(text)) return "wants_viewing";
  if (/\$\s?\d|price|rent|firm|negotiable/i.test(text)) return "price";
  if (/\?/.test(text)) return "question";
  return "generic";
}

export interface ReplyPlan { intent: Intent; text: string; flags: string[]; proposeSlots: boolean; slot: Slot | null; askedProof: boolean;
  /** Our counter-offer ($/mo) when we negotiated. */ counter?: number | null;
  /** Price we accepted ($/mo) after a counter. */ accepted?: number | null }

export function pricesIn(text: string): number[] {
  return [...text.replace(/,/g, "").matchAll(/\$\s?(\d{3,5})/g)].map((m) => Number(m[1]));
}
export function priceIn(text: string): number | null {
  return pricesIn(text)[0] ?? null;
}
/** The monthly rent in a message: a "$X/mo"-style amount first (so a "$7,600 deposit" isn't read as rent), else the first price. */
export function rentIn(text: string): number | null {
  const m = text.replace(/,/g, "").match(/\$\s?(\d{3,5})\s*(?:\/\s?mo(?:nth)?\b|per month|a month|monthly)/i);
  return m ? Number(m[1]) : priceIn(text);
}
/** Counter: the budget cap when asked is above it, otherwise ~5% off rounded to $50. */
export function counterOffer(asked: number, maxBudget: number): number {
  return asked > maxBudget ? maxBudget : Math.round((asked * 0.95) / 50) * 50;
}
/** Did the landlord accept our counter? A price mentioned at or below it, or an explicit "deal". */
export function acceptsOffer(raw: string, offered: number): boolean {
  const text = stripQuoted(raw);
  const rent = rentIn(text);
  if (rent != null) return rent <= offered;
  return /\b(deal|agreed|i accept|accepted|you('ve)? got (it|a deal)|that price works|de acuerdo|trato hecho)\b/i.test(text);
}
const usd = (n: number) => `$${n.toLocaleString("en-US")}`;

/** Deterministic reply planner. Safety rules always run here, even when an LLM writes the wording. */
export function planReply(text: string, thread: Thread, p: RenterProfile, slots: Slot[], windowSlot: Slot | null = null): ReplyPlan {
  text = stripQuoted(text);
  const intent = classify(text, thread);
  const flags = detectRedFlags(text);
  const slotList = slots.map((s, i) => `${i + 1}) ${fmtLA(s.start)}`).join("\n");
  const sign = `\n\n${p.name}`;
  switch (intent) {
    case "safety": {
      // One deterministic reply: refuse the payment AND (if they quoted rent above our offer) counter AND ask for the live tour.
      const asked = rentIn(text);
      const counter = asked && asked > 0 && (!thread.deal?.offered || asked > thread.deal.offered) ? counterOffer(asked, p.maxBudget) : null;
      return { intent, flags, proposeSlots: false, slot: null, askedProof: true, counter, text:
        `Thanks for the reply. I don't send any deposit, Zelle, wire or other payment before seeing the place in person (or on a live video call) and signing a written sublease. California also caps move-in payments (AB 12).` +
        `${counter ? ` On price: my budget tops out at ${usd(p.maxBudget)}/mo; would you do ${usd(counter)}/mo for ${p.moveIn} to ${p.moveOut}?` : ""}` +
        ` Could we start with a quick live video walkthrough, and could you confirm you're the leaseholder? If that works for you, happy to keep going; otherwise I'll pass.${sign}` };
    }
    case "pick_slot": {
      const slot = pickSlot(text, thread.offeredSlots?.map((s) => JSON.parse(s) as Slot));
      return { intent, flags, proposeSlots: false, slot, askedProof: thread.askedProof, text:
        `Great, ${slot ? fmtLA(slot.start) : "that time"} works, it's on my calendar. Please send the exact address and unit number, and your full name so I know who to ask for.${sign}` };
    }
    case "landlord_time": {
      const video = /\b(video|facetime|zoom|call)\b/i.test(text);
      if (windowSlot) return { intent, flags, proposeSlots: false, slot: windowSlot, askedProof: true, text:
        `${/available/i.test(text) ? "Great to hear it's available! " : ""}${fmtLA(windowSlot.start)} works for me${video ? " for the video tour" : ""}. I've put it on my calendar. ` +
        `${video ? "Please send the call link (FaceTime/Zoom is fine) and" : "Please send"} the exact address and unit, and your full name.${sign}` };
      return { intent, flags, proposeSlots: true, slot: null, askedProof: thread.askedProof, text:
        `Thanks! Unfortunately that time is booked for me. Could any of these work instead (Pacific time)?\n${slotList}${sign}` };
    }
    case "proof_given":
    case "wants_viewing":
      return { intent, flags, proposeSlots: true, slot: null, askedProof: thread.askedProof, text:
        `${intent === "proof_given" ? "Thanks, that helps." : "Happy to come see it."} I can do any of these (Pacific time):\n${slotList}\nWhich one works for you?${sign}` };
    case "price": {
      const asked = rentIn(text);
      const proof = thread.askedProof ? "" : "Before anything else, could you do a quick live video walkthrough (or send a short video of the unit) and confirm you're the leaseholder? ";
      // After our counter, a price within budget (and not above the original ask) closes the deal: move to scheduling.
      if (asked && thread.deal?.offered && asked <= p.maxBudget && asked <= thread.deal.asked)
        return { intent, flags, proposeSlots: true, slot: null, askedProof: true, accepted: asked, text:
          `Deal, ${usd(asked)}/mo works for me, thank you! ${proof}I can do any of these for a viewing (Pacific time):\n${slotList}\nWhich one works for you?${sign}` };
      const counter = asked && asked > 0 ? counterOffer(asked, p.maxBudget) : null;
      return { intent, flags, proposeSlots: false, slot: null, askedProof: true, counter, text:
        `${counter ? `Thanks. My budget tops out at ${usd(p.maxBudget)}/mo; would you do ${usd(counter)}/mo for ${p.moveIn} to ${p.moveOut}? I can be flexible on move-in day. ` : ""}` +
        `${proof}Then I'd love to schedule a viewing.${sign}` };
    }
    case "question":
    case "generic":
      return { intent, flags, proposeSlots: false, slot: null, askedProof: true, text:
        `Sure! ${p.occupation}. ${p.about} Dates: ${p.moveIn} to ${p.moveOut}, ${p.pets}, ${p.smoker ? "smoker" : "non-smoker"}. ${p.references}.\n` +
        `${thread.askedProof ? "" : "Could you send a short video walkthrough or do a quick live video call, and confirm you're the leaseholder? "}Then we can set up a viewing.${sign}` };
    default: {
      const never: never = intent;
      return never;
    }
  }
}

/** Optionally rewrites the planned reply with the LLM, keeping its decisions. Safety replies are never rewritten. */
export async function writeReply(plan: ReplyPlan, landlordText: string, p: RenterProfile): Promise<string> {
  if (plan.intent === "safety" || plan.intent === "pick_slot" || plan.intent === "landlord_time" || plan.proposeSlots) return plan.text;
  const out = await complete(
    `You write short, warm, plain emails from a renter (${p.name}) to a sublet landlord. Keep every fact and decision from the DRAFT (budget cap $${p.maxBudget}/mo, the request for a live video walkthrough/proof). Never agree to pay anything before an in-person or live-video viewing and a written sublease. Answer the landlord's questions from this profile only: ${JSON.stringify(p)}. Keep it under 90 words, natural, no placeholders. Do not sign; the signature is added for you. Output only the email body.`,
    `LANDLORD SAID:\n${landlordText}\n\nDRAFT:\n${plan.text}`).catch(() => null);
  return out?.trim() ? withSignature(out, p.name) : plan.text;
}

/** Ensures exactly one sign-off with the renter's name, whatever the LLM wrote. */
export function withSignature(body: string, name: string): string {
  const lines = body.trim().split("\n");
  while (lines.length && /^(best|thanks|thank you|cheers|regards|best regards|sincerely|warmly|-+)?[,!.]?\s*$|^\s*\[?(your name|name)\]?\s*$/i.test(lines[lines.length - 1]) || (lines.length && lines[lines.length - 1].trim() === name)) lines.pop();
  return `${lines.join("\n").trim()}\n\nBest,\n${name}`;
}
