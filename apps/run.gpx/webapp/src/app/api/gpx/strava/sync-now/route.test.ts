import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => {
  const syncNowGetGo = vi.fn(async (): Promise<{ data: { count: number } | null }> => ({
    data: null,
  }));
  const syncNowAddGo = vi.fn(async () => ({}));
  const syncNowGet = vi.fn(() => ({ go: syncNowGetGo }));
  const syncNowUpsert = vi.fn(() => ({ add: () => ({ go: syncNowAddGo }) }));

  return {
    auth: vi.fn(),
    assertNotLockedLive: vi.fn(async () => false),
    fetchSingleUserStravaToken: vi.fn(),
    syncUserUntagged: vi.fn(async () => ({ imported: 0, skipped: 0 })),
    logEvent: vi.fn(),
    reconcileBestEffort: vi.fn(),
    syncNowGetGo,
    syncNowAddGo,
    syncNowGet,
    syncNowUpsert,
  };
});

vi.mock("@/config/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/live-lockout", () => ({ assertNotLockedLive: mocks.assertNotLockedLive }));
vi.mock("@/lib/strava-sync", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  fetchSingleUserStravaToken: mocks.fetchSingleUserStravaToken,
  syncUserUntagged: mocks.syncUserUntagged,
}));
vi.mock("@/lib/log-event", () => ({ logEvent: mocks.logEvent }));
vi.mock("@/lib/gpx-reconcile", () => ({ reconcileBestEffort: mocks.reconcileBestEffort }));
vi.mock("@/entities/gpx-sync-now", () => ({
  GpxSyncNow: { get: mocks.syncNowGet, upsert: mocks.syncNowUpsert },
}));

import { POST } from "./route";

const sessionUser = {
  user: { id: "u1", email: "r@x.y", services: ["gpxstudio"], hasStrava: true },
};

function req() {
  return new Request("http://x/api/gpx/strava/sync-now", { method: "POST" });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue(sessionUser);
  mocks.assertNotLockedLive.mockResolvedValue(false);
  mocks.syncNowGetGo.mockResolvedValue({ data: null });
  mocks.fetchSingleUserStravaToken.mockResolvedValue({
    userId: "u1",
    athleteId: "a1",
    accessToken: "tok",
  });
  mocks.syncUserUntagged.mockResolvedValue({ imported: 0, skipped: 0 });
});

describe("POST /api/gpx/strava/sync-now", () => {
  it("401s with no session", async () => {
    mocks.auth.mockResolvedValue(null);
    expect((await POST(req())).status).toBe(401);
  });

  it("403s without the gpxstudio service", async () => {
    mocks.auth.mockResolvedValue({
      user: { ...sessionUser.user, services: [] },
    });
    expect((await POST(req())).status).toBe(403);
  });

  it("400s when Strava is not linked", async () => {
    mocks.auth.mockResolvedValue({
      user: { ...sessionUser.user, hasStrava: false },
    });
    expect((await POST(req())).status).toBe(400);
  });

  it("403s a locked-out account", async () => {
    mocks.assertNotLockedLive.mockResolvedValue(true);
    expect((await POST(req())).status).toBe(403);
  });

  it("429s at the daily cap without incrementing or syncing", async () => {
    mocks.syncNowGetGo.mockResolvedValue({ data: { count: 2 } });

    const res = await POST(req());
    const body = await res.json();

    expect(res.status).toBe(429);
    expect(body).toEqual({
      error: "Sync limit reached",
      message:
        "You've used both of today's syncs — the background sync runs at 10 AM and 10 PM anyway",
      remainingToday: 0,
    });
    expect(mocks.syncNowUpsert).not.toHaveBeenCalled();
    expect(mocks.syncUserUntagged).not.toHaveBeenCalled();
  });

  it("increments the counter BEFORE syncing", async () => {
    mocks.syncNowGetGo.mockResolvedValue({ data: { count: 0 } });

    const callOrder: string[] = [];
    mocks.syncNowAddGo.mockImplementation(async () => {
      callOrder.push("increment");
      return {};
    });
    mocks.syncUserUntagged.mockImplementation(async () => {
      callOrder.push("sync");
      return { imported: 1, skipped: 0 };
    });

    await POST(req());

    expect(callOrder).toEqual(["increment", "sync"]);
    expect(mocks.syncNowGet).toHaveBeenCalledWith({ userId: "u1", date: expect.any(String) });
    expect(mocks.syncNowUpsert).toHaveBeenCalledWith({ userId: "u1", date: expect.any(String) });
  });

  it("returns the happy-path shape with remainingToday counted down", async () => {
    mocks.syncNowGetGo.mockResolvedValue({ data: { count: 0 } });
    mocks.syncUserUntagged.mockResolvedValue({ imported: 3, skipped: 1 });

    const res = await POST(req());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, imported: 3, skipped: 1, remainingToday: 1 });
    expect(mocks.logEvent).toHaveBeenCalledWith(
      "gpx.strava.syncnow",
      expect.objectContaining({ meta: { imported: 3, skipped: 1 } })
    );
    // Task 4 (leaderboard<->runs reconcile trigger).
    expect(mocks.reconcileBestEffort).toHaveBeenCalledTimes(1);
    expect(mocks.reconcileBestEffort).toHaveBeenCalledWith("u1");
  });

  it("409s and does NOT restore the burned slot when the token is missing", async () => {
    mocks.syncNowGetGo.mockResolvedValue({ data: { count: 0 } });
    mocks.fetchSingleUserStravaToken.mockResolvedValue(null);

    const res = await POST(req());

    expect(res.status).toBe(409);
    expect(mocks.syncNowUpsert).toHaveBeenCalledTimes(1); // slot burned, not restored
    expect(mocks.reconcileBestEffort).not.toHaveBeenCalled();
  });

  it("500s and does NOT restore the burned slot when the sync throws", async () => {
    mocks.syncNowGetGo.mockResolvedValue({ data: { count: 0 } });
    mocks.syncUserUntagged.mockRejectedValue(new Error("boom"));

    const res = await POST(req());

    expect(res.status).toBe(500);
    expect(mocks.syncNowUpsert).toHaveBeenCalledTimes(1); // slot burned, not restored
    expect(mocks.reconcileBestEffort).not.toHaveBeenCalled();
  });

  it("admins bypass the counter entirely (remainingToday: 99)", async () => {
    mocks.auth.mockResolvedValue({
      user: { ...sessionUser.user, services: ["gpxstudio", "admin"] },
    });
    mocks.syncUserUntagged.mockResolvedValue({ imported: 0, skipped: 0 });

    const res = await POST(req());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.remainingToday).toBe(99);
    expect(mocks.syncNowGet).not.toHaveBeenCalled();
    expect(mocks.syncNowUpsert).not.toHaveBeenCalled();
  });
});
