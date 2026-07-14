import Link from "next/link";

import { cls } from "@/components/admin/qr-ui";
import { listCtf } from "@/lib/qr-admin";
import { scanAllRunUsers } from "@/entities/run-user";
import {
  buildLeaderboard,
  listCtfSolvesByChallenge,
  nameMapFromUsers,
  joinSolveNames,
  type NamedSolve,
} from "@/lib/ctf-leaderboard";
import { gateAdminPage } from "../qr/gate";

/**
 * /admin/leaderboard — CTF-only standings (Phase 47, CTF-11). Lives in the
 * (protected) route group so it renders inside the real run.human chrome,
 * matching AdminConsole / the QR admin. Gated identically to /admin/qr
 * (gateAdminPage → 404 on denial; non-disclosure). force-dynamic: always a live
 * read of the shared table.
 *
 * Reachability at q.defcon.run/admin/leaderboard is Phase 48 — this page renders
 * under run.human's normal /use1 basePath and is linked from AdminConsole.
 *
 * All rendered strings (displayName, challenge, solve name) flow through React
 * text nodes, which escape by default — no manual HTML escaping needed.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function fmtSolvedAt(iso?: string): string {
  if (!iso) return "—";
  return iso.slice(0, 16).replace("T", " ");
}

export default async function LeaderboardPage({
  searchParams,
}: {
  searchParams: Promise<{ challenge?: string }>;
}) {
  const { email } = await gateAdminPage();
  const { challenge } = await searchParams;
  const selected = (challenge ?? "").trim().toLowerCase() || null;

  // Ranking + challenge list concurrently. The drill (per-challenge solves +
  // the name map for the join) only fires when a challenge is selected.
  const [ranking, challenges] = await Promise.all([
    buildLeaderboard(),
    listCtf(),
  ]);

  let drill: NamedSolve[] | null = null;
  if (selected) {
    const [users, solves] = await Promise.all([
      scanAllRunUsers(),
      listCtfSolvesByChallenge(selected),
    ]);
    drill = joinSolveNames(solves, nameMapFromUsers(users));
  }

  const sortedChallenges = [...challenges].sort((a, b) =>
    a.challenge.localeCompare(b.challenge)
  );

  return (
    <div className={cls.root}>
      {/* Header */}
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className={cls.h1}>
            defcon<span className="teal-dot">.</span>run 34 · CTF Leaderboard
          </h1>
          <p className={`${cls.sub} mt-1`}>
            Ranked by CTF score
            {email ? ` · ${email}` : ""}.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <a href="/api/admin/ctf-leaderboard?format=csv" className={cls.btn}>
            ↓ CSV
          </a>
          <Link href="/admin/qr" className={cls.btn}>
            QR / CTF →
          </Link>
          <Link href="/admin" className={cls.btn}>
            ← Admin
          </Link>
        </div>
      </div>

      {/* Ranking */}
      <section className="flex flex-col gap-2.5">
        <h2 className={cls.h2}>Standings ({ranking.length})</h2>
        <div className={`${cls.card} overflow-hidden`}>
          <div className="overflow-x-auto">
            <table className={`${cls.table} min-w-[420px]`}>
              <thead className={cls.thead}>
                <tr>
                  {["#", "Runner", "Score", "Solves"].map((c) => (
                    <th key={c} className={cls.th}>
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ranking.length === 0 ? (
                  <tr>
                    <td
                      colSpan={4}
                      className="p-6 text-center text-default-400 text-sm"
                    >
                      No scores yet. Solvers appear here once the judge awards points.
                    </td>
                  </tr>
                ) : (
                  ranking.map((r, i) => (
                    <tr key={r.userId} className={cls.tr}>
                      <td className={`${cls.td} tabular-nums text-default-500`}>
                        {i + 1}
                      </td>
                      <td className={cls.td}>{r.displayName || r.userId}</td>
                      <td className={`${cls.td} tabular-nums text-primary`}>
                        {r.ctfScore}
                      </td>
                      <td className={`${cls.td} tabular-nums`}>{r.ctfSolves}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Per-challenge drill selector */}
      <section className="flex flex-col gap-2.5">
        <h2 className={cls.h2}>Challenges ({sortedChallenges.length})</h2>
        {sortedChallenges.length === 0 ? (
          <p className="text-[12.5px] text-default-400">No challenges yet.</p>
        ) : (
          <div className="flex gap-2 flex-wrap">
            {sortedChallenges.map((c) => {
              const active = c.challenge === selected;
              return (
                <Link
                  key={c.challenge}
                  href={`/admin/leaderboard?challenge=${encodeURIComponent(c.challenge)}`}
                  className={`font-mono text-xs px-3 py-1.5 rounded-full border transition-colors ${
                    active
                      ? "border-primary text-primary bg-primary/10"
                      : "border-divider text-default-500 hover:text-foreground"
                  }`}
                >
                  {c.challenge}
                </Link>
              );
            })}
          </div>
        )}
      </section>

      {/* Drill: solves for the selected challenge */}
      {selected ? (
        <section className="flex flex-col gap-2.5">
          <h2 className={cls.h2}>
            Solves · <span className="text-primary font-mono">{selected}</span>{" "}
            ({drill?.length ?? 0})
          </h2>
          <div className={`${cls.card} overflow-hidden`}>
            <div className="overflow-x-auto">
              <table className={`${cls.table} min-w-[640px]`}>
                <thead className={cls.thead}>
                  <tr>
                    {[
                      "Ordinal",
                      "Runner",
                      "Points",
                      "First blood",
                      "Channel",
                      "Solved at",
                    ].map((c) => (
                      <th key={c} className={cls.th}>
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {!drill || drill.length === 0 ? (
                    <tr>
                      <td
                        colSpan={6}
                        className="p-6 text-center text-default-400 text-sm"
                      >
                        No solves recorded for this challenge yet.
                      </td>
                    </tr>
                  ) : (
                    drill.map((s) => (
                      <tr key={s.user} className={cls.tr}>
                        <td className={`${cls.td} tabular-nums text-default-500`}>
                          {s.ordinal ?? "—"}
                        </td>
                        <td className={cls.td}>{s.name}</td>
                        <td className={`${cls.td} tabular-nums text-primary`}>
                          {s.points ?? "—"}
                        </td>
                        <td className={cls.td}>
                          {s.firstBlood ? (
                            <span className="text-warning">★ first</span>
                          ) : (
                            <span className="text-default-400">—</span>
                          )}
                        </td>
                        <td className={cls.td}>{s.channel ?? "—"}</td>
                        <td className={`${cls.td} text-default-500`}>
                          {fmtSolvedAt(s.solvedAt)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      ) : null}

      <p className="text-[11.5px] text-default-400">
        Standings scan RunUser rollups (ctfScore / ctfSolves); the per-challenge
        drill reads CtfSolve rows. CSV export is formula-injection-guarded. The
        q.defcon.run/admin/leaderboard host is wired in Phase 48.
      </p>
    </div>
  );
}
