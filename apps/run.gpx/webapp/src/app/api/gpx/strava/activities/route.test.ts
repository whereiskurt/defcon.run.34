import { describe, it, expect, vi, beforeEach } from "vitest";
import type { StravaActivity } from "@/lib/strava-sync";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  assertNotLockedLive: vi.fn(async () => false),
  consumeQuota: vi.fn(async () => ({ success: true, remaining: 15 })),
  restoreQuota: vi.fn(async () => ({})),
  fetchSingleUserStravaToken: vi.fn(),
  listActivitiesSince: vi.fn(
    async (_token: string, _after: number): Promise<StravaActivity[]> => []
  ),
  getExistingStravaIds: vi.fn(async () => new Set<string>()),
  logEvent: vi.fn(),
}));

vi.mock("@/config/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/live-lockout", () => ({ assertNotLockedLive: mocks.assertNotLockedLive }));
vi.mock("@/lib/quota-client", () => ({
  consumeQuota: mocks.consumeQuota,
  restoreQuota: mocks.restoreQuota,
}));
vi.mock("@/lib/strava-sync", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  fetchSingleUserStravaToken: mocks.fetchSingleUserStravaToken,
  listActivitiesSince: mocks.listActivitiesSince,
  getExistingStravaIds: mocks.getExistingStravaIds,
}));
vi.mock("@/lib/log-event", () => ({ logEvent: mocks.logEvent }));

import { GET } from "./route";

const sessionUser = {
  user: { id: "u1", email: "r@x.y", services: ["gpxstudio"], hasStrava: true },
};

function req() {
  return new Request("http://x/api/gpx/strava/activities");
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue(sessionUser);
  mocks.assertNotLockedLive.mockResolvedValue(false);
  mocks.consumeQuota.mockResolvedValue({ success: true, remaining: 15 });
  mocks.fetchSingleUserStravaToken.mockResolvedValue({
    userId: "u1",
    athleteId: "a1",
    accessToken: "tok",
  });
});

describe("GET /api/gpx/strava/activities", () => {
  it("401s with no session", async () => {
    mocks.auth.mockResolvedValue(null);
    expect((await GET(req())).status).toBe(401);
  });

  it("400s when Strava is not linked", async () => {
    mocks.auth.mockResolvedValue({
      user: { ...sessionUser.user, hasStrava: false },
    });
    expect((await GET(req())).status).toBe(400);
  });

  it("lists the last 7 days with imported flags", async () => {
    mocks.getExistingStravaIds.mockResolvedValue(new Set(["2"]));
    mocks.listActivitiesSince.mockResolvedValue([
      { id: 1, name: "A", type: "Run", sport_type: "Run", distance: 1000, total_elevation_gain: 0, start_date_local: "2026-07-20T06:00:00Z", moving_time: 300, map: { summary_polyline: "p1" } },
      { id: 2, name: "B", type: "Walk", sport_type: "Walk", distance: 2000, total_elevation_gain: 0, start_date_local: "2026-07-19T06:00:00Z", moving_time: 600, map: { summary_polyline: "p2" } },
      { id: 3, name: "Treadmill", type: "Run", sport_type: "Run", distance: 3000, total_elevation_gain: 0, start_date_local: "2026-07-18T06:00:00Z", moving_time: 900, map: { summary_polyline: "" } },
    ]);

    const res = await GET(req());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.activities.map((a: { id: number }) => a.id)).toEqual([1, 2]);
    expect(body.activities[1].imported).toBe(true);
    // Window: after ≈ now − 7d (unix seconds).
    const after = mocks.listActivitiesSince.mock.calls[0][1] as number;
    expect(after).toBeGreaterThan(Date.now() / 1000 - 7 * 86400 - 60);
    expect(after).toBeLessThanOrEqual(Date.now() / 1000 - 7 * 86400 + 60);
    expect(mocks.consumeQuota).toHaveBeenCalledWith("u1", "strava_sync", 1, "upload");
  });

  it("429s and does not call Strava when the burst quota is exhausted", async () => {
    mocks.consumeQuota.mockResolvedValue({ success: false, remaining: 0 });
    expect((await GET(req())).status).toBe(429);
    expect(mocks.listActivitiesSince).not.toHaveBeenCalled();
  });

  it("refunds the burst unit when the token is missing", async () => {
    mocks.fetchSingleUserStravaToken.mockResolvedValue(null);
    expect((await GET(req())).status).toBe(409);
    expect(mocks.restoreQuota).toHaveBeenCalledWith("u1", "strava_sync", 1);
  });
});
