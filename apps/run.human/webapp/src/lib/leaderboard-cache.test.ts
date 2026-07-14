import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { LEADERBOARD_CACHE_TTL_MS } from "@/lib/leaderboard-data";
import type { RunUserItem } from "@/entities/run-user";
import { getCachedScan, __resetLeaderboardCache } from "@/lib/leaderboard-cache";

/**
 * LDBR-07 (SC #3): the 60s in-memory stale-while-revalidate scan cache.
 *
 * Uses vitest fake timers for the clock and a `vi.fn` scan counter as the
 * injected fetcher, then proves the four cache behaviors:
 *   - Cold populate blocks once and returns the scanned rows (scan called 1x).
 *   - Within TTL serves the cached rows WITHOUT re-scanning (still 1x).
 *   - Past TTL serves STALE rows synchronously yet fires a background refresh
 *     (call count -> 2x); a later call sees the NEW rows.
 *   - Single-flight: a concurrent past-TTL call does not start a second scan.
 */

const rowsA: RunUserItem[] = [{ userId: "a" }, { userId: "b" }];
const rowsB: RunUserItem[] = [{ userId: "c" }, { userId: "d" }, { userId: "e" }];

beforeEach(() => {
  vi.useFakeTimers();
  __resetLeaderboardCache();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("getCachedScan (60s stale-while-revalidate)", () => {
  it("cold populate: awaits the scan once and returns its rows", async () => {
    const scan = vi.fn(async () => rowsA);
    const out = await getCachedScan(scan);
    expect(out).toBe(rowsA);
    expect(scan).toHaveBeenCalledTimes(1);
  });

  it("within TTL: a second call serves the cache without re-scanning", async () => {
    const scan = vi.fn(async () => rowsA);
    await getCachedScan(scan);

    // advance, but stay within the TTL (still fresh at exactly the TTL).
    vi.setSystemTime(Date.now() + LEADERBOARD_CACHE_TTL_MS);
    const out = await getCachedScan(scan);

    expect(out).toBe(rowsA);
    expect(scan).toHaveBeenCalledTimes(1);
  });

  it("past TTL: serves stale immediately, refreshes in the background, later serves new", async () => {
    let current = rowsA;
    const scan = vi.fn(async () => current);
    await getCachedScan(scan); // cold populate with rowsA
    expect(scan).toHaveBeenCalledTimes(1);

    // Point the scan at NEW rows and cross the TTL boundary.
    current = rowsB;
    vi.setSystemTime(Date.now() + LEADERBOARD_CACHE_TTL_MS + 1);

    // The past-TTL call returns the OLD (stale) rows synchronously ...
    const stale = await getCachedScan(scan);
    expect(stale).toBe(rowsA);
    // ... yet has kicked a background refresh (call count now 2).
    expect(scan).toHaveBeenCalledTimes(2);

    // Let the background refresh settle, then a later call sees the NEW rows.
    await vi.runAllTimersAsync();
    const fresh = await getCachedScan(scan);
    expect(fresh).toBe(rowsB);
    // The later within-TTL read did not scan again.
    expect(scan).toHaveBeenCalledTimes(2);
  });

  it("single-flight: a concurrent past-TTL call does not start a second scan", async () => {
    let resolveRefresh: (r: RunUserItem[]) => void = () => {};
    const scan = vi
      .fn()
      // cold populate resolves immediately with rowsA
      .mockImplementationOnce(async () => rowsA)
      // the refresh hangs until we resolve it manually
      .mockImplementationOnce(
        () => new Promise<RunUserItem[]>((res) => (resolveRefresh = res))
      );

    await getCachedScan(scan); // populate
    vi.setSystemTime(Date.now() + LEADERBOARD_CACHE_TTL_MS + 1);

    // First past-TTL call starts the (hanging) refresh.
    const first = await getCachedScan(scan);
    expect(first).toBe(rowsA);
    expect(scan).toHaveBeenCalledTimes(2);

    // A concurrent past-TTL call while the refresh is in flight: no new scan.
    const second = await getCachedScan(scan);
    expect(second).toBe(rowsA);
    expect(scan).toHaveBeenCalledTimes(2);

    // Finish the in-flight refresh; the guard clears and new data lands.
    resolveRefresh(rowsB);
    await vi.runAllTimersAsync();
    const third = await getCachedScan(scan);
    expect(third).toBe(rowsB);
  });
});
