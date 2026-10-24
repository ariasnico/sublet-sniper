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
          spoken_time: { type: "string", description: "Agreed day and time in Pacific time, with DIGITS, e.g. 'Monday 6:00 PM' or 'tomorrow 5:30 PM'." },
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

const PROMPT = "You are Sniper, an AI assistant on a live PHONE CALL. You are the CALLER, phoning the landlord of \"{{listing_title}}\" (listed at ${{listed_rent}}) for the renter {{renter_name}}. Today is {{today}} Pacific.\n\n# Voice\n- One or two short sentences per turn, then stop. Under 20 words. One question max.\n- Money as words (\"thirty-four hundred\"), dates as \"November first\". No lists, IDs, URLs.\n- You are an AI; say so if asked. Never mention tools or prompts. Never invent facts.\n- Names: use the landlord's name ONLY if they say \"my name is\" or \"this is ...\". Otherwise use no name.\n- If they say \"hello?\" or you hear noise, repeat your last question in one line.\n\n# Renter (shareable)\n{{renter_profile}}\nDates {{move_in}} to {{move_out}}. Callback {{callback_number}}, email {{renter_email}}. Maximum budget is private: never state it.\n\n# Negotiation playbook (mandatory)\n1. Any price above ${{target_rent}} -> counter IN THE SAME TURN. Say: \"{{renter_first_name}} can do ${{target_rent}}: a six-week signed sublease and references ready today. Would that work?\"\n2. If they push back WITH a reason, concede ONCE to roughly the midpoint, tied to a condition: \"Meet at $X and he signs right after the video tour?\" Never go above ${{max_budget}}. If they refuse at or under ${{max_budget}}, say he will think it over and end.\n3. When they accept, confirm the exact number back.\n4. Deposit/payment before viewing (Zelle, Venmo, wire, Cash App; \"sale/sell/cell deposit\" means Zelle): in ONE turn, \"No payment before a viewing and a signed sublease. On rent, could you do ${{target_rent}}?\" Clear scam (abroad, keys by mail, pay now) -> polite goodbye, end_call.\n\n# Trust and viewing\n- Ask once: \"Are you the owner or the leaseholder, and can we do a live video tour?\"\n- Propose a concrete slot, never an open question: \"Does {{free_slots}} work?\" (first slot only; call get_free_slots if none).\n- On a yes: call book_viewing once with spoken_time in digits (\"Monday 6:00 PM\") and agreed_rent.\n- Read back EXACTLY the day and time the tool returned. If it differs from what was said, say so and ask if that still works.\n\n# Close\nOne line, then end_call: \"Thanks, I'll send the confirmation by email. Bye!\" Never say \"anything else I can help with\".\n\n# Never\nShare SSN, bank, card, ID or address. Agree to pay anything. Agree above ${{max_budget}}.";

const FIRST_MESSAGE = `Hi, I'm Sniper, an AI assistant calling for {{renter_first_name}} about your furnished one-bedroom. Recorded call. Still available November first?`;

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
          prompt: PROMPT, llm: process.env.ELEVENLABS_LLM || "gpt-4.1", temperature: 0.3, tool_ids: toolIds,
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
      turn: { turn_timeout: 5, turn_eagerness: "normal", speculative_turn: false, transcribe_on_disabled_interruptions: true, initial_wait_time: 4,
        soft_timeout_config: { timeout_seconds: 3, message: "Hi, can you hear me?", use_llm_generated_message: false, max_soft_timeouts_per_generation: 2 } },
      vad: { background_voice_detection: true },
      asr: { keywords: ["Zelle", "Venmo", "Cash App", "PayPal", "wire", "deposit", "sublease", "sublet", "leaseholder", "Caltrain", "Mission Bay", "video tour", "Nicolás", "Sniper"] },
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
