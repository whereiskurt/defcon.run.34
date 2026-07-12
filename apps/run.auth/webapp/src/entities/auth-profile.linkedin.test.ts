import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Unit tests for upsertAuthProfile's LinkedIn branch (Sign In with LinkedIn
 * using OpenID Connect).
 *
 * We spy on the ElectroDB AuthProfile entity's `get`/`upsert` so no live
 * DynamoDB is touched: `get().go()` resolves to a fixed existing-profile
 * fixture, and `upsert().go()` captures the payload the function built. The
 * assertions exercise the linkedin name/picture computation, the linkedin map
 * (with linkedAt), the raw-profile passthrough, and email verification.
 */

import { AuthProfile, upsertAuthProfile } from "./auth-profile";

function mockEntity(existingData: unknown) {
  vi.spyOn(AuthProfile, "get").mockReturnValue({
    go: async () => ({ data: existingData }),
  } as any);
  const upsertGo = vi.fn().mockResolvedValue({});
  const upsertSpy = vi
    .spyOn(AuthProfile, "upsert")
    .mockReturnValue({ go: upsertGo } as any);
  return upsertSpy;
}

describe("upsertAuthProfile — linkedin", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("builds a linkedin payload with name/picture, linkedAt, and email on a new profile", async () => {
    const upsertSpy = mockEntity(undefined); // new profile

    await upsertAuthProfile("user-1", "linkedin", {
      email: "runner@example.com",
      linkedin: {
        id: "sub-abc",
        name: "Ada Lovelace",
        givenName: "Ada",
        familyName: "Lovelace",
        picture: "https://media.licdn.com/pic.jpg",
        email: "runner@example.com",
      },
      linkedinProfile: { sub: "sub-abc", locale: "en_US" },
    });

    expect(upsertSpy).toHaveBeenCalledTimes(1);
    const payload = upsertSpy.mock.calls[0][0] as any;

    expect(payload.lastProvider).toBe("linkedin");
    expect(payload.name).toBe("Ada Lovelace");
    expect(payload.picture).toBe("https://media.licdn.com/pic.jpg");
    expect(payload.email).toBe("runner@example.com");
    expect(payload.emailVerified).toBe(true);
    expect(payload.linkedin).toMatchObject({
      id: "sub-abc",
      name: "Ada Lovelace",
      givenName: "Ada",
      familyName: "Lovelace",
      picture: "https://media.licdn.com/pic.jpg",
    });
    expect(typeof payload.linkedin.linkedAt).toBe("number");
    expect(payload.linkedinProfile).toEqual({ sub: "sub-abc", locale: "en_US" });
    // New profile → default services + generated displayName assigned
    expect(Array.isArray(payload.services)).toBe(true);
    expect(payload.displayName).toMatch(/^rabbit_/);
  });

  it("derives name from givenName/familyName when the top-level name is absent", async () => {
    const upsertSpy = mockEntity({ userId: "user-2" }); // existing profile

    await upsertAuthProfile("user-2", "linkedin", {
      linkedin: {
        id: "sub-xyz",
        givenName: "Grace",
        familyName: "Hopper",
      },
    });

    const payload = upsertSpy.mock.calls[0][0] as any;
    expect(payload.name).toBe("Grace Hopper");
    // Existing profile → no new displayName/services injected
    expect(payload.displayName).toBeUndefined();
    expect(payload.services).toBeUndefined();
  });
});
