import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * POST /api/admin/ctf-leaderboard — the destructive board actions (unsolve one
 * challenge / zero a runner). Mirrors the api/leaderboard route test: mock
 * `@/config/auth` (`auth` + `revalidateGroups`, the latter re-exported by
 * `@/lib/admin-gate` so the real pure `requireGroups` still runs), and stub the
 * heavy modules the route imports (`@/lib/ctf-leaderboard` for GET, and
 * `@/lib/ctf-unsolve-store` whose executors we assert against). Drives:
 *   (a) no session / not-admin / stale-admin → BARE 404, executor NEVER called
 *       (non-disclosure + fail-closed gate),
 *   (b) admin happy path → 200 and the right executor with the target userId,
 *   (c) input validation (missing user / challenge, no-op unsolve) → 400.
 */

const mockAuth = vi.fn();
const mockRevalidateGroups = vi.fn();
const mockUnsolveUser = vi.fn();
const mockUnsolveChallenge = vi.fn();

vi.mock("@/config/auth", () => ({
  auth: (...a: unknown[]) => mockAuth(...a),
  revalidateGroups: (...a: unknown[]) => mockRevalidateGroups(...a),
  revalidateAdmin: vi.fn(),
}));
// GET-only deps — stubbed so importing the route never loads entities/AWS.
vi.mock("@/lib/ctf-leaderboard", () => ({
  buildLeaderboard: vi.fn(),
  scanAllCtfSolves: vi.fn(),
  aggregateSolvesByUser: vi.fn(),
  enrichRows: vi.fn(),
  leaderboardCsv: vi.fn(),
}));
vi.mock("@/lib/ctf-unsolve-store", () => ({
  unsolveUser: (...a: unknown[]) => mockUnsolveUser(...a),
  unsolveChallenge: (...a: unknown[]) => mockUnsolveChallenge(...a),
}));

import { POST } from "../route";

const ADMIN = { user: { services: ["admin"], authUserId: "sub-admin" } };

function req(body: unknown) {
  return new Request("http://x/api/admin/ctf-leaderboard", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mockAuth.mockReset();
  mockRevalidateGroups.mockReset();
  mockUnsolveUser.mockReset();
  mockUnsolveChallenge.mockReset();
  mockRevalidateGroups.mockResolvedValue(true);
  mockUnsolveUser.mockResolvedValue({ removedSolves: 2, removedScoreEvents: 0 });
  mockUnsolveChallenge.mockResolvedValue({
    challenge: "alpha",
    removedSolves: 1,
    removedScoreEvents: 0,
  });
});

describe("POST gate (non-disclosure, fail-closed)", () => {
  it("no session → 404, executor never called", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await POST(req({ action: "unsolve_user", user: "u1" }));
    expect(res.status).toBe(404);
    expect(mockUnsolveUser).not.toHaveBeenCalled();
  });

  it("authenticated non-admin → 404, executor never called", async () => {
    mockAuth.mockResolvedValue({ user: { services: [], authUserId: "sub-x" } });
    const res = await POST(req({ action: "unsolve_user", user: "u1" }));
    expect(res.status).toBe(404);
    expect(mockUnsolveUser).not.toHaveBeenCalled();
  });

  it("stale admin (live revalidation denies) → 404", async () => {
    mockAuth.mockResolvedValue(ADMIN);
    mockRevalidateGroups.mockResolvedValue(false);
    const res = await POST(req({ action: "unsolve_user", user: "u1" }));
    expect(res.status).toBe(404);
    expect(mockUnsolveUser).not.toHaveBeenCalled();
  });
});

describe("POST dispatch (admin happy path)", () => {
  beforeEach(() => mockAuth.mockResolvedValue(ADMIN));

  it("unsolve_user zeroes the target runner", async () => {
    const res = await POST(req({ action: "unsolve_user", user: "target-1" }));
    expect(res.status).toBe(200);
    expect(mockUnsolveUser).toHaveBeenCalledWith("target-1");
    expect((await res.json()).success).toBe(true);
  });

  it("unsolve_challenge unsolves one challenge for the target", async () => {
    const res = await POST(
      req({ action: "unsolve_challenge", user: "target-1", challenge: "alpha" })
    );
    expect(res.status).toBe(200);
    expect(mockUnsolveChallenge).toHaveBeenCalledWith("target-1", "alpha");
  });

  it("missing user → 400, executor never called", async () => {
    const res = await POST(req({ action: "unsolve_user" }));
    expect(res.status).toBe(400);
    expect(mockUnsolveUser).not.toHaveBeenCalled();
  });

  it("unsolve_challenge missing challenge → 400", async () => {
    const res = await POST(req({ action: "unsolve_challenge", user: "u1" }));
    expect(res.status).toBe(400);
    expect(mockUnsolveChallenge).not.toHaveBeenCalled();
  });

  it("no-op unsolve (nothing removed) → 400", async () => {
    mockUnsolveChallenge.mockResolvedValue({
      challenge: "ghost",
      removedSolves: 0,
      removedScoreEvents: 0,
    });
    const res = await POST(
      req({ action: "unsolve_challenge", user: "u1", challenge: "ghost" })
    );
    expect(res.status).toBe(400);
  });

  it("unknown action → 400", async () => {
    const res = await POST(req({ action: "bogus" as never, user: "u1" }));
    expect(res.status).toBe(400);
  });
});
