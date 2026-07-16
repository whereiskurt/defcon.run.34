import { describe, it, expect, vi, beforeEach } from "vitest";

const mockAuth = vi.fn();
const mockRevalidateAdmin = vi.fn();
const mockUpdate = vi.fn();
const mockGetRunUser = vi.fn();

vi.mock("@/config/auth", () => ({
  auth: (...a: unknown[]) => mockAuth(...a),
  revalidateAdmin: (...a: unknown[]) => mockRevalidateAdmin(...a),
  revalidateGroups: vi.fn(),
}));
vi.mock("@/entities/run-user", () => ({
  getRunUser: (...a: unknown[]) => mockGetRunUser(...a),
  updateRunUserProfile: (...a: unknown[]) => mockUpdate(...a),
}));
// GET path deps — stub so importing the route never loads AWS.
vi.mock("@/entities/auth-user", () => ({
  getAuthUserEmail: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/lib/quota-client", () => ({
  getUserQuotas: vi.fn().mockRejectedValue(new Error("no quota")),
}));

import { PATCH } from "../route";

const ADMIN = { user: { services: ["admin"], authUserId: "sub-admin" } };

function patchReq(body: unknown) {
  return new Request("http://x/api/admin/users/u1", {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}
const ctx = { params: Promise.resolve({ userId: "u1" }) };

beforeEach(() => {
  mockAuth.mockReset();
  mockRevalidateAdmin.mockReset().mockResolvedValue(true);
  mockUpdate.mockReset().mockResolvedValue(undefined);
  mockGetRunUser.mockReset();
});

describe("PATCH /api/admin/users/[userId] — ringtone", () => {
  it("no session → bare 404, no write", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await PATCH(patchReq({ ringtone: "og:d=8,o=5,b=110:g" }), ctx);
    expect(res.status).toBe(404);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("not admin → bare 404, no write", async () => {
    mockAuth.mockResolvedValue({ user: { services: ["run"], authUserId: "s" } });
    const res = await PATCH(patchReq({ ringtone: "og:d=8,o=5,b=110:g" }), ctx);
    expect(res.status).toBe(404);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("stale admin (revalidate false) → bare 404, no write", async () => {
    mockAuth.mockResolvedValue(ADMIN);
    mockRevalidateAdmin.mockResolvedValue(false);
    const res = await PATCH(patchReq({ ringtone: "og:d=8,o=5,b=110:g" }), ctx);
    expect(res.status).toBe(404);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("invalid RTTTL → 400, no write", async () => {
    mockAuth.mockResolvedValue(ADMIN);
    const res = await PATCH(patchReq({ ringtone: "not a ringtone" }), ctx);
    expect(res.status).toBe(400);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("valid RTTTL → 200 and writes the trimmed value", async () => {
    mockAuth.mockResolvedValue(ADMIN);
    const res = await PATCH(patchReq({ ringtone: "  og:d=8,o=5,b=110:g  " }), ctx);
    expect(res.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledWith("u1", { ringtone: "og:d=8,o=5,b=110:g" });
  });

  it("null clears the field (persists empty string)", async () => {
    mockAuth.mockResolvedValue(ADMIN);
    const res = await PATCH(patchReq({ ringtone: null }), ctx);
    expect(res.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledWith("u1", { ringtone: "" });
  });
});
