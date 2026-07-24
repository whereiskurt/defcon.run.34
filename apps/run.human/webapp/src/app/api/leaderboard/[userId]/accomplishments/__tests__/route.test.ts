import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * LDBR-08 (SC #1 + SC #4) + Task 5: the admin-gated per-user accomplishments
 * drill, GET /api/leaderboard/[userId]/accomplishments.
 *
 * Mocks `@/config/auth` (`auth` + `revalidateAdmin`, the latter re-exported by
 * `@/lib/admin-gate` so the real pure `requireAdmin` still runs — this also
 * dodges the next-auth import chain: `@/lib/admin-gate` itself imports no
 * next-auth, only re-exports from `@/config/auth`, so mocking that module is
 * sufficient), `@/entities/accomplishment` (`getAccomplishmentsByUser`),
 * `@/entities/ctf` (`CtfSolve`/`CtfScoreEvent`), and `@/lib/qr-admin`
 * (`listCtf`). `@/lib/leaderboard-drill-cache` is the REAL module (reset via
 * `__resetDrillCache` in beforeEach) so the caching behavior itself is
 * exercised, not mocked away.
 *
 *   (a) non-admin -> BARE 404, empty body, and the data layer is NEVER hit
 *       (T-51-03 elevation gate + T-51-04 non-disclosure),
 *   (b) admin happy path -> 200 `{ accomplishments, social, ctf }` with the
 *       row's `metadata.polyline` preserved (SC #4),
 *   (c) stale-admin (fresh-claims deny) -> 404 (T-51-04 fail-closed),
 *   (d) a second request for the same user does NOT re-hit the mocked
 *       entities (per-user drill cache, Task 3),
 *   (e) a covert-channel CTF line's name passes through UNMASKED for an
 *       admin viewer (the route is admin-gated today, so isAdmin is always
 *       true — pinning that maskCtfLines's admin branch is actually wired).
 */

const mockAuth = vi.fn();
const mockRevalidateAdmin = vi.fn();
const mockGetAccomplishmentsByUser = vi.fn();
const mockSolvesQuery = vi.fn();
const mockEventsQuery = vi.fn();
const mockListCtf = vi.fn();

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

import { GET } from "../route";
import { __resetDrillCache } from "@/lib/leaderboard-drill-cache";

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
});

describe("GET /api/leaderboard/[userId]/accomplishments", () => {
  it("404s (bare, no body) for a non-admin and NEVER hits the data layer", async () => {
    mockAuth.mockResolvedValue({ user: { services: [] } });
    const res = await GET(new Request("http://x"), ctx("runner-9"));
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("");
    expect(mockRevalidateAdmin).not.toHaveBeenCalled();
    expect(mockGetAccomplishmentsByUser).not.toHaveBeenCalled();
  });

  it("404s (bare) for an anonymous caller (no session)", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await GET(new Request("http://x"), ctx("runner-9"));
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("");
    expect(mockGetAccomplishmentsByUser).not.toHaveBeenCalled();
  });

  it("404s (fresh-claims deny) for a stale admin whose revalidation fails", async () => {
    mockAuth.mockResolvedValue({
      user: { services: ["admin"], authUserId: "sub-1" },
    });
    mockRevalidateAdmin.mockResolvedValue(false);

    const res = await GET(new Request("http://x"), ctx("runner-9"));
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("");
    expect(mockGetAccomplishmentsByUser).not.toHaveBeenCalled();
  });

  it("returns 200 with accomplishments (incl. metadata.polyline), social rollup, and named ctf lines", async () => {
    mockGoAdmin();

    const res = await GET(new Request("http://x"), ctx("runner-9"));
    expect(res.status).toBe(200);

    // fresh-claims revalidation keyed by the OIDC sub, NOT the adapter id.
    expect(mockRevalidateAdmin).toHaveBeenCalledWith("sub-1");
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

    // social rollup.
    expect(body.social.days).toEqual([
      { day: "2026-07-20", count: 1, points: 2 },
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

  it("pins that a covert flag's name passes through UNMASKED for an admin viewer", async () => {
    mockGoAdmin();
    const res = await GET(new Request("http://x"), ctx("runner-9"));
    const body = await res.json();
    const covert = body.ctf.find((l: { channel?: string }) => l.channel === "covert");
    expect(covert.name).toBe("chained-otp");
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

  it("sets a private, 60s Cache-Control header", async () => {
    mockGoAdmin();
    const res = await GET(new Request("http://x"), ctx("runner-9"));
    expect(res.headers.get("Cache-Control")).toBe("private, max-age=60");
  });
});
