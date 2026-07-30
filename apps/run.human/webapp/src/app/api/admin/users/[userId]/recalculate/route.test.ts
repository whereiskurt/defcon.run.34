import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * POST /api/admin/users/[userId]/recalculate (Task 7) — the admin
 * per-user "Recalculate score" action.
 *
 * Same non-disclosure admin gate as
 * `api/leaderboard/[userId]/accomplishments/route.ts` (bare 404 on
 * requireAdmin fail / missing authUserId / stale revalidateAdmin). Resolves
 * the OIDC sub for the adapter userId via `getSubByAdapterUserId` (422 if
 * unresolvable — the row has no run.auth-linked identity to reconcile).
 * Calls run.gpx's internal reconcile endpoint with the shared secret; on a
 * 2xx upstream it busts this user's leaderboard drill cache and forwards
 * `{created, deleted}`; a non-2xx upstream maps to a 502 so the operator
 * sees a clear "the reconcile itself failed" signal rather than a silent
 * no-op.
 *
 * Mocks `@/config/auth` (dodging the next-auth import chain, same landmine
 * noted in the accomplishments route test), `@/entities/auth-user`,
 * `@/lib/leaderboard-drill-cache`, `@/config` (for the internal secret), and
 * global `fetch`.
 */

const mockAuth = vi.fn();
const mockRevalidateAdmin = vi.fn();
const mockGetSubByAdapterUserId = vi.fn();
const mockBustDrillCache = vi.fn();
const mockRescoreBestEffort = vi.fn();

vi.mock("@/config/auth", () => ({
  auth: (...a: unknown[]) => mockAuth(...a),
  revalidateAdmin: (...a: unknown[]) => mockRevalidateAdmin(...a),
  revalidateGroups: vi.fn(),
}));
vi.mock("@/entities/auth-user", () => ({
  getSubByAdapterUserId: (...a: unknown[]) => mockGetSubByAdapterUserId(...a),
}));
vi.mock("@/lib/leaderboard-drill-cache", () => ({
  bustDrillCache: (...a: unknown[]) => mockBustDrillCache(...a),
}));
vi.mock("@/lib/rescore", () => ({
  rescoreBestEffort: (...a: unknown[]) => mockRescoreBestEffort(...a),
}));
vi.mock("@/config", () => ({
  config: { auth: { internalSecret: "s3cr3t" } },
}));

import { POST } from "./route";

function ctx(userId: string) {
  return { params: Promise.resolve({ userId }) };
}

function mockGoAdmin() {
  mockAuth.mockResolvedValue({
    user: { services: ["admin"], authUserId: "sub-viewer", id: "viewer-1" },
  });
  mockRevalidateAdmin.mockResolvedValue(true);
}

const originalFetch = global.fetch;

beforeEach(() => {
  mockAuth.mockReset();
  mockRevalidateAdmin.mockReset();
  mockGetSubByAdapterUserId.mockReset();
  mockBustDrillCache.mockReset();
  mockRescoreBestEffort.mockReset();
  global.fetch = vi.fn();
});

afterEach(() => {
  global.fetch = originalFetch;
});

describe("POST /api/admin/users/[userId]/recalculate", () => {
  it("404s (bare, no body) for a non-admin and never resolves a sub", async () => {
    mockAuth.mockResolvedValue({ user: { services: [] } });
    const res = await POST(new Request("http://x", { method: "POST" }), ctx("runner-9"));
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("");
    expect(mockRevalidateAdmin).not.toHaveBeenCalled();
    expect(mockGetSubByAdapterUserId).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("404s (bare) for an anonymous caller (no session)", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await POST(new Request("http://x", { method: "POST" }), ctx("runner-9"));
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("");
    expect(mockGetSubByAdapterUserId).not.toHaveBeenCalled();
  });

  it("404s (fresh-claims deny) for a stale admin whose revalidation fails", async () => {
    mockAuth.mockResolvedValue({
      user: { services: ["admin"], authUserId: "sub-viewer" },
    });
    mockRevalidateAdmin.mockResolvedValue(false);

    const res = await POST(new Request("http://x", { method: "POST" }), ctx("runner-9"));
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("");
    expect(mockGetSubByAdapterUserId).not.toHaveBeenCalled();
  });

  it("422s when the user has no linked OIDC sub", async () => {
    mockGoAdmin();
    mockGetSubByAdapterUserId.mockResolvedValue(null);

    const res = await POST(new Request("http://x", { method: "POST" }), ctx("runner-9"));
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "no sub" });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("happy path: reconciles upstream, busts the drill cache, returns ok+counts", async () => {
    mockGoAdmin();
    mockGetSubByAdapterUserId.mockResolvedValue("sub-9");
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, created: 1, deleted: 2 }),
    });

    const res = await POST(new Request("http://x", { method: "POST" }), ctx("runner-9"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, created: 1, deleted: 2 });

    expect(mockRevalidateAdmin).toHaveBeenCalledWith("sub-viewer");
    expect(mockGetSubByAdapterUserId).toHaveBeenCalledWith("runner-9");
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/gpx\/internal\/reconcile$/),
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          "x-internal-secret": "s3cr3t",
        }),
        body: JSON.stringify({ sub: "sub-9" }),
      })
    );
    expect(mockBustDrillCache).toHaveBeenCalledWith("runner-9");
    expect(mockRescoreBestEffort).toHaveBeenCalledWith("runner-9");
  });

  it("502s when the upstream reconcile call fails, without busting the cache", async () => {
    mockGoAdmin();
    mockGetSubByAdapterUserId.mockResolvedValue("sub-9");
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: "boom" }),
    });

    const res = await POST(new Request("http://x", { method: "POST" }), ctx("runner-9"));
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "reconcile failed" });
    expect(mockBustDrillCache).not.toHaveBeenCalled();
    expect(mockRescoreBestEffort).not.toHaveBeenCalled();
  });

  it("502s when the upstream fetch itself throws", async () => {
    mockGoAdmin();
    mockGetSubByAdapterUserId.mockResolvedValue("sub-9");
    (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("network"));

    const res = await POST(new Request("http://x", { method: "POST" }), ctx("runner-9"));
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "reconcile failed" });
    expect(mockBustDrillCache).not.toHaveBeenCalled();
    expect(mockRescoreBestEffort).not.toHaveBeenCalled();
  });
});
