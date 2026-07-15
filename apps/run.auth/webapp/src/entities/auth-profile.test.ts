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

import { upsertAuthProfile } from "./auth-profile";

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
