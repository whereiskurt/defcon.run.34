import { describe, it, expect } from "vitest";
import { groupByPtDay } from "@/components/admin/ScheduleEditor";

describe("groupByPtDay", () => {
  const sched = [
    { startsAt: "2026-08-06T18:00:00.000Z", dest: "https://b.example/" }, // Thu 11:00 AM PT
    { startsAt: "2026-08-06T15:00:00.000Z", dest: "https://a.example/" }, // Thu 8:00 AM PT
    { startsAt: "2026-08-08T16:00:00.000Z", dest: "https://c.example/" }, // Sat 9:00 AM PT
  ];
  it("buckets by PT day, ordered, with the live row flagged", () => {
    const groups = groupByPtDay(sched, Date.parse("2026-08-06T19:00:00.000Z")); // Thu 12:00 PM PT
    expect(groups.map((g) => g.dayLabel)).toEqual(["Thu", "Sat"]);
    expect(groups[0].rows.map((r) => r.timeLabel)).toEqual(["8:00 AM", "11:00 AM"]);
    expect(groups[0].rows.map((r) => r.live)).toEqual([false, true]); // 11 AM active at noon
    expect(groups[1].rows[0].live).toBe(false);
  });

  it("returns no groups for an empty schedule", () => {
    expect(groupByPtDay([], Date.parse("2026-08-06T19:00:00.000Z"))).toEqual([]);
  });
});
