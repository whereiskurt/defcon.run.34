# Strava Strip + Con-Day Save + My DEF CON Runs Layer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In run.gpx: a bottom-docked carousel of the runner's last-7-days Strava activities importable one-at-a-time with a con-day confirm popover; a "Save as defcon.run Activity" con-day dialog on any file; and a read-only "My DEF CON Runs" map layer grouped by con day.

**Architecture:** Two new session-authenticated API routes (`GET /api/gpx/strava/activities`, `POST /api/gpx/strava/import`) reuse the shipped Phase-61 engine in `webapp/src/lib/strava-sync.ts` (token fetch, `stravaGet` + locked telemetry, streams→GPX, dedupe, quotas). `PUT /api/gpx/files/[id]` learns a validated `conDay` update. A new `GET /api/gpx/files/con-runs` manifest feeds a read-only overlay modeled on `public-overlays.ts`. The Svelte UI (gpx-studio fork) gets a `StravaStrip` component, a shared con-day chip dialog, and a `MyConRunsLayer`.

**Tech Stack:** Next.js 16 App Router (webapp), SvelteKit + Svelte 5 runes + mapbox-gl (gpx-studio fork), ElectroDB/DynamoDB, S3 presign, vitest.

**Spec:** `docs/superpowers/specs/2026-07-21-gpx-strava-strip-design.md`

## Global Constraints

- Branch: `feature/gpx-strava-strip` (already created off origin/main). Commit per task. NEVER merge the PR.
- Tests: `cd apps/run.gpx/webapp && nvm use 22.12.0 && npx vitest run` (vitest needs Node ≥22.12; default shell node fails).
- The `strava.ratelimit` telemetry emitted by `stravaGet()` is a LOCKED CloudWatch contract — do not rename `meta.usage`/`meta.limit` or bypass `stravaGet` for Strava calls.
- New endpoints validate con-day with `isConDay` only (NO `isSelectableConDay` gating — any con day is choosable now; decision 2026-07-21). Admins: `isValidDateString` (any date).
- All six `CON_DAYS` (Wed Aug 5 – Mon Aug 10 2026) render as chips; code is authoritative over the 4-day mockup.
- Working dir for all commands below: `apps/run.gpx` unless stated.
- gpx-studio has NO test harness — client pure logic lives in a dependency-free module tested FROM the webapp vitest suite via relative import.
- Existing suites must stay green (especially `strava-sync.test.ts`, `con-days.test.ts`).
- Svelte files in gpx-studio use Svelte 5 runes (`$state`, `$derived`) in components; stores are classic `writable`.
- Client API base: `getApiBase()` from `$lib/cloud-sync` (region-aware); never hardcode `/api/...` root-absolute.

---

### Task 1: Server lib — 7-day listing + single-activity import seams (`strava-sync.ts`)

**Files:**
- Modify: `apps/run.gpx/webapp/src/lib/strava-sync.ts`
- Test: `apps/run.gpx/webapp/src/lib/strava-sync.test.ts` (append)

**Interfaces:**
- Consumes: existing private `stravaGet`, `importActivity`, `existingStravaIds`.
- Produces (used by Tasks 2–3):
  - `export type StravaActivity` — extended with `start_date_local: string; moving_time: number; map?: { summary_polyline?: string | null }`
  - `export async function getExistingStravaIds(userId: string): Promise<Set<string>>` (export of the private `existingStravaIds`)
  - `export async function listActivitiesSince(token: string, afterUnixSeconds: number): Promise<StravaActivity[]>`
  - `export function toStripActivities(activities: StravaActivity[], imported: Set<string>): StripActivity[]` where `export type StripActivity = { id: number; name: string; type: string; startDateLocal: string; distanceMeters: number; movingTimeSeconds: number; summaryPolyline: string; imported: boolean }` (drops activities with empty/absent `map.summary_polyline`)
  - `export async function fetchActivityById(token: string, id: number): Promise<StravaActivity | null>` (GET `/activities/{id}` via `stravaGet`)
  - `export async function importActivityForConDay(user: StravaUserToken, activity: StravaActivity, conDay: string): Promise<ImportedFile | null>` (thin wrapper over the private `importActivity(user, activity, { conDay })`)
  - `export type StravaUserToken` (currently a private type — export it)

- [ ] **Step 1: Write the failing tests** — append to `strava-sync.test.ts`:

```ts
import { vi, afterEach } from "vitest";
import {
  listActivitiesSince,
  toStripActivities,
  type StravaActivity,
} from "./strava-sync";

// logEvent is fire-and-forget telemetry; silence it so fetch mocks stay clean.
vi.mock("./log-event", () => ({ logEvent: vi.fn() }));

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

afterEach(() => vi.unstubAllGlobals());

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
```

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/run.gpx/webapp && nvm use 22.12.0 && npx vitest run src/lib/strava-sync.test.ts`
Expected: FAIL — `listActivitiesSince` / `toStripActivities` not exported.

- [ ] **Step 3: Implement in `strava-sync.ts`**

Changes (keep every existing export untouched):

1. Export the token type: `export type StravaUserToken = { … }` (add `export` to the existing declaration).
2. Extend and export the activity type:

```ts
export type StravaActivity = {
  id: number;
  name: string;
  type: string;
  sport_type: string;
  distance: number;
  total_elevation_gain: number;
  /** Local wall-clock start, e.g. "2026-08-07T06:31:00Z" (Strava quirk: Z-suffixed local time). */
  start_date_local: string;
  moving_time: number;
  map?: { summary_polyline?: string | null };
};
```

(The batch path never reads the new fields, so widening the type is safe.)

3. Export the dedupe-id query: `export async function getExistingStravaIds(userId: string)` — rename the private `existingStravaIds` and update its two internal call sites (`syncUser`, `syncUserToConDay`), or keep the private name and add `export const getExistingStravaIds = existingStravaIds;`. Prefer the rename.

4. Append after `listRecentActivities` (same pagination shape, but date-windowed — the strip's rolling 7 days):

```ts
/**
 * List a runner's activities started after `afterUnixSeconds` (the strip's
 * rolling last-7-days window). Same pagination discipline as
 * listRecentActivities; 3 pages × 50 is far beyond any real 7-day volume.
 */
export async function listActivitiesSince(
  token: string,
  afterUnixSeconds: number,
  maxPages = 3,
  perPage = 50
): Promise<StravaActivity[]> {
  const all: StravaActivity[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const params = new URLSearchParams({
      per_page: String(perPage),
      page: String(page),
      after: String(afterUnixSeconds),
    });
    const activities = await stravaGet<StravaActivity[]>(
      `/athlete/activities?${params.toString()}`,
      token
    );
    if (!activities || activities.length === 0) break;
    all.push(...activities);
    if (activities.length < perPage) break;
  }
  return all;
}

/** What the strip renders per activity — summary polyline included. */
export type StripActivity = {
  id: number;
  name: string;
  type: string;
  startDateLocal: string;
  distanceMeters: number;
  movingTimeSeconds: number;
  summaryPolyline: string;
  imported: boolean;
};

/** Pure: shape Strava activities for the strip, dropping GPS-less ones. */
export function toStripActivities(
  activities: StravaActivity[],
  imported: Set<string>
): StripActivity[] {
  return activities
    .filter((a) => !!a.map?.summary_polyline)
    .map((a) => ({
      id: a.id,
      name: a.name,
      type: a.type,
      startDateLocal: a.start_date_local,
      distanceMeters: a.distance,
      movingTimeSeconds: a.moving_time,
      summaryPolyline: a.map!.summary_polyline as string,
      imported: imported.has(String(a.id)),
    }));
}

/** Fetch one activity's detail (authoritative metadata for a single import). */
export async function fetchActivityById(
  token: string,
  id: number
): Promise<StravaActivity | null> {
  return stravaGet<StravaActivity>(`/activities/${id}`, token);
}

/** Import exactly one activity tagged to a con-day (the strip's tap-to-import). */
export async function importActivityForConDay(
  user: StravaUserToken,
  activity: StravaActivity,
  conDay: string
): Promise<ImportedFile | null> {
  return importActivity(user, activity, { conDay });
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/lib/strava-sync.test.ts`
Expected: PASS (new + all pre-existing dedupe tests).

- [ ] **Step 5: Commit**

```bash
git add webapp/src/lib/strava-sync.ts webapp/src/lib/strava-sync.test.ts
git commit -m "feat(gpx): strava-sync seams for 7-day listing and single-activity import"
```

---

### Task 2: `GET /api/gpx/strava/activities` route

**Files:**
- Create: `apps/run.gpx/webapp/src/app/api/gpx/strava/activities/route.ts`
- Test: `apps/run.gpx/webapp/src/app/api/gpx/strava/activities/route.test.ts`

**Interfaces:**
- Consumes (Task 1): `fetchSingleUserStravaToken`, `listActivitiesSince`, `toStripActivities`, `getExistingStravaIds`.
- Produces (Task 7 client): `200 { ok: true, activities: StripActivity[] }`; errors mirror `/strava/sync` shapes (401/403/400 not-linked/429 burst/409 no-token/500).

- [ ] **Step 1: Write the failing test** — `route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  assertNotLockedLive: vi.fn(async () => false),
  consumeQuota: vi.fn(async () => ({ success: true, remaining: 15 })),
  restoreQuota: vi.fn(async () => ({})),
  fetchSingleUserStravaToken: vi.fn(),
  listActivitiesSince: vi.fn(async () => []),
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
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/app/api/gpx/strava/activities/route.test.ts`
Expected: FAIL — module `./route` not found.

- [ ] **Step 3: Implement `route.ts`**

```ts
import { NextResponse } from "next/server";
import { auth } from "@/config/auth";
import { assertNotLockedLive } from "@/lib/live-lockout";
import {
  consumeQuota,
  restoreQuota,
  type QuotaTier,
} from "@/lib/quota-client";
import {
  fetchSingleUserStravaToken,
  listActivitiesSince,
  toStripActivities,
  getExistingStravaIds,
} from "@/lib/strava-sync";
import { logEvent } from "@/lib/log-event";

/** Rolling window the strip shows: the runner's last 7 days of activities. */
const WINDOW_SECONDS = 7 * 24 * 3600;

/**
 * GET /api/gpx/strava/activities — the Strava strip's list call (2026-07-21 spec).
 *
 * SESSION-authenticated. Returns the signed-in runner's last-7-days Strava
 * activities (anything with GPS) with an `imported` flag per activity so the
 * strip can dim already-imported cards. Read-only against our stores; costs one
 * strava_sync burst unit per refresh (same wall the bulk sync uses) since it
 * hits the Strava API.
 */
export async function GET(request: Request) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const services = (session.user as { services?: string[] }).services ?? [];
  if (!services.includes("gpxstudio")) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  if (!(session.user as { hasStrava?: boolean }).hasStrava) {
    return NextResponse.json(
      { error: "Strava not linked", message: "Link Strava to see your runs" },
      { status: 400 }
    );
  }

  if (await assertNotLockedLive(session.user.id)) {
    return NextResponse.json({ error: "Account locked out" }, { status: 403 });
  }

  const quotaTier: QuotaTier = services.includes("admin") ? "admin" : "upload";

  const burst = await consumeQuota(session.user.id, "strava_sync", 1, quotaTier);
  if (!burst.success) {
    return NextResponse.json(
      {
        error: "Strava sync limit reached",
        message: "You've used all your Strava refreshes",
        remaining: burst.remaining,
        quotaId: "strava_sync",
      },
      { status: 429 }
    );
  }

  try {
    const token = await fetchSingleUserStravaToken(session.user.id);
    if (!token) {
      await restoreQuota(session.user.id, "strava_sync", 1);
      return NextResponse.json(
        { error: "No Strava token", message: "Could not reach your Strava link" },
        { status: 409 }
      );
    }

    const after = Math.floor(Date.now() / 1000) - WINDOW_SECONDS;
    const [activities, imported] = await Promise.all([
      listActivitiesSince(token.accessToken, after),
      getExistingStravaIds(session.user.id),
    ]);

    const strip = toStripActivities(activities, imported);

    logEvent("gpx.strava.list", {
      headers: request.headers,
      userId: session.user.id,
      email: session.user.email ?? undefined,
      meta: { count: strip.length },
    });

    return NextResponse.json({ ok: true, activities: strip });
  } catch (error) {
    console.error("Strava activities list failed:", error);
    await restoreQuota(session.user.id, "strava_sync", 1);
    return NextResponse.json({ error: "Strava list failed" }, { status: 500 });
  }
}

// One athlete/activities page fan-out; modest headroom.
export const maxDuration = 60;
```

- [ ] **Step 4: Run tests** — `npx vitest run src/app/api/gpx/strava/activities/route.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add webapp/src/app/api/gpx/strava/activities
git commit -m "feat(gpx): GET /api/gpx/strava/activities — last-7-days strip listing"
```

---

### Task 3: `POST /api/gpx/strava/import` route

**Files:**
- Create: `apps/run.gpx/webapp/src/app/api/gpx/strava/import/route.ts`
- Test: `apps/run.gpx/webapp/src/app/api/gpx/strava/import/route.test.ts`

**Interfaces:**
- Consumes (Task 1): `fetchSingleUserStravaToken`, `fetchActivityById`, `importActivityForConDay`, `getExistingStravaIds`; plus `isConDay`/`isValidDateString`, `countConDayRuns`, `conDayLimit`/`conDayRemaining`/`isConDayCapped`, `consumeQuota`/`restoreQuota`.
- Produces (Task 7 client): `200 { ok, file: { fileId, fileName }, conDayRemaining, quotaRemaining }`; `409 { error: "Already imported" }`; `429` cap/quota; `422 { error: "No GPS" }`; `400` bad body/conDay.

- [ ] **Step 1: Write the failing test** — `route.test.ts` (same hoisted-mock pattern as Task 2; the extra mocks):

```ts
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
```

- [ ] **Step 2: Run to verify failure** — module not found.

- [ ] **Step 3: Implement `route.ts`**

```ts
import { NextResponse } from "next/server";
import { auth } from "@/config/auth";
import { assertNotLockedLive } from "@/lib/live-lockout";
import { isConDay, isValidDateString } from "@/lib/con-days";
import { countConDayRuns } from "@/lib/con-day-usage";
import { conDayLimit, conDayRemaining, isConDayCapped } from "@/lib/con-day-quota";
import {
  consumeQuota,
  restoreQuota,
  type QuotaTier,
} from "@/lib/quota-client";
import {
  fetchSingleUserStravaToken,
  fetchActivityById,
  importActivityForConDay,
  getExistingStravaIds,
} from "@/lib/strava-sync";
import { logEvent } from "@/lib/log-event";

/**
 * POST /api/gpx/strava/import — tap-to-import one Strava activity (strip spec
 * 2026-07-21). Body: { activityId: number, conDay: "YYYY-MM-DD" }.
 *
 * Unlike /strava/sync (all fresh activities), this imports EXACTLY ONE chosen
 * activity. Con-day rule: any of the six CON_DAYS is accepted at any time (the
 * no-future isSelectableConDay gate is deliberately NOT applied — decision
 * 2026-07-21); admins may use any valid date. Costs one lifetime gpx_upload
 * (refunded on failure); bounded by the shared per-con-day cap.
 */
export async function POST(request: Request) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const services = (session.user as { services?: string[] }).services ?? [];
  if (!services.includes("gpxstudio")) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  if (!(session.user as { hasStrava?: boolean }).hasStrava) {
    return NextResponse.json(
      { error: "Strava not linked", message: "Link Strava to import your runs" },
      { status: 400 }
    );
  }

  if (await assertNotLockedLive(session.user.id)) {
    return NextResponse.json({ error: "Account locked out" }, { status: 403 });
  }

  let activityId: unknown;
  let conDay: unknown;
  try {
    ({ activityId, conDay } = await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  if (typeof activityId !== "number" || !Number.isInteger(activityId) || activityId <= 0) {
    return NextResponse.json(
      { error: "Invalid activityId", message: "activityId must be a positive integer" },
      { status: 400 }
    );
  }

  const isAdmin = services.includes("admin");
  if (typeof conDay !== "string") {
    return NextResponse.json(
      { error: "Invalid conDay", message: "conDay must be a date string" },
      { status: 400 }
    );
  }
  if (isAdmin ? !isValidDateString(conDay) : !isConDay(conDay)) {
    return NextResponse.json(
      { error: "Invalid conDay", message: "conDay must be a DEF CON run day" },
      { status: 400 }
    );
  }

  const quotaTier: QuotaTier = isAdmin ? "admin" : "upload";

  try {
    // Dedupe before any quota spend: re-importing is a no-op, not a 500.
    const imported = await getExistingStravaIds(session.user.id);
    if (imported.has(String(activityId))) {
      return NextResponse.json(
        { error: "Already imported", message: "This activity is already in your maps" },
        { status: 409 }
      );
    }

    const conDayCountBefore = await countConDayRuns(session.user.id, conDay);
    if (isConDayCapped(conDayCountBefore, quotaTier)) {
      return NextResponse.json(
        {
          error: "Con-day limit reached",
          message: `You've logged all ${conDayLimit(quotaTier)} runs for this day`,
          conDay,
          remaining: 0,
          limit: conDayLimit(quotaTier),
        },
        { status: 429 }
      );
    }

    // Lifetime ceiling — the atomic hard wall, consumed before S3/Dynamo writes.
    const q = await consumeQuota(session.user.id, "gpx_upload", 1, quotaTier);
    if (!q.success) {
      return NextResponse.json(
        {
          error: "Quota exceeded",
          message: "You have reached your upload limit",
          remaining: q.remaining,
          quotaId: "gpx_upload",
        },
        { status: 429 }
      );
    }

    try {
      const token = await fetchSingleUserStravaToken(session.user.id);
      if (!token) {
        await restoreQuota(session.user.id, "gpx_upload", 1);
        return NextResponse.json(
          { error: "No Strava token", message: "Could not reach your Strava link" },
          { status: 409 }
        );
      }

      const activity = await fetchActivityById(token.accessToken, activityId);
      if (!activity) {
        await restoreQuota(session.user.id, "gpx_upload", 1);
        return NextResponse.json(
          { error: "Activity not found", message: "Strava did not return this activity" },
          { status: 404 }
        );
      }

      const file = await importActivityForConDay(token, activity, conDay);
      if (!file) {
        // No GPS streams (e.g. treadmill) — refund the lifetime unit.
        await restoreQuota(session.user.id, "gpx_upload", 1);
        return NextResponse.json(
          { error: "No GPS", message: "This activity has no GPS track to import" },
          { status: 422 }
        );
      }

      logEvent("gpx.strava.import", {
        headers: request.headers,
        userId: session.user.id,
        email: session.user.email ?? undefined,
        meta: { fileId: file.fileId, activityId, conDay },
      });

      return NextResponse.json({
        ok: true,
        file,
        conDayRemaining: conDayRemaining(conDayCountBefore + 1, quotaTier),
        quotaRemaining: q.remaining,
      });
    } catch (inner) {
      await restoreQuota(session.user.id, "gpx_upload", 1);
      throw inner;
    }
  } catch (error) {
    console.error("Strava single import failed:", error);
    return NextResponse.json({ error: "Strava import failed" }, { status: 500 });
  }
}

// Streams fetch + S3 + Dynamo for one activity.
export const maxDuration = 60;
```

- [ ] **Step 4: Run tests** — `npx vitest run src/app/api/gpx/strava/import/route.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add webapp/src/app/api/gpx/strava/import
git commit -m "feat(gpx): POST /api/gpx/strava/import — single-activity strip import"
```

---

### Task 4: `conDay` updates via `PUT /api/gpx/files/[id]` (Save as defcon.run Activity — server)

**Files:**
- Modify: `apps/run.gpx/webapp/src/app/api/gpx/files/[id]/route.ts` (PUT handler, after the `allowedFields` filter block)
- Test: `apps/run.gpx/webapp/src/app/api/gpx/files/[id]/conday-update.test.ts` (new file)

**Interfaces:**
- Produces (Task 10 client): `PUT /api/gpx/files/{id}` body may now include `conDay: string | null`. Success response gains `conDayRemaining` when a day was set. Errors: `400` invalid day / GLOBAL file, `429` target-day cap `{ error: "Con-day limit reached", conDay, remaining, limit }`.

**Rules (implement exactly):**
1. Only when `updates.conDay !== undefined`.
2. GLOBAL files (`targetUserId === "GLOBAL"`) → 400 `{ error: "Community files aren't day-tagged" }`.
3. `null` clears the tag (`filteredUpdates.conDay = undefined` via ElectroDB `remove` — see step 3).
4. String: admins `isValidDateString`, others `isConDay` (NO selectable gate) else 400.
5. If the new day differs from `file.data.conDay`: `countConDayRuns(session.user.id, newDay)` and `isConDayCapped(count, tier)` → 429. (The count never includes this file since its current tag differs.)
6. Same-day write is a no-op for cap purposes (skip the check).

- [ ] **Step 1: Write the failing test** — `conday-update.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  assertNotLockedLive: vi.fn(async () => false),
  consumeQuota: vi.fn(async () => ({ success: true, remaining: 9 })),
  restoreQuota: vi.fn(async () => ({})),
  countConDayRuns: vi.fn(async () => 0),
  fileGet: vi.fn(),
  fileUpdateSet: vi.fn(() => ({ go: vi.fn(async () => ({})) })),
  fileUpdateRemove: vi.fn(() => ({ go: vi.fn(async () => ({})) })),
}));

vi.mock("@/config/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/live-lockout", () => ({ assertNotLockedLive: mocks.assertNotLockedLive }));
vi.mock("@/lib/quota-client", () => ({
  consumeQuota: mocks.consumeQuota,
  restoreQuota: mocks.restoreQuota,
}));
vi.mock("@/lib/con-day-usage", () => ({ countConDayRuns: mocks.countConDayRuns }));
vi.mock("@/entities/gpx-file", () => ({
  GpxFile: {
    get: (k: unknown) => ({ go: () => mocks.fileGet(k) }),
    update: () => ({ set: mocks.fileUpdateSet, remove: mocks.fileUpdateRemove }),
  },
}));
vi.mock("@/entities/gpx-share", () => ({ GpxShare: {} }));

import { PUT } from "./route";

const session = { user: { id: "u1", services: ["gpxstudio"] } };
const params = { params: Promise.resolve({ id: "f1" }) };

function put(body: unknown) {
  return new Request("http://x/api/gpx/files/f1", {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue(session);
  mocks.assertNotLockedLive.mockResolvedValue(false);
  mocks.countConDayRuns.mockResolvedValue(0);
  mocks.fileGet.mockResolvedValue({
    data: { userId: "u1", fileId: "f1", fileName: "a.gpx", conDay: "2026-08-06" },
  });
});

describe("PUT /api/gpx/files/[id] conDay", () => {
  it("moves a file to another con day when the target has budget", async () => {
    const res = await PUT(put({ conDay: "2026-08-07" }), params);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.conDayRemaining).toBe(9);
    expect(mocks.countConDayRuns).toHaveBeenCalledWith("u1", "2026-08-07");
    expect(mocks.fileUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({ conDay: "2026-08-07" })
    );
  });

  it("accepts a future con day (no selectable gate)", async () => {
    expect((await PUT(put({ conDay: "2026-08-10" }), params)).status).toBe(200);
  });

  it("429s when the target day is capped", async () => {
    mocks.countConDayRuns.mockResolvedValue(10);
    expect((await PUT(put({ conDay: "2026-08-07" }), params)).status).toBe(429);
  });

  it("skips the cap check when re-saving the same day", async () => {
    mocks.countConDayRuns.mockResolvedValue(10);
    expect((await PUT(put({ conDay: "2026-08-06" }), params)).status).toBe(200);
    expect(mocks.countConDayRuns).not.toHaveBeenCalled();
  });

  it("clears the tag with null", async () => {
    expect((await PUT(put({ conDay: null }), params)).status).toBe(200);
    expect(mocks.fileUpdateRemove).toHaveBeenCalledWith(["conDay"]);
  });

  it("400s a non-con-day for non-admins", async () => {
    expect((await PUT(put({ conDay: "2026-09-01" }), params)).status).toBe(400);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run "src/app/api/gpx/files/[id]/conday-update.test.ts"`
Expected: FAIL (conDay silently ignored today → no `conDayRemaining`, no remove call, 200 where 400/429 expected).

- [ ] **Step 3: Implement in the PUT handler**

Add imports at top of `[id]/route.ts`:

```ts
import { isConDay, isValidDateString } from "@/lib/con-days";
import { conDayLimit, conDayRemaining, isConDayCapped } from "@/lib/con-day-quota";
import { countConDayRuns } from "@/lib/con-day-usage";
import type { QuotaTier } from "@/lib/quota-client";
```

Insert AFTER the `filteredUpdates` loop and BEFORE the `updateContent` block:

```ts
    // "Save as defcon.run Activity" (2026-07-21 spec): (re)assign the con-day
    // tag on the runner's own file. ANY con day is choosable at any time (the
    // no-future gate deliberately does not apply here); admins may use any
    // valid date. Moving to a DIFFERENT day requires budget on the target day.
    let conDayRemainingAfter: number | undefined;
    let clearConDay = false;
    if (updates.conDay !== undefined) {
      if (targetUserId === "GLOBAL") {
        return NextResponse.json(
          { error: "Community files aren't day-tagged" },
          { status: 400 }
        );
      }
      const isAdmin = services.includes("admin");
      const tier: QuotaTier = isAdmin ? "admin" : "upload";
      if (updates.conDay === null) {
        clearConDay = true;
      } else if (typeof updates.conDay !== "string") {
        return NextResponse.json(
          { error: "Invalid conDay", message: "conDay must be a date string or null" },
          { status: 400 }
        );
      } else if (isAdmin ? !isValidDateString(updates.conDay) : !isConDay(updates.conDay)) {
        return NextResponse.json(
          { error: "Invalid conDay", message: "conDay must be a DEF CON run day" },
          { status: 400 }
        );
      } else {
        if (updates.conDay !== file.data.conDay) {
          const targetCount = await countConDayRuns(session.user.id, updates.conDay);
          if (isConDayCapped(targetCount, tier)) {
            return NextResponse.json(
              {
                error: "Con-day limit reached",
                message: `You've logged all ${conDayLimit(tier)} runs for that day`,
                conDay: updates.conDay,
                remaining: 0,
                limit: conDayLimit(tier),
              },
              { status: 429 }
            );
          }
          conDayRemainingAfter = conDayRemaining(targetCount + 1, tier);
        } else {
          conDayRemainingAfter = undefined; // same-day re-save: nothing changes
        }
        filteredUpdates.conDay = updates.conDay;
      }
    }
```

Then, where the handler performs `GpxFile.update(...).set(filteredUpdates).go()` (find the existing update call later in PUT), extend it to also clear:

```ts
    let updateBuilder = GpxFile.update({ userId: targetUserId, fileId: id });
    if (clearConDay) {
      await updateBuilder.remove(["conDay"]).go();
      updateBuilder = GpxFile.update({ userId: targetUserId, fileId: id });
    }
    if (Object.keys(filteredUpdates).length > 0) {
      await updateBuilder.set(filteredUpdates).go();
    }
```

(Adapt to the handler's actual update call — keep its existing behavior for every other field; only ADD the remove path and the `conDayRemaining` response field:)

```ts
    return NextResponse.json({
      /* existing fields unchanged */
      ...(conDayRemainingAfter !== undefined ? { conDayRemaining: conDayRemainingAfter } : {}),
    });
```

- [ ] **Step 4: Run tests** — the new file AND `npx vitest run` (full suite) to catch PUT regressions.

- [ ] **Step 5: Commit**

```bash
git add "webapp/src/app/api/gpx/files/[id]"
git commit -m "feat(gpx): PUT files/[id] accepts conDay — save-as-defcon-run with target-day cap"
```

---

### Task 5: `GET /api/gpx/files/con-runs` manifest (My DEF CON Runs layer — server)

**Files:**
- Create: `apps/run.gpx/webapp/src/app/api/gpx/files/con-runs/route.ts`
- Test: `apps/run.gpx/webapp/src/app/api/gpx/files/con-runs/route.test.ts`

Static segment wins over `[id]` in the App Router, so `/files/con-runs` never collides with `/files/{uuid}`.

**Interfaces:**
- Produces (Task 11 client): `200 { runs: [{ fileId, fileName, conDay, downloadUrl, bounds?, totalDistance? }] }` — the signed-in runner's ACTIVE files with a `conDay`, presigned GET URLs (3600 s), newest first.

- [ ] **Step 1: Write the failing test** — `route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  query: vi.fn(),
  getSignedUrl: vi.fn(async () => "https://s3/presigned"),
}));

vi.mock("@/config/auth", () => ({ auth: mocks.auth }));
vi.mock("@/entities/gpx-file", () => ({
  GpxFile: { query: { byCreatedAt: () => ({ go: mocks.query }) } },
}));
vi.mock("@aws-sdk/s3-request-presigner", () => ({ getSignedUrl: mocks.getSignedUrl }));

import { GET } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ user: { id: "u1", services: ["gpxstudio"] } });
  mocks.query.mockResolvedValue({
    data: [
      { fileId: "a", fileName: "a.gpx", conDay: "2026-08-07", status: "active", bucket: "b", key: "k/a", totalDistance: 5000, bounds: { minLat: 1, maxLat: 2, minLon: 3, maxLon: 4 } },
      { fileId: "b", fileName: "b.gpx", conDay: undefined, status: "active", bucket: "b", key: "k/b" },
      { fileId: "c", fileName: "c.gpx", conDay: "2026-08-06", status: "failed", bucket: "b", key: "k/c" },
    ],
  });
});

describe("GET /api/gpx/files/con-runs", () => {
  it("401s with no session", async () => {
    mocks.auth.mockResolvedValue(null);
    expect((await GET()).status).toBe(401);
  });

  it("returns only active, day-tagged files with presigned URLs", async () => {
    const res = await GET();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.runs).toHaveLength(1);
    expect(body.runs[0]).toMatchObject({
      fileId: "a",
      conDay: "2026-08-07",
      downloadUrl: "https://s3/presigned",
      totalDistance: 5000,
    });
  });
});
```

- [ ] **Step 2: Run to verify failure** — module not found.

- [ ] **Step 3: Implement `route.ts`**

```ts
import { NextResponse } from "next/server";
import { auth } from "@/config/auth";
import { GpxFile } from "@/entities/gpx-file";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { s3Client } from "@/lib/s3-client";

/**
 * GET /api/gpx/files/con-runs — manifest for the "My DEF CON Runs" overlay
 * (2026-07-21 spec). The signed-in runner's ACTIVE files that carry a conDay
 * tag, each with a presigned GPX download URL so the studio can render them as
 * a read-only layer grouped by day. Own files only; ≤10/day × 6 days keeps this
 * a single-partition read.
 */
export async function GET() {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const services = (session.user as { services?: string[] }).services ?? [];
  if (!services.includes("gpxstudio")) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  try {
    const result = await GpxFile.query
      .byCreatedAt({ userId: session.user.id })
      .go({ pages: "all", order: "desc" });

    const tagged = result.data.filter(
      (f) => !!f.conDay && (!f.status || f.status === "active")
    );

    const runs = await Promise.all(
      tagged.map(async (f) => ({
        fileId: f.fileId,
        fileName: f.fileName,
        conDay: f.conDay as string,
        totalDistance: f.totalDistance,
        bounds: f.bounds,
        downloadUrl: await getSignedUrl(
          s3Client,
          new GetObjectCommand({ Bucket: f.bucket, Key: f.key }),
          { expiresIn: 3600 }
        ),
      }))
    );

    return NextResponse.json({ runs });
  } catch (error) {
    console.error("con-runs manifest failed:", error);
    return NextResponse.json({ error: "Failed to list runs" }, { status: 500 });
  }
}
```

- [ ] **Step 4: Run tests** — `npx vitest run src/app/api/gpx/files/con-runs/route.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add webapp/src/app/api/gpx/files/con-runs
git commit -m "feat(gpx): GET files/con-runs — manifest for the My DEF CON Runs layer"
```

---

### Task 6: Client pure module — polyline decode, SVG path, day guess

**Files:**
- Create: `apps/run.gpx/gpx-studio/website/src/lib/logic/strava-strip-pure.ts` (ZERO imports — it is unit-tested from the webapp suite via relative path)
- Test: `apps/run.gpx/webapp/src/lib/strava-strip-pure.test.ts`

**Interfaces (consumed by Tasks 8, 10):**
- `decodePolyline(encoded: string): [number, number][]` — Google encoded polyline → `[lat, lng][]`
- `polylineToSvgPath(points: [number, number][], width: number, height: number, pad?: number): string` — normalized `M…L…` path (empty string for <2 points); lat inverted so north is up
- `guessConDay(startDateLocal: string, dayDates: string[]): string | null` — exact date match wins; else nearest by absolute day distance, ties → earlier; null for unparseable/empty
- `formatKm(meters: number): string` — `"5.4 km"` / `"850 m"`

- [ ] **Step 1: Write the failing test** — `webapp/src/lib/strava-strip-pure.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  decodePolyline,
  polylineToSvgPath,
  guessConDay,
  formatKm,
} from "../../../gpx-studio/website/src/lib/logic/strava-strip-pure";

describe("decodePolyline", () => {
  it("decodes the canonical Google example", () => {
    // https://developers.google.com/maps/documentation/utilities/polylinealgorithm
    const pts = decodePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@");
    expect(pts).toEqual([
      [38.5, -120.2],
      [40.7, -120.95],
      [43.252, -126.453],
    ]);
  });
  it("is empty-safe", () => {
    expect(decodePolyline("")).toEqual([]);
  });
});

describe("polylineToSvgPath", () => {
  it("normalizes into the viewBox with padding and inverted lat", () => {
    const d = polylineToSvgPath([[0, 0], [1, 1]], 100, 50, 10);
    // Aspect fit: lng span scales to min(innerW/span, innerH/span) = 30, centered
    // on x. South-west point → left-ish bottom, north-east point → right-ish top.
    expect(d).toMatch(/^M35,40 L65,10$/);
  });
  it("returns '' for fewer than 2 points", () => {
    expect(polylineToSvgPath([[1, 1]], 100, 50)).toBe("");
  });
});

describe("guessConDay", () => {
  const days = ["2026-08-05", "2026-08-06", "2026-08-07", "2026-08-08", "2026-08-09", "2026-08-10"];
  it("uses the exact day when the activity falls on a con day", () => {
    expect(guessConDay("2026-08-07T06:31:00Z", days)).toBe("2026-08-07");
  });
  it("snaps to the nearest con day before the window", () => {
    expect(guessConDay("2026-08-01T09:00:00Z", days)).toBe("2026-08-05");
  });
  it("snaps to the nearest con day after the window", () => {
    expect(guessConDay("2026-08-20T09:00:00Z", days)).toBe("2026-08-10");
  });
  it("breaks ties toward the earlier day", () => {
    // 2026-08-06T12h is not needed — construct a true tie with a synthetic list.
    expect(guessConDay("2026-08-07T00:00:00Z", ["2026-08-06", "2026-08-08"])).toBe("2026-08-06");
  });
  it("nulls on garbage", () => {
    expect(guessConDay("not-a-date", days)).toBeNull();
    expect(guessConDay("2026-08-07T06:31:00Z", [])).toBeNull();
  });
});

describe("formatKm", () => {
  it("formats", () => {
    expect(formatKm(5400)).toBe("5.4 km");
    expect(formatKm(850)).toBe("850 m");
  });
});
```

- [ ] **Step 2: Run to verify failure** — module not found.

- [ ] **Step 3: Implement `strava-strip-pure.ts`**

```ts
/**
 * Pure helpers for the Strava strip (2026-07-21 spec). NO imports — this module
 * is shared source: the Svelte studio consumes it directly, and the webapp
 * vitest suite unit-tests it via a relative path (the studio has no test
 * harness). Keep it dependency-free.
 */

/** Decode a Google encoded polyline (Strava `map.summary_polyline`) → [lat, lng][]. */
export function decodePolyline(encoded: string): [number, number][] {
  const points: [number, number][] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  while (index < encoded.length) {
    for (const which of [0, 1] as const) {
      let result = 0;
      let shift = 0;
      let b: number;
      do {
        b = encoded.charCodeAt(index++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);
      const delta = result & 1 ? ~(result >> 1) : result >> 1;
      if (which === 0) lat += delta;
      else lng += delta;
    }
    points.push([lat / 1e5, lng / 1e5]);
  }
  return points;
}

/**
 * Fit a [lat, lng] track into a width×height viewBox (padding `pad`) as an SVG
 * path. Lat is inverted (SVG y grows down; north stays up). Aspect ratio is
 * preserved and the track centered on the shorter axis.
 */
export function polylineToSvgPath(
  points: [number, number][],
  width: number,
  height: number,
  pad = 4
): string {
  if (points.length < 2) return "";
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
  for (const [la, ln] of points) {
    if (la < minLat) minLat = la;
    if (la > maxLat) maxLat = la;
    if (ln < minLng) minLng = ln;
    if (ln > maxLng) maxLng = ln;
  }
  const spanLat = maxLat - minLat || 1e-9;
  const spanLng = maxLng - minLng || 1e-9;
  const innerW = width - 2 * pad;
  const innerH = height - 2 * pad;
  const scale = Math.min(innerW / spanLng, innerH / spanLat);
  const offX = pad + (innerW - spanLng * scale) / 2;
  const offY = pad + (innerH - spanLat * scale) / 2;
  const coords = points.map(([la, ln]) => {
    const x = offX + (ln - minLng) * scale;
    const y = offY + (maxLat - la) * scale;
    return `${round2(x)},${round2(y)}`;
  });
  return `M${coords[0]} L${coords.slice(1).join(" ")}`;
}

function round2(n: number): string {
  return String(Math.round(n * 100) / 100);
}

/**
 * Best-guess con day for an activity: its local calendar date when that IS a
 * con day, else the nearest con day (ties → earlier). `startDateLocal` is
 * Strava's Z-suffixed LOCAL wall-clock time, so the date part is already the
 * athlete's local day — slice, don't timezone-shift.
 */
export function guessConDay(
  startDateLocal: string,
  dayDates: string[]
): string | null {
  const date = (startDateLocal || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || dayDates.length === 0) return null;
  if (dayDates.includes(date)) return date;
  const t = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(t)) return null;
  let best: string | null = null;
  let bestDist = Infinity;
  for (const d of dayDates) {
    const dist = Math.abs(Date.parse(`${d}T00:00:00Z`) - t);
    if (dist < bestDist || (dist === bestDist && best !== null && d < best)) {
      best = d;
      bestDist = dist;
    }
  }
  return best;
}

/** "5.4 km" / "850 m" for card metadata. */
export function formatKm(meters: number): string {
  return meters >= 1000
    ? `${(Math.round(meters / 100) / 10).toFixed(1)} km`
    : `${Math.round(meters)} m`;
}
```

- [ ] **Step 4: Run tests** — `npx vitest run src/lib/strava-strip-pure.test.ts` → PASS. (Fix the tie-break loop if the "ties → earlier" case fails: iterate days in sorted order and use strict `<` so the first/earlier day wins — `for (const d of [...dayDates].sort())` with `if (dist < bestDist)` only.)

- [ ] **Step 5: Commit**

```bash
git add gpx-studio/website/src/lib/logic/strava-strip-pure.ts webapp/src/lib/strava-strip-pure.test.ts
git commit -m "feat(gpx): pure strip helpers — polyline decode, svg path, con-day guess"
```

---

### Task 7: Client API layer — rework `strava-import.ts`

**Files:**
- Modify: `apps/run.gpx/gpx-studio/website/src/lib/logic/strava-import.ts` (full rewrite; the bulk `logRunFromStrava` is retired)

**Interfaces:**
- Consumes: `getApiBase`, `loadFromCloud`, `AuthenticationError`, `redirectToLogin` from `$lib/cloud-sync`; `parseGPX`, `fileActions`, `boundsManager`, `selection`, `autoSaveManager` (same imports as today); `StripActivity` shape from Task 2's response.
- Produces (Tasks 8, 9):
  - `export interface StripActivity { id: number; name: string; type: string; startDateLocal: string; distanceMeters: number; movingTimeSeconds: number; summaryPolyline: string; imported: boolean }`
  - `export class StravaSyncError extends Error` (kept)
  - `export async function fetchStravaActivities(): Promise<StripActivity[]>` — GET `${getApiBase()}/strava/activities`; 401 → `redirectToLogin()` + throw `AuthenticationError`; other non-OK → throw `StravaSyncError(message)`
  - `export async function importStravaActivity(activityId: number, conDay: string): Promise<{ fileId: string; fileName: string; conDayRemaining: number }>` — POST `${getApiBase()}/strava/import`, then land the returned file on the map via the extracted chain below
  - `export async function landCloudFileOnMap(descriptor: { fileId: string; fileName: string }): Promise<void>` — the load→parse→add→register→select→fit chain extracted verbatim from today's `logRunFromStrava` loop (single-file version)

- [ ] **Step 1: Rewrite the module** — keep the header comment style; the landing chain is copied from the current loop body (lines 75–110) reduced to one file:

```ts
/**
 * Strava strip client (2026-07-21 spec; supersedes the Phase 61 bulk door).
 *
 * fetchStravaActivities() lists the runner's last-7-days activities for the
 * bottom strip; importStravaActivity() imports ONE tapped activity tagged to a
 * con day and lands it on the map exactly the way the Upload door does. The
 * old all-at-once logRunFromStrava() is retired — the QuickStart hub button now
 * just opens the strip.
 */

import { parseGPX } from 'gpx';
import { fileActions } from '$lib/logic/file-actions';
import { boundsManager } from '$lib/logic/bounds';
import { selection } from '$lib/logic/selection';
import { autoSaveManager } from '$lib/auto-save';
import {
    getApiBase,
    loadFromCloud,
    AuthenticationError,
    redirectToLogin,
} from '$lib/cloud-sync';

export interface StripActivity {
    id: number;
    name: string;
    type: string;
    startDateLocal: string;
    distanceMeters: number;
    movingTimeSeconds: number;
    summaryPolyline: string;
    imported: boolean;
}

/** A call that failed with a user-presentable message (quota, cap, not-linked…). */
export class StravaSyncError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'StravaSyncError';
    }
}

async function throwFromResponse(response: Response, fallback: string): Promise<never> {
    if (response.status === 401) {
        redirectToLogin();
        throw new AuthenticationError('Session expired. Redirecting to login...');
    }
    const data = await response.json().catch(() => ({}));
    throw new StravaSyncError(data.message || data.error || fallback);
}

/** List the runner's last-7-days Strava activities for the strip. */
export async function fetchStravaActivities(): Promise<StripActivity[]> {
    const response = await fetch(`${getApiBase()}/strava/activities`, {
        credentials: 'include',
    });
    if (!response.ok) await throwFromResponse(response, 'Could not load Strava activities');
    const data = (await response.json()) as { activities: StripActivity[] };
    return data.activities ?? [];
}

/** Land one freshly-created cloud file on the map (Upload-door landing chain). */
export async function landCloudFileOnMap(descriptor: {
    fileId: string;
    fileName: string;
}): Promise<void> {
    const { content, fileName } = await loadFromCloud(descriptor.fileId);
    const gpx = parseGPX(content);
    if (gpx.metadata === undefined) gpx.metadata = {};
    if (gpx.metadata.name === undefined || gpx.metadata.name.trim() === '') {
        gpx.metadata.name = fileName.replace(/\.gpx$/i, '');
    }
    const ids = fileActions.addMultiple([gpx]);
    // Strava imports save to the root folder server-side (folderId null).
    autoSaveManager.registerCloudLinkedFile(ids[0], descriptor.fileId, fileName, null, false);
    selection.selectFileWhenLoaded(ids[0]);
    boundsManager.fitBoundsOnLoad(ids);
}

/** Import ONE tapped activity into `conDay`, then render it on the map. */
export async function importStravaActivity(
    activityId: number,
    conDay: string
): Promise<{ fileId: string; fileName: string; conDayRemaining: number }> {
    const response = await fetch(`${getApiBase()}/strava/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ activityId, conDay }),
    });
    if (!response.ok) await throwFromResponse(response, 'Strava import failed');
    const data = (await response.json()) as {
        file: { fileId: string; fileName: string };
        conDayRemaining: number;
    };
    await landCloudFileOnMap(data.file);
    return { ...data.file, conDayRemaining: data.conDayRemaining };
}
```

- [ ] **Step 2: Verify nothing else imports the removed export**

Run: `grep -rn "logRunFromStrava" gpx-studio/website/src`
Expected: ONLY `QuickStartHub.svelte` (fixed in Task 9). If anything else appears, update it in this task.

- [ ] **Step 3: Commit** (build verified at Task 12; QuickStartHub still references the old symbol until Task 9, so commit Tasks 7–9 together if the studio build is run in between — otherwise commit now):

```bash
git add gpx-studio/website/src/lib/logic/strava-import.ts
git commit -m "refactor(gpx): strip client API — list + single import, retire bulk logRunFromStrava"
```

---

### Task 8: `StravaStrip.svelte` + store + mount

**Files:**
- Create: `apps/run.gpx/gpx-studio/website/src/lib/stores/strava-strip.ts`
- Create: `apps/run.gpx/gpx-studio/website/src/lib/components/StravaStrip.svelte`
- Modify: `apps/run.gpx/gpx-studio/website/src/routes/[[language]]/app/+page.svelte` (import + mount next to `<QuickStartHub />`)

**Interfaces:**
- Consumes: Task 7 client API; Task 6 pure helpers; `getConDayUsage`, `ConDayUsage` from `$lib/cloud-sync`; `hasStrava`, `isAuthenticated`, `hasGpxStudioAccess`, `isAdmin` from `$lib/stores/auth`; `myConRunsRefresh` store (Task 11 — create the store file in THIS task so the import resolves; see below).
- Produces (Task 9): `export const stravaStripExpanded = writable<boolean>(persisted)`; `export function openStravaStrip(): void` (expands + marks a one-shot "pulse" so the strip draws attention).

- [ ] **Step 1: Create `stores/strava-strip.ts`**

```ts
import { writable } from 'svelte/store';

/**
 * Strava strip UI state (2026-07-21 spec). Expanded/collapsed persists per
 * browser; openStravaStrip() is the QuickStart hub's "From Strava" hand-off —
 * it force-expands the strip (and the strip component scrolls itself into view).
 */
const KEY = 'stravaStripExpanded';

function initial(): boolean {
    if (typeof localStorage === 'undefined') return true;
    return localStorage.getItem(KEY) !== '0';
}

export const stravaStripExpanded = writable<boolean>(initial());
stravaStripExpanded.subscribe((v) => {
    if (typeof localStorage !== 'undefined') localStorage.setItem(KEY, v ? '1' : '0');
});

/** One-shot attention pulse fired when the hub button opens the strip. */
export const stravaStripPulse = writable<number>(0);

export function openStravaStrip(): void {
    stravaStripExpanded.set(true);
    stravaStripPulse.update((n) => n + 1);
}
```

Also create `stores/my-con-runs.ts` NOW (Task 11 consumes it; the strip bumps it after imports):

```ts
import { writable } from 'svelte/store';

/** Bump to make the My DEF CON Runs layer re-fetch its manifest (post-import / re-tag). */
export const myConRunsRefresh = writable<number>(0);

export function refreshMyConRuns(): void {
    myConRunsRefresh.update((n) => n + 1);
}
```

- [ ] **Step 2: Create `StravaStrip.svelte`**

Behavior contract (implement all of it; styling with the existing Tailwind tokens — `bg-background`, `text-muted-foreground`, `border`, etc. — matching QuickStartHub):

1. Render gate: `$isAuthenticated && $hasGpxStudioAccess`. Docked `absolute bottom-2 left-2 right-2 z-30` inside the map container, `rounded-xl border bg-background/90 backdrop-blur`.
2. Header row (always visible): Strava word-mark SVG path (the two-chevron mark from the mockup, `fill="#fc4c02"`), title `From Strava · last 7 days`, count badge when loaded, chevron button toggling `$stravaStripExpanded`.
3. First expand (and pulse): if `$hasStrava`, `loading = true`, parallel `fetchStravaActivities()` + `getConDayUsage()`; errors → compact error row with a Retry button. A `refresh` icon button re-fetches both.
4. Not linked (`!$hasStrava`): dashed CTA card — copy: “Link your Strava account to import your last 7 days of activity onto the map.” + `Connect Strava` button → `window.location.href = 'https://auth.defcon.run' + regionPrefix() + '/strava'` where `regionPrefix()` is copied from `public-overlays.ts` (everything before `/studio` in `location.pathname`). Below it a hint: “Just linked? Give it a minute and hit refresh.”
5. Linked + zero activities: “No activities in the last 7 days.”
6. Carousel: horizontal `overflow-hidden` flex row of cards; `‹`/`›` buttons page by the visible width (`scrollBy({ left: ±clientWidth })` on a `overflow-x-auto scroll-smooth snap-x` container is acceptable and simpler than manual paging — pick this); arrows dim at ends via `scrollend`/`scroll` listener updating `canLeft/canRight` state.
7. Card (~w-40 shrink-0): SVG `viewBox="0 0 130 56"` with `<path d={polylineToSvgPath(decodePolyline(a.summaryPolyline), 130, 56)}>` stroke `#fc4c02` (unimported) / `currentColor` muted (imported), `stroke-width 2.5`, `fill none`; type chip (uppercase `a.type`); name (truncate); date (`new Date(a.startDateLocal.slice(0,10) + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })`) + `formatKm(a.distanceMeters)`. Imported: `opacity-60`, green `✓ Imported` badge, `disabled`.
8. Tap (unimported card) → popover panel rendered INSIDE the strip above the cards (simpler than anchored floating): activity name + distance; chips = one per `usage` entry (`day.label.slice(0,3)` + short date), pre-selected `guessConDay(a.startDateLocal, usage.map(u => u.date))`, chip disabled when `day.remaining <= 0` (tooltip “full”); quota line `X of 10 left · {label}` for the selected day; admins additionally get a raw `<input type="date">` overriding the chips (mirrors QuickStartHub's admin override). Buttons: Cancel / `Import run`.
9. Import: `importing = true`; `importStravaActivity(a.id, selectedDay)`; on success — mark that activity `imported: true` in local state, decrement the day's `remaining` in `usage`, close popover, `refreshMyConRuns()`; success toast row “Imported! It's on the map for {label}.” On `StravaSyncError` show its message in the popover (chips stay open so the runner picks another day).
10. Collapse chevron rotates; collapsed shows ONLY the header row.
11. Pulse: `stravaStripPulse` subscription → `el.scrollIntoView({ block: 'nearest' })` + a brief ring class (`ring-2 ring-[#fc4c02]` removed after 1200 ms).

- [ ] **Step 3: Mount it** — in `routes/[[language]]/app/+page.svelte`: `import StravaStrip from '$lib/components/StravaStrip.svelte';` and render `<StravaStrip />` immediately after `<QuickStartHub />` (line ~135) so it sits inside the same map-relative container.

- [ ] **Step 4: Build the studio frontend**

Run: `cd apps/run.gpx && ./build-frontend.sh`
Expected: clean build (this compiles the Svelte app; it is the type/syntax gate for Tasks 6–8).

- [ ] **Step 5: Commit**

```bash
git add gpx-studio/website/src/lib/stores/strava-strip.ts gpx-studio/website/src/lib/stores/my-con-runs.ts gpx-studio/website/src/lib/components/StravaStrip.svelte "gpx-studio/website/src/routes/[[language]]/app/+page.svelte" webapp/public/studio
git commit -m "feat(gpx): Strava last-7-days strip — carousel, con-day popover, connect CTA"
```

(If `webapp/public/studio` build output is gitignored, drop it from the add — check `git status` first.)

---

### Task 9: QuickStartHub rewire — "From Strava" opens the strip

**Files:**
- Modify: `apps/run.gpx/gpx-studio/website/src/lib/components/QuickStartHub.svelte`

**Interfaces:**
- Consumes: `openStravaStrip` (Task 8).

- [ ] **Step 1: Edit the component**
1. Replace the import `import { logRunFromStrava, StravaSyncError } from '$lib/logic/strava-import';` with `import { openStravaStrip } from '$lib/stores/strava-strip';`.
2. Delete the whole `syncStrava()` function and the `syncing` state; replace the button handler:

```svelte
{#if $hasStrava}
    <button
        class="mt-4 flex w-full items-center justify-center gap-2 rounded-lg border border-primary/40 bg-primary/5 px-3 py-2.5 text-sm font-semibold text-primary transition hover:bg-primary/10"
        onclick={() => {
            view = 'collapsed';
            openStravaStrip();
        }}
    >
        <RefreshCw size={16} /> From Strava
    </button>
{/if}
```

3. Remove now-unused `syncing` references from the Upload button's `disabled` expression (`disabled={uploading || capped || !selectedDate}`).
4. The Strava button no longer needs `selectedDate`/`capped` gating (the strip's popover owns day choice) — hence no `disabled` attribute.

- [ ] **Step 2: Verify no stale references**

Run: `grep -rn "logRunFromStrava\|StravaSyncError\|syncing" gpx-studio/website/src/lib/components/QuickStartHub.svelte`
Expected: no matches (StravaSyncError usage in the hub is gone; the class still exists for the strip).

- [ ] **Step 3: Build** — `./build-frontend.sh` → clean.

- [ ] **Step 4: Commit**

```bash
git add gpx-studio/website/src/lib/components/QuickStartHub.svelte
git commit -m "feat(gpx): hub From-Strava button opens the strip instead of bulk-importing"
```

---

### Task 10: "Save as defcon.run Activity" dialog

**Files:**
- Create: `apps/run.gpx/gpx-studio/website/src/lib/components/cloud/ConDaySaveDialog.svelte`
- Modify: `apps/run.gpx/gpx-studio/website/src/lib/components/cloud/CloudStorage.svelte` (row action + dialog wiring)
- Modify: `apps/run.gpx/gpx-studio/website/src/lib/cloud-sync.ts` (`updateCloudFile` updates type gains `conDay?: string | null`; add `conDayRemaining` passthrough is not needed client-side)

**Interfaces:**
- Consumes: `updateCloudFile(fileId, { conDay })` (Task 4 server); `getConDayUsage`; `guessConDay` (Task 6); `refreshMyConRuns` (Task 8's store file); `CloudFile` type (has `conDay?: string`, `createdAt?` — check the interface; if `createdAt` is absent on `CloudFile`, guess from `new Date().toISOString()` i.e. today).
- Produces: `<ConDaySaveDialog file={CloudFile} open={boolean} onClose={() => void} onSaved={(conDay: string | null) => void} />`

- [ ] **Step 1: Extend `updateCloudFile`** in `cloud-sync.ts`:

```ts
export async function updateCloudFile(
  fileId: string,
  updates: { fileName?: string; folderId?: string | null; conDay?: string | null }
): Promise<void> {
```

(Body unchanged — it already JSON-posts `updates` via PUT.)

- [ ] **Step 2: Create `ConDaySaveDialog.svelte`**

Contract:
1. Modal overlay + centered card (same classes as QuickStartHub's card: `rounded-xl border bg-background shadow-2xl`, backdrop `bg-black/40`).
2. Title: `Save as defcon.run Activity`; subtitle: `Which DEF CON day is this run for?`.
3. On open: `getConDayUsage()`. Chips: one per usage entry — `{label.slice(0,3)}` + `<small>{short date}</small>`; disabled when `remaining <= 0` UNLESS it is the file's current `conDay` (re-saving the same day is always allowed); selected = file's existing `conDay` if set, else `guessConDay(file.createdAt ?? new Date().toISOString(), usage.map(u => u.date))`.
4. Current-tag line when `file.conDay`: `Currently: {label of file.conDay}` + a `Remove tag` text-button (calls save with `null`).
5. Admin (`$isAdmin`): extra `<input type="date">` that overrides the chip selection.
6. Save: `updateCloudFile(file.fileId, { conDay: selected })` → `onSaved(selected)`, `refreshMyConRuns()`, close. 429 from the server (surfaced as thrown `Error('Failed to update file')` today) — improve `updateCloudFile`'s error path? NO (YAGNI, keep the generic message): catch and show the error text inline in the dialog; chips stay open.
7. Quota line under chips for the selected day: `{count} of {count + remaining} runs · {label}`.

- [ ] **Step 3: Wire into `CloudStorage.svelte`**

Read the file-row action area first (it already uses `updateCloudFile` for rename/move). Add per-file action — icon button `CalendarCheck` (from `@lucide/svelte`, already the icon set) with tooltip/aria-label `Save as defcon.run Activity` — that sets `conDayDialogFile = file`. Render at component root:

```svelte
{#if conDayDialogFile}
    <ConDaySaveDialog
        file={conDayDialogFile}
        open={true}
        onClose={() => (conDayDialogFile = null)}
        onSaved={() => {
            conDayDialogFile = null;
            void refreshFiles(); // whatever the component's existing list-reload fn is named
        }}
    />
{/if}
```

(Match the component's actual state idiom — `$state` runes vs `let` — and its existing list-refresh function name.)

- [ ] **Step 4: Build** — `./build-frontend.sh` → clean.

- [ ] **Step 5: Commit**

```bash
git add gpx-studio/website/src/lib/components/cloud/ConDaySaveDialog.svelte gpx-studio/website/src/lib/components/cloud/CloudStorage.svelte gpx-studio/website/src/lib/cloud-sync.ts
git commit -m "feat(gpx): Save-as-defcon.run-Activity con-day dialog on My Maps files"
```

---

### Task 11: "My DEF CON Runs" map layer

**Files:**
- Create: `apps/run.gpx/gpx-studio/website/src/lib/components/map/my-con-runs.ts`
- Create: `apps/run.gpx/gpx-studio/website/src/lib/components/map/layer-control/MyConRuns.svelte`
- Modify: `apps/run.gpx/gpx-studio/website/src/lib/components/map/layer-control/LayerControl.svelte`

**Interfaces:**
- Consumes: `GET {getApiBase()}/files/con-runs` (Task 5); `myConRunsRefresh` store (Task 8); `parseGPX`; `DC34_ROUTE_RAMP`/`routeColor` from `$lib/dc34-palette`; layer patterns from `public-overlays.ts` (glow+core pair, `whenStyleReady`, visibility toggles, fit-on-toggle).
- Produces:
  - `export const myConRunGroups = writable<{ conDay: string; label: string; visible: boolean; runs: { fileId: string; fileName: string; visible: boolean }[] }[]>([])`
  - `export class MyConRunsLayer { constructor(map); load(): Promise<void>; reload(): Promise<void>; setDayVisible(conDay: string, visible: boolean): void; setRunVisible(fileId: string, visible: boolean): void; remove(): void }`

**Implementation notes (follow `public-overlays.ts` structurally, but much smaller):**
1. `load()`: fetch manifest with `credentials: 'include'`; 401/403/empty → set `myConRunGroups` to `[]` and return (never breaks the studio). Group runs by `conDay` ascending; label = weekday from the date (`new Date(conDay + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'long' })` — matches CON_DAYS labels without duplicating the list).
2. Color: one FIXED color per con day = `routeColor(indexOfDayInSortedDays)` so all of Friday's runs share a hue.
3. Per run: fetch `downloadUrl` GPX, `parseGPX(...).toGeoJSON()`, add glow+core line pair with source/layer ids `my-con-run-{fileId}` / `-glow` (copy `addRouteLayer` shape from public-overlays MINUS popups/POIs/hover — a simple click popup with `fileName` + day label + distance via `escapeHtml` copied helper is enough). Layers start `visibility: 'none'`; groups default OFF.
4. Cache bounds per run for fit-on-toggle (copy `fitToRoutes` logic).
5. `reload()`: `remove()` then `load()` (drop existing sources/layers first; keep it idempotent).
6. `remove()`: detach listeners, drop layers/sources, reset store.

**`MyConRuns.svelte`:** render from `$myConRunGroups` mirroring `PublicOverlays.svelte`'s group/route toggle markup (checkbox per day with run count, nested per-run checkboxes). Empty groups → render nothing. Props: `layer: MyConRunsLayer`.

**`LayerControl.svelte` wiring:**
1. `import { MyConRunsLayer, myConRunGroups } from '../my-con-runs';` + `import MyConRuns from './MyConRuns.svelte';` + `import { myConRunsRefresh } from '$lib/stores/my-con-runs';` + `import { isAuthenticated } from '$lib/stores/auth';`
2. Where `publicOverlaysLayer` is constructed (~line 219): `myConRunsLayer = new MyConRunsLayer(_map); if (get(isAuthenticated)) void myConRunsLayer.load();`
3. Subscribe: `myConRunsRefresh.subscribe((n) => { if (n > 0 && myConRunsLayer) void myConRunsLayer.reload(); });` (guard the initial 0).
4. In the panel markup, directly under the `<PublicOverlays …/>` section (~line 358): `{#if $myConRunGroups.length > 0}<MyConRuns layer={myConRunsLayer} />{/if}` with a section heading `My DEF CON Runs`.
5. Mirror the teardown path: call `myConRunsLayer?.remove()` wherever `publicOverlaysLayer` is removed/rebuilt (style changes).

- [ ] **Step 1: Implement `my-con-runs.ts`** per the notes above.
- [ ] **Step 2: Implement `MyConRuns.svelte`** mirroring `PublicOverlays.svelte` markup.
- [ ] **Step 3: Wire `LayerControl.svelte`** (all 5 points).
- [ ] **Step 4: Build** — `./build-frontend.sh` → clean.
- [ ] **Step 5: Commit**

```bash
git add gpx-studio/website/src/lib/components/map/my-con-runs.ts gpx-studio/website/src/lib/components/map/layer-control/MyConRuns.svelte gpx-studio/website/src/lib/components/map/layer-control/LayerControl.svelte
git commit -m "feat(gpx): My DEF CON Runs read-only layer grouped by con day"
```

---

### Task 12: Full gates + PR

- [ ] **Step 1: Full webapp test suite**

Run: `cd apps/run.gpx/webapp && nvm use 22.12.0 && npx vitest run`
Expected: ALL green (new + pre-existing).

- [ ] **Step 2: Webapp production build**

Run: `cd apps/run.gpx/webapp && npm run build`
Expected: clean Next.js build.

- [ ] **Step 3: Studio frontend build (final)**

Run: `cd apps/run.gpx && ./build-frontend.sh`
Expected: clean.

- [ ] **Step 4: Push + PR**

```bash
git pull --rebase origin main
git push -u origin feature/gpx-strava-strip
gh pr create \
  --title "feat(gpx): Strava last-7-days strip, Save-as-defcon.run-Activity, My DEF CON Runs layer" \
  --body "$(cat <<'EOF'
## Summary
- **Strava strip**: bottom-docked carousel on the map editor showing the signed-in runner's last 7 days of Strava activities (polyline thumbnails, ‹ › paging). Tap → con-day confirm popover (guessed day pre-selected, quota inline) → imports that ONE activity as a runner file and lands it on the map. Connect-CTA when Strava isn't linked. The QuickStart hub's "From Strava" button now opens the strip instead of bulk-importing.
- **Save as defcon.run Activity**: con-day chip dialog on My Maps files — assign/move/clear a file's con day; ANY con day is choosable now (no no-future gate on these new paths); target-day cap enforced on moves.
- **My DEF CON Runs layer**: read-only overlay (public-overlays pattern) rendering the runner's own day-tagged runs, grouped + colored per con day, refreshing after imports/re-tags.

New routes: `GET /api/gpx/strava/activities`, `POST /api/gpx/strava/import`, `GET /api/gpx/files/con-runs`; `PUT /api/gpx/files/[id]` now accepts `conDay`.

Spec: `docs/superpowers/specs/2026-07-21-gpx-strava-strip-design.md`
Mockup: https://claude.ai/code/artifact/37fd049d-bccb-4912-9fe0-89bd2068bb78

## Test plan
- [x] vitest: new route tests (guards, quota consume/refund, dedupe 409, cap 429, no-GPS 422, conDay PUT rules) + pure helpers (polyline decode fixture, day-guess, 7-day window)
- [x] Existing strava-sync/con-day suites green
- [x] `npm run build` (webapp) + `build-frontend.sh` (studio)
- [ ] UAT (Kurt): strip on gpx.defcon.run, import a real activity, save-as dialog, layer toggles

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR URL printed. **Do NOT merge.**

- [ ] **Step 5: Land-the-plane checklist** — `git status` clean + `up to date with origin`; no stashes; report PR link + UAT notes.

---

## Self-review notes

- Spec coverage: strip list/import (T1–T3, T7–T8), hub rewire (T9), save-as dialog + PUT (T4, T10), my-runs layer (T5, T11), any-con-day rule (T3, T4, T8, T10), quota/dedupe/telemetry constraints (T1–T3), tests + builds (per-task + T12). Out-of-scope items untouched (batch sync, run.auth).
- Type consistency: `StripActivity` defined server-side (Task 1) and mirrored client-side (Task 7) — field names identical. `getExistingStravaIds`, `importActivityForConDay`, `fetchActivityById`, `listActivitiesSince` names consistent across Tasks 1–3. Store names `stravaStripExpanded`/`openStravaStrip`/`myConRunsRefresh`/`refreshMyConRuns` consistent across Tasks 8–11.
- Known judgment calls for the implementer: exact insertion points in `PUT` (Task 4) and `LayerControl.svelte` (Task 11) require reading the current handler/file first — the plan gives the rules and the code, not blind line numbers.
