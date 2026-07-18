import Link from "next/link";

import { cls } from "@/components/admin/qr-ui";
import CtfStandings from "@/components/admin/CtfStandings";
import CtfUnsolveButton from "@/components/admin/CtfUnsolveButton";
import { listCtf } from "@/lib/qr-admin";
import { scanAllRunUsers } from "@/entities/run-user";
import {
  rankByScore,
  scanAllCtfSolves,
  aggregateSolvesByUser,
  enrichRows,
  summarize,
  challengeStatus,
  nameMapFromUsers,
  joinSolveNames,
  type NamedSolve,
} from "@/lib/ctf-leaderboard";
import { hasCustomName, shortId } from "@/lib/ctf-leaderboard-ui";
import { gateAdminPage } from "../qr/gate";

/**
 * /admin/leaderboard — CTF-only standings + drills (Phase 47, CTF-11; enhanced).
 * Lives in the (protected) route group so it renders inside the real run.human
 * chrome. Gated identically to /admin/qr (gateAdminPage → 404 on denial). One
 * live read fans out into every panel: summary tiles, the client standings
 * table (search / sort / named filter / first-blood + channel badges), the
 * challenge-status board, and the two drills (per-runner via `?runner=`,
 * per-challenge via `?challenge=`), both sliced in-memory from the SINGLE
 * CtfSolve scan below — no per-drill query.
 *
 * All rendered strings flow through React text nodes (escaped by default).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function fmtSolvedAt(iso?: string): string {
  if (!iso) return "—";
  return iso.slice(0, 16).replace("T", " ");
}

function Tile({
  label,
  value,
  hint,
}: {
  label: string;
  value: number;
  hint?: string;
}) {
  return (
    <div
      className={`${cls.card} px-4 py-3 flex flex-col gap-0.5${hint ? " cursor-help" : ""}`}
      title={hint}
    >
      <span className="text-2xl font-bold tabular-nums leading-none">{value}</span>
      <span className="text-[11px] uppercase tracking-wide text-default-400">
        {label}
      </span>
    </div>
  );
}

export default async function LeaderboardPage({
  searchParams,
}: {
  searchParams: Promise<{ challenge?: string; runner?: string }>;
}) {
  const { email } = await gateAdminPage();
  const { challenge, runner } = await searchParams;
  const selected = (challenge ?? "").trim().toLowerCase() || null;
  const selectedRunner = (runner ?? "").trim() || null;

  // ONE fan-out: users (rank + name join), challenges (status), all solves
  // (standings badges, summary, both drills).
  const [users, challenges, solves] = await Promise.all([
    scanAllRunUsers(),
    listCtf(),
    scanAllCtfSolves(),
  ]);

  const rows = rankByScore(users);
  const agg = aggregateSolvesByUser(solves);
  const enriched = enrichRows(rows, agg);
  const summary = summarize(rows, solves, challenges);
  const statuses = challengeStatus(challenges);
  const nameByUser = nameMapFromUsers(users);

  // Per-challenge drill — sliced from the single scan, sorted by solve order.
  let drill: NamedSolve[] | null = null;
  if (selected) {
    const cs = solves
      .filter((s) => s.challenge === selected)
      .sort((a, b) => (a.ordinal ?? 0) - (b.ordinal ?? 0));
    drill = joinSolveNames(cs, nameByUser);
  }

  // Per-runner drill — that runner's solves across every challenge.
  let runnerSolves: NamedSolve[] | null = null;
  let runnerLabel = "";
  if (selectedRunner) {
    const rs = solves
      .filter((s) => s.user === selectedRunner)
      .sort((a, b) => a.challenge.localeCompare(b.challenge));
    runnerSolves = joinSolveNames(rs, nameByUser);
    const name = nameByUser[selectedRunner];
    runnerLabel = hasCustomName(name) ? name! : shortId(selectedRunner);
  }

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

      {/* Summary tiles */}
      <section className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2.5">
        <Tile label="Solvers" value={summary.solvers} />
        <Tile label="Solves" value={summary.solves} />
        <Tile label="Points" value={summary.points} />
        <Tile label="🩸 First bloods" value={summary.firstBloods} />
        <Tile
          label="Live chals"
          value={summary.liveChallenges}
          hint="Challenges currently enabled (accepting solves)"
        />
        <Tile
          label="QR"
          value={summary.qr}
          hint="Solves earned by scanning a physical DEF CON QR code (q.defcon.run → visible claim page)"
        />
        <Tile
          label="Covert"
          value={summary.covert}
          hint="Solves earned via the hidden covert channel — the !!! easter egg (/assets/theme)"
        />
      </section>

      {/* Standings (client: search / sort / named filter / badges) */}
      <CtfStandings rows={enriched} />

      {/* Per-runner drill */}
      {selectedRunner ? (
        <section className="flex flex-col gap-2.5">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <h2 className={cls.h2}>
              Runner ·{" "}
              <span className="text-primary">{runnerLabel}</span>{" "}
              ({runnerSolves?.length ?? 0} solve
              {runnerSolves?.length === 1 ? "" : "s"})
            </h2>
            <Link href="/admin/leaderboard" className={cls.btn}>
              ✕ Clear
            </Link>
          </div>
          <div className={`${cls.card} overflow-hidden`}>
            <div className="overflow-x-auto">
              <table className={`${cls.table} min-w-[640px]`}>
                <thead className={cls.thead}>
                  <tr>
                    {["Challenge", "Points", "Ordinal", "First blood", "Channel", "Solved at", ""].map(
                      (c, i) => (
                        <th key={c || `act-${i}`} className={cls.th}>
                          {c}
                        </th>
                      )
                    )}
                  </tr>
                </thead>
                <tbody>
                  {!runnerSolves || runnerSolves.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="p-6 text-center text-default-400 text-sm">
                        No solves recorded for this runner.
                      </td>
                    </tr>
                  ) : (
                    runnerSolves.map((s, i) => (
                      <tr key={`${s.challenge}-${s.solvedAt ?? i}`} className={cls.tr}>
                        <td className={cls.td}>
                          <Link
                            href={`/admin/leaderboard?challenge=${encodeURIComponent(s.challenge)}`}
                            className="hover:text-primary transition-colors"
                          >
                            {s.challenge}
                          </Link>
                        </td>
                        <td className={`${cls.td} tabular-nums text-primary`}>
                          {s.points ?? "—"}
                        </td>
                        <td className={`${cls.td} tabular-nums text-default-500`}>
                          {s.ordinal ?? "—"}
                        </td>
                        <td className={cls.td}>
                          {s.firstBlood ? (
                            <span className="text-warning">🩸 first</span>
                          ) : (
                            <span className="text-default-400">—</span>
                          )}
                        </td>
                        <td className={cls.td}>{s.channel ?? "—"}</td>
                        <td className={`${cls.td} text-default-500`}>
                          {fmtSolvedAt(s.solvedAt)}
                        </td>
                        <td className={`${cls.td} text-right`}>
                          <CtfUnsolveButton
                            user={selectedRunner}
                            challenge={s.challenge}
                            kind="unsolve"
                          />
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

      {/* Challenge status board */}
      <section className="flex flex-col gap-2.5">
        <h2 className={cls.h2}>Challenges ({statuses.length})</h2>
        {statuses.length === 0 ? (
          <p className="text-[12.5px] text-default-400">No challenges yet.</p>
        ) : (
          <div className={`${cls.card} overflow-hidden`}>
            <div className="overflow-x-auto">
              <table className={`${cls.table} min-w-[520px]`}>
                <thead className={cls.thead}>
                  <tr>
                    {["Challenge", "Status", "Solves / Cap", "Points", ""].map((c) => (
                      <th key={c} className={cls.th}>
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {statuses.map((c) => {
                    const active = c.challenge === selected;
                    return (
                      <tr
                        key={c.challenge}
                        className={`${cls.tr} ${active ? "bg-primary/5" : ""}`}
                      >
                        <td className={cls.td}>{c.challenge}</td>
                        <td className={cls.td}>
                          {c.enabled ? (
                            <span className="text-success">● enabled</span>
                          ) : (
                            <span className="text-default-400">○ disabled</span>
                          )}
                        </td>
                        <td className={`${cls.td} tabular-nums`}>
                          <span className={c.capReached ? "text-warning font-semibold" : ""}>
                            {c.solveCount}
                          </span>
                          <span className="text-default-400">
                            {" "}
                            / {c.maxSolves ?? "∞"}
                          </span>
                          {c.capReached ? (
                            <span className="text-warning"> · full</span>
                          ) : null}
                        </td>
                        <td className={`${cls.td} tabular-nums text-default-500`}>
                          {c.points ?? "—"}
                        </td>
                        <td className={cls.td}>
                          <Link
                            href={`/admin/leaderboard?challenge=${encodeURIComponent(c.challenge)}`}
                            className={`text-xs ${
                              active ? "text-primary" : "text-default-500 hover:text-foreground"
                            }`}
                          >
                            solves →
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      {/* Drill: solves for the selected challenge */}
      {selected ? (
        <section className="flex flex-col gap-2.5">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <h2 className={cls.h2}>
              Solves · <span className="text-primary font-mono">{selected}</span>{" "}
              ({drill?.length ?? 0})
            </h2>
            <Link href="/admin/leaderboard" className={cls.btn}>
              ✕ Clear
            </Link>
          </div>
          <div className={`${cls.card} overflow-hidden`}>
            <div className="overflow-x-auto">
              <table className={`${cls.table} min-w-[640px]`}>
                <thead className={cls.thead}>
                  <tr>
                    {["Ordinal", "Runner", "Points", "First blood", "Channel", "Solved at"].map(
                      (c) => (
                        <th key={c} className={cls.th}>
                          {c}
                        </th>
                      )
                    )}
                  </tr>
                </thead>
                <tbody>
                  {!drill || drill.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="p-6 text-center text-default-400 text-sm">
                        No solves recorded for this challenge yet.
                      </td>
                    </tr>
                  ) : (
                    drill.map((s, i) => (
                      <tr key={`${s.user}-${s.solvedAt ?? i}`} className={cls.tr}>
                        <td className={`${cls.td} tabular-nums text-default-500`}>
                          {s.ordinal ?? "—"}
                        </td>
                        <td className={cls.td}>
                          <Link
                            href={`/admin/leaderboard?runner=${encodeURIComponent(s.user)}`}
                            className="hover:text-primary transition-colors"
                          >
                            {s.name}
                          </Link>
                        </td>
                        <td className={`${cls.td} tabular-nums text-primary`}>
                          {s.points ?? "—"}
                        </td>
                        <td className={cls.td}>
                          {s.firstBlood ? (
                            <span className="text-warning">🩸 first</span>
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
        Standings scan RunUser rollups (ctfScore / ctfSolves); badges, summary and
        both drills read the CtfSolve <em>and</em> CtfScoreEvent ledgers unioned
        (one scan each, sliced in memory) so OTP/repeatable solves show. CSV export
        is formula-injection-guarded. The q.defcon.run/admin/leaderboard host is
        wired in Phase 48.
      </p>
    </div>
  );
}
