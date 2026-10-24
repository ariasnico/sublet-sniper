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
Only use ask_owner_decision for real decisions. Reply briefly (it may be spoken aloud), in the user's language (Spanish voseo if they write Spanish).
After a search, the cards already show the listings: NEVER list them in prose. Reply in at most 2 short lines: how many safe places, how many scams blocked, and one next step${state().autopilot.on ? " (say you are already writing to the landlord of the best match)" : " (e.g. ask whether to start with #1)"}.
Refer to listings as #1, #2... in the order of the latest search results.`;

export const isSpanish = (t: string) => /\b(busco|quiero|cerca|del|al|depto|departamento|habitaci|amoblad|contact|escrib|estafa|hola|por qu[eé]|estado|mostrame|dale)\w*/i.test(t);

function idx(text: string): number | null {
  const m = text.match(/#\s?(\d+)|\b(?:n[uú]mero|number|el|the)\s+(\d+)\b|\b(primer[oa]?|first)\b|\b(segund[oa]|second)\b|\b(tercer[oa]?|third)\b/i);
  if (!m) return null;
  if (m[1] || m[2]) return Number(m[1] ?? m[2]) - 1;
  return m[3] ? 0 : m[4] ? 1 : 2;
}

/** Post-search reply: max 2 short lines (the cards show the listings). */
function searchSummary(es: boolean): string {
  const s = state();
  const n = s.results.length, f = s.flagged.length;
  const first = es ? `Encontré ${n} ${n === 1 ? "lugar seguro" : "lugares seguros"} y bloqueé ${f} ${f === 1 ? "estafa" : "estafas"}.` : `Found ${n} safe ${n === 1 ? "place" : "places"} and blocked ${f} ${f === 1 ? "scam" : "scams"}.`;
  if (!s.autopilot.on) return `${first}\n${s.autopilot.decided ? (es ? "¿Arranco con el #1?" : "Shall I start with #1?") : (es ? "¿Me encargo de todo, arrancando por el #1? Tocá «Yes, go»." : "Want me to handle it end to end, starting with #1? Tap “Yes, go”.")}`;
  const target = safeMatches().find((l) => autoEmailable(l));
  const k = target ? s.results.indexOf(target) + 1 : 0;
  return `${first}\n${k ? (es ? `Ya le estoy escribiendo al dueño del #${k}.` : `I'm already writing to the landlord of #${k}.`) : (es ? "Te preparo los mensajes para Craigslist." : "I'm preparing your Craigslist replies.")}`;
}

/** Deterministic agent used when no LLM key is configured. Covers the demo flow end to end. */
async function mockAgent(text: string): Promise<string> {
  const s = state();
  const es = isSpanish(text);
  const t = text.toLowerCase();
  const pick = () => { const byId = [...s.results, ...s.flagged].find((r) => text.includes(r.id)); if (byId) return byId; const i = idx(t); if (i != null) return s.results[i]; if (/demo|mission bay/.test(t)) return s.results.find((r) => r.demo); return s.results[0]; };

  const apOff = /(apag|desactiv|fren|par[aá]|stop|turn off|disable|pause)\w*.{0,25}(piloto|autopilot)|(piloto|autopilot).{0,25}\b(off|apagado)\b|aprobar cada paso|approve each step/;
  const apOn = /(prend|activ|enable|turn on|start)\w*.{0,25}(piloto|autopilot)|(piloto|autopilot).{0,25}\b(on|activado)\b|encarg[aá]te de todo|hac[eé] todo vos|handle (it|everything)|end.to.end/;
  if (apOff.test(t) || apOn.test(t)) {
    const on = !apOff.test(t);
    const r = await setAutopilot(on);
    if (!on) return es ? "Listo, apagué el piloto automático: te pido aprobación antes de cada mensaje." : "Done, autopilot is off: I'll ask before every message.";
    return es ? `Listo, me encargo de todo.${r.emailed.length || r.drafts.length ? " Ya arranqué con los dueños." : " Decime qué buscás y arranco."}` : `On it, I'll handle everything end to end.${r.emailed.length || r.drafts.length ? " Already reaching out." : " Tell me what you need."}`;
  }
  if (/(contact|escrib|mand|send|reach out|email)/.test(t) && s.results.length) {
    const l = pick();
    if (!l) return es ? "No encontré ese número en los resultados." : "I couldn't find that result number.";
    const r = await contactListing({ id: l.id });
    if ("refused" in r) return es ? `No lo contacto: está en rojo. ${r.reason}` : `I won't contact it, it's red: ${r.reason}`;
    if ("alreadyContacted" in r) return es ? `Ya le escribí al dueño de "${l.title}"; te aviso cuando responda.` : `I already wrote to "${l.title}"; I'll tell you when they reply.`;
    if ("sent" in r && r.sent) return es ? `Listo, le escribí al dueño de "${l.title}". Te aviso apenas responda.` : `Done, I emailed the landlord of "${l.title}". I'll tell you when they reply.`;
    return es ? `Listo, dejé el primer mensaje para "${l.title}" en la cola de aprobaciones. Revisalo y aprobalo${l.source === "craigslist" ? "; como es Craigslist, te abro el reply y lo mandás vos" : ""}.`
      : `Drafted a first message for "${l.title}" in the approvals queue. Review and approve it${l.source === "craigslist" ? "; it's Craigslist, so you send it from the reply page" : ""}.`;
  }
  if (/(scam|estafa|por qu[eé]|why|red|rojo|sospech)/.test(t) && (s.results.length || s.flagged.length)) {
    const l = idx(t) != null ? pick() : s.flagged[0];
    if (!l) return es ? "No hay nada marcado." : "Nothing flagged.";
    return (es ? `"${l.title}" está en ${l.scam.light === "red" ? "rojo" : l.scam.light === "yellow" ? "amarillo" : "verde"} (${l.scam.score}/100). Razones: ` : `"${l.title}" is ${l.scam.light} (${l.scam.score}/100). Reasons: `) + l.scam.reasons.slice(0, 3).join("; ") + ".";
  }
  if (/(estado|status|novedad|update|qu[eé] pas)/.test(t)) {
    const pend = s.approvals.filter((a) => a.status === "pending").length;
    const ap = autopilotView(s);
    return es ? `Tenés ${s.threads.length} conversaciones, ${pend} aprobaciones pendientes y ${s.events.length} visitas agendadas.${ap.on ? `\nAhora: ${ap.now} Después: ${ap.next}` : ""}` : `${s.threads.length} threads, ${pend} pending approvals, ${s.events.length} viewings booked.`;
  }
  if (/(busc|find|search|sublet|depto|room|habitaci|alquil|rent|apartment|studio|cerca|near|\$|\d+k)/.test(t) || !s.results.length) {
    const r = await toolSearch({ query: text });
    if (!r.top.length) return es ? "No encontré nada que entre en esos criterios. Probá subir el presupuesto o ampliar la zona." : "Nothing matched. Try a higher budget or wider area.";
    return searchSummary(es);
  }
  return es ? "Decime qué buscás (zona, presupuesto, fechas), o pedime contactar, explicar una estafa o el estado." : "Tell me what you need (area, budget, dates), or ask me to contact a listing, explain a scam flag, or give status.";
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
    const es = /[áéíóúñ¿]|\b(es|esto|una|estafa|este|mir[aá])\b/i.test(text) || !/[a-z]{3,}/i.test(text.replace(link, ""));
    if (r.error) reply = es ? `No pude abrir ese link (${r.error}).` : `I couldn't open that link (${r.error}).`;
    else {
      const l = s.results[0]; const reasons = l.scam.reasons.slice(0, 3);
      const verdict = { red: es ? "🔴 ALTO RIESGO de estafa" : "🔴 HIGH scam risk", yellow: es ? "🟡 Precaución" : "🟡 Caution", green: es ? "🟢 Se ve legítimo" : "🟢 Looks legit" }[l.scam.light];
      reply = `${verdict} (${l.scam.score}/100): "${l.title}", ${l.priceMonthly ? `$${l.priceMonthly}/mo` : "?"}${r.address ? `, ${r.address}` : ""}.\n` + (reasons.length ? reasons.map((x) => `• ${x}`).join("\n") : es ? "• Sin señales de alerta." : "• No red flags found.") + (l.scam.light === "red" ? (es ? "\nNo mandes plata ni datos. No lo voy a contactar." : "\nDon't send money or personal info. I won't contact it.") : es ? "\n¿Querés que le escriba al dueño?" : "\nWant me to message the landlord?");
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
