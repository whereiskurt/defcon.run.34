import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Reset seams for the strava_sync none→daily migration (2026-07-22).
 *
 * Covers the two service changes that make the policy flip safe with NO
 * manual row backfill:
 *  1. needsReset self-heal — a row created under "none" (no nextResetAt)
 *     resets on its first tier-aware access once the definition is periodic,
 *     picking up the new daily limit (24) and getting nextResetAt stamped.
 *  2. restoreQuota reads the row directly — a refund can never trigger the
 *     auto-reset path (which, tier-less, would reset a due quota to the
 *     "zero" tier's 0).
 */

const { getGoMock, patchSetGoMock, patchSetMock, createGoMock } = vi.hoisted(() => {
  const getGoMock = vi.fn();
  const patchSetGoMock = vi.fn(async () => ({}));
  const patchSetMock = vi.fn(() => ({ go: patchSetGoMock }));
  const createGoMock = vi.fn(async () => ({}));
  return { getGoMock, patchSetGoMock, patchSetMock, createGoMock };
});

vi.mock("@/entities/user-quota", () => ({
  UserQuota: {
    get: vi.fn(() => ({ go: getGoMock })),
    patch: vi.fn(() => ({ set: patchSetMock })),
    create: vi.fn(() => ({ go: createGoMock })),
  },
}));

import { getOrInitQuota, restoreQuota } from "./quota";
import { QUOTA_DEFINITIONS } from "@/lib/quota-definitions";

const legacyRow = {
  userId: "u1",
  quotaId: "strava_sync",
  remaining: 3,
  initialAmount: 16,
  totalConsumed: 13,
  consumptionCount: 13,
  lastResetAt: 1_700_000_000_000,
  // no nextResetAt — created while resetPolicy was "none"
};

beforeEach(() => {
  getGoMock.mockReset();
  patchSetMock.mockClear();
  patchSetGoMock.mockClear();
  createGoMock.mockClear();
});

describe("strava_sync definition", () => {
  it("is 24/day for upload tier, daily reset", () => {
    const def = QUOTA_DEFINITIONS.strava_sync;
    expect(def.tierLimits.upload).toBe(24);
    expect(def.resetPolicy).toBe("daily");
  });
});

describe("getOrInitQuota self-heal (none→daily migration)", () => {
  it("resets a legacy row (no nextResetAt) to the tier limit and stamps nextResetAt", async () => {
    const healed = {
      ...legacyRow,
      remaining: 24,
      initialAmount: 24,
      nextResetAt: Date.now() + 86_400_000,
    };
    // 1st get: legacy row → triggers reset (resetQuotaToTier patches, no get);
    // 2nd get is getOrInitQuota's post-reset refresh: healed row.
    getGoMock
      .mockResolvedValueOnce({ data: legacyRow })
      .mockResolvedValue({ data: healed });

    const out = await getOrInitQuota("u1", "strava_sync", "upload");

    // The reset patch carried the new daily limit AND a nextResetAt stamp.
    const patched = patchSetMock.mock.calls
      .map((c) => c[0] as Record<string, unknown>)
      .find((s) => s.initialAmount !== undefined);
    expect(patched).toBeDefined();
    expect(patched!.remaining).toBe(24);
    expect(patched!.initialAmount).toBe(24);
    expect(typeof patched!.nextResetAt).toBe("number");
    expect(out.remaining).toBe(24);
  });

  it("does NOT reset a row whose nextResetAt is in the future", async () => {
    const freshRow = { ...legacyRow, nextResetAt: Date.now() + 3_600_000 };
    getGoMock.mockResolvedValue({ data: freshRow });

    const out = await getOrInitQuota("u1", "strava_sync", "upload");

    expect(patchSetMock).not.toHaveBeenCalled();
    expect(out).toEqual(freshRow);
  });

  it("resets a row whose nextResetAt has passed", async () => {
    const dueRow = { ...legacyRow, nextResetAt: Date.now() - 1000 };
    getGoMock
      .mockResolvedValueOnce({ data: dueRow })
      .mockResolvedValue({ data: { ...dueRow, remaining: 24 } });

    await getOrInitQuota("u1", "strava_sync", "upload");

    expect(patchSetMock).toHaveBeenCalled();
  });

  it("never resets a 'none'-policy quota row lacking nextResetAt", async () => {
    const gpxRow = { ...legacyRow, quotaId: "gpx_upload", initialAmount: 100 };
    getGoMock.mockResolvedValue({ data: gpxRow });

    const out = await getOrInitQuota("u1", "gpx_upload", "upload");

    expect(patchSetMock).not.toHaveBeenCalled();
    expect(out).toEqual(gpxRow);
  });
});

describe("restoreQuota refund path", () => {
  it("tops up a reset-due legacy row WITHOUT triggering the zero-tier reset", async () => {
    getGoMock.mockResolvedValue({ data: legacyRow });

    const out = await restoreQuota("u1", "strava_sync", 1);

    // Exactly one patch: the top-up. No reset patch (which would carry
    // initialAmount) ever ran — the refund path cannot wipe the row to 0.
    expect(patchSetMock).toHaveBeenCalledTimes(1);
    const set = patchSetMock.mock.calls[0][0] as Record<string, unknown>;
    expect(set.remaining).toBe(4); // 3 + 1
    expect(set.initialAmount).toBeUndefined();
    expect(out.remaining).toBe(4);
  });

  it("caps the refund at the row's own initialAmount", async () => {
    getGoMock.mockResolvedValue({ data: { ...legacyRow, remaining: 16 } });

    const out = await restoreQuota("u1", "strava_sync", 5);

    expect(out.remaining).toBe(16);
  });
});
