import { describe, it, expect } from "vitest";
import {
  hasCustomName,
  shortId,
  rowLabel,
  filterStandings,
  sortStandings,
  type EnrichedRow,
} from "./ctf-leaderboard-ui";

/**
 * Pure-core tests for the client-safe CTF standings helpers. No DB, no React —
 * every filter/sort/name invariant is proven over plain fixture rows so the
 * "use client" table stays a thin render over these.
 */

function row(over: Partial<EnrichedRow>): EnrichedRow {
  return {
    userId: "u",
    displayName: "",
    ctfScore: 0,
    ctfSolves: 0,
    firstBloods: 0,
    qr: 0,
    covert: 0,
    ...over,
  };
}

describe("hasCustomName / shortId / rowLabel", () => {
  it("treats rabbit_ defaults (any case) and blanks as unnamed", () => {
    expect(hasCustomName("rabbit_1a2b")).toBe(false);
    expect(hasCustomName("RABBIT_9z")).toBe(false);
    expect(hasCustomName("")).toBe(false);
    expect(hasCustomName("  ")).toBe(false);
    expect(hasCustomName(undefined)).toBe(false);
  });
  it("treats a set name (even one containing 'rabbit') as named", () => {
    expect(hasCustomName("Kurt")).toBe(true);
    expect(hasCustomName("rabbitfoot")).toBe(true); // no underscore
  });
  it("shortId truncates only when longer than 8 chars", () => {
    expect(shortId("abcd")).toBe("abcd");
    expect(shortId("0123456789")).toBe("01234567…");
  });
  it("rowLabel shows the name for named rows and a muted short id otherwise", () => {
    expect(rowLabel({ displayName: "Kurt", userId: "x" })).toEqual({
      text: "Kurt",
      muted: false,
    });
    expect(rowLabel({ displayName: "rabbit_00", userId: "abcdefghij" })).toEqual({
      text: "abcdefgh…",
      muted: true,
    });
  });
});

describe("filterStandings", () => {
  const rows = [
    row({ userId: "a", displayName: "Alpha", ctfScore: 30 }),
    row({ userId: "bunny", displayName: "rabbit_00ff", ctfScore: 20 }),
    row({ userId: "c", displayName: "Charlie", ctfScore: 10 }),
  ];

  it("is a no-op with no opts", () => {
    expect(filterStandings(rows)).toHaveLength(3);
  });
  it("namedOnly drops rabbit_ defaults", () => {
    expect(filterStandings(rows, { namedOnly: true }).map((r) => r.userId)).toEqual([
      "a",
      "c",
    ]);
  });
  it("q matches displayName OR userId, case-insensitively", () => {
    expect(filterStandings(rows, { q: "char" }).map((r) => r.userId)).toEqual(["c"]);
    expect(filterStandings(rows, { q: "BUNNY" }).map((r) => r.userId)).toEqual(["bunny"]);
  });
  it("composes q AND namedOnly (never the rabbit_ default)", () => {
    // 'a' appears in "Alpha", "Charlie", and "rabbit_00ff" — namedOnly excludes the rabbit.
    expect(filterStandings(rows, { q: "a", namedOnly: true }).map((r) => r.userId)).toEqual([
      "a",
      "c",
    ]);
  });
  it("does not mutate the input", () => {
    filterStandings(rows, { namedOnly: true });
    expect(rows.map((r) => r.userId)).toEqual(["a", "bunny", "c"]);
  });
});

describe("sortStandings", () => {
  const rows = [
    row({ userId: "a", displayName: "Alpha", ctfScore: 10, ctfSolves: 5, firstBloods: 0 }),
    row({ userId: "b", displayName: "Bravo", ctfScore: 30, ctfSolves: 1, firstBloods: 3 }),
    row({ userId: "c", displayName: "rabbit_zz", ctfScore: 20, ctfSolves: 9, firstBloods: 1 }),
  ];

  it("score (default) sorts descending", () => {
    expect(sortStandings(rows, "score").map((r) => r.userId)).toEqual(["b", "c", "a"]);
  });
  it("solves sorts descending", () => {
    expect(sortStandings(rows, "solves").map((r) => r.userId)).toEqual(["c", "a", "b"]);
  });
  it("first sorts by firstBloods descending", () => {
    expect(sortStandings(rows, "first").map((r) => r.userId)).toEqual(["b", "c", "a"]);
  });
  it("name puts named runners (A→Z) above unnamed", () => {
    // Alpha, Bravo named; rabbit_zz unnamed → sinks to the bottom despite 'r' < 'z'.
    expect(sortStandings(rows, "name").map((r) => r.userId)).toEqual(["a", "b", "c"]);
  });
  it("is stable via userId tiebreak and non-mutating", () => {
    const tied = [
      row({ userId: "y", ctfScore: 5 }),
      row({ userId: "x", ctfScore: 5 }),
    ];
    expect(sortStandings(tied, "score").map((r) => r.userId)).toEqual(["x", "y"]);
    expect(tied.map((r) => r.userId)).toEqual(["y", "x"]); // input untouched
  });
});
