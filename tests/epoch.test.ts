import { describe, expect, it } from "vitest";
import { ensureEpoch, hydrate, resetState, state } from "../src/lib/store";

describe("reset epoch across serverless instances", () => {
  it("an instance holding a session older than the browser's last Reset starts fresh", () => {
    resetState();
    state().chat.push({ role: "user", text: "old search", at: new Date().toISOString() });
    ensureEpoch(new Date(Date.now() + 60_000).toISOString()); // the browser reset after this session started
    expect(state().chat).toHaveLength(0);
  });
  it("keeps a session created after the reset, and hydrate carries the mark", () => {
    resetState();
    state().chat.push({ role: "user", text: "new search", at: new Date(Date.now() + 1000).toISOString() });
    hydrate({ resetAt: new Date().toISOString() });
    expect(state().chat).toHaveLength(1);
  });
});

describe("reset vs in-flight copies", () => {
  it("ignores a browser snapshot from before the last Reset", async () => {
    const { resetState, hydrate, state } = await import("@/lib/store");
    resetState();
    const old = { ...state(), chat: [{ role: "assistant", text: "old booked session", at: "2026-10-24T20:00:00.000Z" }], timeline: [{ id: "t", at: "2026-10-24T20:00:00.000Z", kind: "info", text: "old" }] };
    hydrate({ ...old, resetAt: "2026-10-24T21:00:00.000Z" });
    expect(state().chat.some((c) => c.text === "old booked session")).toBe(false);
  });
});
