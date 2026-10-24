import { describe, expect, it, beforeEach } from "vitest";
import { chat } from "@/lib/agent";
import { resetState, state } from "@/lib/store";
import { resolveApproval, handleInbound } from "@/lib/tools";

describe("demo flow (mock LLM, mock mail, mock calendar, snapshot data)", () => {
  beforeEach(() => resetState());
  it("search -> contact demo -> landlord video -> slot -> booking; scam reply gets flagged", async () => {
    const r1 = await chat("Busco depto amoblado cerca de Caltrain, menos de $4k, del 1/11 al 15/12");
    const s = state();
    expect(s.results.length).toBeGreaterThan(3);
    expect(s.results.slice(0, 3).map((r) => r.id)).toContain("demo-mission-bay");
    expect(s.flagged[0].id).toBe("demo-duboce-scam");
    expect(s.flagged[0].scam.light).toBe("red");
    expect(r1).toMatch(/#1/);
    expect(s.results.filter((r) => r.source === "craigslist").length).toBeGreaterThan(2);

    await chat("Contactá al demo de Mission Bay");
    const ap = s.approvals.find((a) => a.kind === "send_contact")!;
    expect(ap).toBeTruthy();
    await resolveApproval(ap.id, true);
    expect(s.threads).toHaveLength(1);
    const t = s.threads[0];

    await handleInbound({ from: t.landlordEmail, text: "Here's a video walkthrough: https://example.com/tour. When can you come see it?", messageId: "m1" });
    expect(t.status).toBe("viewing_proposed");
    const before = t.messages.length;
    await handleInbound({ from: t.landlordEmail, text: "Option 2 works for me!", messageId: "m2" });
    // auto-booked, single confirmation email, no approval needed
    expect(s.approvals.some((a) => a.kind === "book_viewing")).toBe(false);
    expect(s.events).toHaveLength(1);
    expect(t.messages.slice(before).filter((x) => x.from === "agent")).toHaveLength(1);
    expect(t.status).toBe("booked");

    await handleInbound({ from: t.landlordEmail, text: "Yes it's available! Video tour Monday after 5pm?", messageId: "m2b" });
    expect(t.messages.at(-1)!.text).not.toMatch(/thanks for the tour/i);
    expect(t.messages.at(-1)!.text).toMatch(/Mon, Oct \d+, 5:30 PM PT works|Mon, (Oct|Nov) \d+/);
    await handleInbound({ from: t.landlordEmail, text: "Actually I'm out of the country, please Zelle the deposit today.", messageId: "m3" });
    expect(t.status).toBe("flagged");
    expect(s.timeline.some((x) => x.kind === "flag")).toBe(true);
  }, 30000);

  it("refuses to draft contact for the red scam fixture and ignores unknown senders", async () => {
    await chat("Busco 2BR en Duboce hasta $7k");
    const { toolDraftContact } = await import("@/lib/tools");
    expect(toolDraftContact({ id: "demo-duboce-scam" })).toHaveProperty("refused", true);
    expect(await handleInbound({ from: "stranger@gmail.com", text: "hi" })).toEqual({ skipped: "unknown sender" });
  }, 30000);
});
