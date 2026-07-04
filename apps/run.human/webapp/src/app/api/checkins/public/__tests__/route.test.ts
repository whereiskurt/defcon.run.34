import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetRecentCheckIns = vi.fn();
const mockGetRunUser = vi.fn();

vi.mock("@/entities/checkin", () => ({
  getRecentCheckIns: (...args: unknown[]) => mockGetRecentCheckIns(...args),
}));
vi.mock("@/entities/run-user", () => ({
  getRunUser: (...args: unknown[]) => mockGetRunUser(...args),
}));

import { GET } from "../route";

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
    mockGetRunUser.mockReset();
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
    mockGetRunUser.mockResolvedValue({ displayName: "rabbit_pub" });

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.checkIns).toHaveLength(1);
    expect(body.checkIns[0]).toEqual({
      lat: 36.13,
      lon: -115.15,
      displayName: "rabbit_pub",
      timestamp: 1751600000000,
      checkInType: "Basic",
    });
  });

  it("projects only the public fields — no userId, samples, or userAgent", async () => {
    mockGetRecentCheckIns.mockResolvedValueOnce({
      data: [checkIn({ isPrivate: false })],
      cursor: null,
    });
    mockGetRunUser.mockResolvedValue({ displayName: "rabbit_u1" });

    const body = await (await GET()).json();

    expect(Object.keys(body.checkIns[0]).sort()).toEqual([
      "checkInType",
      "displayName",
      "lat",
      "lon",
      "timestamp",
    ]);
  });

  it("falls back to an anonymous label when the display-name lookup fails", async () => {
    mockGetRecentCheckIns.mockResolvedValueOnce({
      data: [checkIn({ isPrivate: false })],
      cursor: null,
    });
    mockGetRunUser.mockRejectedValue(new Error("dynamo down"));

    const body = await (await GET()).json();

    expect(body.checkIns[0].displayName).toBe("a rabbit");
  });

  it("stops paging at the scan cap when everything is private", async () => {
    mockGetRecentCheckIns.mockResolvedValue({
      data: Array.from({ length: 100 }, (_, i) => checkIn({ userId: `u${i}` })),
      cursor: "more",
    });

    const body = await (await GET()).json();

    expect(body.checkIns).toHaveLength(0);
    // MAX_SCANNED (1000) / PAGE_SIZE (100) = 10 pages max.
    expect(mockGetRecentCheckIns).toHaveBeenCalledTimes(10);
  });

  it("returns 500 when the query fails", async () => {
    mockGetRecentCheckIns.mockRejectedValue(new Error("boom"));

    const res = await GET();

    expect(res.status).toBe(500);
  });
});
