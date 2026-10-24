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
