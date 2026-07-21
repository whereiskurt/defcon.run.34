import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  assertNotLockedLive: vi.fn(async () => false),
  consumeQuota: vi.fn(async () => ({ success: true, remaining: 90 })),
  restoreQuota: vi.fn(async () => ({})),
  fetchSingleUserStravaToken: vi.fn(),
  fetchActivityById: vi.fn(),
  importActivityForConDay: vi.fn(),
  getExistingStravaIds: vi.fn(async () => new Set<string>()),
  countConDayRuns: vi.fn(async () => 0),
  logEvent: vi.fn(),
}));

vi.mock("@/config/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/live-lockout", () => ({ assertNotLockedLive: mocks.assertNotLockedLive }));
vi.mock("@/lib/quota-client", () => ({
  consumeQuota: mocks.consumeQuota,
  restoreQuota: mocks.restoreQuota,
}));
vi.mock("@/lib/con-day-usage", () => ({ countConDayRuns: mocks.countConDayRuns }));
vi.mock("@/lib/strava-sync", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  fetchSingleUserStravaToken: mocks.fetchSingleUserStravaToken,
  fetchActivityById: mocks.fetchActivityById,
  importActivityForConDay: mocks.importActivityForConDay,
  getExistingStravaIds: mocks.getExistingStravaIds,
}));
vi.mock("@/lib/log-event", () => ({ logEvent: mocks.logEvent }));

import { POST } from "./route";

const sessionUser = {
  user: { id: "u1", email: "r@x.y", services: ["gpxstudio"], hasStrava: true },
};

function req(body: unknown) {
  return new Request("http://x/api/gpx/strava/import", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue(sessionUser);
  mocks.assertNotLockedLive.mockResolvedValue(false);
  mocks.consumeQuota.mockResolvedValue({ success: true, remaining: 90 });
  mocks.countConDayRuns.mockResolvedValue(0);
  mocks.getExistingStravaIds.mockResolvedValue(new Set());
  mocks.fetchSingleUserStravaToken.mockResolvedValue({
    userId: "u1", athleteId: "a1", accessToken: "tok",
  });
  mocks.fetchActivityById.mockResolvedValue({
    id: 7, name: "Run", type: "Run", sport_type: "Run", distance: 5000,
    total_elevation_gain: 0, start_date_local: "2026-08-07T06:00:00Z",
    moving_time: 1500, map: { summary_polyline: "p" },
  });
  mocks.importActivityForConDay.mockResolvedValue({ fileId: "f1", fileName: "Run.gpx" });
});

describe("POST /api/gpx/strava/import", () => {
  it("imports one activity tagged to the con day", async () => {
    const res = await POST(req({ activityId: 7, conDay: "2026-08-07" }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.file).toEqual({ fileId: "f1", fileName: "Run.gpx" });
    expect(body.conDayRemaining).toBe(9);
    expect(mocks.importActivityForConDay).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "u1" }),
      expect.objectContaining({ id: 7 }),
      "2026-08-07"
    );
    expect(mocks.consumeQuota).toHaveBeenCalledWith("u1", "gpx_upload", 1, "upload");
  });

  it("accepts ANY con day (no selectable/no-future gate)", async () => {
    // 2026-08-10 is the last con day — far future relative to test runtime.
    const res = await POST(req({ activityId: 7, conDay: "2026-08-10" }));
    expect(res.status).toBe(200);
  });

  it("400s a non-con-day for non-admins", async () => {
    expect((await POST(req({ activityId: 7, conDay: "2026-08-11" }))).status).toBe(400);
  });

  it("409s a duplicate without consuming upload quota", async () => {
    mocks.getExistingStravaIds.mockResolvedValue(new Set(["7"]));
    expect((await POST(req({ activityId: 7, conDay: "2026-08-07" }))).status).toBe(409);
    expect(mocks.consumeQuota).not.toHaveBeenCalledWith("u1", "gpx_upload", 1, "upload");
  });

  it("429s when the con day is capped", async () => {
    mocks.countConDayRuns.mockResolvedValue(10);
    expect((await POST(req({ activityId: 7, conDay: "2026-08-07" }))).status).toBe(429);
  });

  it("422s and refunds when the activity has no GPS streams", async () => {
    mocks.importActivityForConDay.mockResolvedValue(null);
    expect((await POST(req({ activityId: 7, conDay: "2026-08-07" }))).status).toBe(422);
    expect(mocks.restoreQuota).toHaveBeenCalledWith("u1", "gpx_upload", 1);
  });
});
