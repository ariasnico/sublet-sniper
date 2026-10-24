import { complete } from "./llm";
import { fmtLA } from "./time";
import type { RenterProfile, Thread } from "./store";
import type { Slot } from "./calendar";

export const RED_FLAGS: { re: RegExp; label: string }[] = [
  { re: /\b(out of (the )?(country|town|state)|overseas|abroad|missionary|deployed|fuera del pa[ií]s)\b/i, label: "Landlord says they are out of the country" },
  { re: /\bzelle\b/i, label: "Asks for Zelle (no buyer protection)" },
  { re: /\b(wire|wiring|western union|moneygram|bank transfer)\b/i, label: "Asks for a wire / money transfer" },
  { re: /\b(gift ?cards?|bitcoin|crypto|usdt|cash ?app|venmo)\b/i, label: "Asks for gift cards / crypto / P2P app" },
  { re: /\b(deposit|first (and|&) last|holding fee|reserve|application fee)\b.{0,80}\b(before|prior|to hold|now|today|first|asap|secure)\b|\b(before|prior to)\b.{0,40}\b(viewing|showing|seeing|tour)\b.{0,60}\b(deposit|pay|send)\b/i, label: "Wants money before an in-person viewing" },
  { re: /\b(keys? (will be )?(mailed|shipped|sent)|airbnb (will|to) (hold|handle)|courier)\b/i, label: "Keys by mail / third-party escrow story" },
];

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
    subject: `Re: ${title}`,
    text: `Hi! I'm ${p.name}. I saw your listing "${title}"${price ? ` ($${price.toLocaleString("en-US")}/mo)` : ""} and I'm very interested.\n\n` +
      `About me: ${p.occupation}. ${p.about}\nDates: ${p.moveIn} to ${p.moveOut}. ${p.pets}, ${p.smoker ? "smoker" : "non-smoker"}. ${p.references}.\n\n` +
      `Is it still available? Could we do a quick live video walkthrough or an in-person viewing this week?\n\nThanks,\n${p.name}\n(sent by my rental assistant, I review every message)`,
  };
}

export type Intent = "safety" | "pick_slot" | "wants_viewing" | "proof_given" | "price" | "question" | "generic";

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

export function classify(text: string, thread: Thread): Intent {
  if (detectRedFlags(text).length) return "safety";
  if (thread.offeredSlots?.length && pickSlot(text, thread.offeredSlots.map((s) => JSON.parse(s) as Slot))) return "pick_slot";
  if (/(video|walkthrough|facetime|tour link|photos? of (the )?(id|lease)|youtube|loom|proof|deed|id attached)/i.test(text)) return "proof_given";
  if (/(when can you|come (see|by)|viewing|showing|visit|stop by)/i.test(text)) return "wants_viewing";
  if (/\$\s?\d|price|rent|firm|negotiable/i.test(text)) return "price";
  if (/\?/.test(text)) return "question";
  return "generic";
}

export interface ReplyPlan { intent: Intent; text: string; flags: string[]; proposeSlots: boolean; slot: Slot | null; askedProof: boolean }

function priceIn(text: string): number | null {
  const m = text.replace(/,/g, "").match(/\$\s?(\d{3,5})/);
  return m ? Number(m[1]) : null;
}

/** Deterministic reply planner. Safety rules always run here, even when an LLM writes the wording. */
export function planReply(text: string, thread: Thread, p: RenterProfile, slots: Slot[]): ReplyPlan {
  const intent = classify(text, thread);
  const flags = detectRedFlags(text);
  const slotList = slots.map((s, i) => `${i + 1}) ${fmtLA(s.start)}`).join("\n");
  const sign = `\n\n${p.name}`;
  switch (intent) {
    case "safety":
      return { intent, flags, proposeSlots: false, slot: null, askedProof: thread.askedProof, text:
        `Thanks for the reply. I don't send any deposit, Zelle, wire or other payment before seeing the place in person (or on a live video call) and signing a written sublease. California also caps move-in payments (AB 12). If that works for you, happy to keep going; otherwise I'll pass.${sign}` };
    case "pick_slot": {
      const slot = pickSlot(text, thread.offeredSlots?.map((s) => JSON.parse(s) as Slot));
      return { intent, flags, proposeSlots: false, slot, askedProof: thread.askedProof, text:
        `Great, ${slot ? fmtLA(slot.start) : "that time"} works. I'm confirming it on my calendar now. Please send the exact address and unit number, and your full name so I know who to ask for.${sign}` };
    }
    case "proof_given":
    case "wants_viewing":
      return { intent, flags, proposeSlots: true, slot: null, askedProof: thread.askedProof, text:
        `${intent === "proof_given" ? "Thanks for the tour, looks great." : "Happy to come see it."} I can do any of these (Pacific time):\n${slotList}\nWhich one works for you?${sign}` };
    case "price": {
      const asked = priceIn(text);
      const counter = asked && asked > p.maxBudget ? p.maxBudget : asked && asked > 0 ? Math.round((asked * 0.95) / 50) * 50 : null;
      return { intent, flags, proposeSlots: false, slot: null, askedProof: true, text:
        `${counter ? `Thanks. My budget tops out at $${p.maxBudget.toLocaleString("en-US")}/mo; would you do $${counter.toLocaleString("en-US")}/mo for ${p.moveIn} to ${p.moveOut}? I can be flexible on move-in day. ` : ""}` +
        `${thread.askedProof ? "" : "Before anything else, could you do a quick live video walkthrough (or send a short video of the unit) and confirm you're the leaseholder? "}Then I'd love to schedule a viewing.${sign}` };
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
  if (plan.intent === "safety" || plan.intent === "pick_slot" || plan.proposeSlots) return plan.text;
  const out = await complete(
    `You write short, warm, plain emails from a renter (${p.name}) to a sublet landlord. Keep every fact and decision from the DRAFT (budget cap $${p.maxBudget}/mo, the request for a live video walkthrough/proof). Never agree to pay anything before an in-person or live-video viewing and a written sublease. Answer the landlord's questions from this profile only: ${JSON.stringify(p)}. Output only the email body.`,
    `LANDLORD SAID:\n${landlordText}\n\nDRAFT:\n${plan.text}`).catch(() => null);
  return out?.trim() || plan.text;
}
