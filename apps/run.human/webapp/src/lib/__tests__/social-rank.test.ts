import { describe, it, expect } from "vitest";

import {
  computeBand,
  pairKey,
  scoreBucket,
  parseScoreBucket,
  type BoardCounts,
} from "../social-rank";

function board(entries: Array<[number, number]>): BoardCounts {
  return new Map(entries);
}

describe("pairKey", () => {
  it("is order-independent", () => {
    expect(pairKey("bob", "alice")).toBe("alice_bob");
    expect(pairKey("alice", "bob")).toBe("alice_bob");
  });
});

describe("score buckets", () => {
  it("round-trips zero-padded", () => {
    expect(scoreBucket(12)).toBe("score_000012");
    expect(parseScoreBucket("score_000012")).toBe(12);
    expect(parseScoreBucket("garbage")).toBeNull();
  });
});

describe("computeBand", () => {
  it("score 0 is unranked regardless of board", () => {
    expect(computeBand(0, board([[5, 10]])).tier).toBe("none");
  });

  it("scored user with missing/empty board falls back to entered", () => {
    expect(computeBand(3, null).tier).toBe("entered");
    expect(computeBand(3, board([])).tier).toBe("entered");
  });

  it("single scored user is the leader", () => {
    expect(computeBand(1, board([[1, 1]])).tier).toBe("leader");
  });

  it("ties at max are all leaders", () => {
    const b = board([
      [10, 2], // two users tied at max
      [4, 50],
    ]);
    expect(computeBand(10, b).tier).toBe("leader");
  });

  it("percentile boundaries over a 100-user field", () => {
    // 100 users: scores 1..100, one each. max=100.
    const entries: Array<[number, number]> = [];
    for (let s = 1; s <= 100; s++) entries.push([s, 1]);
    const b = board(entries);

    expect(computeBand(100, b).tier).toBe("leader");
    expect(computeBand(96, b).tier).toBe("top5"); // 4 above / 100 = 0.04
    expect(computeBand(95, b).tier).toBe("top10"); // 5 above = 0.05
    expect(computeBand(91, b).tier).toBe("top10"); // 9 above = 0.09
    expect(computeBand(90, b).tier).toBe("top25"); // 10 above = 0.10
    expect(computeBand(76, b).tier).toBe("top25"); // 24 above = 0.24
    expect(computeBand(75, b).tier).toBe("top50"); // 25 above = 0.25
    expect(computeBand(51, b).tier).toBe("top50"); // 49 above = 0.49
    expect(computeBand(50, b).tier).toBe("entered"); // 50 above = 0.50
    expect(computeBand(1, b).tier).toBe("entered");
    expect(computeBand(1, b).total).toBe(100);
  });

  it("small tied field: everyone below max in a 52-user field", () => {
    const b = board([
      [10, 2],
      [4, 50],
    ]);
    // 4-scorers: 2 of 52 above them → fracAbove ≈ 0.038 → top5 band.
    expect(computeBand(4, b).tier).toBe("top5");
  });

  it("ignores zero/negative counts and scores", () => {
    const b = board([
      [10, 0],
      [0, 5],
      [3, 2],
    ]);
    expect(computeBand(3, b).tier).toBe("leader"); // only real bucket
  });
});
