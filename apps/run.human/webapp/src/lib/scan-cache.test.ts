import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createScanCache, DEFAULT_SCAN_CACHE_TTL_MS } from "@/lib/scan-cache";

/**
 * The generic stale-while-revalidate scan cache behind the mesh-map feed and
 * `listCtf` (S-1 / S-2, DDB pressure audit).
 *
 * Covers the same four behaviors as `leaderboard-cache.test.ts` plus the two
 * properties this shape adds over `getCachedScan`:
 *   - COLD single-flight: N concurrent callers on an empty cache cause ONE scan
 *     (the ECS-rolling-replace thundering herd);
 *   - invalidate() is read-your-writes even against a scan already in flight.
 */

type Row = { id: string };

const rowsA: Row[] = [{ id: "a" }, { id: "b" }];
const rowsB: Row[] = [{ id: "c" }];

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("createScanCache", () => {
  it("cold populate: awaits the scan once and returns its rows", async () => {
    const scan = vi.fn(async () => rowsA);
    const cache = createScanCache<Row>("t", scan);

    expect(await cache.get()).toBe(rowsA);
    expect(scan).toHaveBeenCalledTimes(1);
  });

  it("within TTL: a second call serves the cache without re-scanning", async () => {
    const scan = vi.fn(async () => rowsA);
    const cache = createScanCache<Row>("t", scan);
    await cache.get();

    // Still fresh AT the TTL boundary (`>` not `>=`, matching leaderboard-cache).
    vi.setSystemTime(Date.now() + DEFAULT_SCAN_CACHE_TTL_MS);

    expect(await cache.get()).toBe(rowsA);
    expect(scan).toHaveBeenCalledTimes(1);
  });

  it("past TTL: serves stale immediately, refreshes in background, later serves new", async () => {
    let current = rowsA;
    const scan = vi.fn(async () => current);
    const cache = createScanCache<Row>("t", scan);
    await cache.get();

    current = rowsB;
    vi.setSystemTime(Date.now() + DEFAULT_SCAN_CACHE_TTL_MS + 1);

    // Stale rows come back synchronously ...
    expect(await cache.get()).toBe(rowsA);
    // ... but a background refresh was kicked.
    expect(scan).toHaveBeenCalledTimes(2);

    await vi.runAllTimersAsync();
    expect(await cache.get()).toBe(rowsB);
    expect(scan).toHaveBeenCalledTimes(2);
  });

  it("COLD single-flight: concurrent callers on an empty cache trigger ONE scan", async () => {
    let release: (r: Row[]) => void = () => {};
    const scan = vi.fn(
      () => new Promise<Row[]>((res) => (release = res))
    );
    const cache = createScanCache<Row>("t", scan);

    // Twenty viewers land on a cold container at the same instant.
    const all = Promise.all(Array.from({ length: 20 }, () => cache.get()));
    expect(scan).toHaveBeenCalledTimes(1);

    release(rowsA);
    const results = await all;
    expect(results.every((r) => r === rowsA)).toBe(true);
    expect(scan).toHaveBeenCalledTimes(1);
  });

  it("a failed cold scan rejects and does not latch — the next call retries", async () => {
    const scan = vi
      .fn<() => Promise<Row[]>>()
      .mockRejectedValueOnce(new Error("throttled"))
      .mockResolvedValueOnce(rowsA);
    const cache = createScanCache<Row>("t", scan);

    await expect(cache.get()).rejects.toThrow("throttled");
    expect(await cache.get()).toBe(rowsA);
    expect(scan).toHaveBeenCalledTimes(2);
  });

  it("a failed background refresh is swallowed and keeps serving stale rows", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const scan = vi
      .fn<() => Promise<Row[]>>()
      .mockResolvedValueOnce(rowsA)
      .mockRejectedValueOnce(new Error("throttled"));
    const cache = createScanCache<Row>("t", scan);
    await cache.get();

    vi.setSystemTime(Date.now() + DEFAULT_SCAN_CACHE_TTL_MS + 1);
    expect(await cache.get()).toBe(rowsA);
    await vi.runAllTimersAsync();

    // The refresh blew up, but the cache still answers with the last good rows.
    expect(await cache.get()).toBe(rowsA);
  });

  it("invalidate(): the next read re-scans and blocks", async () => {
    let current = rowsA;
    const scan = vi.fn(async () => current);
    const cache = createScanCache<Row>("t", scan);
    await cache.get();

    current = rowsB;
    cache.invalidate();

    // No TTL wait — the write path demands read-your-writes immediately.
    expect(await cache.get()).toBe(rowsB);
    expect(scan).toHaveBeenCalledTimes(2);
  });

  it("invalidate() beats a scan already in flight (no pre-write rows committed)", async () => {
    let release: (r: Row[]) => void = () => {};
    const scan = vi
      .fn<() => Promise<Row[]>>()
      // cold populate hangs until we release it
      .mockImplementationOnce(() => new Promise<Row[]>((res) => (release = res)))
      // the post-invalidate re-scan sees the written row
      .mockImplementation(async () => rowsB);
    const cache = createScanCache<Row>("t", scan);

    const cold = cache.get();
    // A write lands while that first scan is still out.
    cache.invalidate();
    // The in-flight scan now resolves carrying PRE-write rows.
    release(rowsA);
    await cold;

    // Those rows must not have been cached — the next read re-scans.
    expect(await cache.get()).toBe(rowsB);
    expect(scan).toHaveBeenCalledTimes(2);
  });
});
