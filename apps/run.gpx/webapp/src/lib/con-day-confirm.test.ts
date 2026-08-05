import { describe, it, expect } from "vitest";
import {
  conLocalDate,
  resolveConDayConfirm,
  pickableConDays,
  shortConDate,
  conDayChipLabel,
  longConDayLabel,
  isConDayFull,
  type ConDayLike,
} from "../../../gpx-studio/website/src/lib/logic/con-day-confirm";

/**
 * The six DEF CON 34 con-days, shaped like `GET /api/gpx/conday-usage` returns
 * them. `selectable` is the server's not-in-the-future answer; these fixtures
 * pin it explicitly per test rather than deriving it, so a change to the
 * server's rule can't silently rewrite what these tests assert.
 */
function days(overrides: Partial<Record<string, Partial<ConDayLike>>> = {}): ConDayLike[] {
  const base: ConDayLike[] = [
    { label: "Wednesday", date: "2026-08-05", remaining: 10, selectable: true },
    { label: "Thursday", date: "2026-08-06", remaining: 10, selectable: true },
    { label: "Friday", date: "2026-08-07", remaining: 10, selectable: true },
    { label: "Saturday", date: "2026-08-08", remaining: 10, selectable: false },
    { label: "Sunday", date: "2026-08-09", remaining: 10, selectable: false },
    { label: "Monday", date: "2026-08-10", remaining: 10, selectable: false },
  ];
  return base.map((d) => ({ ...d, ...(overrides[d.date] ?? {}) }));
}

/** Noon con-local (PDT) on the given con-day, as epoch ms. */
function noonOn(date: string): number {
  return Date.parse(`${date}T12:00:00-07:00`);
}

describe("conLocalDate", () => {
  it("reads the con-local calendar date, not the UTC one", () => {
    // 11pm PDT on Aug 6 is already Aug 7 in UTC — the whole reason for the
    // fixed offset. A late-evening run must not roll into the next con-day.
    expect(conLocalDate(Date.parse("2026-08-06T23:30:00-07:00"))).toBe("2026-08-06");
  });
  it("handles the midnight boundary", () => {
    expect(conLocalDate(Date.parse("2026-08-06T00:00:00-07:00"))).toBe("2026-08-06");
    expect(conLocalDate(Date.parse("2026-08-05T23:59:59-07:00"))).toBe("2026-08-05");
  });
});

describe("resolveConDayConfirm", () => {
  it("calls a file recorded today 'today'", () => {
    const r = resolveConDayConfirm("2026-08-05", days(), noonOn("2026-08-05"));
    expect(r).toEqual({ kind: "today", date: "2026-08-05", label: "Wednesday" });
  });

  it("calls an earlier con-day a missed day — the regression this module exists for", () => {
    // Thursday's GPX, uploaded on Friday. The old hub tagged this FRIDAY.
    const r = resolveConDayConfirm("2026-08-06", days(), noonOn("2026-08-07"));
    expect(r).toEqual({ kind: "missed", date: "2026-08-06", label: "Thursday" });
  });

  it("treats a pre-con date as off-con and never snaps it to a con day", () => {
    const r = resolveConDayConfirm("2026-07-30", days(), noonOn("2026-08-05"));
    expect(r).toEqual({ kind: "offcon", date: "2026-07-30" });
  });

  it("treats a post-con date as off-con", () => {
    const r = resolveConDayConfirm("2026-08-12", days(), noonOn("2026-08-10"));
    expect(r).toEqual({ kind: "offcon", date: "2026-08-12" });
  });

  it("treats a FUTURE con day as off-con, not as a missed day", () => {
    // Saturday's date while it is still Wednesday: the run cannot have happened,
    // so it must not present as a friendly "catching up" screen.
    const r = resolveConDayConfirm("2026-08-08", days(), noonOn("2026-08-05"));
    expect(r).toEqual({ kind: "offcon", date: "2026-08-08" });
  });

  it("reports unknown when the file carried no timestamp", () => {
    expect(resolveConDayConfirm(null, days(), noonOn("2026-08-05"))).toEqual({
      kind: "unknown",
    });
  });

  it("still resolves a full day so the UI can explain the cap itself", () => {
    // Fullness is a separate concern from which-day; resolving must not hide it.
    const r = resolveConDayConfirm(
      "2026-08-05",
      days({ "2026-08-05": { remaining: 0 } }),
      noonOn("2026-08-05")
    );
    expect(r).toEqual({ kind: "today", date: "2026-08-05", label: "Wednesday" });
  });
});

describe("pickableConDays", () => {
  it("offers only days that have happened", () => {
    expect(pickableConDays(days()).map((d) => d.date)).toEqual([
      "2026-08-05",
      "2026-08-06",
      "2026-08-07",
    ]);
  });
  it("is empty before the con opens", () => {
    const notYet = days().map((d) => ({ ...d, selectable: false }));
    expect(pickableConDays(notYet)).toEqual([]);
  });
});

describe("labels", () => {
  it("formats a short date without locale dependence", () => {
    expect(shortConDate("2026-08-05")).toBe("Aug 5");
    expect(shortConDate("2026-08-10")).toBe("Aug 10");
  });
  it("returns the input unchanged when it isn't an ISO date", () => {
    expect(shortConDate("not-a-date")).toBe("not-a-date");
    expect(shortConDate("2026-13-05")).toBe("2026-13-05");
  });
  it("builds chip and long labels", () => {
    const wed = days()[0];
    expect(conDayChipLabel(wed)).toBe("Wed Aug 5");
    expect(longConDayLabel(wed)).toBe("Wednesday, Aug 5");
  });
});

describe("isConDayFull", () => {
  it("is true only at or past the cap", () => {
    expect(isConDayFull({ ...days()[0], remaining: 0 })).toBe(true);
    expect(isConDayFull({ ...days()[0], remaining: 1 })).toBe(false);
  });
});
