import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * GET /api/leaderboard/me — the self-scoped "Your standing" route.
 *
 * Two properties matter and both are asserted here:
 *
 *   1. THE GATE. Access is `LEADERBOARD_SELF_ENABLED || admin`, and every
 *      denial is a BARE 404 with an empty body (non-disclosure) — never a
 *      403/401. Pre-launch, a non-admin must not be able to tell the route
 *      exists, and the expensive scan must never run for them.
 *   2. SELF-SCOPE. The response carries exactly ONE row and it is always the
 *      SESSION's own row — the handler takes no userId input, so there is no
 *      way to aim it at another runner even though the underlying scan holds
 *      every runner.
 *
 * `LEADERBOARD_SELF_ENABLED` is a module constant, so the launch-flag branches
 * are driven by re-mocking `@/lib/leaderboard-launch` and re-importing the
 * route with `vi.resetModules()`.
 */

const mockAuth = vi.fn();
const mockRevalidateAdmin = vi.fn();
const mockScan = vi.fn();
const mockLoadDrill = vi.fn();

vi.mock("@/config/auth", () => ({
  auth: (...a: unknown[]) => mockAuth(...a),
  revalidateAdmin: (...a: unknown[]) => mockRevalidateAdmin(...a),
  revalidateGroups: vi.fn(),
}));
vi.mock("@/entities/run-user", () => ({
  scanAllRunUsers: (...a: unknown[]) => mockScan(...a),
}));
// Both caches pass straight through to the injected loader — their own
// behaviour is proven in leaderboard-cache.test.ts / the drill-cache suite.
vi.mock("@/lib/leaderboard-cache", () => ({
  getCachedScan: (scan: () => Promise<unknown[]>) => scan(),
  __resetLeaderboardCache: vi.fn(),
}));
vi.mock("@/lib/leaderboard-drill-cache", () => ({
  getCachedDrill: (_userId: string, load: () => Promise<unknown>) => load(),
  bustDrillCache: vi.fn(),
}));
vi.mock("@/lib/leaderboard-drill-load", () => ({
  loadDrill: (...a: unknown[]) => mockLoadDrill(...a),
}));

/** Three runners; "me" is deliberately NOT the top of the board. */
const FIXTURE = [
  { userId: "other-a", displayName: "Alice", activityScore: 300 },
  { userId: "me-uuid", displayName: "Kurt", activityScore: 120, ctfScore: 20, ctfSolves: 1 },
  { userId: "other-c", displayName: "Charlie", activityScore: 80 },
];

const DRILL = {
  accomplishments: [{ type: "run", source: "gpx", name: "Morning 5k", completedAt: 1, year: 2026 }],
  social: { days: [{ day: "2026-08-01", count: 2, points: 20 }], egg: null },
  ctf: [{ challenge: "x", name: "Covert thing", points: 50, channel: "covert", at: "2026-08-01" }],
};

/** Import the route fresh with the launch flag forced to `enabled`. */
async function loadRoute(enabled: boolean) {
  vi.resetModules();
  vi.doMock("@/lib/leaderboard-launch", () => ({ LEADERBOARD_SELF_ENABLED: enabled }));
  return (await import("../route")).GET;
}

const adminSession = {
  user: { id: "me-uuid", authUserId: "oidc-sub", services: ["admin"] },
};
const runnerSession = {
  user: { id: "me-uuid", authUserId: "oidc-sub", services: [] },
};

beforeEach(() => {
  mockAuth.mockReset();
  mockRevalidateAdmin.mockReset();
  mockScan.mockReset();
  mockLoadDrill.mockReset();
  mockScan.mockResolvedValue(FIXTURE);
  mockLoadDrill.mockResolvedValue(DRILL);
  mockRevalidateAdmin.mockResolvedValue(true);
});

describe("GET /api/leaderboard/me — gate", () => {
  it("404s (bare, no body) with no session, and NEVER scans", async () => {
    mockAuth.mockResolvedValue(null);
    const GET = await loadRoute(false);
    const res = await GET();
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("");
    expect(mockScan).not.toHaveBeenCalled();
  });

  it("404s (bare, no body) for a non-admin while the flag is OFF, and NEVER scans", async () => {
    mockAuth.mockResolvedValue(runnerSession);
    const GET = await loadRoute(false);
    const res = await GET();
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("");
    expect(mockScan).not.toHaveBeenCalled();
    expect(mockLoadDrill).not.toHaveBeenCalled();
  });

  it("404s for an admin whose LIVE claims were revoked (fail-closed)", async () => {
    mockAuth.mockResolvedValue(adminSession);
    mockRevalidateAdmin.mockResolvedValue(false);
    const GET = await loadRoute(false);
    const res = await GET();
    expect(res.status).toBe(404);
    expect(mockScan).not.toHaveBeenCalled();
  });

  it("revalidates the admin with the OIDC sub, NOT the adapter uuid", async () => {
    mockAuth.mockResolvedValue(adminSession);
    const GET = await loadRoute(false);
    await GET();
    expect(mockRevalidateAdmin).toHaveBeenCalledWith("oidc-sub");
  });

  it("200s for an admin while the flag is OFF", async () => {
    mockAuth.mockResolvedValue(adminSession);
    const GET = await loadRoute(false);
    const res = await GET();
    expect(res.status).toBe(200);
  });

  it("200s for a plain runner once the flag is ON, with no admin revalidation", async () => {
    mockAuth.mockResolvedValue(runnerSession);
    const GET = await loadRoute(true);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(mockRevalidateAdmin).not.toHaveBeenCalled();
  });
});

describe("GET /api/leaderboard/me — self-scope", () => {
  it("returns ONLY the session's own row, with a true GLOBAL rank", async () => {
    mockAuth.mockResolvedValue(runnerSession);
    const GET = await loadRoute(true);
    const body = await (await GET()).json();

    expect(body.row.userId).toBe("me-uuid");
    // Alice (300) outranks Kurt (120+20) — so "me" is #2 of 3, proving the rank
    // was computed over EVERYONE and not over a one-row slice.
    expect(body.row.globalRank).toBe(2);
    expect(body.total).toBe(3);
  });

  it("never leaks another runner — no other userId appears anywhere in the payload", async () => {
    mockAuth.mockResolvedValue(runnerSession);
    const GET = await loadRoute(true);
    const raw = await (await GET()).text();

    expect(raw).toContain("me-uuid");
    expect(raw).not.toContain("other-a");
    expect(raw).not.toContain("other-c");
    expect(raw).not.toContain("Alice");
    expect(raw).not.toContain("Charlie");
  });

  it("loads the drill for the SESSION's id only", async () => {
    mockAuth.mockResolvedValue(runnerSession);
    const GET = await loadRoute(true);
    await GET();
    expect(mockLoadDrill).toHaveBeenCalledTimes(1);
    expect(mockLoadDrill).toHaveBeenCalledWith("me-uuid");
  });

  it("shows the owner their own covert CTF names unmasked", async () => {
    mockAuth.mockResolvedValue(runnerSession);
    const GET = await loadRoute(true);
    const body = await (await GET()).json();
    expect(body.ctf[0].name).toBe("Covert thing");
  });

  it("caches privately, never in a shared/CDN cache", async () => {
    mockAuth.mockResolvedValue(runnerSession);
    const GET = await loadRoute(true);
    const res = await GET();
    expect(res.headers.get("Cache-Control")).toContain("private");
  });

  it("200s with row:null (not an error) for a runner absent from the board", async () => {
    mockAuth.mockResolvedValue({
      user: { id: "ghost-uuid", authUserId: "oidc-sub", services: [] },
    });
    const GET = await loadRoute(true);
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.row).toBeNull();
    // No drill work for a runner with no standing.
    expect(mockLoadDrill).not.toHaveBeenCalled();
  });
});
