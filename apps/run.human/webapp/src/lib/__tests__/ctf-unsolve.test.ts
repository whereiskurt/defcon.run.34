import { describe, it, expect } from "vitest";
import {
  computeCounterUpdate,
  soleSolverChallenges,
  sumPoints,
} from "../ctf-unsolve";

describe("computeCounterUpdate", () => {
  it("user mode zeroes both counters outright regardless of removed totals", () => {
    expect(
      computeCounterUpdate({
        mode: "user",
        removedPoints: 999,
        removedSolves: 3,
        currentScore: 250,
        currentSolves: 4,
      })
    ).toEqual({ nextScore: 0, nextSolves: 0 });
  });

  it("challenge mode subtracts exactly what was removed", () => {
    expect(
      computeCounterUpdate({
        mode: "challenge",
        removedPoints: 50,
        removedSolves: 1,
        currentScore: 130,
        currentSolves: 3,
      })
    ).toEqual({ nextScore: 80, nextSolves: 2 });
  });

  it("challenge mode floors score at 0 (never persists a negative)", () => {
    expect(
      computeCounterUpdate({
        mode: "challenge",
        removedPoints: 200,
        removedSolves: 1,
        currentScore: 50,
        currentSolves: 1,
      })
    ).toEqual({ nextScore: 0, nextSolves: 0 });
  });

  it("challenge mode floors solves at 0 independently of score", () => {
    expect(
      computeCounterUpdate({
        mode: "challenge",
        removedPoints: 0,
        removedSolves: 5,
        currentScore: 40,
        currentSolves: 2,
      })
    ).toEqual({ nextScore: 40, nextSolves: 0 });
  });
});

describe("soleSolverChallenges", () => {
  it("returns only challenges where the target is the SOLE solver (count === 1)", () => {
    expect(
      soleSolverChallenges(["alpha", "bravo", "charlie"], {
        alpha: 1, // sole solver → reset
        bravo: 3, // others hold solves → leave
        charlie: 1, // sole solver → reset
      })
    ).toEqual(["alpha", "charlie"]);
  });

  it("never resets a challenge with no known solver count (defensive 0)", () => {
    expect(soleSolverChallenges(["ghost"], {})).toEqual([]);
  });

  it("leaves a multi-solver challenge untouched to preserve others' ordinals", () => {
    expect(soleSolverChallenges(["shared"], { shared: 2 })).toEqual([]);
  });

  it("returns an empty list when unsolving no challenges", () => {
    expect(soleSolverChallenges([], { alpha: 1 })).toEqual([]);
  });
});

describe("sumPoints", () => {
  it("sums numeric points and treats missing/NaN as 0", () => {
    expect(
      sumPoints([
        { challenge: "a", points: 30 },
        { challenge: "a", points: 20 }, // e.g. a repeatable score-event row
        { challenge: "a" }, // missing points → 0
        { challenge: "a", points: NaN }, // NaN → 0
      ])
    ).toBe(50);
  });

  it("is 0 for an empty set", () => {
    expect(sumPoints([])).toBe(0);
  });
});
