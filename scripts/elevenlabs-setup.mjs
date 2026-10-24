#!/usr/bin/env node
/**
 * Creates (or updates) the "Sublet Sniper caller" ElevenLabs agent plus its webhook tools.
 *
 *   node --env-file=.env.local scripts/elevenlabs-setup.mjs            # create/update
 *   node --env-file=.env.local scripts/elevenlabs-setup.mjs --dry-run  # print the payloads, call nothing
 *
 * Needs: ELEVENLABS_API_KEY, APP_URL (public https URL of the app, e.g. https://sublet-sniper.vercel.app), WEBHOOK_TOKEN.
 * Optional: ELEVENLABS_AGENT_ID (update that agent instead of creating one), ELEVENLABS_VOICE_ID, ELEVENLABS_LLM (default gpt-4.1).
 * Never prints the API key or the webhook token.
 */
const DRY = process.argv.includes("--dry-run");
const API = process.env.ELEVENLABS_API_BASE || "https://api.elevenlabs.io";
const KEY = process.env.ELEVENLABS_API_KEY ?? "";
const APP = (process.env.APP_URL ?? "").replace(/\/+$/, "");
const TOKEN = process.env.WEBHOOK_TOKEN ?? "";
const AGENT_ID = process.env.ELEVENLABS_AGENT_ID ?? "";
const RENTER = process.env.RENTER_NAME || "Nicolás Arias";
const FIRST = RENTER.split(" ")[0];

function need(ok, msg) { if (!ok) { console.error(`Missing: ${msg}`); process.exit(1); } }
if (!DRY) { need(KEY, "ELEVENLABS_API_KEY"); need(/^https:\/\//.test(APP), "APP_URL (public https URL)"); need(TOKEN, "WEBHOOK_TOKEN"); }

const toolUrl = (name) => `${APP || "https://YOUR-APP"}/api/voice/tool?token=${DRY ? "<WEBHOOK_TOKEN>" : encodeURIComponent(TOKEN)}&tool=${name}`;
const redact = (o) => JSON.parse(JSON.stringify(o, (k, v) => (typeof v === "string" && TOKEN && v.includes(TOKEN) ? v.replaceAll(TOKEN, "<WEBHOOK_TOKEN>") : v)));
const dyn = (name) => ({ type: "string", dynamic_variable: name });

const TOOLS = [
  {
    type: "webhook", name: "book_viewing", response_timeout_secs: 15,
    description: "Book the viewing on the renter's calendar once the landlord agreed a day and time (and the rent). Call it once, after reading the time back and getting a yes. Speak the result back to the landlord.",
    api_schema: {
      url: toolUrl("book_viewing"), method: "POST", request_headers: { "x-voice-token": DRY ? "<WEBHOOK_TOKEN>" : TOKEN },
      request_body_schema: {
        type: "object", description: "Viewing booking",
        properties: {
          tool: { type: "string", constant_value: "book_viewing" },
          spoken_time: { type: "string", description: "Agreed day and time in Pacific time, as words, e.g. 'Monday 5:30 PM' or 'tomorrow 6 PM'." },
          start_iso: { type: "string", description: "Same time as ISO 8601 with the Pacific offset if you are sure, e.g. 2026-10-26T17:30:00-07:00. Optional." },
          agreed_rent: { type: "number", description: "Monthly rent agreed on the call in US dollars, e.g. 3600. Never above the budget." },
          notes: { type: "string", description: "Anything else agreed (video tour, leaseholder proof). Optional." },
          call_id: dyn("call_id"), thread_id: dyn("thread_id"), am_thread_id: dyn("am_thread_id"), listing_id: dyn("listing_id"),
        },
        required: ["spoken_time", "agreed_rent"],
      },
    },
  },
  {
    type: "webhook", name: "get_free_slots", response_timeout_secs: 10,
    description: "Get the renter's next free viewing times (Pacific). Use it when the landlord asks when the renter is available.",
    api_schema: {
      url: toolUrl("get_free_slots"), method: "POST", request_headers: { "x-voice-token": DRY ? "<WEBHOOK_TOKEN>" : TOKEN },
      request_body_schema: { type: "object", description: "Free slots request", properties: { tool: { type: "string", constant_value: "get_free_slots" }, call_id: dyn("call_id") }, required: [] },
    },
  },
];

const PROMPT = [
  `You are Sniper, ${FIRST}'s AI rental assistant. You are on a PHONE CALL with {{landlord_name}}, who listed "{{listing_title}}" at \${{listed_rent}}/month. You call on behalf of the renter, {{renter_name}}. Today is {{today}} (Pacific time).`,
  "",
  "# Voice style",
  "- 1 or 2 short, warm sentences per turn. Ask one thing at a time. Never read lists or long numbers in one breath. Let them interrupt.",
  "- Confirm every number and date back (\"So $3,600 a month, from November 1st, right?\").",
  "- If asked, always say you are an AI assistant. Never pretend to be human.",
  "",
  "# Goals, in order",
  "1. Confirm it is still available for {{move_in}} to {{move_out}}.",
  "2. Negotiate the rent. Open around \${{target_rent}}/month. Concede in small steps only when given a reason. NEVER agree above \${{max_budget}}/month. If they will not go to \${{max_budget}} or less, thank them and end the call.",
  "3. Ask for a live video walkthrough (or in-person viewing) and for confirmation that they are the leaseholder or owner.",
  "4. Agree a viewing time. Free times: {{free_slots}} (or call get_free_slots). Read the day, time and rent back, get a yes, then call book_viewing with spoken_time and agreed_rent. Read the booked time from the tool result back to them.",
  "5. Recap briefly, thank them, say a confirmation email follows, then call end_call.",
  "",
  "# Hard rules",
  `- No deposit, Zelle, wire, Venmo, Cash App, crypto, gift cards or application fee before an in-person or live-video viewing AND a written sublease. Politely refuse and restate: "${FIRST} doesn't send any payment before a viewing and a written sublease."`,
  `- Never share ${FIRST}'s SSN, bank, card or ID details. Never invent facts; say "I'll check with ${FIRST} and follow up by email."`,
  "- If they are hostile, push for payment again, or it is clearly a scam (out of the country, keys by mail), say goodbye and call end_call.",
  "- On voicemail, leave a 15-second message (who you are, the listing, that a follow-up email is coming) and end.",
].join("\n");

const FIRST_MESSAGE = `Hi, is this {{landlord_name}}? I'm an AI assistant calling on behalf of {{renter_name}} about your listing, {{listing_title}}, at \${{listed_rent}} a month. This call may be recorded. Do you have two minutes?`;

const PLACEHOLDERS = { landlord_name: "there", listing_title: "Furnished 1BR sublet near Caltrain", listed_rent: 3600, target_rent: 3400, max_budget: 4000,
  renter_name: RENTER, renter_first_name: FIRST, move_in: "November 1", move_out: "December 15", free_slots: "Monday 6:00 PM PT", today: "Saturday, October 24, 2026",
  call_id: "test", thread_id: "", am_thread_id: "", listing_id: "demo-mission-bay" };

function agentBody(toolIds, withDataCollection = true) {
  return {
    name: "Sublet Sniper caller", tags: ["sublet-sniper"],
    conversation_config: {
      agent: {
        language: "en", first_message: FIRST_MESSAGE,
        dynamic_variables: { dynamic_variable_placeholders: PLACEHOLDERS },
        prompt: {
          prompt: PROMPT, llm: process.env.ELEVENLABS_LLM || "gpt-4.1", temperature: 0.3, tool_ids: toolIds,
          built_in_tools: {
            end_call: { type: "system", name: "end_call", description: "", params: { system_tool_type: "end_call" } },
            voicemail_detection: { type: "system", name: "voicemail_detection", description: "", params: { system_tool_type: "voicemail_detection",
              voicemail_message: `Hi, this is an AI assistant calling for {{renter_name}} about your listing, {{listing_title}}. ${FIRST} is very interested and will follow up by email. Thanks!` } },
          },
        },
      },
      turn: { turn_timeout: 7 },
      ...(process.env.ELEVENLABS_VOICE_ID ? { tts: { voice_id: process.env.ELEVENLABS_VOICE_ID } } : {}),
    },
    ...(withDataCollection ? { platform_settings: { data_collection: {
      agreed_rent: { type: "number", description: "Monthly rent in USD the landlord agreed to on the call. Empty if none." },
      viewing_time: { type: "string", description: "Viewing day and time agreed on the call, in Pacific time. Empty if none." },
      asked_for_payment: { type: "boolean", description: "True if the landlord asked for any deposit or payment before a viewing." },
    } } } : {}),
  };
}

async function el(path, init = {}) {
  const res = await fetch(`${API}${path}`, { ...init, headers: { "xi-api-key": KEY, "content-type": "application/json" } });
  const text = await res.text();
  let j = {}; try { j = JSON.parse(text); } catch { /* not json */ }
  if (!res.ok) { const err = new Error(`${init.method ?? "GET"} ${path} -> ${res.status} ${JSON.stringify(j.detail ?? text).slice(0, 400)}`); err.status = res.status; throw err; }
  return j;
}

async function upsertTool(cfg, existing) {
  const found = existing.find((t) => t?.tool_config?.name === cfg.name && t?.tool_config?.type === "webhook");
  if (found) { await el(`/v1/convai/tools/${found.id}`, { method: "PATCH", body: JSON.stringify({ tool_config: cfg }) }); console.log(`Updated tool ${cfg.name}: ${found.id}`); return found.id; }
  const r = await el("/v1/convai/tools", { method: "POST", body: JSON.stringify({ tool_config: cfg }) });
  console.log(`Created tool ${cfg.name}: ${r.id}`);
  return r.id;
}

async function main() {
  if (DRY) {
    console.log(JSON.stringify(redact({ tools: TOOLS, agent: agentBody(["<book_viewing id>", "<get_free_slots id>"]) }), null, 2));
    return;
  }
  const list = await el("/v1/convai/tools").catch(() => ({ tools: [] }));
  const ids = [];
  for (const cfg of TOOLS) ids.push(await upsertTool(cfg, Array.isArray(list.tools) ? list.tools : []));
  const send = async (withDc) => AGENT_ID
    ? el(`/v1/convai/agents/${encodeURIComponent(AGENT_ID)}`, { method: "PATCH", body: JSON.stringify(agentBody(ids, withDc)) }).then(() => ({ agent_id: AGENT_ID }))
    : el("/v1/convai/agents/create", { method: "POST", body: JSON.stringify(agentBody(ids, withDc)) });
  let r;
  try { r = await send(true); }
  catch (e) { if (e.status !== 422) throw e; console.warn(`Retrying without data_collection (${e.message.slice(0, 160)})`); r = await send(false); }
  console.log(`\n${AGENT_ID ? "Updated" : "Created"} agent "Sublet Sniper caller": ${r.agent_id}`);
  console.log(`\nNext:\n  1. Set ELEVENLABS_AGENT_ID=${r.agent_id} (Vercel + .env.local).`);
  console.log(`  2. ElevenLabs > Agents > Settings > Post-call webhook: ${APP}/api/voice/webhook (HMAC). Put its secret in ELEVENLABS_WEBHOOK_SECRET.`);
  console.log("  3. ElevenLabs > Phone numbers: import your Twilio number, assign it to this agent, copy its id to ELEVENLABS_PHONE_NUMBER_ID.");
}

main().catch((e) => { console.error(e.message); process.exit(1); });
