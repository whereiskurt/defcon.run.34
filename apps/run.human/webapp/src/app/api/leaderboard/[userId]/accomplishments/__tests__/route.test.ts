import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * LDBR-08 (SC #1 + SC #4): the admin-gated per-user accomplishments route,
 * GET /api/leaderboard/[userId]/accomplishments.
 *
 * Mocks `@/config/auth` (`auth` + `revalidateAdmin`, the latter re-exported by
 * `@/lib/admin-gate` so the real pure `requireAdmin` still runs) and
 * `@/entities/accomplishment` (`getAccomplishmentsByUser`), then drives three
 * branches (mirrors the Phase-50 internal/accomplishment route-test convention):
 *   (a) non-admin -> BARE 404, empty body, and the data layer is NEVER hit
 *       (T-51-03 elevation gate + T-51-04 non-disclosure),
 *   (b) admin happy path -> 200 `{ accomplishments: [...] }` with the row's
 *       `metadata.polyline` preserved (SC #4),
 *   (c) stale-admin (fresh-claims deny) -> 404 (T-51-04 fail-closed).
 */

const mockAuth = vi.fn();
const mockRevalidateAdmin = vi.fn();
const mockGetAccomplishmentsByUser = vi.fn();

vi.mock("@/config/auth", () => ({
  auth: (...a: unknown[]) => mockAuth(...a),
  revalidateAdmin: (...a: unknown[]) => mockRevalidateAdmin(...a),
  revalidateGroups: vi.fn(),
}));
vi.mock("@/entities/accomplishment", () => ({
  getAccomplishmentsByUser: (...a: unknown[]) => mockGetAccomplishmentsByUser(...a),
}));

import { GET } from "../route";

const ROW = {
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

beforeEach(() => {
  mockAuth.mockReset();
  mockRevalidateAdmin.mockReset();
  mockGetAccomplishmentsByUser.mockReset();
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

  it("returns 200 with accomplishments including metadata.polyline for an admin", async () => {
    mockAuth.mockResolvedValue({
      user: { services: ["admin"], authUserId: "sub-1" },
    });
    mockRevalidateAdmin.mockResolvedValue(true);
    mockGetAccomplishmentsByUser.mockResolvedValue([ROW]);

    const res = await GET(new Request("http://x"), ctx("runner-9"));
    expect(res.status).toBe(200);

    // fresh-claims revalidation keyed by the OIDC sub, NOT the adapter id.
    expect(mockRevalidateAdmin).toHaveBeenCalledWith("sub-1");
    expect(mockGetAccomplishmentsByUser).toHaveBeenCalledWith("runner-9");

    const body = await res.json();
    expect(Array.isArray(body.accomplishments)).toBe(true);
    expect(body.accomplishments).toHaveLength(1);

    const row = body.accomplishments[0];
    expect(row.type).toBe("activity");
    expect(row.source).toBe("gpx");
    expect(row.name).toBe("Morning Run");
    expect(row.completedAt).toBe(1_700_000_000_000);
    expect(row.year).toBe(2023);
    // SC #4: the polyline survives for the Phase-52 renderer.
    expect(row.metadata.polyline).toEqual([
      { lat: 36.1, lng: -115.1 },
      { lat: 36.2, lng: -115.2 },
    ]);
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
});
