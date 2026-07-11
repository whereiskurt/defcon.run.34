import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Unit tests for listQuotaByType (ADMN-04, Phase 43 Plan 01).
 *
 * listQuotaByType issues exactly ONE query over the existing byQuotaRemaining GSI
 * (pk = quotaId) and maps each row to the bulk shape consumed by run.human:
 *   { userId, consumptionCount, remaining, updatedAt }
 *
 * The `@/entities/user-quota` module is mocked so UserQuota.query.byQuotaRemaining(...)
 * returns a `.go` resolving to a fixed `data` fixture — no live DynamoDB. This mirrors
 * the injected-fake style used elsewhere in the suite (log-event.test.ts / the config
 * __tests__ dir) while exercising the mapping, the 0-default, the empty-result case,
 * and the single-query (no per-user fan-out) guarantee.
 */

const { goMock, byQuotaRemainingMock } = vi.hoisted(() => {
  const goMock = vi.fn();
  const byQuotaRemainingMock = vi.fn(() => ({ go: goMock }));
  return { goMock, byQuotaRemainingMock };
});

vi.mock("@/entities/user-quota", () => ({
  UserQuota: {
    query: {
      byQuotaRemaining: byQuotaRemainingMock,
    },
  },
}));

import { listQuotaByType } from "./quota";

describe("listQuotaByType", () => {
  beforeEach(() => {
    goMock.mockReset();
    byQuotaRemainingMock.mockClear();
  });

  it("maps every GSI row to { userId, consumptionCount, remaining, updatedAt }", async () => {
    goMock.mockResolvedValue({
      data: [
        {
          userId: "user-a",
          quotaId: "gpx_upload",
          remaining: 3,
          initialAmount: 5,
          consumptionCount: 2,
          updatedAt: 1000,
        },
        {
          userId: "user-b",
          quotaId: "gpx_upload",
          remaining: 0,
          initialAmount: 5,
          consumptionCount: 5,
          updatedAt: 2000,
        },
      ],
    });

    const result = await listQuotaByType("gpx_upload");

    expect(result).toEqual([
      { userId: "user-a", consumptionCount: 2, remaining: 3, updatedAt: 1000 },
      { userId: "user-b", consumptionCount: 5, remaining: 0, updatedAt: 2000 },
    ]);
  });

  it("defaults consumptionCount to 0 when the source row omits it", async () => {
    goMock.mockResolvedValue({
      data: [
        {
          userId: "user-c",
          quotaId: "gpx_upload",
          remaining: 4,
          initialAmount: 5,
          updatedAt: 3000,
        },
      ],
    });

    const result = await listQuotaByType("gpx_upload");

    expect(result).toEqual([
      { userId: "user-c", consumptionCount: 0, remaining: 4, updatedAt: 3000 },
    ]);
  });

  it("resolves to [] when the GSI returns no rows", async () => {
    goMock.mockResolvedValue({ data: [] });

    const result = await listQuotaByType("gpx_upload");

    expect(result).toEqual([]);
  });

  it("issues exactly ONE query on the byQuotaRemaining GSI (no per-user fan-out)", async () => {
    goMock.mockResolvedValue({ data: [] });

    await listQuotaByType("gpx_upload");

    expect(byQuotaRemainingMock).toHaveBeenCalledTimes(1);
    expect(byQuotaRemainingMock).toHaveBeenCalledWith({ quotaId: "gpx_upload" });
    expect(goMock).toHaveBeenCalledTimes(1);
    expect(goMock).toHaveBeenCalledWith({ pages: "all" });
  });
});
