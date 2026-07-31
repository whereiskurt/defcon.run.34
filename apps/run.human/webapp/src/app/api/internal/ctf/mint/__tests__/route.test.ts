import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { deriveFlagCode } from "@/lib/mesh-otp-derive";
import { hashAnswer } from "@/lib/ctf-hash";

/**
 * The secret-gated POST /api/internal/ctf/mint route (single-use award links).
 * Real deriveFlagCode/hashAnswer/newAwardNonce run so the answer-hash challenge
 * resolution and the nonce shape are proven end-to-end; the ghost roster, Ctf
 * reads, and pending store are mocked. Proves:
 *   (a) wrong/absent x-internal-secret → 403 before body parse or data access,
 *   (b) neither {ghost} nor {challenge} → 400,
 *   (c) unknown ghost / unset server secret / no resolvable Ctf row → 422
 *       (the bot's fallback trigger),
 *   (d) {challenge} → a single getCtf GETITEM, ZERO scans (T-72-10), and a park
 *       of the row's OWN answerHash so no raw flag code exists anywhere,
 *   (e) {ghost} with an explicit challenge on the blob → also a GetItem, no scan,
 *   (f) {ghost} WITHOUT one → the listCtf answerHash-match fallback still
 *       resolves a non-derivable name ("grace-hopper" ← "ghost.hopper"),
 *   (g) the award URL is https://q.defcon.run/a/<12 Crockford chars>.
 */

const mockGetGhost = vi.fn();
const mockListCtf = vi.fn();
const mockGetCtf = vi.fn();
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
  getCtf: (...a: unknown[]) => mockGetCtf(...a),
}));
vi.mock("@/lib/ctf-pending", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ctf-pending")>();
  return {
    CLAIM_LINK_TTL_SECONDS: actual.CLAIM_LINK_TTL_SECONDS,
    AWARD_LINK_TTL_SECONDS: actual.AWARD_LINK_TTL_SECONDS,
    newAwardNonce: actual.newAwardNonce,
    createPending: (...a: unknown[]) => mockCreatePending(...a),
  };
});

import { POST } from "../route";
import { AWARD_LINK_TTL_SECONDS } from "@/lib/ctf-pending";
import type { NextRequest } from "next/server";

const SERVER_SECRET = "test-server-secret";
const GHOST = { id: "ghost.goldstein", slug: "goldstein", flagCode: "hackers4evr" };
const DERIVED = deriveFlagCode(SERVER_SECRET, GHOST.id, GHOST.flagCode);

/** https://q.defcon.run/a/<12 Crockford base32 lowercase chars> */
const AWARD_URL_RE = /^https:\/\/q\.defcon\.run\/a\/[0-9a-hjkmnp-tv-z]{12}$/;

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

/** Park stub that mints through the route's injected generator, as prod does. */
function pendingMintsRealNonce() {
  mockCreatePending.mockImplementation(
    async (_c: string, _g: string, deps: { newNonce?: () => string }) => ({
      nonce: deps.newNonce ? deps.newNonce() : "fallback",
    }),
  );
}

beforeEach(() => {
  mockGetGhost.mockReset();
  mockListCtf.mockReset();
  mockGetCtf.mockReset();
  mockCreatePending.mockReset();
  vi.stubEnv("MESHTK_GHOST_KEY_SECRET", SERVER_SECRET);
  vi.stubEnv("RUN_PUBLIC_URL", "https://run.defcon.run/use1");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/internal/ctf/mint — gate + request shape", () => {
  it("403s (never parses the body or touches data) without the secret", async () => {
    const { request, json } = makeReq(null, { ghost: GHOST.id });
    const res = await POST(request);
    expect(res.status).toBe(403);
    expect(json).not.toHaveBeenCalled();
    expect(mockListCtf).not.toHaveBeenCalled();
    expect(mockGetCtf).not.toHaveBeenCalled();
    expect(mockCreatePending).not.toHaveBeenCalled();
  });

  it("403s on a wrong secret", async () => {
    const { request } = makeReq("nope", { ghost: GHOST.id });
    expect((await POST(request)).status).toBe(403);
  });

  it("400s when neither ghost nor challenge is present", async () => {
    const { request } = makeReq("s3cret", {});
    expect((await POST(request)).status).toBe(400);
    expect(mockCreatePending).not.toHaveBeenCalled();
  });

  it("400s on an unparseable body", async () => {
    const request = {
      headers: { get: (k: string) => (k === "x-internal-secret" ? "s3cret" : null) },
      json: vi.fn(async () => {
        throw new Error("bad json");
      }),
    } as unknown as NextRequest;
    expect((await POST(request)).status).toBe(400);
  });
});

describe("POST /api/internal/ctf/mint — {challenge} (GetItem, zero scans)", () => {
  it("mints from a challenge name: one GetItem, NO scan, parks the row's own answerHash", async () => {
    mockGetCtf.mockResolvedValue({
      challenge: "ricky",
      enabled: true,
      answerType: "static",
      answerHash: hashAnswer("never-gonna-give-you-up"),
    });
    pendingMintsRealNonce();

    const { request } = makeReq("s3cret", { challenge: "ricky" });
    const res = await POST(request);

    expect(res.status).toBe(200);
    // T-72-10: the per-reveal full-table scan is gone on this path.
    expect(mockListCtf).not.toHaveBeenCalled();
    expect(mockGetCtf).toHaveBeenCalledTimes(1);
    expect(mockGetCtf).toHaveBeenCalledWith("ricky");

    const body = await res.json();
    expect(body.url).toMatch(AWARD_URL_RE);
    expect(body.url).toBe(`https://q.defcon.run/a/${body.nonce}`);
    expect(body.nonce).toHaveLength(12);

    expect(mockCreatePending).toHaveBeenCalledTimes(1);
    const [challengeArg, guessArg, deps] = mockCreatePending.mock.calls[0];
    expect(challengeArg).toBe("ricky");
    // No raw flag code exists on this path — the guess argument is empty and the
    // row's own answerHash is parked verbatim.
    expect(guessArg).toBe("");
    expect(deps.flagHash).toBe(hashAnswer("never-gonna-give-you-up"));
    expect(deps.ttlSeconds).toBe(3600);
    expect(deps.ttlSeconds).toBe(AWARD_LINK_TTL_SECONDS);
  });

  it("sends the Cache-Control: private, no-store header", async () => {
    mockGetCtf.mockResolvedValue({
      challenge: "ricky",
      enabled: true,
      answerHash: hashAnswer("x"),
    });
    pendingMintsRealNonce();
    const { request } = makeReq("s3cret", { challenge: "ricky" });
    const res = await POST(request);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("422s when the challenge resolves to nothing (bot falls back)", async () => {
    mockGetCtf.mockResolvedValue(null);
    const { request } = makeReq("s3cret", { challenge: "nope" });
    expect((await POST(request)).status).toBe(422);
    expect(mockCreatePending).not.toHaveBeenCalled();
    expect(mockListCtf).not.toHaveBeenCalled();
  });

  it("422s when the row exists but is disabled", async () => {
    mockGetCtf.mockResolvedValue({
      challenge: "ricky",
      enabled: false,
      answerHash: hashAnswer("x"),
    });
    const { request } = makeReq("s3cret", { challenge: "ricky" });
    expect((await POST(request)).status).toBe(422);
    expect(mockCreatePending).not.toHaveBeenCalled();
  });

  it("422s when the row carries no answerHash (never parks an unwinnable nonce)", async () => {
    mockGetCtf.mockResolvedValue({ challenge: "ricky", enabled: true, answerType: "otp" });
    const { request } = makeReq("s3cret", { challenge: "ricky" });
    expect((await POST(request)).status).toBe(422);
    expect(mockCreatePending).not.toHaveBeenCalled();
  });

  it("challenge wins over ghost when both are sent, and no scan runs", async () => {
    mockGetGhost.mockReturnValue(GHOST);
    mockGetCtf.mockResolvedValue({
      challenge: "ricky",
      enabled: true,
      answerHash: hashAnswer("x"),
    });
    pendingMintsRealNonce();

    const { request } = makeReq("s3cret", { ghost: GHOST.id, challenge: "ricky" });
    expect((await POST(request)).status).toBe(200);
    expect(mockListCtf).not.toHaveBeenCalled();
    expect(mockGetCtf).toHaveBeenCalledTimes(1);
    expect(mockCreatePending.mock.calls[0][0]).toBe("ricky");
  });
});

describe("POST /api/internal/ctf/mint — {ghost}", () => {
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

  it("mints: hash-matched challenge, derived code, award ttl, nonce in url", async () => {
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
      url: "https://q.defcon.run/a/nonce-1",
    });
    expect(mockCreatePending).toHaveBeenCalledTimes(1);
    expect(mockCreatePending).toHaveBeenCalledWith("grace-hopper", DERIVED, {
      ttlSeconds: AWARD_LINK_TTL_SECONDS,
      newNonce: expect.any(Function),
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

  it("an explicit challenge on the blob skips the scan entirely (GetItem only)", async () => {
    mockGetGhost.mockReturnValue({ ...GHOST, challenge: "goldstein" });
    mockGetCtf.mockResolvedValue({
      challenge: "goldstein",
      enabled: true,
      answerHash: hashAnswer(DERIVED),
    });
    pendingMintsRealNonce();

    const { request } = makeReq("s3cret", { ghost: GHOST.id });
    const res = await POST(request);

    expect(res.status).toBe(200);
    expect(mockListCtf).not.toHaveBeenCalled();
    expect(mockGetCtf).toHaveBeenCalledTimes(1);
    expect(mockGetCtf).toHaveBeenCalledWith("goldstein");
    const [challengeArg, guessArg, deps] = mockCreatePending.mock.calls[0];
    expect(challengeArg).toBe("goldstein");
    expect(guessArg).toBe("");
    expect(deps.flagHash).toBe(hashAnswer(DERIVED));
    expect(deps.ttlSeconds).toBe(3600);
    expect((await res.json()).url).toMatch(AWARD_URL_RE);
  });

  it("an explicit challenge that resolves to nothing 422s without falling back to a scan", async () => {
    mockGetGhost.mockReturnValue({ ...GHOST, challenge: "typo" });
    mockGetCtf.mockResolvedValue(null);
    const { request } = makeReq("s3cret", { ghost: GHOST.id });
    expect((await POST(request)).status).toBe(422);
    expect(mockListCtf).not.toHaveBeenCalled();
    expect(mockCreatePending).not.toHaveBeenCalled();
  });
});

describe("POST /api/internal/ctf/mint — dev URL shape", () => {
  it("keeps the direct claim-page URL in dev (no q resolver runs locally)", async () => {
    vi.resetModules();
    vi.doMock("@/config", () => ({
      config: {
        auth: { internalSecret: "s3cret" },
        isDev: true,
        siteDomain: "defcon.run",
        region: "use1",
      },
    }));
    vi.stubEnv("RUN_PUBLIC_URL", "http://localhost:3001");
    mockGetCtf.mockResolvedValue({
      challenge: "ricky",
      enabled: true,
      answerHash: hashAnswer("x"),
    });
    pendingMintsRealNonce();

    const { POST: devPost } = await import("../route");
    const { request } = makeReq("s3cret", { challenge: "ricky" });
    const body = await (await devPost(request)).json();

    expect(body.url).toBe(`http://localhost:3001/ctf/claim?nonce=${body.nonce}`);
    vi.doUnmock("@/config");
    vi.resetModules();
  });
});
