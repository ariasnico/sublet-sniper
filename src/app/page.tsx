import type { Metadata } from "next";
import Link from "next/link";
import { getImageProps } from "next/image";
import { Bot } from "./Bot";
import { CopyButton } from "./landing/CopyButton";
import s from "./landing.module.css";

const SITE = "https://sublet-sniper.vercel.app";
const MCP_URL = `${SITE}/api/mcp`;
const CLAUDE_CODE_CMD = `claude mcp add --transport http sublet-sniper ${MCP_URL}`;

export const metadata: Metadata = {
  title: "Sublet Sniper",
  description: "Your personal rental agent for San Francisco: finds the sublet, blocks the scammers, books the viewing.",
  metadataBase: new URL(SITE),
  openGraph: {
    title: "Sublet Sniper",
    description: "Your personal rental agent for San Francisco: finds the sublet, blocks the scammers, books the viewing.",
    url: SITE,
    siteName: "Sublet Sniper",
    images: [{ url: "/landing/og.png", width: 1200, height: 630, alt: "Sublet Sniper: an orange robot holding a house key above San Francisco" }],
    type: "website",
  },
  twitter: { card: "summary_large_image", title: "Sublet Sniper", description: "Finds the sublet, blocks the scammers, books the viewing.", images: ["/landing/og.png"] },
};

const TOOLS: Array<[string, string]> = [
  ["search_sublets", "Live Craigslist search for SF, ranked against the city's medians."],
  ["check_listing_scam", "Scam X-ray for any listing URL: score out of 100 plus the signals."],
  ["contact_landlord", "Email the landlord as the user, with their approval, and keep negotiating."],
  ["get_deals", "Current threads: listed price, asked price, agent offer, viewing status."],
  ["ask_agent", "Talk to the whole agent in plain language, English or Spanish."],
];

const SCAMS: Array<{ quote: string; tell: string }> = [
  { quote: "I'm currently out of the country for missionary work, so I can't show the unit in person.", tell: "Owner can't meet. The keys will be \"mailed\"." },
  { quote: "Send the first month by Zelle to hold it. I have a lot of interest.", tell: "Money before a viewing. Always no." },
  { quote: "1BR furnished, Ortega St, $1,100/mo, all utilities included.", tell: "Price far below the SF median for its type. Photos reused from another listing." },
];

function HeroPicture() {
  const common = { alt: "A friendly orange robot holds up a house key on a sunny San Francisco hill, with Victorian houses and two crossed-out listings behind it", priority: true };
  const { props: desktop } = getImageProps({ ...common, width: 1536, height: 1024, src: "/landing/hero.webp", sizes: "(min-width: 760px) 100vw, 1px" });
  const { props: mobile } = getImageProps({ ...common, width: 900, height: 838, src: "/landing/hero-mobile.webp", sizes: "(max-width: 759px) 100vw, 1px" });
  return (
    <picture className={s.heroPic}>
      <source media="(max-width: 759px)" srcSet={mobile.srcSet} sizes="100vw" />
      <source media="(min-width: 760px)" srcSet={desktop.srcSet} sizes="100vw" />
      {/* eslint-disable-next-line jsx-a11y/alt-text -- alt comes from the spread props */}
      <img {...desktop} sizes="100vw" fetchPriority="high" />
    </picture>
  );
}

export default function Landing() {
  return (
    <div className={s.page}>
      <a href="#main" className={s.skip}>Skip to content</a>

      <header className={s.header}>
        <div className={s.headerInner}>
          <Link href="/" className={s.brand} aria-label="Sublet Sniper home">
            <Bot size={30} />
            <span>Sublet Sniper</span>
          </Link>
          <nav className={s.nav} aria-label="Sections">
            <a href="#how">How it works</a>
            <a href="#agents">For agents</a>
            <a href="#safety">Safety</a>
          </nav>
          <Link href="/app" className={`${s.btn} ${s.btnSmall}`}>Open the app</Link>
        </div>
      </header>

      <main id="main">
        {/* ── Hero ─────────────────────────────────────────── */}
        <section className={s.hero} aria-labelledby="hero-title">
          <HeroPicture />
          <div className={s.heroCopy}>
            <h1 id="hero-title" className={s.h1}>
              Your personal rental agent for San&nbsp;Francisco.
            </h1>
            <p className={s.lede}>
              It finds the sublet, blocks the scammers, talks to the landlord as you, and books the viewing. You only approve.
            </p>
            <div className={s.ctaRow}>
              <Link href="/app" className={`${s.btn} ${s.btnPrimary}`}>Open the app</Link>
              <a href="#agents" className={`${s.btn} ${s.btnGhost}`}>Use it from your AI agent</a>
            </div>
            <p className={s.heroNote}>Voice or text. English or Spanish. Live Craigslist data.</p>
          </div>
        </section>

        {/* ── Problem ──────────────────────────────────────── */}
        <section className={s.section} aria-labelledby="problem-title">
          <div className={s.problem}>
            <div className={s.problemText}>
              <h2 id="problem-title" className={s.h2}>Finding a short-term place in SF is a part-time job.</h2>
              <p>
                Hours scrolling Craigslist. Landlords who never write back. And a steady stream of fake listings:
                the owner is conveniently abroad, the photos belong to someone else, and the deposit has to go out
                by Zelle or wire before anyone shows you the door.
              </p>
              <p className={s.stat}>
                Scams and ghosting were the most common complaints in the SF renter threads we read before building this.
                Every one of the messages on the right is a pattern the Scam X-ray catches.
              </p>
            </div>
            <ul className={s.scamList} aria-label="Examples of listings the Scam X-ray blocks">
              {SCAMS.map((x) => (
                <li key={x.quote} className={s.scam}>
                  <blockquote>{x.quote}</blockquote>
                  <p><span className={s.blocked}>Blocked</span>{x.tell}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* ── How it works ─────────────────────────────────── */}
        <section id="how" className={`${s.section} ${s.sectionTint}`} aria-labelledby="how-title">
          <h2 id="how-title" className={s.h2}>How it works</h2>
          <p className={s.sub}>Four steps. The agent does the legwork; you make the decisions.</p>
          <ol className={s.steps}>
            <li className={s.step}>
              <div className={s.stepText}>
                <h3>Tell it what you need</h3>
                <p>Talk or type, in English or Spanish. Neighborhood, dates, budget, furnished or not.</p>
              </div>
              <div className={s.artifact}>
                <div className={s.bubble}>Busco 1BR amoblado en SF, menos de $4,000, del 1/11 al 15/12.</div>
              </div>
            </li>
            <li className={s.step}>
              <div className={s.stepText}>
                <h3>It searches Craigslist live and X-rays every listing</h3>
                <p>Each result gets a scam score: price against SF medians, wire or Zelle requests, out-of-country owners, upfront amounts over the legal cap, reused photos.</p>
              </div>
              <div className={s.artifact}>
                <div className={s.card}>
                  <div className={s.cardTop}><span>Furnished 1BR near Caltrain</span><b>$3,650</b></div>
                  <div className={s.cardRow}><i className={s.dotGreen} />Scam risk 8/100</div>
                </div>
                <div className={`${s.card} ${s.cardBad}`}>
                  <div className={s.cardTop}><span>Sunny 1BR on Ortega St</span><b>$1,100</b></div>
                  <div className={s.cardRow}><i className={s.dotRed} />Scam risk 91/100</div>
                </div>
              </div>
            </li>
            <li className={s.step}>
              <div className={s.stepText}>
                <h3>It emails the landlord as you</h3>
                <p>Asks the questions you would, negotiates the price, asks for a live video walkthrough, and refuses any money before a viewing.</p>
              </div>
              <div className={s.artifact}>
                <div className={s.mail}>
                  <div className={s.mailHead}>Re: Furnished 1BR sublet near Caltrain</div>
                  <p>Thanks! I&rsquo;d rather not send a deposit before seeing the place. Could we do a quick video tour Monday after 5pm? Also, would you consider $3,800 for the full stay?</p>
                </div>
              </div>
            </li>
            <li className={s.step}>
              <div className={s.stepText}>
                <h3>It books the viewing on your calendar</h3>
                <p>When the landlord gives a window, the agent picks a free slot, confirms once by email, and puts it on your calendar.</p>
              </div>
              <div className={s.artifact}>
                <div className={s.cal}>
                  <span className={s.calDay}>Mon</span>
                  <div><b>Video tour, Furnished 1BR near Caltrain</b><span>5:30 PM, Pacific</span></div>
                </div>
              </div>
            </li>
          </ol>
        </section>

        {/* ── Agents ───────────────────────────────────────── */}
        <section id="agents" className={`${s.section} ${s.sectionDark}`} aria-labelledby="agents-title">
          <div className={s.agentsGrid}>
            <div>
              <h2 id="agents-title" className={s.h2}>Use it as a human, or from your agents.</h2>
              <p className={s.subDark}>
                Sublet Sniper is also a remote MCP server. Any MCP client, from Claude Code to a custom connector in Claude or ChatGPT, can search, X-ray, negotiate and read deals with the same guardrails.
              </p>
              <dl className={s.tools}>
                {TOOLS.map(([name, desc]) => (
                  <div key={name} className={s.tool}>
                    <dt><code>{name}</code></dt>
                    <dd>{desc}</dd>
                  </div>
                ))}
              </dl>
            </div>
            <div className={s.snippets}>
              <div className={s.snippet}>
                <div className={s.snippetHead}><span>Claude Code</span><CopyButton text={CLAUDE_CODE_CMD} className={s.copy} /></div>
                <pre><code>{CLAUDE_CODE_CMD}</code></pre>
              </div>
              <div className={s.snippet}>
                <div className={s.snippetHead}><span>Claude or ChatGPT custom connector</span><CopyButton text={MCP_URL} className={s.copy} /></div>
                <pre><code>{MCP_URL}</code></pre>
                <p className={s.snippetNote}>Settings, Connectors, Add custom connector. Paste the URL. No auth needed for the demo.</p>
              </div>
            </div>
          </div>
        </section>

        {/* ── Safety ───────────────────────────────────────── */}
        <section id="safety" className={s.section} aria-labelledby="safety-title">
          <h2 id="safety-title" className={s.h2}>Three things it will never do</h2>
          <ul className={s.promises}>
            <li>
              <h3>Pay before a viewing</h3>
              <p>No deposits, no Zelle, no wire, no gift cards, no &ldquo;holding fee&rdquo;. If a landlord insists, the agent says no and tells you why.</p>
            </li>
            <li>
              <h3>Message real Craigslist landlords on its own</h3>
              <p>Search results link back to Craigslist and you click Reply. No automated contact, no captcha solving.</p>
            </li>
            <li>
              <h3>Speak for you without your approval</h3>
              <p>Every outreach starts with your tap. The agent writes as you, in your name, only to landlords you approved.</p>
            </li>
          </ul>
        </section>

        {/* ── Footer CTA ───────────────────────────────────── */}
        <section className={s.final} aria-labelledby="final-title">
          <Bot size={56} className={s.finalBot} />
          <h2 id="final-title" className={s.h2}>Your next sublet, with the scammers already removed.</h2>
          <div className={s.ctaRow}>
            <Link href="/app" className={`${s.btn} ${s.btnPrimary}`}>Open the app</Link>
            <a href="#agents" className={`${s.btn} ${s.btnGhost}`}>Connect your agent</a>
          </div>
        </section>
      </main>

      <footer className={s.footer}>
        <span>Sublet Sniper</span>
        <span>Built at the Puentes hackathon, San Francisco, October 2026.</span>
      </footer>
    </div>
  );
}
