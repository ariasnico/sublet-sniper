import { describe, expect, it } from "vitest";
import { ensureEpoch, hydrate, resetState, state } from "../src/lib/store";

describe("reset epoch across serverless instances", () => {
  it("an instance holding a session older than the browser's last Reset starts fresh", () => {
    resetState();
    state().chat.push({ role: "user", text: "old search", at: "2026-10-24T10:00:00.000Z" });
    ensureEpoch("2026-10-24T11:00:00.000Z");
    expect(state().chat).toHaveLength(0);
  });
  it("keeps a session created after the reset, and hydrate carries the mark", () => {
    resetState();
    state().chat.push({ role: "user", text: "new search", at: new Date(Date.now() + 1000).toISOString() });
    hydrate({ resetAt: new Date().toISOString() });
    expect(state().chat).toHaveLength(1);
  });
});
