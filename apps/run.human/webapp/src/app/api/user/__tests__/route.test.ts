import { describe, it, expect, vi, beforeEach } from "vitest";

const mockAuth = vi.fn();
const mockUpdate = vi.fn();
const mockRequireQuota = vi.fn();

vi.mock("@auth", () => ({ auth: (...a: unknown[]) => mockAuth(...a) }));
vi.mock("@/entities/run-user", () => ({
  getRunUser: vi.fn(),
  updateRunUserProfile: (...a: unknown[]) => mockUpdate(...a),
}));
vi.mock("@/entities/bib", () => ({ getRunnerCode: vi.fn() }));
vi.mock("@/lib/pin-icons", () => ({
  pinIconById: vi.fn(),
  canUsePinIcon: vi.fn(() => true),
  isValidPinColor: vi.fn(() => true),
}));
vi.mock("@/lib/quota-client", () => ({
  getUserQuotas: vi.fn(),
  getQuotaDefinitions: vi.fn(),
  requireAndConsumeQuota: (...a: unknown[]) => mockRequireQuota(...a),
  isQuotaExceededError: () => false,
}));

import { PATCH } from "../route";
import type { NextRequest } from "next/server";

function patch(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

beforeEach(() => {
  mockAuth.mockReset();
  mockUpdate.mockReset();
  mockRequireQuota.mockReset();
  mockAuth.mockResolvedValue({ user: { id: "adapter-1" } });
  mockRequireQuota.mockResolvedValue(undefined);
  mockUpdate.mockResolvedValue(undefined);
});

describe("PATCH /api/user displayName", () => {
  it("stamps displayNameManual:true when the runner edits their name", async () => {
    const res = await PATCH(patch({ displayName: "KurtRuns" }));
    expect(res.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledWith("adapter-1", {
      displayName: "KurtRuns",
      displayNameManual: true,
    });
  });

  it("still enforces the 3-20 length rule (400, no write)", async () => {
    const res = await PATCH(patch({ displayName: "ab" }));
    expect(res.status).toBe(400);
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
