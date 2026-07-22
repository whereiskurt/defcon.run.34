import { describe, it, expect, vi, beforeEach } from "vitest";
import type { StravaActivity } from "@/lib/strava-sync";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  assertNotLockedLive: vi.fn(async () => false),
  consumeQuota: vi.fn(async () => ({ success: true, remaining: 15 })),
  restoreQuota: vi.fn(async () => ({})),
  fetchSingleUserStravaToken: vi.fn(),
  listStripActivitiesBackfill: vi.fn(
    async (
      _token: string,
      _now: number
    ): Promise<{ activities: StravaActivity[]; weeks: number }> => ({
      activities: [],
      weeks: 1,
    })
  ),
  getStravaFileIndex: vi.fn(
    async () => new Map<string, { fileId: string; conDay?: string }>()
  ),
  readStripCache: vi.fn(
    async (): Promise<{
      activities: StravaActivity[];
      weeks: number;
      fetchedAt: number;
    } | null> => null
  ),
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
  listStripActivitiesBackfill: mocks.listStripActivitiesBackfill,
  getStravaFileIndex: mocks.getStravaFileIndex,
  readStripCache: mocks.readStripCache,
  // The route's live-fetch path goes through refreshStripCache (fetch +
  // write-through); delegate to the backfill mock and skip the cache write so
  // the existing live-path assertions keep observing the Strava call shape.
  refreshStripCache: vi.fn(async (_userId: string, token: string, now: number) =>
    mocks.listStripActivitiesBackfill(token, now)
  ),
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
  mocks.readStripCache.mockResolvedValue(null);
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

  it("lists backfilled activities with imported flags and the weeks spanned", async () => {
    mocks.getStravaFileIndex.mockResolvedValue(
      new Map([["2", { fileId: "file-2", conDay: "2026-08-07" }]])
    );
    mocks.listStripActivitiesBackfill.mockResolvedValue({
      activities: [
        { id: 1, name: "A", type: "Run", sport_type: "Run", distance: 1000, total_elevation_gain: 0, start_date_local: "2026-07-20T06:00:00Z", moving_time: 300, map: { summary_polyline: "p1" } },
        { id: 2, name: "B", type: "Walk", sport_type: "Walk", distance: 2000, total_elevation_gain: 0, start_date_local: "2026-07-19T06:00:00Z", moving_time: 600, map: { summary_polyline: "p2" } },
        { id: 3, name: "Treadmill", type: "Run", sport_type: "Run", distance: 3000, total_elevation_gain: 0, start_date_local: "2026-07-18T06:00:00Z", moving_time: 900, map: { summary_polyline: "" } },
      ],
      weeks: 2,
    });

    const res = await GET(req());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.activities.map((a: { id: number }) => a.id)).toEqual([1, 2]);
    expect(body.activities[1].imported).toBe(true);
    expect(body.activities[1].fileId).toBe("file-2");
    expect(body.activities[1].conDay).toBe("2026-08-07");
    expect(body.activities[0].imported).toBe(false);
    expect(body.activities[0].fileId).toBeUndefined();
    expect(body.activities[0].conDay).toBeUndefined();
    expect(body.weeks).toBe(2);
    // The route passes "now" (unix seconds); the window itself is a server-side
    // constant inside listStripActivitiesBackfill — nothing client-supplied.
    const nowArg = mocks.listStripActivitiesBackfill.mock.calls[0][1] as number;
    expect(Math.abs(nowArg - Date.now() / 1000)).toBeLessThan(60);
    expect(mocks.consumeQuota).toHaveBeenCalledWith("u1", "strava_sync", 1, "upload");
  });

  it("returns conDay: null for an imported activity that has not been tagged", async () => {
    mocks.getStravaFileIndex.mockResolvedValue(
      new Map([["1", { fileId: "file-1" }]])
    );
    mocks.listStripActivitiesBackfill.mockResolvedValue({
      activities: [
        { id: 1, name: "A", type: "Run", sport_type: "Run", distance: 1000, total_elevation_gain: 0, start_date_local: "2026-07-20T06:00:00Z", moving_time: 300, map: { summary_polyline: "p1" } },
      ],
      weeks: 1,
    });

    const res = await GET(req());
    const body = await res.json();

    expect(body.activities[0].imported).toBe(true);
    expect(body.activities[0].fileId).toBe("file-1");
    expect(body.activities[0].conDay).toBeNull();
  });

  it("429s and does not call Strava when the burst quota is exhausted", async () => {
    mocks.consumeQuota.mockResolvedValue({ success: false, remaining: 0 });
    expect((await GET(req())).status).toBe(429);
    expect(mocks.listStripActivitiesBackfill).not.toHaveBeenCalled();
  });

  it("refunds the burst unit when the token is missing", async () => {
    mocks.fetchSingleUserStravaToken.mockResolvedValue(null);
    expect((await GET(req())).status).toBe(409);
    expect(mocks.restoreQuota).toHaveBeenCalledWith("u1", "strava_sync", 1);
  });

  it("serves a cached snapshot for FREE — no quota, no Strava — with live-joined flags", async () => {
    mocks.readStripCache.mockResolvedValue({
      activities: [
        { id: 1, name: "A", type: "Run", sport_type: "Run", distance: 1000, total_elevation_gain: 0, start_date_local: "2026-07-20T06:00:00Z", moving_time: 300, map: { summary_polyline: "p1" } },
      ],
      weeks: 3,
      fetchedAt: 1_753_000_000_000,
    });
    // The join is LIVE even on the cached path: a fresh import shows up
    // immediately without a Strava refetch.
    mocks.getStravaFileIndex.mockResolvedValue(
      new Map([["1", { fileId: "file-1", conDay: "2026-08-07" }]])
    );

    const res = await GET(req());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.cached).toBe(true);
    expect(body.fetchedAt).toBe(1_753_000_000_000);
    expect(body.weeks).toBe(3);
    expect(body.activities[0].imported).toBe(true);
    expect(body.activities[0].conDay).toBe("2026-08-07");
    expect(mocks.consumeQuota).not.toHaveBeenCalled();
    expect(mocks.listStripActivitiesBackfill).not.toHaveBeenCalled();
  });

  it("?refresh=1 bypasses the cache and does a quota-gated live fetch", async () => {
    mocks.readStripCache.mockResolvedValue({
      activities: [],
      weeks: 1,
      fetchedAt: 1,
    });

    const res = await GET(new Request("http://x/api/gpx/strava/activities?refresh=1"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.cached).toBe(false);
    expect(mocks.readStripCache).not.toHaveBeenCalled();
    expect(mocks.consumeQuota).toHaveBeenCalledWith("u1", "strava_sync", 1, "upload");
    expect(mocks.listStripActivitiesBackfill).toHaveBeenCalled();
  });
});
