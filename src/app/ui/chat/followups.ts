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

export const FIRST_SEARCH = "Furnished 1BR in SF under $4,000, Nov 1 to Dec 15";
const SCAM_HOW = "How do you spot a scam?";

export function followUpsFor(x: FollowUpInput): FollowUp[] {
  const booked = x.events.length > 0 || x.stage === "booked" || x.threads.some((t) => t.status === "booked");
  const scams: FollowUp = x.flagged.length ? { label: "Show me the scams you blocked", tab: "flagged" } : { label: SCAM_HOW };
  if (booked) return [{ label: "Add the viewing to my calendar" }, { label: "What should I bring to the viewing?" }, { label: "How much did you save me?" }];
  if (x.consentPending) return [{ label: "Why is #1 the best?" }, scams]; // the consent itself is the buttons above
  const talking = x.threads.length > 0 || ["outreach", "waiting", "negotiating", "scheduling"].includes(x.stage ?? "");
  if (talking) return [{ label: "What did you tell the landlord?" }, { label: "Check a Craigslist link", prefill: "Check this listing: " }, { label: "How is the negotiation going?" }];
  const top = x.results[0];
  if (top) return [{ label: "Why is #1 the best?" }, scams, { label: "Contact #1", text: `Contact listing ${top.id}` }];
  return [{ label: FIRST_SEARCH }, { label: "Furnished room near Caltrain under $2,500" }, { label: SCAM_HOW }];
}
