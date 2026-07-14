import { describe, it, expect } from "vitest";

import {
  rankByScore,
  nameMapFromUsers,
  joinSolveNames,
  guardFormula,
  leaderboardCsv,
} from "../ctf-leaderboard";
import type { RunUserItem } from "@/entities/run-user";
import type { CtfSolveItem } from "@/entities/ctf";

const user = (o: Partial<RunUserItem> & { userId: string }): RunUserItem => o;

describe("rankByScore", () => {
  it("filters out zero / undefined ctfScore and keeps only scorers", () => {
    const rows = rankByScore([
      user({ userId: "a", ctfScore: 30 }),
      user({ userId: "b", ctfScore: 0 }),
      user({ userId: "c" }), // undefined score
    ]);
    expect(rows.map((r) => r.userId)).toEqual(["a"]);
  });

  it("sorts by ctfScore descending", () => {
    const rows = rankByScore([
      user({ userId: "low", ctfScore: 10 }),
      user({ userId: "high", ctfScore: 100 }),
      user({ userId: "mid", ctfScore: 50 }),
    ]);
    expect(rows.map((r) => r.userId)).toEqual(["high", "mid", "low"]);
  });

  it("keeps a stable order on ties", () => {
    const rows = rankByScore([
      user({ userId: "first", ctfScore: 40 }),
      user({ userId: "second", ctfScore: 40 }),
      user({ userId: "third", ctfScore: 40 }),
    ]);
    expect(rows.map((r) => r.userId)).toEqual(["first", "second", "third"]);
  });

  it("shapes each row with userId / displayName / ctfScore / ctfSolves and defaults", () => {
    const [row] = rankByScore([
      user({ userId: "u1", displayName: "Neo", ctfScore: 20, ctfSolves: 3 }),
    ]);
    expect(row).toEqual({
      userId: "u1",
      displayName: "Neo",
      ctfScore: 20,
      ctfSolves: 3,
    });

    const [bare] = rankByScore([user({ userId: "u2", ctfScore: 5 })]);
    expect(bare).toEqual({
      userId: "u2",
      displayName: "",
      ctfScore: 5,
      ctfSolves: 0,
    });
  });
});

describe("nameMapFromUsers / joinSolveNames", () => {
  const solves: CtfSolveItem[] = [
    { challenge: "c1", user: "u1", ordinal: 1, points: 100 },
    { challenge: "c1", user: "raw-sub-xyz", ordinal: 2, points: 90 },
  ];

  it("builds a userId → displayName map", () => {
    const map = nameMapFromUsers([
      user({ userId: "u1", displayName: "Trinity" }),
      user({ userId: "u2" }), // no name → omitted
    ]);
    expect(map).toEqual({ u1: "Trinity" });
  });

  it("joins names, falling back to the raw user id on a namespace miss", () => {
    const named = joinSolveNames(solves, { u1: "Trinity" });
    expect(named[0].name).toBe("Trinity");
    expect(named[1].name).toBe("raw-sub-xyz"); // fallback = raw sub
    // original fields preserved
    expect(named[0].points).toBe(100);
    expect(named[1].ordinal).toBe(2);
  });
});

describe("guardFormula (OWASP formula-injection guard)", () => {
  it.each(["=1+1", "+cmd", "-2", "@ref", "\ttab", "\rcr"])(
    "prefixes a dangerous leading char in %j with an apostrophe",
    (value) => {
      expect(guardFormula(value)).toBe(`'${value}`);
    }
  );

  it("leaves benign text unchanged", () => {
    expect(guardFormula("Neo")).toBe("Neo");
    expect(guardFormula("rabbit_1234")).toBe("rabbit_1234");
    expect(guardFormula("a=b")).toBe("a=b"); // not leading
  });

  it("stringifies numbers and null/undefined safely", () => {
    expect(guardFormula(42)).toBe("42");
    expect(guardFormula(null)).toBe("");
    expect(guardFormula(undefined)).toBe("");
  });
});

describe("leaderboardCsv", () => {
  it("neutralizes a formula-injection displayName and RFC-4180 quotes when needed", () => {
    const csv = leaderboardCsv([
      { userId: "u1", displayName: "=1+1", ctfScore: 100, ctfSolves: 2 },
    ]);
    const lines = csv.split("\n");
    expect(lines[0]).toBe("Rank,Runner,User ID,Score,Solves");
    // The malicious cell is apostrophe-prefixed (not a raw leading '=').
    expect(lines[1]).toContain("'=1+1");
    expect(lines[1]).not.toMatch(/,=1\+1,/);
  });

  it("quotes a cell containing a comma while still guarding formulas", () => {
    const csv = leaderboardCsv([
      { userId: "u1", displayName: "=cmd(),evil", ctfScore: 10, ctfSolves: 1 },
    ]);
    // guardFormula prefixes ' then csvCell quotes because of the comma.
    expect(csv).toContain(`"'=cmd(),evil"`);
  });

  it("emits a rank column counting from 1 and leaves benign rows unquoted", () => {
    const csv = leaderboardCsv([
      { userId: "a", displayName: "Neo", ctfScore: 100, ctfSolves: 3 },
      { userId: "b", displayName: "Trinity", ctfScore: 50, ctfSolves: 2 },
    ]);
    const lines = csv.split("\n");
    expect(lines[1]).toBe("1,Neo,a,100,3");
    expect(lines[2]).toBe("2,Trinity,b,50,2");
  });
});
