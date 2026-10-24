import type { Metadata } from "next";
import Link from "next/link";
import { getImageProps } from "next/image";
import { preload } from "react-dom";
import { Bot } from "./Bot";
import { CopyButton } from "./landing/CopyButton";
import { ScrollStory } from "./landing/ScrollStory";
import { NegotiationPlayer } from "./landing/NegotiationPlayer";
import { AgentTerminal } from "./landing/AgentTerminal";
import { RedFlagMarquee } from "./landing/borrowed/RedFlagMarquee";
import { HaloCards } from "./landing/borrowed/HaloCards";
import { LiveDemos } from "./landing/borrowed/LiveDemos";
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
  ["search_sublets", "Live SF search, ranked against city medians."],
  ["check_listing_scam", "Scam score for any listing URL."],
  ["contact_landlord", "Reach the landlord and negotiate, with your approval."],
  ["get_deals", "Prices, offers and booked viewings."],
  ["ask_agent", "Talk to the whole agent in plain language."],
];

const SCAMS: Array<{ quote: string; tell: string }> = [
  { quote: "I'm currently out of the country for missionary work, so I can't show the unit in person.", tell: "Owner can't meet. The keys will be \"mailed\"." },
  { quote: "Send the first month by Zelle to hold it. I have a lot of interest.", tell: "Money before a viewing. Always no." },
  { quote: "1BR furnished, Ortega St, $1,100/mo, all utilities included.", tell: "Price far below the SF median for its type. Photos reused from another listing." },
];

// Art direction: square-ish crop on phones, 3:2 scene from 760px. From 1024px the
// scene is anchored right at its natural ratio, capped by the hero height (860 * 1.5).
const HERO_MOBILE_MEDIA = "(max-width: 759px)";
const HERO_DESKTOP_MEDIA = "(min-width: 760px)";
const HERO_DESKTOP_SIZES = "(min-width: 1024px) min(100vw, 1290px), 100vw";

function HeroPicture() {
  const common = { alt: "A friendly orange robot holds up a house key on a sunny San Francisco hill, with Victorian houses and two crossed-out listings behind it", priority: true };
  const { props: desktop } = getImageProps({ ...common, width: 1536, height: 1024, src: "/landing/hero.webp", sizes: HERO_DESKTOP_SIZES });
  const { props: mobile } = getImageProps({ ...common, width: 900, height: 838, src: "/landing/hero-mobile.webp", sizes: "100vw" });
  // getImageProps does not emit a preload; add one per breakpoint so the LCP image starts with the HTML.
  preload(mobile.src, { as: "image", imageSrcSet: mobile.srcSet, imageSizes: "100vw", media: HERO_MOBILE_MEDIA, fetchPriority: "high" });
  preload(desktop.src, { as: "image", imageSrcSet: desktop.srcSet, imageSizes: HERO_DESKTOP_SIZES, media: HERO_DESKTOP_MEDIA, fetchPriority: "high" });
  return (
    <picture className={s.heroPic}>
      <source media={HERO_MOBILE_MEDIA} srcSet={mobile.srcSet} sizes="100vw" />
      <source media={HERO_DESKTOP_MEDIA} srcSet={desktop.srcSet} sizes={HERO_DESKTOP_SIZES} />
      {/* eslint-disable-next-line jsx-a11y/alt-text -- alt comes from the spread props */}
      <img {...desktop} fetchPriority="high" />
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
              Tell it what you want to rent. It searches, blocks scams, calls the landlord, negotiates and books the viewing. You just show&nbsp;up.
            </p>
            <div className={s.ctaRow}>
              <Link href="/app" className={`${s.btn} ${s.btnPrimary} ${s.btnHero}`}>
                Open the app
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12h13m-5-6 6 6-6 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </Link>
              <a href="#agents" className={`${s.btn} ${s.btnGhost}`}>Connect your agent</a>
            </div>
          </div>
        </section>

        {/* ── Scroll story (how it works) ─────────────────── */}
        <ScrollStory />

        {/* ── Hear it negotiate ───────────────────────────── */}
        <section className={s.listen} aria-labelledby="listen-title">
          <div className={s.listenInner}>
            <h2 id="listen-title" className={s.h3}>Hear it negotiate.</h2>
            <NegotiationPlayer />
          </div>
        </section>

        <RedFlagMarquee />

        {/* ── Problem ──────────────────────────────────────── */}
        <section className={s.section} aria-labelledby="problem-title">
          <div className={s.problem}>
            <div className={s.problemText}>
              <h2 id="problem-title" className={s.h2}>Finding a short‑term place in SF is a&nbsp;part‑time job.</h2>
              <p>
                Hours on Craigslist. Landlords who never reply. Fake listings that want a Zelle deposit before you see the door.
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

        <HaloCards />

        <LiveDemos />

        {/* ── Agents ───────────────────────────────────────── */}
        <section id="agents" className={`${s.section} ${s.sectionDark}`} aria-labelledby="agents-title">
          <div className={s.agentsGrid}>
            <div>
              <h2 id="agents-title" className={s.h2}>Works from your AI agent too.</h2>
              <p className={s.subDark}>
                A remote MCP server for Claude, ChatGPT or any MCP client. Same guardrails.
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
              <AgentTerminal command={CLAUDE_CODE_CMD} />
              <div className={s.snippet}>
                <div className={s.snippetHead}><span>Claude or ChatGPT connector</span><CopyButton text={MCP_URL} className={s.copy} /></div>
                <pre><code>{MCP_URL}</code></pre>
                <p className={s.snippetNote}>Settings → Connectors → Add custom connector.</p>
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
              <p>No deposits, Zelle, wire or gift cards.</p>
            </li>
            <li>
              <h3>Message real Craigslist landlords on its own</h3>
              <p>You click Reply on Craigslist. No bots, no captchas.</p>
            </li>
            <li>
              <h3>Speak for you without your approval</h3>
              <p>Every outreach starts with your tap.</p>
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
