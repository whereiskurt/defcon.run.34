import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import {
  dedupeActivities,
  listActivitiesSince,
  listStripActivitiesBackfill,
  toStripActivities,
  runStravaSync,
  syncUserUntagged,
  type StravaActivity,
  type StravaUserToken,
} from "./strava-sync";

const mocks = vi.hoisted(() => ({
  s3Send: vi.fn(async () => ({})),
  fileCreate: vi.fn(async (_attrs: Record<string, unknown>) => ({})),
  fileQuery: vi.fn(async () => ({ data: [] as { stravaActivityId?: string }[] })),
}));

// logEvent is fire-and-forget telemetry; silence it so fetch mocks stay clean.
vi.mock("./log-event", () => ({ logEvent: vi.fn() }));
// Task 1 (syncUserUntagged) writes through GpxFile.create + S3 — first mock of
// these in this file, so importActivity's real (unmocked) body can run against
// real fetch stubs without touching AWS.
vi.mock("@/lib/s3-client", () => ({
  s3Client: { send: mocks.s3Send },
  BUCKET: "test-bucket",
  getUserPrefix: (userId: string) => `uploads/${userId}/gpx/`,
}));
vi.mock("@/entities/gpx-file", () => ({
  GpxFile: {
    query: { byCreatedAt: () => ({ go: mocks.fileQuery }) },
    create: (attrs: Record<string, unknown>) => ({
      go: () => mocks.fileCreate(attrs),
    }),
  },
}));

/**
 * Unit coverage for the dedupe seam of the per-user Strava sync (Phase 61).
 *
 * dedupeActivities is the correctness guard shared by both doors: a re-sync must
 * never re-import an activity already in the folder (keyed by stravaActivityId),
 * and it must preserve Strava's most-recent-first order for the ones it keeps.
 */
describe("dedupeActivities", () => {
  it("keeps only activities not already imported, preserving order", () => {
    const activities = [{ id: 3 }, { id: 2 }, { id: 1 }];
    const seen = new Set(["2"]); // id 2 already imported

    const { fresh, skipped } = dedupeActivities(activities, seen);

    expect(fresh.map((a) => a.id)).toEqual([3, 1]);
    expect(skipped).toBe(1);
  });

  it("skips everything when all are already imported", () => {
    const activities = [{ id: 10 }, { id: 11 }];
    const seen = new Set(["10", "11"]);

    const { fresh, skipped } = dedupeActivities(activities, seen);

    expect(fresh).toEqual([]);
    expect(skipped).toBe(2);
  });

  it("keeps everything when nothing has been imported", () => {
    const activities = [{ id: 1 }, { id: 2 }];

    const { fresh, skipped } = dedupeActivities(activities, new Set());

    expect(fresh).toEqual([{ id: 1 }, { id: 2 }]);
    expect(skipped).toBe(0);
  });

  it("matches numeric ids against string-keyed seen set (dedupe key type guard)", () => {
    // stravaActivityId is stored as a string on GpxFile; the activity id is a
    // number. The seen set is string-keyed, so the comparison must stringify.
    const { fresh, skipped } = dedupeActivities([{ id: 42 }], new Set(["42"]));

    expect(fresh).toEqual([]);
    expect(skipped).toBe(1);
  });

  it("is empty-safe", () => {
    const { fresh, skipped } = dedupeActivities([], new Set(["1"]));
    expect(fresh).toEqual([]);
    expect(skipped).toBe(0);
  });
});

function stravaResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "X-RateLimit-Usage": "1,10",
      "X-RateLimit-Limit": "200,2000",
    },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("listActivitiesSince", () => {
  it("passes the after param and paginates until a short page", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        calls.push(String(url));
        // First page full (50), second page short (1) → stop after 2 calls.
        const page = calls.length === 1 ? Array.from({ length: 50 }, (_, i) => ({ id: i })) : [{ id: 999 }];
        return stravaResponse(page);
      })
    );

    const out = await listActivitiesSince("tok", 1_754_000_000);

    expect(out).toHaveLength(51);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toContain("after=1754000000");
    expect(calls[0]).toContain("per_page=50");
  });

  it("returns [] when Strava rate-limits (429)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 429, headers: { "X-RateLimit-Usage": "999,999" } }))
    );
    expect(await listActivitiesSince("tok", 0)).toEqual([]);
  });
});

describe("toStripActivities", () => {
  const base: StravaActivity = {
    id: 1,
    name: "Morning Run",
    type: "Run",
    sport_type: "Run",
    distance: 5400,
    total_elevation_gain: 12,
    start_date_local: "2026-08-07T06:31:00Z",
    moving_time: 1890,
    map: { summary_polyline: "abc" },
  };

  it("maps fields, flags imported, and drops GPS-less activities", () => {
    const acts = [
      base,
      { ...base, id: 2, map: { summary_polyline: "" } }, // treadmill → dropped
      { ...base, id: 3, map: undefined }, // no map → dropped
      { ...base, id: 4 },
    ];
    const out = toStripActivities(acts, new Set(["4"]));
    expect(out.map((a) => a.id)).toEqual([1, 4]);
    expect(out[0]).toEqual({
      id: 1,
      name: "Morning Run",
      type: "Run",
      startDateLocal: "2026-08-07T06:31:00Z",
      distanceMeters: 5400,
      movingTimeSeconds: 1890,
      summaryPolyline: "abc",
      imported: false,
    });
    expect(out[1].imported).toBe(true);
  });
});

describe("listStripActivitiesBackfill", () => {
  const NOW = 1_760_000_000;
  const WEEK = 7 * 24 * 3600;

  function act(id: number, polyline: string | null): StravaActivity {
    return {
      id,
      name: `a${id}`,
      type: "Run",
      sport_type: "Run",
      distance: 1000,
      total_elevation_gain: 0,
      start_date_local: "2026-07-20T06:00:00Z",
      moving_time: 300,
      map: { summary_polyline: polyline },
    };
  }

  /** Stub fetch to serve one fixed batch per successive week call. */
  function stubWeeks(batches: StravaActivity[][]): string[] {
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        urls.push(String(url));
        return stravaResponse(batches[urls.length - 1] ?? []);
      })
    );
    return urls;
  }

  it("stops after one week when the threshold is already met", async () => {
    const urls = stubWeeks([[act(1, "p"), act(2, "p"), act(3, "p"), act(4, "p")]]);
    const out = await listStripActivitiesBackfill("tok", NOW);
    expect(out.weeks).toBe(1);
    expect(out.activities).toHaveLength(4);
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain(`after=${NOW - WEEK}`);
    expect(urls[0]).toContain(`before=${NOW}`);
  });

  it("extends week by week and keeps the WHOLE crossing week (3 + 7 = 10)", async () => {
    const week1 = [act(1, "p"), act(2, "p"), act(3, "p")];
    const week2 = Array.from({ length: 7 }, (_, i) => act(10 + i, "p"));
    const urls = stubWeeks([week1, week2]);
    const out = await listStripActivitiesBackfill("tok", NOW);
    expect(out.weeks).toBe(2);
    expect(out.activities).toHaveLength(10);
    expect(urls).toHaveLength(2);
    // Second call is the band [now-2w, now-1w) — no overlap with the first.
    expect(urls[1]).toContain(`after=${NOW - 2 * WEEK}`);
    expect(urls[1]).toContain(`before=${NOW - WEEK}`);
  });

  it("does not count GPS-less activities toward the threshold", async () => {
    const week1 = [act(1, "p"), act(2, "p"), act(3, "p"), act(4, "")];
    const week2 = [act(5, "p")];
    const urls = stubWeeks([week1, week2]);
    const out = await listStripActivitiesBackfill("tok", NOW);
    expect(out.weeks).toBe(2);
    expect(urls).toHaveLength(2);
  });

  it("caps the look-back at maxWeeks when history is empty", async () => {
    const urls = stubWeeks([]);
    const out = await listStripActivitiesBackfill("tok", NOW, 4, 8);
    expect(out.weeks).toBe(8);
    expect(out.activities).toEqual([]);
    expect(urls).toHaveLength(8);
  });
});

/**
 * bandBounds is private; exercised indirectly through runStravaSync's outbound
 * `/athlete/activities` URL (Task 1 — rolling sync window, 2026-07-21).
 */
describe("bandBounds rolling window (via runStravaSync)", () => {
  function stubTokenAndActivities(urls: string[]) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const u = String(url);
        if (u.includes("/api/internal/strava-tokens")) {
          return stravaResponse({
            tokens: [{ userId: "u1", athleteId: "a1", accessToken: "tok" }],
          });
        }
        urls.push(u);
        return stravaResponse([]); // empty page -> syncUser stops after one call
      })
    );
  }

  beforeEach(() => {
    vi.stubEnv("AUTH_INTERNAL_URL", "http://auth.local");
    vi.stubEnv("AUTH_INTERNAL_SECRET", "shh");
    // undefined (not "") so `INTERNAL_SYNC_SECRET ?? AUTH_INTERNAL_SECRET` falls
    // through to the stubbed AUTH_INTERNAL_SECRET above instead of short-circuiting.
    vi.stubEnv("INTERNAL_SYNC_SECRET", undefined);
    vi.stubEnv("STRAVA_SYNC_AFTER", "");
    vi.stubEnv("STRAVA_SYNC_BEFORE", "");
  });

  it("env STRAVA_SYNC_AFTER/BEFORE still win over the rolling default", async () => {
    vi.stubEnv("STRAVA_SYNC_AFTER", "1000");
    vi.stubEnv("STRAVA_SYNC_BEFORE", "2000");
    const urls: string[] = [];
    stubTokenAndActivities(urls);

    await runStravaSync();

    expect(urls[0]).toContain("after=1000");
    expect(urls[0]).toContain("before=2000");
  });

  it("falls back to a rolling 7-day window when neither env is set", async () => {
    const urls: string[] = [];
    stubTokenAndActivities(urls);
    const expectedAfter = Math.floor(Date.now() / 1000) - 7 * 86400;

    await runStravaSync();

    const match = urls[0].match(/after=(\d+)/);
    expect(match).not.toBeNull();
    expect(Math.abs(parseInt(match![1], 10) - expectedAfter)).toBeLessThan(5);
    expect(urls[0]).not.toContain("before=");
  });

  it("threads a custom afterDays through runStravaSync into the rolling window", async () => {
    const urls: string[] = [];
    stubTokenAndActivities(urls);
    const expectedAfter = Math.floor(Date.now() / 1000) - 3 * 86400;

    await runStravaSync(3);

    const match = urls[0].match(/after=(\d+)/);
    expect(match).not.toBeNull();
    expect(Math.abs(parseInt(match![1], 10) - expectedAfter)).toBeLessThan(5);
  });
});

describe("syncUserUntagged", () => {
  const user: StravaUserToken = {
    userId: "u1",
    athleteId: "a1",
    accessToken: "tok",
  };

  function activity(id: number): StravaActivity {
    return {
      id,
      name: `run-${id}`,
      type: "Run",
      sport_type: "Run",
      distance: 1000,
      total_elevation_gain: 5,
      start_date_local: "2026-07-20T06:00:00Z",
      moving_time: 300,
    };
  }

  function streamsResponse() {
    return stravaResponse({ latlng: { data: [[1, 2], [3, 4]] } });
  }

  /** Exact page-number match — "per_page=100" also contains the substring "page=1". */
  function pageOf(url: string): string | null {
    return new URL(url, "http://x").searchParams.get("page");
  }

  beforeEach(() => {
    mocks.fileQuery.mockReset().mockResolvedValue({ data: [] });
    mocks.fileCreate.mockClear();
    mocks.s3Send.mockClear();
  });

  it("dedupes already-imported activities and imports the rest untagged (no conDay, no quota calls)", async () => {
    mocks.fileQuery.mockResolvedValue({ data: [{ stravaActivityId: "2" }] });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const u = String(url);
        if (u.includes("/athlete/activities")) {
          return pageOf(u) === "1"
            ? stravaResponse([activity(1), activity(2)])
            : stravaResponse([]);
        }
        if (u.includes("/streams")) return streamsResponse();
        return stravaResponse({});
      })
    );

    const result = await syncUserUntagged(user, 1_700_000_000);

    expect(result).toEqual({ imported: 1, skipped: 1 });
    expect(mocks.fileCreate).toHaveBeenCalledTimes(1);
    const created = mocks.fileCreate.mock.calls[0][0] as Record<string, unknown>;
    expect(created.stravaActivityId).toBe("1");
    expect(created).not.toHaveProperty("conDay");
    expect(created.userId).toBe("u1");
  });

  it("bands the activity list on the after param with per_page 100", async () => {
    let capturedUrl = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const u = String(url);
        if (u.includes("/athlete/activities")) {
          capturedUrl = u;
          return stravaResponse([]);
        }
        return stravaResponse({});
      })
    );

    await syncUserUntagged(user, 1_700_000_000);

    expect(capturedUrl).toContain("after=1700000000");
    expect(capturedUrl).toContain("per_page=100");
  });

  it("caps imports at 30 per call and counts overflow as skipped", async () => {
    const activities = Array.from({ length: 35 }, (_, i) => activity(i + 1));
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const u = String(url);
        if (u.includes("/athlete/activities")) {
          return pageOf(u) === "1" ? stravaResponse(activities) : stravaResponse([]);
        }
        if (u.includes("/streams")) return streamsResponse();
        return stravaResponse({});
      })
    );

    const result = await syncUserUntagged(user, 1_700_000_000);

    expect(result.imported).toBe(30);
    expect(result.skipped).toBe(5);
    expect(mocks.fileCreate).toHaveBeenCalledTimes(30);
  });

  it("stops paginating once a page comes back empty (max 3 pages)", async () => {
    const pageUrls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const u = String(url);
        if (u.includes("/athlete/activities")) {
          pageUrls.push(u);
          return stravaResponse([]);
        }
        return stravaResponse({});
      })
    );

    await syncUserUntagged(user, 1_700_000_000);

    expect(pageUrls).toHaveLength(1);
  });
});
