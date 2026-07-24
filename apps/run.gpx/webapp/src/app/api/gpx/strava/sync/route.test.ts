import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  assertNotLockedLive: vi.fn(async () => false),
  isSelectableConDay: vi.fn(() => true),
  countConDayRuns: vi.fn(async () => 0),
  consumeQuota: vi.fn(async () => ({ success: true, remaining: 90 })),
  restoreQuota: vi.fn(async () => ({})),
  fetchSingleUserStravaToken: vi.fn(),
  syncUserToConDay: vi.fn(),
  logEvent: vi.fn(),
  reconcileBestEffort: vi.fn(),
}));

vi.mock("@/config/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/live-lockout", () => ({ assertNotLockedLive: mocks.assertNotLockedLive }));
// Keep isConDay/isValidDateString REAL (pure) so con-day-set/format checks stay
// meaningful; only isSelectableConDay is stubbed so a non-admin test isn't at
// the mercy of the real August 2026 con dates being in the future relative to
// whenever this suite happens to run.
vi.mock("@/lib/con-days", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  isSelectableConDay: mocks.isSelectableConDay,
}));
vi.mock("@/lib/con-day-usage", () => ({ countConDayRuns: mocks.countConDayRuns }));
vi.mock("@/lib/quota-client", () => ({
  consumeQuota: mocks.consumeQuota,
  restoreQuota: mocks.restoreQuota,
}));
vi.mock("@/lib/strava-sync", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  fetchSingleUserStravaToken: mocks.fetchSingleUserStravaToken,
  syncUserToConDay: mocks.syncUserToConDay,
}));
vi.mock("@/lib/log-event", () => ({ logEvent: mocks.logEvent }));
vi.mock("@/lib/gpx-reconcile", () => ({ reconcileBestEffort: mocks.reconcileBestEffort }));

import { POST } from "./route";

const sessionUser = {
  user: { id: "u1", email: "r@x.y", services: ["gpxstudio"], hasStrava: true },
};

const conDay = "2026-08-07";

function req(body: unknown) {
  return new Request("http://x/api/gpx/strava/sync", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue(sessionUser);
  mocks.assertNotLockedLive.mockResolvedValue(false);
  mocks.isSelectableConDay.mockReturnValue(true);
  mocks.countConDayRuns.mockResolvedValue(0);
  mocks.consumeQuota.mockResolvedValue({ success: true, remaining: 90 });
  mocks.restoreQuota.mockResolvedValue({});
  mocks.fetchSingleUserStravaToken.mockResolvedValue({
    userId: "u1",
    athleteId: "a1",
    accessToken: "tok",
  });
  mocks.syncUserToConDay.mockResolvedValue({
    imported: 0,
    skipped: 0,
    conDayRemaining: 10,
    quotaRemaining: null,
    files: [],
  });
});

describe("POST /api/gpx/strava/sync", () => {
  it("401s with no session", async () => {
    mocks.auth.mockResolvedValue(null);
    expect((await POST(req({ conDay }))).status).toBe(401);
  });

  it("403s without the gpxstudio service", async () => {
    mocks.auth.mockResolvedValue({
      user: { ...sessionUser.user, services: [] },
    });
    expect((await POST(req({ conDay }))).status).toBe(403);
  });

  it("400s when Strava is not linked", async () => {
    mocks.auth.mockResolvedValue({
      user: { ...sessionUser.user, hasStrava: false },
    });
    expect((await POST(req({ conDay }))).status).toBe(400);
  });

  it("403s a locked-out account", async () => {
    mocks.assertNotLockedLive.mockResolvedValue(true);
    expect((await POST(req({ conDay }))).status).toBe(403);
  });

  it("400s an unparseable body", async () => {
    const res = await POST(
      new Request("http://x/api/gpx/strava/sync", { method: "POST", body: "not json" })
    );
    expect(res.status).toBe(400);
  });

  it("400s when conDay is not a string", async () => {
    expect((await POST(req({ conDay: 123 }))).status).toBe(400);
  });

  it("400s a non-con-day for non-admins", async () => {
    expect((await POST(req({ conDay: "2026-09-01" }))).status).toBe(400);
  });

  it("400s a future con-day for non-admins", async () => {
    mocks.isSelectableConDay.mockReturnValue(false);
    expect((await POST(req({ conDay }))).status).toBe(400);
  });

  it("429s at the con-day cap without consuming the burst quota", async () => {
    mocks.countConDayRuns.mockResolvedValue(10);

    const res = await POST(req({ conDay }));

    expect(res.status).toBe(429);
    expect(mocks.consumeQuota).not.toHaveBeenCalled();
    expect(mocks.reconcileBestEffort).not.toHaveBeenCalled();
  });

  it("429s when the burst quota is exhausted", async () => {
    mocks.consumeQuota.mockResolvedValue({ success: false, remaining: 0 });

    const res = await POST(req({ conDay }));

    expect(res.status).toBe(429);
    expect(mocks.reconcileBestEffort).not.toHaveBeenCalled();
  });

  it("syncs successfully and fires reconcileBestEffort(session.user.id)", async () => {
    mocks.syncUserToConDay.mockResolvedValue({
      imported: 2,
      skipped: 0,
      conDayRemaining: 8,
      quotaRemaining: 88,
      files: [{ fileId: "f1", fileName: "a.gpx" }],
    });

    const res = await POST(req({ conDay }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({
      ok: true,
      imported: 2,
      skipped: 0,
      conDayRemaining: 8,
      quotaRemaining: 88,
      files: [{ fileId: "f1", fileName: "a.gpx" }],
    });
    expect(mocks.logEvent).toHaveBeenCalledWith(
      "gpx.strava.sync",
      expect.objectContaining({ meta: { imported: 2, skipped: 0, conDay } })
    );
    // Task 4 (leaderboard<->runs reconcile trigger).
    expect(mocks.reconcileBestEffort).toHaveBeenCalledTimes(1);
    expect(mocks.reconcileBestEffort).toHaveBeenCalledWith("u1");
  });

  it("409s and restores the burst unit when the token is missing, without firing reconcile", async () => {
    mocks.fetchSingleUserStravaToken.mockResolvedValue(null);

    const res = await POST(req({ conDay }));

    expect(res.status).toBe(409);
    expect(mocks.restoreQuota).toHaveBeenCalledWith("u1", "strava_sync", 1);
    expect(mocks.reconcileBestEffort).not.toHaveBeenCalled();
  });

  it("500s and restores the burst unit when the sync throws, without firing reconcile", async () => {
    mocks.syncUserToConDay.mockRejectedValue(new Error("boom"));

    const res = await POST(req({ conDay }));

    expect(res.status).toBe(500);
    expect(mocks.restoreQuota).toHaveBeenCalledWith("u1", "strava_sync", 1);
    expect(mocks.reconcileBestEffort).not.toHaveBeenCalled();
  });

  it("admins can sync any valid calendar date (bypasses con-day set + future gate)", async () => {
    mocks.auth.mockResolvedValue({
      user: { ...sessionUser.user, services: ["gpxstudio", "admin"] },
    });

    const res = await POST(req({ conDay: "2026-12-25" }));

    expect(res.status).toBe(200);
  });
});
