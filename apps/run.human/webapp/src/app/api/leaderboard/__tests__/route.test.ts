import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * LDBR-07 (SC #1 + SC #2 + SC #3): the main admin-gated board route,
 * GET /api/leaderboard.
 *
 * Mocks `@/config/auth` (`auth` + `revalidateAdmin`, the latter re-exported by
 * `@/lib/admin-gate` so the real pure `requireAdmin` still runs),
 * `@/entities/run-user` (`scanAllRunUsers`), and `@/lib/leaderboard-cache`
 * (`getCachedScan` passes straight through to the injected scan; the real pure
 * `buildLeaderboard` runs) — then drives the gate + ranking + paging branches:
 *   (a) non-admin -> BARE 404, empty body, and scanAllRunUsers is NEVER called
 *       (T-51-06 elevation gate + T-51-07 non-disclosure),
 *   (b) stale-admin (fresh-claims deny) -> 404 (T-51-07 fail-closed),
 *   (c) admin happy path -> 200 `{ rows, total, page, limit }` with globalRank
 *       over the full sorted set and a CTF-inclusive globalScore (SC #1/#2),
 *   (d) query params page/limit/filter parsed (defaults page 1 / limit 25) and
 *       forwarded to buildLeaderboard, with global rank preserved under filter.
 */

const mockAuth = vi.fn();
const mockRevalidateAdmin = vi.fn();
const mockScan = vi.fn();

vi.mock("@/config/auth", () => ({
  auth: (...a: unknown[]) => mockAuth(...a),
  revalidateAdmin: (...a: unknown[]) => mockRevalidateAdmin(...a),
  revalidateGroups: vi.fn(),
}));
vi.mock("@/entities/run-user", () => ({
  scanAllRunUsers: (...a: unknown[]) => mockScan(...a),
}));
// getCachedScan passes straight through to the injected scan (cache behavior is
// proven separately in leaderboard-cache.test.ts).
vi.mock("@/lib/leaderboard-cache", () => ({
  getCachedScan: (scan: () => Promise<unknown[]>) => scan(),
  __resetLeaderboardCache: vi.fn(),
}));

import { GET } from "../route";

// Distinct activityScores; runner A also carries a ctfScore so we can assert the
// CTF-inclusive globalScore. Sorted by globalScore: A(150) > B(120) > C(80).
const FIXTURE = [
  { userId: "b", displayName: "Bob", activityScore: 120 },
  { userId: "a", displayName: "Alice", activityScore: 100, ctfScore: 50, ctfSolves: 2 },
  { userId: "c", displayName: "Charlie", activityScore: 80 },
];

function req(query = "") {
  return new Request(`http://x/api/leaderboard${query}`);
}

beforeEach(() => {
  mockAuth.mockReset();
  mockRevalidateAdmin.mockReset();
  mockScan.mockReset();
  mockScan.mockResolvedValue(FIXTURE);
});

describe("GET /api/leaderboard", () => {
  it("404s (bare, no body) for a non-admin and NEVER scans", async () => {
    mockAuth.mockResolvedValue({ user: { services: [] } });
    const res = await GET(req());
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("");
    expect(mockRevalidateAdmin).not.toHaveBeenCalled();
    expect(mockScan).not.toHaveBeenCalled();
  });

  it("404s (bare) for an anonymous caller (no session) and NEVER scans", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await GET(req());
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("");
    expect(mockScan).not.toHaveBeenCalled();
  });

  it("404s (fresh-claims deny) for a stale admin whose revalidation fails", async () => {
    mockAuth.mockResolvedValue({
      user: { services: ["admin"], authUserId: "sub-1" },
    });
    mockRevalidateAdmin.mockResolvedValue(false);
    const res = await GET(req());
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("");
    expect(mockScan).not.toHaveBeenCalled();
  });

  it("returns 200 ranked rows with CTF-inclusive score for an admin", async () => {
    mockAuth.mockResolvedValue({
      user: { services: ["admin"], authUserId: "sub-1" },
    });
    mockRevalidateAdmin.mockResolvedValue(true);

    const res = await GET(req());
    expect(res.status).toBe(200);

    // fresh-claims revalidation keyed by the OIDC sub, NOT the adapter id.
    expect(mockRevalidateAdmin).toHaveBeenCalledWith("sub-1");

    const body = await res.json();
    expect(body.total).toBe(3);
    expect(body.page).toBe(1);
    expect(body.limit).toBe(25);
    expect(body.rows.map((r: { userId: string }) => r.userId)).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(body.rows[0].globalRank).toBe(1);
    // SC #2: CTF rollup folded into the top runner's globalScore.
    expect(body.rows[0].userId).toBe("a");
    expect(body.rows[0].globalScore).toBe(150);
    expect(body.rows[0].ctfSolves).toBe(2);
  });

  it("parses page/limit and returns the expected slice with global ranks", async () => {
    mockAuth.mockResolvedValue({
      user: { services: ["admin"], authUserId: "sub-1" },
    });
    mockRevalidateAdmin.mockResolvedValue(true);

    const res = await GET(req("?page=2&limit=2"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.page).toBe(2);
    expect(body.limit).toBe(2);
    expect(body.total).toBe(3);
    // page 2 of a limit-2 window over [a,b,c] -> just c, still globalRank 3.
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0].userId).toBe("c");
    expect(body.rows[0].globalRank).toBe(3);
  });

  it("applies filter AFTER ranking so global rank is preserved", async () => {
    mockAuth.mockResolvedValue({
      user: { services: ["admin"], authUserId: "sub-1" },
    });
    mockRevalidateAdmin.mockResolvedValue(true);

    const res = await GET(req("?filter=bob"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.total).toBe(1);
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0].userId).toBe("b");
    // Bob is 2nd overall — the filter narrows the page, never the rank.
    expect(body.rows[0].globalRank).toBe(2);
  });
});
