import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * ensureRunHumanIdentity reuses the Auth.js adapter (createUser + linkAccount) so
 * a provisioned account is byte-identical to a real sign-in's — a later SSO login
 * links to it instead of duplicating. These tests pin that contract: existing
 * accounts are never re-created, missing ones are linked with the run.defcon.run
 * provider + the OIDC sub, and the RunUser is always ensured.
 */

const { createUserMock, linkAccountMock, getAdapterUserIdBySubMock, upsertRunUserMock } =
  vi.hoisted(() => ({
    createUserMock: vi.fn(),
    linkAccountMock: vi.fn(),
    getAdapterUserIdBySubMock: vi.fn(),
    upsertRunUserMock: vi.fn(),
  }));

vi.mock("@/entities/client", () => ({
  dynamodbAdapter: { createUser: createUserMock, linkAccount: linkAccountMock },
}));
vi.mock("@/entities/auth-user", () => ({
  getAdapterUserIdBySub: getAdapterUserIdBySubMock,
}));
vi.mock("@/entities/run-user", () => ({
  upsertRunUser: upsertRunUserMock,
}));

import { ensureRunHumanIdentity } from "@/lib/ensure-identity";

describe("ensureRunHumanIdentity()", () => {
  beforeEach(() => {
    createUserMock.mockReset();
    linkAccountMock.mockReset();
    getAdapterUserIdBySubMock.mockReset();
    upsertRunUserMock.mockReset();
    upsertRunUserMock.mockResolvedValue({ userId: "x", hash: "H" });
  });

  it("does NOT create/link when the account already exists, but ensures the RunUser", async () => {
    getAdapterUserIdBySubMock.mockResolvedValue("uid-existing");
    const res = await ensureRunHumanIdentity("sub-1", "a@x.com", "Ada");
    expect(res).toEqual({ userId: "uid-existing", created: false });
    expect(createUserMock).not.toHaveBeenCalled();
    expect(linkAccountMock).not.toHaveBeenCalled();
    expect(upsertRunUserMock).toHaveBeenCalledWith("uid-existing");
  });

  it("creates the adapter user, links the run.defcon.run account by sub, ensures RunUser", async () => {
    getAdapterUserIdBySubMock.mockResolvedValue(null);
    createUserMock.mockImplementation(async (u) => ({ ...u, id: u.id || "gen" }));
    const res = await ensureRunHumanIdentity("sub-new", "b@x.com", "Bob");

    expect(res.created).toBe(true);
    // created with the email + name (name seeds the profile, not a bare rabbit_XXXX)
    const created = createUserMock.mock.calls[0][0];
    expect(created.email).toBe("b@x.com");
    expect(created.name).toBe("Bob");
    expect(typeof created.id).toBe("string");
    // linked with the EXACT provider getAdapterUserIdBySub + real sign-in key off
    const linked = linkAccountMock.mock.calls[0][0];
    expect(linked).toMatchObject({
      userId: res.userId,
      type: "oidc",
      provider: "run.defcon.run",
      providerAccountId: "sub-new",
    });
    expect(upsertRunUserMock).toHaveBeenCalledWith(res.userId);
  });

  it("passes a null name through to createUser when none is given", async () => {
    getAdapterUserIdBySubMock.mockResolvedValue(null);
    createUserMock.mockImplementation(async (u) => ({ ...u, id: "gen" }));
    await ensureRunHumanIdentity("sub-x", "c@x.com");
    expect(createUserMock.mock.calls[0][0].name).toBeNull();
  });
});
