import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The secret-gated POST /api/internal/ctf/unlock-award route (points-consistency
 * Task 9). Called by the meshtk fleet when a radio passes a ghost's TOTP unlock;
 * maps the radio's nodeId to its owning RunUser and grants the ghost's
 * `unlock-<name>` flag via judgeSolve's server-caller `grant` path. Proves:
 *   (a) wrong/absent x-internal-secret → 403 before body parse or data access,
 *   (b) missing ghost/node → 400,
 *   (c) an unawardable ghost id (no trailing name segment) → 422,
 *   (d) unowned/unknown radio → 404, judgeSolve never called,
 *   (e) happy path → judgeSolve called with `unlock-<name>`, channel "qr",
 *       grant: true; rescoreBestEffort fires only when solved; response is
 *       {solved, points}.
 */

const mockGetMeshRadio = vi.fn();
const mockJudgeSolve = vi.fn();
const mockRescoreBestEffort = vi.fn();

vi.mock("@/config", () => ({
  config: { auth: { internalSecret: "s3cret" } },
}));
vi.mock("@/entities/mesh-radio", () => ({
  getMeshRadio: (...a: unknown[]) => mockGetMeshRadio(...a),
}));
vi.mock("@/lib/ctf-judge", () => ({
  judgeSolve: (...a: unknown[]) => mockJudgeSolve(...a),
}));
vi.mock("@/lib/rescore", () => ({
  rescoreBestEffort: (...a: unknown[]) => mockRescoreBestEffort(...a),
}));

import { POST } from "../route";
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
  mockGetMeshRadio.mockReset();
  mockJudgeSolve.mockReset();
  mockRescoreBestEffort.mockReset();
});

describe("POST /api/internal/ctf/unlock-award", () => {
  it("403s (never parses the body or touches data) without the secret", async () => {
    const { request, json } = makeReq(null, { ghost: "ghost.goldstein", node: "!aabbccdd" });
    const res = await POST(request);
    expect(res.status).toBe(403);
    expect(json).not.toHaveBeenCalled();
    expect(mockGetMeshRadio).not.toHaveBeenCalled();
    expect(mockJudgeSolve).not.toHaveBeenCalled();
  });

  it("403s on a wrong secret", async () => {
    const { request } = makeReq("nope", { ghost: "ghost.goldstein", node: "!aabbccdd" });
    expect((await POST(request)).status).toBe(403);
  });

  it("400s on a missing ghost", async () => {
    const { request } = makeReq("s3cret", { node: "!aabbccdd" });
    expect((await POST(request)).status).toBe(400);
    expect(mockGetMeshRadio).not.toHaveBeenCalled();
  });

  it("400s on a missing node", async () => {
    const { request } = makeReq("s3cret", { ghost: "ghost.goldstein" });
    expect((await POST(request)).status).toBe(400);
    expect(mockGetMeshRadio).not.toHaveBeenCalled();
  });

  it("422s for a ghost id with no trailing name segment", async () => {
    const { request } = makeReq("s3cret", { ghost: "ghost.", node: "!aabbccdd" });
    expect((await POST(request)).status).toBe(422);
    expect(mockGetMeshRadio).not.toHaveBeenCalled();
  });

  it("404s for an unknown/unowned radio", async () => {
    mockGetMeshRadio.mockResolvedValue(undefined);
    const { request } = makeReq("s3cret", { ghost: "ghost.goldstein", node: "!aabbccdd" });
    const res = await POST(request);
    expect(res.status).toBe(404);
    expect(mockGetMeshRadio).toHaveBeenCalledWith("!aabbccdd");
    expect(mockJudgeSolve).not.toHaveBeenCalled();
  });

  it("awards the unlock flag and rescopes on a solved grant", async () => {
    mockGetMeshRadio.mockResolvedValue({ nodeId: "!aabbccdd", userId: "user-1" });
    mockJudgeSolve.mockResolvedValue({ solved: true, points: 250, ordinal: 1, firstBlood: true, capped: false });
    const { request } = makeReq("s3cret", { ghost: "ghost.goldstein", node: "!AABBCCDD" });
    const res = await POST(request);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ solved: true, points: 250 });
    expect(mockJudgeSolve).toHaveBeenCalledWith(
      { user: "user-1", challenge: "unlock-goldstein", channel: "qr", grant: true },
      {},
    );
    expect(mockRescoreBestEffort).toHaveBeenCalledWith("user-1");
  });

  it("does not rescore on a non-solve (e.g. replayed unlock)", async () => {
    mockGetMeshRadio.mockResolvedValue({ nodeId: "!aabbccdd", userId: "user-1" });
    mockJudgeSolve.mockResolvedValue({ solved: false, points: 0, ordinal: null, firstBlood: false, capped: false });
    const { request } = makeReq("s3cret", { ghost: "ghost.goldstein", node: "!aabbccdd" });
    const res = await POST(request);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ solved: false, points: 0 });
    expect(mockRescoreBestEffort).not.toHaveBeenCalled();
  });

  it("normalizes a short/uncased node id to canonical pad-8 lowercase before lookup", async () => {
    mockGetMeshRadio.mockResolvedValue(undefined);
    const { request } = makeReq("s3cret", { ghost: "ghost.goldstein", node: "!ABCDEF" });
    await POST(request);
    expect(mockGetMeshRadio).toHaveBeenCalledWith("!00abcdef");
  });
});
