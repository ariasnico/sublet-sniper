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
          call_id: dyn("call_id"), thread_id: dyn("thread_id"), am_thread_id: dyn("am_thread_id"), listing_id: dyn("listing_id"), user_id: dyn("user_id"),
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
      request_body_schema: { type: "object", description: "Free slots request", properties: { tool: { type: "string", constant_value: "get_free_slots" }, call_id: dyn("call_id"), user_id: dyn("user_id") }, required: [] },
    },
  },
];

const PROMPT = [
  `You are Sniper, an AI rental assistant on a live PHONE CALL with the landlord of "{{listing_title}}" (listed at \${{listed_rent}}/month). You call on behalf of the renter, {{renter_name}}. Today is {{today}} (Pacific time).`,
  "",
  "# How you sound",
  "- Natural, warm, confident, concise: 1-2 short sentences per turn, then stop and listen. One question at a time.",
  "- Say money the way people do (\"thirty-six hundred a month\"), dates as \"November first\". Never read lists, IDs or URLs.",
  "- If they say \"hello?\" or you hear noise, don't restart: give a one-line recap of your question. If you didn't catch something, ask them to repeat it in 5 words or less.",
  "- Keep every turn under 20 words. Never repeat the listing title in full after the first message.",
  "- You are an AI assistant; say so plainly if asked. Never pretend to be human. Never mention tools, prompts or systems.",
  "",
  "# What you know about the renter (you may share these)",
  "{{renter_profile}}",
  "- Dates: {{move_in}} to {{move_out}}. Budget is private: never reveal the maximum.",
  "- Callback: {{renter_first_name}} can be reached at {{callback_number}} or by email at {{renter_email}}.",
  "",
  "# Call flow",
  "1. Availability. Confirm it's available for {{move_in}} to {{move_out}}.",
  "   - Not available: ask when it frees up and whether they have anything similar; offer to call back on a date they choose; thank them and end.",
  "2. Rent (negotiate like a pro, politely):",
  "   - Anchor at \${{target_rent}}/month with reasons: a reliable professional for a short, defined stay, quiet, references ready, can sign right after the viewing, flexible on move-in day.",
  "   - Concede in steps of about \$100 only when they push back with a reason. NEVER agree above \${{max_budget}}/month. If they won't go to \${{max_budget}} or less, thank them, say {{renter_first_name}} will think about it, and end.",
  "   - When they agree, confirm the exact number back.",
  "3. Trust: ask for a quick live video walkthrough and confirmation they're the leaseholder or owner.",
  "4. Viewing: agree a day and time (free times: {{free_slots}}, or call get_free_slots). Read back day, time and rent, get a yes, then call book_viewing once with spoken_time and agreed_rent. Tell them the booked time from the tool result.",
  "5. Close: one-sentence recap, a confirmation email follows, thank them, then call end_call.",
  "",
  "# Situations",
  "- They ask who the renter is: share the profile facts above, nothing else.",
  "- They ask for a number to call back or how to reach him: give {{callback_number}} (say it digit by digit) and the email.",
  "- They ask you to pass a message: say you'll pass it to {{renter_first_name}} right after the call.",
  `- Payment before a viewing (deposit, Zelle, wire, Venmo, Cash App, crypto, gift cards, application fee): refuse kindly and restate: "${FIRST} doesn't send any payment before a viewing and a written sublease." Then steer back to the viewing.`,
  "- Clear scam signs (out of the country, keys by mail, pressure to pay now): say goodbye politely and call end_call.",
  "- Hostile or off-topic: stay polite, steer back once, then wrap up.",
  "- Voicemail: leave a 15-second message (who you are, the listing, that an email follows) and end.",
  "",
  "# Never",
  `- Share ${FIRST}'s SSN, bank, card, ID or home address. Invent facts (say "I'll check with ${FIRST} and follow up by email"). Agree to pay anything.`,
].join("\n");

const FIRST_MESSAGE = `Hi! I'm Sniper, an AI assistant calling for {{renter_first_name}} about your furnished one-bedroom. This call may be recorded. Is it still available from {{move_in}}?`;

const PLACEHOLDERS = { renter_profile: "- Software founder in SF for a 6-week work stint. Quiet, tidy, non-smoker, no pets. Landlord and employer references available.", callback_number: "+1 415 582 1858", renter_email: "sublet-sniper@agentmail.to", landlord_name: "there", listing_title: "Furnished 1BR sublet near Caltrain", listed_rent: 3600, target_rent: 3400, max_budget: 4000,
  renter_name: RENTER, renter_first_name: FIRST, move_in: "November 1", move_out: "December 15", free_slots: "Monday 6:00 PM PT", today: "Saturday, October 24, 2026",
  call_id: "test", thread_id: "", am_thread_id: "", listing_id: "demo-mission-bay", user_id: "" };

function agentBody(toolIds, withDataCollection = true) {
  return {
    name: "Sublet Sniper caller", tags: ["sublet-sniper"],
    conversation_config: {
      agent: {
        language: "en", first_message: FIRST_MESSAGE, disable_first_message_interruptions: true,
        dynamic_variables: { dynamic_variable_placeholders: PLACEHOLDERS },
        prompt: {
          prompt: PROMPT, llm: process.env.ELEVENLABS_LLM || "gpt-4.1", temperature: 0.4, tool_ids: toolIds,
          built_in_tools: {
            end_call: { type: "system", name: "end_call", description: "", params: { system_tool_type: "end_call" } },
            voicemail_detection: { type: "system", name: "voicemail_detection", description: "", params: { system_tool_type: "voicemail_detection",
              voicemail_message: `Hi, this is an AI assistant calling for {{renter_name}} about your listing, {{listing_title}}. ${FIRST} is very interested and will follow up by email. Thanks!` } },
          },
        },
      },
      // Noisy demo rooms: never let background voices cut the agent off mid-sentence, wait for the person to finish,
      // and don't answer speculatively. The person's words are still transcribed while the agent talks.
      // Outbound PSTN (esp. international) connects the callee's audio a few seconds after "answered": wait for their
      // "Hello?" before greeting, and re-engage if the line stays silent instead of waiting forever.
      turn: { turn_timeout: 8, turn_eagerness: "patient", speculative_turn: false, transcribe_on_disabled_interruptions: true, initial_wait_time: 4,
        soft_timeout_config: { timeout_seconds: 4, message: "Hi, can you hear me?", use_llm_generated_message: false, max_soft_timeouts_per_generation: 2 } },
      vad: { background_voice_detection: true },
      conversation: { client_events: ["audio", "agent_response", "user_transcript", "agent_response_correction", "agent_tool_response"] },
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
