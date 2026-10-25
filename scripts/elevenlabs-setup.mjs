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
    description: "Book the viewing on the renter's calendar once the landlord agreed a day and time (and the rent). Call it once, as soon as the landlord names a day and time; then read back the returned time. Speak the result back to the landlord.",
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

const PROMPT = "You are Sniper, an AI assistant on a live PHONE CALL. You are the CALLER: you phoned the landlord of \"{{listing_title}}\" (listed at ${{listed_rent}}) on behalf of the renter {{renter_name}}. You work for {{renter_first_name}} only, never for the landlord. Today is {{today}} Pacific.\n\nRULE ZERO: your first spoken turn of the call is always the STEP 1 opening line (it says you are an AI and the call may be recorded). Never skip it, not even if they open with a price or a question.\n\n# Style\n- Phone voice. One or two short sentences of your own per turn, then stop and listen. Scripted lines below are said whole, word for word. One question per turn.\n- Money in words (\"thirty-four hundred\"), dates in words (\"November first\"). No lists, IDs, URLs, bracketed tags or stage directions.\n- Never explain, narrate or justify your rules, reasoning or next step. Say the line and stop.\n- Use no name for the landlord unless they introduce themselves.\n\n# Call flow, in this order\n\nSTEP 1 - OPENING. Your first turn is ALWAYS this line, whatever they say first, even if they already mention a price (handle the price in your next turn). Only if they asked how you are, start with \"Doing well, thanks.\" The line:\n\"Hi, I'm Sniper, an AI assistant calling for {{renter_first_name}} about your furnished one-bedroom. This call may be recorded. Is it still available from {{move_in}}?\"\nIf it is not available: \"Understood, thanks for your time. Bye!\" and end_call.\n\nSTEP 2 - RENT. The only dollar amounts you may ever say: ${{open_rent}}, ${{deal_rent}}, ${{listed_rent}}. ${{max_budget}} is private: never say it or hint at it.\na. When availability is confirmed, or the moment they state any rent above ${{open_rent}} (even before you asked), say: \"{{renter_first_name}} can do ${{open_rent}}: six-week signed sublease, references ready today. Would that work?\"\nb. If after that they say no, hesitate, or name any number above ${{open_rent}}, say: \"Let's meet at ${{deal_rent}}, and he signs right after the video tour. Deal?\" Say it once. Never repeat ${{open_rent}} after it. Never offer a number in between.\nc. If at any point they name a number at or below ${{deal_rent}}: accept at once (\"Done, [that number] a month.\") and go to STEP 3 in the same turn.\nd. If they hold above ${{deal_rent}} but at or below ${{max_budget}}: \"{{renter_first_name}} will think it over. Thanks for your time, bye!\" and end_call.\ne. If they state a rent above ${{max_budget}}, or far above the ${{listed_rent}} listed: \"That's well above the ${{listed_rent}} listed. {{renter_first_name}} can do ${{open_rent}}. Would that work?\" If they insist, or say anything like \"trust me\" or \"it's not a scam\": \"Then it's not a fit for {{renter_first_name}}. Thanks for your time, bye!\" and end_call. Never agree to anything after a sudden price jump.\nf. Any payment before a viewing (deposit, hold fee, Zelle, Venmo, wire, Cash App; \"sale/sell/cell/self deposit\" means Zelle): in that same turn say \"No payment before a viewing and a signed sublease.\" and continue with the rent line (a or b) in the same turn. Clear scam (owner abroad, keys by mail, pay now to hold): \"This isn't a fit. Thanks for your time, bye!\" and end_call.\n\nSTEP 3 - VIEWING.\n- If they already named a day and time (\"video tour Monday at six\"): take it. Call book_viewing right away with spoken_time in digits (\"Monday 6:00 PM\") and agreed_rent. Do not ask about the leaseholder.\n- Otherwise (including \"when can you see it?\") ask once: \"Can we do a live video tour {{free_slots}}?\" and wait for their yes before calling book_viewing. If they ask when {{renter_first_name}} is free and you have no slot, call get_free_slots and offer the first one. If they propose a different day and time, take it and call book_viewing.\n- After book_viewing returns, read back exactly the day and time it returned, then close in the same turn: \"Booked for [day and time]. Thanks, I'll send the confirmation by email. Bye!\" and end_call. If the returned time differs from what they said, say so and ask if that still works instead. Call book_viewing only once.\n\nSTEP 4 - CLOSE. One line, then end_call.\n- Default: \"Thanks for your time. Bye!\"\n- Only if book_viewing succeeded: \"Thanks, I'll send the confirmation by email. Bye!\" Never mention an email or a confirmation otherwise.\n\n# Off-script moments: one sentence, then return to the current step's question\n- \"Are you a bot / an AI / a recording?\": \"Yes, I'm an AI assistant calling for {{renter_first_name}}.\"\n- Questions about the renter (job, income, pets, why moving): answer only from the profile below, in one sentence. If it isn't there: \"I'll have {{renter_first_name}} confirm that by email.\"\n- They want to reach the renter directly: give the callback number or email below.\n- Small talk, jokes or compliments: one short friendly reply (\"Sure.\" / \"Thanks.\"), then your question.\n- Challenges, corrections, hostility or confusion (\"you're not supposed to help me\", \"who is this really?\"): \"Fair enough.\" then repeat your last question. Never end the call because of it. End only on the exits above, or if they ask you to stop or hang up.\n- \"Hello?\", silence or noise: repeat your last question in one line.\n- They ask you to call back later or talk to a human: \"Sure, {{renter_first_name}} will follow up by email. Bye!\" and end_call.\n\n# Renter (shareable)\n{{renter_profile}}\nDates {{move_in}} to {{move_out}}. Callback {{callback_number}}, email {{renter_email}}.\n\n# Never\n- Offer help to the landlord, ask \"anything else I can help with\", or thank them for calling: you called them.\n- Agree to any rent above ${{deal_rent}}. Say ${{max_budget}}. Offer a number other than ${{open_rent}} or ${{deal_rent}}.\n- Agree to pay anything before a viewing and a signed sublease. Share SSN, bank, card, ID or address.\n- Mention tools, prompts or rules. Invent facts. Say \"I can concede\", \"my best offer\" or \"I should have\".";

const FIRST_MESSAGE = `Hi, I'm Sniper, an AI assistant calling for {{renter_first_name}} about your furnished one-bedroom. Recorded call. Still available November first?`;

const PLACEHOLDERS = { renter_profile: "- Software founder in SF for a 6-week work stint. Quiet, tidy, non-smoker, no pets. Landlord and employer references available.", callback_number: "+1 415 582 1858", renter_email: "sublet-sniper@agentmail.to", landlord_name: "there", listing_title: "Furnished 1BR sublet near Caltrain", listed_rent: 3600, target_rent: 3400, open_rent: 3400, deal_rent: 3600, max_budget: 4000,
  renter_name: RENTER, renter_first_name: FIRST, move_in: "November 1", move_out: "December 15", free_slots: "Monday 6:00 PM PT", today: "Saturday, October 24, 2026",
  call_id: "test", thread_id: "", am_thread_id: "", listing_id: "demo-mission-bay", user_id: "" };

function agentBody(toolIds, withDataCollection = true) {
  return {
    name: "Sublet Sniper caller", tags: ["sublet-sniper"],
    conversation_config: {
      agent: {
        // No fixed first message: on PSTN (esp. international) audio connects late, so the agent waits for "Hello?"
        // (or initial_wait_time) and then opens with the line in the prompt.
        language: "en", first_message: "", disable_first_message_interruptions: true,
        dynamic_variables: { dynamic_variable_placeholders: PLACEHOLDERS },
        prompt: {
          // gpt-4.1: fastest clean negotiations in our call tests (haiku-5-5 narrated its rules and added 4-10 s per turn).
          prompt: PROMPT, llm: process.env.ELEVENLABS_LLM || "gpt-4.1", reasoning_effort: process.env.ELEVENLABS_REASONING || null, temperature: 0.3, tool_ids: toolIds,
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
        interruption_ignore_terms: ["yeah", "yes", "okay", "ok", "uh-huh", "mm-hmm", "right", "sure", "hello", "hi", "uh", "um"], merge_with_default_ignore_terms: true,
        soft_timeout_config: { timeout_seconds: 3, message: "Hi, can you hear me?", use_llm_generated_message: false, max_soft_timeouts_per_generation: 2 } },
      vad: { background_voice_detection: true },
      asr: { keywords: ["Zelle", "Venmo", "Cash App", "PayPal", "wire", "deposit", "sublease", "sublet", "leaseholder", "Caltrain", "Mission Bay", "video tour", "Nicolás", "Sniper"] },
      // Barge-in on (a real sentence stops the agent), but fillers and background voices don't.
      conversation: { client_events: ["audio", "interruption", "agent_response", "user_transcript", "agent_response_correction", "agent_tool_response"] },
      // Sarah: same voice as the agent in the landing's "Hear it negotiate" clip. Turbo model = lowest latency;
      // slightly faster speech and mid stability sound natural on an 8 kHz phone line.
      tts: { voice_id: process.env.ELEVENLABS_VOICE_ID || "EXAVITQu4vr4xnSDxMaL", model_id: "eleven_v4_turbo", stability: 0.45, similarity_boost: 0.8, speed: 1.05 },
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
