import { NextResponse } from "next/server";

import { auth } from "@/config/auth";
import {
  ADMIN_GROUPS,
  requireGroups,
  revalidateGroups,
} from "@/lib/admin-gate";
import {
  buildLeaderboard,
  scanAllCtfSolves,
  aggregateSolvesByUser,
  enrichRows,
  leaderboardCsv,
} from "@/lib/ctf-leaderboard";
import { unsolveUser, unsolveChallenge } from "@/lib/ctf-unsolve-store";

/**
 * GET /api/admin/ctf-leaderboard — CTF standings CSV export (Phase 47, CTF-11).
 *
 * The leaderboard PAGE consumes buildLeaderboard() directly; this route exists
 * only to stream the formula-guarded CSV (?format=csv, also the default).
 *
 * ── Gate (T-47-09, non-disclosure) ──────────────────────────────────────────
 * Gated EXACTLY like /api/admin/qr: sync requireGroups(ADMIN_GROUPS) —
 * admin | runadmin; qradmin deliberately does NOT reach anything under
 * /api/admin — then a LIVE revalidateGroups keyed by the OIDC sub. Every denial
 * (no session / not admin / failed revalidation) collapses to a BARE 404, never
 * a 401/403, so the route's existence is not advertised.
 *
 * IDENTIFIER LANDMINE: revalidateGroups MUST be called with
 * `session.user.authUserId` (the auth.defcon.run OIDC sub) — NOT
 * `session.user.id`, which is the Auth.js DynamoDB-adapter local uuid. Passing
 * the adapter id silently fails the live claims lookup and 404s a real admin.
 *
 * ── Caching (T-47-12) ───────────────────────────────────────────────────────
 * Cache-Control: no-store + force-dynamic keep the CSV (and its emails-free but
 * still admin-only standings) off every cache. Node runtime — the ElectroDB /
 * AWS-SDK scan needs Node crypto for request signing.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NOT_FOUND = () => new Response(null, { status: 404 });

export async function GET(): Promise<Response> {
  // ── Gate (fail-closed; every denial → 404) ────────────────────────────────
  const session = await auth();
  if (!requireGroups(session, ADMIN_GROUPS).ok) return NOT_FOUND();
  const authUserId = session?.user?.authUserId;
  if (!authUserId || !(await revalidateGroups(authUserId, ADMIN_GROUPS)))
    return NOT_FOUND();

  // ── Build → enrich → serialize (formula-guarded) ──────────────────────────
  const [rows, solves] = await Promise.all([
    buildLeaderboard(),
    scanAllCtfSolves(),
  ]);
  const enriched = enrichRows(rows, aggregateSolvesByUser(solves));
  const csv = leaderboardCsv(enriched);
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="ctf-leaderboard-${today}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}

/**
 * POST /api/admin/ctf-leaderboard — destructive operator actions on the CTF
 * board: unsolve one challenge for a runner, or zero a runner entirely. A UI
 * wrapper around scripts/reset-ctf-user.mts (see lib/ctf-unsolve-store).
 *
 * Gated IDENTICALLY to GET above and to /api/admin/qr: sync requireGroups
 * (admin | runadmin) then a LIVE revalidateGroups keyed by the OIDC sub
 * (authUserId — NOT the adapter id). Every denial collapses to a BARE 404
 * (non-disclosure), never a 401/403.
 *
 * DELIBERATELY ADMIN_GROUPS, not CTF_ADMIN_GROUPS: this is a DESTRUCTIVE,
 * cross-user data mutation (peer: /api/admin/qr), so it takes the strongest gate
 * with live revalidation — unlike the CTF re-submit override (isCtfAdmin), which
 * only lets an operator re-score their OWN flag and so admits the looser
 * `ctfadmin` group (which run.auth does not even issue today). The action operates on a TARGET userId
 * (the runner being zeroed), which is the CtfSolve.user / RunUser.userId space
 * (= session.user.id), distinct from the admin's authUserId used for the gate.
 *
 * Actions:
 *   - unsolve_user      { user }              zero the runner (full reset)
 *   - unsolve_challenge { user, challenge }   unsolve one challenge for them
 */
interface AdminLeaderboardRequest {
  action?: "unsolve_user" | "unsolve_challenge";
  user?: string;
  challenge?: string;
}

const bad = (message: string) =>
  NextResponse.json({ success: false, message }, { status: 400 });

export async function POST(request: Request): Promise<Response> {
  // ── Gate (fail-closed; every denial → 404) ────────────────────────────────
  const session = await auth();
  if (!requireGroups(session, ADMIN_GROUPS).ok) return NOT_FOUND();
  const authUserId = session?.user?.authUserId;
  if (!authUserId || !(await revalidateGroups(authUserId, ADMIN_GROUPS)))
    return NOT_FOUND();

  try {
    const body: AdminLeaderboardRequest = await request.json();
    const user = (body.user ?? "").trim();
    if (!user) return bad("user is required");

    switch (body.action) {
      case "unsolve_user": {
        const r = await unsolveUser(user);
        return NextResponse.json({
          success: true,
          message: `Zeroed ${r.removedSolves} solve(s) for the runner.`,
          data: r,
        });
      }
      case "unsolve_challenge": {
        const challenge = (body.challenge ?? "").trim();
        if (!challenge) return bad("challenge is required");
        const r = await unsolveChallenge(user, challenge);
        if (r.removedSolves === 0 && r.removedScoreEvents === 0) {
          return bad(`No solve found for ${challenge}.`);
        }
        return NextResponse.json({
          success: true,
          message: `Unsolved ${r.challenge} for the runner.`,
          data: r,
        });
      }
      default:
        return bad("Unknown action.");
    }
  } catch (error) {
    console.error("[admin/ctf-leaderboard] Error:", error);
    return NextResponse.json(
      { success: false, message: "Internal server error" },
      { status: 500 }
    );
  }
}
