import { describe, it, expect } from "vitest";
import {
  CON_DAYS,
  isConDay,
  conDayLabel,
  conLocalDate,
  todayConDay,
  isSelectableConDay,
  guessConDayFromGpx,
  isValidDateString,
  autoConDayFromStrava,
  AUTO_CON_DAYS,
  EXCLUDED_SPORTS,
} from "./con-days";

const ms = (iso: string) => Date.parse(iso);

describe("CON_DAYS", () => {
  it("is Wed Aug 5 – Mon Aug 10, 2026, in order", () => {
    expect(CON_DAYS.map((d) => d.date)).toEqual([
      "2026-08-05",
      "2026-08-06",
      "2026-08-07",
      "2026-08-08",
      "2026-08-09",
      "2026-08-10",
    ]);
    expect(CON_DAYS.map((d) => d.label)).toEqual([
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
      "Sunday",
      "Monday",
    ]);
  });
});

describe("isConDay", () => {
  it("accepts con days, rejects everything else", () => {
    expect(isConDay("2026-08-08")).toBe(true);
    expect(isConDay("2026-08-04")).toBe(false); // day before window
    expect(isConDay("2026-08-11")).toBe(false); // day after window
    expect(isConDay("2026-07-16")).toBe(false);
    expect(isConDay(null)).toBe(false);
    expect(isConDay(undefined)).toBe(false);
    expect(isConDay("")).toBe(false);
  });
});

describe("conDayLabel", () => {
  it("maps a stored date to its label", () => {
    expect(conDayLabel("2026-08-08")).toBe("Saturday");
    expect(conDayLabel("2026-08-05")).toBe("Wednesday");
    expect(conDayLabel("2026-08-04")).toBeNull();
    expect(conDayLabel(null)).toBeNull();
  });
});

describe("conLocalDate (America/Los_Angeles, PDT)", () => {
  it("reads the con-local calendar date, not UTC", () => {
    // Aug 8 06:00 PDT == Aug 8 13:00Z
    expect(conLocalDate(ms("2026-08-08T13:00:00Z"))).toBe("2026-08-08");
    // Aug 8 22:00 PDT == Aug 9 05:00Z  -> still con-day Saturday, not Sunday
    expect(conLocalDate(ms("2026-08-09T05:00:00Z"))).toBe("2026-08-08");
    // Aug 9 01:00 PDT == Aug 9 08:00Z -> Sunday
    expect(conLocalDate(ms("2026-08-09T08:00:00Z"))).toBe("2026-08-09");
  });
});

describe("todayConDay", () => {
  it("returns the con-day when now is during the con", () => {
    expect(todayConDay(ms("2026-08-08T20:00:00Z"))).toBe("2026-08-08");
  });
  it("returns null off-con", () => {
    expect(todayConDay(ms("2026-07-16T20:00:00Z"))).toBeNull();
    expect(todayConDay(ms("2026-08-11T20:00:00Z"))).toBeNull();
  });
});

describe("isSelectableConDay (no future days)", () => {
  const nowSat = ms("2026-08-08T20:00:00Z"); // "today" = Saturday Aug 8
  it("allows today and past con-days", () => {
    expect(isSelectableConDay("2026-08-08", nowSat)).toBe(true); // today
    expect(isSelectableConDay("2026-08-06", nowSat)).toBe(true); // Thu (past)
  });
  it("rejects future con-days", () => {
    expect(isSelectableConDay("2026-08-09", nowSat)).toBe(false); // Sunday (future)
    expect(isSelectableConDay("2026-08-10", nowSat)).toBe(false);
  });
  it("rejects non-con dates", () => {
    expect(isSelectableConDay("2026-08-04", nowSat)).toBe(false);
    expect(isSelectableConDay(null, nowSat)).toBe(false);
  });
});

describe("isValidDateString (admin any-date override)", () => {
  it("accepts real YYYY-MM-DD dates, incl. non-con days", () => {
    expect(isValidDateString("2026-08-08")).toBe(true); // a con day
    expect(isValidDateString("2026-07-17")).toBe(true); // off-con, today-ish
    expect(isValidDateString("2025-01-01")).toBe(true); // any year
    expect(isValidDateString("2028-02-29")).toBe(true); // real leap day
  });
  it("rejects impossible or malformed dates", () => {
    expect(isValidDateString("2026-02-31")).toBe(false); // rolls over
    expect(isValidDateString("2026-13-01")).toBe(false);
    expect(isValidDateString("2026-8-8")).toBe(false); // not zero-padded
    expect(isValidDateString("08/08/2026")).toBe(false);
    expect(isValidDateString("2026-08-08T00:00")).toBe(false);
    expect(isValidDateString("")).toBe(false);
    expect(isValidDateString(null)).toBe(false);
    expect(isValidDateString(undefined)).toBe(false);
  });
});

describe("guessConDayFromGpx", () => {
  it("guesses the con-day from the first <time> (con-local)", () => {
    const gpx = `<gpx><trk><trkseg><trkpt lat="36.1" lon="-115.1"><time>2026-08-08T13:30:00Z</time></trkpt></trkseg></trk></gpx>`;
    expect(guessConDayFromGpx(gpx)).toBe("2026-08-08");
  });
  it("uses con-local date so a late-night run stays on its con-day", () => {
    // Aug 8 22:30 PDT == Aug 9 05:30Z
    const gpx = `<time>2026-08-09T05:30:00Z</time>`;
    expect(guessConDayFromGpx(gpx)).toBe("2026-08-08");
  });
  it("returns null with no timestamp", () => {
    expect(guessConDayFromGpx(`<trkpt lat="36" lon="-115"></trkpt>`)).toBeNull();
  });
  it("returns null when the run is outside the con window", () => {
    expect(guessConDayFromGpx(`<time>2026-07-16T13:00:00Z</time>`)).toBeNull();
  });
  it("returns null on a malformed timestamp", () => {
    expect(guessConDayFromGpx(`<time>not-a-date</time>`)).toBeNull();
  });
});

describe("autoConDayFromStrava", () => {
  it("tags an activity whose local start date is an auto-tag day", () => {
    expect(autoConDayFromStrava("2026-08-07T06:31:00Z")).toBe("2026-08-07");
  });

  it("reads start_date_local as WALL CLOCK, applying no timezone shift", () => {
    // Strava quirk: start_date_local is local time carrying a bogus Z. A 06:31
    // run is 06:31 where the runner stood. Shifting it by -7h (as we must for a
    // genuine UTC instant) would roll it back to Aug 6 and mis-tag the day.
    expect(autoConDayFromStrava("2026-08-07T06:31:00Z")).toBe("2026-08-07");
    // Same trap at the other end of the day: a 23:30 local run must not roll
    // FORWARD either...
    expect(autoConDayFromStrava("2026-08-08T23:30:00Z")).toBe("2026-08-08");
    // ...nor an early-hours one backwards.
    expect(autoConDayFromStrava("2026-08-08T00:15:00Z")).toBe("2026-08-08");
  });

  it.each(["2026-08-06", "2026-08-07", "2026-08-08", "2026-08-09"])(
    "auto-tags %s",
    (d) => expect(autoConDayFromStrava(`${d}T12:00:00Z`)).toBe(d)
  );

  it.each(["2026-08-05", "2026-08-10"])(
    "does NOT auto-tag %s - a con day, but outside the auto-tag set (Kurt, 2026-08-07)",
    (d) => expect(autoConDayFromStrava(`${d}T12:00:00Z`)).toBeNull()
  );

  it("returns null outside the con entirely", () => {
    expect(autoConDayFromStrava("2026-07-21T12:00:00Z")).toBeNull();
    expect(autoConDayFromStrava("2026-09-01T12:00:00Z")).toBeNull();
  });

  it("returns null on missing/malformed input rather than guessing", () => {
    expect(autoConDayFromStrava(undefined)).toBeNull();
    expect(autoConDayFromStrava("")).toBeNull();
    expect(autoConDayFromStrava("not-a-date")).toBeNull();
    expect(autoConDayFromStrava("08/07/2026")).toBeNull();
  });

  it("every auto-tag day is a real con day, so the heat map gate accepts it", () => {
    // isSelected() in heatmap-build.ts tests `conDay in CON_DAYS`. If these two
    // lists ever drift, auto-tagged runs would be written and then silently
    // ignored by the heat map - written but invisible.
    for (const d of AUTO_CON_DAYS) expect(isConDay(d)).toBe(true);
  });
});

describe("autoConDayFromStrava - sport filter (Kurt, 2026-08-07)", () => {
  const day = "2026-08-07T06:31:00Z";

  it.each(["Run", "TrailRun", "VirtualRun", "Walk", "Hike", "Swim", "Workout"])(
    "tags a %s",
    (sport) => expect(autoConDayFromStrava(day, sport)).toBe("2026-08-07")
  );

  it.each([
    "Ride",
    "MountainBikeRide",
    "GravelRide",
    "EBikeRide",
    "EMountainBikeRide",
    "VirtualRide",
    "Handcycle",
    "Velomobile",
  ])("does NOT tag a %s - cycling is excluded", (sport) =>
    expect(autoConDayFromStrava(day, sport)).toBeNull()
  );

  it("matches the sport case-insensitively", () => {
    // Defensive: Strava sends PascalCase, but a mismatch here would silently
    // tag every ride rather than fail loudly.
    expect(autoConDayFromStrava(day, "ride")).toBeNull();
    expect(autoConDayFromStrava(day, "RIDE")).toBeNull();
    expect(autoConDayFromStrava(day, "mountainbikeride")).toBeNull();
  });

  it("tags when the sport is unknown or absent - fail OPEN, not closed", () => {
    // An unrecognised sport_type must not silently drop a real run. Only the
    // named cycling types are excluded; anything else is let through.
    expect(autoConDayFromStrava(day, undefined)).toBe("2026-08-07");
    expect(autoConDayFromStrava(day, "")).toBe("2026-08-07");
    expect(autoConDayFromStrava(day, "SomeNewSportStravaAdded")).toBe("2026-08-07");
  });

  it("does not tag a ride even on an auto-tag day, nor a run off one", () => {
    expect(autoConDayFromStrava("2026-08-08T09:00:00Z", "Ride")).toBeNull();
    expect(autoConDayFromStrava("2026-08-05T09:00:00Z", "Run")).toBeNull();
  });

  it("EXCLUDED_SPORTS is the single list both the sync and the backfill read", () => {
    // If the backfill grew its own copy, a ride tagged live could be untagged by
    // the backfill (or vice versa) and the two would fight over the same row.
    expect(EXCLUDED_SPORTS.length).toBeGreaterThan(0);
    for (const s of EXCLUDED_SPORTS) {
      expect(autoConDayFromStrava("2026-08-07T06:31:00Z", s)).toBeNull();
    }
  });
});
