/**
 * Pure scheduling core for dynamic scheduled QR codes.
 *
 * A "dynamic scheduled QR code" is a Qr row whose `schedule` (an ordered list of
 * switch-points) is the authoring source of truth. On save it is COMPILED into
 * the resolver's existing `rules` time-windows — so the resolver Lambda is never
 * changed. See docs/superpowers/specs/2026-07-18-dynamic-scheduled-qr-design.md.
 *
 * All times are stored UTC ISO. Switch-points are authored/displayed in Vegas
 * time (America/Los_Angeles) regardless of the operator's browser timezone.
 */

export interface ScheduleEntry {
  /** UTC ISO 8601 instant the destination becomes live. */
  startsAt: string;
  /** Absolute https destination (validated at the write boundary). */
  dest: string;
  /** Optional human label shown in the editor. */
  label?: string;
}

/** Sentinel `to` for the last (open-ended) switch-point. */
const FAR_FUTURE = "2999-01-01T00:00:00.000Z";

export const CON_TZ = "America/Los_Angeles";

/** DEF CON 34 days — quick-add presets and default group labels only. Confirm dates. */
export const CON_DAYS: Array<{ label: string; date: string }> = [
  { label: "Thu", date: "2026-08-06" },
  { label: "Fri", date: "2026-08-07" },
  { label: "Sat", date: "2026-08-08" },
  { label: "Sun", date: "2026-08-09" },
];

/** Keep only well-formed entries, sorted ascending by startsAt. */
function sanitize(schedule: ScheduleEntry[]): ScheduleEntry[] {
  return [...(schedule ?? [])]
    .filter(
      (e) =>
        e &&
        typeof e.startsAt === "string" &&
        !Number.isNaN(Date.parse(e.startsAt)) &&
        typeof e.dest === "string" &&
        e.dest.trim() !== ""
    )
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
}

/**
 * Compile switch-points into resolver time-rules. Window i is
 * [startsAt[i], startsAt[i+1]); the last is open-ended (FAR_FUTURE). The period
 * before the first switch-point matches no window, so the resolver falls back to
 * the base `destination`.
 */
export function compileScheduleToRules(
  schedule: ScheduleEntry[]
): Array<{ kind: "time"; from: string; to: string; dest: string }> {
  const entries = sanitize(schedule);
  return entries.map((e, i) => ({
    kind: "time" as const,
    from: e.startsAt,
    to: i + 1 < entries.length ? entries[i + 1].startsAt : FAR_FUTURE,
    dest: e.dest,
  }));
}

/** The switch-point live at nowMs, or null before the first (→ base destination). */
export function activeScheduleEntry(
  schedule: ScheduleEntry[],
  nowMs: number
): ScheduleEntry | null {
  let active: ScheduleEntry | null = null;
  for (const e of sanitize(schedule)) {
    if (Date.parse(e.startsAt) <= nowMs) active = e;
    else break;
  }
  return active;
}

/** Offset (ms) of `tz` at the given UTC instant: tzLocal - utc. */
function tzOffsetMs(tz: string, atUtcMs: number): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const p = Object.fromEntries(
    dtf.formatToParts(new Date(atUtcMs)).map((x) => [x.type, x.value])
  ) as Record<string, string>;
  const asUtc = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    Number(p.hour),
    Number(p.minute),
    Number(p.second)
  );
  return asUtc - atUtcMs;
}

/** A Vegas wall-clock (mo1 = 1-based month) → UTC ISO. Handles PDT/PST via Intl. */
export function ptWallClockToUtcIso(
  y: number,
  mo1: number,
  d: number,
  h: number,
  mi: number
): string {
  const naiveUtc = Date.UTC(y, mo1 - 1, d, h, mi, 0);
  // Offset at the naive guess is stable away from DST edges (con dates are).
  const offset = tzOffsetMs(CON_TZ, naiveUtc);
  return new Date(naiveUtc - offset).toISOString();
}

/** A UTC ISO → Vegas parts for display/grouping. */
export function utcToPtParts(iso: string): {
  y: number;
  mo1: number;
  d: number;
  h: number;
  mi: number;
  dateKey: string;
  timeLabel: string;
  dayLabel: string;
} {
  const ms = Date.parse(iso);
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: CON_TZ,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  const p = Object.fromEntries(
    dtf.formatToParts(new Date(ms)).map((x) => [x.type, x.value])
  ) as Record<string, string>;
  const y = Number(p.year);
  const mo1 = Number(p.month);
  const d = Number(p.day);
  const pm = (p.dayPeriod ?? "").toUpperCase() === "PM";
  return {
    y,
    mo1,
    d,
    h: (Number(p.hour) % 12) + (pm ? 12 : 0),
    mi: Number(p.minute),
    dateKey: `${p.year}-${p.month}-${p.day}`,
    timeLabel: `${p.hour}:${p.minute} ${(p.dayPeriod ?? "").toUpperCase()}`,
    dayLabel: p.weekday,
  };
}
