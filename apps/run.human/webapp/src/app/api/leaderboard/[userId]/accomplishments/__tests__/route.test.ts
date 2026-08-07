import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * LDBR-08 (SC #1 + SC #4) + Task 5: the per-user accomplishments drill,
 * GET /api/leaderboard/[userId]/accomplishments.
 *
 * ⚠️ OPENED 2026-08-06 (Kurt): this route was still admin-only after the
 * 2026-08-03 board launch (#1212) relaxed the /leaderboard page and GET
 * /api/leaderboard to every signed-in runner. That mismatch meant an ordinary
 * runner expanding ANY row got a bare 404 the client swallowed into an empty
 * drill — the board rendered "No runs yet." for everyone. The elevation checks
 * (`requireAdmin` + the `revalidateAdmin` round-trip) are gone from this route;
 * admin-ness now only decides whether COVERT flag names are unmasked. They
 * still govern every OTHER admin route — do not copy this gate into one.
 *
 * Mocks `@/config/auth` (`auth` + `revalidateAdmin`, the latter re-exported by
 * `@/lib/admin-gate` so the real pure `isMemberOf` still runs — this also
 * dodges the next-auth import chain: `@/lib/admin-gate` itself imports no
 * next-auth, only re-exports from `@/config/auth`, so mocking that module is
 * sufficient), `@/entities/accomplishment` (`getAccomplishmentsByUser`),
 * `@/entities/ctf` (`CtfSolve`/`CtfScoreEvent`), and `@/lib/qr-admin`
 * (`listCtf`). `@/lib/leaderboard-drill-cache` is the REAL module (reset via
 * `__resetDrillCache` in beforeEach) so the caching behavior itself is
 * exercised, not mocked away.
 *
 *   (a) ordinary signed-in runner -> 200, and NO fresh-claims round-trip,
 *   (b) anonymous -> BARE 404, empty body, data layer NEVER hit (T-51-04
 *       non-disclosure survives the opening),
 *   (c) happy path -> 200 `{ accomplishments, social, ctf, cluster }` with the
 *       row's `metadata.polyline` preserved (SC #4),
 *   (d) a second request for the same user does NOT re-hit the mocked
 *       entities (per-user drill cache, Task 3),
 *   (e) covert masking is keyed to the REQUESTING viewer, never baked into the
 *       shared cache: masked for a plain runner viewing someone else,
 *       unmasked for the owner and for an admin — and a cache HIT must not
 *       carry one viewer's unmask into another's response.
 */

const mockAuth = vi.fn();
const mockRevalidateAdmin = vi.fn();
const mockGetAccomplishmentsByUser = vi.fn();
const mockSolvesQuery = vi.fn();
const mockEventsQuery = vi.fn();
const mockListCtf = vi.fn();
const mockGetCheckInsByUser = vi.fn();
const mockClusterAwardQuery = vi.fn();

vi.mock("@/config/auth", () => ({
  auth: (...a: unknown[]) => mockAuth(...a),
  revalidateAdmin: (...a: unknown[]) => mockRevalidateAdmin(...a),
  revalidateGroups: vi.fn(),
}));
vi.mock("@/entities/accomplishment", () => ({
  getAccomplishmentsByUser: (...a: unknown[]) =>
    mockGetAccomplishmentsByUser(...a),
}));
vi.mock("@/entities/ctf", () => ({
  CtfSolve: { query: { byUser: (...a: unknown[]) => mockSolvesQuery(...a) } },
  CtfScoreEvent: {
    query: { byUser: (...a: unknown[]) => mockEventsQuery(...a) },
  },
}));
vi.mock("@/lib/qr-admin", () => ({
  listCtf: (...a: unknown[]) => mockListCtf(...a),
}));
vi.mock("@/entities/checkin", () => ({
  getCheckInsByUser: (...a: unknown[]) => mockGetCheckInsByUser(...a),
}));
// Cluster check-in bonus: the drill reads the ClusterAward ledger and the
// persisted cap. Both are mocked so this route test stays offline.
vi.mock("@/entities/cluster", () => ({
  ClusterAward: {
    query: { primary: (...a: unknown[]) => mockClusterAwardQuery(...a) },
  },
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

import { GET } from "../route";
import { __resetDrillCache } from "@/lib/leaderboard-drill-cache";
import { SOCIAL_SCAN_POINTS } from "@/lib/scoring-engine";

const ACCOMPLISHMENT_ROW = {
  userId: "runner-9",
  accomplishmentId: "gpx#gpx-1",
  type: "activity",
  source: "gpx",
  name: "Morning Run",
  description: "A nice loop",
  completedAt: 1_700_000_000_000,
  year: 2023,
  isPrivate: false,
  metadata: {
    points: 10,
    polyline: [
      { lat: 36.1, lng: -115.1 },
      { lat: 36.2, lng: -115.2 },
    ],
    distance: 5000,
    gpxFileId: "gpx-1",
  },
};

function ctx(userId: string) {
  return { params: Promise.resolve({ userId }) };
}

function mockGoAdmin() {
  mockAuth.mockResolvedValue({
    user: { services: ["admin"], authUserId: "sub-1", id: "viewer-1" },
  });
  mockRevalidateAdmin.mockResolvedValue(true);
}

/** An ordinary signed-in runner (no admin group) viewing SOMEONE ELSE's row. */
function mockGoRunner(id = "viewer-1") {
  mockAuth.mockResolvedValue({ user: { services: [], authUserId: "sub-2", id } });
}

beforeEach(() => {
  __resetDrillCache();
  mockAuth.mockReset();
  mockRevalidateAdmin.mockReset();
  mockGetAccomplishmentsByUser.mockReset();
  mockSolvesQuery.mockReset();
  mockEventsQuery.mockReset();
  mockListCtf.mockReset();

  mockGetAccomplishmentsByUser.mockResolvedValue([ACCOMPLISHMENT_ROW]);
  mockSolvesQuery.mockReturnValue({
    go: () =>
      Promise.resolve({
        data: [
          {
            challenge: "rainbow-bridge",
            points: 10,
            channel: "qr",
            solvedAt: "2026-07-20T10:00:00Z",
          },
        ],
      }),
  });
  mockEventsQuery.mockReturnValue({
    go: () =>
      Promise.resolve({
        data: [
          {
            challenge: "chained-otp",
            points: 5,
            channel: "covert",
            scoredAt: "2026-07-22T00:00:00Z",
          },
          {
            challenge: "social-scan",
            bucket: "2026-07-20#a-b",
            points: 2,
            scoredAt: "2026-07-20T10:00:00Z",
          },
          {
            challenge: "jack-egg",
            bucket: "once",
            points: 25,
            scoredAt: "2026-07-19T00:00:00Z",
          },
        ],
      }),
  });
  mockListCtf.mockResolvedValue([
    { challenge: "rainbow-bridge" },
    { challenge: "chained-otp" },
  ]);
  mockGetCheckInsByUser.mockReset();
  mockGetCheckInsByUser.mockResolvedValue({ data: [], cursor: null });
  mockClusterAwardQuery.mockReset();
  mockClusterAwardQuery.mockReturnValue({
    go: vi.fn().mockResolvedValue({ data: [] }),
  });
});

describe("GET /api/leaderboard/[userId]/accomplishments", () => {
  it("200s for an ordinary signed-in runner, with NO fresh-claims round-trip", async () => {
    mockGoRunner();
    const res = await GET(new Request("http://x"), ctx("runner-9"));
    expect(res.status).toBe(200);
    expect(mockRevalidateAdmin).not.toHaveBeenCalled();
    expect(mockGetAccomplishmentsByUser).toHaveBeenCalledWith("runner-9");

    const body = await res.json();
    expect(body.accomplishments).toHaveLength(1);
  });

  it("404s (bare) for an anonymous caller (no session)", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await GET(new Request("http://x"), ctx("runner-9"));
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("");
    expect(mockGetAccomplishmentsByUser).not.toHaveBeenCalled();
  });

  it("404s (bare) for a session carrying no user id", async () => {
    mockAuth.mockResolvedValue({ user: { services: [] } });
    const res = await GET(new Request("http://x"), ctx("runner-9"));
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("");
    expect(mockGetAccomplishmentsByUser).not.toHaveBeenCalled();
  });

  it("returns 200 with accomplishments (incl. metadata.polyline), social rollup, and named ctf lines", async () => {
    mockGoAdmin();

    const res = await GET(new Request("http://x"), ctx("runner-9"));
    expect(res.status).toBe(200);

    // No elevation round-trip left on this route (opened 2026-08-06); admin-ness
    // is read off the session only, to decide covert unmasking.
    expect(mockRevalidateAdmin).not.toHaveBeenCalled();
    expect(mockGetAccomplishmentsByUser).toHaveBeenCalledWith("runner-9");
    expect(mockSolvesQuery).toHaveBeenCalledWith({ user: "runner-9" });
    expect(mockEventsQuery).toHaveBeenCalledWith({ user: "runner-9" });

    const body = await res.json();

    // accomplishments — unchanged shape (SC #4: polyline survives).
    expect(body.accomplishments).toHaveLength(1);
    expect(body.accomplishments[0].metadata.polyline).toEqual([
      { lat: 36.1, lng: -115.1 },
      { lat: 36.2, lng: -115.2 },
    ]);

    // social rollup — points DERIVED per scan, not read off the row (the
    // fixture stores `points: 2` and is deliberately ignored).
    expect(body.social.days).toEqual([
      { day: "2026-07-20", count: 1, points: SOCIAL_SCAN_POINTS },
    ]);
    expect(body.social.egg).toEqual({ points: 25, at: "2026-07-19T00:00:00Z" });

    // named ctf lines, sorted desc by `at`.
    expect(body.ctf).toEqual([
      {
        challenge: "chained-otp",
        name: "chained-otp",
        points: 5,
        channel: "covert",
        at: "2026-07-22T00:00:00Z",
      },
      {
        challenge: "rainbow-bridge",
        name: "rainbow-bridge",
        points: 10,
        channel: "qr",
        at: "2026-07-20T10:00:00Z",
      },
    ]);
  });

  /**
   * Covert names are PUBLIC as of 2026-08-06 (Kurt) — the generic "Covert flag"
   * label is gone. These three pin that the same real name reaches an admin,
   * the solver, and an unrelated runner, so a viewer branch cannot creep back
   * in unnoticed.
   */
  it.each([
    ["an admin viewer", () => mockGoAdmin()],
    ["the owner", () => mockGoRunner("runner-9")],
    ["an ordinary runner viewing someone else", () => mockGoRunner("someone-else")],
  ])("shows a covert flag's REAL name to %s", async (_who, asViewer) => {
    asViewer();
    const res = await GET(new Request("http://x"), ctx("runner-9"));
    const body = await res.json();
    const covert = body.ctf.find((l: { channel?: string }) => l.channel === "covert");
    expect(covert.name).toBe("chained-otp");
    expect(body.ctf.some((l: { name: string }) => l.name === "Covert flag")).toBe(false);
    // The channel itself SURVIVES the unmasking — RunnerDrill still badges a
    // covert solve, it just no longer hides which challenge it was.
    expect(covert.channel).toBe("covert");
  });

  it("caches per-user: a second request for the same user does not re-hit the entities", async () => {
    mockGoAdmin();

    await GET(new Request("http://x"), ctx("runner-9"));
    await GET(new Request("http://x"), ctx("runner-9"));

    expect(mockGetAccomplishmentsByUser).toHaveBeenCalledTimes(1);
    expect(mockSolvesQuery).toHaveBeenCalledTimes(1);
    expect(mockEventsQuery).toHaveBeenCalledTimes(1);
    expect(mockListCtf).toHaveBeenCalledTimes(1);
  });

  it("injects a single-point polyline for a PUBLIC check-in, never a private one", async () => {
    mockGoAdmin();
    mockGetAccomplishmentsByUser.mockResolvedValue([
      {
        ...ACCOMPLISHMENT_ROW,
        accomplishmentId: "checkin#ci-pub",
        source: "checkin",
        name: "Check-in: Web GPS",
        metadata: { points: 1, checkInId: "ci-pub" },
      },
      {
        ...ACCOMPLISHMENT_ROW,
        accomplishmentId: "checkin#ci-priv",
        source: "checkin",
        name: "Check-in: Web GPS",
        metadata: { points: 1, checkInId: "ci-priv" },
      },
    ]);
    mockGetCheckInsByUser.mockResolvedValue({
      data: [
        { checkInId: "ci-pub", latitude: 36.135, longitude: -115.158, isPrivate: false },
        { checkInId: "ci-priv", latitude: 36.1, longitude: -115.1, isPrivate: true },
      ],
      cursor: null,
    });

    const res = await GET(new Request("http://x"), ctx("runner-9"));
    const body = await res.json();

    expect(mockGetCheckInsByUser).toHaveBeenCalledWith("runner-9", 200);
    const pub = body.accomplishments.find(
      (a: { metadata?: { checkInId?: string } }) => a.metadata?.checkInId === "ci-pub"
    );
    const priv = body.accomplishments.find(
      (a: { metadata?: { checkInId?: string } }) => a.metadata?.checkInId === "ci-priv"
    );
    expect(pub.metadata.polyline).toEqual([{ lat: 36.135, lng: -115.158 }]);
    expect(priv.metadata.polyline).toBeUndefined();
  });

  it("sets a private, 60s Cache-Control header", async () => {
    mockGoAdmin();
    const res = await GET(new Request("http://x"), ctx("runner-9"));
    expect(res.headers.get("Cache-Control")).toBe("private, max-age=60");
  });
});
