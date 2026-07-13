import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Wiring test for PATCH /api/bib -> rabbit-name sync (M-4 from review).
 *
 * Confirms the sync fires on a name save with the saved name, does NOT fire on
 * the burn-only or pledge-only branches, and that a failed sync still returns a
 * 200 (fail-open). The sync's own normalize/fetch behavior is covered by
 * rabbit-name-sync.test.ts — here we only pin the route wiring.
 */

const mockAuth = vi.fn();
const mockGetBib = vi.fn();
const mockIsBibNameChange = vi.fn();
const mockUpdateBibName = vi.fn();
const mockUpdateWillPay = vi.fn();
const mockUpdateBurned = vi.fn();
const mockConsumeQuota = vi.fn();
const mockVerifyAltcha = vi.fn();
const mockMaybeSync = vi.fn();

vi.mock("@/config/auth", () => ({
  auth: (...a: unknown[]) => mockAuth(...a),
  // The PATCH live-lockout guard lazily imports fetchFreshClaims; null → fail-open.
  fetchFreshClaims: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/entities/bib", () => ({
  createBib: vi.fn(),
  getBib: (...a: unknown[]) => mockGetBib(...a),
  isBibNameChange: (...a: unknown[]) => mockIsBibNameChange(...a),
  NameLockedError: class NameLockedError extends Error {},
  updateBibName: (...a: unknown[]) => mockUpdateBibName(...a),
  updateBibWillPayInPerson: (...a: unknown[]) => mockUpdateWillPay(...a),
  updateBibBurned: (...a: unknown[]) => mockUpdateBurned(...a),
}));
vi.mock("@/lib/quota-client", () => ({
  consumeQuota: (...a: unknown[]) => mockConsumeQuota(...a),
}));
vi.mock("@/lib/runner-code", () => ({ generateUniqueRunnerCode: vi.fn() }));
vi.mock("@/lib/altcha", () => ({
  verifyBibSolution: (...a: unknown[]) => mockVerifyAltcha(...a),
}));
vi.mock("@/lib/rabbit-name-sync", () => ({
  maybeSyncRabbitName: (...a: unknown[]) => mockMaybeSync(...a),
}));

import { PATCH } from "../app/api/bib/route";
import type { NextRequest } from "next/server";

function patch(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ user: { id: "sub-1", services: [] } });
  mockVerifyAltcha.mockResolvedValue(true);
  mockIsBibNameChange.mockResolvedValue(false); // skip the quota branch
  mockUpdateBibName.mockResolvedValue({ nameOnBib: "OGRE" });
  mockUpdateWillPay.mockResolvedValue({});
  mockUpdateBurned.mockResolvedValue({});
  mockConsumeQuota.mockResolvedValue({ success: true, remaining: 5 });
  mockMaybeSync.mockResolvedValue("synced");
});

describe("PATCH /api/bib rabbit-name sync wiring", () => {
  it("fires the sync with the saved name after a name save", async () => {
    const res = await PATCH(patch({ nameOnBib: "OGRE", altcha: "solve" }));
    expect(res.status).toBe(200);
    expect(mockUpdateBibName).toHaveBeenCalledWith("sub-1", "OGRE");
    expect(mockMaybeSync).toHaveBeenCalledWith("sub-1", "OGRE");
  });

  it("does NOT fire the sync on a burn-only patch", async () => {
    const res = await PATCH(patch({ burned: true }));
    expect(res.status).toBe(200);
    expect(mockUpdateBurned).toHaveBeenCalled();
    expect(mockMaybeSync).not.toHaveBeenCalled();
  });

  it("does NOT fire the sync on a pledge-only patch", async () => {
    const res = await PATCH(patch({ willPayInPerson: true }));
    expect(res.status).toBe(200);
    expect(mockUpdateWillPay).toHaveBeenCalled();
    expect(mockMaybeSync).not.toHaveBeenCalled();
  });

  it("still returns 200 when the sync reports failure (fail-open)", async () => {
    mockMaybeSync.mockResolvedValue("failed");
    const res = await PATCH(patch({ nameOnBib: "OGRE", altcha: "solve" }));
    expect(res.status).toBe(200);
    expect(mockMaybeSync).toHaveBeenCalledWith("sub-1", "OGRE");
  });
});
