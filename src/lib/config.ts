/** Which integrations run live vs mock. Real mode turns on when the env var exists. Never exposes values. */
export type Provider = "anthropic" | "xai" | "openai" | "mock";
export function llmProvider(): Provider {
  const forced = process.env.LLM_PROVIDER;
  if (forced === "mock" || forced === "anthropic" || forced === "xai" || forced === "openai") return forced;
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  if (process.env.XAI_API_KEY) return "xai";
  if (process.env.OPENAI_API_KEY) return "openai";
  return "mock";
}
export const mailLive = () => process.env.MAIL_MODE !== "mock" && !!process.env.AGENTMAIL_API_KEY && !!process.env.AGENTMAIL_INBOX_ID;
export const calendarLive = () => process.env.CALENDAR_MODE !== "mock" && !!process.env.GOOGLE_CLIENT_ID && !!process.env.GOOGLE_CLIENT_SECRET && !!process.env.GOOGLE_REFRESH_TOKEN;
export const craigslistLive = () => process.env.CRAIGSLIST_LIVE !== "0";
export function modes() {
  return {
    llm: llmProvider(), mail: mailLive() ? "agentmail" : "mock", calendar: calendarLive() ? "google" : "mock",
    craigslist: craigslistLive() ? "live" : "snapshot", voice: process.env.NEXT_PUBLIC_ELEVENLABS_AGENT_ID ? "elevenlabs+browser" : "browser",
    agentInbox: process.env.AGENTMAIL_INBOX_ID || "agent@mock.local",
  };
}
