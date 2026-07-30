import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * POST /api/admin/ctf-award (points-consistency Task 10) — the admin-only
 * "exceptional run" (+1000) award button's endpoint.
 *
 * Same non-disclosure admin gate as `api/admin/users/[userId]/recalculate`
 * (bare 404 on requireAdmin fail / missing session.user.authUserId / stale
 * revalidateAdmin). Always submits the fixed `exceptional-run` challenge via
 * judgeSolve's server-caller `grant` path (never caller-chosen) and rescores
 * the target only on a credited (points > 0) solve.
 *
 * Mocks `@/config/auth` (dodging the next-auth import chain, same landmine
 * noted in the recalculate route test), `@/lib/ctf-judge`, and
 * `@/lib/rescore`.
 */

const mockAuth = vi.fn();
const mockRevalidateAdmin = vi.fn();
const mockJudgeSolve = vi.fn();
const mockRescoreBestEffort = vi.fn();

vi.mock("@/config/auth", () => ({
  auth: (...a: unknown[]) => mockAuth(...a),
  revalidateAdmin: (...a: unknown[]) => mockRevalidateAdmin(...a),
  revalidateGroups: vi.fn(),
}));
vi.mock("@/lib/ctf-judge", () => ({
  judgeSolve: (...a: unknown[]) => mockJudgeSolve(...a),
}));
vi.mock("@/lib/rescore", () => ({
  rescoreBestEffort: (...a: unknown[]) => mockRescoreBestEffort(...a),
}));

import { POST } from "../route";
import type { NextRequest } from "next/server";

function makeReq(body: unknown) {
  const json = vi.fn(async () => body);
  const request = { json } as unknown as NextRequest;
  return { request, json };
}

function mockGoAdmin() {
  mockAuth.mockResolvedValue({
    user: { services: ["admin"], authUserId: "sub-viewer", id: "viewer-1" },
  });
  mockRevalidateAdmin.mockResolvedValue(true);
}

beforeEach(() => {
  mockAuth.mockReset();
  mockRevalidateAdmin.mockReset();
  mockJudgeSolve.mockReset();
  mockRescoreBestEffort.mockReset();
});

describe("POST /api/admin/ctf-award", () => {
  it("404s (bare, no body) for a non-admin and never touches judgeSolve", async () => {
    mockAuth.mockResolvedValue({ user: { services: [] } });
    const { request, json } = makeReq({ userId: "runner-9" });
    const res = await POST(request);
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("");
    expect(json).not.toHaveBeenCalled();
    expect(mockRevalidateAdmin).not.toHaveBeenCalled();
    expect(mockJudgeSolve).not.toHaveBeenCalled();
  });

  it("404s (bare) for an anonymous caller (no session)", async () => {
    mockAuth.mockResolvedValue(null);
    const { request } = makeReq({ userId: "runner-9" });
    const res = await POST(request);
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("");
    expect(mockJudgeSolve).not.toHaveBeenCalled();
  });

  it("404s (fresh-claims deny) for a stale admin whose revalidation fails", async () => {
    mockAuth.mockResolvedValue({
      user: { services: ["admin"], authUserId: "sub-viewer" },
    });
    mockRevalidateAdmin.mockResolvedValue(false);
    const { request } = makeReq({ userId: "runner-9" });
    const res = await POST(request);
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("");
    expect(mockJudgeSolve).not.toHaveBeenCalled();
  });

  it("400s when userId is missing", async () => {
    mockGoAdmin();
    const { request } = makeReq({});
    const res = await POST(request);
    expect(res.status).toBe(400);
    expect(mockJudgeSolve).not.toHaveBeenCalled();
  });

  it("awards +1000 and rescores on a credited solve", async () => {
    mockGoAdmin();
    mockJudgeSolve.mockResolvedValue({
      solved: true,
      points: 1000,
      ordinal: 1,
      firstBlood: true,
      capped: false,
    });
    const { request } = makeReq({ userId: "runner-9" });
    const res = await POST(request);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, points: 1000 });
    expect(mockJudgeSolve).toHaveBeenCalledWith(
      { user: "runner-9", challenge: "exceptional-run", channel: "qr", grant: true },
      {},
    );
    expect(mockRescoreBestEffort).toHaveBeenCalledWith("runner-9");
  });

  it("409s on a same-day replay (repeatable window collision) without rescoring", async () => {
    mockGoAdmin();
    mockJudgeSolve.mockResolvedValue({
      solved: false,
      points: 0,
      ordinal: null,
      firstBlood: false,
      capped: false,
    });
    const { request } = makeReq({ userId: "runner-9" });
    const res = await POST(request);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ ok: false, reason: "not-awarded" });
    expect(mockRescoreBestEffort).not.toHaveBeenCalled();
  });

  it("409s when the exceptional-run row is missing/disabled (not yet seeded)", async () => {
    mockGoAdmin();
    mockJudgeSolve.mockResolvedValue({
      solved: false,
      points: 0,
      ordinal: null,
      firstBlood: false,
      capped: false,
    });
    const { request } = makeReq({ userId: "runner-9" });
    const res = await POST(request);
    expect(res.status).toBe(409);
    expect(mockRescoreBestEffort).not.toHaveBeenCalled();
  });
});
