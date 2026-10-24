import { runToolLoop, type Turn } from "./llm";
import { TOOL_DEFS, execTool, toolSearch, toolDraftContact, brief } from "./tools";
import { log, now, state } from "./store";

const SYSTEM = () => `You are Sublet Sniper, a voice/text agent that finds safe short-term rentals in San Francisco for ${state().profile.name}.
Today is ${new Date().toISOString().slice(0, 10)}. Use tools; never invent listings. Always mention the scam traffic light.
Rules: never pay or tell anyone to pay before an in-person/live-video viewing; never contact anyone without an approval in the queue (draft_contact);
Craigslist replies are sent by the human. Only use ask_owner_decision for real decisions. Reply briefly (2-5 sentences, it may be spoken aloud), in the user's language (Spanish voseo if they write Spanish).
Refer to listings as #1, #2... in the order of the latest search results.`;

export const isSpanish = (t: string) => /\b(busco|quiero|cerca|del|al|depto|departamento|habitaci|amoblad|contact|escrib|estafa|hola|por qu[eé]|estado|mostrame|dale)\w*/i.test(t);

function idx(text: string): number | null {
  const m = text.match(/#\s?(\d+)|\b(?:n[uú]mero|number|el|the)\s+(\d+)\b|\b(primer[oa]?|first)\b|\b(segund[oa]|second)\b|\b(tercer[oa]?|third)\b/i);
  if (!m) return null;
  if (m[1] || m[2]) return Number(m[1] ?? m[2]) - 1;
  return m[3] ? 0 : m[4] ? 1 : 2;
}

/** Deterministic agent used when no LLM key is configured. Covers the demo flow end to end. */
async function mockAgent(text: string): Promise<string> {
  const s = state();
  const es = isSpanish(text);
  const t = text.toLowerCase();
  const pick = () => { const byId = [...s.results, ...s.flagged].find((r) => text.includes(r.id)); if (byId) return byId; const i = idx(t); if (i != null) return s.results[i]; if (/demo|mission bay/.test(t)) return s.results.find((r) => r.demo); return s.results[0]; };

  if (/(contact|escrib|mand|send|reach out|email)/.test(t) && s.results.length) {
    const l = pick();
    if (!l) return es ? "No encontré ese número en los resultados." : "I couldn't find that result number.";
    const r = toolDraftContact({ id: l.id });
    if ("refused" in r) return es ? `No lo contacto: está en rojo. ${r.reason}` : `I won't contact it, it's red: ${r.reason}`;
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
    return es ? `Tenés ${s.threads.length} conversaciones, ${pend} aprobaciones pendientes y ${s.events.length} visitas agendadas.` : `${s.threads.length} threads, ${pend} pending approvals, ${s.events.length} viewings booked.`;
  }
  if (/(busc|find|search|sublet|depto|room|habitaci|alquil|rent|apartment|studio|cerca|near|\$|\d+k)/.test(t) || !s.results.length) {
    const r = await toolSearch({ query: text });
    const top = r.top.slice(0, 3);
    if (!top.length) return es ? "No encontré nada que entre en esos criterios. Probá subir el presupuesto o ampliar la zona." : "Nothing matched. Try a higher budget or wider area.";
    const lines = top.map((x, i) => `#${i + 1} ${x.title} ($${x.price ?? "?"}/mo${x.km != null ? `, ${x.km} km` : ""}, ${x.light})`).join(es ? "; " : "; ");
    const fl = r.flagged[0];
    return es ? `Encontré ${r.top.length} buenas opciones (Craigslist ${r.mode === "live" ? "en vivo" : "snapshot"}). ${lines}. ${fl ? `Ojo: "${fl.title}" está en rojo: ${fl.scamReasons[0]}.` : ""} ¿Querés que contacte al #1?`
      : `Found ${r.top.length} good options (Craigslist ${r.mode}). ${lines}. ${fl ? `Heads up: "${fl.title}" is red: ${fl.scamReasons[0]}.` : ""} Want me to contact #1?`;
  }
  return es ? "Decime qué buscás (zona, presupuesto, fechas), o pedime contactar, explicar una estafa o el estado." : "Tell me what you need (area, budget, dates), or ask me to contact a listing, explain a scam flag, or give status.";
}

export async function chat(text: string): Promise<string> {
  const s = state();
  s.chat.push({ role: "user", text, at: now() });
  const history: Turn[] = s.chat.slice(-12).map((m) => ({ role: m.role, text: m.text }));
  let reply: string | null = null;
  try {
    const ctx = s.results.length ? `\n\nCurrent results: ${JSON.stringify(s.results.slice(0, 8).map(brief))}` : "";
    reply = await runToolLoop(SYSTEM() + ctx, history, TOOL_DEFS, execTool);
  } catch (e) {
    log("info", `LLM error, using offline agent: ${(e as Error).message.slice(0, 120)}`);
  }
  reply ??= await mockAgent(text);
  s.chat.push({ role: "assistant", text: reply, at: now() });
  return reply;
}
