import { describe, it, expect } from "vitest";

import {
  isWithinScoreWindow,
  validateScoreWindow,
  DEFCON_RUN_HOURS,
  TZ_OPTIONS,
  type ScoreWindow,
} from "@/lib/ctf-score-window";

// A Thu–Sun 06:00–08:00 America/Los_Angeles window (the DEF CON run-hours shape).
const PT_WINDOW: ScoreWindow = {
  days: [0, 4, 5, 6],
  from: "06:00",
  to: "08:00",
  tz: "America/Los_Angeles",
};

describe("isWithinScoreWindow — inside/outside by day and time", () => {
  it("is INSIDE for a selected weekday within [from, to)", () => {
    // 2026-08-06T13:30Z → LA Thu 06:30 (PDT) → inside.
    expect(isWithinScoreWindow(PT_WINDOW, Date.parse("2026-08-06T13:30:00Z"))).toBe(true);
    // 2026-08-06T14:30Z → LA Thu 07:30 → still inside.
    expect(isWithinScoreWindow(PT_WINDOW, Date.parse("2026-08-06T14:30:00Z"))).toBe(true);
  });

  it("is OUTSIDE on a NON-selected weekday even at a selected time", () => {
    // 2026-08-04T13:30Z → LA Tue 06:30 → Tue (2) not in {0,4,5,6}.
    expect(isWithinScoreWindow(PT_WINDOW, Date.parse("2026-08-04T13:30:00Z"))).toBe(false);
  });

  it("is OUTSIDE before `from` on a selected weekday", () => {
    // 2026-08-06T12:30Z → LA Thu 05:30 → before 06:00.
    expect(isWithinScoreWindow(PT_WINDOW, Date.parse("2026-08-06T12:30:00Z"))).toBe(false);
  });

  it("is OUTSIDE at/after `to` (half-open upper bound) on a selected weekday", () => {
    // 2026-08-06T15:00Z → LA Thu 08:00 → equals `to` ⇒ excluded.
    expect(isWithinScoreWindow(PT_WINDOW, Date.parse("2026-08-06T15:00:00Z"))).toBe(false);
    // 2026-08-06T20:00Z → LA Thu 13:00 → well after `to`.
    expect(isWithinScoreWindow(PT_WINDOW, Date.parse("2026-08-06T20:00:00Z"))).toBe(false);
  });
});

describe("isWithinScoreWindow — DST correctness via Intl (SC2)", () => {
  it("resolves the SAME UTC hour to DIFFERENT LA wall-clock across DST → summer inside, winter outside", () => {
    // Two Thursdays at the identical 13:30 UTC:
    //   summer 2026-08-06 → 06:30 PDT (UTC-7) → INSIDE 06:00–08:00.
    //   winter 2026-01-08 → 05:30 PST (UTC-8) → OUTSIDE (before 06:00).
    // Identical UTC hour, different local hour ⇒ the offset tracked DST via Intl.
    const summer = Date.parse("2026-08-06T13:30:00Z");
    const winter = Date.parse("2026-01-08T13:30:00Z");
    expect(isWithinScoreWindow(PT_WINDOW, summer)).toBe(true);
    expect(isWithinScoreWindow(PT_WINDOW, winter)).toBe(false);
  });
});

describe("isWithinScoreWindow — fail-closed on invalid tz", () => {
  it("returns false (deny) when the tz is undecodable rather than throwing", () => {
    const bad: ScoreWindow = { ...PT_WINDOW, tz: "Not/AZone_that_exists" };
    // Even at an instant that would be inside for a valid tz, a bad tz denies.
    expect(isWithinScoreWindow(bad, Date.parse("2026-08-06T13:30:00Z"))).toBe(false);
  });
});

describe("DEFCON_RUN_HOURS quick-set constant (SC3)", () => {
  it("resolves to Thu–Sun 06:00–08:00 America/Los_Angeles", () => {
    expect(DEFCON_RUN_HOURS.days).toEqual([0, 4, 5, 6]);
    expect(DEFCON_RUN_HOURS.from).toBe("06:00");
    expect(DEFCON_RUN_HOURS.to).toBe("08:00");
    expect(DEFCON_RUN_HOURS.tz).toBe("America/Los_Angeles");
  });

  it("is itself a live window at a Thu 06:30 PDT instant", () => {
    expect(isWithinScoreWindow(DEFCON_RUN_HOURS, Date.parse("2026-08-06T13:30:00Z"))).toBe(true);
  });
});

describe("validateScoreWindow — reject degenerate / never-scoring windows (WR-01)", () => {
  it("accepts a well-formed same-day window", () => {
    expect(validateScoreWindow(PT_WINDOW)).toBeNull();
    expect(validateScoreWindow(DEFCON_RUN_HOURS)).toBeNull();
  });

  it("rejects an empty day set", () => {
    expect(
      validateScoreWindow({ days: [], from: "06:00", to: "08:00", tz: "UTC" }),
    ).toMatch(/at least one day/i);
  });

  it("rejects an overnight window (to <= from is unsatisfiable, no wrap-around)", () => {
    // 22:00–02:00 would never score under the half-open same-day predicate.
    expect(
      validateScoreWindow({ days: [5], from: "22:00", to: "02:00", tz: "UTC" }),
    ).toMatch(/after open time/i);
  });

  it("rejects a zero-length window (from === to)", () => {
    expect(
      validateScoreWindow({ days: [5], from: "08:00", to: "08:00", tz: "UTC" }),
    ).toMatch(/after open time/i);
  });

  it("rejects empty / malformed times", () => {
    expect(validateScoreWindow({ days: [5], from: "", to: "", tz: "UTC" })).toMatch(
      /valid open and close times/i,
    );
    expect(
      validateScoreWindow({ days: [5], from: "6:00", to: "08:00", tz: "UTC" }),
    ).toMatch(/valid open and close times/i);
    expect(
      validateScoreWindow({ days: [5], from: "06:00", to: "24:00", tz: "UTC" }),
    ).toMatch(/valid open and close times/i);
  });

  it("a rejected window is ALSO never-scoring under the runtime predicate (fail-closed backstop)", () => {
    const overnight: ScoreWindow = { days: [4, 5], from: "22:00", to: "02:00", tz: "UTC" };
    // Thu 23:00 UTC: day is selected, 23:00 >= "22:00" but NOT < "02:00" ⇒ denied.
    expect(isWithinScoreWindow(overnight, Date.parse("2026-08-06T23:00:00Z"))).toBe(false);
    // Fri 01:00 UTC: an instant a wrap-around WOULD credit is still denied on time.
    expect(isWithinScoreWindow(overnight, Date.parse("2026-08-07T01:00:00Z"))).toBe(false);
  });
});

describe("TZ_OPTIONS — the single PT/ET/UTC ↔ IANA source of truth", () => {
  it("is exactly the three ordered PT/ET/UTC pairs mapped to IANA ids", () => {
    expect(TZ_OPTIONS).toEqual([
      { label: "PT", tz: "America/Los_Angeles" },
      { label: "ET", tz: "America/New_York" },
      { label: "UTC", tz: "UTC" },
    ]);
  });
});
