import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the heavy entity deps so importing admin-identity doesn't pull in the AWS
// SDK / oidc-provider config. Hoisted so the mock factories can see the spies.
const { queryGo, deleteGo, deleteSpy } = vi.hoisted(() => {
  const queryGo = vi.fn();
  const deleteGo = vi.fn();
  const deleteSpy = vi.fn(() => ({ go: deleteGo }));
  return { queryGo, deleteGo, deleteSpy };
});
vi.mock("./oidc-adapter", () => ({
  OIDCModel: {
    query: { primary: () => ({ go: queryGo }) },
    delete: deleteSpy,
  },
}));
vi.mock("./client", () => ({ dynamodbClient: {}, DYNAMODB_TABLE: "t" }));
vi.mock("./auth-profile", () => ({ AuthProfile: {} }));

import { groupAccountsByUser, revokeOidcSessions } from "./admin-identity";

describe("groupAccountsByUser", () => {
  it("groups ACCOUNT rows by userId and drops non-account items", () => {
    const items = [
      { pk: "USER#u1", sk: "ACCOUNT#github#g1", userId: "u1", provider: "github", providerAccountId: "g1" },
      { pk: "USER#u1", sk: "ACCOUNT#linkedin#l1", userId: "u1", provider: "linkedin", providerAccountId: "l1" },
      { pk: "USER#u2", sk: "USER#u2", userId: "u2" }, // not an account row
    ];
    const grouped = groupAccountsByUser(items);
    expect(grouped.u1.map((a) => a.provider).sort()).toEqual(["github", "linkedin"]);
    expect(grouped.u2).toBeUndefined();
  });
});

describe("revokeOidcSessions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("deletes only the Session rows whose payload.accountId matches, and returns the count", async () => {
    queryGo.mockResolvedValue({ data: [
      { id: "s1", payload: { accountId: "sub-A" }, expiresAt: 111 },
      { id: "s2", payload: { accountId: "sub-B" }, expiresAt: 222 }, // other user
      { id: "s3", payload: { accountId: "sub-A" } },
      { id: "s4", payload: {} },                                     // no accountId
    ]});
    deleteGo.mockResolvedValue({});

    const n = await revokeOidcSessions("sub-A");

    expect(n).toBe(2);
    expect(deleteSpy).toHaveBeenCalledWith({ modelName: "Session", id: "s1" });
    expect(deleteSpy).toHaveBeenCalledWith({ modelName: "Session", id: "s3" });
    expect(deleteSpy).not.toHaveBeenCalledWith({ modelName: "Session", id: "s2" });
    expect(deleteSpy).not.toHaveBeenCalledWith({ modelName: "Session", id: "s4" });
  });

  it("is best-effort: a single row delete failure is skipped, the rest still delete", async () => {
    queryGo.mockResolvedValue({ data: [
      { id: "s1", payload: { accountId: "sub-A" } },
      { id: "s2", payload: { accountId: "sub-A" } },
    ]});
    deleteGo.mockRejectedValueOnce(new Error("boom")).mockResolvedValue({});

    const n = await revokeOidcSessions("sub-A");

    expect(n).toBe(1); // s1 failed, s2 succeeded
    expect(deleteSpy).toHaveBeenCalledTimes(2);
  });

  it("returns 0 and deletes nothing when the identity has no sessions", async () => {
    queryGo.mockResolvedValue({ data: [{ id: "s2", payload: { accountId: "sub-B" } }] });

    const n = await revokeOidcSessions("sub-A");

    expect(n).toBe(0);
    expect(deleteSpy).not.toHaveBeenCalled();
  });
});
