/** Suggested follow-ups under the latest agent message, read from where the deal is. */
export interface FollowUp {
  /** What the row shows (and sends, unless `text` is set). */
  label: string;
  /** What gets sent to the agent, when different from the label. */
  text?: string;
  /** Answers the pending autopilot consent instead of sending text. */
  consent?: boolean;
  /** Puts this in the composer and focuses it instead of sending. */
  prefill?: string;
  /** Switches the Places column to this tab as well. */
  tab?: "ranked" | "flagged";
}

export interface FollowUpInput {
  stage?: string;
  results: { id: string }[];
  flagged: unknown[];
  threads: { status: string }[];
  events: unknown[];
  consentPending: boolean;
}

export const FIRST_SEARCH = "Busco 1BR amoblado en SF, menos de $4000, del 1/11 al 15/12";
const SCAM_HOW = "¿Cómo detectás un scam?";

export function followUpsFor(x: FollowUpInput): FollowUp[] {
  const booked = x.events.length > 0 || x.stage === "booked" || x.threads.some((t) => t.status === "booked");
  const scams: FollowUp = x.flagged.length ? { label: "Mostrame las estafas que bloqueaste", tab: "flagged" } : { label: SCAM_HOW };
  if (booked) return [{ label: "Agregá la visita a mi calendario" }, { label: "¿Qué tengo que llevar a la visita?" }, { label: "¿Cuánto me ahorraste?" }];
  if (x.consentPending) return [{ label: "Sí, encargate de todo", consent: true }, scams, { label: "¿Por qué el #1 es el mejor?" }];
  const talking = x.threads.length > 0 || ["outreach", "waiting", "negotiating", "scheduling"].includes(x.stage ?? "");
  if (talking) return [{ label: "¿Qué le escribiste al dueño?" }, { label: "Pegá un link de Craigslist para revisarlo", prefill: "Revisá este aviso: " }, { label: "¿Cómo va la negociación?" }];
  const top = x.results[0];
  if (top) return [{ label: "¿Por qué el #1 es el mejor?" }, scams, { label: "Contactá al #1", text: `Contactá el listing ${top.id}` }];
  return [{ label: FIRST_SEARCH }, { label: "Furnished room near Caltrain under $2,500" }, { label: SCAM_HOW }];
}
