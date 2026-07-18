"use client";

import { useMemo } from "react";
import {
  activeScheduleEntry,
  utcToPtParts,
  ptWallClockToUtcIso,
  CON_DAYS,
  type ScheduleEntry,
} from "@/lib/qr-schedule";

/** Pure: bucket switch-points by PT day, ordered, flag the currently-live one. */
export function groupByPtDay(schedule: ScheduleEntry[], nowMs: number) {
  const active = activeScheduleEntry(schedule, nowMs);
  const sorted = [...schedule]
    .filter((e) => e?.startsAt && !Number.isNaN(Date.parse(e.startsAt)))
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  const groups: Array<{
    dateKey: string;
    dayLabel: string;
    rows: Array<{ entry: ScheduleEntry; timeLabel: string; live: boolean }>;
  }> = [];
  for (const entry of sorted) {
    const p = utcToPtParts(entry.startsAt);
    let g = groups.find((x) => x.dateKey === p.dateKey);
    if (!g) {
      g = { dateKey: p.dateKey, dayLabel: p.dayLabel, rows: [] };
      groups.push(g);
    }
    g.rows.push({ entry, timeLabel: p.timeLabel, live: active === entry });
  }
  return groups;
}

/** Split a datetime-local value ("2026-08-08T09:00") into a PT→UTC ISO instant. */
function localInputToUtcIso(v: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(v);
  if (!m) return "";
  return ptWallClockToUtcIso(+m[1], +m[2], +m[3], +m[4], +m[5]);
}

/** UTC ISO → the datetime-local value in PT for the picker. */
function utcIsoToLocalInput(iso: string): string {
  if (!iso || Number.isNaN(Date.parse(iso))) return "";
  const p = utcToPtParts(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${p.y}-${pad(p.mo1)}-${pad(p.d)}T${pad(p.h)}:${pad(p.mi)}`;
}

export default function ScheduleEditor({
  value,
  onChange,
}: {
  value: ScheduleEntry[];
  onChange: (next: ScheduleEntry[]) => void;
}) {
  const nowMs = Date.now();
  const groups = useMemo(() => groupByPtDay(value, nowMs), [value, nowMs]);

  const update = (idx: number, patch: Partial<ScheduleEntry>) =>
    onChange(value.map((e, i) => (i === idx ? { ...e, ...patch } : e)));
  const remove = (entry: ScheduleEntry) =>
    onChange(value.filter((e) => e !== entry));
  const addAt = (startsAt: string) => onChange([...value, { startsAt, dest: "" }]);

  return (
    <div className="space-y-3">
      <p className="text-xs opacity-70">
        All times Las Vegas (PT). A destination stays live until the next
        switch-point; before the first, the code uses its base destination. Live
        flips propagate within ~60s.
      </p>

      {groups.map((g) => (
        <div key={g.dateKey} className="rounded border border-white/10">
          <div className="px-3 py-1 text-xs font-semibold opacity-80 border-b border-white/10">
            {g.dayLabel} {g.dateKey}
          </div>
          <ul>
            {g.rows.map(({ entry, timeLabel, live }) => {
              const idx = value.indexOf(entry);
              return (
                <li
                  key={idx}
                  className="flex flex-wrap items-center gap-2 px-3 py-2"
                >
                  <input
                    type="datetime-local"
                    className="bg-transparent border border-white/20 rounded px-2 py-1 text-sm"
                    value={utcIsoToLocalInput(entry.startsAt)}
                    onChange={(e) =>
                      update(idx, { startsAt: localInputToUtcIso(e.target.value) })
                    }
                    aria-label="Switch-point time (PT)"
                  />
                  <span className="text-xs w-16 opacity-70">{timeLabel}</span>
                  <input
                    type="url"
                    placeholder="https://…"
                    className="flex-1 min-w-[12rem] bg-transparent border border-white/20 rounded px-2 py-1 text-sm"
                    value={entry.dest}
                    onChange={(e) => update(idx, { dest: e.target.value })}
                    aria-label="Destination URL"
                  />
                  {live && (
                    <span className="text-xs text-emerald-400">◀ LIVE</span>
                  )}
                  <button
                    type="button"
                    className="text-xs opacity-60 hover:opacity-100"
                    onClick={() => remove(entry)}
                  >
                    remove
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs opacity-70">Add switch-point:</span>
        {CON_DAYS.map((d) => (
          <button
            key={d.date}
            type="button"
            className="text-xs border border-white/20 rounded px-2 py-1"
            onClick={() => {
              const [y, mo, day] = d.date.split("-").map(Number);
              addAt(ptWallClockToUtcIso(y, mo, day, 8, 0)); // default 8:00 AM PT
            }}
          >
            + {d.label}
          </button>
        ))}
        <button
          type="button"
          className="text-xs border border-white/20 rounded px-2 py-1"
          onClick={() => {
            const p = utcToPtParts(new Date().toISOString());
            addAt(ptWallClockToUtcIso(p.y, p.mo1, p.d, p.h, p.mi));
          }}
        >
          + any date
        </button>
      </div>
    </div>
  );
}
