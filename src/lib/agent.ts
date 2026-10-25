import { CL_URL, toolAnalyzeUrl } from "./tools";
import { runToolLoop, type Turn } from "./llm";
import { TOOL_DEFS, execTool, toolSearch, contactListing, brief, autopilotOutreach, autoEmailable, safeMatches, requestAutopilotConsent, setAutopilot } from "./tools";
import { autopilotView } from "./autopilot";
import { log, now, state } from "./store";

const SYSTEM = () => `You are Sublet Sniper, a voice/text agent that finds safe short-term rentals in San Francisco for ${state().profile.name}.
Today is ${new Date().toISOString().slice(0, 10)}. Use tools; never invent listings. Always mention the scam traffic light.
Rules: never pay or tell anyone to pay before an in-person/live-video viewing; Craigslist/X replies are always sent by the human (you only prepare them).
${state().autopilot.on
    ? "AUTOPILOT IS ON (the user consented once): after search_listings the system itself emails the allowlisted demo landlord and prepares Craigslist reply drafts for the top safe matches, then negotiates, asks for proof and books. Don't ask permission to contact; don't call draft_contact for those."
    : "Autopilot is OFF: contacting goes through the approvals queue (draft_contact). If the user says to handle everything, call set_autopilot {on:true}."}
Only use ask_owner_decision for real decisions. ALWAYS reply in English, even when the user writes or speaks Spanish (you understand Spanish; you answer in English). Reply briefly (it may be spoken aloud): one or two short sentences.
After a search, the cards already show the listings: NEVER list them in prose. Reply in at most 2 short lines: how many safe places, how many scams blocked, and one next step${state().autopilot.on ? " (say you are already emailing the landlord of the best match)" : " (ask which one to go after: \"Pick one and I'll handle the rest.\")"}.
Refer to listings as #1, #2... in the order of the latest search results.`;

function idx(text: string): number | null {
  const m = text.match(/#\s?(\d+)|\b(?:n[uú]mero|number|el|the)\s+(\d+)\b|\b(primer[oa]?|first)\b|\b(segund[oa]|second)\b|\b(tercer[oa]?|third)\b/i);
  if (!m) return null;
  if (m[1] || m[2]) return Number(m[1] ?? m[2]) - 1;
  return m[3] ? 0 : m[4] ? 1 : 2;
}

/** Post-search reply: max 2 short lines (the cards show the listings). */
function searchSummary(): string {
  const s = state();
  const n = s.results.length, f = s.flagged.length;
  const first = `Found ${n} safe ${n === 1 ? "place" : "places"}, blocked ${f} ${f === 1 ? "scam" : "scams"}.`;
  if (!s.autopilot.on) return `${first}\n${s.autopilot.decided ? "Start with #1?" : "Pick one and I'll handle the rest."}`;
  const target = safeMatches().find((l) => autoEmailable(l));
  const k = target ? s.results.indexOf(target) + 1 : 0;
  return `${first}\n${k ? `Emailing the landlord of #${k} now.` : "Drafting your Craigslist replies."}`;
}

/** Deterministic agent used when no LLM key is configured. Covers the demo flow end to end. Understands Spanish, answers in English. */
async function mockAgent(text: string): Promise<string> {
  const s = state();
  const t = text.toLowerCase();
  const pick = () => { const byId = [...s.results, ...s.flagged].find((r) => text.includes(r.id)); if (byId) return byId; const i = idx(t); if (i != null) return s.results[i]; if (/demo|mission bay/.test(t)) return s.results.find((r) => r.demo); return s.results[0]; };

  const apOff = /(apag|desactiv|fren|par[aá]|stop|turn off|disable|pause)\w*.{0,25}(piloto|autopilot)|(piloto|autopilot).{0,25}\b(off|apagado)\b|aprobar cada paso|approve each step/;
  const apOn = /(prend|activ|enable|turn on|start)\w*.{0,25}(piloto|autopilot)|(piloto|autopilot).{0,25}\b(on|activado)\b|encarg[aá]te de todo|hac[eé] todo vos|handle (it|everything)|end.to.end/;
  if (apOff.test(t) || apOn.test(t)) {
    const on = !apOff.test(t);
    const r = await setAutopilot(on);
    if (!on) return "Autopilot off. I'll ask before each message.";
    return `On it, end to end.${r.emailed.length || r.drafts.length ? " Already reaching out." : " Tell me what you need."}`;
  }
  if (/(contact|escrib|mand|send|reach out|email)/.test(t) && s.results.length) {
    const l = pick();
    if (!l) return "I couldn't find that result number.";
    const r = await contactListing({ id: l.id });
    if ("refused" in r) return `I won't contact it, it's red: ${r.reason}`;
    if ("alreadyContacted" in r) return "Already emailed them. I'll tell you when they reply.";
    if ("sent" in r && r.sent) return "Emailed the landlord. I'll tell you when they reply.";
    return `Draft ready for your OK${l.source === "craigslist" ? "; you send it from Craigslist" : ""}.`;
  }
  if (/(scam|estafa|por qu[eé]|why|red|rojo|sospech)/.test(t) && (s.results.length || s.flagged.length)) {
    const l = idx(t) != null ? pick() : s.flagged[0];
    if (!l) return "Nothing flagged.";
    return `"${l.title}" is ${l.scam.light} (${l.scam.score}/100). Reasons: ` + l.scam.reasons.slice(0, 3).join("; ") + ".";
  }
  if (/(estado|status|novedad|update|qu[eé] pas)/.test(t)) {
    const pend = s.approvals.filter((a) => a.status === "pending").length;
    const ap = autopilotView(s);
    return `${s.threads.length} threads, ${pend} pending, ${s.events.length} viewings booked.${ap.on ? `\nNow: ${ap.now}` : ""}`;
  }
  if (/(busc|find|search|sublet|depto|room|habitaci|alquil|rent|apartment|studio|cerca|near|\$|\d+k)/.test(t) || !s.results.length) {
    const r = await toolSearch({ query: text });
    if (!r.top.length) return "Nothing matched. Try a higher budget or wider area.";
    return searchSummary();
  }
  return "Tell me area, budget and dates, or paste a Craigslist link.";
}

export async function chat(text: string): Promise<string> {
  const s = state();
  s.chat.push({ role: "user", text, at: now() });
  const history: Turn[] = s.chat.slice(-12).map((m) => ({ role: m.role, text: m.text }));
  let reply: string | null = null;
  const link = text.match(CL_URL)?.[0];
  if (link) {
    // Deterministic: a pasted listing link is always fetched + scam-checked, no LLM needed.
    const r = await toolAnalyzeUrl({ url: link }) as Record<string, unknown> & { error?: string };
    if (r.error) reply = `I couldn't open that link (${r.error}).`;
    else {
      const l = s.results[0]; const reasons = l.scam.reasons.slice(0, 3);
      const verdict = { red: "🔴 Likely scam", yellow: "🟡 Caution", green: "🟢 Looks safe" }[l.scam.light];
      reply = `${verdict} (${l.scam.score}/100): "${l.title}", ${l.priceMonthly ? `$${l.priceMonthly}/mo` : "?"}.\n` + (reasons.length ? reasons.map((x) => `• ${x}`).join("\n") : "• No red flags.") + (l.scam.light === "red" ? "\nDon't send money. I won't contact it." : "\nWant me to message the landlord?");
    }
    s.chat.push({ role: "assistant", text: reply, at: now() });
    return reply;
  }
  const searchBefore = s.searchReport;
  try {
    const ctx = (s.results.length ? `\n\nCurrent results (#1..): ${JSON.stringify(s.results.slice(0, 8).map(brief))}` : "") + (s.flagged.length ? `\n\nRed-flagged listings (hidden from results, explain them with score_scam): ${JSON.stringify(s.flagged.slice(0, 4).map(brief))}` : "");
    reply = await runToolLoop(SYSTEM() + ctx, history, TOOL_DEFS, execTool);
  } catch (e) {
    log("info", `LLM error, using offline agent: ${(e as Error).message.slice(0, 120)}`);
  }
  reply ??= await mockAgent(text);
  s.chat.push({ role: "assistant", text: reply, at: now() });
  if (s.searchReport !== searchBefore && s.results.length) {
    // The user stated criteria: autopilot starts outreach now (narrated in chat), or we ask the one-time consent.
    if (s.autopilot.on) await autopilotOutreach();
    else requestAutopilotConsent();
  } else if (s.results.length && !s.autopilot.decided) {
    // The LLM may answer from results it already has (or this instance was hydrated): still ask once.
    requestAutopilotConsent();
  }
  return reply;
}
