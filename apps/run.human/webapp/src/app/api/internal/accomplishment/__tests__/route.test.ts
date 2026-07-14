import { describe, it, expect, vi, beforeEach } from "vitest";
import { POINTS } from "@/lib/leaderboard-scoring";

/**
 * LDBR-06 (SC-3): the secret-gated POST /api/internal/accomplishment route.
 *
 * Mocks the sub->userId resolver + createAccomplishment (the pure builder runs
 * for real) and asserts the three branches:
 *   (a) wrong/absent x-internal-secret -> 403 BEFORE the body is even parsed and
 *       BEFORE any data-layer call (T-50-01 spoofing gate),
 *   (b) an unresolvable sub -> benign 200 {dropped:true}, NOT a 4xx/5xx, and
 *       createAccomplishment is never called,
 *   (c) happy path -> createAccomplishment called exactly once with a
 *       server-fixed source "gpx", route returns {ok:true}.
 */

const mockResolve = vi.fn();
const mockCreate = vi.fn();

vi.mock("@/entities/auth-user", () => ({
  getAdapterUserIdBySub: (...a: unknown[]) => mockResolve(...a),
}));
vi.mock("@/entities/accomplishment", () => ({
  createAccomplishment: (...a: unknown[]) => mockCreate(...a),
}));
vi.mock("@/config", () => ({
  config: { auth: { internalSecret: "s3cret" } },
}));

import { POST } from "../route";
import type { NextRequest } from "next/server";

const happyBody = {
  oidcSub: "sub-1",
  gpxFileId: "gpx-9",
  name: "Morning Run",
  distance: 5000,
  elevation: 120,
  polyline: [{ lat: 1, lng: 2 }],
  completedAt: 1_700_000_000_000,
};

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
  mockCreate.mockReset();
});

describe("POST /api/internal/accomplishment", () => {
  it("403s (and never parses the body or hits the data layer) without the secret", async () => {
    const { request, json } = makeReq(null, happyBody);
    const res = await POST(request);
    expect(res.status).toBe(403);
    expect(json).not.toHaveBeenCalled();
    expect(mockResolve).not.toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("403s on a wrong secret", async () => {
    const { request } = makeReq("nope", happyBody);
    const res = await POST(request);
    expect(res.status).toBe(403);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("benign-drops (200 {dropped:true}) an unresolvable sub without creating", async () => {
    mockResolve.mockResolvedValue(null);
    const { request } = makeReq("s3cret", happyBody);
    const res = await POST(request);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ dropped: true });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("400s on a missing oidcSub", async () => {
    const { request } = makeReq("s3cret", { ...happyBody, oidcSub: undefined });
    const res = await POST(request);
    expect(res.status).toBe(400);
    expect(mockResolve).not.toHaveBeenCalled();
  });

  it("creates exactly one gpx accomplishment on the happy path and returns {ok:true}", async () => {
    mockResolve.mockResolvedValue("uuid-1");
    mockCreate.mockResolvedValue({});
    const { request } = makeReq("s3cret", happyBody);
    const res = await POST(request);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(mockResolve).toHaveBeenCalledWith("sub-1");
    expect(mockCreate).toHaveBeenCalledTimes(1);
    const input = mockCreate.mock.calls[0][0];
    expect(input.source).toBe("gpx");
    expect(input.points).toBe(POINTS.gpx);
    expect(input.userId).toBe("uuid-1");
    expect(input.gpxFileId).toBe("gpx-9");
  });
});
