import { describe, it, expect } from "vitest";
import { buildCheckinAccomplishmentInput } from "./checkin";
import { accomplishmentIdFor } from "./accomplishment";
import { POINTS } from "../lib/leaderboard-scoring";

/**
 * LDBR-04: the check-in → accomplishment wiring is idempotent and privacy-faithful.
 *
 * These tests exercise the PURE seam (`buildCheckinAccomplishmentInput` +
 * `accomplishmentIdFor`) so no live DynamoDB is needed — they prove the two
 * facts the runtime side effects depend on:
 *   1. the input a check-in produces (source/type/points/isPrivate/checkInId), and
 *   2. that create and delete resolve to the SAME deterministic accomplishment id
 *      for a given checkInId (so a replay collides → no double-score, T-49-08).
 */
describe("buildCheckinAccomplishmentInput", () => {
  const seed = {
    userId: "user-uuid-1",
    source: "Web GPS",
    timestamp: 1_700_000_000_000,
    isPrivate: true,
    checkInId: "checkin-abc",
  };

  it("produces an activity/checkin accomplishment carrying points + checkInId", () => {
    const input = buildCheckinAccomplishmentInput(seed);
    expect(input.source).toBe("checkin");
    expect(input.type).toBe("activity");
    expect(input.points).toBe(POINTS.checkin);
    expect(input.completedAt).toBe(seed.timestamp);
    expect(input.checkInId).toBe("checkin-abc");
    expect(input.userId).toBe("user-uuid-1");
    expect(input.name).toContain("Web GPS");
  });

  it("carries isPrivate:true verbatim (not defaulted)", () => {
    expect(buildCheckinAccomplishmentInput({ ...seed, isPrivate: true }).isPrivate).toBe(true);
  });

  it("carries isPrivate:false verbatim (not defaulted to true)", () => {
    expect(buildCheckinAccomplishmentInput({ ...seed, isPrivate: false }).isPrivate).toBe(false);
  });

  it("IDEMPOTENT: two builds for the same checkInId target one deterministic id", () => {
    const a = buildCheckinAccomplishmentInput(seed);
    const b = buildCheckinAccomplishmentInput({ ...seed, timestamp: seed.timestamp + 5000 });
    // The create path's id (derived from the input's checkInId) and the delete
    // path's id (accomplishmentIdFor) are the SAME row for a given checkInId —
    // a re-create collides on that sk and a delete hits exactly that row.
    const createId = accomplishmentIdFor("checkin", a.checkInId!);
    const rebuildId = accomplishmentIdFor("checkin", b.checkInId!);
    const deleteId = accomplishmentIdFor("checkin", seed.checkInId);
    expect(createId).toBe(deleteId);
    expect(rebuildId).toBe(deleteId);
    expect(deleteId).toBe("checkin#checkin-abc");
  });

  it("namespaces the id by checkInId so distinct check-ins never collide", () => {
    const one = accomplishmentIdFor("checkin", "checkin-abc");
    const two = accomplishmentIdFor("checkin", "checkin-xyz");
    expect(one).not.toBe(two);
  });
});
