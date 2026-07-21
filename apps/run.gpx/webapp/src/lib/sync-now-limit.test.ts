import { describe, it, expect } from "vitest";
import { SYNC_NOW_PER_DAY, syncNowRemaining, isSyncNowCapped } from "./sync-now-limit";

describe("sync-now-limit", () => {
  it("SYNC_NOW_PER_DAY is 2", () => {
    expect(SYNC_NOW_PER_DAY).toBe(2);
  });

  it("syncNowRemaining counts down from the cap", () => {
    expect(syncNowRemaining(0)).toBe(2);
    expect(syncNowRemaining(1)).toBe(1);
    expect(syncNowRemaining(2)).toBe(0);
  });

  it("syncNowRemaining never goes negative on overshoot", () => {
    expect(syncNowRemaining(5)).toBe(0);
  });

  it("syncNowRemaining clamps a negative count as zero used", () => {
    expect(syncNowRemaining(-3)).toBe(2);
  });

  it("isSyncNowCapped is false below the cap and true at/after it", () => {
    expect(isSyncNowCapped(0)).toBe(false);
    expect(isSyncNowCapped(1)).toBe(false);
    expect(isSyncNowCapped(2)).toBe(true);
    expect(isSyncNowCapped(3)).toBe(true);
  });
});
