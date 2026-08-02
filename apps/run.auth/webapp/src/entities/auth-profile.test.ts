import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Regression test for the Strava null-location upsert failure.
 *
 * Strava's /athlete endpoint returns `city`, `state`, and `country` as `null`
 * when the athlete hasn't set a location (or hides it). The AuthProfile.strava
 * map declares those as non-nullable `string` attributes, so a `null` reaching
 * ElectroDB throws an ElectroValidationError and drops the ENTIRE upsert —
 * leaving the profile with no `strava` map, which is what run.human reads to
 * decide "Strava connected". The account link succeeds separately, so the user
 * looks linked in auth but disconnected in run.human.
 *
 * We mock ONLY the DynamoDB client. ElectroDB runs its attribute-type
 * validation synchronously inside `.go()` before dispatching to the client, so
 * the real validation path (the exact thing that throws in prod) still runs.
 */

// Capture every command ElectroDB dispatches so we can assert what got written.
const sent: any[] = [];
const send = vi.fn(async (command: any) => {
  sent.push(command);
  // `.get()` expects { Item }; a missing Item => new-profile path.
  // `.upsert()` (an Update under the hood) is happy with an empty result.
  return {};
});

vi.mock("./client", () => ({
  electroClient: { send: (command: any) => send(command) },
  ELECTRO_TABLE: "run-auth-electro-test",
}));

import {
  upsertAuthProfile,
  buildStravaLink,
  normalizePictureUrl,
} from "./auth-profile";

/**
 * Regression tests for the Strava "no profile photo" avatar sentinel.
 *
 * Strava returns the RELATIVE string "avatar/athlete/medium.png" in
 * profile_medium for athletes who never uploaded a photo. Passed through to an
 * RP it resolves against that app's own page and 404s — the reported
 * https://run.defcon.run/use1/avatar/athlete/medium.png. Because it is a
 * non-empty string it slips past every `?? fallback` downstream, so it has to
 * be rejected on SHAPE (not-an-absolute-URL), not on presence.
 */
describe("normalizePictureUrl", () => {
  it("drops Strava's relative no-photo sentinel", () => {
    expect(normalizePictureUrl("avatar/athlete/medium.png")).toBeUndefined();
    expect(normalizePictureUrl("avatar/athlete/large.png")).toBeUndefined();
  });

  it("keeps a real absolute avatar URL", () => {
    const url = "https://dgalywyr863hv.cloudfront.net/pictures/athletes/1.jpg";
    expect(normalizePictureUrl(url)).toBe(url);
  });

  it("drops stringified nullish values from `${...}` template literals", () => {
    expect(normalizePictureUrl("undefined")).toBeUndefined();
    expect(normalizePictureUrl("null")).toBeUndefined();
  });

  it("drops non-strings, empty and whitespace-only values", () => {
    expect(normalizePictureUrl(null)).toBeUndefined();
    expect(normalizePictureUrl(undefined)).toBeUndefined();
    expect(normalizePictureUrl(42)).toBeUndefined();
    expect(normalizePictureUrl("")).toBeUndefined();
    expect(normalizePictureUrl("   ")).toBeUndefined();
  });
});

describe("buildStravaLink avatar handling", () => {
  it("omits profileMedium entirely when Strava sends the sentinel", () => {
    const link = buildStravaLink({
      id: 12345678,
      username: "jesse",
      profile_medium: "avatar/athlete/medium.png",
    });
    expect(link.profileMedium).toBeUndefined();
    // The link itself must still be recorded — the avatar is best-effort only.
    expect(link.id).toBe(12345678);
  });

  it("still records a genuine Strava avatar", () => {
    const link = buildStravaLink({
      id: 1,
      profile_medium: "https://dgalywyr863hv.cloudfront.net/p/1-medium.jpg",
    });
    expect(link.profileMedium).toBe(
      "https://dgalywyr863hv.cloudfront.net/p/1-medium.jpg"
    );
  });
});

/** The Strava athlete payload for a user with no location set (Jesse's case). */
function nullLocationAthlete() {
  return {
    strava: {
      id: 12345678,
      username: "jesse",
      firstName: "Jesse",
      lastName: "Runner",
      profileMedium: "https://example.com/jesse.jpg",
      // Strava sends null (not undefined) for an unset location:
      city: null as unknown as string | undefined,
      state: null as unknown as string | undefined,
      country: null as unknown as string | undefined,
    },
    stravaProfile: { id: 12345678, city: null, state: null, country: null },
  };
}

/** Pull the strava map object out of the dispatched Update command. */
function persistedStrava(): Record<string, unknown> | undefined {
  const values = sent
    .map((c) => c?.input?.ExpressionAttributeValues)
    .filter(Boolean);
  for (const v of values) {
    const match = Object.values(v).find(
      (val: any) => val && typeof val === "object" && val.id === 12345678
    );
    if (match) return match as Record<string, unknown>;
  }
  return undefined;
}

describe("upsertAuthProfile — Strava with null location", () => {
  beforeEach(() => {
    sent.length = 0;
    send.mockClear();
  });

  it("persists the link instead of throwing when city/state/country are null", async () => {
    await expect(
      upsertAuthProfile("jesse-user-id", "strava", nullLocationAthlete())
    ).resolves.toBeUndefined();
  });

  it("keeps the athlete id but drops the null location fields", async () => {
    await upsertAuthProfile("jesse-user-id", "strava", nullLocationAthlete());

    const strava = persistedStrava();
    expect(strava).toBeDefined();
    expect(strava!.id).toBe(12345678);
    expect(strava!.firstName).toBe("Jesse");
    // The null fields must not reach ElectroDB at all.
    expect(strava).not.toHaveProperty("city");
    expect(strava).not.toHaveProperty("state");
    expect(strava).not.toHaveProperty("country");
  });
});

/**
 * buildStravaLink() — the minimum-link contract.
 *
 * The athlete `id` is the ONLY required field; it is what run.human reads
 * (strava.id → linked_providers claim → hasStrava). Every other field is
 * best-effort enrichment: kept only when it is a real non-empty string, so a
 * malformed/absent decorative field can never block recording the link.
 * Input keys are the raw snake_case Strava /athlete shape.
 */
describe("buildStravaLink — minimum-link contract", () => {
  it("keeps only the id when all optional fields are null (no-location athlete)", () => {
    const link = buildStravaLink({
      id: 12345678,
      username: null,
      firstname: null,
      lastname: null,
      profile_medium: null,
      city: null,
      state: null,
      country: null,
    });
    expect(link).toEqual({ id: 12345678 });
  });

  it("coerces a numeric-string id to a number", () => {
    expect(buildStravaLink({ id: "12345678" }).id).toBe(12345678);
  });

  it("drops non-string optional fields (e.g. city returned as a number/object)", () => {
    const link = buildStravaLink({
      id: 42,
      city: 90210 as unknown as string,
      state: {} as unknown as string,
      country: "US",
    });
    expect(link).toEqual({ id: 42, country: "US" });
  });

  it("drops empty-string optional fields", () => {
    const link = buildStravaLink({ id: 7, firstname: "", lastname: "Runner" });
    expect(link).toEqual({ id: 7, lastName: "Runner" });
  });

  it("maps snake_case enrichment to the entity shape", () => {
    const link = buildStravaLink({
      id: 9,
      username: "jesse",
      firstname: "Jesse",
      lastname: "Runner",
      profile_medium: "https://ex/j.jpg",
      city: "Vegas",
      state: "NV",
      country: "US",
    });
    expect(link).toEqual({
      id: 9,
      username: "jesse",
      firstName: "Jesse",
      lastName: "Runner",
      profileMedium: "https://ex/j.jpg",
      city: "Vegas",
      state: "NV",
      country: "US",
    });
  });

  it("throws when the id is missing or unusable — cannot link without it", () => {
    expect(() => buildStravaLink({ username: "noid" })).toThrow();
    expect(() => buildStravaLink({ id: "not-a-number" })).toThrow();
    expect(() => buildStravaLink({ id: null })).toThrow();
  });
});
