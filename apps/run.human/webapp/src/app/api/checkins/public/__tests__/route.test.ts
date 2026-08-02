import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetRecentCheckIns = vi.fn();
const mockBatchGet = vi.fn();

vi.mock("@/entities/checkin", () => ({
  getRecentCheckIns: (...args: unknown[]) => mockGetRecentCheckIns(...args),
}));
// Display names are joined with a BATCH get (one round-trip per 100 runners)
// rather than one get per runner — see the route's header note.
vi.mock("@/entities/run-user", () => ({
  RunUser: { get: (...args: unknown[]) => mockBatchGet(...args) },
}));
vi.mock("@/lib/cluster-config-store", () => ({
  getClusterConfig: async () => ({
    enabled: true,
    radiusMeters: 200,
    windowMinutes: 60,
    minRunners: 4,
    maxPerUserPerDay: 3,
    tiers: [{ minRunners: 4, points: 25 }],
  }),
}));

/** Resolve the batch get to these RunUser rows. */
function batchResolves(rows: Record<string, unknown>[]) {
  mockBatchGet.mockReturnValue({ go: async () => ({ data: rows }) });
}

import { GET } from "../route";
import type { NextRequest } from "next/server";

function request(query: string = ""): NextRequest {
  return {
    nextUrl: new URL(`http://localhost/api/checkins/public${query}`),
  } as unknown as NextRequest;
}

function checkIn(overrides: Record<string, unknown> = {}) {
  return {
    userId: "u1",
    checkInId: "c1",
    timestamp: 1751600000000,
    averageCoordinates: { latitude: 36.13, longitude: -115.15 },
    isPrivate: true,
    checkInType: "Basic",
    samples: [{ latitude: 36.13, longitude: -115.15, accuracy: 5, timestamp: 1 }],
    userAgent: "secret-agent",
    ...overrides,
  };
}

describe("GET /api/checkins/public", () => {
  beforeEach(() => {
    mockGetRecentCheckIns.mockReset();
    mockBatchGet.mockReset();
    batchResolves([]);
  });

  it("returns only check-ins explicitly marked public (isPrivate === false)", async () => {
    mockGetRecentCheckIns.mockResolvedValueOnce({
      data: [
        checkIn({ userId: "pub", isPrivate: false }),
        checkIn({ userId: "priv", isPrivate: true }),
        checkIn({ userId: "unset", isPrivate: undefined }),
      ],
      cursor: null,
    });
    batchResolves([{ userId: "pub", displayName: "rabbit_pub" }]);

    const res = await GET(request());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.checkIns).toHaveLength(1);
    expect(body.checkIns[0]).toMatchObject({
      lat: 36.13,
      lon: -115.15,
      displayName: "rabbit_pub",
      timestamp: 1751600000000,
      checkInType: "Basic",
    });
    // Opaque per-runner grouping key — never the raw userId.
    expect(body.checkIns[0].rid).toMatch(/^[0-9a-f]{12}$/);
    expect(body.checkIns[0].rid).not.toContain("pub");
  });

  it("gives the same runner a stable rid and different runners different ones", async () => {
    mockGetRecentCheckIns.mockResolvedValueOnce({
      data: [
        checkIn({ userId: "a", checkInId: "c1", isPrivate: false }),
        checkIn({ userId: "a", checkInId: "c2", isPrivate: false }),
        checkIn({ userId: "b", checkInId: "c3", isPrivate: false }),
      ],
      cursor: null,
    });
    batchResolves([]);

    const body = await (await GET(request())).json();

    expect(body.checkIns[0].rid).toBe(body.checkIns[1].rid);
    expect(body.checkIns[2].rid).not.toBe(body.checkIns[0].rid);
  });

  it("serves the live cluster config so the map matches the scoreboard's knobs", async () => {
    mockGetRecentCheckIns.mockResolvedValueOnce({
      data: [checkIn({ isPrivate: false })],
      cursor: null,
    });

    const body = await (await GET(request())).json();

    expect(body.clusterConfig).toEqual({
      enabled: true,
      radiusMeters: 200,
      windowMinutes: 60,
      minRunners: 4,
    });
    // Point tiers are deliberately NOT exposed: the map clusters PUBLIC
    // check-ins only, so an award value against its counts would be wrong.
    expect(body.clusterConfig.tiers).toBeUndefined();
  });

  it("projects only the public fields — no userId, samples, or userAgent", async () => {
    mockGetRecentCheckIns.mockResolvedValueOnce({
      data: [checkIn({ isPrivate: false })],
      cursor: null,
    });
    batchResolves([{ userId: "u1", displayName: "rabbit_u1" }]);

    const body = await (await GET(request())).json();

    expect(Object.keys(body.checkIns[0]).sort()).toEqual([
      "checkInType",
      "displayName",
      "lat",
      "lon",
      "rid",
      "timestamp",
    ]);
  });

  it("falls back to an anonymous label when the display-name lookup fails", async () => {
    mockGetRecentCheckIns.mockResolvedValueOnce({
      data: [checkIn({ isPrivate: false })],
      cursor: null,
    });
    mockBatchGet.mockReturnValue({
      go: async () => {
        throw new Error("dynamo down");
      },
    });

    const body = await (await GET(request())).json();

    expect(body.checkIns[0].displayName).toBe("a rabbit");
  });

  it("stops paging at the scan cap when everything is private", async () => {
    mockGetRecentCheckIns.mockResolvedValue({
      data: Array.from({ length: 100 }, (_, i) => checkIn({ userId: `u${i}` })),
      cursor: "more",
    });

    const body = await (await GET(request())).json();

    expect(body.checkIns).toHaveLength(0);
    // MAX_SCANNED (1000) / PAGE_SIZE (100) = 10 pages max.
    expect(mockGetRecentCheckIns).toHaveBeenCalledTimes(10);
  });

  it("returns 500 when the query fails", async () => {
    mockGetRecentCheckIns.mockRejectedValue(new Error("boom"));

    const res = await GET(request());

    expect(res.status).toBe(500);
  });

  it("projects pinIcon/pinColor when the check-in has them", async () => {
    mockGetRecentCheckIns.mockResolvedValueOnce({
      data: [
        checkIn({ isPrivate: false, pinIcon: "goldstar", pinColor: "#ffd700" }),
      ],
      cursor: null,
    });
    batchResolves([{ userId: "u1", displayName: "KPH" }]);

    const body = await (await GET(request())).json();

    expect(body.checkIns[0].pinIcon).toBe("goldstar");
    expect(body.checkIns[0].pinColor).toBe("#ffd700");
  });

  it("forwards a valid since= to the entity query and raises the caps", async () => {
    const since = Date.now() - 7 * 24 * 3600_000;
    mockGetRecentCheckIns.mockResolvedValue({
      data: Array.from({ length: 100 }, (_, i) => checkIn({ userId: `u${i}` })),
      cursor: "more",
    });

    await (await GET(request(`?since=${since}`))).json();

    expect(mockGetRecentCheckIns).toHaveBeenCalledWith(100, undefined, since);
    // MAX_SCANNED_WINDOWED (20000) / PAGE_SIZE (100) = 200 pages max. Raised
    // from 5000 because the feed pages NEWEST-first, so the old bound silently
    // dropped the con's first day once the event got busy.
    expect(mockGetRecentCheckIns).toHaveBeenCalledTimes(200);
  });

  it("flags a truncated response instead of passing it off as complete", async () => {
    mockGetRecentCheckIns.mockResolvedValue({
      data: Array.from({ length: 100 }, (_, i) =>
        checkIn({ userId: `u${i}`, isPrivate: false })
      ),
      cursor: "more",
    });

    const body = await (await GET(request(`?since=${Date.now() - 3600_000}`))).json();

    expect(body.truncated).toBe(true);
  });

  it("does not flag truncation when the feed was fully drained", async () => {
    mockGetRecentCheckIns.mockResolvedValueOnce({
      data: [checkIn({ isPrivate: false })],
      cursor: null,
    });

    const body = await (await GET(request())).json();

    expect(body.truncated).toBe(false);
  });

  it("ignores a since= older than the max window", async () => {
    const ancient = Date.now() - 365 * 24 * 3600_000;
    mockGetRecentCheckIns.mockResolvedValueOnce({ data: [], cursor: null });

    await (await GET(request(`?since=${ancient}`))).json();

    expect(mockGetRecentCheckIns).toHaveBeenCalledWith(100, undefined, undefined);
  });
});
