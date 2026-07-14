import { describe, it, expect } from "vitest";
import {
  accomplishmentIdFor,
  findDuplicate,
  type AccomplishmentItem,
} from "./accomplishment";

/**
 * Unit tests for the two PURE helpers behind the Phase 49 Accomplishment entity
 * (LDBR-01 / LDBR-12). These prove the idempotency + dup-guard invariants the
 * write path relies on WITHOUT touching DynamoDB:
 *   - accomplishmentIdFor is a deterministic, collision-stable id so a re-create
 *     lands on the same sk (a cheap idempotency key),
 *   - findDuplicate matches on the RIGHT external-id metadata field per source
 *     (checkInId | gpxFileId | stravaActivityId), so a replayed create is a no-op.
 */

// Minimal AccomplishmentItem factory — only the fields the pure helpers read.
function acc(over: Partial<AccomplishmentItem>): AccomplishmentItem {
  return {
    userId: "u1",
    accomplishmentId: "checkin#ci-1",
    type: "activity",
    source: "checkin",
    name: "Check-in",
    completedAt: 1_700_000_000_000,
    year: 2026,
    metadata: {},
    ...over,
  } as AccomplishmentItem;
}

describe("accomplishmentIdFor", () => {
  it("is deterministic — same (source, externalId) yields an identical id", () => {
    const a = accomplishmentIdFor("checkin", "ci-abc");
    const b = accomplishmentIdFor("checkin", "ci-abc");
    expect(a).toBe(b);
  });

  it("differs when the externalId differs", () => {
    expect(accomplishmentIdFor("checkin", "ci-1")).not.toBe(
      accomplishmentIdFor("checkin", "ci-2")
    );
  });

  it("differs when the source differs (same externalId)", () => {
    expect(accomplishmentIdFor("checkin", "x-1")).not.toBe(
      accomplishmentIdFor("gpx", "x-1")
    );
  });

  it("embeds source and externalId so ids are namespaced per source", () => {
    expect(accomplishmentIdFor("strava", "12345")).toContain("strava");
    expect(accomplishmentIdFor("strava", "12345")).toContain("12345");
  });
});

describe("findDuplicate", () => {
  it("returns the checkin row whose metadata.checkInId matches", () => {
    const existing = [
      acc({ accomplishmentId: "checkin#ci-1", source: "checkin", metadata: { checkInId: "ci-1" } }),
      acc({ accomplishmentId: "checkin#ci-2", source: "checkin", metadata: { checkInId: "ci-2" } }),
    ];
    const hit = findDuplicate(existing, "checkin", "ci-2");
    expect(hit?.accomplishmentId).toBe("checkin#ci-2");
  });

  it("returns the gpx row whose metadata.gpxFileId matches", () => {
    const existing = [
      acc({ accomplishmentId: "gpx#g-1", source: "gpx", metadata: { gpxFileId: "g-1" } }),
    ];
    const hit = findDuplicate(existing, "gpx", "g-1");
    expect(hit?.accomplishmentId).toBe("gpx#g-1");
  });

  it("returns the strava row whose metadata.stravaActivityId matches", () => {
    const existing = [
      acc({ accomplishmentId: "strava#s-1", source: "strava", metadata: { stravaActivityId: "s-1" } }),
    ];
    const hit = findDuplicate(existing, "strava", "s-1");
    expect(hit?.accomplishmentId).toBe("strava#s-1");
  });

  it("returns undefined when no row matches the source + externalId", () => {
    const existing = [
      acc({ accomplishmentId: "checkin#ci-1", source: "checkin", metadata: { checkInId: "ci-1" } }),
    ];
    expect(findDuplicate(existing, "checkin", "ci-999")).toBeUndefined();
  });

  it("checks the RIGHT metadata field per source — a checkInId match does not satisfy a gpx query", () => {
    // A row carrying checkInId "shared" must NOT be treated as a gpx duplicate
    // for gpxFileId "shared": the dup-guard must key on the source's own field.
    const existing = [
      acc({ accomplishmentId: "checkin#shared", source: "checkin", metadata: { checkInId: "shared" } }),
    ];
    expect(findDuplicate(existing, "gpx", "shared")).toBeUndefined();
  });

  it("does not match a row of a different source even when its own external id equals the arg", () => {
    // gpx row with gpxFileId "dup" should not answer a checkin query for "dup".
    const existing = [
      acc({ accomplishmentId: "gpx#dup", source: "gpx", metadata: { gpxFileId: "dup" } }),
    ];
    expect(findDuplicate(existing, "checkin", "dup")).toBeUndefined();
  });
});
