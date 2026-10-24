import { timingSafeEqual } from "node:crypto";
import { createMcpHandler } from "mcp-handler";
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { chat } from "./agent";
import { mailLive, modes } from "./config";
import { gcalTemplateLink, negotiation, safetyChecks, THREAD_STATUS } from "./deals";
import { emailAllowed } from "./landlord";
import { syncThreads } from "./mailsync";
import { fetchListingPage } from "./sources/craigslist";
import { findListing, state } from "./store";
import { CL_URL, resolveApproval, toolAnalyzeUrl, toolDraftContact, toolSearch } from "./tools";
import type { ListingType, RankedListing, RawListing } from "./types";

/**
 * Sublet Sniper as an MCP server: the same capabilities as the web app, for AI agents.
 * Every tool is a thin adapter over src/lib/tools.ts / agent.ts, so the safety rules
 * (demo email allowlist, humans send Craigslist replies, red listings are never contacted) are shared.
 */

const VERDICT = { red: "HIGH scam risk: do not send money or personal info.", yellow: "Caution: verify with a live video tour before anything else.", green: "Looks legit: no strong scam signals." } as const;

const listingOut = (l: RankedListing) => ({
  id: l.id, title: l.title, price: l.priceMonthly, type: l.type, neighborhood: l.neighborhood ?? l.hood, furnished: l.furnished,
  dates: { from: l.availableFrom, to: l.availableTo }, scamScore: l.scam.score, light: l.scam.light, scamReasons: l.scam.reasons.slice(0, 3),
  url: l.url, photo: l.images?.[0] ?? null, demo: l.demo ? true : undefined,
});

// ---------------- tool implementations (plain functions, testable without HTTP) ----------------

export interface SearchInput { query?: string; maxBudget?: number; type?: Exclude<ListingType, "unknown">; furnished?: boolean; from?: string; to?: string; near?: string }

export async function mcpSearch(i: SearchInput) {
  const r = await toolSearch({ query: i.query ?? "", maxBudget: i.maxBudget, types: i.type ? [i.type] : undefined, furnished: i.furnished, from: i.from, to: i.to, near: i.near ? i.near.split(",").map((x) => x.trim()).filter(Boolean) : undefined });
  const s = state();
  const pick = (ids: { id: string }[], from: RankedListing[]) => ids.map((b) => from.find((l) => l.id === b.id)).filter((l): l is RankedListing => !!l).map(listingOut);
  const top = pick(r.top, s.results);
  return {
    source: `Craigslist ${r.mode}${s.searchReport ? `, ${s.searchReport.total} listings scanned` : ""}`,
    criteria: { maxBudget: r.criteria.maxBudget, types: r.criteria.types, furnished: r.criteria.furnished, from: r.criteria.from, to: r.criteria.to, near: r.criteria.near.map((n) => n.name) },
    matches: top,
    scamsCaught: { count: s.flagged.length, examples: s.flagged.slice(0, 3).map((l) => ({ id: l.id, title: l.title, price: l.priceMonthly, scamScore: l.scam.score, why: l.scam.reasons.slice(0, 2) })) },
    next: top.length ? "Use contact_landlord with a match id, or check_listing_scam with any Craigslist URL." : "No safe match: try a higher maxBudget or drop filters.",
  };
}

export async function mcpCheckScam(i: { url: string }, fetcher: (url: string) => Promise<RawListing> = fetchListingPage) {
  if (!CL_URL.test(i.url)) return { error: "Only Craigslist listing URLs (https://*.craigslist.org/...) are supported." };
  const r = await toolAnalyzeUrl({ url: i.url }, fetcher) as { error?: string; id?: string };
  if (r.error || !r.id) return { error: r.error ?? "could not analyze listing" };
  const l = findListing(r.id)!;
  return {
    id: l.id, title: l.title, price: l.priceMonthly, neighborhood: l.neighborhood ?? l.hood, url: l.url,
    scamScore: l.scam.score, light: l.scam.light,
    verdict: `${l.scam.light.toUpperCase()} ${l.scam.score}/100. ${VERDICT[l.scam.light]}${l.scam.reasons[0] ? ` Top signal: ${l.scam.reasons[0]}.` : ""}`,
    signals: (l.scam.signals ?? []).map((x) => ({ weight: x.w, label: x.label, quote: x.quote, median: x.median, price: x.price, duplicateOf: x.match ? { title: x.match.title, distance: x.match.distance } : undefined })),
    reasons: l.scam.reasons,
  };
}

/** Contacts a landlord. Email only to allowlisted demo addresses; Craigslist listings get a draft the human sends. */
export async function mcpContact(i: { listingId: string }) {
  if (!findListing(i.listingId)) await toolSearch({ query: "" }); // fresh serverless instance: rebuild results
  const l = findListing(i.listingId);
  if (!l) return { error: `Unknown listingId "${i.listingId}". Call search_sublets first and use an id from its matches.` };
  const email = l.demo?.landlordEmail;
  if (email && !emailAllowed(email)) return { sent: false, blocked: true, reason: "Recipient is not on the demo allowlist. Sublet Sniper only emails the demo landlord." };
  const d = toolDraftContact({ id: l.id });
  if ("error" in d) return { error: d.error };
  if ("refused" in d) return { sent: false, refused: true, reason: d.reason };
  const ap = state().approvals.find((a) => a.id === d.approvalId)!;
  if (ap.kind === "send_contact") {
    const res = await resolveApproval(ap.id, true);
    if ("error" in res) return { sent: false, blocked: true, reason: res.error };
    return { sent: true, to: email, listing: l.title, threadId: "threadId" in res ? res.threadId : undefined, message: ap.body, next: "The agent now handles replies (negotiation, safety checks, booking). Poll get_deals." };
  }
  return {
    sent: false, humanActionRequired: true, listing: l.title, url: l.url, message: ap.body,
    instructions: `Sublet Sniper never contacts real ${l.source === "x" ? "X" : "Craigslist"} landlords automatically. A human must open ${l.url}, click Reply, and paste this message.`,
  };
}

export async function mcpDeals() {
  if (mailLive()) await syncThreads(true).catch(() => []);
  const s = state();
  return {
    mail: modes().mail,
    threads: s.threads.map((t) => {
      const l = findListing(t.listingId);
      return {
        id: t.id, listing: t.listingTitle, landlord: t.landlordEmail, status: t.status, statusLabel: THREAD_STATUS[t.status],
        negotiation: negotiation(t, l), safetyChecks: safetyChecks(t, l), messages: t.messages.length,
        lastMessage: t.messages.at(-1) ? { from: t.messages.at(-1)!.from, text: t.messages.at(-1)!.text.slice(0, 280) } : null,
      };
    }),
    viewings: s.events.map((e) => ({ title: e.title, start: e.start, end: e.end, googleCalendarLink: gcalTemplateLink(e), calendarLink: e.link ?? null })),
    pendingApprovals: s.approvals.filter((a) => a.status === "pending").map((a) => ({ id: a.id, kind: a.kind, title: a.title })),
  };
}

export async function mcpAsk(i: { message: string }) {
  const reply = await chat(i.message);
  const s = state();
  return { reply, pendingApprovals: s.approvals.filter((a) => a.status === "pending").length, results: s.results.length };
}

// ---------------- MCP wiring ----------------

const result = (data: Record<string, unknown>) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  structuredContent: data,
  isError: typeof data.error === "string" ? true : undefined,
});

const INSTRUCTIONS = `Sublet Sniper finds safe short-term rentals (sublets, rooms, apartments) in San Francisco from live Craigslist, scam-scores every listing (green/yellow/red, 0-100), contacts landlords and books viewings.
Typical flow: search_sublets -> check_listing_scam (any pasted Craigslist URL) -> contact_landlord -> get_deals. Use ask_agent for anything else, in English or Spanish.
Rules: never tell the user to pay before a viewing. Real Craigslist landlords are contacted only by a human clicking Reply; only the labeled demo listing is emailed automatically.`;

export function registerSubletTools(server: McpServer) {
  server.registerTool("search_sublets", {
    title: "Search SF sublets",
    description: "Search live Craigslist San Francisco (plus demo fixtures) for sublets/rooms/apartments. Returns the top SAFE matches (id, title, $/month, neighborhood, scam score + light, url, photo) and a summary of scams caught. All filters are optional; `query` can be plain language (English or Spanish), e.g. \"furnished 1BR near Caltrain under $4k Nov 1 to Dec 15\".",
    inputSchema: z.object({
      query: z.string().optional().describe("What the renter wants, in their own words"),
      maxBudget: z.number().positive().optional().describe("Max rent in USD per month"),
      type: z.enum(["room", "studio", "1br", "2br", "3br+"]).optional(),
      furnished: z.boolean().optional(),
      from: z.string().optional().describe("Move-in date YYYY-MM-DD"),
      to: z.string().optional().describe("Move-out date YYYY-MM-DD"),
      near: z.string().optional().describe("Place(s) to be close to, comma-separated, e.g. \"Caltrain, UCSF\""),
    }),
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, async (args) => result(await mcpSearch(args)));

  server.registerTool("check_listing_scam", {
    title: "Scam-check a Craigslist listing",
    description: "Fetch one Craigslist listing URL and scam-score it: price vs SF median, wire/Zelle/out-of-country language, upfront money over 2x rent (CA AB 12), duplicated text/photos. Returns score 0-100, light (green/yellow/red), structured signals and a one-line verdict. Craigslist URLs only.",
    inputSchema: z.object({ url: z.string().describe("https://sfbay.craigslist.org/... listing URL") }),
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, async (args) => result(await mcpCheckScam(args)));

  server.registerTool("contact_landlord", {
    title: "Contact a landlord",
    description: "Send the renter's first message for a listing id from search_sublets. Only the labeled demo listing is emailed automatically (demo allowlist). For real Craigslist listings nothing is sent: you get the drafted message and the listing URL, and a human must click Reply on Craigslist. Red-flagged listings are refused.",
    inputSchema: z.object({ listingId: z.string().describe("Listing id from search_sublets matches") }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  }, async (args) => result(await mcpContact(args)));

  server.registerTool("get_deals", {
    title: "Get landlord deals",
    description: "Current landlord threads: status, price negotiation (listed / landlord asked / agent offered), safety checks (video tour, leaseholder, no money before viewing), booked viewings with an Add-to-Google-Calendar link, and pending approvals.",
    inputSchema: z.object({}),
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async () => result(await mcpDeals()));

  server.registerTool("ask_agent", {
    title: "Ask the Sublet Sniper agent",
    description: "Send a free-form message to the same rental agent as the web app chat (English or Spanish) and get its reply. Use for follow-ups like \"why is #2 red?\", \"what's the status?\" or pasting a listing link.",
    inputSchema: z.object({ message: z.string().min(1) }),
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  }, async (args) => result(await mcpAsk(args)));
}

export const mcpHandler = createMcpHandler(registerSubletTools, { serverInfo: { name: "sublet-sniper", version: "1.0.0" }, instructions: INSTRUCTIONS });

/** Optional static bearer auth: when MCP_TOKEN is set, require `Authorization: Bearer <MCP_TOKEN>`. Never logs tokens. */
export function withBearer(handler: (req: Request) => Promise<Response>) {
  return async (req: Request): Promise<Response> => {
    const want = process.env.MCP_TOKEN;
    if (want) {
      const got = req.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? "";
      const a = Buffer.from(got), b = Buffer.from(want);
      if (a.length !== b.length || !timingSafeEqual(a, b)) {
        return Response.json({ jsonrpc: "2.0", error: { code: -32001, message: "Unauthorized: send Authorization: Bearer <MCP_TOKEN>" }, id: null },
          { status: 401, headers: { "www-authenticate": 'Bearer realm="sublet-sniper"' } });
      }
    }
    return handler(req);
  };
}
