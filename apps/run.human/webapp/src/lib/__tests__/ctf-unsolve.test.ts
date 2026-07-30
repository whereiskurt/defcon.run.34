import { describe, it, expect } from "vitest";
import { soleSolverChallenges } from "../ctf-unsolve";

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
