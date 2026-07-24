import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * PUT /api/internal/accomplishment/reconcile (Task 3, Step 5).
 *
 * Diffs a user's existing Accomplishment rows against a reported run set and
 * deletes anything orphaned (gpx/strava rows whose source file/activity no
 * longer exists). Modeled on `api/internal/accomplishment/route.ts`'s
 * secret-gate/benign-drop exactly:
 *   (a) no/wrong x-internal-secret -> 403 BEFORE the body is parsed,
 *   (b) an unresolvable sub -> benign 200 {dropped:true}, no deletes,
 *   (c) happy path -> orphaned rows deleted (one call per orphan), the user's
 *       drill cache is busted, response reports deleted count + missing ids,
 *   (d) malformed `runs` (not an array, or an entry missing gpxFileId) -> 400.
 */

const mockResolve = vi.fn();
const mockGetAccomplishments = vi.fn();
const mockDelete = vi.fn();
const mockBust = vi.fn();

vi.mock("@/entities/auth-user", () => ({
  getAdapterUserIdBySub: (...a: unknown[]) => mockResolve(...a),
}));
vi.mock("@/entities/accomplishment", () => ({
  getAccomplishmentsByUser: (...a: unknown[]) => mockGetAccomplishments(...a),
  deleteAccomplishment: (...a: unknown[]) => mockDelete(...a),
}));
vi.mock("@/lib/leaderboard-drill-cache", () => ({
  bustDrillCache: (...a: unknown[]) => mockBust(...a),
}));
vi.mock("@/config", () => ({
  config: { auth: { internalSecret: "s3cret" } },
}));

import { PUT } from "./route";
import type { NextRequest } from "next/server";

function makeReq(secret: string | null, body: unknown) {
  const json = vi.fn(async () => body);
  const request = {
    headers: {
      get: (k: string) => (k === "x-internal-secret" ? secret : null),
    },
    json,
  } as unknown as NextRequest;
  return { request, json };
}

beforeEach(() => {
  mockResolve.mockReset();
  mockGetAccomplishments.mockReset();
  mockDelete.mockReset();
  mockBust.mockReset();
});

const happyBody = {
  oidcSub: "sub-1",
  runs: [{ gpxFileId: "live", source: "gpx" }],
};

describe("PUT /api/internal/accomplishment/reconcile", () => {
  it("403s (and never parses the body or hits the data layer) without the secret", async () => {
    const { request, json } = makeReq(null, happyBody);
    const res = await PUT(request);
    expect(res.status).toBe(403);
    expect(json).not.toHaveBeenCalled();
    expect(mockResolve).not.toHaveBeenCalled();
    expect(mockGetAccomplishments).not.toHaveBeenCalled();
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it("403s on a wrong secret", async () => {
    const { request } = makeReq("nope", happyBody);
    const res = await PUT(request);
    expect(res.status).toBe(403);
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it("benign-drops (200 {dropped:true}) an unresolvable sub without deleting", async () => {
    mockResolve.mockResolvedValue(null);
    const { request } = makeReq("s3cret", happyBody);
    const res = await PUT(request);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ dropped: true });
    expect(mockGetAccomplishments).not.toHaveBeenCalled();
    expect(mockDelete).not.toHaveBeenCalled();
    expect(mockBust).not.toHaveBeenCalled();
  });

  it("400s on a missing oidcSub", async () => {
    const { request } = makeReq("s3cret", { ...happyBody, oidcSub: undefined });
    const res = await PUT(request);
    expect(res.status).toBe(400);
    expect(mockResolve).not.toHaveBeenCalled();
  });

  it("400s when runs is not an array", async () => {
    const { request } = makeReq("s3cret", { oidcSub: "sub-1", runs: "nope" });
    const res = await PUT(request);
    expect(res.status).toBe(400);
    expect(mockResolve).not.toHaveBeenCalled();
  });

  it("400s when a runs entry is missing gpxFileId", async () => {
    const { request } = makeReq("s3cret", {
      oidcSub: "sub-1",
      runs: [{ source: "gpx" }],
    });
    const res = await PUT(request);
    expect(res.status).toBe(400);
    expect(mockResolve).not.toHaveBeenCalled();
  });

  it("deletes exactly the orphaned rows, busts the drill cache, and reports missing ids", async () => {
    mockResolve.mockResolvedValue("uuid-1");
    mockGetAccomplishments.mockResolvedValue([
      { accomplishmentId: "gpx#dead", source: "gpx" },
      { accomplishmentId: "checkin#c1", source: "checkin" },
    ]);
    mockDelete.mockResolvedValue(undefined);

    const { request } = makeReq("s3cret", happyBody);
    const res = await PUT(request);

    expect(res.status).toBe(200);
    expect(mockResolve).toHaveBeenCalledWith("sub-1");
    expect(mockDelete).toHaveBeenCalledTimes(1);
    expect(mockDelete).toHaveBeenCalledWith("uuid-1", "gpx#dead");
    expect(mockBust).toHaveBeenCalledWith("uuid-1");
    expect(await res.json()).toEqual({
      ok: true,
      deleted: 1,
      missing: ["live"],
    });
  });
});
