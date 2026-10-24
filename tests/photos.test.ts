import { afterEach, describe, expect, it, vi } from "vitest";
import { createPool } from "@/lib/pool";
import { cardThumb, isCraigslistUrl } from "@/lib/photo-url";
import { attachPhotos, listingPhotos } from "@/lib/photos";

describe("detail pool", () => {
  it("caps concurrency, spaces starts and survives failures", async () => {
    const run = createPool(2, 20);
    let active = 0, peak = 0;
    const starts: number[] = [];
    const t0 = Date.now();
    const task = (fail = false) => run(async () => {
      starts.push(Date.now() - t0); active++; peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 30));
      active--;
      if (fail) throw new Error("boom");
      return "ok";
    });
    const out = await Promise.allSettled([task(), task(true), task(), task(), task()]);
    expect(peak).toBe(2);
    expect(out.map((o) => o.status)).toEqual(["fulfilled", "rejected", "fulfilled", "fulfilled", "fulfilled"]);
    for (let i = 1; i < starts.length; i++) expect(starts[i] - starts[i - 1]).toBeGreaterThanOrEqual(15);
  });
});

describe("card photos", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("uses the 300x300 Craigslist variant for cards only", () => {
    expect(cardThumb("https://images.craigslist.org/00I0I_abc_0jm0ew_600x450.jpg")).toBe("https://images.craigslist.org/00I0I_abc_0jm0ew_300x300.jpg");
    expect(cardThumb("https://images.unsplash.com/photo-1?w=600&q=70")).toBe("https://images.unsplash.com/photo-1?w=600&q=70");
    expect(isCraigslistUrl("https://www.craigslist.org/view/d/x/abc")).toBe(true);
    expect(isCraigslistUrl("https://evil.example/craigslist.org")).toBe(false);
  });
  it("fetches each listing page once, even for concurrent requests, and attaches photos", async () => {
    const page = '<img src="https://images.craigslist.org/a_600x450.jpg"><img src="https://images.craigslist.org/b_600x450.jpg">';
    const fetchMock = vi.fn(async () => new Response(page));
    vi.stubGlobal("fetch", fetchMock);
    const url = "https://www.craigslist.org/view/d/test-photos/zzz1";
    const [a, b] = await Promise.all([listingPhotos(url), listingPhotos(url)]);
    expect(a).toEqual(["https://images.craigslist.org/a_600x450.jpg", "https://images.craigslist.org/b_600x450.jpg"]);
    expect(b).toEqual(a);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const rows = [{ source: "craigslist", url }, { source: "craigslist", url: "https://www.craigslist.org/view/d/never-fetched/zzz2" }];
    expect(await attachPhotos(rows)).toBe(1);
    expect(rows[0]).toHaveProperty("images", a);
    expect(rows[1]).not.toHaveProperty("images");
  });
});
