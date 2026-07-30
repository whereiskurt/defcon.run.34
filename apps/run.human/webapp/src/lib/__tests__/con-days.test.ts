import { describe, it, expect } from "vitest";
import {
  CON_DAYS,
  conLocalDate,
  isConDay,
  streakPoints,
} from "../con-days";

describe("con-days", () => {
  it("has the six DC34 run days", () => {
    expect(CON_DAYS).toEqual([
      "2026-08-05", "2026-08-06", "2026-08-07",
      "2026-08-08", "2026-08-09", "2026-08-10",
    ]);
  });

  it("resolves con-local (PDT, UTC-7) dates across midnight", () => {
    // 2026-08-08T02:00Z is still Aug 7 in PDT.
    expect(conLocalDate(Date.parse("2026-08-08T02:00:00Z"))).toBe("2026-08-07");
    expect(conLocalDate(Date.parse("2026-08-08T12:00:00Z"))).toBe("2026-08-08");
  });

  it("isConDay accepts only the six dates", () => {
    expect(isConDay("2026-08-05")).toBe(true);
    expect(isConDay("2026-08-11")).toBe(false);
    expect(isConDay("")).toBe(false);
  });

  it("streakPoints is total-by-streak, capped at 4+ days", () => {
    expect(streakPoints(0)).toBe(0);
    expect(streakPoints(1)).toBe(25);
    expect(streakPoints(2)).toBe(50);
    expect(streakPoints(3)).toBe(100);
    expect(streakPoints(4)).toBe(500);
    expect(streakPoints(6)).toBe(500); // six possible con days, cap at 4
    expect(streakPoints(-1)).toBe(0);
  });
});
