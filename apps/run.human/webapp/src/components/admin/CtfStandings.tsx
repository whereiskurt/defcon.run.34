"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

import { cls } from "@/components/admin/qr-ui";
import {
  type EnrichedRow,
  type SortKey,
  filterStandings,
  sortStandings,
  rowLabel,
} from "@/lib/ctf-leaderboard-ui";

/**
 * CTF standings — client table with live search, named-only filter, sortable
 * columns, and per-runner drill links. Receives the SCORE-ranked rows as props
 * (no fetch; the set is event-scale) and re-sorts/filters purely in the browser.
 * The rank shown is the TRUE score rank, frozen from the incoming order, so it
 * stays meaningful under a re-sort or filter (mirrors the global board's
 * rank-over-full-set contract).
 */

const COLS: { key: SortKey; label: string; className?: string }[] = [
  { key: "name", label: "Runner" },
  { key: "score", label: "Score" },
  { key: "solves", label: "Solves" },
  { key: "first", label: "🩸 First" },
];

function Chip({ n, color, title }: { n: number; color: string; title: string }) {
  if (!n) return <span className="text-default-300">—</span>;
  return (
    <span
      title={title}
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${color}`}
    >
      {n}
    </span>
  );
}

export default function CtfStandings({ rows }: { rows: EnrichedRow[] }) {
  const [q, setQ] = useState("");
  const [namedOnly, setNamedOnly] = useState(false);
  const [sort, setSort] = useState<SortKey>("score");

  // True score rank, frozen from the incoming (score-desc) order.
  const rankById = useMemo(() => {
    const m = new Map<string, number>();
    rows.forEach((r, i) => m.set(r.userId, i + 1));
    return m;
  }, [rows]);

  const view = useMemo(
    () => sortStandings(filterStandings(rows, { q, namedOnly }), sort),
    [rows, q, namedOnly, sort]
  );

  return (
    <section className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className={cls.h2}>
          Standings{" "}
          <span className="text-default-400 font-normal">
            ({view.length}
            {view.length !== rows.length ? ` of ${rows.length}` : ""})
          </span>
        </h2>
        <div className="flex items-center gap-2 flex-wrap">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name or id…"
            aria-label="Search standings"
            className={`${cls.input} h-8 w-52`}
          />
          <button
            type="button"
            onClick={() => setNamedOnly((v) => !v)}
            aria-pressed={namedOnly}
            className={`font-mono text-xs px-3 py-1.5 rounded-full border transition-colors ${
              namedOnly
                ? "border-primary text-primary bg-primary/10"
                : "border-divider text-default-500 hover:text-foreground"
            }`}
          >
            🏷️ Named {namedOnly ? "✓" : ""}
          </button>
        </div>
      </div>

      <div className={`${cls.card} overflow-hidden`}>
        <div className="overflow-x-auto">
          <table className={`${cls.table} min-w-[560px]`}>
            <thead className={cls.thead}>
              <tr>
                <th className={cls.th}>#</th>
                {COLS.map((c) => (
                  <th key={c.key} className={cls.th}>
                    <button
                      type="button"
                      onClick={() => setSort(c.key)}
                      className={`inline-flex items-center gap-1 hover:text-foreground transition-colors ${
                        sort === c.key ? "text-primary" : ""
                      }`}
                    >
                      {c.label}
                      {sort === c.key ? <span aria-hidden>▾</span> : null}
                    </button>
                  </th>
                ))}
                <th
                  className={`${cls.th} cursor-help`}
                  title="How each runner earned solves — QR = scanned a physical DEF CON code; covert = found the hidden !!! easter egg"
                >
                  Channels
                </th>
              </tr>
            </thead>
            <tbody>
              {view.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-6 text-center text-default-400 text-sm">
                    {rows.length === 0
                      ? "No scores yet. Solvers appear here once the judge awards points."
                      : "No runners match the current filter."}
                  </td>
                </tr>
              ) : (
                view.map((r) => {
                  const label = rowLabel(r);
                  return (
                    <tr key={r.userId} className={cls.tr}>
                      <td className={`${cls.td} tabular-nums text-default-500`}>
                        {rankById.get(r.userId)}
                      </td>
                      <td className={cls.td}>
                        <Link
                          href={`/admin/leaderboard?runner=${encodeURIComponent(r.userId)}`}
                          className={`hover:text-primary transition-colors ${
                            label.muted ? "text-default-400 italic" : ""
                          }`}
                          title={r.userId}
                        >
                          {label.text}
                        </Link>
                      </td>
                      <td className={`${cls.td} tabular-nums text-primary`}>
                        {r.ctfScore}
                      </td>
                      <td className={`${cls.td} tabular-nums`}>{r.ctfSolves}</td>
                      <td className={cls.td}>
                        {r.firstBloods ? (
                          <span className="text-warning">🩸 {r.firstBloods}</span>
                        ) : (
                          <span className="text-default-300">—</span>
                        )}
                      </td>
                      <td className={`${cls.td} flex items-center gap-1.5`}>
                        <Chip
                          n={r.qr}
                          color="bg-success/15 text-success"
                          title={`${r.qr} QR solve(s)`}
                        />
                        <Chip
                          n={r.covert}
                          color="bg-secondary/15 text-secondary"
                          title={`${r.covert} covert solve(s)`}
                        />
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
