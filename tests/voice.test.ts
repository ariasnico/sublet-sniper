import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { createHmac } from "node:crypto";

const sent = vi.hoisted(() => [] as { to: string; text: string }[]);
vi.mock("@/lib/mail", async (importOriginal) => {
  const m = await importOriginal<typeof import("@/lib/mail")>();
  return { ...m, sendMail: async (to: string, subject: string, text: string, replyTo?: string) => { sent.push({ to, text }); return m.sendMail(to, subject, text, replyTo); } };
});

import { chat } from "@/lib/agent";
import { phoneAllowed, normalizePhone } from "@/lib/landlord";
import { resetState, state, type Thread } from "@/lib/store";
import { resolveApproval, sendContact } from "@/lib/tools";
import { callTarget, handleTool, startCall, verifySignature } from "@/lib/voice";
import { autopilotChannel, callsEnabled, modes, voiceLive } from "@/lib/config";
import { POST as webhook } from "@/app/api/voice/webhook/route";
import { POST as toolRoute } from "@/app/api/voice/tool/route";

const SEARCH = "Busco 1BR amoblado en SF, menos de $4000, del 1/11 al 15/12";
const PHONE = "+15555550123";

async function demoThread(): Promise<Thread> {
  await chat(SEARCH);
  const r = await sendContact("demo-mission-bay", "landlord-demo@example.com", "[Sublet Sniper demo] Furnished 1BR", "Hi!");
  if (!("ok" in r)) throw new Error("no thread");
  return state().threads.find((t) => t.id === r.threadId)!;
}

const sign = (body: string, secret: string, t = Math.floor(Date.now() / 1000)) => `t=${t},v0=${createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")}`;

describe("phone allowlist", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("only DEMO_LANDLORD_PHONE and DEMO_ALLOWED_PHONES, in any format", () => {
    vi.stubEnv("DEMO_LANDLORD_PHONE", PHONE);
    vi.stubEnv("DEMO_ALLOWED_PHONES", "(415) 555-0199, ");
    expect(phoneAllowed("+1 555 555 0123")).toBe(true);
    expect(phoneAllowed("555-555-0123")).toBe(true);
    expect(phoneAllowed("+14155550199")).toBe(true);
    expect(phoneAllowed("+14155550100")).toBe(false);
    expect(phoneAllowed("")).toBe(false);
    expect(normalizePhone("(555) 555-0123")).toBe(PHONE);
  });
  it("nobody is callable when DEMO_LANDLORD_PHONE is unset", () => {
    vi.stubEnv("DEMO_LANDLORD_PHONE", "");
    vi.stubEnv("DEMO_ALLOWED_PHONES", "");
    expect(phoneAllowed(PHONE)).toBe(false);
  });
  it("voice is live only with every key; mock mode never dials", () => {
    vi.stubEnv("ELEVENLABS_API_KEY", "k"); vi.stubEnv("ELEVENLABS_AGENT_ID", "a"); vi.stubEnv("ELEVENLABS_PHONE_NUMBER_ID", "p"); vi.stubEnv("DEMO_LANDLORD_PHONE", PHONE);
    vi.stubEnv("VOICE_MODE", "");
    expect(voiceLive()).toBe(true);
    expect(modes().voice).toBe("elevenlabs");
    vi.stubEnv("ELEVENLABS_PHONE_NUMBER_ID", "");
    expect(voiceLive()).toBe(false);
    vi.stubEnv("VOICE_MODE", "mock");
    expect(modes().voice).toBe("mock");
    expect(callsEnabled()).toBe(true);
    expect(autopilotChannel()).toBe("call");
    vi.stubEnv("AUTOPILOT_CHANNEL", "email");
    expect(autopilotChannel()).toBe("email");
  });
});

describe("voice calls (mock)", () => {
  beforeEach(() => { resetState(); sent.length = 0; vi.stubEnv("VOICE_MODE", "mock"); vi.stubEnv("VOICE_MOCK_STEP_MS", "0"); vi.stubEnv("DEMO_LANDLORD_PHONE", PHONE); });
  afterEach(() => vi.unstubAllEnvs());

  it("never calls a Craigslist landlord or a non-allowlisted number", async () => {
    const t = await demoThread();
    const cl = state().results.find((r) => r.source === "craigslist")?.id ?? "cl-x";
    // Demo stand-in: a picked Craigslist listing is played by the allowlisted demo landlord, never its real poster.
    expect(callTarget({ ...t, listingId: cl })).toMatchObject({ to: "+15555550123" });
    expect(callTarget({ ...t, listingId: cl, landlordEmail: "real-poster@example.com" })).toMatchObject({ error: expect.any(String) });
    vi.stubEnv("DEMO_STANDIN", "0");
    expect(callTarget({ ...t, listingId: cl })).toMatchObject({ error: expect.any(String) });
    vi.stubEnv("DEMO_LANDLORD_PHONE", "");
    expect(await startCall(t)).toMatchObject({ error: expect.stringMatching(/DEMO_LANDLORD_PHONE/) });
    expect(state().calls).toHaveLength(0);
  });

  it("book_viewing tool books the spoken time and refuses rent above the budget", async () => {
    const t = await demoThread();
    const over = await handleTool({ tool: "book_viewing", thread_id: t.id, spoken_time: "Monday 5:30 PM", agreed_rent: 4200 });
    expect(over.ok).toBe(false);
    expect(over.result).toMatch(/\$4,000/);
    expect(state().events).toHaveLength(0);
    const ok = await handleTool({ tool: "book_viewing", thread_id: t.id, spoken_time: "Monday 5:30 PM", agreed_rent: 3600 });
    expect(ok.ok).toBe(true);
    expect(ok.result).toMatch(/Monday, \w+ \d+ at 5:30 PM Pacific at \$3,600 a month/);
    expect(t.status).toBe("booked");
    expect(t.deal?.agreed).toBe(3600);
    expect(state().events).toHaveLength(1);
  });

  it("REQUIRE_BOOKING_APPROVAL=1: the call only pencils it in", async () => {
    vi.stubEnv("REQUIRE_BOOKING_APPROVAL", "1");
    const t = await demoThread();
    const r = await handleTool({ tool: "book_viewing", thread_id: t.id, spoken_time: "Monday 5:30 PM", agreed_rent: 3600 });
    expect(r.result).toMatch(/Penciled in/);
    expect(state().events).toHaveLength(0);
    expect(state().approvals.some((a) => a.kind === "book_viewing" && a.status === "pending")).toBe(true);
  });

  it("autopilot 'Yes, go' emails then phones the demo landlord; the scripted call refuses Zelle, lands $3,600, books Monday 5:30 PM", async () => {
    await chat(SEARCH);
    const consent = state().approvals.find((a) => a.kind === "autopilot_consent")!;
    await resolveApproval(consent.id, true, "Yes, go");
    const s = state();
    expect(s.calls).toHaveLength(1);
    expect(s.chat.some((c) => c.text === "📞 Calling the landlord…")).toBe(true);
    await vi.waitFor(() => expect(s.calls[0].status).toBe("done"), { timeout: 3000 });
    const t = s.threads.find((x) => x.id === s.calls[0].threadId)!;
    const call = t.messages.filter((m) => m.channel === "call");
    expect(call.length).toBeGreaterThan(8);
    expect(call.find((m) => /Zelle/.test(m.text))?.flagged?.length).toBeGreaterThan(0);
    expect(t.deal).toMatchObject({ asked: 3800, offered: 3400, agreed: 3600 });
    expect(t.status).toBe("booked");
    expect(s.events[0] && new Date(s.events[0].start).toLocaleString("en-US", { timeZone: "America/Los_Angeles", weekday: "short", hour: "numeric", minute: "2-digit" })).toBe("Mon 5:30 PM");
    expect(s.chat.map((c) => c.text).join("\n")).toMatch(/📞 Call done: \$3,600 agreed, viewing Mon 5:30 PM\. Refused a Zelle deposit\./);
    // Recap reply on the mail thread (persists the deal + booking for other serverless instances).
    expect(sent.at(-1)?.text).toMatch(/Thanks for the call![\s\S]*\$3,600\/mo[\s\S]*on my calendar/);
    expect(sent.every((m) => m.to === "landlord-demo@example.com")).toBe(true);
  });
});

describe("voice webhooks", () => {
  beforeEach(() => { resetState(); sent.length = 0; vi.stubEnv("VOICE_MODE", "mock"); vi.stubEnv("VOICE_MOCK_STEP_MS", "100000"); vi.stubEnv("DEMO_LANDLORD_PHONE", PHONE); vi.stubEnv("ELEVENLABS_WEBHOOK_SECRET", "whsec_test"); });
  afterEach(() => vi.unstubAllEnvs());

  it("verifySignature: valid, tampered, stale, wrong secret", () => {
    const body = '{"type":"post_call_transcription"}';
    expect(verifySignature(body, sign(body, "s"), "s")).toBe(true);
    expect(verifySignature(body + " ", sign(body, "s"), "s")).toBe(false);
    expect(verifySignature(body, sign(body, "s", Math.floor(Date.now() / 1000) - 3600), "s")).toBe(false);
    expect(verifySignature(body, sign(body, "x"), "s")).toBe(false);
    expect(verifySignature(body, null, "s")).toBe(false);
  });

  it("post-call webhook: rejects bad signatures, stores the transcript, flags and deal", async () => {
    const t = await demoThread();
    const r = await startCall(t);
    if ("error" in r) throw new Error(r.error);
    r.call.agreed = undefined;
    const payload = JSON.stringify({ type: "post_call_transcription", event_timestamp: Math.floor(Date.now() / 1000), data: {
      conversation_id: "conv_1", status: "done",
      transcript: [
        { role: "agent", message: "Hi, I'm an AI assistant calling for Nicolás.", time_in_call_secs: 0 },
        { role: "user", message: "It's $3,800 a month and I need a Zelle deposit today.", time_in_call_secs: 6 },
        { role: "agent", message: "No payment before a viewing. Would you do $3,400 a month?", time_in_call_secs: 12 },
        { role: "user", message: "I can do 3,600 a month.", time_in_call_secs: 18 },
      ],
      analysis: { transcript_summary: "Agreed $3,600.", call_successful: "success", data_collection_results: { agreed_rent: { value: 3600 } } },
      conversation_initiation_client_data: { dynamic_variables: { call_id: r.call.id, thread_id: t.id } } } });
    const bad = await webhook(new Request("http://x/api/voice/webhook", { method: "POST", body: payload, headers: { "elevenlabs-signature": sign(payload, "nope") } }));
    expect(bad.status).toBe(401);
    expect(r.call.status).toBe("calling");
    const ok = await webhook(new Request("http://x/api/voice/webhook", { method: "POST", body: payload, headers: { "elevenlabs-signature": sign(payload, "whsec_test") } }));
    expect(ok.status).toBe(200);
    expect(r.call.status).toBe("done");
    const msgs = t.messages.filter((m) => m.channel === "call");
    expect(msgs.map((m) => m.from)).toEqual(["agent", "landlord", "agent", "landlord"]);
    expect(msgs[1].flagged).toContain("Asks for Zelle (no buyer protection)");
    expect(t.deal).toMatchObject({ asked: 3800, offered: 3400, agreed: 3600 });
    expect(state().chat.at(-1)?.text).toMatch(/📞 Call done: \$3,600 agreed/);
  });

  it("tool route requires the token when WEBHOOK_TOKEN is set", async () => {
    vi.stubEnv("WEBHOOK_TOKEN", "tok");
    const t = await demoThread();
    const body = JSON.stringify({ tool: "get_free_slots", thread_id: t.id });
    expect((await toolRoute(new Request("http://x/api/voice/tool", { method: "POST", body }))).status).toBe(403);
    const ok = await toolRoute(new Request("http://x/api/voice/tool?token=tok", { method: "POST", body }));
    expect(((await ok.json()) as { result: string }).result).toMatch(/Free times/);
  });
});

describe("spoken times from the voice agent", () => {
  it("turns words into digits the window parser understands", async () => {
    const { spokenTimeToDigits } = await import("../src/lib/voice");
    expect(spokenTimeToDigits("Monday six PM")).toBe("monday 6pm");
    expect(spokenTimeToDigits("Monday five thirty p.m.")).toBe("monday 5:30pm");
    expect(spokenTimeToDigits("tomorrow at noon")).toBe("tomorrow at 12pm");
  });
});
