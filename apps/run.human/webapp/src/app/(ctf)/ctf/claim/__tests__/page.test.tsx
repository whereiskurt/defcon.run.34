import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Claim page `?nonce=` branches (ghost single-use magic links). Renders the
 * server component with mocked collaborators and asserts:
 *   (N1) signed-in + ?nonce → claimPending(nonce, session.user.id) exactly once,
 *        result card with clearNonce — and the nonce branch WINS over c/v params
 *        (judgeSolve untouched).
 *   (N2) anon + ?nonce → signin card carrying the nonce; nothing judged or
 *        parked server-side (ClaimClient parks the cookie client-side).
 */

const mockAuth = vi.fn();
const mockJudge = vi.fn();
const mockCreatePending = vi.fn();
const mockClaimPending = vi.fn();
const mockRescoreBestEffort = vi.fn();

vi.mock("@/config/auth", () => ({ auth: (...a: unknown[]) => mockAuth(...a) }));
vi.mock("@/lib/admin-gate", () => ({ isCtfAdmin: () => false }));
vi.mock("@/lib/qr-admin", () => ({
  normalizeChallenge: (s: string) => s.trim().toLowerCase(),
}));
vi.mock("@/lib/ctf-judge", () => ({
  judgeSolve: (...a: unknown[]) => mockJudge(...a),
}));
vi.mock("@/lib/ctf-pending", () => ({
  createPending: (...a: unknown[]) => mockCreatePending(...a),
  claimPending: (...a: unknown[]) => mockClaimPending(...a),
}));
vi.mock("@/lib/rescore", () => ({
  rescoreBestEffort: (...a: unknown[]) => mockRescoreBestEffort(...a),
}));
const mockCookieGet = vi.fn<() => { value: string } | undefined>(() => undefined);
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => mockCookieGet() }),
}));
// The page returns <ClaimClient …/> WITHOUT rendering it (server component
// return value), so assertions read the returned element's props directly.
vi.mock("../ClaimClient", () => ({ default: () => null }));

import ClaimPage from "../page";

const AWARD = { solved: true, points: 500, ordinal: 1, firstBlood: true, capped: false };

function params(p: Record<string, string>) {
  return { searchParams: Promise.resolve(p) };
}

beforeEach(() => {
  mockAuth.mockReset();
  mockJudge.mockReset();
  mockCreatePending.mockReset();
  mockClaimPending.mockReset();
  mockRescoreBestEffort.mockReset();
  mockCookieGet.mockReset();
  mockCookieGet.mockReturnValue(undefined);
});

describe("ClaimPage ?nonce branches", () => {
  it("signed-in + ?nonce → claimPending(nonce, player) once, result + clearNonce", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1" } });
    mockClaimPending.mockResolvedValue(AWARD);

    const el = await ClaimPage(params({ nonce: "n1" }));

    expect(mockClaimPending).toHaveBeenCalledTimes(1);
    expect(mockClaimPending).toHaveBeenCalledWith("n1", "user-1");
    expect(el.props).toMatchObject({ mode: "result", result: AWARD, clearNonce: true });
    expect(mockRescoreBestEffort).toHaveBeenCalledWith("user-1");
  });

  it("the nonce branch wins over c/v params (judgeSolve untouched)", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1" } });
    mockClaimPending.mockResolvedValue(AWARD);

    await ClaimPage(params({ nonce: "n1", c: "goldstein", v: "GUESS" }));

    expect(mockClaimPending).toHaveBeenCalledWith("n1", "user-1");
    expect(mockJudge).not.toHaveBeenCalled();
  });

  it("anon + ?nonce → signin card carrying the nonce; nothing claimed or parked", async () => {
    mockAuth.mockResolvedValue(null);

    const el = await ClaimPage(params({ nonce: "n2" }));

    expect(mockClaimPending).not.toHaveBeenCalled();
    expect(mockCreatePending).not.toHaveBeenCalled();
    expect(mockJudge).not.toHaveBeenCalled();
    expect(el.props).toMatchObject({ mode: "signin", nonce: "n2" });
    expect(mockRescoreBestEffort).not.toHaveBeenCalled();
  });
});

describe("ClaimPage rescore wiring on solved results", () => {
  it("(A) signed-in + c/v → judgeSolve solved:true fires rescoreBestEffort(player)", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-2" } });
    mockJudge.mockResolvedValue(AWARD);

    await ClaimPage(params({ c: "goldstein", v: "GUESS" }));

    expect(mockJudge).toHaveBeenCalledTimes(1);
    expect(mockRescoreBestEffort).toHaveBeenCalledWith("user-2");
  });

  it("(A) signed-in + c/v → a non-solve result does NOT fire rescoreBestEffort", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-2" } });
    mockJudge.mockResolvedValue({ solved: false, points: 0, ordinal: null, firstBlood: false, capped: false });

    await ClaimPage(params({ c: "goldstein", v: "WRONG" }));

    expect(mockJudge).toHaveBeenCalledTimes(1);
    expect(mockRescoreBestEffort).not.toHaveBeenCalled();
  });

  it("(B) signed-in return with a parked cookie nonce → solved claimPending fires rescoreBestEffort(player)", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-3" } });
    mockCookieGet.mockReturnValue({ value: "parked-nonce" });
    mockClaimPending.mockResolvedValue(AWARD);

    await ClaimPage(params({}));

    expect(mockClaimPending).toHaveBeenCalledWith("parked-nonce", "user-3");
    expect(mockRescoreBestEffort).toHaveBeenCalledWith("user-3");
  });
});
