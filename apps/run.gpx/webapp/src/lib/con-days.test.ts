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
