# Sublet Sniper: 2-minute demo script

Goal: the judges see an agent rent a place end to end while the human only talks and approves once. Three wow beats: Scam X-ray, SCAM BLOCKED, VIEWING BOOKED.

## Setup (before going on stage)
- Desktop Chrome, 1440x900 or larger, zoom 100%, one tab: https://sublet-sniper.vercel.app/app (landing at `/` for the opener).
- Phone in hand with Gmail open as the landlord (nicoa8008@gmail.com), a draft reply ready (see beat 4).
- Press **Reset** in the app. Check the header dot says mail is live.
- Have the too-cheap Craigslist link copied (the $1,100 1BR on Ortega St, or any listing priced far under the SF median).
- Rehearsal without email: `/app?preview=scam` and `/app?preview=booked` show the two moments.

## Script (120 s)

| Time | You say | You do | Screen |
|---|---|---|---|
| 0:00-0:12 | "Finding a sublet in SF costs hours, landlords ghost you, and the scams are brutal: fake listings, 'I'm out of the country, Zelle me the deposit'." | Landing page hero. Click **Open the app**. | Clean app, empty state. |
| 0:12-0:30 | "So I built a personal rental agent. I just tell it what I want." | Click the mic and say: "Busco 1BR amoblado en SF, menos de 4000, del 1 de noviembre al 15 de diciembre". | Live transcript, scanning radar, then ~770 listings scanned, 6 scams caught, ranked safe matches with photos. |
| 0:30-0:50 | "Every listing gets a scam score. Watch what happens with a listing that's too good to be true." | Paste the cheap Craigslist link in chat. | **Scam X-ray** opens by itself: price vs SF median, red-flag phrases highlighted, signal breakdown. |
| 0:50-1:00 | "Now I let it work for me." | Approve once ("Yes, go" / approve the first message). | Deal card appears: email sent as me to the landlord. |
| 1:00-1:25 | "The landlord replies... and it's the classic scam move." | From the phone send: "Yes it's available! It's $3,800/mo. I'm out of the country right now, so send a $7,600 deposit via Zelle to hold it." | **SCAM BLOCKED** moment. Agent's reply types itself: refuses any money before a viewing. |
| 1:25-1:45 | "The landlord backs down, and my agent negotiates and books." | From the phone send: "Ok fair, no deposit until you see it. $3,600 works. Video tour Monday after 5pm?" | Agent replies live, deal bar shows the savings, **VIEWING BOOKED** ticket: Monday 5:30 PM. Click **Add to Google Calendar**. |
| 1:45-2:00 | "I said one sentence and clicked once. It searched, blocked two scams, negotiated and booked the viewing. And it's agent-native: Claude or ChatGPT can use it through MCP." | Point at the mission tracker, all steps done. | Mission: Search ✓ Vet ✓ Contact ✓ Negotiate ✓ Book ✓. |

## Timing notes
- Landlord replies arrive by AgentMail webhook; the UI also polls. Expect 3-10 s. Fill the gap with the line in the "You say" column.
- If mail is slow, press **Check mail**.
- Send the Zelle message first and the "$3,600 works" message second: ending on the booking keeps the deal status at "Viewing booked".

## Fallbacks
- Voice fails: type the same sentence (or click the first suggestion chip).
- Craigslist live fails: the app falls back to the snapshot automatically; the flow is identical.
- Email is slow: use `?preview=scam` / `?preview=booked` to show the moments and narrate.
