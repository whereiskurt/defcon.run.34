import { describe, it, expect } from "vitest";
import {
  isTreadmillActivity,
  isInTreadmillWindow,
  qualifiesForTreadmillFlag,
  TREADMILL_WINDOW_START,
  TREADMILL_WINDOW_END,
} from "./treadmill-flag";

describe("isTreadmillActivity", () => {
  it("trusts Strava's explicit trainer flag even when a polyline exists", () => {
    // Some indoor setups still emit a (bogus) polyline; trainer:true wins.
    expect(
      isTreadmillActivity({ trainer: true, map: { summary_polyline: "abc" } })
    ).toBe(true);
  });

  it("treats a missing polyline as indoor", () => {
    expect(isTreadmillActivity({ map: { summary_polyline: "" } })).toBe(true);
    expect(isTreadmillActivity({ map: { summary_polyline: null } })).toBe(true);
    expect(isTreadmillActivity({ map: null })).toBe(true);
    expect(isTreadmillActivity({})).toBe(true);
  });

  it("does NOT flag an ordinary outdoor run", () => {
    expect(
      isTreadmillActivity({ trainer: false, map: { summary_polyline: "abc" } })
    ).toBe(false);
  });
});

describe("isInTreadmillWindow", () => {
  it("includes both endpoints", () => {
    expect(isInTreadmillWindow(TREADMILL_WINDOW_START)).toBe(true);
    expect(isInTreadmillWindow(TREADMILL_WINDOW_END)).toBe(true);
  });

  it("includes the two PRE-con days, which is the point of the wider window", () => {
    // Con days are Aug 5–10; the flag deliberately reaches back to Aug 3.
    expect(isInTreadmillWindow("2026-08-03")).toBe(true);
    expect(isInTreadmillWindow("2026-08-04")).toBe(true);
  });

  it("excludes the days either side", () => {
    expect(isInTreadmillWindow("2026-08-02")).toBe(false);
    expect(isInTreadmillWindow("2026-08-11")).toBe(false);
  });

  it("rejects junk rather than coercing it", () => {
    expect(isInTreadmillWindow(null)).toBe(false);
    expect(isInTreadmillWindow(undefined)).toBe(false);
    expect(isInTreadmillWindow("")).toBe(false);
    expect(isInTreadmillWindow("not-a-date")).toBe(false);
    expect(isInTreadmillWindow("2026-8-3")).toBe(false);
  });
});

describe("qualifiesForTreadmillFlag", () => {
  it("qualifies the run that prompted the flag", () => {
    // Kurt's real activity, verbatim from the prod Strava cache.
    expect(
      qualifiesForTreadmillFlag({
        trainer: true,
        map: { summary_polyline: null },
        start_date_local: "2026-08-04T18:00:11Z",
      })
    ).toBe(true);
  });

  it("qualifies an indoor run mid-con", () => {
    expect(
      qualifiesForTreadmillFlag({
        trainer: true,
        map: null,
        start_date_local: "2026-08-07T06:00:00Z",
      })
    ).toBe(true);
  });

  it("rejects an indoor run OUTSIDE the window", () => {
    expect(
      qualifiesForTreadmillFlag({
        trainer: true,
        map: null,
        start_date_local: "2026-07-30T18:00:00Z",
      })
    ).toBe(false);
  });

  it("rejects an outdoor run inside the window", () => {
    expect(
      qualifiesForTreadmillFlag({
        trainer: false,
        map: { summary_polyline: "abc" },
        start_date_local: "2026-08-07T06:00:00Z",
      })
    ).toBe(false);
  });

  it("rejects an activity with no date at all", () => {
    expect(qualifiesForTreadmillFlag({ trainer: true, map: null })).toBe(false);
  });

  it("uses the LOCAL date part and never timezone-shifts it", () => {
    // A late-evening Aug 10 run must not roll into Aug 11 and lose the flag.
    expect(
      qualifiesForTreadmillFlag({
        trainer: true,
        map: null,
        start_date_local: "2026-08-10T23:45:00Z",
      })
    ).toBe(true);
  });
});
