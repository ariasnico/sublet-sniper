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
/** Outbound phone calls through ElevenLabs Agents (Twilio/SIP number imported in ElevenLabs). VOICE_MODE=mock forces the simulator. */
export const voiceLive = () => process.env.VOICE_MODE !== "mock" && !!process.env.ELEVENLABS_API_KEY && !!process.env.ELEVENLABS_AGENT_ID
  && !!process.env.ELEVENLABS_PHONE_NUMBER_ID && !!process.env.DEMO_LANDLORD_PHONE;
/** Calls are available: live, or the scripted simulator (VOICE_MODE=mock). */
/** In-browser agent session (presenter plays the landlord from the laptop mic): needs only the API key + agent id. */
export const browserVoiceReady = () => process.env.VOICE_MODE !== "mock" && !!process.env.ELEVENLABS_API_KEY && !!process.env.ELEVENLABS_AGENT_ID;
export const callsEnabled = () => voiceLive() || process.env.VOICE_MODE === "mock";
/** How autopilot reaches the demo landlord after the first email: AUTOPILOT_CHANNEL=call|email (default: call when calls are available). */
export const autopilotChannel = (): "call" | "email" => process.env.AUTOPILOT_CHANNEL === "email" || !callsEnabled() ? "email" : "call";
export function modes() {
  return {
    llm: llmProvider(), mail: mailLive() ? "agentmail" : "mock", calendar: calendarLive() ? "google" : "mock",
    craigslist: craigslistLive() ? "live" : "snapshot", voice: (voiceLive() ? "elevenlabs" : "mock") as "elevenlabs" | "mock", calls: callsEnabled(), browserVoice: browserVoiceReady(),
    agentInbox: process.env.AGENTMAIL_INBOX_ID || "agent@mock.local",
  };
}

/** Demo mode: whichever listing the user picks, the demo landlord (DEMO_LANDLORD_EMAIL/PHONE) plays its landlord. */
export const standIn = () => !!process.env.DEMO_LANDLORD_EMAIL && process.env.DEMO_STANDIN !== "0";
