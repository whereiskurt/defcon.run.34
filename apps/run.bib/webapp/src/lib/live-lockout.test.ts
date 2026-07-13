import { describe, it, expect, vi, beforeEach } from "vitest";
import { assertNotLockedLive, __resetLiveLockoutCache } from "./live-lockout";

const claims = (lockedOut: boolean) => ({ services: [], linkedProviders: [], sessionVersion: 1, lockedOut });

describe("assertNotLockedLive", () => {
  beforeEach(() => __resetLiveLockoutCache());

  it("returns true (locked) when run.auth reports lockedOut", async () => {
    const f = vi.fn().mockResolvedValue(claims(true));
    expect(await assertNotLockedLive("sub-A", 1000, f)).toBe(true);
  });

  it("returns false when active", async () => {
    const f = vi.fn().mockResolvedValue(claims(false));
    expect(await assertNotLockedLive("sub-A", 1000, f)).toBe(false);
  });

  it("no authUserId → false (route's own auth decides), no fetch", async () => {
    const f = vi.fn();
    expect(await assertNotLockedLive(undefined, 1000, f)).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });

  it("FAIL-OPEN: a null (errored) lookup returns false and is NOT cached", async () => {
    const f = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(claims(true));
    expect(await assertNotLockedLive("sub-A", 1000, f)).toBe(false); // error → fail-open
    expect(await assertNotLockedLive("sub-A", 1000, f)).toBe(true);  // retried, not cached
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("caches within the TTL (one fetch), re-checks after it expires", async () => {
    const f = vi.fn().mockResolvedValue(claims(false));
    expect(await assertNotLockedLive("sub-A", 1000, f)).toBe(false);
    expect(await assertNotLockedLive("sub-A", 5000, f)).toBe(false); // 4s < 15s TTL → cached
    expect(f).toHaveBeenCalledTimes(1);
    // now the lock lands; still cached until TTL expires
    f.mockResolvedValue(claims(true));
    expect(await assertNotLockedLive("sub-A", 10000, f)).toBe(false); // 9s < 15s → stale-cached
    expect(await assertNotLockedLive("sub-A", 17000, f)).toBe(true);  // 16s > 15s → re-fetched, locked
    expect(f).toHaveBeenCalledTimes(2);
  });
});
