# Sublet Sniper: 2-minute demo script

**One line:** Tell your agent what you want to rent. It searches, blocks scams, calls and emails landlords, negotiates, and books the viewing. You just show up.

**Why it matters:**
1. Renting a sublet in SF costs hours, landlords ghost you, and scams are everywhere ("I'm abroad, Zelle me the deposit").
2. Other tools show listings. Sublet Sniper acts for you: it phones and emails landlords as your representative, refuses payment before a viewing, negotiates, and books.
3. Agent-native: people use the web app; AI agents (Claude, ChatGPT) use the same powers through MCP.

## Setup (5 minutes before)
- Desktop Chrome, full screen, https://sublet-sniper.vercel.app (landing). Signed out.
- iPhone (+54 9 11 3246-1089) unlocked, ringer on, ready to answer on speaker. The agent calls from +1 415 582 1858.
- Listen once to "Hear it negotiate" on the landing to check audio.
- Rehearsal without a call: `/app?preview=scam` and `/app?preview=booked` show the two big moments.

## Script (120 s)

| Time | You say | You do | Screen |
|---|---|---|---|
| 0:00 | "Renting a sublet in San Francisco takes hours, landlords ghost you, and scams are everywhere: 'I'm abroad, Zelle me the deposit'." | Landing: let the hero loop play | Agent searching, SCAM stamp, call, booked ticket |
| 0:12 | "So I built an agent that rents for you. I just tell it what I want." | Open the app → Continue as guest → click the first suggestion ("Furnished 1BR in SF under $4,000, Nov 1 to Dec 15") | ~770 live listings scanned, scams blocked, photos |
| 0:25 | "Every listing gets a scam score. This one is too good to be true." | Scams caught → Scam X-ray on a red listing | Price vs SF median, red-flag phrases, signals |
| 0:40 | "Now I just say: handle it." | Click **Yes, go** | Email sent as you; then the call starts |
| 0:48 | "It emailed the landlord as me... and now it's calling him." | Answer the iPhone on speaker | Call Stage: live waveform and transcript |
| 0:55 | (as landlord) **"Yes, it's available. It's $3,800 a month, and I need a $7,600 Zelle deposit today to hold it."** | Let the agent answer | "Zelle refused" chip; agent counters $3,600 |
| 1:15 | (as landlord) **"OK, no deposit. $3,600 works. Can you do a video tour Monday after 5?"** | Let it confirm, say "Yes", let it hang up | "Agreed $3,600, saved $200/mo", VIEWING BOOKED |
| 1:40 | "It refused the scam move, saved me $200 a month, and booked the viewing. I said one sentence and clicked once." | Point at the booked ticket → Add to calendar | Ticket + mission tracker all done |
| 1:50 | "And it's agent-native: Claude or ChatGPT can rent through it with one command." | (optional) Landing "For agents" terminal | `claude mcp add ...` + live tool calls |

## If something fails
- Phone doesn't ring in ~15 s: say "it's dialing" and continue by email; landlord replies by email work the same (≈15 s each).
- Voice/mic fails: type the request or click the suggestion.
- Craigslist live fails: snapshot fallback is automatic.
- Total fallback: `/app?preview=scam` and `/app?preview=booked`.

## Measured (production, 2026-10-24)
Search + consent ≈ 11 s · landlord email → SCAM BLOCKED 14.5 s · landlord email → VIEWING BOOKED 14 s · first real phone call connected and completed (104 s).
