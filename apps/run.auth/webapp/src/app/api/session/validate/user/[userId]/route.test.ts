import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Route test for the internal session-validate endpoint (GET). Focus: the
 * additive `email` field consumed by the run.bib admin print-names CSV. run.auth
 * is the authoritative source of a bib owner's login email (AuthProfile.email),
 * keyed by the OIDC subject == run.bib ownerSub.
 *
 * `@/entities/auth-profile` is mocked so getAuthProfile resolves to a fixed
 * profile — no live DynamoDB. Mirrors the injected-fake style of
 * auth-profile.services.test.ts.
 */

const { getAuthProfileMock, getAuthProfileByEmailMock } = vi.hoisted(() => ({
  getAuthProfileMock: vi.fn(),
  getAuthProfileByEmailMock: vi.fn(),
}));

vi.mock("@/entities/auth-profile", () => ({
  getAuthProfile: getAuthProfileMock,
  getAuthProfileByEmail: getAuthProfileByEmailMock,
}));

import { GET } from "./route";

const SECRET = "test-internal-secret";

function call(userId: string) {
  const req = new Request(
    `http://auth.local/use1/api/session/validate/user/${userId}`,
    { headers: { "X-Internal-Secret": SECRET } }
  );
  // The handler only touches req.headers + req.url; a plain Request suffices.
  return GET(req as never, { params: Promise.resolve({ userId }) });
}

describe("GET /api/session/validate/user/[userId] — email field", () => {
  beforeEach(() => {
    process.env.AUTH_INTERNAL_SECRET = SECRET;
    getAuthProfileMock.mockReset();
    getAuthProfileByEmailMock.mockReset();
  });

  it("returns the profile email on the user object", async () => {
    getAuthProfileMock.mockResolvedValue({
      userId: "sub-1",
      services: ["auth", "run"],
      email: "runner@example.com",
    });
    const res = await call("sub-1");
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.valid).toBe(true);
    expect(json.user.email).toBe("runner@example.com");
  });

  it("returns email: null when the profile has no email", async () => {
    getAuthProfileMock.mockResolvedValue({
      userId: "sub-2",
      services: ["auth"],
    });
    const res = await call("sub-2");
    const json = await res.json();
    expect(json.user.email).toBeNull();
  });
});
