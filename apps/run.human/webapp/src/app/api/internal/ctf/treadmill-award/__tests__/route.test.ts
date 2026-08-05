import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The secret-gated POST /api/internal/ctf/treadmill-award route (ELKENTARO 2000
 * flag, 2026-08-05). Called by run.gpx when it imports an INDOOR activity
 * recorded Aug 3–10; grants the `treadmill` flag via judgeSolve's server-caller
 * `grant` path. Proves:
 *   (a) wrong/absent x-internal-secret → 403 before body parse or data access,
 *   (b) missing oidcSub → 400,
 *   (c) unresolvable oidcSub → 404, judgeSolve never called,
 *   (d) happy path → judgeSolve called with the HARD-CODED "treadmill"
 *       challenge and grant: true; rescoreBestEffort fires only when solved,
 *   (e) the challenge cannot be influenced by the request body.
 */

const mockGetAdapterUserIdBySub = vi.fn();
const mockJudgeSolve = vi.fn();
const mockRescoreBestEffort = vi.fn();

vi.mock("@/config", () => ({
  config: { auth: { internalSecret: "s3cret" } },
}));
vi.mock("@/entities/auth-user", () => ({
  getAdapterUserIdBySub: (...a: unknown[]) => mockGetAdapterUserIdBySub(...a),
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
  vi.clearAllMocks();
  mockGetAdapterUserIdBySub.mockResolvedValue("adapter-user-1");
  mockJudgeSolve.mockResolvedValue({ solved: true, points: 250 });
});

describe("POST /api/internal/ctf/treadmill-award", () => {
  it("403s a wrong secret without reading the body", async () => {
    const { request, json } = makeReq("nope", { oidcSub: "sub-1" });
    const res = await POST(request);
    expect(res.status).toBe(403);
    expect(json).not.toHaveBeenCalled();
    expect(mockGetAdapterUserIdBySub).not.toHaveBeenCalled();
    expect(mockJudgeSolve).not.toHaveBeenCalled();
  });

  it("403s a missing secret", async () => {
    const { request } = makeReq(null, { oidcSub: "sub-1" });
    expect((await POST(request)).status).toBe(403);
  });

  it("400s without an oidcSub", async () => {
    const { request } = makeReq("s3cret", {});
    const res = await POST(request);
    expect(res.status).toBe(400);
    expect(mockJudgeSolve).not.toHaveBeenCalled();
  });

  it("400s on an unparsable body", async () => {
    const request = {
      headers: { get: () => "s3cret" },
      json: vi.fn(async () => {
        throw new Error("bad json");
      }),
    } as unknown as NextRequest;
    expect((await POST(request)).status).toBe(400);
  });

  it("404s when the OIDC sub resolves to nobody, and awards nothing", async () => {
    // A wrong-namespace id must fail loudly here rather than silently
    // awarding a phantom user.
    mockGetAdapterUserIdBySub.mockResolvedValue(null);
    const { request } = makeReq("s3cret", { oidcSub: "sub-unknown" });
    const res = await POST(request);
    expect(res.status).toBe(404);
    expect(mockJudgeSolve).not.toHaveBeenCalled();
    expect(mockRescoreBestEffort).not.toHaveBeenCalled();
  });

  it("grants the treadmill flag for the RESOLVED adapter id", async () => {
    const { request } = makeReq("s3cret", { oidcSub: "sub-1" });
    const res = await POST(request);
    expect(res.status).toBe(200);
    expect(mockGetAdapterUserIdBySub).toHaveBeenCalledWith("sub-1");
    expect(mockJudgeSolve).toHaveBeenCalledWith(
      {
        user: "adapter-user-1",
        challenge: "treadmill",
        channel: "qr",
        grant: true,
        actorIsAdmin: false,
      },
      {},
    );
    expect(mockRescoreBestEffort).toHaveBeenCalledWith("adapter-user-1");
    expect(await res.json()).toEqual({ solved: true, points: 250 });
  });

  it("does NOT rescore when the judge withheld the solve", async () => {
    // e.g. the Ctf row is missing or disabled — the import is unaffected.
    mockJudgeSolve.mockResolvedValue({ solved: false, points: 0 });
    const { request } = makeReq("s3cret", { oidcSub: "sub-1" });
    const res = await POST(request);
    expect(res.status).toBe(200);
    expect(mockRescoreBestEffort).not.toHaveBeenCalled();
    expect(await res.json()).toEqual({ solved: false, points: 0 });
  });

  it("ignores a caller-supplied challenge — the flag name is not injectable", async () => {
    const { request } = makeReq("s3cret", {
      oidcSub: "sub-1",
      challenge: "didhtp1",
    });
    await POST(request);
    expect(mockJudgeSolve).toHaveBeenCalledWith(
      expect.objectContaining({ challenge: "treadmill" }),
      {},
    );
  });

  it("forwards isAdmin so an operator's test import cannot take the player's first blood", async () => {
    const { request } = makeReq("s3cret", { oidcSub: "sub-1", isAdmin: true });
    await POST(request);
    expect(mockJudgeSolve).toHaveBeenCalledWith(
      expect.objectContaining({ actorIsAdmin: true }),
      {},
    );
  });

  it("treats a non-boolean isAdmin as false rather than truthy", async () => {
    const { request } = makeReq("s3cret", { oidcSub: "sub-1", isAdmin: "yes" });
    await POST(request);
    expect(mockJudgeSolve).toHaveBeenCalledWith(
      expect.objectContaining({ actorIsAdmin: false }),
      {},
    );
  });

  it("trims a padded oidcSub", async () => {
    const { request } = makeReq("s3cret", { oidcSub: "  sub-1  " });
    await POST(request);
    expect(mockGetAdapterUserIdBySub).toHaveBeenCalledWith("sub-1");
  });
});
