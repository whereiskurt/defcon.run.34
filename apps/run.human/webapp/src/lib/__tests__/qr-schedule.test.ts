import { describe, it, expect } from "vitest";
import {
  compileScheduleToRules,
  activeScheduleEntry,
  ptWallClockToUtcIso,
  utcToPtParts,
  type ScheduleEntry,
} from "@/lib/qr-schedule";

const S = (startsAt: string, dest: string, label?: string): ScheduleEntry => ({
  startsAt,
  dest,
  label,
});

describe("compileScheduleToRules", () => {
  it("returns [] for an empty schedule", () => {
    expect(compileScheduleToRules([])).toEqual([]);
  });

  it("makes one open-ended window for a single switch-point", () => {
    const rules = compileScheduleToRules([S("2026-08-06T15:00:00.000Z", "https://a.example/")]);
    expect(rules).toEqual([
      { kind: "time", from: "2026-08-06T15:00:00.000Z", to: "2999-01-01T00:00:00.000Z", dest: "https://a.example/" },
    ]);
  });

  it("chains consecutive gap-free windows sorted by startsAt", () => {
    const rules = compileScheduleToRules([
      S("2026-08-06T21:00:00.000Z", "https://c.example/"),
      S("2026-08-06T15:00:00.000Z", "https://a.example/"),
      S("2026-08-06T18:00:00.000Z", "https://b.example/"),
    ]);
    expect(rules.map((r) => [r.from, r.to, r.dest])).toEqual([
      ["2026-08-06T15:00:00.000Z", "2026-08-06T18:00:00.000Z", "https://a.example/"],
      ["2026-08-06T18:00:00.000Z", "2026-08-06T21:00:00.000Z", "https://b.example/"],
      ["2026-08-06T21:00:00.000Z", "2999-01-01T00:00:00.000Z", "https://c.example/"],
    ]);
  });

  it("drops entries with a blank dest or unparseable startsAt", () => {
    const rules = compileScheduleToRules([
      S("2026-08-06T15:00:00.000Z", "   "),
      S("not-a-date", "https://a.example/"),
      S("2026-08-06T16:00:00.000Z", "https://ok.example/"),
    ]);
    expect(rules).toEqual([
      { kind: "time", from: "2026-08-06T16:00:00.000Z", to: "2999-01-01T00:00:00.000Z", dest: "https://ok.example/" },
    ]);
  });
});

describe("activeScheduleEntry", () => {
  const sched = [
    S("2026-08-06T15:00:00.000Z", "https://a.example/"),
    S("2026-08-06T18:00:00.000Z", "https://b.example/"),
  ];
  it("returns null before the first switch-point (base destination applies)", () => {
    expect(activeScheduleEntry(sched, Date.parse("2026-08-06T14:59:00.000Z"))).toBeNull();
  });
  it("returns the last switch-point whose start is <= now", () => {
    expect(activeScheduleEntry(sched, Date.parse("2026-08-06T19:00:00.000Z"))?.dest).toBe("https://b.example/");
  });
  it("is inclusive of the exact start instant", () => {
    expect(activeScheduleEntry(sched, Date.parse("2026-08-06T15:00:00.000Z"))?.dest).toBe("https://a.example/");
  });
});

describe("PT wall-clock <-> UTC (PDT = UTC-7 in August)", () => {
  it("converts 9:00 AM PT on Sat 8/8/2026 to 16:00Z", () => {
    expect(ptWallClockToUtcIso(2026, 8, 8, 9, 0)).toBe("2026-08-08T16:00:00.000Z");
  });
  it("round-trips back to PT parts", () => {
    const p = utcToPtParts("2026-08-08T16:00:00.000Z");
    expect([p.y, p.mo1, p.d, p.h, p.mi]).toEqual([2026, 8, 8, 9, 0]);
    expect(p.dateKey).toBe("2026-08-08");
    expect(p.dayLabel).toBe("Sat");
    expect(p.timeLabel).toBe("9:00 AM");
  });
});
