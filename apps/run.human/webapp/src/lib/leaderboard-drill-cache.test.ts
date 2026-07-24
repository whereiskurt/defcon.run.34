import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getCachedDrill,
  bustDrillCache,
  __resetDrillCache,
  DRILL_CACHE_TTL_MS,
  DRILL_CACHE_MAX,
} from "@/lib/leaderboard-drill-cache";

/**
 * Per-user drill cache — Task 3, Step 3.
 *
 * Simple TTL+LRU (NOT stale-while-revalidate like leaderboard-cache.ts): a
 * drill is small, so blocking one request per user per minute is fine. Mirrors
 * `leaderboard-cache.test.ts`'s fake-timer style.
 */

beforeEach(() => {
  vi.useFakeTimers();
  __resetDrillCache();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("getCachedDrill", () => {
  it("fresh-loads once per userId", async () => {
    const loaderA = vi.fn(async () => "A");
    const loaderB = vi.fn(async () => "B");

    const a = await getCachedDrill("u1", loaderA);
    const b = await getCachedDrill("u2", loaderB);

    expect(a).toBe("A");
    expect(b).toBe("B");
    expect(loaderA).toHaveBeenCalledTimes(1);
    expect(loaderB).toHaveBeenCalledTimes(1);
  });

  it("a second call within TTL returns the cached value without calling the loader", async () => {
    const loader = vi.fn(async () => "data");
    await getCachedDrill("u1", loader);

    vi.setSystemTime(Date.now() + DRILL_CACHE_TTL_MS - 1);
    const out = await getCachedDrill("u1", loader);

    expect(out).toBe("data");
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("past TTL reloads via the loader", async () => {
    const loader = vi
      .fn()
      .mockResolvedValueOnce("first")
      .mockResolvedValueOnce("second");
    await getCachedDrill("u1", loader);

    vi.setSystemTime(Date.now() + DRILL_CACHE_TTL_MS + 1);
    const out = await getCachedDrill("u1", loader);

    expect(out).toBe("second");
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("bustDrillCache forces a reload for that user only", async () => {
    const loaderA = vi
      .fn()
      .mockResolvedValueOnce("a1")
      .mockResolvedValueOnce("a2");
    const loaderB = vi.fn(async () => "b1");

    await getCachedDrill("u1", loaderA);
    await getCachedDrill("u2", loaderB);

    bustDrillCache("u1");

    const outA = await getCachedDrill("u1", loaderA);
    const outB = await getCachedDrill("u2", loaderB);

    expect(outA).toBe("a2");
    expect(loaderA).toHaveBeenCalledTimes(2);
    expect(outB).toBe("b1");
    expect(loaderB).toHaveBeenCalledTimes(1);
  });

  it(`inserting ${DRILL_CACHE_MAX + 1} distinct users evicts the oldest`, async () => {
    for (let i = 0; i < DRILL_CACHE_MAX; i++) {
      await getCachedDrill(`user-${i}`, async () => i);
    }

    // One more distinct user pushes size past DRILL_CACHE_MAX -> evicts user-0
    // (the oldest by insertion order — none of the 500 have been re-read).
    await getCachedDrill(`user-${DRILL_CACHE_MAX}`, async () => DRILL_CACHE_MAX);

    const loaderEvicted = vi.fn(async () => -1);
    const outEvicted = await getCachedDrill("user-0", loaderEvicted);
    expect(outEvicted).toBe(-1);
    expect(loaderEvicted).toHaveBeenCalledTimes(1); // reloaded: it was evicted

    // A user well away from the eviction boundary (re-inserting the just-evicted
    // user-0 above re-triggers the cap and evicts the NEW oldest, user-1 — that
    // cascade is expected LRU behavior, so assert against an unaffected key).
    const loaderStillCached = vi.fn(async () => -2);
    const outStillCached = await getCachedDrill("user-250", loaderStillCached);
    expect(outStillCached).toBe(250);
    expect(loaderStillCached).not.toHaveBeenCalled(); // still cached
  });
});
