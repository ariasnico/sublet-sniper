import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import * as mail from "@/lib/mail";
import { mcpHandler, mcpContact, mcpCheckScam, withBearer } from "@/lib/mcp";
import { resetState, state, type Thread } from "@/lib/store";
import { negotiation } from "@/lib/deals";
import { deal } from "../src/app/ui/Inbox";
import { toolSearch } from "@/lib/tools";
import type { RankedListing } from "@/lib/types";

const LINK = "https://sfbay.craigslist.org/sfc/apa/d/san-francisco-move-in-ready-and/7989222615.html";
const html = readFileSync(new globalThis.URL("./fixtures/cl-7989222615.html", import.meta.url), "utf8");

let id = 0;
async function rpc(method: string, params: Record<string, unknown> = {}, headers: Record<string, string> = {}, handler = mcpHandler) {
  const res = await handler(new Request("http://localhost/api/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-06-18", ...headers },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
  }));
  const text = await res.text();
  const data = text.trimStart().startsWith("{") ? text : text.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5)).join("");
  return { status: res.status, body: data ? JSON.parse(data) : null };
}
const call = async (name: string, args: Record<string, unknown> = {}) => {
  const r = await rpc("tools/call", { name, arguments: args });
  expect(r.status).toBe(200);
  return r.body.result as { structuredContent: Record<string, unknown>; content: { text: string }[]; isError?: boolean };
};

describe("MCP server", () => {
  beforeEach(() => resetState());
  afterEach(() => { vi.restoreAllMocks(); delete process.env.MCP_TOKEN; });

  it("initializes and lists the five tools", async () => {
    const init = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "vitest", version: "0" } });
    expect(init.status).toBe(200);
    expect(init.body.result.serverInfo.name).toBe("sublet-sniper");
    const list = await rpc("tools/list");
    const names = (list.body.result.tools as { name: string }[]).map((t) => t.name).sort();
    expect(names).toEqual(["ask_agent", "check_listing_scam", "contact_landlord", "get_deals", "search_sublets"]);
  });

  it("search_sublets returns safe matches and the scams it caught (snapshot data)", async () => {
    const r = await call("search_sublets", { query: "furnished 1br near caltrain", maxBudget: 4000 });
    const out = r.structuredContent as { matches: { id: string; light: string; price: number | null; url: string }[]; scamsCaught: { count: number; examples: { id: string }[] } };
    expect(out.matches.length).toBeGreaterThan(2);
    expect(out.matches.every((m) => m.light !== "red" && m.url)).toBe(true);
    expect(out.matches.every((m) => m.price == null || m.price <= 4400)).toBe(true);
    expect(out.matches.map((m) => m.id)).toContain("demo-mission-bay");
    expect(out.scamsCaught.count).toBeGreaterThan(0);
    expect(out.scamsCaught.examples[0].id).toBe("demo-duboce-scam");
  }, 30000);

  it("check_listing_scam flags the $1,100 Ortega St 1BR as red with structured signals", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(html, { status: 200 }));
    const r = await call("check_listing_scam", { url: LINK });
    const out = r.structuredContent as { light: string; scamScore: number; verdict: string; signals: { label: string; median?: number }[] };
    expect(out.light).toBe("red");
    expect(out.scamScore).toBeGreaterThanOrEqual(50);
    expect(out.verdict).toMatch(/^RED \d+\/100/);
    expect(out.signals.some((s) => /median/.test(s.label) && s.median)).toBe(true);
  });

  it("check_listing_scam rejects non-Craigslist URLs without fetching", async () => {
    const f = vi.spyOn(globalThis, "fetch");
    const out = await mcpCheckScam({ url: "https://zillow.com/homedetails/123" });
    expect(out).toHaveProperty("error");
    expect(f).not.toHaveBeenCalled();
  });

  it("contact_landlord emails only the allowlisted demo landlord", async () => {
    const send = vi.spyOn(mail, "sendMail");
    await toolSearch({ query: "furnished 1br near caltrain under $4k" });
    const ok = await call("contact_landlord", { listingId: "demo-mission-bay" });
    expect(ok.structuredContent).toMatchObject({ sent: true, to: "landlord-demo@example.com" });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toBe("landlord-demo@example.com");
  }, 30000);

  it("contact_landlord never emails a non-allowlisted address (rogue demo listing, real Craigslist, red scam)", async () => {
    const send = vi.spyOn(mail, "sendMail");
    await toolSearch({ query: "furnished 1br near caltrain under $4k" });
    const s = state();
    const base = s.results.find((r) => r.id === "demo-mission-bay")!;
    const rogue: RankedListing = { ...base, id: "rogue", demo: { kind: "accomplice", landlordEmail: "real-person@gmail.com", note: "" } };
    s.results.unshift(rogue);
    const blocked = await mcpContact({ listingId: "rogue" });
    expect(blocked).toMatchObject({ sent: false, blocked: true });

    const cl = s.results.find((r) => r.source === "craigslist")!;
    const human = await mcpContact({ listingId: cl.id });
    expect(human).toMatchObject({ sent: false, humanActionRequired: true, url: cl.url });
    expect((human as { message: string }).message).toMatch(/Is it still available/);

    const red = await mcpContact({ listingId: "demo-duboce-scam" });
    expect(red).toMatchObject({ sent: false, refused: true });
    expect(send).not.toHaveBeenCalled();
    expect(s.threads).toHaveLength(0);
  }, 30000);

  it("get_deals and ask_agent reuse the web app state and agent", async () => {
    const a = await call("ask_agent", { message: "Busco 1BR amoblado en SF, menos de $4000" });
    expect((a.structuredContent as { reply: string }).reply).toMatch(/Pick one/);
    await call("contact_landlord", { listingId: "demo-mission-bay" });
    const d = (await call("get_deals")).structuredContent as { threads: { status: string; safetyChecks: unknown[] }[] };
    expect(d.threads).toHaveLength(1);
    expect(d.threads[0].status).toBe("awaiting_landlord");
    expect(d.threads[0].safetyChecks).toHaveLength(5);
  }, 30000);

  it("server-side negotiation read matches the UI deal bar", () => {
    const t: Thread = { id: "t", listingId: "l", listingTitle: "x", landlordEmail: "a@b.c", subject: "s", status: "active", askedProof: true, messages: [
      { from: "agent", text: "Hi, interested", at: "1" }, { from: "landlord", text: "It's $3,800 a month", at: "2" },
      { from: "agent", text: "My budget tops out at $4,000/mo; would you do $3,600/mo for Nov?", at: "3" }] };
    expect(negotiation(t)).toEqual(deal(t));
    expect(negotiation(t)).toEqual({ listed: null, asked: 3800, offered: 3600 });
  });

  it("requires the bearer token when MCP_TOKEN is set", async () => {
    process.env.MCP_TOKEN = "test-token";
    const guarded = withBearer(mcpHandler);
    expect((await rpc("tools/list", {}, {}, guarded)).status).toBe(401);
    expect((await rpc("tools/list", {}, { authorization: "Bearer wrong" }, guarded)).status).toBe(401);
    expect((await rpc("tools/list", {}, { authorization: "Bearer test-token" }, guarded)).status).toBe(200);
  });
});
