import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { deriveFlagCode } from "@/lib/mesh-otp-derive";
import { hashAnswer } from "@/lib/ctf-hash";

/**
 * The secret-gated POST /api/internal/ctf/mint route (ghost single-use claim
 * links). Real deriveFlagCode/hashAnswer run so the answer-hash challenge
 * resolution is proven end-to-end; the ghost roster, Ctf list, and pending
 * store are mocked. Proves:
 *   (a) wrong/absent x-internal-secret → 403 before body parse or data access,
 *   (b) missing ghost id → 400,
 *   (c) unknown ghost / unset server secret / no hash-matching Ctf row → 422
 *       (the bot's fallback trigger),
 *   (d) happy path → createPending called with the ANSWER-HASH-matched
 *       challenge name, the derived code, and the SHORT ttl; response carries
 *       {nonce, url} with the nonce in the url.
 */

const mockGetGhost = vi.fn();
const mockListCtf = vi.fn();
const mockCreatePending = vi.fn();

vi.mock("@/config", () => ({
  config: {
    auth: { internalSecret: "s3cret" },
    isDev: false,
    siteDomain: "defcon.run",
    region: "use1",
  },
}));
vi.mock("@/lib/mesh-ghosts", () => ({
  getMeshGhost: (...a: unknown[]) => mockGetGhost(...a),
}));
vi.mock("@/lib/qr-admin", () => ({
  listCtf: (...a: unknown[]) => mockListCtf(...a),
}));
vi.mock("@/lib/ctf-pending", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ctf-pending")>();
  return {
    CLAIM_LINK_TTL_SECONDS: actual.CLAIM_LINK_TTL_SECONDS,
    createPending: (...a: unknown[]) => mockCreatePending(...a),
  };
});

import { POST } from "../route";
import { CLAIM_LINK_TTL_SECONDS } from "@/lib/ctf-pending";
import type { NextRequest } from "next/server";

const SERVER_SECRET = "test-server-secret";
const GHOST = { id: "ghost.goldstein", slug: "goldstein", flagCode: "hackers4evr" };
const DERIVED = deriveFlagCode(SERVER_SECRET, GHOST.id, GHOST.flagCode);

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
  mockGetGhost.mockReset();
  mockListCtf.mockReset();
  mockCreatePending.mockReset();
  vi.stubEnv("MESHTK_GHOST_KEY_SECRET", SERVER_SECRET);
  vi.stubEnv("RUN_PUBLIC_URL", "https://run.defcon.run/use1");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/internal/ctf/mint", () => {
  it("403s (never parses the body or touches data) without the secret", async () => {
    const { request, json } = makeReq(null, { ghost: GHOST.id });
    const res = await POST(request);
    expect(res.status).toBe(403);
    expect(json).not.toHaveBeenCalled();
    expect(mockListCtf).not.toHaveBeenCalled();
    expect(mockCreatePending).not.toHaveBeenCalled();
  });

  it("403s on a wrong secret", async () => {
    const { request } = makeReq("nope", { ghost: GHOST.id });
    expect((await POST(request)).status).toBe(403);
  });

  it("400s on a missing ghost id", async () => {
    const { request } = makeReq("s3cret", {});
    expect((await POST(request)).status).toBe(400);
    expect(mockCreatePending).not.toHaveBeenCalled();
  });

  it("422s for an unknown ghost (bot falls back)", async () => {
    mockGetGhost.mockReturnValue(undefined);
    const { request } = makeReq("s3cret", { ghost: "ghost.nobody" });
    expect((await POST(request)).status).toBe(422);
    expect(mockCreatePending).not.toHaveBeenCalled();
  });

  it("422s when the server secret is unset", async () => {
    vi.stubEnv("MESHTK_GHOST_KEY_SECRET", "");
    mockGetGhost.mockReturnValue(GHOST);
    const { request } = makeReq("s3cret", { ghost: GHOST.id });
    expect((await POST(request)).status).toBe(422);
  });

  it("422s when no Ctf row's answerHash matches the derived code", async () => {
    mockGetGhost.mockReturnValue(GHOST);
    mockListCtf.mockResolvedValue([
      { challenge: "unrelated", enabled: true, answerHash: hashAnswer("other") },
    ]);
    const { request } = makeReq("s3cret", { ghost: GHOST.id });
    expect((await POST(request)).status).toBe(422);
    expect(mockCreatePending).not.toHaveBeenCalled();
  });

  it("mints: hash-matched challenge, derived code, short ttl, nonce in url", async () => {
    mockGetGhost.mockReturnValue(GHOST);
    // Challenge name does NOT derive from the fleet id — only the hash links them.
    mockListCtf.mockResolvedValue([
      { challenge: "decoy", enabled: true, answerHash: hashAnswer("nope") },
      { challenge: "grace-hopper", enabled: true, answerHash: hashAnswer(DERIVED) },
    ]);
    mockCreatePending.mockResolvedValue({ nonce: "nonce-1" });

    const { request } = makeReq("s3cret", { ghost: GHOST.id });
    const res = await POST(request);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      nonce: "nonce-1",
      url: "https://run.defcon.run/use1/ctf/claim?nonce=nonce-1",
    });
    expect(mockCreatePending).toHaveBeenCalledTimes(1);
    expect(mockCreatePending).toHaveBeenCalledWith("grace-hopper", DERIVED, {
      ttlSeconds: CLAIM_LINK_TTL_SECONDS,
    });
  });

  it("prefers an enabled row over a disabled one with the same hash", async () => {
    mockGetGhost.mockReturnValue(GHOST);
    mockListCtf.mockResolvedValue([
      { challenge: "old-copy", enabled: false, answerHash: hashAnswer(DERIVED) },
      { challenge: "live-copy", enabled: true, answerHash: hashAnswer(DERIVED) },
    ]);
    mockCreatePending.mockResolvedValue({ nonce: "n" });
    const { request } = makeReq("s3cret", { ghost: GHOST.id });
    expect((await POST(request)).status).toBe(200);
    expect(mockCreatePending.mock.calls[0][0]).toBe("live-copy");
  });
});
