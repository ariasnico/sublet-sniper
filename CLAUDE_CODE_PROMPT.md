# Sublet Sniper: contexto para seguir en Claude Code

You are continuing **Sublet Sniper**, a hackathon project (Puentes hackathon, San Francisco, Oct 24 2026) by Nicolás Arias. Repo: https://github.com/ariasnico/sublet-sniper (private, branch `main`, Vercel auto-deploys `main` to https://sublet-sniper.vercel.app). Priority: SPEED and demo WOW effect over strict best practices. Keep only the tests that protect the demo path.

## The idea
Finding a short-term rental/sublet in SF is painful: hours on Craigslist, landlords who never reply, and lots of scams (fake listings, "I'm out of the country", deposit by Zelle/wire before any viewing). This was the top rental complaint found in X research. Sublet Sniper is a **personal rental agent**: you talk to it (text or voice, Spanish or English), and it searches Craigslist live, ranks options, flags scams with a traffic light and score, emails the landlord **as you**, negotiates price, asks for proof (live video walkthrough plus leaseholder confirmation), refuses Zelle/wire/gift cards/deposits before viewing, and books the viewing on your calendar. You only approve. Pitch: "My agent talks to landlords, blocks scammers and leaves me with a booked viewing."

## Stack and architecture
- Next.js (App Router, TypeScript) on Vercel. Light UI with an orange (#F97316) plus white/grey palette, Inter font, and an orange robot mascot SVG (`app/icon.svg`). Design follows Emil Kowalski's `emil-design-eng` skill (short ease-out animations, transform/opacity only, press scale, reduced motion). Toasts use `sonner`.
- LLM: OpenAI `gpt-4.1` with tool calling (`LLM_PROVIDER=openai`, `OPENAI_MODEL`). Code in `src/lib/llm.ts`, `agent.ts`, `tools.ts`.
- Search: Craigslist live HTML scraping with a snapshot fallback (`src/lib/search.ts`, `sources/`, `normalize.ts`, `rank.ts`, `criteria.ts`, `baselines.ts` for SF medians).
- Scam check: `src/lib/scam.ts`. Score capped at 100. Signals include price below 45% of the SF median by type, wire/Zelle requests, out-of-country landlord, upfront amount over 2x rent (CA AB 12), and pHash photo reuse against the snapshot. A pasted Craigslist URL in chat is always fetched and scored deterministically and shown as a "Your link · scam risk N/100" card.
- Mail: AgentMail inbox `sublet-sniper@agentmail.to` (`mail.ts`, `mailsync.ts`, `inbox.ts`, `landlord.ts`).
  - State is rebuilt from AgentMail threads whose subject contains `[Sublet Sniper demo]`, since serverless has no memory. The browser also sends a snapshot back.
  - Each landlord message is answered once: it is claimed with the label `sniper-handled`.
  - An AgentMail webhook (`message.received`) points to `/api/mail/webhook?token=WEBHOOK_TOKEN`, so replies happen automatically. `/api/mail/poll` is also called by the UI every 15s and by the "Check mail" button.
  - Quoted reply text is stripped before the LLM reads it.
- Scheduling: `calendar.ts` and `time.ts` parse the landlord's proposed window ("Monday after 5pm"), book the first free slot inside it, and send ONE confirmation email. With no window, the agent offers 3 slots. `REQUIRE_BOOKING_APPROVAL=1` brings back manual approval. Google Calendar is in **mock** mode; real mode needs OAuth creds.
- Voice: browser Web Speech API. ElevenLabs is optional.
- API routes: `agent`, `approve`, `demo/landlord`, `mail/poll`, `mail/webhook`, `reset`, `state`.
- Reset stores a timestamp client-side, and threads only show if they have newer activity.
- Tests: 35 passing (mocked LLM and mail). Run typecheck, lint, build and test before pushing.

## Env vars (in Vercel and in `.env.local`, gitignored; never print or commit)
`OPENAI_API_KEY`, `LLM_PROVIDER=openai`, `OPENAI_MODEL=gpt-4.1`, `AGENTMAIL_API_KEY`, `AGENTMAIL_INBOX_ID`, `DEMO_LANDLORD_EMAIL=nicoa8008@gmail.com`, `WEBHOOK_TOKEN`.

## Hard rules
- The agent may ONLY email `DEMO_LANDLORD_EMAIL` (Nicolás plays the landlord). Real Craigslist landlords are contacted by the human clicking Reply on Craigslist.
- No captcha solving and no automated Craigslist contact.
- Never print or commit secrets.

## Demo flow (works today)
1. Reset.
2. "Busco 1BR amoblado en SF, menos de $4000, del 1/11 al 15/12". Live Craigslist results appear, and the Duboce demo listing is flagged red.
3. Paste a too-cheap listing (e.g. the $1,100 1BR on Ortega St). It shows a red card with the score.
4. Approve contact on the "[DEMO DATA] Furnished 1BR sublet near Caltrain" listing. The email goes to nicoa8008.
5. Reply as landlord: "Yes it's available! Video tour Monday after 5pm?". The agent books Monday 5:30 PM PT and sends one email.
6. Ask $3,800. The agent counters. Ask for a Zelle deposit. It refuses.

## Known gaps / next steps
- Real Google Calendar (OAuth).
- Vague windows like "next week" fall back to 3 slots. "The Sunday one" picks the first Sunday slot.
- Medians are SF-wide by type, not by neighborhood. New photos aren't pHashed live.
- Layout below 1100px width is untested, so do a mobile pass.
- Optional: ElevenLabs voice, and more wow (e.g. a map view, a "time saved" counter).
- Commit small and often, and verify the Vercel deploy (200 and poll `modes.mail="agentmail"`).
